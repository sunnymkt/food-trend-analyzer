# FoodTrend AI — 식품 트렌드 분석기

정적 프론트엔드(HTML/CSS/JS + Chart.js) + 파이썬 데이터 수집 스크립트 + GitHub Actions
자동화로 구성된 식품 트렌드 대시보드입니다.

## 주요 기능

- **대시보드** — KPI, 급상승 키워드, 30일 추이, 카테고리 도넛, 최신 신제품
- **트렌드 분석** — 키워드 기회 매트릭스(가로: 검색 변화율, 세로: 최근 30일 누적
  신제품 수 — 오른쪽 아래일수록 "뜨는데 제품은 적은" 기회 구간), 키워드 비교 차트
- **신제품 트래킹** — 카테고리/검색 필터가 있는 신제품 그리드
- **카테고리 분석** — 카테고리별 인기 키워드, 브랜드별 신제품(클릭하면 제품 목록 펼침),
  카테고리별 가격대(최저~최고 + 평균), 브랜드별 신제품 출시속도(최근 30일 누적)
- **업계 뉴스** — 두 섹션: ① 추적 키워드 기준 "OO 신제품" 관련 기사, ② 식품 표시·위생·
  안전 등 법규/제도 변화 기사 (`data/regulatory_topics.json`에서 주제 관리)
- **주간 리포트** — 자동 계산된 하이라이트 + 인사이트, 텍스트로 내보내기

## 데이터 흐름

```
scripts/fetch_naver_trends.py   ──▶ data/keyword_trends.json    ─┐
scripts/crawl_kurly_products.py ──▶ data/new_products.json      ─┤
                                 └─▶ data/product_history.json   ─┼─▶ js/data.js (fetch) ─▶ js/app.js 렌더링
scripts/fetch_food_news.py      ──▶ data/news.json              ─┤
data/categories.json (수동 큐레이션, 정적)                       ─┘
```

- `data/keywords_config.json` — 추적할 키워드 목록과 색상/카테고리/설명 (수동 관리)
- `data/categories.json` — 카테고리 이모지/색상/대표 키워드 (수동 관리, 상품 수는 런타임에 자동 집계)
- `data/keyword_trends.json` — **자동 생성**. 네이버 데이터랩 검색어트렌드 API 결과
- `data/new_products.json` — **자동 생성**. 오늘 크롤링에서 발견한 신제품 (매일 덮어씀)
- `data/product_history.json` — **자동 생성**. 크롤러가 발견한 모든 상품을 `firstSeenDate`
  와 함께 최근 30일 롤링 누적. 브랜드별 출시속도·키워드 기회 매트릭스가 이걸 씀
- `data/regulatory_topics.json` — 법규/제도 뉴스 검색에 쓸 주제 목록 (수동 관리)
- `data/news.json` — **자동 생성**. 네이버 뉴스 검색 API 결과. 각 기사는
  `category: "product" | "regulatory"` 로 구분됨
- `data/meta.json` — 마지막 갱신 시각, 데이터 출처 표시

프론트엔드는 `js/data.js`의 `window.loadAppData()`가 위 JSON들을 `fetch()`로 읽어
조립합니다. **`file://`로 직접 열면 fetch가 차단되어 동작하지 않습니다** — 반드시
정적 서버로 서빙하세요.

```bash
python -m http.server 8000
# http://localhost:8000 접속
```

## 로컬에서 데이터 수집 스크립트 실행

```bash
pip install -r scripts/requirements.txt
playwright install chromium

cp .env.example .env   # NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 채워넣기

python scripts/fetch_naver_trends.py      # data/keyword_trends.json 갱신
python scripts/crawl_kurly_products.py    # data/new_products.json, data/product_history.json 갱신
python scripts/fetch_food_news.py         # data/news.json 갱신
```

