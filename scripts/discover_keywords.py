#!/usr/bin/env python3
"""
트렌드 키워드 자동 발굴 — data/keywords_config.json 의 추적 목록을 주 1회 갱신한다.

왜 필요한가:
  예전에는 keywords_config.json 에 처음 넣어둔 12개 키워드만 계속 추적해서,
  대시보드의 '급상승 키워드'가 매번 같은 이름들 사이에서 순서만 바뀌었다.
  네이버 데이터랩 검색어트렌드 API는 '넣어준 키워드'의 추이만 돌려주고 새로 뜨는
  검색어를 알려주지 않기 때문에, 후보를 우리가 직접 찾아서 넣어줘야 한다.

동작 순서:
  1. 후보 수집
     - 식품 전문지(식품저널 RSS·푸드투데이) 기사를 매일 data/news_archive.json 에 누적하고,
       최근 14일 '신제품 출시' 기사의 따옴표 속 제품명에서 명사(복합명사 포함)를 뽑아
       2건 이상 기사에 등장한 단어를 후보로 삼는다. (형태소 분석: kiwipiepy)
     - data/keyword_discovery_config.json 의 seedKeywords(식품 소재·맛 사전)는 항상 후보.
     - 현재 추적 중인 키워드도 항상 후보 (계속 뜨는 중이면 유지되도록).
     - 일반 명사·기관명·회사/브랜드명은 excludeKeywords / excludeBrands 로 제외.
  2. 점수 계산 (네이버 데이터랩 최근 90일 일별 추이)
     - 최근 4주 평균 vs 직전 4주 평균 증가율(주 지표) + 최근 7일 vs 직전 7일 증가율
       + 기사 언급 수 가산점 + 현재 추적 중이면 유지 가산점(잦은 교체 방지)
     - 최근 4주 중 검색량이 잡힌 날이 너무 적은(=검색량이 매우 적은) 단어는 제외
     - 네이버 검색광고 API 키가 있으면 월간 검색수가 minMonthlySearch 미만인 단어도 제외
  3. 선정: pinned: true 키워드를 먼저 넣고, 점수 순으로 maxKeywords(20)개까지 채운다.
     서로 포함관계인 단어(예: '쫀득쿠키' / '두바이쫀득쿠키')는 점수가 높은 하나만 남긴다.
  4. keywords_config.json, categories.json(카테고리별 대표 키워드), meta.json 을 갱신하고
     전체 후보와 점수는 data/keyword_discovery.json 에 남긴다.

기사 아카이브는 매번 갱신하지만, refreshDays(기본 7일)가 지나지 않았으면 키워드 분석은 건너뛰므로, 매일 도는
워크플로에 넣어도 실제 갱신은 주 1회만 일어난다. 강제로 돌리려면 --force.

필요 환경변수:
  NAVER_CLIENT_ID / NAVER_CLIENT_SECRET            (필수, 데이터랩)
  NAVER_AD_API_KEY / NAVER_AD_SECRET_KEY / NAVER_AD_CUSTOMER_ID  (선택, 월간 검색수 필터)

사용법:
  python scripts/discover_keywords.py            # 7일 지났을 때만 갱신
  python scripts/discover_keywords.py --force    # 바로 갱신
  python scripts/discover_keywords.py --candidates-only   # 기사에서 뽑힌 후보만 출력 (API 불필요, 파일 안 바꿈)
"""

import argparse
import json
import math
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _env import load_env_file  # noqa: E402
from _naver_common import (  # noqa: E402
    BATCH_SIZE, call_naver_api, align_to_range, compute_change_rate, chunk,
    all_dates, trim_trailing_incomplete_days,
)

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DISCOVERY_CONFIG_PATH = DATA_DIR / "keyword_discovery_config.json"
KEYWORDS_CONFIG_PATH = DATA_DIR / "keywords_config.json"
CATEGORIES_PATH = DATA_DIR / "categories.json"
PRODUCTS_PATH = DATA_DIR / "new_products.json"
REPORT_PATH = DATA_DIR / "keyword_discovery.json"
META_PATH = DATA_DIR / "meta.json"

KST = timezone(timedelta(hours=9))
WINDOW_DAYS = 90

