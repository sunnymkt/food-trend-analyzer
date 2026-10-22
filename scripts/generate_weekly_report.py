#!/usr/bin/env python3
"""
data/*.json 을 바탕으로 주간 푸드 트렌드 리포트 이메일(HTML)을 만들어 발송한다.

필요 환경변수 (.env 또는 GitHub Secrets):
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, REPORT_RECIPIENTS
  (REPORT_RECIPIENTS는 콤마로 구분된 이메일 목록)

사용법:
  python scripts/generate_weekly_report.py             # 실제 발송
  python scripts/generate_weekly_report.py --dry-run    # HTML만 out/weekly_report_preview.html 로 저장, 발송 안 함
"""

import argparse
import base64
import html
import json
import logging
import os
import re
import smtplib
import sys
import traceback
from datetime import datetime, timedelta, timezone
from email.header import Header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, parseaddr
from pathlib import Path
from urllib.parse import quote

from premailer import transform as premailer_transform

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _env import load_env_file  # noqa: E402

logging.getLogger("premailer").setLevel(logging.ERROR)
logging.getLogger("CSSUTILS").setLevel(logging.CRITICAL)

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
LOGO_PATH = ROOT / "assets" / "nhfood_logo.jpg"
OUT_DIR = ROOT / "out"
ARCHIVE_DIR = DATA_DIR / "weekly_reports"
ARCHIVE_INDEX = DATA_DIR / "weekly_reports.json"
KST = timezone(timedelta(hours=9))

HISTORY_AVG_WINDOW = 30  # product_history.json 이 이미 30일 롤링이라 그대로 씀


NEWS_PER_SECTION = 5  # 메일의 '신제품 관련' · '법규·제도 변화' 뉴스를 각각 최신순 몇 건까지 넣을지

def load_json(path, fallback=None):
    if not path.exists():
        return fallback
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def esc(s):
    return html.escape(str(s), quote=True)


def fmt_pct(v):
    return f"{'+' if v >= 0 else ''}{v}%"


def naver_news_search_url(query):
    """fetch_food_news.py 가 product 카테고리 뉴스를 찾을 때 쓰는 것과 같은
    '{키워드} 신제품' 쿼리로 네이버 뉴스 검색 결과에 연결한다."""
    return f"https://search.naver.com/search.naver?where=news&query={quote(query)}"


DASHBOARD_BASE_URL = "https://sunnymkt.github.io/food-trend-analyzer"


def dashboard_url(view_id):
    """대시보드의 특정 화면으로 바로 열리는 링크. index.html/app.js 에 추가한
    해시 라우팅(#viewId)을 이용한다."""
    return f"{DASHBOARD_BASE_URL}/#{view_id}"


def fmt_date_short(iso_or_rfc822):
    """meta.json의 ISO 문자열 또는 news.json의 RFC822 pubDate 둘 다 처리."""
    if not iso_or_rfc822:
        return "-"
    for parser in (
        lambda s: datetime.fromisoformat(s),
        lambda s: datetime.strptime(s, "%a, %d %b %Y %H:%M:%S %z"),
    ):
        try:
            d = parser(iso_or_rfc822)
            return f"{d.month:02d}.{d.day:02d}"
        except (ValueError, TypeError):
            continue
    return "-"


def week_label(d):
    """월의 몇 주차인지 (해당 월 1일 기준 7일 단위)."""
    week_of_month = (d.day - 1) // 7 + 1
    return f"{d.year}년 {d.month}월 {week_of_month}주차"


