#!/usr/bin/env python3
"""
네이버 데이터랩 검색어트렌드 API로 키워드별 최근 3개월(90일) 검색 추이를 가져와
data/keyword_trends.json 을 생성한다.

필요 환경변수:
  NAVER_CLIENT_ID
  NAVER_CLIENT_SECRET
  (로컬에서는 .env 파일에 넣고 실행해도 되고, GitHub Actions에서는 Secrets로 주입한다)

사용법:
  python scripts/fetch_naver_trends.py

키워드 목록/설명/색상은 data/keywords_config.json 에서 읽는다.
API 실패 시 기존 data/keyword_trends.json 을 건드리지 않고 비정상 종료한다
(사이트가 마지막으로 성공한 데이터를 계속 보여주도록 하기 위함).
"""

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
KEYWORDS_CONFIG_PATH = DATA_DIR / "keywords_config.json"
OUTPUT_PATH = DATA_DIR / "keyword_trends.json"
META_PATH = DATA_DIR / "meta.json"

WINDOW_DAYS = 90         # 최근 3개월(90일) 추이
KST = timezone(timedelta(hours=9))


def load_keywords_config():
    with open(KEYWORDS_CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    return cfg["keywords"]


def date_range():
    # 네이버 데이터랩은 최근 1~2일은 집계가 덜 끝났을 수 있어 어제까지로 요청한다.
    end = datetime.now(KST).date() - timedelta(days=1)
    start = end - timedelta(days=WINDOW_DAYS - 1)
    return start.isoformat(), end.isoformat()


def main():
    load_env_file()
    client_id = os.environ.get("NAVER_CLIENT_ID")
    client_secret = os.environ.get("NAVER_CLIENT_SECRET")
    if not client_id or not client_secret:
        print("ERROR: NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 필요합니다.", file=sys.stderr)
        sys.exit(1)

    keywords_cfg = load_keywords_config()
    keyword_list = list(keywords_cfg.keys())
    start_date, end_date = date_range()

    print(f"[fetch_naver_trends] {len(keyword_list)}개 키워드, {start_date} ~ {end_date}")

    trend_by_keyword = {}
    try:
        for batch in chunk(keyword_list, BATCH_SIZE):
            resp = call_naver_api(client_id, client_secret, start_date, end_date, batch)
            for result in resp.get("results", []):
                kw = result["title"]
                trend_by_keyword[kw] = align_to_range(result["data"], start_date, end_date)
            time.sleep(0.3)  # 배치 사이 짧은 텀
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        print("기존 data/keyword_trends.json 을 유지하고 종료합니다.", file=sys.stderr)
        sys.exit(1)

    missing = [kw for kw in keyword_list if kw not in trend_by_keyword]
    if missing:
        print(f"ERROR: 응답에 누락된 키워드: {missing}", file=sys.stderr)
        sys.exit(1)

    output = {}
    for kw, meta in keywords_cfg.items():
        if kw.startswith("_"):
            continue
        data = trend_by_keyword[kw]
        output[kw] = {
            "color": meta["color"],
            "category": meta["category"],
            "description": meta["description"],
            "changeRate": compute_change_rate(data),
            "data": data,
        }

    OUTPUT_PATH.write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[fetch_naver_trends] {OUTPUT_PATH} 갱신 완료 ({len(output)}개 키워드)")

    meta_out = {}
    if META_PATH.exists():
        meta_out = json.loads(META_PATH.read_text(encoding="utf-8"))
    now_iso = datetime.now(KST).isoformat()
    meta_out["lastUpdated"] = now_iso
    meta_out["naverUpdated"] = now_iso
    meta_out["keywordSource"] = "naver_datalab"
    meta_out["trendStartDate"] = start_date
    meta_out["trendEndDate"] = end_date
    meta_out.pop("note", None)
    META_PATH.write_text(json.dumps(meta_out, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