# 대시보드 그래프 색상 (기존 초록/하늘/노랑 계열 + 구분이 잘 되는 보조색)
PALETTE = [
    "#0ea5e9", "#eab308", "#16a34a", "#2563eb", "#22c55e", "#65a30d", "#0284c7", "#facc15",
    "#059669", "#38bdf8", "#ca8a04", "#0369a1", "#84cc16", "#14b8a6", "#f59e0b", "#0891b2",
    "#4d7c0f", "#a16207", "#06b6d4", "#15803d",
]

# 키워드가 어떤 카테고리 기사/단어와 함께 나오는지로 카테고리를 추정한다.
# (crawl_kurly_products.py 의 CATEGORY_HINTS 와 같은 기준 + 디저트류 보강)
CATEGORY_HINTS = [
    ("베이커리", ["빵", "케이크", "크로플", "베이글", "식빵", "브레드", "바게트", "휘낭시에", "마들렌", "크루아상", "베이커리"]),
    ("빙과", ["아이스크림", "빙수", "샤베트", "아이스바", "젤라또", "빙과"]),
    ("유제품", ["우유", "요거트", "치즈", "그릭요거트", "유제품"]),
    ("건강식품", ["홍삼", "영양제", "프로틴", "젤리스틱", "건강기능", "단백질"]),
    ("라면", ["라면", "볶음면", "우동", "국수", "짬뽕", "짜장"]),
    ("제과", ["쿠키", "파이", "초콜릿", "초코", "웨하스", "제과", "약과", "떡", "젤리", "캔디", "티라미수"]),
    ("스낵", ["스낵", "크래커", "뻥튀기", "팝콘", "과자", "칩"]),
    ("음료", ["음료", "주스", "두유", "탄산", "라떼", "에이드", "녹차", "홍차", "밀크티", "커피", "아메리카노", "스무디"]),
    ("간편식", ["HMR", "밀키트", "찌개", "만두", "덮밥", "컵밥", "카레", "즉석", "도시락", "소스"]),
]

HANGUL_OR_ALNUM = re.compile(r"^[가-힣A-Za-z0-9]+$")


def load_json(path, fallback=None):
    if not Path(path).exists():
        return fallback
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj):
    Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ─────────────────────────────────────────────────────────────
# 1. 후보 수집
# ─────────────────────────────────────────────────────────────

FOODNEWS_RSS = "https://www.foodnews.co.kr/rss/allArticle.xml"  # 목록 페이지는 page 파라미터가 먹지 않아 RSS(최근 50건) 사용
ARCHIVE_PATH = DATA_DIR / "news_archive.json"
ARCHIVE_KEEP_DAYS = 28


def _parse_date(s):
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%a, %d %b %Y %H:%M:%S %z"):
        try:
            dt = datetime.strptime(s.strip(), fmt)
            return (dt if dt.tzinfo else dt.replace(tzinfo=KST)).isoformat()
        except ValueError:
            continue
    try:
        dt = datetime.fromisoformat(s)
        return (dt if dt.tzinfo else dt.replace(tzinfo=KST)).isoformat()
    except ValueError:
        return None


def collect_foodnews_rss(news):
    import html as _html
    xml = news.fetch_url(FOODNEWS_RSS)
    out = []
    for item in re.findall(r"<item>(.*?)</item>", xml, re.S):
        def tag(name):
            m = re.search(rf"<{name}>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</{name}>", item, re.S)
            return news.clean_text(_html.unescape(m.group(1))) if m else ""
        title = tag("title")
        if title:
            out.append({"title": title, "description": tag("description")[:200],
                        "link": tag("link"), "pubDate": _parse_date(tag("pubDate"))})
    return out


def collect_foodtoday(news, known_links, cutoff, max_pages, stop_at_known=True, deadline=None):
    site = next(s for s in news.SITES if s["name"] == "foodtoday")
    out, seen = [], set()
    for page in range(1, max_pages + 1):
        try:
            html_text = news.fetch_url(site["list_url_tpl"].format(page=page))
        except Exception as e:
            print(f"  -> (foodtoday) 목록 p{page} 실패: {e}", file=sys.stderr)
            continue
        time.sleep(news.REQUEST_DELAY)
        ids = [i for i in news.extract_article_ids(html_text, site["id_pattern"]) if i not in seen]
        seen.update(ids)
        stop = False
        for aid in ids:
            if deadline and time.time() > deadline:
                print("  -> 시간 예산 소진, 여기까지 저장", file=sys.stderr)
                return out
            url = site["article_url_tpl"].format(id=aid)
            if url in known_links:      # 이미 아카이브에 있는 기사까지 왔으면 이후는 전부 수집된 것
                stop = stop or stop_at_known
                continue
            art, err = news.fetch_article(url)
            time.sleep(news.REQUEST_DELAY)
            if err or not art:
                continue
            art["description"] = (art.get("description") or "")[:200]
            if art.get("pubDate") and datetime.fromisoformat(art["pubDate"]) < cutoff:
                stop = True
                continue
            out.append(art)
        if stop:
            break
    return out


