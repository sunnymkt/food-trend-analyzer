// ============================================================
//  js/app.js — 식품 트렌드 분석기 메인 로직
// ============================================================

/* ── 데이터 참조 (init에서 loadAppData 완료 후 채워짐) ────── */
let KEYWORD_DATA, NEW_PRODUCTS, CATEGORIES, BRAND_DATA, WEEKLY_SUMMARY, DATES_30, META;
let KEYWORD_OPPORTUNITY, BRAND_VELOCITY, CATEGORY_PRICE, HISTORY_META, NEWS, CUSTOM_KEYWORD_GROUPS, RELATED_KEYWORDS, WEEKLY_ARCHIVE, HISTORY, REVIEW_DATA;

/* ── 상태 ────────────────────────────────────────────────── */
let currentView = 'dashboard';
let preSearchView = null;
let productFilter = '전체';
let productSearch = '';
let compareKws = ['흑임자', '유자', '제로슈거'];
let selectedCat = '전체';
let selectedBrand = null;
let ckModalRelated = [];
let ckModalRelatedPage = 0;
const CK_RELATED_PAGE_SIZE = 25;
const charts = {};

/* ── Chart.js 공통 설정 ──────────────────────────────────── */
if (window.ChartDataLabels) Chart.register(window.ChartDataLabels);

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 700, easing: 'easeOutQuart' },
  plugins: {
    legend: {
      labels: {
        color: '#334155',
        font: { family: "'Noto Sans KR','Inter',sans-serif", size: 12 },
        usePointStyle: true, pointStyleWidth: 8, padding: 18
      }
    },
    tooltip: {
      backgroundColor: 'rgba(15,23,42,0.95)',
      titleColor: '#ffffff', bodyColor: '#cbd5e1',
      borderColor: 'rgba(255,255,255,.08)', borderWidth: 1,
      cornerRadius: 12, padding: 12,
    },
    datalabels: { display: false } // 차트별로 필요할 때만 켠다 (opportunityChart 등)
  },
  scales: {
    x: {
      grid: { color: 'rgba(15,23,42,.07)', drawBorder: false },
      ticks: { color: '#64748b', font: { size: 11 }, maxTicksLimit: 8 }
    },
    y: {
      grid: { color: 'rgba(15,23,42,.07)', drawBorder: false },
      ticks: { color: '#64748b', font: { size: 11 } }
    }
  }
};

/* ── 유틸리티 ────────────────────────────────────────────── */
function fmt(dateStr) {
  const d = new Date(dateStr);
  return `${d.getMonth()+1}/${d.getDate()}`;
}
function isNew(dateStr, days=11) {
  const diff = (new Date() - new Date(dateStr)) / 86400000;
  return diff <= days;
}
function catTagClass(cat) {
  const map = { 라면:'tag-r', 스낵:'tag-o', 음료:'tag-b', 간편식:'tag-p', 제과:'tag-y', 빙과:'tag-g', 유제품:'tag-gr', 베이커리:'tag-r', 건강식품:'tag-g', 건강기능식품:'tag-g' };
  return map[cat] || 'tag-b';
}
function animNum(el, target, dur=1000) {
  if(!el) return;
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min((now-start)/dur, 1);
    const ease = 1 - Math.pow(1-p, 3);
    el.textContent = Math.round(target * ease).toLocaleString();
    if(p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function destroyChart(key) {
  if(charts[key]) { charts[key].destroy(); delete charts[key]; }
}

/* ── 네비게이션 ──────────────────────────────────────────── */
function navigate(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const view = document.getElementById(viewId);
  const navEl = document.querySelector(`[data-view="${viewId}"]`);
  if(view) view.classList.add('active');
  if(navEl) navEl.classList.add('active');
  currentView = viewId;

  // URL 해시를 갱신해서 이 화면을 북마크·공유할 수 있게 한다 (예: 위클리 메일에서 바로 연결).
  // replaceState를 쓰면 hashchange 이벤트가 발생하지 않아 navigate()가 재귀 호출되지 않는다.
  if (location.hash.slice(1) !== viewId) {
    history.replaceState(null, '', `#${viewId}`);
  }

  const TITLES = {
    dashboard: ['📊 대시보드',      '오늘의 식품 트렌드 종합 현황'],
    trends:    ['📈 키워드 비교분석', '키워드 3개월 시계열 비교'],
    products:  ['🆕 신제품(마켓컬리)', '일별 신제품 모니터링'],
    category:  ['🗂️ 카테고리 분석', '카테고리별 키워드 심층 분석'],
    reviews:   ['💬 상품 리뷰 분석', '네이버 브랜드관 리뷰 기반 상품별 분석'],
    report:    ['📋 데일리 리포트',   '자동 생성 인사이트 리포트'],
    news:      ['📰 업계뉴스(식품/법규)', '식품 신제품 관련 최신 기사'],
    customKeywords: ['🧾 카테고리별 인기검색어', '별도 지정 키워드 3개월 검색 추이'],
    weeklyArchive: ['💌 푸드 트렌드 위클리(메일)', '매주 발송된 이메일 리포트 아카이브'],
    searchResults: ['🔍 검색 결과', '전체 탭 통합 검색'],
  };
  if(TITLES[viewId]) {
    document.getElementById('topbar-title').textContent = TITLES[viewId][0];
    document.getElementById('topbar-sub').textContent   = TITLES[viewId][1];
  }

  setTimeout(() => {
    if(viewId === 'dashboard') renderDashboard();
    if(viewId === 'trends')    renderTrends();
    if(viewId === 'category')  renderCategory(selectedCat);
    if(viewId === 'reviews')   renderReviews();
    if(viewId === 'news')      renderNews();
    if(viewId === 'customKeywords') renderCustomKeywords();
    if(viewId === 'weeklyArchive') renderWeeklyArchive();
    if(viewId === 'searchResults') renderSearchResults();
  }, 30);

  closeMobileSidebar();
}

/* ── 모바일 사이드바 열기/닫기 ────────────────────────────── */
function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar && sidebar.classList.contains('mobile-open')) closeMobileSidebar();
  else openMobileSidebar();
}
function openMobileSidebar() {
  document.getElementById('sidebar')?.classList.add('mobile-open');
  document.getElementById('sidebarBackdrop')?.classList.add('show');
}
function closeMobileSidebar() {
  document.getElementById('sidebar')?.classList.remove('mobile-open');
  document.getElementById('sidebarBackdrop')?.classList.remove('show');
}

/* ════════════════════════════════════════════════════════════
   DASHBOARD
   ════════════════════════════════════════════════════════════ */
function renderDashboard() {
  const risingCount = Object.values(KEYWORD_DATA).filter(d => d.changeRate > 0).length;
  setTimeout(() => {
    animNum(document.getElementById('kpi-kw'),   Object.keys(KEYWORD_DATA).length);
    animNum(document.getElementById('kpi-prod'), NEW_PRODUCTS.length);
    animNum(document.getElementById('kpi-rise'), risingCount);
  }, 80);
  renderDashboardSummary();
  renderTopKeywordBadges();
  renderMainChart();
  renderDonut();
  renderRankings();
  renderLatestMini();
}

/* 대시보드 상단 "오늘의 요약" — 데일리 리포트의 상승/하락 키워드·최다 카테고리·뉴스만 발췌 */
function renderDashboardSummary() {
  const metaEl = document.getElementById('db-summaryMeta');
  if (metaEl) {
    metaEl.innerHTML = `📅 ${WEEKLY_SUMMARY.period}&nbsp;&nbsp;|&nbsp;&nbsp;🆕 신제품 ${WEEKLY_SUMMARY.newProducts}개`;
  }

  const topKw = WEEKLY_SUMMARY.topKeyword, topKwData = topKw ? KEYWORD_DATA[topKw] : null;
  setText('db-hl-top-kw', topKw || '-');
  setText('db-hl-top-kw-val', topKwData ? `${topKwData.changeRate >= 0 ? '+' : ''}${topKwData.changeRate}%` : '-');

  const topCat = WEEKLY_SUMMARY.topCategory, topCatData = topCat ? CATEGORIES[topCat] : null;
  setText('db-hl-top-cat', topCat || '-');
  setText('db-hl-top-cat-val', topCatData ? `${topCatData.count}개` : '-');

  const worstKw = WEEKLY_SUMMARY.worstKeyword, worstKwData = worstKw ? KEYWORD_DATA[worstKw] : null;
  setText('db-hl-worst-kw', worstKw || '-');
  setText('db-hl-worst-kw-val', worstKwData ? `${worstKwData.changeRate}%` : '-');

  renderReportNewsSection(NEWS.filter(n => (n.category || 'product') === 'product'), 'db-reportNewsProduct', 'tag-o');
  renderReportNewsSection(NEWS.filter(n => n.category === 'regulatory'), 'db-reportNewsRegulatory', 'tag-r');
}

/* 급상승 키워드 TOP 10 뱃지 */
function renderTopKeywordBadges() {
  const el = document.getElementById('topKwBadges');
  if(!el) return;
  const sorted = Object.entries(KEYWORD_DATA)
    .sort((a,b) => b[1].changeRate - a[1].changeRate)
    .slice(0,10);
  el.innerHTML = sorted.map(([kw,d],i) => `
    <div class="kw-badge ${i<3?'t1':i<7?'t2':'t3'}">
      <span class="rank">#${i+1}</span>${kw}<span class="pct">${d.changeRate>=0?'+':''}${d.changeRate}%</span>
    </div>
  `).join('');
}