def load_logo_data_uri():
    if not LOGO_PATH.exists():
        return None
    b64 = base64.b64encode(LOGO_PATH.read_bytes()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def build_context():
    kw_raw = load_json(DATA_DIR / "keyword_trends.json", {})
    keyword_data = {k: v for k, v in kw_raw.items() if not k.startswith("_")}

    products = load_json(DATA_DIR / "new_products.json", [])
    history = list(load_json(DATA_DIR / "product_history.json", {}).values())
    categories_cfg = load_json(DATA_DIR / "categories.json", {}).get("categories", {})
    news = load_json(DATA_DIR / "news.json", [])
    meta = load_json(DATA_DIR / "meta.json", {})

    sorted_kw = sorted(keyword_data.items(), key=lambda kv: -kv[1]["changeRate"])
    top_up = sorted_kw[:5]
    top_down = list(reversed(sorted_kw[-5:])) if len(sorted_kw) >= 5 else list(reversed(sorted_kw))

    # 기회 키워드: 이력 기준 신제품 수가 평균 이하이면서 changeRate가 가장 높은 것들
    counts = {
        kw: sum(1 for p in history if kw in (p.get("keywords") or []))
        for kw in keyword_data
    }
    avg_count = sum(counts.values()) / len(counts) if counts else 0
    opp_candidates = [kw for kw in keyword_data if counts.get(kw, 0) <= avg_count]
    opp_candidates.sort(key=lambda kw: -keyword_data[kw]["changeRate"])
    opportunity_kws = (opp_candidates or list(keyword_data))[:2]

    cat_counts = {}
    for p in products:
        cat_counts[p["category"]] = cat_counts.get(p["category"], 0) + 1
    cat_sorted = sorted(cat_counts.items(), key=lambda kv: -kv[1])
    top_category = cat_sorted[0] if cat_sorted else (None, 0)
    max_cat_count = cat_sorted[0][1] if cat_sorted else 1

    brand_counts = {}
    for p in history:
        b = p.get("brand")
        if b and b not in ("-", "브랜드 없음"):
            brand_counts[b] = brand_counts.get(b, 0) + 1
    brand_sorted = sorted(brand_counts.items(), key=lambda kv: -kv[1])
    top_brand = brand_sorted[0] if brand_sorted else (None, 0)

    seen_cat = set()
    representative_products = []
    for p in products:
        if p["category"] not in seen_cat:
            seen_cat.add(p["category"])
            representative_products.append(p)
        if len(representative_products) >= 4:
            break

    def news_of(category, n=NEWS_PER_SECTION):
        items = [a for a in news if a.get("category", "product") == category]
        items.sort(key=lambda a: a.get("pubDate") or "", reverse=True)
        return items[:n]

    product_news = news_of("product")
    regulatory_news = news_of("regulatory")

    now = datetime.now(KST)
    # '조사 기간'은 이번 리포트가 다루는 지난 1주일(7일)을 그대로 보여준다.
    # (예전엔 meta.json의 3개월 키워드 트렌드 기간을 그대로 갖다 써서 실제 리포트
    # 주기와 안 맞았다.)
    period_end_date = now.date()
    period_start_date = period_end_date - timedelta(days=6)

    return {
        "generated_at": now,
        "week_label": week_label(now),
        "period_label": f"{period_start_date.isoformat()} ~ {period_end_date.isoformat()}",
        "keyword_data": keyword_data,
        "top_up": top_up,
        "top_down": top_down,
        "opportunity_kws": opportunity_kws,
        "top_category": top_category,
        "max_cat_count": max_cat_count,
        "total_products": len(products),
        "top_brand": top_brand,
        "cat_sorted": cat_sorted,
        "representative_products": representative_products,
        "product_news": product_news,
        "regulatory_news": regulatory_news,
        "logo_data_uri": load_logo_data_uri(),
    }


CSS = """
  :root {
    --ink:#000000; --paper:#ffffff; --hair:#e6e6e6; --hair-soft:#f1f1f1; --soft:#f7f7f5;
    --lime:#dceeb1; --cream:#f4ecd6; --pink:#efd4d4; --lilac:#c5b0f4; --navy:#1f1d3d; --neg:#eb6b89;
    --sans:Pretendard,"Apple SD Gothic Neo","Malgun Gothic","Segoe UI",sans-serif;
    --mono:"JetBrains Mono",Consolas,Menlo,"Courier New",monospace;
  }
  * { box-sizing:border-box; }
  body { background:#ffffff; color:var(--ink); font-family:var(--sans); line-height:1.55; margin:0; word-break:keep-all; }
  .sheet { max-width:640px; margin:0 auto; padding:16px 12px 40px; }
  .num { font-variant-numeric:tabular-nums; }
  .topline { display:flex; justify-content:space-between; align-items:center; padding:8px 4px 16px; }
  .topline-brand { font-size:15px; font-weight:700; letter-spacing:-.2px; }
  .topline-meta { font-family:var(--mono); font-size:11px; letter-spacing:.6px; text-transform:uppercase; }
  .masthead-logo { height:22px; width:auto; }
  .hero { background:var(--lime); border-radius:24px; padding:36px 32px 32px; }
  .eyebrow { font-family:var(--mono); font-size:11.5px; letter-spacing:.6px; text-transform:uppercase; margin-bottom:14px; }
  .hero h1 { font-size:34px; font-weight:400; letter-spacing:-.8px; line-height:1.15; margin:0 0 6px; }
  .hero h1 b { font-weight:700; }
  .hero-sub { font-size:14px; margin-bottom:22px; }
  .hero-stats { display:flex; border-top:1px solid rgba(0,0,0,.18); }
  .hero-stat { flex:1; padding:16px 12px 0 0; }
  .hero-stat + .hero-stat { padding-left:14px; border-left:1px solid rgba(0,0,0,.18); }
  .hero-stat .lbl { font-family:var(--mono); font-size:10.5px; letter-spacing:.5px; text-transform:uppercase; }
  .hero-stat .name { font-size:16px; font-weight:700; margin-top:6px; }
  .hero-stat .val { font-size:30px; font-weight:300; letter-spacing:-1px; line-height:1.1; margin-top:2px; }
  .hero-stat .val.down { color:var(--neg); }
  .hero-btns { margin-top:24px; }
  .pill { display:inline-block; font-size:14px; font-weight:600; padding:10px 20px; border-radius:50px; text-decoration:none; margin-right:6px; }
  .pill-black { background:#000000; color:#ffffff; }
  .pill-white { background:#ffffff; color:#000000; }
  section { padding:32px 8px 8px; }
  .label { font-family:var(--mono); font-size:11.5px; letter-spacing:.6px; text-transform:uppercase; margin-bottom:10px; display:block; }
  h2 { font-size:22px; font-weight:600; letter-spacing:-.3px; margin:0 0 4px; line-height:1.3; }
  .section-sub { font-size:13px; margin-bottom:16px; }
  .news-block { border:1px solid var(--hair); border-radius:20px; padding:20px 22px 8px; }
  .news-block + .news-block { margin-top:14px; }
  .news-head-title { font-family:var(--mono); font-size:11px; letter-spacing:.6px; text-transform:uppercase; display:block; margin-bottom:4px; }
  .news-item { padding:12px 0; border-bottom:1px solid var(--hair-soft); }
  .news-item:last-child { border-bottom:none; }
  .news-item a { color:#000000; text-decoration:none; font-size:14.5px; font-weight:500; line-height:1.5; }
  .news-item-meta { font-family:var(--mono); font-size:10.5px; letter-spacing:.4px; margin-top:4px; }
  .compliance-panel { background:var(--pink); border:none; }
  .compliance-panel .news-item { border-bottom-color:rgba(0,0,0,.1); }
  .kw-cols { display:flex; gap:20px; flex-wrap:wrap; }
  .kw-col { flex:1 1 240px; min-width:220px; border:1px solid var(--hair); border-radius:20px; padding:16px 20px 6px; }
  .kw-col-title { font-family:var(--mono); font-size:11px; letter-spacing:.6px; margin-bottom:4px; }
  .kw-col-title.down { color:var(--neg); }
  .kw-row { display:flex; align-items:baseline; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--hair-soft); font-size:15px; }
  a.kw-row { text-decoration:none; color:#000000; }
  .kw-row:last-child { border-bottom:none; }
  .kw-name { font-weight:600; }
  .kw-cat { font-family:var(--mono); font-size:10px; font-weight:400; margin-left:6px; letter-spacing:.3px; }
  .kw-pct { font-family:var(--mono); font-weight:500; font-size:13px; }
  .kw-pct.down { color:var(--neg); }
  .opp-box { background:var(--cream); border-radius:24px; padding:28px 28px; }
  .opp-kw { display:inline-block; font-size:15px; font-weight:600; background:#000000; color:#ffffff; padding:8px 16px; border-radius:50px; margin:0 6px 6px 0; }
  .opp-note { font-size:14px; margin-top:12px; line-height:1.7; }
  .cat-bars { border:1px solid var(--hair); border-radius:20px; padding:20px 22px; margin-bottom:14px; }
  .cat-bar-row { display:flex; align-items:center; gap:12px; font-size:14px; padding:5px 0; }
  .cat-bar-name { width:64px; flex-shrink:0; font-weight:600; }
  .cat-bar-track { flex:1; height:8px; background:var(--hair-soft); border-radius:50px; overflow:hidden; }
  .cat-bar-fill { height:8px; background:#000000; border-radius:50px; }
  .cat-bar-count { width:30px; flex-shrink:0; text-align:right; font-family:var(--mono); font-size:12.5px; }
  .prod-grid { border:1px solid var(--hair); border-radius:20px; padding:6px 22px; }
  .prod-row { display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid var(--hair-soft); }
  .prod-row:last-child { border-bottom:none; }
  a.prod-row { text-decoration:none; color:#000000; }
  .prod-emoji { font-size:18px; width:36px; height:36px; line-height:36px; text-align:center; border-radius:50%; background:var(--soft); flex-shrink:0; }
  .prod-name { font-size:14.5px; font-weight:600; }
  .prod-meta { font-family:var(--mono); font-size:10.5px; letter-spacing:.4px; margin-top:2px; }
  .prod-price { margin-left:auto; font-family:var(--mono); font-size:13px; font-weight:500; white-space:nowrap; }
  .footer-block { background:var(--navy); color:#ffffff; border-radius:24px; padding:28px 28px; margin-top:32px; font-size:12px; line-height:1.7; }
  .footer-block .eyebrow { color:#ffffff; }
  .footer-block a { color:#ffffff; }
"""


def resolve_css_vars(css_text):
    """이메일 클라이언트 대부분은 CSS 커스텀 프로퍼티(var())를 지원하지 않고,
    <style> 블록 자체가 잘려나가면 :root 변수 정의도 함께 사라진다. premailer로
    인라인화하기 전에 var(--x)를 실제 값으로 치환하고 :root 블록은 제거한다."""
    root_match = re.search(r':root\s*\{([^}]*)\}', css_text)
    if not root_match:
        return css_text
    variables = dict(re.findall(r'--([\w-]+)\s*:\s*([^;]+);', root_match.group(1)))
    css_text = css_text[:root_match.start()] + css_text[root_match.end():]
    return re.sub(r'var\(--([\w-]+)\)', lambda m: variables.get(m.group(1), m.group(0)), css_text)


CSS = resolve_css_vars(CSS)


def render_html(ctx):
    logo_img = (
        f'<img class="masthead-logo" src="{ctx["logo_data_uri"]}" alt="농협식품 로고">'
        if ctx["logo_data_uri"] else ""
    )

    def kw_rows(pairs, cls):
        return "".join(
            f'<a class="kw-row" href="{dashboard_url("trends")}" target="_blank" rel="noopener noreferrer">'
            f'<span class="kw-name">{esc(kw)}'
            f'<span class="kw-cat">{esc(d["category"])}</span></span>'
            f'<span class="kw-pct {cls} num">{fmt_pct(d["changeRate"])}</span></a>'
            for kw, d in pairs
        )

    opp_kw_html = "".join(f'<span class="opp-kw">{esc(k)}</span>' for k in ctx["opportunity_kws"])
    opp_descs = [ctx["keyword_data"][k]["description"] for k in ctx["opportunity_kws"] if k in ctx["keyword_data"]]
    opp_note = " ".join(opp_descs) if opp_descs else "이번 주 특별한 기회 키워드가 감지되지 않았습니다."

    def news_items(items):
        if not items:
            return '<div class="news-item" style="color:var(--faint);font-size:12.5px;">수집된 기사가 없습니다.</div>'
        return "".join(
            f'<div class="news-item"><a href="{esc(a["link"])}" target="_blank" rel="noopener noreferrer">{esc(a["title"])}</a>'
            f'<div class="news-item-meta">#{esc(a["keyword"])} · {fmt_date_short(a.get("pubDate"))}</div></div>'
            for a in items
        )

    cat_bar_html = "".join(
        f'<div class="cat-bar-row"><span class="cat-bar-name">{esc(cat)}</span>'
        f'<div class="cat-bar-track"><div class="cat-bar-fill" style="width:{round(count/ctx["max_cat_count"]*100)}%"></div></div>'
        f'<span class="cat-bar-count num">{count}</span></div>'
        for cat, count in ctx["cat_sorted"][:6]
    )

    def prod_row_html(p):
        inner = (
            f'<span class="prod-emoji">{esc(p.get("emoji","🍽️"))}</span>'
            f'<div><div class="prod-name">{esc(p["brand"])} {esc(p["name"])}</div>'
            f'<div class="prod-meta">{esc(p["category"])}</div></div>'
            f'<span class="prod-price num">{esc(p["price"])}</span>'
        )
        url = p.get("url")
        if url:
            return f'<a class="prod-row" href="{esc(url)}" target="_blank" rel="noopener noreferrer">{inner}</a>'
        return f'<div class="prod-row">{inner}</div>'

    prod_html = "".join(prod_row_html(p) for p in ctx["representative_products"])

    top_cat_name, top_cat_count = ctx["top_category"]
    top_brand_name, top_brand_count = ctx["top_brand"]
    top_up_kw, top_up_d = ctx["top_up"][0] if ctx["top_up"] else (None, None)
    top_down_kw, top_down_d = ctx["top_down"][0] if ctx["top_down"] else (None, None)

    return f"""<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>농협식품 푸드 트렌드 위클리</title>
<style>{CSS}</style></head>
<body><div class="sheet">

  <div class="topline">
    <div><div class="topline-brand">푸드 트렌드 위클리</div><div class="topline-meta">농협식품 마케팅부 · {esc(ctx["week_label"])}</div></div>
    {logo_img}
  </div>

  <div class="hero">
    <div class="eyebrow">This week · {esc(ctx["period_label"])}</div>
    <h1>이번 주 가장 빠르게 오른 키워드는 <b>{esc(top_up_kw or "-")}</b>.</h1>
    <div class="hero-sub">신제품은 <b>{esc(top_cat_name or "-")}</b>에서 가장 많이 나왔고, <b>{esc(top_brand_name or "-")}</b>가 가장 활발했어요.</div>
    <div class="hero-stats">
      <div class="hero-stat"><div class="lbl">Top keyword</div><div class="name">{esc(top_up_kw or "-")}</div><div class="val num">{fmt_pct(top_up_d["changeRate"]) if top_up_d else "-"}</div></div>
      <div class="hero-stat"><div class="lbl">Watch out</div><div class="name">{esc(top_down_kw or "-")}</div><div class="val down num">{fmt_pct(top_down_d["changeRate"]) if top_down_d else "-"}</div></div>
      <div class="hero-stat"><div class="lbl">Top category</div><div class="name">{esc(top_cat_name or "-")}</div><div class="val num">{top_cat_count}건</div></div>
    </div>
    <div class="hero-btns"><a class="pill pill-black" href="{dashboard_url("dashboard")}">대시보드 열기</a><a class="pill pill-white" href="{dashboard_url("trends")}">키워드 비교분석</a></div>
  </div>

  <section>
    <div class="label">Industry news</div>
    <h2>이번 주 업계 소식</h2><div class="section-sub">신제품 5건 · 법규·제도 5건</div>
    <div class="news-block">
      <span class="news-head-title">New products · 신제품 관련</span>
      {news_items(ctx["product_news"])}
    </div>
    <div class="news-block compliance-panel">
      <span class="news-head-title">Regulation · 법규·제도 변화 — 미리 확인하세요</span>
      {news_items(ctx["regulatory_news"])}
    </div>
  </section>

  <section>
    <div class="label">Keyword trend</div>
    <h2>검색 지수 상승·하락 TOP 5</h2>
    <div class="section-sub">네이버 데이터랩 기준, 전주 대비 변화율</div>
    <div class="kw-cols">
      <div class="kw-col"><div class="kw-col-title up">▲ 상승</div>{kw_rows(ctx["top_up"], "up")}</div>
      <div class="kw-col"><div class="kw-col-title down">▼ 하락</div>{kw_rows(ctx["top_down"], "down")}</div>
    </div>
  </section>

  <section>
    <div class="label">Opportunity</div>
    <h2>수요는 오르는데, 아직 제품은 적은 자리</h2>
    <div class="opp-box">
      <div>{opp_kw_html}</div>
      <div class="opp-note">{esc(opp_note)}</div>
    </div>
  </section>

  <section>
    <div class="label">New products</div>
    <h2>카테고리별 신제품 {ctx["total_products"]}건</h2>
    <div class="section-sub">마켓컬리 검색결과 기준, 최근 1일 발견분</div>
    <div class="cat-bars">{cat_bar_html}</div>
    <div class="prod-grid">{prod_html}</div>
  </section>

  <div class="footer-block">
    <div class="eyebrow">About this report</div>
    본 리포트는 네이버 데이터랩 검색어트렌드, 마켓컬리 검색결과, 식품 전문지 기사를 자동 수집·집계하여
    작성되었습니다. 수치는 조사 기준일의 스냅샷이며, 실제 시장 상황과 차이가 있을 수 있습니다.<br>
    문의 · 마케팅부 데이터 담당자
  </div>

</div></body></html>"""


def inline_css(html_body):
    """네이버메일 등 대부분의 웹메일 클라이언트는 <style> 블록을 통째로 걸러낸다.
    premailer로 모든 CSS를 각 태그의 style="" 속성에 직접 박아넣어야 실제 메일에서도
    레이아웃이 유지된다. 아카이브(iframe) 뷰에도 동일한 결과물을 쓴다."""
    return premailer_transform(
        html_body,
        keep_style_tags=False,
        remove_classes=False,
        disable_validation=True,
    )


def archive_report(ctx, html_body):
    """매주 발행분을 프론트엔드 "푸드 트렌드 위클리(메일)" 카드뉴스 아카이브용으로 누적 저장한다.
    같은 날짜로 재실행되면(예: workflow_dispatch 재시도) 그 날짜 항목을 덮어쓴다."""
    date_str = ctx["generated_at"].date().isoformat()
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    html_path = ARCHIVE_DIR / f"{date_str}.html"
    html_path.write_text(html_body, encoding="utf-8")

    top_up_kw, top_up_d = ctx["top_up"][0] if ctx["top_up"] else (None, None)
    top_down_kw, top_down_d = ctx["top_down"][0] if ctx["top_down"] else (None, None)
    top_cat_name, top_cat_count = ctx["top_category"]

    entry = {
        "date": date_str,
        "weekLabel": ctx["week_label"],
        "periodLabel": ctx["period_label"],
        "generatedAt": ctx["generated_at"].isoformat(),
        "topUpKeyword": top_up_kw,
        "topUpPct": top_up_d["changeRate"] if top_up_d else None,
        "topDownKeyword": top_down_kw,
        "topDownPct": top_down_d["changeRate"] if top_down_d else None,
        "topCategory": top_cat_name,
        "topCategoryCount": top_cat_count,
        "totalProducts": ctx["total_products"],
        "file": f"data/weekly_reports/{date_str}.html",
    }

    index = []
    if ARCHIVE_INDEX.exists():
        index = json.loads(ARCHIVE_INDEX.read_text(encoding="utf-8"))
    index = [e for e in index if e.get("date") != date_str]
    index.append(entry)
    index.sort(key=lambda e: e["date"], reverse=True)
    ARCHIVE_INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[generate_weekly_report] 아카이브 저장: {html_path} (누적 {len(index)}건)")


def encode_addr(addr):
    """표시 이름에 한글이 섞여 있어도(예: '농협식품 <noreply@nhfood.co.kr>') 헤더에 안전하게 인코딩한다."""
    name, email_addr = parseaddr(addr)
    return formataddr((str(Header(name, "utf-8")), email_addr)) if name else email_addr


def send_email(subject, html_body, recipients, smtp_host, smtp_port, smtp_user, smtp_password, smtp_from):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = encode_addr(smtp_from)
    msg["To"] = ", ".join(encode_addr(r) for r in recipients)
    msg.attach(MIMEText("HTML을 지원하는 메일 클라이언트로 확인해주세요.", "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    if smtp_port == 465:
        server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=20)
    else:
        server = smtplib.SMTP(smtp_host, smtp_port, timeout=20)
        server.starttls()

    try:
        if smtp_user and smtp_password:
            server.login(smtp_user, smtp_password)
        envelope_from = parseaddr(smtp_from)[1] or smtp_from
        server.sendmail(envelope_from, recipients, msg.as_string())
    finally:
        server.quit()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="발송하지 않고 out/weekly_report_preview.html 로 저장")
    args = parser.parse_args()

    load_env_file()
    ctx = build_context()
    html_body = inline_css(render_html(ctx))
    archive_report(ctx, html_body)

    if args.dry_run:
        OUT_DIR.mkdir(exist_ok=True)
        out_path = OUT_DIR / "weekly_report_preview.html"
        out_path.write_text(html_body, encoding="utf-8")
        print(f"[generate_weekly_report] dry-run: {out_path} 에 저장했습니다 (발송 안 함).")
        return

    smtp_host = os.environ.get("SMTP_HOST", "").strip()
    smtp_port = int(os.environ.get("SMTP_PORT", "587").strip())
    smtp_user = os.environ.get("SMTP_USER", "").strip()
    smtp_password = os.environ.get("SMTP_PASSWORD", "").strip()
    smtp_from = os.environ.get("SMTP_FROM", "").strip() or smtp_user
    recipients_raw = os.environ.get("REPORT_RECIPIENTS", "")
    recipients = [r.strip() for r in recipients_raw.split(",") if r.strip()]

    if not smtp_host or not recipients:
        print("ERROR: SMTP_HOST / REPORT_RECIPIENTS 환경변수가 필요합니다.", file=sys.stderr)
        sys.exit(1)

    subject = f"[농협식품] 푸드 트렌드 위클리 — {ctx['week_label']}"
    try:
        send_email(subject, html_body, recipients, smtp_host, smtp_port, smtp_user, smtp_password, smtp_from)
    except Exception:
        print("ERROR: 이메일 발송 실패", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)

    print(f"[generate_weekly_report] {len(recipients)}명에게 발송 완료: {recipients}")


if __name__ == "__main__":
    main()