def update_news_archive(bootstrap_days, max_pages, time_budget=None):
    """매일 실행: 식품 전문지 최신 기사 제목/요약을 data/news_archive.json 에 누적한다(최근 28일 보관).
    주간 분석은 이 아카이브를 쓴다. 아카이브가 비어 있으면 bootstrap_days 만큼 거슬러 올라가 채운다."""
    import fetch_food_news as news  # requests/bs4 의존성은 여기서만 필요

    archive = load_json(ARCHIVE_PATH, []) or []
    known = {a["link"] for a in archive}
    now = datetime.now(KST)
    # 아카이브가 아직 bootstrap_days 만큼 과거를 덮지 못하면(첫 실행 등) 그 기간까지 거슬러 올라가 채운다.
    ft = [a for a in archive if "foodtoday" in a.get("link", "")]
    oldest = min((datetime.fromisoformat(a["pubDate"]) for a in ft), default=now)
    covered = oldest <= now - timedelta(days=bootstrap_days - 1)
    cutoff = now - timedelta(days=3 if covered else bootstrap_days)
    deadline = time.time() + time_budget if time_budget else None
    fresh = []
    try:
        fresh += [a for a in collect_foodnews_rss(news) if a["link"] not in known]
    except Exception as e:
        print(f"  -> (foodnews) RSS 실패: {e}", file=sys.stderr)
    fresh += collect_foodtoday(news, known, cutoff, max_pages, stop_at_known=covered, deadline=deadline)
    for a in fresh:
        a["pubDate"] = a.get("pubDate") or now.isoformat()
    keep_after = now - timedelta(days=ARCHIVE_KEEP_DAYS)
    merged = [a for a in fresh + archive if datetime.fromisoformat(a["pubDate"]) >= keep_after]
    merged.sort(key=lambda a: a["pubDate"], reverse=True)
    write_json(ARCHIVE_PATH, merged)
    print(f"[discover_keywords] 기사 아카이브: 신규 {len(fresh)}건, 보관 {len(merged)}건 (최근 {ARCHIVE_KEEP_DAYS}일)")
    return merged


def recent_articles(archive, lookback_days):
    import fetch_food_news as news
    cutoff = datetime.now(KST) - timedelta(days=lookback_days)
    arts = [a for a in archive if datetime.fromisoformat(a["pubDate"]) >= cutoff]
    # 두 매체가 같은 보도자료를 실은 경우 한 건으로 친다 (언급 수 부풀림 방지)
    try:
        arts = news.dedupe_articles(arts)
    except Exception as e:
        print(f"  -> 중복 기사 제거 실패(무시): {e}", file=sys.stderr)
    return arts


def build_tokenizer():
    from kiwipiepy import Kiwi
    return Kiwi()


def extract_terms(kiwi, text):
    """문장에서 명사 후보를 뽑는다.
    - 띄어쓰기 단위(어절)마다 앞부분의 연속된 명사를 이어붙인 복합명사 (예: '두바이쫀득쿠키를' → '두바이쫀득쿠키')
    - 각 명사 단독
    """
    terms = set()
    tokens = kiwi.tokenize(text)
    # 어절 경계: 원문 위치가 연속되지 않으면 새 어절
    current, last_end = [], None
    def flush():
        if len(current) >= 2:
            terms.add("".join(current))
    for t in tokens:
        is_noun = t.tag in ("NNG", "NNP", "SL") or t.tag == "XR"
        contiguous = last_end is not None and t.start == last_end
        if not contiguous:
            flush()
            current = []
        if is_noun and (contiguous is False or current):
            current.append(t.form)
        elif is_noun and not current:
            current.append(t.form)
        else:
            flush()
            current = []
        if t.tag in ("NNG", "NNP"):
            terms.add(t.form)
        last_end = t.start + t.len
    flush()
    return {w for w in terms if 2 <= len(w) <= 12 and HANGUL_OR_ALNUM.match(w)}