/* 최근 1개월 라인 차트 */
function renderMainChart() {
  const ctx = document.getElementById('mainChart');
  if(!ctx) return;
  destroyChart('main');
  const KWS = ['흑임자','유자','제로슈거','마라','트러플'];
  charts.main = new Chart(ctx, {
    type:'line',
    data:{
      labels: DATES_30.slice(-30),
      datasets: KWS.map(kw => {
        const d = KEYWORD_DATA[kw];
        return {
          label:kw, data:d.data.slice(-30), borderColor:d.color, backgroundColor:d.color+'18',
          borderWidth:2.5, tension:.42, fill:false,
          pointRadius:0, pointHoverRadius:6,
          pointHoverBackgroundColor:d.color, pointHoverBorderColor:'#fff', pointHoverBorderWidth:2,
        };
      })
    },
    options:{
      ...CHART_DEFAULTS,
      interaction:{ mode:'index', intersect:false },
      plugins:{
        ...CHART_DEFAULTS.plugins,
        legend:{ ...CHART_DEFAULTS.plugins.legend, position:'top' }
      }
    }
  });
}

/* 카테고리 도넛 차트 */
function renderDonut() {
  const ctx = document.getElementById('donutChart');
  if(!ctx) return;
  destroyChart('donut');
  const cats = Object.entries(CATEGORIES).filter(([k]) => k !== '전체');
  charts.donut = new Chart(ctx, {
    type:'doughnut',
    data:{
      labels: cats.map(([k]) => k),
      datasets:[{
        data: cats.map(([,v]) => v.count),
        backgroundColor: cats.map(([,v]) => v.color+'cc'),
        borderColor: cats.map(([,v]) => v.color),
        borderWidth:1.5, hoverOffset:10,
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false, cutout:'64%',
      animation:{ duration:900, easing:'easeOutQuart' },
      plugins:{
        legend:{
          position:'right',
          labels:{ color:'#334155', font:{family:"'Noto Sans KR','Inter',sans-serif",size:11}, padding:10, usePointStyle:true, pointStyleWidth:8 }
        },
        tooltip:{
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks:{ label: ctx => ` ${ctx.label}: ${ctx.raw}개 신제품` }
        },
        datalabels:{ display:false }
      }
    }
  });
}

/* 키워드 상승률 랭킹 */
function renderRankings() {
  const el = document.getElementById('rankings');
  if(!el) return;
  const sorted = Object.entries(KEYWORD_DATA)
    .filter(([,v]) => v.changeRate > 0)
    .sort((a,b) => b[1].changeRate - a[1].changeRate)
    .slice(0,10);
  const max = sorted[0][1].changeRate;
  el.innerHTML = sorted.map(([kw,d],i) => `
    <div class="rank-item">
      <div class="rank-num ${i<3?'gold':''}">${i+1}</div>
      <div class="rank-bar-wrap">
        <div class="rank-name">${kw}</div>
        <div class="rank-bar"><div class="rank-fill" style="width:0" data-w="${(d.changeRate/max*100).toFixed(1)}"></div></div>
      </div>
      <div class="rank-val">+${d.changeRate}%</div>
    </div>
  `).join('');
  setTimeout(() => {
    el.querySelectorAll('.rank-fill').forEach(b => { b.style.width = b.dataset.w + '%'; });
  }, 150);
}

/* 최신 신제품 미니 리스트 */
function renderLatestMini() {
  const el = document.getElementById('latestMini');
  if(!el) return;
  el.innerHTML = NEW_PRODUCTS.slice(0,5).map(p => `
    <div class="mini-row">
      <div class="mini-left">
        <span class="mini-emoji">${p.emoji}</span>
        <div>
          ${p.url
            ? `<a href="${p.url}" target="_blank" rel="noopener noreferrer" class="mini-name">${p.name}</a>`
            : `<div class="mini-name">${p.name}</div>`}
          <div class="mini-brand">${p.brand} · ${fmt(p.launchDate)}</div>
        </div>
      </div>
      <span class="tag ${catTagClass(p.category)}">${p.category}</span>
    </div>
  `).join('');
}

/* ════════════════════════════════════════════════════════════
   TRENDS (키워드 비교)
   ════════════════════════════════════════════════════════════ */
function renderTrends() {
  renderOpportunityMatrix();
  renderKwSelector();
  renderCompareChart();
  renderKwCards();
}

/* 키워드 기회 매트릭스: x=검색 변화율, y=누적 신제품 수 */
function renderOpportunityMatrix() {
  const ctx = document.getElementById('opportunityChart');
  if(!ctx) return;
  destroyChart('opportunity');

  const metaEl = document.getElementById('opportunityMeta');
  if(metaEl) {
    metaEl.textContent = HISTORY_META.daysTracked > 0
      ? `데이터 수집 ${HISTORY_META.daysTracked}일째 (${HISTORY_META.firstSeenDate}~) · 누적될수록 정확해집니다`
      : '데이터 수집 시작 전';
  }

  const avgY = KEYWORD_OPPORTUNITY.reduce((s,d) => s + d.productCount, 0) / (KEYWORD_OPPORTUNITY.length || 1);

  const quadrantGuides = {
    id: 'quadrantGuides',
    beforeDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if(!chartArea) return;
      const xZero = scales.x.getPixelForValue(0);
      const yAvg  = scales.y.getPixelForValue(avgY);
      ctx.save();
      ctx.strokeStyle = 'rgba(15,23,42,.15)';
      ctx.setLineDash([4,4]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xZero, chartArea.top); ctx.lineTo(xZero, chartArea.bottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(chartArea.left, yAvg); ctx.lineTo(chartArea.right, yAvg); ctx.stroke();
      ctx.restore();
    }
  };

  charts.opportunity = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [{
        label: '키워드',
        data: KEYWORD_OPPORTUNITY.map(d => ({ x: d.changeRate, y: d.productCount, kw: d.keyword })),
        backgroundColor: KEYWORD_OPPORTUNITY.map(d => d.color),
        borderColor: '#fcfcfb', borderWidth: 2,
        pointRadius: 8, pointHoverRadius: 10,
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: false },
        datalabels: {
          display: true,
          align: 'top', offset: 6,
          color: '#334155',
          font: { size: 11, weight: '500', family: "'Noto Sans KR','Inter',sans-serif" },
          formatter: (v) => v.kw,
        },
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            label: (c) => ` ${c.raw.kw}: 변화율 ${c.raw.x>=0?'+':''}${c.raw.x}% · 누적 신제품 ${c.raw.y}개`
          }
        }
      },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x, title: { display:true, text:'검색 지수 변화율 (%)', color:'#64748b', font:{size:11} } },
        y: { ...CHART_DEFAULTS.scales.y, beginAtZero:true, title: { display:true, text:'누적 신제품 수', color:'#64748b', font:{size:11} } }
      }
    },
    plugins: [quadrantGuides]
  });
}

function renderKwSelector() {
  const el = document.getElementById('kwSelector');
  if(!el) return;
  el.innerHTML = Object.entries(KEYWORD_DATA).map(([kw,d]) => {
    const sel = compareKws.includes(kw);
    return `
      <div class="filter-btn ${sel?'active':''}" onclick="toggleKw('${kw}')" style="cursor:pointer;">
        ${kw}&nbsp;
        <span class="${d.changeRate>=0?'t-up':'t-down'}">${d.changeRate>=0?'+':''}${d.changeRate}%</span>
      </div>`;
  }).join('');
}

function renderCompareChart() {
  const ctx = document.getElementById('compareChart');
  if(!ctx) return;
  destroyChart('compare');
  charts.compare = new Chart(ctx, {
    type:'line',
    data:{
      labels: DATES_30,
      datasets: compareKws.map(kw => {
        const d = KEYWORD_DATA[kw];
        if(!d) return null;
        return {
          label:kw, data:d.data, borderColor:d.color, backgroundColor:d.color+'22',
          borderWidth:2.5, tension:.42, fill:true,
          pointRadius:0, pointHoverRadius:6,
          pointHoverBackgroundColor:d.color, pointHoverBorderColor:'#fff', pointHoverBorderWidth:2,
        };
      }).filter(Boolean)
    },
    options:{
      ...CHART_DEFAULTS,
      interaction:{ mode:'index', intersect:false },
    }
  });
}

function renderKwCards() {
  const el = document.getElementById('kwCards');
  if(!el) return;
  const sorted = Object.entries(KEYWORD_DATA).sort((a,b) => b[1].changeRate - a[1].changeRate);
  el.innerHTML = sorted.map(([kw,d]) => `
    <div class="card" style="cursor:pointer;" onclick="toggleKw('${kw}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
        <div>
          <div style="font-size:15px;font-weight:900;color:var(--text-primary)">${kw}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${d.category}</div>
        </div>
        <div style="font-size:19px;font-weight:900;color:${d.changeRate>=0?'var(--accent)':'var(--rose)'}">
          ${d.changeRate>=0?'+':''}${d.changeRate}%
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:12px;">${d.description}</div>
      <div class="prog"><div class="prog-fill" style="width:${Math.min(100,Math.abs(d.changeRate)/2.5)}%;background:${d.color}"></div></div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:7px;">최신 지수: <strong style="color:${d.color}">${d.data[d.data.length-1]}</strong></div>
    </div>
  `).join('');
}

function toggleKw(kw) {
  if(compareKws.includes(kw)) {
    if(compareKws.length > 1) compareKws = compareKws.filter(k => k !== kw);
  } else {
    if(compareKws.length >= 5) compareKws.shift();
    compareKws.push(kw);
  }
  renderTrends();
}

/* ════════════════════════════════════════════════════════════
   PRODUCTS (신제품 트래킹)
   ════════════════════════════════════════════════════════════ */
