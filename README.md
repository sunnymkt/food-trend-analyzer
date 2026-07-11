# FoodTrend AI — 식품 트렌드 분석기

정적 프론트엔드(HTML/CSS/JS + Chart.js) + 파이썬 데이터 수집 스크립트 + GitHub Actions
자동화로 구성된 식품 트렌드 대시보드입니다.

## 데이터 흐름

```
scripts/fetch_naver_trends.py  ──▶  data/keyword_trends.json   ─┐
scripts/crawl_kurly_products.py ──▶ data/new_products.json     ─┼─▶ js/data.js (fetch) ─▶ js/app.js 렌더링
data/categories.json (수동 큐레이션, 정적)                      ─┘
```

- `data/keywords_config.json` — 추적할 키워드 목록과 색상/카테고리/설명 (수동 관리)
- `data/categories.json` — 카테고리 이모지/색상/대표 키워드 (수동 관리, 상품 수는 런타임에 자동 집계)
- `data/keyword_trends.json` — **자동 생성**. 네이버 데이터랩 검색어트렌드 API 결과
- `data/new_products.json` — **자동 생성**. 마켓컬리 검색결과 크롤링 결과
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
python scripts/crawl_kurly_products.py    # data/new_products.json 갱신
```

- 네이버 API 키는 [네이버 개발자센터](https://developers.naver.com/apps/#/register)에서
  애플리케이션 등록 후 "검색 > 데이터랩(검색어트렌드)" API 사용 설정을 하면 발급됩니다.
- 두 스크립트 모두 **실패 시 기존 `data/*.json`을 건드리지 않고 종료**합니다. 사이트가
  마지막으로 성공한 데이터를 계속 보여주도록 하기 위함입니다.
- 키워드를 추가/삭제하려면 `data/keywords_config.json`만 수정하면 됩니다 (네이버 API는
  요청당 키워드 그룹 5개 제한이 있어 스크립트가 자동으로 배치 처리합니다).

## GitHub Actions로 매일 자동 갱신

1. 이 프로젝트를 GitHub 저장소로 push 합니다 (아래 "GitHub 저장소 만들기" 참고).
2. 저장소 **Settings → Secrets and variables → Actions**에서 Repository secret 2개를 등록합니다.
   - `NAVER_CLIENT_ID`
   - `NAVER_CLIENT_SECRET`
3. `.github/workflows/update-data.yml`이 매일 07:00 KST(22:00 UTC)에 자동 실행되어
   두 스크립트를 돌리고, 변경된 `data/*.json`을 자동 커밋·푸시합니다.
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
- **"전주 대비" KPI 변화량은 표시하지 않습니다.** 매일 스냅샷을 덮어쓰는 구조라
  과거 데이터가 남지 않기 때문입니다. 실제 주간 비교가 필요하다면 `data/history/`
  같은 폴더에 날짜별 스냅샷을 누적 저장하도록 워크플로를 확장하면 됩니다.
