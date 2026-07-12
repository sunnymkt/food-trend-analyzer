#!/usr/bin/env python3
"""
data/*.json 을 바탕으로 주간 푸드트렌드 리포트 이메일(HTML)을 만들어 발송한다.

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
import os
import smtplib
import sys
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _env import load_env_file  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
LOGO_PATH = ROOT / "assets" / "nhfood_logo.jpg"
OUT_DIR = ROOT / "out"
ARCHIVE_DIR = DATA_DIR / "weekly_reports"
ARCHIVE_INDEX = DATA_DIR / "weekly_reports.json"
KST = timezone(timedelta(hours=9))

HISTORY_AVG_WINDOW = 30  # product_history.json 이 이미 30일 롤링이라 그대로 씀


def load_json(path, fallback=None):
    if not path.exists():
        return fallback
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def esc(s):
    return html.escape(str(s), quote=True)


def fmt_pct(v):
    return f"{'+' if v >= 0 else ''}{v}%"


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
        if b and b != "-":
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

    def news_of(category, n=3):
        items = [a for a in news if a.get("category", "product") == category]
        items.sort(key=lambda a: a.get("pubDate") or "", reverse=True)
        return items[:n]

    product_news = news_of("product")
    regulatory_news = news_of("regulatory")

    now = datetime.now(KST)
    trend_start = meta.get("trendStartDate")
    trend_end = meta.get("trendEndDate")

    return {
        "generated_at": now,
        "week_label": week_label(now),
        "period_label": f"{trend_start} ~ {trend_end}" if trend_start and trend_end else now.strftime("%Y.%m.%d"),
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
    --paper:#fdfcfb; --card:#ffffff; --ink:#1c1917; --muted:#78716c; --faint:#a8a29e;
    --rule:#e7e2da; --accent:#ea580c; --accent-ink:#9a3412; --accent-bg:#fdf1e9;
    --gold:#b45309; --good:#15803d; --bad:#be123c;
    --compliance-ink:#1e3a5f; --compliance-bg:#eef2f7; --compliance-rule:#ccd8e4;
  }
  * { box-sizing:border-box; }
  body { background:var(--paper); color:var(--ink); font-family:-apple-system,"Malgun Gothic","Apple SD Gothic Neo","Segoe UI",sans-serif; line-height:1.6; margin:0; }
  .sheet { max-width:640px; margin:0 auto; padding:8px 4px 48px; }
  .num { font-variant-numeric:tabular-nums; }
  .masthead { padding:36px 28px 28px; border-bottom:3px solid var(--ink); display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
  .masthead-text { flex:1; min-width:0; }
  .masthead-logo { height:26px; width:auto; flex-shrink:0; margin-top:2px; }
  .masthead-eyebrow { font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); margin-bottom:10px; }
  .masthead h1 { font-size:24px; font-weight:900; letter-spacing:-.02em; line-height:1.3; margin:0 0 12px; }
  .masthead-meta { font-size:12.5px; color:var(--muted); }
  .masthead-meta b { color:var(--ink); font-weight:700; }
  section { padding:26px 28px; border-bottom:1px solid var(--rule); }
  .label {
    display:inline-block; font-size:11.5px; font-weight:800; letter-spacing:.06em; text-transform:uppercase;
    color:#fff; background:var(--ink); padding:5px 13px; border-radius:20px; margin-bottom:16px;
  }
  h2 { font-size:17px; font-weight:800; letter-spacing:-.01em; margin:0 0 4px; }
  .section-sub { font-size:12.5px; color:var(--muted); margin-bottom:18px; }
  .hl-grid { display:flex; flex-wrap:wrap; gap:20px 28px; }
  .hl-item { flex:1 1 130px; min-width:130px; }
  .hl-value { font-size:23px; font-weight:900; letter-spacing:-.02em; margin-top:4px; }
  .hl-value.up { color:var(--good); } .hl-value.down { color:var(--bad); }
  .hl-value .unit { font-size:14px; font-weight:700; }
  .hl-label { font-size:12px; color:var(--muted); }
  .hl-sub { font-size:11.5px; color:var(--faint); margin-top:2px; }
  .kw-cols { display:flex; gap:24px; flex-wrap:wrap; }
  .kw-col { flex:1 1 240px; min-width:220px; }
  .kw-col-title { font-size:12px; font-weight:700; margin-bottom:8px; }
  .kw-col-title.up { color:var(--good); } .kw-col-title.down { color:var(--bad); }
  .kw-row { display:flex; align-items:baseline; justify-content:space-between; padding:7px 0; border-bottom:1px solid var(--rule); font-size:13.5px; }
  .kw-row:last-child { border-bottom:none; }
  .kw-name { font-weight:600; }
  .kw-cat { font-size:11px; color:var(--faint); font-weight:400; margin-left:6px; }
  .kw-pct { font-weight:800; font-size:13px; }
  .kw-pct.up { color:var(--good); } .kw-pct.down { color:var(--bad); }
  .opp-box { background:var(--accent-bg); border:1px solid var(--accent); border-radius:10px; padding:18px 20px; }
  .opp-kw { font-size:15px; font-weight:800; color:var(--accent-ink); }
  .opp-note { font-size:13px; color:var(--ink); margin-top:10px; line-height:1.7; }
  .news-block + .news-block { margin-top:22px; }
  .news-head-title { font-size:13.5px; font-weight:800; margin-bottom:10px; display:block; }
  .news-item { padding:10px 0; border-bottom:1px solid var(--rule); }
  .news-item:last-child { border-bottom:none; }
  .news-item a { color:var(--ink); text-decoration:none; font-size:13.5px; font-weight:600; line-height:1.5; }
  .news-item-meta { font-size:11px; color:var(--faint); margin-top:3px; }
  .compliance-panel { background:var(--compliance-bg); border:1px solid var(--compliance-rule); border-radius:10px; padding:16px 18px; }
  .compliance-panel .news-head-title { color:var(--compliance-ink); }
  .compliance-panel .news-item { border-bottom-color:var(--compliance-rule); }
  .compliance-panel .news-item a { color:var(--compliance-ink); }
  .compliance-panel .news-item-meta { color:var(--compliance-ink); opacity:.7; }
  .cat-bars { display:flex; flex-direction:column; gap:10px; margin-bottom:20px; }
  .cat-bar-row { display:flex; align-items:center; gap:10px; font-size:13px; }
  .cat-bar-name { width:64px; flex-shrink:0; font-weight:600; }
  .cat-bar-track { flex:1; height:8px; background:var(--rule); border-radius:4px; overflow:hidden; }
  .cat-bar-fill { height:100%; background:var(--accent); border-radius:4px; }
  .cat-bar-count { width:30px; flex-shrink:0; text-align:right; font-weight:700; }
  .prod-grid { display:flex; flex-direction:column; gap:12px; }
  .prod-row { display:flex; align-items:center; gap:12px; padding:10px 12px; background:var(--card); border:1px solid var(--rule); border-radius:8px; }
  .prod-emoji { font-size:22px; flex-shrink:0; }
  .prod-name { font-size:13.5px; font-weight:700; }
  .prod-meta { font-size:11.5px; color:var(--muted); margin-top:1px; }
  .prod-price { margin-left:auto; font-size:13px; font-weight:800; color:var(--gold); white-space:nowrap; }
  .footer { padding:22px 28px 4px; font-size:11px; color:var(--faint); line-height:1.7; }
"""


