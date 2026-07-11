#!/usr/bin/env python3
"""
마켓컬리 검색결과 페이지를 트렌드 키워드별로 순회하며 신제품 후보를 수집해
data/new_products.json 을 생성한다.

- 쿠팡은 포함하지 않는다: 단순 HTTP 요청이 403으로 차단되며, 이를 우회하는 것은
  봇탐지 우회에 해당해 시도하지 않는다.
- 마켓컬리는 클라이언트 렌더링(Next.js) 사이트라 Playwright로 실제 페이지를 렌더링해야
  상품 데이터를 얻을 수 있다.
- 개인 트렌드 리서치 목적의 저빈도(하루 1회) · 소량(키워드당 최대 N개) 수집만 수행한다.
- 페이지 구조는 해시된 CSS 클래스(css-xxxxx)를 쓰므로 배포마다 바뀔 수 있다. 가능한 한
  안정적으로 보이는 시맨틱 클래스(review-count, price-number, sales-price 등)와
  DOM 구조(태그 순서)에 의존한다. 사이트 구조가 바뀌면 extract_products_js 를
  다시 확인해서 고쳐야 할 수 있다.

사용법:
  python scripts/crawl_kurly_products.py
  python scripts/crawl_kurly_products.py --keyword 흑임자   # 특정 키워드만 테스트
  HEADLESS=0 python scripts/crawl_kurly_products.py         # 브라우저 창 띄워서 디버깅
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
KEYWORDS_CONFIG_PATH = DATA_DIR / "keywords_config.json"
CATEGORIES_PATH = DATA_DIR / "categories.json"
OUTPUT_PATH = DATA_DIR / "new_products.json"
HISTORY_PATH = DATA_DIR / "product_history.json"
META_PATH = DATA_DIR / "meta.json"
HISTORY_WINDOW_DAYS = 30

TOP_N_PER_KEYWORD = 4
NAV_TIMEOUT_MS = 20000
CARD_WAIT_TIMEOUT_MS = 12000
DELAY_BETWEEN_KEYWORDS = 2.5  # 초. 저빈도 수집을 위한 예의상 지연.
KST = timezone(timedelta(hours=9))

# 상품명/설명에 포함된 단어로 카테고리를 추정하기 위한 힌트.
# 검색에 사용한 키워드의 기본 카테고리보다 우선 적용된다.
# 순서 중요: 더 구체적인 카테고리를 먼저 검사하고, 폭넓은 "간편식"류 힌트를
# 가장 마지막에 둔다. 짧고 모호한 한 글자짜리 힌트(예: "국")는 다른 단어 속
# 음절과 우연히 겹쳐 오탐하기 쉬우므로 넣지 않는다.
CATEGORY_HINTS = [
    ("베이커리", ["빵", "케이크", "크로플", "베이글", "식빵", "브레드", "바게트"]),
    ("빙과", ["아이스크림", "빙수", "설레임", "샤베트", "아이스바"]),
    ("유제품", ["우유", "요거트", "치즈", "그릭요거트"]),
    ("건강식품", ["홍삼", "영양제", "프로틴", "젤리스틱", "건강기능"]),
    ("라면", ["라면", "볶음면", "우동", "국수"]),
    ("제과", ["쿠키", "파이", "초코파이", "웨하스"]),
    ("스낵", ["스낵", "크래커", "뻥튀기", "팝콘", "과자"]),
    ("음료", ["음료", "주스", "두유", "콩물", "탄산", "라떼", "에이드", "녹차", "홍차", "밀크티"]),
    ("간편식", ["HMR", "밀키트", "찌개", "만두", "덮밥", "컵밥", "카레", "즉석국", "즉석밥"]),
]

EXTRACT_PRODUCTS_JS = """
() => {
  const anchors = Array.from(document.querySelectorAll('a[href*="/goods/"]'));
  const seen = new Set();
  const out = [];
  for (const a of anchors) {
    const href = a.getAttribute('href');
    if (!href || seen.has(href)) continue;
    const info = a.children[2];
    if (!info) continue;
    const spans = info.querySelectorAll(':scope > span');
    const nameEl = spans.length > 1 ? spans[1] : spans[0];
    const descEl = info.querySelector('p');
    const priceEl = info.querySelector('.sales-price .price-number, .price-number');
    if (!nameEl || !priceEl) continue;
    seen.add(href);
    out.push({
      href,
      name: nameEl.textContent.trim(),
      description: descEl ? descEl.textContent.trim() : '',
      price: priceEl.textContent.trim(),
    });
  }
  return out;
}
"""


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def guess_category(name, description, fallback):
    text = f"{name} {description}"
    for category, hints in CATEGORY_HINTS:
        if any(h in text for h in hints):
            return category
    return fallback


def parse_brand_name(raw_name):
    m = re.match(r"^\[(.+?)\]\s*(.+)$", raw_name)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return "-", raw_name.strip()


def primary_category(compound_category):
    return compound_category.split("/")[0]


def crawl_keyword(page, keyword, base_url="https://www.kurly.com/search"):
    url = f"{base_url}?sword={quote(keyword)}"
    page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
    page.wait_for_selector('a[href*="/goods/"]', timeout=CARD_WAIT_TIMEOUT_MS)

    # 가능하면 신상품순으로 정렬한다. 사이트 구조가 바뀌어 탭을 못 찾아도
    # 크롤링 자체는 계속 진행한다(기본 정렬 결과를 사용).
    try:
        sort_tab = page.get_by_text("신상품순", exact=True)
        sort_tab.click(timeout=3000)
        page.wait_for_timeout(800)
    except Exception:
        pass

    raw_items = page.evaluate(EXTRACT_PRODUCTS_JS)
    return raw_items[:TOP_N_PER_KEYWORD]


def build_product(raw, keyword, kw_meta, category_emoji, today_str):
    brand, name = parse_brand_name(raw["name"])
    fallback_category = primary_category(kw_meta["category"]) if kw_meta["category"] != "전체" else "간편식"
    category = guess_category(name, raw.get("description", ""), fallback_category)
    goods_id = raw["href"].rstrip("/").split("/")[-1]
    price_num = raw["price"].replace(",", "")
    price_str = f"{raw['price']}원" if price_num.isdigit() else raw["price"]

    return {
        "id": f"kurly-{goods_id}",
        "emoji": category_emoji.get(category, "🍽️"),
        "name": name,
        "brand": brand,
        "category": category,
        "keywords": [keyword],
        "launchDate": today_str,
        "channel": "마켓컬리",
        "origin": "-",
        "price": price_str,
        "rating": None,
        "source": "kurly-crawler",
        "url": f"https://www.kurly.com{raw['href']}",
    }


def update_history(products, today_str):
    """오늘 발견한 상품들을 누적 히스토리에 병합한다.

    같은 id가 이미 있으면 firstSeenDate는 유지하고 나머지 필드(가격 등)와
    lastSeenDate만 갱신한다. 처음 보는 id면 firstSeenDate=lastSeenDate=오늘로
    추가한다. HISTORY_WINDOW_DAYS보다 오래된(=lastSeenDate 기준) 항목은
    파일이 무한히 커지지 않도록 정리한다.

    이 히스토리는 "브랜드별 신제품 출시속도"와 "키워드 기회 매트릭스"의
    누적 신제품 수 계산에 쓰인다.
    """
    history = {}
    if HISTORY_PATH.exists():
        try:
            history = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            history = {}

    for p in products:
        pid = p["id"]
        entry = dict(p)
        if pid in history:
            entry["firstSeenDate"] = history[pid].get("firstSeenDate", today_str)
        else:
            entry["firstSeenDate"] = today_str
        entry["lastSeenDate"] = today_str
        history[pid] = entry

    cutoff = (datetime.now(KST).date() - timedelta(days=HISTORY_WINDOW_DAYS)).isoformat()
    history = {pid: e for pid, e in history.items() if e.get("lastSeenDate", today_str) >= cutoff}

    HISTORY_PATH.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    return history


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--keyword", help="이 키워드만 크롤링 (디버깅용)")
    args = parser.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: playwright가 설치되어 있지 않습니다. `pip install playwright && playwright install chromium`",
              file=sys.stderr)
        sys.exit(1)

    keywords_cfg = load_json(KEYWORDS_CONFIG_PATH)["keywords"]
    categories_cfg = load_json(CATEGORIES_PATH)["categories"]
    category_emoji = {name: meta["emoji"] for name, meta in categories_cfg.items()}

    keyword_list = [args.keyword] if args.keyword else list(keywords_cfg.keys())
    today_str = datetime.now(KST).date().isoformat()
    headless = os.environ.get("HEADLESS", "1") != "0"

    products_by_href = {}
    failed_keywords = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="ko-KR",
        )
        page = context.new_page()

        for keyword in keyword_list:
            print(f"[crawl_kurly_products] '{keyword}' 검색 중…")
            try:
                raw_items = crawl_keyword(page, keyword)
            except Exception as e:
                print(f"  -> 실패: {e}", file=sys.stderr)
                failed_keywords.append(keyword)
                continue

            kw_meta = keywords_cfg[keyword]
            for raw in raw_items:
                if raw["href"] in products_by_href:
                    if keyword not in products_by_href[raw["href"]]["keywords"]:
                        products_by_href[raw["href"]]["keywords"].append(keyword)
                    continue
                product = build_product(raw, keyword, kw_meta, category_emoji, today_str)
                products_by_href[raw["href"]] = product

            print(f"  -> {len(raw_items)}건 수집")
            time.sleep(DELAY_BETWEEN_KEYWORDS)

        browser.close()

    products = list(products_by_href.values())

    if not products:
        print("ERROR: 수집된 상품이 0건입니다 (사이트 구조 변경 또는 차단 가능성). "
              "기존 data/new_products.json 을 유지하고 종료합니다.", file=sys.stderr)
        sys.exit(1)

    OUTPUT_PATH.write_text(json.dumps(products, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[crawl_kurly_products] {OUTPUT_PATH} 갱신 완료 ({len(products)}건, "
          f"실패 키워드 {len(failed_keywords)}개: {failed_keywords})")

    history = update_history(products, today_str)
    print(f"[crawl_kurly_products] {HISTORY_PATH} 갱신 완료 (누적 {len(history)}건, "
          f"최근 {HISTORY_WINDOW_DAYS}일 기준)")

    meta = {}
    if META_PATH.exists():
        meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    meta["lastUpdated"] = datetime.now(KST).isoformat()
    meta["productSource"] = "kurly-search-crawler"
    meta.pop("note", None)
    META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    if failed_keywords:
        # 일부 실패는 있지만 최소 1건은 수집했으므로 종료 코드는 0으로 유지한다.
        print(f"경고: 일부 키워드 수집 실패 - {failed_keywords}", file=sys.stderr)


if __name__ == "__main__":
    main()
