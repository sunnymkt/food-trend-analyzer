#!/usr/bin/env python3
"""
사용자가 지정한 키워드 목록(data/custom_keywords_config.json)의 최근 3개월(90일)
네이버 데이터랩 검색어트렌드를 가져와 data/custom_keyword_trends.json 을 생성한다.

기존 12개 "트렌드 키워드"(data/keywords_config.json, fetch_naver_trends.py)와는
별도로 관리되는 데이터셋이다. 원본: 키워드 검색용 분류(26.07.12).xlsx (중분류/소분류).

필요 환경변수: NAVER_CLIENT_ID / NAVER_CLIENT_SECRET (fetch_naver_trends.py와 동일)

사용법:
  python scripts/fetch_custom_keyword_trends.py
  python scripts/fetch_custom_keyword_trends.py --keyword 두부   # 하나만 테스트
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _env import load_env_file  # noqa: E402
from _naver_common import (  # noqa: E402
    BATCH_SIZE, call_naver_api, align_to_range, compute_change_rate, chunk,
)

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CONFIG_PATH = DATA_DIR / "custom_keywords_config.json"
OUTPUT_PATH = DATA_DIR / "custom_keyword_trends.json"
META_PATH = DATA_DIR / "meta.json"

WINDOW_DAYS = 90  # 최근 3개월
KST = timezone(timedelta(hours=9))


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    return cfg["items"]  # [{"midCategory": ..., "keyword": ...}, ...]


def date_range():
    end = datetime.now(KST).date() - timedelta(days=1)
    start = end - timedelta(days=WINDOW_DAYS - 1)
    return start.isoformat(), end.isoformat()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--keyword", help="이 키워드만 수집 (디버깅용)")
    args = parser.parse_args()

    load_env_file()
    client_id = os.environ.get("NAVER_CLIENT_ID")
    client_secret = os.environ.get("NAVER_CLIENT_SECRET")
    if not client_id or not client_secret:
        print("ERROR: NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 필요합니다.", file=sys.stderr)
        sys.exit(1)

    items = load_config()
    if args.keyword:
        items = [i for i in items if i["keyword"] == args.keyword]
        if not items:
            print(f"ERROR: '{args.keyword}' 키워드를 custom_keywords_config.json 에서 찾을 수 없습니다.", file=sys.stderr)
            sys.exit(1)

    mid_category_by_kw = {i["keyword"]: i["midCategory"] for i in items}
    keyword_list = list(mid_category_by_kw.keys())
    start_date, end_date = date_range()

    print(f"[fetch_custom_keyword_trends] {len(keyword_list)}개 키워드, {start_date} ~ {end_date}")

    trend_by_keyword = {}
    try:
        for batch in chunk(keyword_list, BATCH_SIZE):
            resp = call_naver_api(client_id, client_secret, start_date, end_date, batch)
            for result in resp.get("results", []):
                kw = result["title"]
                trend_by_keyword[kw] = align_to_range(result["data"], start_date, end_date)
            time.sleep(0.3)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        print("기존 data/custom_keyword_trends.json 을 유지하고 종료합니다.", file=sys.stderr)
        sys.exit(1)

    missing = [kw for kw in keyword_list if kw not in trend_by_keyword]
    if missing:
        print(f"ERROR: 응답에 누락된 키워드: {missing}", file=sys.stderr)
        sys.exit(1)

    output = {}
    for kw in keyword_list:
        data = trend_by_keyword[kw]
        output[kw] = {
            "midCategory": mid_category_by_kw[kw],
            "changeRate": compute_change_rate(data),
            "data": data,
        }

    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[fetch_custom_keyword_trends] {OUTPUT_PATH} 갱신 완료 ({len(output)}개 키워드)")

    meta_out = {}
    if META_PATH.exists():
        meta_out = json.loads(META_PATH.read_text(encoding="utf-8"))
    meta_out["customKeywordsUpdated"] = datetime.now(KST).isoformat()
    meta_out["customKeywordsTrendStartDate"] = start_date
    meta_out["customKeywordsTrendEndDate"] = end_date
    META_PATH.write_text(json.dumps(meta_out, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