def render_html(ctx):
    logo_img = (
        f'<img class="masthead-logo" src="{ctx["logo_data_uri"]}" alt="농협식품 로고">'
        if ctx["logo_data_uri"] else ""
    )

    def kw_rows(pairs, cls):
        return "".join(
            f'<div class="kw-row"><span class="kw-name">{esc(kw)}'
            f'<span class="kw-cat">{esc(d["category"])}</span></span>'
            f'<span class="kw-pct {cls} num">{fmt_pct(d["changeRate"])}</span></div>'
            for kw, d in pairs
        )

    opp_kw_html = "".join(f'<span class="opp-kw">{esc(k)}</span>' for k in ctx["opportunity_kws"])
    opp_descs = [ctx["keyword_data"][k]["description"] for k in ctx["opportunity_kws"] if k in ctx["keyword_data"]]
    opp_note = " ".join(opp_descs) if opp_descs else "이번 주 특별한 기회 키워드가 감지되지 않았습니다."

    def news_items(items):
        if not items:
            return '<div class="news-item" style="color:var(--faint);font-size:12.5px;">수집된 기사가 없습니다.</div>'
        return "".join(
            f'<div class="news-item"><a href="{esc(a["link"])}">{esc(a["title"])}</a>'
            f'<div class="news-item-meta">#{esc(a["keyword"])} · {fmt_date_short(a.get("pubDate"))}</div></div>'
            for a in items
        )

    cat_bar_html = "".join(
        f'<div class="cat-bar-row"><span class="cat-bar-name">{esc(cat)}</span>'
        f'<div class="cat-bar-track"><div class="cat-bar-fill" style="width:{round(count/ctx["max_cat_count"]*100)}%"></div></div>'
        f'<span class="cat-bar-count num">{count}</span></div>'
        for cat, count in ctx["cat_sorted"][:6]
    )

    prod_html = "".join(
        f'<div class="prod-row"><span class="prod-emoji">{esc(p.get("emoji","🍽️"))}</span>'
        f'<div><div class="prod-name">{esc(p["brand"])} {esc(p["name"])}</div>'
        f'<div class="prod-meta">{esc(p["category"])}</div></div>'
        f'<span class="prod-price num">{esc(p["price"])}</span></div>'
        for p in ctx["representative_products"]
    )

    top_cat_name, top_cat_count = ctx["top_category"]
    top_brand_name, top_brand_count = ctx["top_brand"]
    top_up_kw, top_up_d = ctx["top_up"][0] if ctx["top_up"] else (None, None)
    top_down_kw, top_down_d = ctx["top_down"][0] if ctx["top_down"] else (None, None)

    return f"""<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>농협식품 푸드트렌드 위클리</title>
<style>{CSS}</style></head>
<body><div class="sheet">

  <header class="masthead">
    <div class="masthead-text">
      <div class="masthead-eyebrow">농협식품 상품기획팀 · 주간 발행</div>
      <h1>푸드트렌드 위클리 — {esc(ctx["week_label"])}</h1>
      <div class="masthead-meta">
        <span>조사 기간 <b class="num">{esc(ctx["period_label"])}</b></span> ·
        <span>발행 <b class="num">{ctx["generated_at"].strftime("%Y.%m.%d(%a) %H:%M")}</b></span>
      </div>
    </div>
    {logo_img}
  </header>

  <section>
    <div class="label">업계 뉴스</div>
    <div class="news-block">
      <span class="news-head-title">📰 신제품 관련</span>
      {news_items(ctx["product_news"])}
    </div>
    <div class="news-block compliance-panel">
      <span class="news-head-title">⚖️ 법규·제도 변화 — 미리 확인하세요</span>
      {news_items(ctx["regulatory_news"])}
    </div>
  </section>

  <section>
    <div class="label">한눈에 보기</div>
    <div class="hl-grid">
      <div class="hl-item">
        <div class="hl-label">이번 주 최고 상승 키워드</div>
        <div class="hl-value up">{esc(top_up_kw or "-")} <span class="unit num">{fmt_pct(top_up_d["changeRate"]) if top_up_d else ""}</span></div>
      </div>
      <div class="hl-item">
        <div class="hl-label">주의가 필요한 하락 키워드</div>
        <div class="hl-value down">{esc(top_down_kw or "-")} <span class="unit num">{fmt_pct(top_down_d["changeRate"]) if top_down_d else ""}</span></div>
      </div>
      <div class="hl-item">
        <div class="hl-label">신제품 최다 카테고리</div>
        <div class="hl-value">{esc(top_cat_name or "-")} <span class="unit num">{top_cat_count}건</span></div>
        <div class="hl-sub num">전체 {ctx["total_products"]}건 중</div>
      </div>
      <div class="hl-item">
        <div class="hl-label">최다 신제품 출시 브랜드</div>
        <div class="hl-value">{esc(top_brand_name or "-")} <span class="unit num">{top_brand_count}건</span></div>
        <div class="hl-sub">최근 30일 누적</div>
      </div>
    </div>
  </section>

  <section>
    <div class="label">키워드 트렌드</div>
    <h2>검색 지수 상승·하락 TOP 5</h2>
    <div class="section-sub">네이버 데이터랩 기준, 전주 대비 변화율</div>
    <div class="kw-cols">
      <div class="kw-col"><div class="kw-col-title up">▲ 상승</div>{kw_rows(ctx["top_up"], "up")}</div>
      <div class="kw-col"><div class="kw-col-title down">▼ 하락</div>{kw_rows(ctx["top_down"], "down")}</div>
    </div>
  </section>

  <section>
    <div class="label">기회 키워드</div>
    <h2>수요는 오르는데, 아직 제품은 적은 자리</h2>
    <div class="opp-box">
      <div>{opp_kw_html}</div>
      <div class="opp-note">{esc(opp_note)}</div>
    </div>
  </section>

  <section style="border-bottom:none;">
    <div class="label">신제품 동향</div>
    <h2>카테고리별 신제품 {ctx["total_products"]}건</h2>
    <div class="section-sub">마켓컬리 검색결과 기준, 최근 1일 발견분</div>
    <div class="cat-bars">{cat_bar_html}</div>
    <div class="prod-grid">{prod_html}</div>
  </section>

  <div class="footer">
    본 리포트는 네이버 데이터랩 검색어트렌드, 마켓컬리 검색결과, 네이버 뉴스 검색 결과를 자동 수집·집계하여
    작성되었습니다. 수치는 조사 기준일의 스냅샷이며, 실제 시장 상황과 차이가 있을 수 있습니다.<br>
    문의 · 상품기획팀 데이터 담당자
  </div>

</div></body></html>"""


