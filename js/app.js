// ============================================================
//  js/app.js — 식품 트렌드 분석기 메인 로직
// ============================================================

/* ── 데이터 참조 (init에서 loadAppData 완료 후 채워짐) ────── */
let KEYWORD_DATA, NEW_PRODUCTS, CATEGORIES, BRAND_DATA, WEEKLY_SUMMARY, DATES_30, META;
let KEYWORD_OPPORTUNITY, BRAND_VELOCITY, CATEGORY_PRICE, HISTORY_META, NEWS, CUSTOM_KEYWORD_GROUPS, RELATED_KEYWORDS;

/* ── 상태 ────────────────────────────────────────────────── */
let currentView = 'dashboard';
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

  const TITLES = {
    dashboard: ['📊 대시보드',      '오늘의 식품 트렌드 종합 현황'],
    trends:    ['📈 트렌드 분석',    '키워드 3개월 시계열 비교'],
    products:  ['🆕 신제품 트래킹', '일별 신제품 모니터링'],
    category:  ['🗂️ 카테고리 분석', '카테고리별 키워드 심층 분석'],
    report:    ['📋 주간 리포트',   '자동 생성 인사이트 리포트'],
    news:      ['📰 업계 뉴스',     '식품 신제품 관련 최신 기사'],
    customKeywords: ['🧾 카테고리별 인기검색어', '별도 지정 키워드 3개월 검색 추이'],
  };
  if(TITLES[viewId]) {
    document.getElementById('topbar-title').textContent = TITLES[viewId][0];
    document.getElementById('topbar-sub').textContent   = TITLES[viewId][1];
  }

  setTimeout(() => {
    if(viewId === 'dashboard') renderDashboard();
    if(viewId === 'trends')    renderTrends();
    if(viewId === 'category')  renderCategory(selectedCat);
    if(viewId === 'news')      renderNews();
    if(viewId === 'customKeywords') renderCustomKeywords();
  }, 30);
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
  renderTopKeywordBadges();
  renderMainChart();
  renderDonut();
  renderRankings();
  renderLatestMini();
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

/* 3개월 라인 차트 */
function renderMainChart() {
  const ctx = document.getElementById('mainChart');
  if(!ctx) return;
  destroyChart('main');
  const KWS = ['흑임자','유자','제로슈거','마라','트러플'];
  charts.main = new Chart(ctx, {
    type:'line',
    data:{
      labels: DATES_30,
      datasets: KWS.map(kw => {
        const d = KEYWORD_DATA[kw];
        return {
          label:kw, data:d.data, borderColor:d.color, backgroundColor:d.color+'18',
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
    <div class="product-card ${isNew(p.launchDate,7)?'new-badge':''}">
      <div class="p-emoji">${p.emoji}</div>
      ${p.url
        ? `<a href="${p.url}" target="_blank" rel="noopener noreferrer" class="p-name">${p.name}</a>`
        : `<div class="p-name">${p.name}</div>`}
      <div class="p-brand">${p.brand} · ${p.channel}</div>
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
      plugins: { ...CHART_DEFAULTS.plugins, legend: { display:false } },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x, beginAtZero:true, ticks: { ...CHART_DEFAULTS.scales.x.ticks, stepSize:1 } },
        y: { ...CHART_DEFAULTS.scales.y, grid: { display:false } }
      }
    }
  });
}

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
   REPORT (주간 리포트)
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

/* ── 내보내기 ─────────────────────────────────────────────── */
function exportReport() {
  const lines = [
    `# 식품 트렌드 주간 리포트`,
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
  const title = document.getElementById('topbar-title')?.textContent || 'FoodTrend AI';
  const today = new Date();
  const dateStr = `${today.getFullYear()}.${String(today.getMonth()+1).padStart(2,'0')}.${String(today.getDate()).padStart(2,'0')}`;

  const printHeader = document.getElementById('printHeader');
  if(printHeader) {
    printHeader.innerHTML = `
      <div class="ph-top"><span>FoodTrend AI · 식품 트렌드 분석기</span><span>${dateStr} 기준</span></div>
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
function handleSearch(q) {
  productSearch = q;
  if(q && currentView !== 'products') navigate('products');
  if(currentView === 'products') renderProducts();
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

/* 리포트용 뉴스 다이제스트 (최신 3건) */
function renderReportNews() {
  const el = document.getElementById('reportNews');
  if(!el) return;
  if(!NEWS.length) {
    el.innerHTML = `<p style="font-size:12.5px;color:var(--text-muted);">수집된 뉴스가 없습니다.</p>`;
    return;
  }
  const top3 = [...NEWS].sort((a,b) => new Date(b.pubDate) - new Date(a.pubDate)).slice(0,3);
  el.innerHTML = top3.map(n => `
    <div class="mini-row">
      <div class="mini-left" style="min-width:0;">
        <span class="mini-emoji">📰</span>
        <div style="min-width:0;">
          <a href="${n.link}" target="_blank" rel="noopener noreferrer" class="mini-name" style="color:var(--text-primary);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${n.title}</a>
          <div class="mini-brand">${fmt(n.pubDate)}</div>
        </div>
      </div>
      <span class="tag tag-o">#${n.keyword}</span>
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
async function init() {
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
       KEYWORD_OPPORTUNITY, BRAND_VELOCITY, CATEGORY_PRICE, HISTORY_META, NEWS, CUSTOM_KEYWORD_GROUPS, RELATED_KEYWORDS } = data);
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

  // 첫 뷰 로드
  navigate('dashboard');
}

document.addEventListener('DOMContentLoaded', init);