LAUNCH_SIGNALS = ["[신상품]", "신제품", "출시", "선봬", "선보", "론칭", "런칭", "신메뉴", "한정판", "리뉴얼", "에디션"]
QUOTED_RE = re.compile(r"[‘'\"“「『<《]([^’'\"”」』>》]{2,40})[’'\"”」』>》]")
# 제품명에 자주 붙지만 맛·소재 트렌드가 아닌 단어
PRODUCT_NAME_NOISE = {
    "세트", "에디션", "시리즈", "오리지널", "플러스", "프리미엄", "스페셜", "리미티드", "한정", "기획", "선물",
    "선물세트", "패키지", "버전", "컬렉션", "라인", "라인업", "신메뉴", "메뉴", "제품", "브랜드", "캠페인", "이벤트",
    "레시피", "콘테스트", "대회", "행사", "축제", "프로젝트", "챌린지", "클래스", "팝업", "팝업스토어", "스토어", "매장",
}


PLACE_NAMES = {
    "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남",
    "경북", "경남", "제주", "한국", "일본", "중국", "미국", "프랑스", "이탈리아", "베트남", "태국",
}


def is_launch_article(art, extra_signals):
    text = f"{art['title']} {art.get('description', '')[:300]}"
    return any(s in text for s in LAUNCH_SIGNALS + list(extra_signals))


TITLE_TAG_RE = re.compile(r"^\s*(\[[^\]]{1,12}\]\s*)+")


def article_company(art):
    """기사 1건 = 회사 1곳으로 본다. '오리온, ‘초코파이 피스타치오’ 출시' 처럼 제목 앞 쉼표 앞부분이
    있으면 그게 회사(또는 '빙그레 따옴' 같은 회사+브랜드), 없으면 기사 링크 자체를 식별자로 쓴다."""
    head = TITLE_TAG_RE.sub("", art["title"])
    m = re.match(r"^([^,…·'‘“\"]{2,20}),", head)
    return m.group(1).strip() if m else art.get("link") or art["title"]


def news_candidates(articles, kiwi, exclude, min_mentions, extra_signals=()):
    """신제품 출시 기사에서 따옴표로 묶인 제품명/메뉴명만 골라 그 안의 명사를 후보로 쓴다.
    기사 본문 전체에서 명사를 뽑으면 기자 이름·기관명·일반 명사가 상위를 차지해 쓸모가 없고,
    제품명 안에는 '레몬&케일', '피스타치오 크림' 처럼 맛·소재 단어가 들어 있기 때문.
    언급 수는 '그 단어를 제품명에 쓴 서로 다른 회사 수'로 센다 — 한 회사의 브랜드명이
    여러 기사에 반복돼도 1로 치고, 여러 회사가 동시에 쓰는 맛·소재가 위로 올라오게 하기 위함."""
    companies = defaultdict(set)
    examples = defaultdict(list)
    texts = defaultdict(list)
    for art in articles:
        if not is_launch_article(art, extra_signals):
            continue
        title = art["title"]
        default_comp = article_company(art)
        roundup = title.lstrip().startswith("[신상품]")  # 여러 회사 신제품을 한 기사에 묶은 주간 코너
        found = [(m, True) for m in QUOTED_RE.finditer(title)]
        found += [(m, False) for m in QUOTED_RE.finditer((art.get("description") or "")[:400])]
        for m, in_title in found:
            name = m.group(1)
            comp = default_comp
            if roundup and in_title:
                before = title[:m.start()].split()
                comp = before[-1] if before else default_comp   # 따옴표 바로 앞 단어 = 회사
            for w in extract_terms(kiwi, name):
                if w in exclude or w in PRODUCT_NAME_NOISE or w in PLACE_NAMES or w.isdigit():
                    continue
                # 형태소 분석이 '클렌즈'를 '클+렌즈'로 쪼개는 식의 오분할 방지: 단어 시작 위치에 있어야 함
                if not re.search(rf"(?<![가-힣]){re.escape(w)}", name):
                    continue
                if w in comp:   # 회사·브랜드명 자체 ('빙그레 따옴' → '따옴')
                    continue
                companies[w].add(comp)
                texts[w].append(name)
                if len(examples[w]) < 2 and title not in examples[w]:
                    examples[w].append(title)
    mentions = {w: len(c) for w, c in companies.items()}
    picked = {w: c for w, c in mentions.items() if c >= min_mentions}
    return picked, examples, texts