function renderProducts() {
  const el = document.getElementById('productsGrid');
  if(!el) return;

  let list = [...NEW_PRODUCTS];
  if(productFilter !== '전체') list = list.filter(p => p.category === productFilter);
  if(productSearch) {
    const q = productSearch.trim().toLowerCase();
    list = list.filter(p =>
      p.name.includes(productSearch) ||
      p.brand.includes(productSearch) ||
      p.keywords.some(k => k.includes(productSearch)) ||
      p.category.includes(productSearch)
    );
  }

  if(!list.length) {
    el.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🔍</div><h3>검색 결과 없음</h3><p>다른 키워드로 검색해보세요</p></div>`;
    return;
  }

  el.innerHTML = list.map(p => `
    <div class="product-card">
      ${p.url
        ? `<a href="${p.url}" target="_blank" rel="noopener noreferrer" class="p-name">${p.name}</a>`
        : `<div class="p-name">${p.name}</div>`}
      <div class="p-brand">${p.brand}</div>
      <div class="p-tags">
        <span class="tag ${catTagClass(p.category)}">${p.category}</span>
        ${p.keywords.map(k => `<span class="tag tag-b">#${k}</span>`).join('')}
      </div>
      <div class="p-footer">
        <div class="p-date">📅 ${fmt(p.launchDate)}</div>
        <div class="p-price">${p.price}</div>
      </div>
      <div class="p-rating">${p.rating != null ? `⭐ ${p.rating} · ` : ''}${p.origin && p.origin !== '-' ? p.origin : p.channel}</div>
    </div>
  `).join('');
}

function setProductFilter(f) {
  productFilter = f;
  document.querySelectorAll('.pf-btn').forEach(b => b.classList.toggle('active', b.dataset.f === f));
  renderProducts();
}

/* ════════════════════════════════════════════════════════════
   CATEGORY (카테고리 분석)
   ════════════════════════════════════════════════════════════ */
function renderCategoryCards() {
  const el = document.getElementById('catCards');
  if(!el) return;
  el.innerHTML = Object.entries(CATEGORIES).map(([name,d]) => `
    <div class="cat-card ${selectedCat===name?'active':''}" data-cat="${name}" onclick="renderCategory('${name}')">
      <span class="cat-emoji">${d.emoji}</span>
      <div class="cat-name">${name}</div>
      <div class="cat-count">${d.count}개</div>
    </div>
  `).join('');
}

function renderCategory(cat) {
  selectedCat = cat;
  selectedBrand = null;
  renderCategoryCards();
  renderCatKeywordChart(cat);
  renderCatBrandStats(cat);
  renderPriceRangeChart();
  renderBrandVelocityChart();
}

/* 카테고리별 가격대: 최저~최고 범위 바 + 평균가 점 */
function renderPriceRangeChart() {
  const ctx = document.getElementById('priceRangeChart');
  if(!ctx) return;
  destroyChart('priceRange');
  if(!CATEGORY_PRICE.length) return;

  charts.priceRange = new Chart(ctx, {
    data: {
      labels: CATEGORY_PRICE.map(d => d.category),
      datasets: [
        {
          type: 'bar',
          label: '가격 범위',
          data: CATEGORY_PRICE.map(d => [d.min, d.max]),
          backgroundColor: 'rgba(37,99,235,.35)',
          borderColor: '#2563eb', borderWidth: 1,
          borderRadius: 6, borderSkipped: false,
        },
        {
          type: 'line',
          label: '평균가',
          data: CATEGORY_PRICE.map(d => d.avg),
          showLine: false,
          pointBackgroundColor: '#ea580c',
          pointBorderColor: '#fcfcfb', pointBorderWidth: 2,
          pointRadius: 6, pointHoverRadius: 8,
        }
      ]
    },
    options: {
      ...CHART_DEFAULTS,
      indexAxis: 'y',
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: true, position: 'top', labels: { ...CHART_DEFAULTS.plugins.legend.labels, boxWidth: 10 } },
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            label: (c) => {
              const d = CATEGORY_PRICE[c.dataIndex];
              return c.datasetIndex === 0
                ? ` 범위: ${d.min.toLocaleString()}원 ~ ${d.max.toLocaleString()}원 (${d.count}개)`
                : ` 평균: ${d.avg.toLocaleString()}원`;
            }
          }
        }
      },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x, ticks: { ...CHART_DEFAULTS.scales.x.ticks, callback: v => v.toLocaleString()+'원' } },
        y: { ...CHART_DEFAULTS.scales.y, grid: { display:false } }
      }
    }
  });
}

/* 브랜드별 신제품 출시속도 (최근 30일 누적, 전체 카테고리 기준) */
function renderBrandVelocityChart() {
  const ctx = document.getElementById('brandVelocityChart');
  if(!ctx) return;
  destroyChart('brandVelocity');

  const metaEl = document.getElementById('velocityMeta');
  if(metaEl) {
    metaEl.textContent = HISTORY_META.daysTracked > 0
      ? `최근 ${HISTORY_META.daysTracked}일 누적 · 전체 카테고리`
      : '데이터 수집 시작 전';
  }

  if(!BRAND_VELOCITY.length) return;

  charts.brandVelocity = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: BRAND_VELOCITY.map(d => d.brand),
      datasets: [{
        label: '신제품 발견 건수',
        data: BRAND_VELOCITY.map(d => d.count),
        backgroundColor: 'rgba(234,88,12,.55)',
        borderColor: '#ea580c', borderWidth: 1,
        borderRadius: 6, borderSkipped: false,
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      indexAxis: 'y',
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const brand = BRAND_VELOCITY[elements[0].index]?.brand;
        if (brand) openBrandVelocityModal(brand);
      },
      onHover: (evt, elements) => {
        if (evt.native?.target) evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
      plugins: { ...CHART_DEFAULTS.plugins, legend: { display:false } },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x, beginAtZero:true, ticks: { ...CHART_DEFAULTS.scales.x.ticks, stepSize:1 } },
        y: { ...CHART_DEFAULTS.scales.y, grid: { display:false } }
      }
    }
  });
}

/* 브랜드별 신제품 출시속도 차트 바 클릭 → 해당 브랜드 신제품 목록 모달 */
function openBrandVelocityModal(brand) {
  const modal = document.getElementById('brandModal');
  if (!modal) return;

  const products = (HISTORY || [])
    .filter(p => p.brand === brand)
    .sort((a, b) => (b.firstSeenDate || '').localeCompare(a.firstSeenDate || ''));

  document.getElementById('brandModalTitle').textContent = brand;
  document.getElementById('brandModalMeta').textContent =
    `최근 ${HISTORY_META.daysTracked}일 누적 · 신제품 ${products.length}개`;

  const listEl = document.getElementById('brandModalList');
  listEl.innerHTML = products.length
    ? products.map((p, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;${i < products.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}">
        ${p.url
          ? `<a href="${p.url}" target="_blank" rel="noopener noreferrer" class="mini-name">${p.emoji || ''} ${p.name}</a>`
          : `<span style="font-size:13px;font-weight:600;color:var(--text-primary);">${p.emoji || ''} ${p.name}</span>`}
        <span style="color:var(--text-muted);font-size:12px;white-space:nowrap;">${p.price || '-'}</span>
      </div>
    `).join('')
    : `<p style="color:var(--text-muted);font-size:13px;padding:12px 0;">등록된 제품 정보가 없습니다.</p>`;

  modal.classList.remove('hidden');
}

function closeBrandModal() {
  const modal = document.getElementById('brandModal');
  if (modal) modal.classList.add('hidden');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBrandModal(); });

/* ════════════════════════════════════════════════════════════
   상품 리뷰 분석 (네이버 브랜드관 리뷰 — 수동 업로드 → process_reviews.py 결과물)
   ════════════════════════════════════════════════════════════ */
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function negativeSignalSum(p) {
  return Object.values(p.signals?.negative || {}).reduce((a, b) => a + b, 0);
}
function positiveSignalSum(p) {
  return Object.values(p.signals?.positive || {}).reduce((a, b) => a + b, 0);
}

function renderReviews() {
  const hlEl = document.getElementById('reviewHlGrid');
  const metaEl = document.getElementById('reviewMeta');
  const listWrap = document.getElementById('reviewListWrap');
  if (!hlEl || !listWrap) return;

  if (!REVIEW_DATA || !Array.isArray(REVIEW_DATA.products) || !REVIEW_DATA.products.length) {
    if (metaEl) metaEl.textContent = '-';
    hlEl.innerHTML = '';
    listWrap.innerHTML = `
      <div class="empty">
        <div class="empty-icon">💬</div>
        <h3>아직 리뷰 데이터가 없습니다</h3>
        <p>네이버 브랜드관에서 리뷰 엑셀을 받아 <code>python scripts/process_reviews.py --input 파일경로</code> 를
        실행하면 <code>data/product_reviews.json</code>이 생성되어 이 화면에 표시됩니다.</p>
      </div>`;
    return;
  }

  if (metaEl) {
    metaEl.textContent = `${REVIEW_DATA.periodStart || '-'} ~ ${REVIEW_DATA.periodEnd || '-'} 기준`;
  }

  hlEl.innerHTML = `
    <div class="card"><div class="hl-mini-label">총 리뷰 수</div><div class="hl-mini-value num">${REVIEW_DATA.totalReviews.toLocaleString()}</div></div>
    <div class="card"><div class="hl-mini-label">분석 상품 수</div><div class="hl-mini-value num">${REVIEW_DATA.totalProducts.toLocaleString()}</div></div>
    <div class="card"><div class="hl-mini-label">전체 평균 평점</div><div class="hl-mini-value">⭐ ${REVIEW_DATA.avgRatingOverall ?? '-'}</div></div>
    <div class="card"><div class="hl-mini-label">조사 기간</div><div class="hl-mini-value" style="font-size:15px;">${REVIEW_DATA.periodStart || '-'}<br>~ ${REVIEW_DATA.periodEnd || '-'}</div></div>
  `;

  renderReviewList();
}

