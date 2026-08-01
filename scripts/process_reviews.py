#!/usr/bin/env python3
"""
네이버 브랜드관에서 수동으로 내려받은 리뷰 원본 엑셀(농협식품 자사 제품 전체)을
상품별 리뷰 분석 데이터(data/product_reviews.json)로 변환한다.

이 파이프라인은 자동 갱신이 아니라 "수동 업로드 → 실행 → 커밋" 방식이다.
새 리뷰 원본을 받을 때마다:
  1. 엑셀 파일을 이 저장소 어딘가(예: data/raw_reviews.xlsx)에 두고
  2. python scripts/process_reviews.py --input data/raw_reviews.xlsx 실행
  3. 새로 생성된 data/product_reviews.json 만 커밋 (원본 엑셀은 커밋하지 않는 걸 권장 —
     리뷰 작성자 아이디 등 개인정보가 섞여 있어 리포에 남기지 않는 편이 안전하다)

사용법:
  python scripts/process_reviews.py --input data/raw_reviews.xlsx
"""

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
KEYWORDS_PATH = DATA_DIR / "review_keywords.json"
OUTPUT_PATH = DATA_DIR / "product_reviews.json"

SNIPPET_MAX_LEN = 140
TOP_N_SNIPPETS = 3
WHITESPACE_RE = re.compile(r"\s+")