def count_mentions(term, articles):
    t = term.replace(" ", "")
    return sum(1 for a in articles if t in f"{a['title']} {a.get('description', '')}".replace(" ", ""))


# ─────────────────────────────────────────────────────────────
# 2. 점수 계산
# ─────────────────────────────────────────────────────────────

def window_growth(values, window):
    if len(values) < window * 2:
        return 0
    recent = sum(values[-window:]) / window
    prior = sum(values[-window * 2:-window]) / window
    if prior == 0:
        return 100 if recent > 0 else 0
    return round((recent - prior) / prior * 100)


def fetch_trends(client_id, client_secret, keywords):
    end = datetime.now(KST).date() - timedelta(days=2)
    start = end - timedelta(days=WINDOW_DAYS - 1)
    start_s, end_s = start.isoformat(), end.isoformat()
    out = {}
    for batch in chunk(keywords, BATCH_SIZE):
        resp = call_naver_api(client_id, client_secret, start_s, end_s, batch)
        for r in resp.get("results", []):
            out[r["title"]] = align_to_range(r["data"], start_s, end_s)
        time.sleep(0.3)
    out, _, _ = trim_trailing_incomplete_days(out, all_dates(start_s, end_s))
    return out


def fetch_monthly_volumes(keywords):
    """네이버 검색광고 키워드도구로 월간 검색수(PC+모바일)를 조회. 키가 없으면 None."""
    api_key = os.environ.get("NAVER_AD_API_KEY")
    secret = os.environ.get("NAVER_AD_SECRET_KEY")
    customer = os.environ.get("NAVER_AD_CUSTOMER_ID")
    if not (api_key and secret and customer):
        return None
    from fetch_related_keywords import call_keywordstool, parse_qc
    volumes = {}
    for kw in keywords:
        try:
            resp = call_keywordstool(api_key, secret, customer, kw.replace(" ", ""))
        except Exception as e:
            print(f"  -> 월간 검색수 조회 실패 ({kw}): {e}", file=sys.stderr)
            continue
        items = resp.get("keywordList", []) if isinstance(resp, dict) else resp
        for it in items:
            if it.get("relKeyword", "").replace(" ", "") == kw.replace(" ", ""):
                volumes[kw] = parse_qc(it.get("monthlyPcQcCnt")) + parse_qc(it.get("monthlyMobileQcCnt"))
                break
        else:
            volumes[kw] = 0
        time.sleep(0.2)
    return volumes


def score_candidate(series, mentions, tracked, cfg):
    g28 = window_growth(series, 28)
    g7 = compute_change_rate(series)
    last28 = series[-28:]
    active_ratio = sum(1 for v in last28 if v > 0) / max(len(last28), 1)
    clip = lambda v: max(-100, min(300, v))
    score = 0.5 * clip(g28) + 0.3 * clip(g7) + 10 * math.log2(1 + mentions)
    if tracked:
        score += cfg["retentionBonus"]
    return {"growth28": g28, "growth7": g7, "activeDayRatio": round(active_ratio, 2), "score": round(score, 1)}


# ─────────────────────────────────────────────────────────────
# 3. 선정 & 저장
# ─────────────────────────────────────────────────────────────

def overlaps(a, b):
    return a != b and (a in b or b in a)


def select_keywords(scored, pinned, max_keywords):
    selected = list(pinned)
    for c in sorted(scored, key=lambda c: -c["score"]):
        if len(selected) >= max_keywords:
            break
        if not c["eligible"] or c["keyword"] in selected:
            continue
        if any(overlaps(c["keyword"], s) for s in selected):
            continue
        selected.append(c["keyword"])
    return selected