- 네이버 API 키는 [네이버 개발자센터](https://developers.naver.com/apps/#/register)에서
  애플리케이션 등록 후 발급됩니다. **API 상품을 두 개 등록해야 합니다**
  (앱 선택 → API 설정에서 추가):
  - "데이터랩 > 검색어트렌드" — `fetch_naver_trends.py`용
  - "검색" — `fetch_food_news.py`(뉴스 검색)용. 데이터랩만 등록되어 있으면 이 스크립트는
    401 에러로 실패합니다(안전하게 기존 데이터를 유지하고 종료).
- 세 스크립트 모두 **실패 시 기존 `data/*.json`을 건드리지 않고 종료**합니다. 사이트가
  마지막으로 성공한 데이터를 계속 보여주도록 하기 위함입니다.
- 키워드를 추가/삭제하려면 `data/keywords_config.json`만 수정하면 됩니다 (네이버 API는
  요청당 키워드 그룹 5개 제한이 있어 스크립트가 자동으로 배치 처리합니다).

## GitHub Actions로 매일 자동 갱신

1. 이 프로젝트를 GitHub 저장소로 push 합니다 (아래 "GitHub 저장소 만들기" 참고).
2. 저장소 **Settings → Secrets and variables → Actions**에서 Repository secret 2개를 등록합니다.
   - `NAVER_CLIENT_ID`
   - `NAVER_CLIENT_SECRET`
3. `.github/workflows/update-data.yml`이 매일 07:00 KST(22:00 UTC)에 자동 실행되어
   세 스크립트를 돌리고, 변경된 `data/*.json`을 자동 커밋·푸시합니다. 스크립트 중 하나가
   실패해도(예: 뉴스 검색 API 미등록) 나머지는 계속 진행됩니다.
4. **Actions** 탭에서 "일별 데이터 갱신" 워크플로를 수동 실행(`workflow_dispatch`)해서
   바로 테스트할 수 있습니다.
5. 저장소 **Settings → Pages**에서 정적 사이트로 배포하면 별도 서버 없이도
   `fetch()`가 정상 동작합니다 (GitHub Pages는 http(s)로 서빙되므로).

### GitHub 저장소 만들기 (아직 없다면)

```bash
git init                       # 이미 완료되어 있음
gh repo create <repo-name> --private --source=. --remote=origin
git push -u origin main
```

`gh` CLI가 없다면 github.com에서 새 저장소를 만든 뒤:

```bash
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

## 알려진 한계

- **쿠팡은 포함하지 않습니다.** 일반 HTTP 요청이 403으로 차단되며, 이를 우회하는 것은
  봇탐지/캡차 우회에 해당해 시도하지 않습니다.
- **마켓컬리 크롤러는 페이지 구조에 의존합니다.** Next.js 기반 SPA라 Playwright로
  실제 렌더링해야 하고, 상품 카드의 CSS 클래스 상당수가 해시값(`css-xxxxx`)이라
  배포마다 바뀔 수 있습니다. 가능한 한 안정적인 시맨틱 클래스(`review-count`,
  `price-number`, `sales-price`)와 DOM 구조(태그 순서)에 의존하도록 짰지만, 사이트가
  크게 개편되면 `scripts/crawl_kurly_products.py`의 `EXTRACT_PRODUCTS_JS`를 다시
  확인해야 할 수 있습니다.
- **카테고리 자동 분류는 휴리스틱입니다.** 상품명/설명에 포함된 키워드로 카테고리를
  추정하며(`CATEGORY_HINTS`), 완벽하지 않습니다. 예: 전통 떡류처럼 어떤 힌트에도
  해당하지 않는 상품은 검색 키워드의 기본 카테고리로 폴백합니다.
- **`launchDate`는 실제 출시일이 아니라 "크롤링으로 발견한 날짜"입니다.** 마켓컬리
  검색결과에는 실제 출시일이 노출되지 않습니다. "신상품순" 정렬을 시도하긴 하지만,
  사이트 UI 문구가 바뀌면 정렬 적용이 조용히 실패하고 기본 정렬(추천순) 결과를 씁니다.
- **`rating`(평점)은 항상 `null`입니다.** 검색결과 카드에 평점이 노출되지 않아
  수집하지 않습니다. 프론트엔드는 `rating`이 없으면 별점 표시를 생략합니다.
- **키워드 기회 매트릭스·브랜드 출시속도는 "누적"이 쌓여야 의미가 생깁니다.**
  `data/product_history.json`은 매일 크롤러가 실행될 때마다 새로 발견한 상품을 30일
  롤링으로 누적하는 구조라, 막 시작한 시점(1~2일차)에는 모든 키워드가 거의 같은
  값으로 보일 수 있습니다. 매일 자동 실행이 며칠 쌓이면 키워드/브랜드 간 차이가
  드러나기 시작합니다. UI에도 "데이터 수집 N일째" 라벨로 이 상태를 표시합니다.
- **뉴스 검색은 네이버 앱에 "검색" API가 별도로 등록되어 있어야 동작합니다.**
  데이터랩만 등록된 상태로는 401 에러가 나고, 이때 `data/news.json`은 생성되지
  않은 채로 남아있으며 뉴스 탭은 빈 상태로 표시됩니다(에러 없이 정상 동작).
