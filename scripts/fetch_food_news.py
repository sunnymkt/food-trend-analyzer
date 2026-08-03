#!/usr/bin/env python3
"""
foodnews.co.kr(식품저널), foodtoday.or.kr(푸드투데이) 두 식품 전문지를 직접 크롤링해
data/news.json 을 생성한다. (예전 버전은 네이버 뉴스 검색 API를 썼지만, 검색어로 걸리는
무관/광고성 기사가 많아 식품 전문지 2곳만 직접 긁어오는 방식으로 교체했다.)

각 사이트의 "전체기사" 목록 페이지에서 최근 기사 링크를 모은 뒤, 기사 페이지의
og:title / og:description 메타태그로 제목·요약을 뽑는다. 그 다음 이미 있던 필터
(data/news_filters.json)로 다음 두 카테고리로 분류한다:

  1. product    — 추적 키워드(data/keywords_config.json)가 제목/요약에 매칭되는 기사
  2. regulatory — 식품 법규 키워드 + 개정/입법 신호 단어가 둘 다 매칭되는 기사

사용법:
  python scripts/fetch_food_news.py
  python scripts/fetch_food_news.py --site foodnews   # 한 사이트만 (디버깅용)
  python scripts/fetch_food_news.py --max-pages 1      # 사이트별 목록 1페이지만
"""

import argparse
import html
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
KEYWORDS_CONFIG_PATH = DATA_DIR / "keywords_config.json"
NEWS_FILTERS_PATH = DATA_DIR / "news_filters.json"
OUTPUT_PATH = DATA_DIR / "news.json"
META_PATH = DATA_DIR / "meta.json"

USER_AGENT = (
    "Mozilla/5.0 (compatible; FoodTrendAI-Bot/1.0; "
    "NongHyup Food internal trend dashboard collector; contact: sunnymkt)"
)
REQUEST_TIMEOUT = 30
REQUEST_RETRIES = 3   # 타임아웃/일시적 오류 시 재시도 횟수
REQUEST_RETRY_DELAY = 3  # 재시도 사이 대기(초)
REQUEST_DELAY = 0.4  # 요청 사이 간격(초) — 대상 서버에 부담을 주지 않기 위함
MAX_PER_CATEGORY = {"product": 40, "regulatory": 24}
KST = timezone(timedelta(hours=9))
TAG_RE = re.compile(r"<[^>]+>")
WHITESPACE_RE = re.compile(r"\s+")

DEDUP_DESC_COMPARE_LEN = 100
DEDUP_DESC_RATIO = 0.55
DEDUP_TITLE_RATIO = 0.6

DATE_PATTERNS = [
    re.compile(r"(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})\D+(\d{1,2}):(\d{2})(?::(\d{2}))?"),
    re.compile(r"(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})"),
]

SITES = [
    {
        "name": "foodnews",
        "list_url_tpl": "https://www.foodnews.co.kr/news/articleList.html?view_type=sm&page={page}",
        "id_pattern": re.compile(r"articleView\.html\?idxno=(\d+)"),
        "article_url_tpl": "https://www.foodnews.co.kr/news/articleView.html?idxno={id}",
    },
    {
        "name": "foodtoday",
        "list_url_tpl": "https://www.foodtoday.or.kr/news/article_list_all.html?page={page}",
        "id_pattern": re.compile(r"article\.html\?no=(\d+)"),
        "article_url_tpl": "https://www.foodtoday.or.kr/news/article.html?no={id}",
    },
]