def guess_category(keyword, product_names, fallback="전체"):
    """키워드 자체와, 그 키워드가 들어간 제품명들로 카테고리를 추정한다.
    두 번째 카테고리도 표가 절반 이상이면 '제과/유제품' 처럼 함께 표기한다 (기존 형식과 동일)."""
    votes = Counter()
    for cat, hints in CATEGORY_HINTS:
        if any(h in keyword for h in hints):
            votes[cat] += 3
        for name in product_names[:30]:
            rest = name.replace(keyword, " ")
            if any(h in rest for h in hints):
                votes[cat] += 1
    if not votes:
        return fallback
    (c1, v1), *others = votes.most_common(2)
    if others and others[0][1] * 2 >= v1:
        return f"{c1}/{others[0][0]}"
    return c1


def build_description(c, lookback_days):
    parts = ["자동 발굴 키워드"]
    if c.get("companyCount"):
        parts.append(f"최근 {lookback_days}일 신제품 기사에서 {c['companyCount']}개 회사가 제품명에 사용")
    elif c["mentions"]:
        parts.append(f"최근 {lookback_days}일 식품 전문지 기사 {c['mentions']}건 언급")
    parts.append(f"최근 4주 검색량 {c['growth28']:+d}% (직전 4주 대비)")
    desc = " · ".join(parts) + "."
    if c.get("examples"):
        desc += f" 관련 기사: '{c['examples'][0]}'"
    return desc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="refreshDays 와 상관없이 바로 갱신")
    ap.add_argument("--candidates-only", action="store_true",
                    help="기사에서 뽑힌 후보만 출력하고 종료 (API 호출·파일 변경 없음)")
    ap.add_argument("--max-pages", type=int, help="푸드투데이 기사 목록을 최대 몇 페이지까지 볼지 (기본: 설정값)")
    ap.add_argument("--collect-only", action="store_true", help="기사 아카이브만 갱신하고 종료")
    ap.add_argument("--time-budget", type=int, help="기사 수집에 쓸 최대 초 (넘으면 거기까지만 저장)")
    args = ap.parse_args()

    cfg = load_json(DISCOVERY_CONFIG_PATH)
    kw_cfg = load_json(KEYWORDS_CONFIG_PATH)
    current = {k: v for k, v in kw_cfg["keywords"].items() if not k.startswith("_")}
    report_prev = load_json(REPORT_PATH, {}) or {}

    # 0. 기사 아카이브는 매일 갱신 (가볍다). 키워드 교체 분석은 refreshDays 마다 한 번.
    archive = update_news_archive(cfg["newsLookbackDays"], args.max_pages or cfg["newsMaxPages"], args.time_budget)
    if args.collect_only:
        return
    if not args.force and not args.candidates_only and report_prev.get("lastRun"):
        last = datetime.fromisoformat(report_prev["lastRun"])
        if datetime.now(KST) - last < timedelta(days=cfg["refreshDays"]) - timedelta(hours=6):
            print(f"[discover_keywords] 마지막 키워드 갱신 {last.date()} — {cfg['refreshDays']}일이 지나지 않아 분석은 건너뜀")
            return

    brands = set(cfg.get("excludeBrands", []))
    for p in load_json(PRODUCTS_PATH, []) or []:
        if p.get("brand") and p["brand"] != "-":
            brands.add(p["brand"])
    exclude = set(cfg.get("excludeKeywords", [])) | brands

    # 1. 후보
    lookback = cfg["newsLookbackDays"]
    articles = recent_articles(archive, lookback)
    print(f"[discover_keywords] 최근 {lookback}일 기사 {len(articles)}건 분석")
    kiwi = build_tokenizer()
    launch_signals = (load_json(DATA_DIR / "news_filters.json", {}) or {}).get("productLaunchSignals", [])
    news_terms, examples, texts = news_candidates(articles, kiwi, exclude, cfg["minArticleMentions"], launch_signals)

    top_news = sorted(news_terms.items(), key=lambda kv: -kv[1])[: cfg["maxCandidates"]]
    if args.candidates_only:
        print("\n기사 언급 상위 후보:")
        for w, c in top_news:
            print(f"  {c:3d}  {w}   예) {examples[w][0][:50]}")
        return

    load_env_file()
    client_id = os.environ.get("NAVER_CLIENT_ID")
    client_secret = os.environ.get("NAVER_CLIENT_SECRET")
    if not client_id or not client_secret:
        print("ERROR: NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 필요합니다.", file=sys.stderr)
        sys.exit(1)

    pinned = [k for k, v in current.items() if v.get("pinned")]
    candidates = []
    for w in list(current) + cfg.get("seedKeywords", []) + [w for w, _ in top_news]:
        if w not in candidates and (w not in exclude or w in current):
            candidates.append(w)

    # 2. 점수
    try:
        trends = fetch_trends(client_id, client_secret, candidates)
    except Exception as e:
        print(f"ERROR: 데이터랩 호출 실패 — 기존 키워드 목록을 유지합니다. ({e})", file=sys.stderr)
        sys.exit(1)
    volumes = fetch_monthly_volumes(candidates)

    scored = []
    for w in candidates:
        series = trends.get(w)
        if not series:
            continue
        mentions = news_terms.get(w) or count_mentions(w, articles)
        s = score_candidate(series, mentions, w in current, cfg)
        reasons = []
        if s["activeDayRatio"] < cfg["minActiveDayRatio"]:
            reasons.append("검색량 너무 적음")
        if volumes is not None and volumes.get(w, 0) < cfg["minMonthlySearch"]:
            reasons.append(f"월간 검색수 {volumes.get(w, 0)} < {cfg['minMonthlySearch']}")
        scored.append({
            "keyword": w, "mentions": mentions, "companyCount": news_terms.get(w, 0), **s,
            "monthlySearch": volumes.get(w) if volumes is not None else None,
            "source": "current" if w in current else ("seed" if w in cfg.get("seedKeywords", []) else "news"),
            "eligible": not reasons, "excludedReason": ", ".join(reasons) or None,
            "examples": examples.get(w, [])[:2],
        })

    selected = select_keywords(scored, pinned, cfg["maxKeywords"])
    if len(selected) < 10:
        print(f"ERROR: 선정된 키워드가 {len(selected)}개뿐이라 기존 목록을 유지합니다.", file=sys.stderr)
        sys.exit(1)

    # 3. 저장
    by_kw = {c["keyword"]: c for c in scored}
    used_colors = {v["color"] for k, v in current.items() if k in selected}
    free_colors = [c for c in PALETTE if c not in used_colors]
    today = datetime.now(KST).date().isoformat()
    new_keywords = {}
    for kw in selected:
        c = by_kw.get(kw, {})
        prev = current.get(kw)
        entry = dict(prev) if prev else {}
        entry["color"] = (prev or {}).get("color") or (free_colors.pop(0) if free_colors else PALETTE[len(new_keywords) % len(PALETTE)])
        is_auto = not prev or prev.get("source", "manual") == "auto"
        if not prev:
            entry["category"] = guess_category(kw, texts.get(kw, []))
            entry["source"] = "auto"
            entry["addedAt"] = today
        if is_auto and c:
            entry["description"] = build_description(c, lookback)
        entry.setdefault("source", "manual")
        new_keywords[kw] = entry

    added = [k for k in selected if k not in current]
    removed = [k for k in current if k not in selected]
    kw_cfg["keywords"] = new_keywords
    write_json(KEYWORDS_CONFIG_PATH, kw_cfg)

    # 카테고리별 대표 키워드 (점수 순)
    cats = load_json(CATEGORIES_PATH)
    order = sorted(selected, key=lambda k: -(by_kw.get(k, {}).get("score") or 0))
    for cat, meta in cats["categories"].items():
        if cat == "전체":
            top = order[:6]
        else:
            top = [k for k in order if cat in new_keywords[k]["category"].split("/")][:6]
            top += [k for k in order if k not in top][: max(0, 3 - len(top))]
        meta["topKeywords"] = top
    write_json(CATEGORIES_PATH, cats)

    now_iso = datetime.now(KST).isoformat()
    write_json(REPORT_PATH, {
        "lastRun": now_iso,
        "articlesScanned": len(articles),
        "newsLookbackDays": lookback,
        "selected": selected,
        "added": added,
        "removed": removed,
        "candidates": sorted(scored, key=lambda c: -c["score"]),
    })
    meta = load_json(META_PATH, {}) or {}
    meta["keywordsDiscoveredAt"] = now_iso
    meta["keywordsAdded"] = added
    meta["keywordsRemoved"] = removed
    write_json(META_PATH, meta)

    print(f"[discover_keywords] 추적 키워드 {len(selected)}개로 갱신 — 추가 {added} / 제외 {removed}")


if __name__ == "__main__":
    main()
