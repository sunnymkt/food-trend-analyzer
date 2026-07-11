#!/usr/bin/env python3
"""
네이버 뉴스 검색 API로 키워드별 "OO 신제품" 관련 기사를 모아
data/news.json 을 생성한다.

필요 환경변수는 fetch_naver_trends.py 와 동일한 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET.
단, 이 API는 네이버 개발자센터에서 해당 애플리케이션에 "검색" 상품이 별도로
추가되어 있어야 한다. 데이터랩(검색어트렌드)만 등록되어 있다면 401/403이 날 수 있다.
등록 방법: https://developers.naver.com/apps 에서 앱 선택 → API 설정 → "검색" 추가.

사용법:
  python scripts/fetch_food_news.py
  python scripts/fetch_food_news.py --keyword 흑임자   # 특정 키워드만 테스트
"""

import argparse
import html
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib import request, error, parse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _env import load_env_file  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
KEYWORDS_CONFIG_PATH = DATA_DIR / "keywords_config.json"
OUTPUT_PATH = DATA_DIR / "news.json"
META_PATH = DATA_DIR / "meta.json"

NAVER_NEWS_URL = "https://openapi.naver.com/v1/search/news.json"
DISPLAY_PER_KEYWORD = 5
MAX_TOTAL = 40
KST = timezone(timedelta(hours=9))
TAG_RE = re.compile(r"<[^>]+>")


def load_keywords_config():
    with open(KEYWORDS_CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    return cfg["keywords"]


def clean_text(s):
    return html.unescape(TAG_RE.sub("", s or "")).strip()


def call_news_api(client_id, client_secret, query, display, retries=3):
    qs = parse.urlencode({"query": query, "display": display, "sort": "date"})
    req = request.Request(
        f"{NAVER_NEWS_URL}?{qs}",
        headers={
            "X-Naver-Client-Id": client_id,
            "X-Naver-Client-Secret": client_secret,
        },
    )
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            with request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except error.HTTPError as e:
            body = e.read().decode("utf-8", "ignore")
            if e.code in (401, 403):
                raise RuntimeError(
                    f"네이버 뉴스 검색 API 오류 {e.code}: {body}\n"
                    "이 애플리케이션에 '검색' API가 등록되어 있는지 확인하세요 "
                    "(https://developers.naver.com/apps → 앱 선택 → API 설정 → 검색 추가)."
                ) from e
            last_err = e
            if e.code == 429 and attempt < retries:
                time.sleep(2 * attempt)
                continue
            raise RuntimeError(f"네이버 뉴스 검색 API 오류 {e.code}: {body}") from e
        except error.URLError as e:
            last_err = e
            time.sleep(2 * attempt)
    raise RuntimeError(f"네이버 뉴스 검색 API 호출 실패: {last_err}")


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

    keywords_cfg = load_keywords_config()
    keyword_list = [args.keyword] if args.keyword else list(keywords_cfg.keys())

    articles_by_link = {}
    failed_keywords = []

    for keyword in keyword_list:
        query = f"{keyword} 신제품"
        print(f"[fetch_food_news] '{query}' 검색 중…")
        try:
            resp = call_news_api(client_id, client_secret, query, DISPLAY_PER_KEYWORD)
        except Exception as e:
            print(f"  -> 실패: {e}", file=sys.stderr)
            failed_keywords.append(keyword)
            continue

        for item in resp.get("items", []):
            link = item.get("originallink") or item.get("link")
            if not link or link in articles_by_link:
                continue
            articles_by_link[link] = {
                "title": clean_text(item.get("title")),
                "description": clean_text(item.get("description")),
                "link": link,
                "pubDate": item.get("pubDate"),
                "keyword": keyword,
            }
        time.sleep(0.3)

    if not articles_by_link:
        print("ERROR: 수집된 기사가 0건입니다. 기존 data/news.json 을 유지하고 종료합니다.", file=sys.stderr)
        sys.exit(1)

    def sort_key(a):
        try:
            return datetime.strptime(a["pubDate"], "%a, %d %b %Y %H:%M:%S %z")
        except (TypeError, ValueError):
            return datetime.min.replace(tzinfo=KST)

    articles = sorted(articles_by_link.values(), key=sort_key, reverse=True)[:MAX_TOTAL]

    OUTPUT_PATH.write_text(json.dumps(articles, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[fetch_food_news] {OUTPUT_PATH} 갱신 완료 ({len(articles)}건, "
          f"실패 키워드 {len(failed_keywords)}개: {failed_keywords})")

    meta = {}
    if META_PATH.exists():
        meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    meta["newsUpdated"] = datetime.now(KST).isoformat()
    META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    if failed_keywords:
        print(f"경고: 일부 키워드 수집 실패 - {failed_keywords}", file=sys.stderr)


if __name__ == "__main__":
    main()
