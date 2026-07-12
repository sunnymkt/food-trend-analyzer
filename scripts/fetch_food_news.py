#!/usr/bin/env python3
"""
네이버 뉴스 검색 API로 두 종류의 기사를 모아 data/news.json 을 생성한다.

  1. product    — 추적 키워드별 "OO 신제품" 뉴스 (data/keywords_config.json)
  2. regulatory — 식품 법규/제도 변화 뉴스 (data/regulatory_topics.json)

필요 환경변수는 fetch_naver_trends.py 와 동일한 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET.
단, 이 API는 네이버 개발자센터에서 해당 애플리케이션에 "검색" 상품이 별도로
추가되어 있어야 한다. 데이터랩(검색어트렌드)만 등록되어 있다면 401/403이 날 수 있다.
등록 방법: https://developers.naver.com/apps 에서 앱 선택 → API 설정 → "검색" 추가.

사용법:
  python scripts/fetch_food_news.py
  python scripts/fetch_food_news.py --keyword 흑임자   # product 카테고리 한 키워드만
  python scripts/fetch_food_news.py --topic 소비기한   # regulatory 카테고리 한 주제만
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
REGULATORY_TOPICS_PATH = DATA_DIR / "regulatory_topics.json"
NEWS_FILTERS_PATH = DATA_DIR / "news_filters.json"
OUTPUT_PATH = DATA_DIR / "news.json"
META_PATH = DATA_DIR / "meta.json"

NAVER_NEWS_URL = "https://openapi.naver.com/v1/search/news.json"
DISPLAY_PER_QUERY = 5
MAX_PER_CATEGORY = {"product": 40, "regulatory": 24}
KST = timezone(timedelta(hours=9))
TAG_RE = re.compile(r"<[^>]+>")


def load_keywords_config():
    with open(KEYWORDS_CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    return list(cfg["keywords"].keys())


def load_regulatory_topics():
    with open(REGULATORY_TOPICS_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    return cfg["topics"]  # [{"label": ..., "query": ...}, ...]


def load_exclude_keywords():
    if not NEWS_FILTERS_PATH.exists():
        return []
    with open(NEWS_FILTERS_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    return cfg.get("excludeKeywords", [])


def clean_text(s):
    return html.unescape(TAG_RE.sub("", s or "")).strip()


def has_word_start_match(text, keyword):
    """keyword가 다른 한글 단어의 일부로 우연히 포함된 경우(예: '마라'가 '막스마라'에
    포함)를 걸러내기 위해, 다른 한글/영숫자 글자로 시작하지 않는 위치에서 매칭되는지
    확인한다. '마라탕'처럼 keyword 뒤에 글자가 더 붙는 복합어는 정상적으로 통과한다."""
    pattern = re.compile(r"(?<![가-힣0-9A-Za-z])" + re.escape(keyword))
    return bool(pattern.search(text))


def is_relevant(title, description, keyword, exclude_keywords):
    text = f"{title} {description}"
    if keyword and not has_word_start_match(text, keyword):
        return False
    if any(bad in text for bad in exclude_keywords):
        return False
    return True


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


def fetch_queries(client_id, client_secret, queries, category, articles_by_link, failed,
                   exclude_keywords, check_word_boundary):
    """queries: [(tag, query_string), ...]. articles_by_link 에 직접 채워 넣는다.
    check_word_boundary=True 이면 tag(키워드)가 다른 단어에 우연히 포함된 기사를
    걸러낸다 (product 카테고리용. regulatory는 tag가 주제 라벨이라 해당 없음)."""
    filtered_out = 0
    for tag, query in queries:
        print(f"[fetch_food_news] ({category}) '{query}' 검색 중…")
        try:
            resp = call_news_api(client_id, client_secret, query, DISPLAY_PER_QUERY)
        except Exception as e:
            print(f"  -> 실패: {e}", file=sys.stderr)
            failed.append(f"{category}:{tag}")
            continue

        for item in resp.get("items", []):
            link = item.get("originallink") or item.get("link")
            if not link or link in articles_by_link:
                continue
            title = clean_text(item.get("title"))
            description = clean_text(item.get("description"))
            if not is_relevant(title, description, tag if check_word_boundary else None, exclude_keywords):
                filtered_out += 1
                continue
            articles_by_link[link] = {
                "title": title,
                "description": description,
                "link": link,
                "pubDate": item.get("pubDate"),
                "keyword": tag,
                "category": category,
            }
        time.sleep(0.3)
    if filtered_out:
        print(f"[fetch_food_news] ({category}) 관련 없어 걸러낸 기사 {filtered_out}건")


def sort_key(a):
    try:
        return datetime.strptime(a["pubDate"], "%a, %d %b %Y %H:%M:%S %z")
    except (TypeError, ValueError):
        return datetime.min.replace(tzinfo=KST)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--keyword", help="product 카테고리에서 이 키워드만 수집 (디버깅용)")
    parser.add_argument("--topic", help="regulatory 카테고리에서 이 주제(label)만 수집 (디버깅용)")
    args = parser.parse_args()

    load_env_file()
    client_id = os.environ.get("NAVER_CLIENT_ID")
    client_secret = os.environ.get("NAVER_CLIENT_SECRET")
    if not client_id or not client_secret:
        print("ERROR: NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 필요합니다.", file=sys.stderr)
        sys.exit(1)

    product_keywords = [args.keyword] if args.keyword else load_keywords_config()
    reg_topics_all = load_regulatory_topics()
    if args.topic:
        reg_topics_all = [t for t in reg_topics_all if t["label"] == args.topic]

    product_queries = [(kw, f"{kw} 신제품") for kw in product_keywords]
    regulatory_queries = [(t["label"], t["query"]) for t in reg_topics_all]
    exclude_keywords = load_exclude_keywords()

    failed = []

    # 카테고리별로 따로 모아서 각자 상한을 적용한다 (한쪽이 다른 쪽을 밀어내지 않도록).
    product_links = {}
    fetch_queries(client_id, client_secret, product_queries, "product", product_links, failed,
                  exclude_keywords, check_word_boundary=True)
    regulatory_links = {}
    fetch_queries(client_id, client_secret, regulatory_queries, "regulatory", regulatory_links, failed,
                  exclude_keywords, check_word_boundary=False)

    if not product_links and not regulatory_links:
        print("ERROR: 수집된 기사가 0건입니다. 기존 data/news.json 을 유지하고 종료합니다.", file=sys.stderr)
        sys.exit(1)

    product_articles = sorted(product_links.values(), key=sort_key, reverse=True)[:MAX_PER_CATEGORY["product"]]
    regulatory_articles = sorted(regulatory_links.values(), key=sort_key, reverse=True)[:MAX_PER_CATEGORY["regulatory"]]
    articles = product_articles + regulatory_articles

    OUTPUT_PATH.write_text(json.dumps(articles, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[fetch_food_news] {OUTPUT_PATH} 갱신 완료 "
          f"(신제품 {len(product_articles)}건, 법규 {len(regulatory_articles)}건, "
          f"실패 {len(failed)}건: {failed})")

    meta = {}
    if META_PATH.exists():
        meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    meta["newsUpdated"] = datetime.now(KST).isoformat()
    META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    if failed:
        print(f"경고: 일부 항목 수집 실패 - {failed}", file=sys.stderr)


if __name__ == "__main__":
    main()
