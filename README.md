# FoodTrend AI — 식품 트렌드 분석기

정적 프론트엔드(HTML/CSS/JS + Chart.js) + 파이썬 데이터 수집 스크립트 + GitHub Actions
자동화로 구성된 식품 트렌드 대시보드입니다.

## 주요 기능

- **대시보드** — KPI, 급상승 키워드, 3개월 추이, 카테고리 도넛, 최신 신제품
- **트렌드 분석** — 키워드 기회 매트릭스(가로: 검색 변화율, 세로: 최근 30일 누적
  신제품 수 — 오른쪽 아래일수록 "뜨는데 제품은 적은" 기회 구간), 키워드 비교 차트
- **신제품 트래킹** — 카테고리/검색 필터가 있는 신제품 그리드
- **카테고리 분석** — 카테고리별 인기 키워드, 브랜드별 신제품(클릭하면 제품 목록 펼침),
  카테고리별 가격대(최저~최고 + 평균), 브랜드별 신제품 출시속도(최근 30일 누적)
- **업계 뉴스** — 두 섹션: ① 추적 키워드 기준 "OO 신제품" 관련 기사, ② 식품 표시·위생·
  안전 등 법규/제도 변화 기사 (`data/regulatory_topics.json`에서 주제 관리)
- **주간 리포트** — 자동 계산된 하이라이트 + 인사이트, 텍스트로 내보내기. 같은 내용을
  이메일(HTML)로도 발송 가능 (`scripts/generate_weekly_report.py`, 매주 월요일 자동)
- **카테고리별 키워드(지정 키워드)** — 별도로 지정한 32개 키워드(19개 중분류로 그룹핑)의
  최근 3개월 검색 추이를 스파크라인으로 표시. 기존 12개 트렌드 키워드와는 완전히 분리된
  데이터셋으로 관리됩니다 (`data/custom_keywords_config.json`, `scripts/fetch_custom_keyword_trends.py`).
  키워드를 클릭하면 확대 차트와 함께 **관련 인기검색어(네이버 검색광고 API 기준, 검색량
  TOP 50, 25개씩 페이지 이동)** 를 모달로 보여줍니다 (`scripts/fetch_related_keywords.py`)
- **푸드트렌드 위클리(메일)** — 매주 발송되는 이메일 리포트를 카드뉴스 형태로 모아보는
  아카이브. 카드를 클릭하면 그 주에 실제 발송된 메일 HTML 원본을 그대로(iframe) 볼 수
  있습니다. `scripts/generate_weekly_report.py`가 매주 실행될 때마다 자동으로 누적됩니다

## 데이터 흐름

```
scripts/fetch_naver_trends.py   ──▶ data/keyword_trends.json    ─┐
scripts/crawl_kurly_products.py ──▶ data/new_products.json      ─┤
                                 └─▶ data/product_history.json   ─┼─▶ js/data.js (fetch) ─▶ js/app.js 렌더링
scripts/fetch_food_news.py      ──▶ data/news.json              ─┤
scripts/fetch_custom_keyword_trends.py ─▶ data/custom_keyword_trends.json ─┤
scripts/fetch_related_keywords.py      ─▶ data/custom_keyword_related.json ┤
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
- `data/custom_keywords_config.json` — 별도로 지정한 32개 키워드 목록과 중분류 (수동 관리,
  원본: `키워드 검색용 분류.xlsx`). 기존 `keywords_config.json`(12개 트렌드 키워드)과는
  독립적으로 관리됩니다
- `data/custom_keyword_trends.json` — **자동 생성**. 위 32개 키워드의 네이버 데이터랩
  검색어트렌드(최근 3개월) 결과. 중분류별로 그룹핑되어 "카테고리별 키워드" 탭에 표시됨
- `data/custom_keyword_related.json` — **자동 생성**. 위 32개 키워드 각각의 네이버 검색광고
  API "연관키워드" 결과 중 검색량(PC+모바일) 기준 상위 50개. 키워드 클릭 시 뜨는 확대
  모달에서 25개씩 페이지 이동하며 표시됨. 특정 키워드 수집이 실패하면 그 키워드만 이전
  값을 유지하고 나머지는 갱신됩니다
- `data/weekly_reports.json` — **자동 생성**. 매주 발송된 이메일 리포트의 인덱스(날짜,
  주차 라벨, 하이라이트 수치, HTML 파일 경로). "푸드트렌드 위클리(메일)" 카드뉴스 목록이
  이 파일을 읽어 렌더링됩니다
- `data/weekly_reports/<날짜>.html` — **자동 생성**. 그 주에 실제 발송한 이메일 HTML
  원본. 같은 날짜로 재실행하면 그 날짜 항목만 덮어씁니다(중복 누적 안 됨)
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
python scripts/fetch_custom_keyword_trends.py  # data/custom_keyword_trends.json 갱신
python scripts/fetch_related_keywords.py       # data/custom_keyword_related.json 갱신
```

