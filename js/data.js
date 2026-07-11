// ============================================================
//  js/data.js — 식품 트렌드 분석기 데이터 로더
//  data/*.json (네이버 데이터랩 + 마켓컬리 크롤러 결과)을 fetch 해서
//  프론트엔드가 쓰는 형태로 조립한다.
// ============================================================

window.loadAppData = async function loadAppData() {
  const [trendsRaw, products, categoriesCfg, meta] = await Promise.all([
    fetchJson('data/keyword_trends.json'),
    fetchJson('data/new_products.json'),
    fetchJson('data/categories.json'),
    fetchJson('data/meta.json'),
  ]);

  // 설정 파일에 섞여있는 "_comment" 같은 메타 키는 제외한다.
  const KEYWORD_DATA = Object.fromEntries(
    Object.entries(trendsRaw).filter(([k]) => !k.startsWith('_'))
  );
  const NEW_PRODUCTS = products;

  const CATEGORIES = buildCategories(categoriesCfg.categories, NEW_PRODUCTS);
  const BRAND_DATA = buildBrandData(NEW_PRODUCTS);
  const DATES_30 = buildDateLabels(meta, KEYWORD_DATA);
  const WEEKLY_SUMMARY = buildWeeklySummary(KEYWORD_DATA, NEW_PRODUCTS, CATEGORIES, meta);

  return { KEYWORD_DATA, NEW_PRODUCTS, CATEGORIES, BRAND_DATA, WEEKLY_SUMMARY, DATES_30, META: meta };
};

async function fetchJson(path) {
  let res;
  try {
    res = await fetch(path, { cache: 'no-store' });
  } catch (e) {
    throw new Error(`${path} 요청 실패 (네트워크 오류). 정적 파일 서버로 열었는지 확인하세요. (${e.message})`);
  }
  if (!res.ok) {
    throw new Error(`${path} 요청 실패: HTTP ${res.status}`);
  }
  try {
    return await res.json();
  } catch (e) {
    throw new Error(`${path} 파싱 실패 (JSON 형식 오류): ${e.message}`);
  }
}

function buildCategories(categoriesRaw, products) {
  const out = {};
  for (const [name, meta] of Object.entries(categoriesRaw)) {
    const count = name === '전체'
      ? products.length
      : products.filter(p => p.category === name).length;
    out[name] = { emoji: meta.emoji, color: meta.color, topKeywords: meta.topKeywords, count };
  }
  return out;
}

function buildBrandData(products) {
  const counts = {};
  products.forEach(p => { counts[p.brand] = (counts[p.brand] || 0) + 1; });
  const palette = ['#ea580c', '#2563eb', '#7c3aed', '#0d9488', '#e11d48', '#15803d', '#b45309', '#db2777'];
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count], i) => ({ name, products: count, color: palette[i % palette.length] }));
}

function buildDateLabels(meta, keywordData) {
  const anyKeyword = Object.values(keywordData)[0];
  const len = anyKeyword ? anyKeyword.data.length : 30;

  let end;
  if (meta.trendEndDate) {
    end = new Date(meta.trendEndDate);
  } else {
    end = new Date();
  }

  const out = [];
  for (let i = len - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    out.push(`${d.getMonth() + 1}/${d.getDate()}`);
  }
  return out;
}

function buildWeeklySummary(keywordData, products, categories, meta) {
  const entries = Object.entries(keywordData);
  const sortedByChange = [...entries].sort((a, b) => b[1].changeRate - a[1].changeRate);
  const topEntry = sortedByChange[0];
  const worstEntry = sortedByChange[sortedByChange.length - 1];

  const catCounts = Object.entries(categories).filter(([name]) => name !== '전체');
  const topCatEntry = [...catCounts].sort((a, b) => b[1].count - a[1].count)[0];
  const risingCategories = catCounts
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 2)
    .map(([name]) => name);

  const period = meta.trendStartDate && meta.trendEndDate
    ? `${meta.trendStartDate} ~ ${meta.trendEndDate}`
    : (meta.lastUpdated ? meta.lastUpdated.slice(0, 10) + ' 기준' : '기간 정보 없음');

  const insights = [];
  if (topEntry) {
    const [kw, d] = topEntry;
    insights.push({
      icon: '🔥',
      title: `${kw}, 최고 상승폭 기록 (${d.changeRate >= 0 ? '+' : ''}${d.changeRate}%)`,
      body: `${kw} 키워드 검색 지수가 전주 대비 ${d.changeRate >= 0 ? '+' : ''}${d.changeRate}% 변화했습니다. (${d.category}) ${d.description}`,
    });
  }
  if (topCatEntry) {
    const [catName, catMeta] = topCatEntry;
    insights.push({
      icon: '📦',
      title: `${catName}, 신제품 최다 카테고리 (${catMeta.count}개)`,
      body: `이번 수집 주기 동안 ${catName} 카테고리에서 ${catMeta.count}개의 신제품이 확인되었습니다. 대표 키워드: ${(catMeta.topKeywords || []).slice(0, 3).join(', ')}.`,
    });
  }
  if (worstEntry && worstEntry[1].changeRate < 0) {
    const [kw, d] = worstEntry;
    insights.push({
      icon: '📉',
      title: `${kw}, 하락세 뚜렷 (${d.changeRate}%)`,
      body: `${kw} 키워드 검색 지수가 전주 대비 ${d.changeRate}% 하락했습니다. ${d.description}`,
    });
  }

  return {
    period,
    totalKeywords: entries.length,
    newProducts: products.length,
    risingCategories,
    topKeyword: topEntry ? topEntry[0] : null,
    topCategory: topCatEntry ? topCatEntry[0] : null,
    worstKeyword: worstEntry ? worstEntry[0] : null,
    topInsights: insights,
  };
}
