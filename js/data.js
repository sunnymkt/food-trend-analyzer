// ============================================================
//  js/data.js — 식품 트렌드 분석기 데이터 로더
//  data/*.json (네이버 데이터랩 + 마켓컬리 크롤러 결과)을 fetch 해서
//  프론트엔드가 쓰는 형태로 조립한다.
// ============================================================

window.loadAppData = async function loadAppData() {
  const [trendsRaw, products, categoriesCfg, meta, historyRaw, newsRaw, customKeywordsRaw] = await Promise.all([
    fetchJson('data/keyword_trends.json'),
    fetchJson('data/new_products.json'),
    fetchJson('data/categories.json'),
    fetchJson('data/meta.json'),
    fetchJsonOptional('data/product_history.json', {}),
    fetchJsonOptional('data/news.json', []),
    fetchJsonOptional('data/custom_keyword_trends.json', {}),
  ]);

  // 설정 파일에 섞여있는 "_comment" 같은 메타 키는 제외한다.
  const KEYWORD_DATA = Object.fromEntries(
    Object.entries(trendsRaw).filter(([k]) => !k.startsWith('_'))
  );
  const NEW_PRODUCTS = products;
  const HISTORY = Object.values(historyRaw);

  const CATEGORIES = buildCategories(categoriesCfg.categories, NEW_PRODUCTS);
  const BRAND_DATA = buildBrandData(NEW_PRODUCTS);
  const DATES_30 = buildDateLabels(meta, KEYWORD_DATA);
  const WEEKLY_SUMMARY = buildWeeklySummary(KEYWORD_DATA, NEW_PRODUCTS, CATEGORIES, meta);
  const KEYWORD_OPPORTUNITY = buildKeywordOpportunity(KEYWORD_DATA, HISTORY);
  const BRAND_VELOCITY = buildBrandVelocity(HISTORY);
  const CATEGORY_PRICE = buildCategoryPriceStats(NEW_PRODUCTS);
  const HISTORY_META = buildHistoryMeta(HISTORY);
  const NEWS = Array.isArray(newsRaw) ? newsRaw : [];
  const CUSTOM_KEYWORD_GROUPS = buildCustomKeywordGroups(customKeywordsRaw);

  return {
    KEYWORD_DATA, NEW_PRODUCTS, CATEGORIES, BRAND_DATA, WEEKLY_SUMMARY, DATES_30, META: meta,
    KEYWORD_OPPORTUNITY, BRAND_VELOCITY, CATEGORY_PRICE, HISTORY_META, NEWS, CUSTOM_KEYWORD_GROUPS,
  };
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

// 아직 한 번도 생성되지 않았을 수 있는 파일(product_history.json, news.json)은
// 없어도 앱 전체가 죽지 않도록 실패 시 기본값으로 대체한다.
async function fetchJsonOptional(path, fallback) {
  try {
    return await fetchJson(path);
  } catch (e) {
    console.warn(`[data.js] ${path} 를 불러오지 못해 기본값을 사용합니다:`, e.message);
    return fallback;
  }
}

function parsePriceToNumber(priceStr) {
  if (!priceStr) return null;
  const digits = String(priceStr).replace(/[^0-9]/g, '');
  if (!digits) return null;
  return parseInt(digits, 10);
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

// 키워드 기회 매트릭스: x=검색 변화율, y=누적(최근 30일) 신제품 수.
// 신제품 수는 product_history.json 기준이라 크롤러가 매일 쌓일수록 값이 붙는다.
function buildKeywordOpportunity(keywordData, history) {
  return Object.entries(keywordData).map(([kw, d]) => {
    const productCount = history.filter(p => (p.keywords || []).includes(kw)).length;
    return { keyword: kw, changeRate: d.changeRate, productCount, category: d.category, color: d.color };
  });
}

// 브랜드별 신제품 출시속도: product_history.json(최근 30일 롤링) 기준 브랜드별 발견 건수.
function buildBrandVelocity(history) {
  const counts = {};
  history.forEach(p => {
    if (!p.brand || p.brand === '-') return;
    counts[p.brand] = (counts[p.brand] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([brand, count]) => ({ brand, count }));
}

function buildHistoryMeta(history) {
  if (!history.length) return { daysTracked: 0, firstSeenDate: null, totalTracked: 0 };
  const dates = history.map(p => p.firstSeenDate).filter(Boolean).sort();
  const firstSeenDate = dates[0] || null;
  const daysTracked = firstSeenDate
    ? Math.max(1, Math.round((new Date() - new Date(firstSeenDate)) / 86400000) + 1)
    : 0;
  return { daysTracked, firstSeenDate, totalTracked: history.length };
}

// 카테고리별 가격대(최저~최고, 평균). "전체"는 제외 — 카테고리 비교가 목적.
function buildCategoryPriceStats(products) {
  const byCategory = {};
  products.forEach(p => {
    const price = parsePriceToNumber(p.price);
    if (price == null) return;
    (byCategory[p.category] = byCategory[p.category] || []).push(price);
  });
  return Object.entries(byCategory)
    .map(([category, prices]) => ({
      category,
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      count: prices.length,
    }))
    .sort((a, b) => b.avg - a.avg);
}

// 지정 키워드(custom_keyword_trends.json)를 midCategory 기준으로 그룹핑.
// 원본 엑셀/설정 파일에 적힌 순서(첫 등장 순)를 그대로 유지한다.
function buildCustomKeywordGroups(raw) {
  const groups = [];
  const indexByMid = {};
  for (const [keyword, d] of Object.entries(raw)) {
    if (keyword.startsWith('_')) continue;
    if (!(d.midCategory in indexByMid)) {
      indexByMid[d.midCategory] = groups.length;
      groups.push({ midCategory: d.midCategory, items: [] });
    }
    groups[indexByMid[d.midCategory]].items.push({
      keyword, changeRate: d.changeRate, data: d.data,
    });
  }
  return groups;
}
