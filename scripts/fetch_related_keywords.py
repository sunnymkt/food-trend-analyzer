#!/usr/bin/env python3
"""
data/custom_keywords_config.json 의 32개 키워드 각각에 대해 네이버 검색광고
(SearchAd) API의 "키워드도구"(연관키워드 조회)를 호출해, 검색량 기준 상위
관련 키워드 목록을 data/custom_keyword_related.json 에 저장한다.

기존 데이터랩 검색어트렌드(fetch_naver_trends.py, fetch_custom_keyword_trends.py)와는
완전히 별개의 네이버 계정/API로, developers.naver.com이 아니라
https://searchad.naver.com 에서 광고주로 가입 후 [도구 > API 사용 관리]에서
API 라이선스를 발급받아야 한다.

필요 환경변수:
  NAVER_AD_API_KEY       (Access License)
  NAVER_AD_SECRET_KEY    (Secret Key)
  NAVER_AD_CUSTOMER_ID   (Customer ID, 숫자)

사용법:
  python scripts/fetch_related_keywords.py
  python scripts/fetch_related_keywords.py --keyword 두부   # 하나만 테스트
"""

import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib import request, error, parse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _env import load_env_file  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CONFIG_PATH = DATA_DIR / "custom_keywords_config.json"
OUTPUT_PATH = DATA_DIR / "custom_keyword_related.json"
META_PATH = DATA_DIR / "meta.json"

BASE_URL = "https://api.searchad.naver.com"
URI = "/keywordstool"
TOP_N = 50
KST = timezone(timedelta(hours=9))


def build_signature(timestamp, method, uri, secret_key):
    message = f"{timestamp}.{method}.{uri}"
    h = hmac.new(secret_key.encode("utf-8"), message.encode("utf-8"), hashlib.sha256)
    return base64.b64encode(h.digest()).decode("utf-8")


def call_keywordstool(api_key, secret_key, customer_id, keyword, retries=3):
    timestamp = str(round(time.time() * 1000))
    signature = build_signature(timestamp, "GET", URI, secret_key)
    query = parse.urlencode({"hintKeywords": keyword, "showDetail": 1})
    req = request.Request(
        f"{BASE_URL}{URI}?{query}",
        method="GET",
        headers={
            "Content-Type": "application/json; charset=UTF-8",
            "X-Timestamp": timestamp,
            "X-API-KEY": api_key,
            "X-Customer": str(customer_id),
            "X-Signature": signature,
        },
    )
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            with request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except error.HTTPError as e:
            last_err = e
            if e.code == 429 and attempt < retries:
                time.sleep(2 * attempt)
                continue
            raise RuntimeError(
                f"검색광고 API 오류 {e.code}: {e.read().decode('utf-8', 'ignore')}"
            ) from e
        except error.URLError as e:
            last_err = e
            time.sleep(2 * attempt)
    raise RuntimeError(f"검색광고 API 호출 실패: {last_err}")


def parse_qc(value):
    """monthlyPcQcCnt/monthlyMobileQcCnt는 "<10"으로 올 수 있어 숫자로 정규화한다."""
    if value is None:
        return 0
    text = str(value).strip()
    if text in ("", "0", "< 10", "<10"):
        return 5 if "10" in text else 0
    try:
        return int(float(text))
    except ValueError:
        return 0


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    return [i["keyword"] for i in cfg["items"]]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--keyword", help="이 키워드만 수집 (디버깅용)")
    args = parser.parse_args()

    load_env_file()
    api_key = os.environ.get("NAVER_AD_API_KEY")
    secret_key = os.environ.get("NAVER_AD_SECRET_KEY")
    customer_id = os.environ.get("NAVER_AD_CUSTOMER_ID")
    if not api_key or not secret_key or not customer_id:
        print(
            "ERROR: NAVER_AD_API_KEY / NAVER_AD_SECRET_KEY / NAVER_AD_CUSTOMER_ID "
            "환경변수가 필요합니다 (searchad.naver.com에서 발급).",
            file=sys.stderr,
        )
        sys.exit(1)

    keywords = load_config()
    if args.keyword:
        keywords = [k for k in keywords if k == args.keyword]
        if not keywords:
            print(f"ERROR: '{args.keyword}' 키워드를 custom_keywords_config.json 에서 찾을 수 없습니다.", file=sys.stderr)
            sys.exit(1)

    existing = {}
    if OUTPUT_PATH.exists():
        existing = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))

    print(f"[fetch_related_keywords] {len(keywords)}개 키워드 관련검색어 수집 시작")

    result = dict(existing)
    succeeded, failed = 0, []
    for kw in keywords:
        try:
            items = call_keywordstool(api_key, secret_key, customer_id, kw)
            ranked = sorted(
                (
                    {
                        "keyword": it["relKeyword"],
                        "pc": parse_qc(it.get("monthlyPcQcCnt")),
                        "mobile": parse_qc(it.get("monthlyMobileQcCnt")),
                    }
                    for it in items
                ),
                key=lambda x: x["pc"] + x["mobile"],
                reverse=True,
            )[:TOP_N]
            for r in ranked:
                r["total"] = r["pc"] + r["mobile"]
            result[kw] = ranked
            succeeded += 1
        except Exception as e:
            print(f"WARN: '{kw}' 수집 실패, 이전 값 유지: {e}", file=sys.stderr)
            failed.append(kw)
        time.sleep(0.3)

    if succeeded == 0:
        print("ERROR: 모든 키워드 수집에 실패했습니다. 기존 데이터를 유지하고 종료합니다.", file=sys.stderr)
        sys.exit(1)

    OUTPUT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[fetch_related_keywords] {OUTPUT_PATH} 갱신 완료 ({succeeded}개 성공, {len(failed)}개 실패)")

    meta_out = {}
    if META_PATH.exists():
        meta_out = json.loads(META_PATH.read_text(encoding="utf-8"))
    meta_out["relatedKeywordsUpdated"] = datetime.now(KST).isoformat()
    META_PATH.write_text(json.dumps(meta_out, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