function renderReviewList() {
  const listWrap = document.getElementById('reviewListWrap');
  if (!listWrap || !REVIEW_DATA) return;

  const searchEl = document.getElementById('reviewSearchInput');
  const sortEl = document.getElementById('reviewSortSelect');
  const query = (searchEl?.value || '').trim().toLowerCase();
  const sortMode = sortEl?.value || 'reviewCount';

  let items = REVIEW_DATA.products;
  if (query) {
    items = items.filter(p => p.productName.toLowerCase().includes(query));
  }

  items = [...items];
  switch (sortMode) {
    case 'negativeSignals':
      items.sort((a, b) => negativeSignalSum(b) - negativeSignalSum(a));
      break;
    case 'avgRatingAsc':
      items.sort((a, b) => (a.avgRating ?? 99) - (b.avgRating ?? 99));
      break;
    case 'avgRatingDesc':
      items.sort((a, b) => (b.avgRating ?? -1) - (a.avgRating ?? -1));
      break;
    default:
      items.sort((a, b) => b.reviewCount - a.reviewCount);
  }

  if (!items.length) {
    listWrap.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div><h3>검색 결과가 없습니다</h3></div>`;
    return;
  }

  listWrap.innerHTML = items.map(p => reviewRowHtml(p)).join('');
}

function reviewRowHtml(p) {
  const negSum = negativeSignalSum(p);
  const posSum = positiveSignalSum(p);
  const badges = [
    p.photoReviewCount ? `<span class="review-badge pos">📷 포토 ${p.photoReviewCount}</span>` : '',
    posSum ? `<span class="review-badge pos">👍 긍정신호 ${posSum}</span>` : '',
    negSum ? `<span class="review-badge neg">⚠️ 부정신호 ${negSum}</span>` : '',
  ].join('');

  return `
    <div class="review-row" onclick="openReviewModal(${p.productId})">
      <div style="flex:1;min-width:0;">
        <div class="review-row-name">${escHtml(p.productName)}</div>
        <div class="review-row-meta">리뷰 ${p.reviewCount.toLocaleString()}건 · ${p.firstReviewDate || '-'} ~ ${p.lastReviewDate || '-'}</div>
      </div>
      <div class="review-row-badges">${badges}</div>
      <div class="review-row-rating num">⭐ ${p.avgRating ?? '-'}</div>
    </div>
  `;
}

const REVIEW_SUGGESTION_MAP = {
  positive: {
    '재구매의향': '재구매 의향 언급이 눈에 띕니다 — 정기구독·묶음구성 상품 기획을 검토해볼 만합니다.',
    '맛만족': '맛에 대한 만족도가 높습니다 — 관련 리뷰 문구를 상세페이지·마케팅 카피에 활용해보세요.',
    '가성비만족': '가격 대비 만족도가 높습니다 — 현재 가격 정책 유지 또는 프리미엄 라인 확장을 고려해볼 수 있습니다.',
    '브랜드신뢰': '농협·국내산이라는 신뢰가 구매 이유로 작용하고 있습니다 — 원산지·브랜드 신뢰를 내세운 마케팅이 효과적일 수 있습니다.',
  },
  negative: {
    '재구매거부': '재구매 거부 의사가 감지됩니다 — 부정 리뷰 원문을 확인해 근본 원인 파악과 빠른 대응이 필요합니다.',
    '맛불만': '맛(단맛·짠맛·식감 등)에 대한 불만이 있습니다 — 레시피·배합비 재검토를 고려해보세요.',
    '품질이슈': '파손·이물질 등 품질 이슈가 감지됩니다 — 포장재 강화 및 생산·검수 공정 점검이 필요합니다.',
    '배송이슈': '배송 지연·파손 언급이 있습니다 — 물류사 및 완충 포장 개선을 검토해보세요.',
  },
};

function buildReviewSuggestions(p) {
  const total = p.reviewCount || 1;
  const suggestions = [];

  if (p.avgRating != null && p.avgRating < 4.0) {
    suggestions.push({ level: 'neg', priority: 999, text: `평균 평점이 ${p.avgRating}점으로 낮은 편입니다 — 상품 전반의 품질·만족도 점검이 시급합니다.` });
  }

  Object.entries(p.signals?.negative || {}).forEach(([label, count]) => {
    if (!count) return;
    const ratio = count / total;
    if (count >= 5 || ratio >= 0.03) {
      suggestions.push({
        level: 'neg', priority: count,
        text: REVIEW_SUGGESTION_MAP.negative[label] || `'${label}' 관련 리뷰가 ${count}건 있습니다 — 확인이 필요합니다.`,
      });
    }
  });

  const posEntries = Object.entries(p.signals?.positive || {}).filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);
  if (posEntries.length) {
    const [label, count] = posEntries[0];
    if (count / total >= 0.15) {
      suggestions.push({
        level: 'pos', priority: count,
        text: REVIEW_SUGGESTION_MAP.positive[label] || `'${label}' 언급이 많습니다 (${count}건) — 강점으로 활용해보세요.`,
      });
    }
  }

  suggestions.sort((a, b) => (a.level === b.level ? b.priority - a.priority : (a.level === 'neg' ? -1 : 1)));
  return suggestions.slice(0, 4);
}

let currentReviewProductId = null;

function reviewSnippetHtml(item, kind) {
  return `
    <div class="rv-snippet">
      <div class="rv-snippet-meta">
        <span>⭐${item.rating}</span><span>·</span><span>${item.date || '-'}</span>
        ${item.photo ? '<span>· 📷 포토리뷰</span>' : ''}
        ${kind === 'pos' && item.best ? '<span>· 🏆 베스트리뷰</span>' : ''}
      </div>
      <div>${escHtml(item.text)}</div>
    </div>`;
}

function selectReviewSignal(level, label) {
  const p = REVIEW_DATA?.products?.find(x => x.productId === currentReviewProductId);
  if (!p) return;

  const containerId = level === 'positive' ? 'reviewPosSignalDetail' : 'reviewNegSignalDetail';
  const container = document.getElementById(containerId);
  if (!container) return;

  const examples = p.signalExamples?.[level]?.[label] || [];
  const kind = level === 'positive' ? 'pos' : 'neg';
  container.innerHTML = examples.length
    ? `<div class="rv-signal-detail-title">'${escHtml(label)}' 관련 리뷰 ${examples.length}건</div>` +
      examples.map(i => reviewSnippetHtml(i, kind)).join('')
    : `<div style="font-size:12px;color:var(--text-muted);">'${escHtml(label)}' 관련 리뷰 예시가 없습니다.</div>`;

  // 클릭한 칩에 active 표시 (같은 섹션의 다른 칩은 해제)
  const section = container.previousElementSibling;
  if (section) {
    section.querySelectorAll('.rv-signal-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.label === label);
    });
  }
}

function openReviewModal(productId) {
  const modal = document.getElementById('reviewModal');
  const p = REVIEW_DATA?.products?.find(x => x.productId === productId);
  if (!modal || !p) return;
  currentReviewProductId = productId;

  document.getElementById('reviewModalTitle').textContent = p.productName;
  document.getElementById('reviewModalMeta').textContent =
    `리뷰 ${p.reviewCount.toLocaleString()}건 · 평균 ⭐${p.avgRating ?? '-'} · ${p.firstReviewDate || '-'} ~ ${p.lastReviewDate || '-'}` +
    (p.bestReviewCount ? ` · 베스트리뷰 ${p.bestReviewCount}건` : '');

  const suggestions = buildReviewSuggestions(p);
  const suggestionsHtml = suggestions.length
    ? suggestions.map(s => `<div class="rv-suggestion ${s.level}">${s.level === 'neg' ? '⚠️' : '💡'} ${escHtml(s.text)}</div>`).join('')
    : `<div style="font-size:12px;color:var(--text-muted);">뚜렷한 이슈나 제안 포인트가 감지되지 않았습니다.</div>`;

  const maxCount = Math.max(1, ...Object.values(p.ratingDistribution || {}));
  const ratingBars = [5, 4, 3, 2, 1].map(star => {
    const count = p.ratingDistribution?.[String(star)] || 0;
    return `
      <div class="rv-rating-bar-row">
        <span class="rv-rating-bar-star">★${star}</span>
        <div class="rv-rating-bar-track"><div class="rv-rating-bar-fill" style="width:${Math.round(count / maxCount * 100)}%"></div></div>
        <span class="rv-rating-bar-count num">${count}</span>
      </div>`;
  }).join('');

  const signalChips = (signals, level, cls, emptyLabel) => {
    const entries = Object.entries(signals || {}).filter(([, n]) => n > 0);
    if (!entries.length) return `<div style="font-size:12px;color:var(--text-muted);">${emptyLabel}</div>`;
    return `<div class="rv-signal-chips">${entries.map(([label, n]) =>
      `<span class="rv-signal-chip ${cls} clickable" data-label="${escHtml(label)}" onclick="selectReviewSignal('${level}', '${label}')">${escHtml(label)} <span class="n">${n}</span></span>`
    ).join('')}</div>`;
  };

  const positiveSection = p.topPositive?.length
    ? p.topPositive.map(i => reviewSnippetHtml(i, 'pos')).join('')
    : `<div style="font-size:12px;color:var(--text-muted);">표시할 호평 리뷰가 없습니다.</div>`;
  const negativeSection = p.topNegative?.length
    ? p.topNegative.map(i => reviewSnippetHtml(i, 'neg')).join('')
    : `<div style="font-size:12px;color:var(--text-muted);">낮은 평점 리뷰가 없습니다.</div>`;

  document.getElementById('reviewModalBody').innerHTML = `
    <div class="rv-signal-section">
      <div class="rv-signal-title">🎯 상품기획 제안</div>
      ${suggestionsHtml}
    </div>

    <div class="rv-rating-bars">${ratingBars}</div>

    <div class="rv-signal-section">
      <div class="rv-signal-title">👍 긍정 신호 <span style="font-weight:400;text-transform:none;letter-spacing:0;">(클릭하면 관련 리뷰가 보여요)</span></div>
      ${signalChips(p.signals?.positive, 'positive', 'pos', '뚜렷한 긍정 신호가 감지되지 않았습니다.')}
    </div>
    <div id="reviewPosSignalDetail"></div>

    <div class="rv-signal-section">
      <div class="rv-signal-title">⚠️ 부정 신호 (개선 포인트) <span style="font-weight:400;text-transform:none;letter-spacing:0;">(클릭하면 관련 리뷰가 보여요)</span></div>
      ${signalChips(p.signals?.negative, 'negative', 'neg', '뚜렷한 부정 신호가 감지되지 않았습니다.')}
    </div>
    <div id="reviewNegSignalDetail"></div>

    <div class="rv-signal-section">
      <div class="rv-signal-title">대표 호평 리뷰</div>
      ${positiveSection}
    </div>
    <div class="rv-signal-section" style="margin-bottom:0;">
      <div class="rv-signal-title">대표 부정 리뷰</div>
      ${negativeSection}
    </div>
  `;

  modal.classList.remove('hidden');
}

function closeReviewModal() {
  const modal = document.getElementById('reviewModal');
  if (modal) modal.classList.add('hidden');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeReviewModal(); });

function renderCatKeywordChart(cat) {
  const ctx = document.getElementById('catKwChart');
  if(!ctx) return;
  destroyChart('catKw');

  const catData = CATEGORIES[cat];
  const kwList = catData?.topKeywords?.filter(k => KEYWORD_DATA[k]).slice(0,8)
    ?? Object.keys(KEYWORD_DATA).slice(0,8);
  const pairs = kwList.map(k => [k, KEYWORD_DATA[k]]);

  charts.catKw = new Chart(ctx, {
    type:'bar',
    data:{
      labels: pairs.map(([k]) => k),
      datasets:[{
        label:'검색 지수 (최신)',
        data: pairs.map(([,v]) => v.data[v.data.length-1]),
        backgroundColor: pairs.map(([,v]) => v.color+'aa'),
        borderColor: pairs.map(([,v]) => v.color),
        borderWidth:1.5, borderRadius:8, borderSkipped:false,
      }]
    },
    options:{
      ...CHART_DEFAULTS,
      plugins:{ ...CHART_DEFAULTS.plugins, legend:{ display:false } },
      scales:{ ...CHART_DEFAULTS.scales, y:{ ...CHART_DEFAULTS.scales.y, beginAtZero:true } }
    }
  });
}

function renderCatBrandStats(cat) {
  const el = document.getElementById('catBrandStats');
  if(!el) return;
  let list = cat === '전체' ? NEW_PRODUCTS : NEW_PRODUCTS.filter(p => p.category === cat);
  const counts = {};
  list.forEach(p => { counts[p.brand] = (counts[p.brand]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,8);
  const max = sorted[0]?.[1] || 1;
  el.innerHTML = `
    <p style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:12px;">브랜드별 신제품 수 (클릭하여 제품 보기)</p>
    ${sorted.map(([brand,cnt]) => {
      const isOpen = selectedBrand === brand;
      const brandProducts = list.filter(p => p.brand === brand);
      return `
      <div class="rank-item" style="cursor:pointer;flex-direction:column;align-items:stretch;" onclick="toggleBrand('${brand.replace(/'/g,"\\'")}')">
        <div style="display:flex;align-items:center;gap:14px;">
          <div class="rank-bar-wrap">
            <div class="rank-name">${brand} <span style="font-size:9px;color:var(--text-muted);">${isOpen?'▲':'▼'}</span></div>
            <div class="rank-bar"><div class="rank-fill" style="width:0" data-w="${(cnt/max*100).toFixed(1)}"></div></div>
          </div>
          <div class="rank-val" style="color:var(--accent)">${cnt}개</div>
        </div>
        ${isOpen ? `
          <div style="margin-top:10px;padding:4px 12px;background:var(--bg-card-hover);border-radius:var(--radius-sm);">
            ${brandProducts.map((p,i) => `
              <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;${i<brandProducts.length-1?'border-bottom:1px solid var(--border);':''}font-size:12px;">
                ${p.url
                  ? `<a href="${p.url}" target="_blank" rel="noopener noreferrer" class="mini-name" onclick="event.stopPropagation()">${p.emoji} ${p.name}</a>`
                  : `<span style="color:var(--text-primary);">${p.emoji} ${p.name}</span>`}
                <span style="color:var(--text-muted);white-space:nowrap;">${p.price}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
    }).join('')}
  `;
  setTimeout(() => {
    el.querySelectorAll('.rank-fill').forEach(b => { b.style.width = b.dataset.w + '%'; });
  }, 120);
}

function toggleBrand(brand) {
  selectedBrand = (selectedBrand === brand) ? null : brand;
  renderCatBrandStats(selectedCat);
}

/* ════════════════════════════════════════════════════════════
   REPORT (데일리 리포트)
   ════════════════════════════════════════════════════════════ */
function renderReport() {
  const el = document.getElementById('reportInsights');
  if(!el) return;
  el.innerHTML = WEEKLY_SUMMARY.topInsights.map(i => `
    <div class="insight-card">
      <div class="insight-icon">${i.icon}</div>
      <div>
        <div class="insight-title">${i.title}</div>
        <div class="insight-body">${i.body}</div>
      </div>
    </div>
  `).join('');
}

function renderReportChart() {
  const ctx = document.getElementById('reportChart');
  if(!ctx) return;
  destroyChart('report');
  const sorted = Object.entries(KEYWORD_DATA).sort((a,b) => b[1].changeRate - a[1].changeRate);
  charts.report = new Chart(ctx, {
    type:'bar',
    data:{
      labels: sorted.map(([k]) => k),
      datasets:[{
        label:'변화율 (%)',
        data: sorted.map(([,v]) => v.changeRate),
        backgroundColor: sorted.map(([,v]) => v.changeRate>=0 ? v.color+'bb' : 'rgba(225,29,72,.55)'),
        borderColor:     sorted.map(([,v]) => v.changeRate>=0 ? v.color : '#e11d48'),
        borderWidth:1.5, borderRadius:7, borderSkipped:false,
      }]
    },
    options:{
      ...CHART_DEFAULTS,
      plugins:{
        ...CHART_DEFAULTS.plugins,
        legend:{ display:false },
        tooltip:{ ...CHART_DEFAULTS.plugins.tooltip, callbacks:{ label: c => ` 변화율: ${c.raw>0?'+':''}${c.raw}%` } }
      },
      scales:{
        x:{ ...CHART_DEFAULTS.scales.x },
        y:{ ...CHART_DEFAULTS.scales.y, ticks:{ ...CHART_DEFAULTS.scales.y.ticks, callback: v => `${v}%` } }
      }
    }
  });
}

/* ════════════════════════════════════════════════════════════
   NEWS (업계 뉴스)
   ════════════════════════════════════════════════════════════ */
function renderNews() {
  const product = NEWS.filter(n => (n.category || 'product') === 'product');
  const regulatory = NEWS.filter(n => n.category === 'regulatory');

  renderNewsSection(product, 'newsListProduct', 'newsMetaProduct', 'tag-o');
  renderNewsSection(regulatory, 'newsListRegulatory', 'newsMetaRegulatory', 'tag-r');
}

function renderNewsSection(items, listId, metaId, tagClass) {
  const listEl = document.getElementById(listId);
  const metaEl = document.getElementById(metaId);
  if(!listEl) return;

  if(metaEl) {
    metaEl.textContent = META && META.newsUpdated
      ? `${fmt(META.newsUpdated)} 기준 · ${items.length}건`
      : `${items.length}건`;
  }

  if(!items.length) {
    listEl.innerHTML = `<div class="empty"><div class="empty-icon">📰</div><h3>수집된 뉴스가 없습니다</h3><p>다음 자동 갱신을 기다려주세요</p></div>`;
    return;
  }

  const sorted = [...items].sort((a,b) => new Date(b.pubDate) - new Date(a.pubDate));
  listEl.innerHTML = sorted.map(n => `
    <div class="insight-card">
      <div class="insight-icon">📰</div>
      <div style="flex:1;min-width:0;">
        <a href="${n.link}" target="_blank" rel="noopener noreferrer" class="insight-title" style="display:block;color:var(--text-primary);">${n.title}</a>
        <div style="display:flex;align-items:center;gap:8px;margin:4px 0 6px;">
          <span class="tag ${tagClass}">#${n.keyword}</span>
          <span style="font-size:11px;color:var(--text-muted);">${fmt(n.pubDate)}</span>
        </div>
        <div class="insight-body">${n.description}</div>
      </div>
    </div>
  `).join('');
}

/* ════════════════════════════════════════════════════════════
   CUSTOM KEYWORDS (지정 키워드 — 기존 12개 트렌드 키워드와 별도 관리)
   ════════════════════════════════════════════════════════════ */
function renderCustomKeywords() {
  const el = document.getElementById('ckGroups');
  const metaEl = document.getElementById('ckMeta');
  if(!el) return;

  const totalKw = CUSTOM_KEYWORD_GROUPS.reduce((sum,g) => sum + g.items.length, 0);
  if(metaEl) {
    metaEl.textContent = totalKw
      ? `${CUSTOM_KEYWORD_GROUPS.length}개 그룹 · ${totalKw}개 키워드 (${META && META.customKeywordsTrendStartDate || ''} ~ ${META && META.customKeywordsTrendEndDate || ''})`
      : '-';
  }

  if(!totalKw) {
    el.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🧾</div><h3>수집된 데이터가 없습니다</h3><p>다음 자동 갱신을 기다려주세요</p></div>`;
    return;
  }

  el.innerHTML = CUSTOM_KEYWORD_GROUPS.map(g => `
    <div class="card">
      <div class="card-header">
        <div class="ck-cat-badge">${g.midCategory}</div>
        <div class="card-meta">${g.items.length}개</div>
      </div>
      ${g.items.map(it => `
        <div class="ck-row" role="button" tabindex="0" onclick="openCkModal('${it.keyword}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openCkModal('${it.keyword}')}">
          <div class="ck-name">${it.keyword}</div>
          ${buildSparkSvg(it.data, it.changeRate >= 0 ? 'var(--accent)' : 'var(--rose)')}
          <div class="ck-pct ${it.changeRate>=0?'up':'down'}">${it.changeRate>=0?'+':''}${it.changeRate}%</div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

/* 미니 스파크라인 SVG (인라인, Chart.js 없이 가벼운 추이 표시용) */
function buildSparkSvg(data, color) {
  const w = 100, h = 28, pad = 2;
  const min = Math.min(...data), max = Math.max(...data);
  const range = (max - min) || 1;
  const stepX = data.length > 1 ? (w - pad*2) / (data.length - 1) : 0;
  const points = data.map((v,i) => {
    const x = pad + i*stepX;
    const y = h - pad - ((v-min)/range) * (h - pad*2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="ck-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function findCustomKeywordItem(keyword) {
  for (const g of CUSTOM_KEYWORD_GROUPS) {
    const item = g.items.find(it => it.keyword === keyword);
    if (item) return { ...item, midCategory: g.midCategory };
  }
  return null;
}

/* data.length(90일)와 customKeywordsTrendEndDate를 기준으로 M/D 라벨 배열 생성 */
function buildCkDateLabels(len) {
  const end = (META && META.customKeywordsTrendEndDate) ? new Date(META.customKeywordsTrendEndDate) : new Date();
  const out = [];
  for (let i = len - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    out.push(`${d.getMonth() + 1}/${d.getDate()}`);
  }
  return out;
}

/* 지정 키워드 행 클릭 시 확대 차트 모달 표시 */
function openCkModal(keyword) {
  const item = findCustomKeywordItem(keyword);
  const modal = document.getElementById('ckModal');
  if (!item || !modal) return;

  document.getElementById('ckModalTitle').textContent = keyword;
  document.getElementById('ckModalMeta').textContent =
    `${item.midCategory} · ${(META && META.customKeywordsTrendStartDate) || ''} ~ ${(META && META.customKeywordsTrendEndDate) || ''}`;
  const pctEl = document.getElementById('ckModalPct');
  pctEl.textContent = `${item.changeRate >= 0 ? '+' : ''}${item.changeRate}%`;
  pctEl.className = `ck-modal-pct ${item.changeRate >= 0 ? 'up' : 'down'}`;

  const color = item.changeRate >= 0 ? '#0d9488' : '#e11d48';
  destroyChart('ckModal');
  charts.ckModal = new Chart(document.getElementById('ckModalChart'), {
    type: 'line',
    data: {
      labels: buildCkDateLabels(item.data.length),
      datasets: [{
        label: keyword, data: item.data, borderColor: color, backgroundColor: color + '18',
        borderWidth: 2.5, tension: .35, fill: true,
        pointRadius: 0, pointHoverRadius: 5,
        pointHoverBackgroundColor: color, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
    }
  });

  ckModalRelated = (RELATED_KEYWORDS && RELATED_KEYWORDS[keyword]) || [];
  ckModalRelatedPage = 0;
  renderCkRelatedPage();

  modal.classList.remove('hidden');
}

function closeCkModal() {
  const modal = document.getElementById('ckModal');
  if (modal) modal.classList.add('hidden');
  destroyChart('ckModal');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCkModal(); });

/* 관련 인기검색어 25개씩 페이지네이션 */
function renderCkRelatedPage() {
  const listEl = document.getElementById('ckRelatedList');
  const rangeEl = document.getElementById('ckRelatedRange');
  const prevBtn = document.getElementById('ckRelatedPrev');
  const nextBtn = document.getElementById('ckRelatedNext');
  if (!listEl) return;

  if (!ckModalRelated.length) {
    listEl.innerHTML = `<div class="ck-related-empty">관련 인기검색어 데이터가 아직 없습니다</div>`;
    if (rangeEl) rangeEl.textContent = '-';
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  const start = ckModalRelatedPage * CK_RELATED_PAGE_SIZE;
  const pageItems = ckModalRelated.slice(start, start + CK_RELATED_PAGE_SIZE);
  listEl.innerHTML = pageItems.map((it, i) => `
    <div class="ck-related-row">
      <span class="ck-related-rank">${start + i + 1}</span>
      <span class="ck-related-kw">${it.keyword}</span>
      <span class="ck-related-vol">${(it.total || 0).toLocaleString()}</span>
    </div>
  `).join('');

  const end = Math.min(start + CK_RELATED_PAGE_SIZE, ckModalRelated.length);
  if (rangeEl) rangeEl.textContent = `${start + 1}-${end} / ${ckModalRelated.length}`;
  if (prevBtn) prevBtn.disabled = ckModalRelatedPage === 0;
  if (nextBtn) nextBtn.disabled = end >= ckModalRelated.length;
}

function ckRelatedPage(delta) {
  const maxPage = Math.max(0, Math.ceil(ckModalRelated.length / CK_RELATED_PAGE_SIZE) - 1);
  ckModalRelatedPage = Math.min(maxPage, Math.max(0, ckModalRelatedPage + delta));
  renderCkRelatedPage();
}

/* ════════════════════════════════════════════════════════════
   WEEKLY ARCHIVE (푸드 트렌드 위클리 메일 카드뉴스)
   ════════════════════════════════════════════════════════════ */
function renderWeeklyArchive() {
  const el = document.getElementById('waGrid');
  const metaEl = document.getElementById('waMeta');
  if (!el) return;

  if (metaEl) metaEl.textContent = WEEKLY_ARCHIVE.length ? `${WEEKLY_ARCHIVE.length}주 누적` : '-';

  if (!WEEKLY_ARCHIVE.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">💌</div><h3>아직 발송된 리포트가 없습니다</h3><p>다음 주 월요일 자동 발송 후 이곳에 쌓입니다</p></div>`;
    return;
  }

  const waCardHtml = r => `
    <div class="wa-card" role="button" tabindex="0" onclick="openWeeklyModal('${r.date}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openWeeklyModal('${r.date}')}">
      <div class="wa-card-eyebrow">${r.weekLabel || r.date}</div>
      <div class="wa-card-title">푸드 트렌드 위클리</div>
      <div class="wa-card-period">${r.periodLabel || ''}</div>
      <div class="wa-card-stats">
        ${r.topUpKeyword ? `
          <div class="wa-card-stat"><span class="wa-card-stat-label">🔥 최고 상승</span>
            <span class="wa-card-stat-value up">${r.topUpKeyword} ${r.topUpPct >= 0 ? '+' : ''}${r.topUpPct}%</span></div>
        ` : ''}
        ${r.topDownKeyword ? `
          <div class="wa-card-stat"><span class="wa-card-stat-label">📉 주의 필요</span>
            <span class="wa-card-stat-value down">${r.topDownKeyword} ${r.topDownPct}%</span></div>
        ` : ''}
        ${r.topCategory ? `
          <div class="wa-card-stat"><span class="wa-card-stat-label">📦 신제품 최다</span>
            <span class="wa-card-stat-value">${r.topCategory} ${r.topCategoryCount}건</span></div>
        ` : ''}
      </div>
      <div class="wa-card-cta">메일 내용 보기 →</div>
    </div>
  `;

  // weekLabel("2026년 8월 1주차")에서 연·월을 뽑아 월 단위로 묶는다.
  // weekLabel이 없으면 report date의 연·월로 대체한다.
  const monthKeyOf = r => {
    const m = (r.weekLabel || '').match(/^(\d{4})년\s*(\d{1,2})월/);
    if (m) return { year: +m[1], month: +m[2] };
    const d = new Date(r.date);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  };

  const groups = [];
  const groupIndexByKey = new Map();
  for (const r of WEEKLY_ARCHIVE) {
    const { year, month } = monthKeyOf(r);
    const key = `${year}-${month}`;
    if (!groupIndexByKey.has(key)) {
      groupIndexByKey.set(key, groups.length);
      groups.push({ year, month, items: [] });
    }
    groups[groupIndexByKey.get(key)].items.push(r);
  }

  el.innerHTML = groups.map(g => `
    <div class="wa-month-group">
      <div class="wa-month-badge">'${String(g.year).slice(-2)}년 ${g.month}월</div>
      <div class="wa-grid">${g.items.map(waCardHtml).join('')}</div>
    </div>
  `).join('');
}

function openWeeklyModal(date) {
  const report = WEEKLY_ARCHIVE.find(r => r.date === date);
  const modal = document.getElementById('waModal');
  if (!report || !modal) return;

  document.getElementById('waModalTitle').textContent = `푸드 트렌드 위클리 — ${report.weekLabel || report.date}`;
  document.getElementById('waModalMeta').textContent = report.periodLabel || '';
  document.getElementById('waModalFrame').src = report.file;

  modal.classList.remove('hidden');
}

function closeWeeklyModal() {
  const modal = document.getElementById('waModal');
  if (modal) modal.classList.add('hidden');
  const frame = document.getElementById('waModalFrame');
  if (frame) frame.src = 'about:blank';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeWeeklyModal(); });

/* ── 내보내기 ─────────────────────────────────────────────── */
function exportReport() {
  const lines = [
    `# 식품 트렌드 데일리 리포트`,
    `기간: ${WEEKLY_SUMMARY.period}`,
    `분석 키워드: ${WEEKLY_SUMMARY.totalKeywords}개 | 신제품: ${WEEKLY_SUMMARY.newProducts}개`,
    ``,
    `## 이번 주 급상승 키워드`,
    ...Object.entries(KEYWORD_DATA)
      .filter(([,v])=>v.changeRate>0)
      .sort((a,b)=>b[1].changeRate-a[1].changeRate)
      .map(([k,v]) => `- ${k}: +${v.changeRate}%`),
    ``,
    `## 주요 인사이트`,
    ...WEEKLY_SUMMARY.topInsights.map(i => `### ${i.title}\n${i.body}`),
    ``,
    `## 카테고리별 가격대`,
    ...CATEGORY_PRICE.map(d => `- ${d.category}: 평균 ${d.avg.toLocaleString()}원 (${d.min.toLocaleString()}~${d.max.toLocaleString()}원, ${d.count}개)`),
    ``,
    `## 브랜드별 신제품 출시속도 (최근 ${HISTORY_META.daysTracked}일)`,
    ...BRAND_VELOCITY.map(d => `- ${d.brand}: ${d.count}개`),
    ``,
    `## 관련 뉴스`,
    ...NEWS.slice(0,10).map(n => `- [${n.keyword}] ${n.title} (${n.link})`),
    ``,
    `## 신제품 목록`,
    ...NEW_PRODUCTS.map(p => `- [${p.category}] ${p.brand} — ${p.name} (${p.price}) | 키워드: ${p.keywords.join(', ')}`)
  ];
  const blob = new Blob([lines.join('\n')], { type:'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const todayStr = new Date().toISOString().slice(0,10);
  a.href = url; a.download = `food-trend-report-${todayStr}.txt`; a.click();
  URL.revokeObjectURL(url);
}

/* ── 현재 탭 PDF 내보내기 (A4 가로, 인쇄를 통한 저장) ──────── */
function exportCurrentTabPDF() {
  const title = document.getElementById('topbar-title')?.textContent || 'Food Trend AI';
  const today = new Date();
  const dateStr = `${today.getFullYear()}.${String(today.getMonth()+1).padStart(2,'0')}.${String(today.getDate()).padStart(2,'0')}`;

  const printHeader = document.getElementById('printHeader');
  if(printHeader) {
    printHeader.innerHTML = `
      <div class="ph-top"><span>Food Trend AI · 식품 트렌드 분석기</span><span>${dateStr} 기준</span></div>
      <h1>${title}</h1>
    `;
  }

  const prevDocTitle = document.title;
  document.title = `FoodTrend-${currentView}-${today.toISOString().slice(0,10)}`;

  window.print();

  document.title = prevDocTitle;
}
window.addEventListener('afterprint', () => {
  const printHeader = document.getElementById('printHeader');
  if(printHeader) printHeader.innerHTML = '';
});

/* ── 전역 검색 ───────────────────────────────────────────── */
// 검색어가 있으면 신제품뿐 아니라 트렌드 키워드/카테고리별 인기검색어/브랜드/뉴스까지
// 모든 탭을 통합 검색해서 searchResults 뷰에 모아 보여준다.
function handleSearch(q) {
  productSearch = q;
  if(q) {
    if(currentView !== 'searchResults') preSearchView = currentView;
    navigate('searchResults');
  } else if(currentView === 'searchResults') {
    navigate(preSearchView || 'dashboard');
  } else if(currentView === 'products') {
    renderProducts();
  }
}

function renderSearchResults() {
  const el = document.getElementById('searchResultsGrid');
  if(!el) return;
  const q = (productSearch || '').trim();
  const qLower = q.toLowerCase();

  const trendMatches = q ? Object.entries(KEYWORD_DATA).filter(([kw, d]) =>
    kw.includes(q) || (d.category || '').includes(q)
  ) : [];

  const customMatches = [];
  if(q) {
    CUSTOM_KEYWORD_GROUPS.forEach(g => {
      g.items.forEach(it => {
        if(it.keyword.includes(q) || g.midCategory.includes(q)) {
          customMatches.push({ ...it, midCategory: g.midCategory });
        }
      });
    });
  }

  const productMatches = q ? NEW_PRODUCTS.filter(p =>
    p.name.toLowerCase().includes(qLower) || p.brand.toLowerCase().includes(qLower) ||
    p.category.includes(q) || p.keywords.some(k => k.includes(q))
  ) : [];

  const brandMatches = q ? BRAND_DATA.filter(b => b.name.toLowerCase().includes(qLower)) : [];

  const newsMatches = q ? NEWS.filter(n =>
    (n.title || '').includes(q) || (n.description || '').includes(q) || (n.keyword || '').includes(q)
  ) : [];

  const reviewMatches = q && REVIEW_DATA?.products
    ? REVIEW_DATA.products.filter(p => p.productName.toLowerCase().includes(qLower))
    : [];

  const total = trendMatches.length + customMatches.length + productMatches.length + brandMatches.length + newsMatches.length + reviewMatches.length;

  const subEl = document.getElementById('topbar-sub');
  if(subEl) subEl.textContent = q ? `"${q}" 검색 결과 — 총 ${total}건` : '검색어를 입력하세요';

  if(!q || total === 0) {
    el.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🔍</div><h3>검색 결과 없음</h3><p>다른 키워드로 검색해보세요</p></div>`;
    return;
  }

  const sections = [];

  if(trendMatches.length) {
    sections.push(`
      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="card-icon">📈</span>트렌드 키워드</div>
          <div class="card-meta">${trendMatches.length}건</div>
        </div>
        ${trendMatches.map(([kw, d]) => `
          <div class="ck-row" role="button" tabindex="0" onclick="navigate('trends')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();navigate('trends')}">
            <div class="ck-name">${kw}</div>
            <div style="flex:1;font-size:11px;color:var(--text-muted);">${d.category}</div>
            <div class="ck-pct ${d.changeRate >= 0 ? 'up' : 'down'}">${d.changeRate >= 0 ? '+' : ''}${d.changeRate}%</div>
          </div>
        `).join('')}
      </div>
    `);
  }

  if(customMatches.length) {
    sections.push(`
      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="card-icon">🧾</span>카테고리별 인기검색어</div>
          <div class="card-meta">${customMatches.length}건</div>
        </div>
        ${customMatches.map(it => `
          <div class="ck-row" role="button" tabindex="0" onclick="navigate('customKeywords');setTimeout(()=>openCkModal('${it.keyword}'),60)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();navigate('customKeywords');setTimeout(()=>openCkModal('${it.keyword}'),60)}">
            <div class="ck-name">${it.keyword}</div>
            <div style="flex:1;font-size:11px;color:var(--text-muted);">${it.midCategory}</div>
            <div class="ck-pct ${it.changeRate >= 0 ? 'up' : 'down'}">${it.changeRate >= 0 ? '+' : ''}${it.changeRate}%</div>
          </div>
        `).join('')}
      </div>
    `);
  }

  if(productMatches.length) {
    sections.push(`
      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="card-icon">🆕</span>신제품(마켓컬리)</div>
          <div class="card-meta">${productMatches.length}건</div>
        </div>
        ${productMatches.slice(0, 12).map(p => `
          <div class="mini-row">
            <div class="mini-left">
              <span class="mini-emoji">${p.emoji}</span>
              <div>
                ${p.url
                  ? `<a href="${p.url}" target="_blank" rel="noopener noreferrer" class="mini-name">${p.name}</a>`
                  : `<div class="mini-name">${p.name}</div>`}
                <div class="mini-brand">${p.brand} · ${fmt(p.launchDate)}</div>
              </div>
            </div>
            <span class="tag ${catTagClass(p.category)}">${p.category}</span>
          </div>
        `).join('')}
      </div>
    `);
  }

  if(brandMatches.length) {
    sections.push(`
      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="card-icon">🏷️</span>브랜드</div>
          <div class="card-meta">${brandMatches.length}건</div>
        </div>
        ${brandMatches.map(b => `
          <div class="ck-row" role="button" tabindex="0" onclick="navigate('category')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();navigate('category')}">
            <div class="ck-name" style="width:auto;flex:1;">${b.name}</div>
            <div style="font-size:12px;color:var(--text-muted);">${b.products}개</div>
          </div>
        `).join('')}
      </div>
    `);
  }

  if(newsMatches.length) {
    sections.push(`
      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="card-icon">📰</span>뉴스</div>
          <div class="card-meta">${newsMatches.length}건</div>
        </div>
        ${newsMatches.slice(0, 12).map(n => `
          <div class="insight-card">
            <div class="insight-icon">📰</div>
            <div style="flex:1;min-width:0;">
              <a href="${n.link}" target="_blank" rel="noopener noreferrer" class="insight-title" style="display:block;color:var(--text-primary);">${n.title}</a>
              <div style="display:flex;align-items:center;gap:8px;margin:4px 0 6px;">
                <span class="tag tag-b">#${n.keyword}</span>
                <span style="font-size:11px;color:var(--text-muted);">${fmt(n.pubDate)}</span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `);
  }

  if(reviewMatches.length) {
    sections.push(`
      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="card-icon">💬</span>자사 제품 리뷰</div>
          <div class="card-meta">${reviewMatches.length}건</div>
        </div>
        ${reviewMatches.slice(0, 12).map(p => `
          <div class="ck-row" role="button" tabindex="0"
               onclick="navigate('reviews');setTimeout(()=>openReviewModal(${p.productId}),60)"
               onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();navigate('reviews');setTimeout(()=>openReviewModal(${p.productId}),60)}">
            <div class="ck-name" style="width:auto;flex:1;overflow:visible;white-space:normal;">${escHtml(p.productName)}</div>
            <div style="font-size:11px;color:var(--text-muted);white-space:nowrap;">리뷰 ${p.reviewCount.toLocaleString()}건</div>
            <span class="tag" style="margin-left:8px;">⭐${p.avgRating ?? '-'}</span>
          </div>
        `).join('')}
      </div>
    `);
  }

  el.innerHTML = sections.join('');
}

/* ── 상태 표시 (사이드바 / KPI 부가정보) ──────────────────── */
function setText(id, text) {
  const el = document.getElementById(id);
  if(el) el.textContent = text;
}

function renderStatus() {
  const d = META && META.lastUpdated ? new Date(META.lastUpdated) : new Date();
  setText('statusDate', `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 기준`);
  setText('kpi-kw-note',   META && META.keywordSource === 'naver_datalab' ? '네이버 데이터랩 연동' : '예시 데이터 (seed)');
  setText('kpi-prod-note', META && (META.productSource||'').startsWith('kurly') ? '마켓컬리 자동 수집' : '예시 데이터 (seed)');
  setText('kpi-updated', '✅ 정상 수집 중');
  setText('nav-prod-badge', NEW_PRODUCTS.length);
  setText('nav-news-badge', NEWS.length);
  renderKpiTooltips();
}

/* KPI 카드 호버 툴팁 내용 */
function renderKpiTooltips() {
  const kwEl = document.getElementById('kpi-kw-tooltip');
  if(kwEl) {
    const list = Object.keys(KEYWORD_DATA).join(', ');
    kwEl.innerHTML = `<strong>추적 중인 키워드 ${Object.keys(KEYWORD_DATA).length}개</strong><br>${list}<br><br>출처: 네이버 데이터랩 검색어트렌드 (최근 3개월)`;
  }

  const prodEl = document.getElementById('kpi-prod-tooltip');
  if(prodEl) {
    const byCat = {};
    NEW_PRODUCTS.forEach(p => { byCat[p.category] = (byCat[p.category]||0)+1; });
    const breakdown = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([c,n]) => `${c} ${n}`).join(' · ');
    prodEl.innerHTML = `<strong>카테고리별 신제품</strong><br>${breakdown}<br><br>출처: 마켓컬리 검색결과 크롤링 (하루 1회)`;
  }

  const riseEl = document.getElementById('kpi-rise-tooltip');
  if(riseEl) {
    const rising = Object.entries(KEYWORD_DATA)
      .filter(([,d]) => d.changeRate > 0)
      .sort((a,b) => b[1].changeRate - a[1].changeRate)
      .map(([k,d]) => `${k} +${d.changeRate}%`);
    riseEl.innerHTML = rising.length
      ? `<strong>전주 대비 상승 키워드</strong><br>${rising.join(', ')}`
      : `이번 주기에는 상승 키워드가 없습니다.`;
  }

  const updatedEl = document.getElementById('kpi-updated-tooltip');
  if(updatedEl) {
    const fmtTime = (iso) => {
      if(!iso) return '기록 없음';
      const d = new Date(iso);
      const hh = String(d.getHours()).padStart(2,'0'), mm = String(d.getMinutes()).padStart(2,'0');
      return `${d.getMonth()+1}/${d.getDate()} ${hh}:${mm}`;
    };
    const m = META || {};
    updatedEl.innerHTML = `
      <strong>소스별 마지막 갱신</strong><br>
      🔍 네이버 데이터랩: ${fmtTime(m.naverUpdated || m.lastUpdated)}<br>
      🆕 마켓컬리: ${fmtTime(m.kurlyUpdated || m.lastUpdated)}<br>
      📰 뉴스: ${fmtTime(m.newsUpdated)}<br><br>
      GitHub Actions로 매일 07:00 KST 자동 갱신
    `;
  }
}

/* ── 리포트 상단 요약 / 하이라이트 카드 ───────────────────── */
function renderReportHighlights() {
  const metaEl = document.getElementById('reportMeta');
  if(metaEl) {
    metaEl.innerHTML = `
      📅 ${WEEKLY_SUMMARY.period}&nbsp;&nbsp;|&nbsp;&nbsp;
      🔍 분석 키워드 ${WEEKLY_SUMMARY.totalKeywords}개&nbsp;&nbsp;|&nbsp;&nbsp;
      🆕 신제품 ${WEEKLY_SUMMARY.newProducts}개&nbsp;&nbsp;|&nbsp;&nbsp;
      🚀 급상승 카테고리: ${WEEKLY_SUMMARY.risingCategories.join(', ') || '-'}
    `;
  }

  const topKw = WEEKLY_SUMMARY.topKeyword, topKwData = topKw ? KEYWORD_DATA[topKw] : null;
  setText('hl-top-kw', topKw || '-');
  setText('hl-top-kw-val', topKwData ? `${topKwData.changeRate>=0?'+':''}${topKwData.changeRate}%` : '-');

  const topCat = WEEKLY_SUMMARY.topCategory, topCatData = topCat ? CATEGORIES[topCat] : null;
  setText('hl-top-cat', topCat || '-');
  setText('hl-top-cat-val', topCatData ? `${topCatData.count}개` : '-');

  const worstKw = WEEKLY_SUMMARY.worstKeyword, worstKwData = worstKw ? KEYWORD_DATA[worstKw] : null;
  setText('hl-worst-kw', worstKw || '-');
  setText('hl-worst-kw-val', worstKwData ? `${worstKwData.changeRate}%` : '-');

  const topPriceCat = CATEGORY_PRICE[0]; // buildCategoryPriceStats는 avg 내림차순 정렬됨
  setText('hl-price-cat', topPriceCat ? topPriceCat.category : '-');
  setText('hl-price-cat-val', topPriceCat ? `${topPriceCat.avg.toLocaleString()}원` : '-');

  const topBrand = BRAND_VELOCITY[0];
  setText('hl-brand', topBrand ? topBrand.brand : '-');
  setText('hl-brand-val', topBrand ? `${topBrand.count}개` : '-');

  renderReportNews();
}

/* 리포트용 뉴스 다이제스트 (신제품/법규 각 최신 3건) */
function renderReportNews() {
  renderReportNewsSection(NEWS.filter(n => (n.category || 'product') === 'product'), 'reportNewsProduct', 'tag-o');
  renderReportNewsSection(NEWS.filter(n => n.category === 'regulatory'), 'reportNewsRegulatory', 'tag-r');
}

function renderReportNewsSection(items, elId, tagClass) {
  const el = document.getElementById(elId);
  if(!el) return;
  if(!items.length) {
    el.innerHTML = `<p style="font-size:12.5px;color:var(--text-muted);">수집된 뉴스가 없습니다.</p>`;
    return;
  }
  const top3 = [...items].sort((a,b) => new Date(b.pubDate) - new Date(a.pubDate)).slice(0,3);
  el.innerHTML = top3.map(n => `
    <div class="mini-row">
      <div class="mini-left" style="min-width:0;">
        <span class="mini-emoji">📰</span>
        <div style="min-width:0;">
          <a href="${n.link}" target="_blank" rel="noopener noreferrer" class="mini-name" style="color:var(--text-primary);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${n.title}</a>
          <div class="mini-brand">${fmt(n.pubDate)}</div>
        </div>
      </div>
      <span class="tag ${tagClass}">#${n.keyword}</span>
    </div>
  `).join('');
}

function showDataError(err) {
  console.error('[food-trend-analyzer] 데이터 로드 실패:', err);
  const banner = document.getElementById('dataErrorBanner');
  if(banner) {
    banner.style.display = 'block';
    banner.textContent = `⚠️ 데이터를 불러오지 못했습니다: ${err.message}`;
  }
  setText('statusDate', '데이터 로드 실패');
}

/* ── 초기화 ──────────────────────────────────────────────── */
/* 탑바에 오늘 날짜 표시 (요일 포함) */
function renderTopbarDate() {
  const el = document.getElementById('topbarDate');
  if (!el) return;
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const d = new Date();
  el.textContent = `📅 ${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

async function init() {
  renderTopbarDate();

  // 검색
  const searchEl = document.getElementById('globalSearch');
  if(searchEl) searchEl.addEventListener('input', e => handleSearch(e.target.value));

  // 신제품 필터 버튼
  document.querySelectorAll('.pf-btn').forEach(btn => {
    btn.addEventListener('click', () => setProductFilter(btn.dataset.f));
  });

  // 데이터 로드 (data/*.json)
  try {
    const data = await window.loadAppData();
    ({ KEYWORD_DATA, NEW_PRODUCTS, CATEGORIES, BRAND_DATA, WEEKLY_SUMMARY, DATES_30, META,
       KEYWORD_OPPORTUNITY, BRAND_VELOCITY, CATEGORY_PRICE, HISTORY_META, NEWS, CUSTOM_KEYWORD_GROUPS, RELATED_KEYWORDS,
       WEEKLY_ARCHIVE, HISTORY, REVIEW_DATA } = data);
  } catch (err) {
    showDataError(err);
    return;
  }

  // 리포트 & 카테고리 초기 렌더
  renderStatus();
  renderReport();
  renderReportHighlights();
  renderCategoryCards();
  renderReportChart();
  renderProducts();

  // 첫 뷰 로드 — URL 해시가 유효한 화면을 가리키면 그 화면을 열고, 아니면 대시보드.
  const hashId = location.hash.slice(1);
  const hashIsValidView = hashId && document.querySelector(`.view#${CSS.escape(hashId)}`);
  navigate(hashIsValidView ? hashId : 'dashboard');
}

document.addEventListener('DOMContentLoaded', init);