def load_keywords():
    with open(KEYWORDS_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    return cfg.get("positiveSignals", {}), cfg.get("negativeSignals", {})


def norm(text):
    return WHITESPACE_RE.sub("", str(text or ""))


def parse_dt(s):
    if pd.isna(s):
        return None
    s = str(s).strip()
    for fmt in ("%Y.%m.%d. %H:%M:%S", "%Y.%m.%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def snippet(text, max_len=SNIPPET_MAX_LEN):
    text = str(text or "").strip().replace("\n", " ")
    text = re.sub(r"\s+", " ", text)
    if len(text) > max_len:
        return text[:max_len].rstrip() + "…"
    return text


def match_any(norm_text, keywords):
    return any(norm(kw) in norm_text for kw in keywords)


MAX_SIGNAL_EXAMPLES = 5


def signals_with_examples(group, signal_groups):
    """signal_groups: {라벨: [키워드,...]}. 각 신호 라벨별로 (a) 매칭된 리뷰 건수와
    (b) 최신순으로 최대 MAX_SIGNAL_EXAMPLES개의 예시 스니펫을 함께 뽑는다 —
    프론트엔드에서 '신호 칩'을 클릭했을 때 실제 관련 리뷰를 보여주기 위함."""
    counts = {label: 0 for label in signal_groups}
    examples = {label: [] for label in signal_groups}
    rows = group.sort_values("_parsedDate", ascending=False)
    for _, row in rows.iterrows():
        norm_text = norm(row["리뷰상세내용"])
        for label, keywords in signal_groups.items():
            if not match_any(norm_text, keywords):
                continue
            counts[label] += 1
            if len(examples[label]) < MAX_SIGNAL_EXAMPLES:
                examples[label].append({
                    "rating": int(row["구매자평점"]) if pd.notna(row["구매자평점"]) else None,
                    "date": row["_parsedDate"].date().isoformat() if pd.notna(row["_parsedDate"]) else None,
                    "photo": bool(pd.notna(row.get("포토/영상"))),
                    "text": snippet(row["리뷰상세내용"]),
                })
    return counts, examples


def build_product_entry(product_id, group, positive_signals, negative_signals):
    name = group["상품명"].mode().iloc[0]
    ratings = group["구매자평점"].dropna().astype(int)
    rating_dist = {str(i): int((ratings == i).sum()) for i in range(1, 6)}

    dates = group["_parsedDate"].dropna()
    first_date = dates.min().date().isoformat() if not dates.empty else None
    last_date = dates.max().date().isoformat() if not dates.empty else None

    pos_counts, pos_examples = signals_with_examples(group, positive_signals)
    neg_counts, neg_examples = signals_with_examples(group, negative_signals)
    signals = {"positive": pos_counts, "negative": neg_counts}
    signal_examples = {"positive": pos_examples, "negative": neg_examples}

    # 부정 스니펫: 평점 낮은 순 → 그 안에서 최신순. 낮은 평점이 부족하면 3점까지 확장.
    neg_pool = group[group["구매자평점"] <= 2]
    if len(neg_pool) < TOP_N_SNIPPETS:
        neg_pool = group[group["구매자평점"] <= 3]
    neg_pool = neg_pool.sort_values(["구매자평점", "_parsedDate"], ascending=[True, False])
    top_negative = [
        {
            "rating": int(r["구매자평점"]),
            "date": r["_parsedDate"].date().isoformat() if pd.notna(r["_parsedDate"]) else None,
            "photo": bool(pd.notna(r.get("포토/영상"))),
            "text": snippet(r["리뷰상세내용"]),
        }
        for _, r in neg_pool.head(TOP_N_SNIPPETS).iterrows()
    ]

    # 호평 스니펫: 베스트리뷰 우선 → 도움수 높은순 → 최신순, 5점 위주.
    pos_pool = group[group["구매자평점"] == 5].copy()
    if pos_pool.empty:
        pos_pool = group.copy()
    pos_pool["_isBest"] = (pos_pool["베스트리뷰"] == "Y").astype(int)
    pos_pool["_helpful"] = pd.to_numeric(pos_pool["리뷰도움수"], errors="coerce").fillna(0)
    pos_pool = pos_pool.sort_values(
        ["_isBest", "_helpful", "_parsedDate"], ascending=[False, False, False]
    )
    top_positive = [
        {
            "rating": int(r["구매자평점"]),
            "date": r["_parsedDate"].date().isoformat() if pd.notna(r["_parsedDate"]) else None,
            "photo": bool(pd.notna(r.get("포토/영상"))),
            "best": r["베스트리뷰"] == "Y",
            "text": snippet(r["리뷰상세내용"]),
        }
        for _, r in pos_pool.head(TOP_N_SNIPPETS).iterrows()
    ]

    return {
        "productId": int(product_id),
        "productName": name,
        "reviewCount": int(len(group)),
        "avgRating": round(float(ratings.mean()), 2) if not ratings.empty else None,
        "ratingDistribution": rating_dist,
        "photoReviewCount": int(group["포토/영상"].notna().sum()),
        "bestReviewCount": int((group["베스트리뷰"] == "Y").sum()),
        "firstReviewDate": first_date,
        "lastReviewDate": last_date,
        "signals": signals,
        "signalExamples": signal_examples,
        "topNegative": top_negative,
        "topPositive": top_positive,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=str(DATA_DIR / "raw_reviews.xlsx"),
                         help="네이버 브랜드관에서 내려받은 리뷰 원본 엑셀 경로")
    parser.add_argument("--min-reviews", type=int, default=1,
                         help="이 건수 미만인 상품은 결과에서 제외 (기본 1 = 전부 포함)")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"ERROR: 입력 파일을 찾을 수 없습니다: {input_path}", file=sys.stderr)
        sys.exit(1)

    positive_signals, negative_signals = load_keywords()

    print(f"[process_reviews] 읽는 중: {input_path}")
    df = pd.read_excel(input_path)

    required_cols = {"상품번호", "상품명", "구매자평점", "리뷰상세내용", "전시상태", "리뷰등록일"}
    missing = required_cols - set(df.columns)
    if missing:
        print(f"ERROR: 필수 컬럼이 없습니다: {missing}", file=sys.stderr)
        sys.exit(1)

    before = len(df)
    df = df[df["전시상태"] == "정상"].copy()
    hidden = before - len(df)
    if hidden:
        print(f"[process_reviews] 블라인드/비정상 리뷰 {hidden}건 제외")

    df["_parsedDate"] = df["리뷰등록일"].map(parse_dt)

    products = []
    for product_id, group in df.groupby("상품번호"):
        if len(group) < args.min_reviews:
            continue
        products.append(build_product_entry(product_id, group, positive_signals, negative_signals))

    products.sort(key=lambda p: -p["reviewCount"])

    all_ratings = df["구매자평점"].dropna()
    all_dates = df["_parsedDate"].dropna()
    output = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "sourceFile": input_path.name,
        "totalReviews": int(len(df)),
        "totalProducts": len(products),
        "avgRatingOverall": round(float(all_ratings.mean()), 2) if not all_ratings.empty else None,
        "periodStart": all_dates.min().date().isoformat() if not all_dates.empty else None,
        "periodEnd": all_dates.max().date().isoformat() if not all_dates.empty else None,
        "products": products,
    }

    DATA_DIR.mkdir(exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"[process_reviews] 완료: 상품 {len(products)}개, 리뷰 {len(df)}건 → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