def load_keywords_config():
    with open(KEYWORDS_CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    return list(cfg["keywords"].keys())


def load_exclude_keywords():
    if not NEWS_FILTERS_PATH.exists():
        return [], []
    with open(NEWS_FILTERS_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    combined = (
        list(cfg.get("excludeKeywords", []))
        + list(cfg.get("sensitiveExcludeKeywords", []))
        + list(cfg.get("offTopicIndustryKeywords", []))
    )
    title_tags = cfg.get("excludeTitleTags", [])
    return combined, title_tags


def load_regulatory_scope():
    if not NEWS_FILTERS_PATH.exists():
        return [], []
    with open(NEWS_FILTERS_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    return (cfg.get("regulatoryRequireFoodLawKeywords", []),
            cfg.get("regulatoryRequireLegislativeSignals", []))


def load_product_launch_signals():
    if not NEWS_FILTERS_PATH.exists():
        return []
    with open(NEWS_FILTERS_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    return cfg.get("productLaunchSignals", [])


def clean_text(s):
    return html.unescape(TAG_RE.sub("", s or "")).strip()


def has_word_start_match(text, keyword):
    pattern = re.compile(r"(?<![가-힣0-9A-Za-z])" + re.escape(keyword))
    return bool(pattern.search(text))


def is_relevant(title, description, keyword, exclude_keywords, exclude_title_tags,
                 regulatory_scope=None):
    text = f"{title} {description}"
    if keyword and not has_word_start_match(text, keyword):
        return False
    if any(bad in text for bad in exclude_keywords):
        return False
    if any(tag in title for tag in exclude_title_tags):
        return False
    if regulatory_scope is not None:
        food_law_kw, legislative_kw = regulatory_scope
        has_food_law = any(kw in text for kw in food_law_kw)
        has_legislative = any(kw in text for kw in legislative_kw)
        if not (has_food_law or (has_legislative and "식품" in text)):
            return False
    return True


def fetch_url(url):
    last_err = None
    for attempt in range(1, REQUEST_RETRIES + 1):
        try:
            resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            if not resp.encoding or resp.encoding.lower() == "iso-8859-1":
                resp.encoding = resp.apparent_encoding or "utf-8"
            return resp.text
        except Exception as e:
            last_err = e
            if attempt < REQUEST_RETRIES:
                print(f"    (재시도 {attempt}/{REQUEST_RETRIES} 실패: {e} — "
                      f"{REQUEST_RETRY_DELAY}초 후 재시도)", file=sys.stderr)
                time.sleep(REQUEST_RETRY_DELAY)
    raise last_err


def extract_article_ids(html_text, id_pattern):
    seen = set()
    ids = []
    for m in id_pattern.finditer(html_text):
        i = m.group(1)
        if i not in seen:
            seen.add(i)
            ids.append(i)
    return ids


def meta_content(soup, prop):
    tag = soup.find("meta", attrs={"property": prop}) or soup.find("meta", attrs={"name": prop})
    return (tag.get("content") or "").strip() if tag else ""


def extract_pubdate_iso(soup):
    for prop in ("article:published_time", "og:regDate", "og:published_time"):
        val = meta_content(soup, prop)
        if not val:
            continue
        for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S", "%Y.%m.%d %H:%M:%S", "%Y%m%d%H%M%S"):
            try:
                dt = datetime.strptime(val, fmt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=KST)
                return dt.isoformat()
            except ValueError:
                continue

    text = soup.get_text(" ", strip=True)
    idx = text.find("등록")
    search_windows = [text[idx: idx + 40]] if idx >= 0 else []
    search_windows.append(text[:300])
    for window in search_windows:
        for pat in DATE_PATTERNS:
            m = pat.search(window)
            if not m:
                continue
            g = m.groups()
            try:
                year, month, day = int(g[0]), int(g[1]), int(g[2])
                hour = int(g[3]) if len(g) > 3 and g[3] else 0
                minute = int(g[4]) if len(g) > 4 and g[4] else 0
                second = int(g[5]) if len(g) > 5 and g[5] else 0
                return datetime(year, month, day, hour, minute, second, tzinfo=KST).isoformat()
            except ValueError:
                continue
    return None


def fetch_article(url):
    try:
        html_text = fetch_url(url)
    except Exception as e:
        return None, str(e)

    soup = BeautifulSoup(html_text, "html.parser")
    raw_title = meta_content(soup, "og:title")
    if not raw_title and soup.title and soup.title.string:
        raw_title = soup.title.string
    title = clean_text(raw_title)
    description = clean_text(meta_content(soup, "og:description"))
    pubdate = extract_pubdate_iso(soup)

    if not title:
        return None, "제목을 추출하지 못함 (og:title 없음)"
    return {"title": title, "description": description, "link": url, "pubDate": pubdate}, None


def classify_article(title, description, product_keywords, exclude_keywords, exclude_title_tags,
                      regulatory_scope, product_launch_signals=None):
    if not is_relevant(title, description, None, exclude_keywords, exclude_title_tags):
        return None

    text = f"{title} {description}"

    if is_relevant(title, description, None, exclude_keywords, exclude_title_tags, regulatory_scope):
        food_law_kw, _ = regulatory_scope
        matched = next((kw for kw in food_law_kw if kw in text), "식품법규")
        return "regulatory", matched

    for kw in product_keywords:
        if has_word_start_match(text, kw):
            return "product", kw

    if product_launch_signals and any(sig in text for sig in product_launch_signals):
        return "product", "신제품"

    return None


def sort_key(a):
    try:
        return datetime.fromisoformat(a["pubDate"])
    except (TypeError, ValueError):
        return datetime.min.replace(tzinfo=KST)


def _norm(s):
    return WHITESPACE_RE.sub("", s or "")


def dedupe_articles(articles):
    kept = []
    kept_desc = []
    kept_titles = []
    removed = 0
    for art in articles:
        title_norm = _norm(art.get("title"))
        desc_norm = _norm(art.get("description"))[:DEDUP_DESC_COMPARE_LEN]

        is_dup = False
        if desc_norm:
            for kd in kept_desc:
                if kd and SequenceMatcher(None, desc_norm, kd).ratio() >= DEDUP_DESC_RATIO:
                    is_dup = True
                    break
        if not is_dup:
            for kt in kept_titles:
                if SequenceMatcher(None, title_norm, kt).ratio() >= DEDUP_TITLE_RATIO:
                    is_dup = True
                    break

        if is_dup:
            removed += 1
            continue

        kept.append(art)
        kept_desc.append(desc_norm)
        kept_titles.append(title_norm)

    if removed:
        print(f"[fetch_food_news] 유사 중복 기사 {removed}건 제거")
    return kept


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", choices=[s["name"] for s in SITES],
                         help="이 사이트만 수집 (디버깅용)")
    parser.add_argument("--max-pages", type=int, default=5,
                         help="사이트별 목록을 몇 페이지까지 훑을지 (기본 5)")
    args = parser.parse_args()

    product_keywords = load_keywords_config()
    exclude_keywords, exclude_title_tags = load_exclude_keywords()
    regulatory_scope = load_regulatory_scope()
    product_launch_signals = load_product_launch_signals()

    sites = SITES if not args.site else [s for s in SITES if s["name"] == args.site]

    product_links = {}
    regulatory_links = {}
    failed = []
    total_fetched = 0

    for site in sites:
        ids = []
        for page in range(1, args.max_pages + 1):
            list_url = site["list_url_tpl"].format(page=page)
            print(f"[fetch_food_news] ({site['name']}) 목록 p{page} 가져오는 중… {list_url}")
            try:
                html_text = fetch_url(list_url)
            except Exception as e:
                print(f"  -> 목록 페이지 실패: {e}", file=sys.stderr)
                failed.append(f"{site['name']}:list_p{page}")
                continue
            ids.extend(extract_article_ids(html_text, site["id_pattern"]))
            time.sleep(REQUEST_DELAY)

        seen = set()
        ordered_ids = [i for i in ids if not (i in seen or seen.add(i))]
        print(f"[fetch_food_news] ({site['name']}) 기사 링크 {len(ordered_ids)}건 발견, 본문 수집 시작")

        for aid in ordered_ids:
            url = site["article_url_tpl"].format(id=aid)
            art, err = fetch_article(url)
            time.sleep(REQUEST_DELAY)
            if err:
                print(f"  -> 실패 ({url}): {err}", file=sys.stderr)
                failed.append(f"{site['name']}:{aid}")
                continue

            total_fetched += 1
            result = classify_article(art["title"], art["description"], product_keywords,
                                       exclude_keywords, exclude_title_tags, regulatory_scope,
                                       product_launch_signals)
            if not result:
                continue
            category, tag = result

            record = {
                "title": art["title"],
                "description": art["description"],
                "link": art["link"],
                "pubDate": art["pubDate"] or datetime.now(KST).isoformat(),
                "keyword": tag,
                "category": category,
            }
            (product_links if category == "product" else regulatory_links).setdefault(url, record)

    if not product_links and not regulatory_links:
        print("ERROR: 수집된 기사가 0건입니다. 기존 data/news.json 을 유지하고 종료합니다.", file=sys.stderr)
        sys.exit(1)

    product_articles = sorted(product_links.values(), key=sort_key, reverse=True)
    product_articles = dedupe_articles(product_articles)[:MAX_PER_CATEGORY["product"]]
    regulatory_articles = sorted(regulatory_links.values(), key=sort_key, reverse=True)
    regulatory_articles = dedupe_articles(regulatory_articles)[:MAX_PER_CATEGORY["regulatory"]]
    articles = product_articles + regulatory_articles

    OUTPUT_PATH.write_text(json.dumps(articles, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[fetch_food_news] {OUTPUT_PATH} 갱신 완료 "
          f"(신제품 {len(product_articles)}건, 법규 {len(regulatory_articles)}건, "
          f"전체 조회 {total_fetched}건, 실패 {len(failed)}건: {failed})")

    meta = {}
    if META_PATH.exists():
        meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    meta["newsUpdated"] = datetime.now(KST).isoformat()
    META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    if failed:
        print(f"경고: 일부 항목 수집 실패 - {failed}", file=sys.stderr)


if __name__ == "__main__":
    main()