def archive_report(ctx, html_body):
    """매주 발행분을 프론트엔드 "푸드트렌드 위클리(메일)" 카드뉴스 아카이브용으로 누적 저장한다.
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


def send_email(subject, html_body, recipients, smtp_host, smtp_port, smtp_user, smtp_password, smtp_from):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_from
    msg["To"] = ", ".join(recipients)
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
        server.sendmail(smtp_from, recipients, msg.as_string())
    finally:
        server.quit()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="발송하지 않고 out/weekly_report_preview.html 로 저장")
    args = parser.parse_args()

    load_env_file()
    ctx = build_context()
    html_body = render_html(ctx)
    archive_report(ctx, html_body)

    if args.dry_run:
        OUT_DIR.mkdir(exist_ok=True)
        out_path = OUT_DIR / "weekly_report_preview.html"
        out_path.write_text(html_body, encoding="utf-8")
        print(f"[generate_weekly_report] dry-run: {out_path} 에 저장했습니다 (발송 안 함).")
        return

    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER")
    smtp_password = os.environ.get("SMTP_PASSWORD")
    smtp_from = os.environ.get("SMTP_FROM") or smtp_user
    recipients_raw = os.environ.get("REPORT_RECIPIENTS", "")
    recipients = [r.strip() for r in recipients_raw.split(",") if r.strip()]

    if not smtp_host or not recipients:
        print("ERROR: SMTP_HOST / REPORT_RECIPIENTS 환경변수가 필요합니다.", file=sys.stderr)
        sys.exit(1)

    subject = f"[농협식품] 푸드트렌드 위클리 — {ctx['week_label']}"
    try:
        send_email(subject, html_body, recipients, smtp_host, smtp_port, smtp_user, smtp_password, smtp_from)
    except Exception as e:
        print(f"ERROR: 이메일 발송 실패 - {e}", file=sys.stderr)
        sys.exit(1)

    print(f"[generate_weekly_report] {len(recipients)}명에게 발송 완료: {recipients}")


if __name__ == "__main__":
    main()