- 지정 키워드를 추가/삭제하려면 `data/custom_keywords_config.json`의 `items` 배열만
  수정하면 됩니다 (`midCategory` + `keyword` 쌍, 네이버 API 5개/요청 제한은 자동 배치 처리).
  디버깅용으로 키워드 하나만 테스트하려면
  `python scripts/fetch_custom_keyword_trends.py --keyword 두부` 처럼 실행할 수 있습니다.
  `fetch_related_keywords.py`도 동일하게 `--keyword` 옵션을 지원합니다.

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

### 관련 인기검색어(네이버 검색광고 API) 설정

`fetch_related_keywords.py`는 **데이터랩과는 완전히 다른 네이버 계정**을 씁니다.

1. [searchad.naver.com](https://searchad.naver.com) 에서 광고주로 회원가입/로그인합니다.
2. 우측 상단 **도구 → API 사용 관리**에서 API 라이선스를 발급받습니다. 다음 3가지 값이
   필요합니다:
   - `NAVER_AD_API_KEY` (Access License)
   - `NAVER_AD_SECRET_KEY` (Secret Key)
   - `NAVER_AD_CUSTOMER_ID` (Customer ID, 숫자)
3. 로컬 `.env`에 위 3개를 채워넣고 `python scripts/fetch_related_keywords.py --keyword 두부`
   로 먼저 테스트해보세요.
4. GitHub Actions에서 자동 수집하려면 저장소 **Settings → Secrets and variables → Actions**
   에도 동일한 3개를 Repository secret으로 등록해야 합니다 (아래 "GitHub Actions" 섹션 참고).
5. 이 API는 키워드 텍스트로 바로 조회하기 때문에(네이버 쇼핑 카테고리 코드 매핑 불필요),
   32개 키워드 각각에 대해 개별 호출합니다(0.3초 간격). 특정 키워드 호출이 실패해도
   그 키워드만 이전 데이터를 유지하고 나머지는 정상 갱신됩니다.
6. 시크릿을 등록하지 않으면 이 스텝은 계속 실패하지만(`continue-on-error: true`),
   나머지 데이터 수집·커밋에는 영향이 없고 "관련 인기검색어" 모달은 빈 상태로 표시됩니다.

## GitHub Actions로 매일 자동 갱신

1. 이 프로젝트를 GitHub 저장소로 push 합니다 (아래 "GitHub 저장소 만들기" 참고).
2. 저장소 **Settings → Secrets and variables → Actions**에서 Repository secret을 등록합니다.
   - `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` — 데이터랩용
   - `NAVER_AD_API_KEY`, `NAVER_AD_SECRET_KEY`, `NAVER_AD_CUSTOMER_ID` — 검색광고(관련
     인기검색어)용. 없어도 나머지 기능은 정상 동작하고, 이 스텝만 실패로 표시됩니다.
3. `.github/workflows/update-data.yml`이 매일 07:00 KST(22:00 UTC)에 자동 실행되어
   다섯 스크립트를 돌리고, 변경된 `data/*.json`을 자동 커밋·푸시합니다. 스크립트 중 하나가
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

## 주간 리포트 이메일 자동 발송

`scripts/generate_weekly_report.py`가 `data/*.json`을 바탕으로 HTML 리포트를 만들어
이메일로 보냅니다. 로컬에서 먼저 확인해보세요:

```bash
python scripts/generate_weekly_report.py --dry-run
# out/weekly_report_preview.html 로 저장됨 (발송 안 함) — 브라우저로 열어서 확인
```

발송을 실제로 해보려면 `.env`에 SMTP 접속정보를 채운 뒤:

```bash
python scripts/generate_weekly_report.py
```

### GitHub Actions로 매주 월요일 자동 발송

1. 저장소 **Settings → Secrets and variables → Actions**에서 Repository secret을 등록합니다.
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `REPORT_RECIPIENTS`
2. `.github/workflows/weekly-report.yml`이 매주 월요일 07:30 KST(일요일 22:30 UTC)에
   자동 실행됩니다. 일별 데이터 갱신(07:00 KST) 직후 최신 데이터로 발송되도록
   30분 여유를 뒀습니다.
3. **Actions** 탭에서 "주간 리포트 이메일 발송" 워크플로를 수동 실행해서 바로 테스트할 수
   있습니다.
4. 리포트는 발송 성공 여부와 무관하게 항상 먼저 `data/weekly_reports/`에 아카이브된 뒤
   이메일 발송을 시도합니다. SMTP 발송이 실패해도(예: 사내망 접속 차단) 워크플로는
   실패로 표시되지만, 그 주의 아카이브 커밋·푸시는 별도로(`if: always()`) 정상 진행되어
   "푸드트렌드 위클리(메일)" 탭에서는 계속 확인할 수 있습니다.

**중요 — 사내 메일서버 사용 시:** GitHub Actions는 외부 클라우드(공인 IP)에서 실행됩니다.
회사 메일서버가 사내망에서만 SMTP 접속을 허용한다면 이 워크플로에서는 발송이 실패합니다.
IT부서에 외부 접속 허용(또는 인증서/화이트리스트) 여부를 확인하세요. 접속이 안 되는
경우, 자체 러너(self-hosted runner)를 사내망에 두거나, Gmail/SendGrid 등 외부에서 확실히
접속되는 서비스로 바꾸는 방법이 있습니다.

### 리포트 발송 로직

- 로고는 `assets/nhfood_logo.jpg`를 base64로 인라인 임베드합니다 (이메일은 외부 이미지
  URL을 차단하는 클라이언트가 많아 인라인이 안전합니다).
- HTML은 클래스 기반 CSS로 작성하지만, 발송/아카이브 직전 `premailer`로 모든 스타일을
  각 태그의 `style=""` 속성에 인라인화합니다. 네이버메일 등 대부분의 웹메일 클라이언트는
  `<style>` 블록 자체를 걸러내기 때문에, 인라인화하지 않으면 레이아웃이 완전히 깨집니다.
  CSS 커스텀 프로퍼티(`var(--x)`)도 `<style>`이 사라지면 함께 무의미해지므로, 인라인화
  전에 실제 값으로 미리 치환합니다(`resolve_css_vars()`).
- 상승/하락 키워드 TOP 5, 기회 키워드(수요 대비 신제품 공급이 적은 키워드), 카테고리별
  신제품 현황, 브랜드 출시속도, 신제품/법규 뉴스 각 3건, 자동 생성 액션 제언 순으로
  구성됩니다 (가격대 섹션은 제외).
- 발송 실패 시(SMTP 오류 등) 워크플로가 실패 상태로 표시되어 Actions 탭에서 바로 확인할
  수 있습니다.

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
