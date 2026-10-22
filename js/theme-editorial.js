// ============================================================
//  js/theme-editorial.js — 에디토리얼 테마 레이아웃/차트 보정
//  css/theme-editorial.css 와 짝. app.js 의 렌더 결과를 받아서
//   1) 대시보드 '오늘의 요약' → 라임 컬러블록, 하단 신제품 영역 → 크림 블록
//   2) 탑바 아래 상승률 띠(마퀴)
//   3) 메뉴별 맨 위 인트로 컬러블록 (핵심 숫자 3개)
//   4) Chart.js 차트 색을 잉크/파스텔 팔레트로 재지정
//  app.js 로직은 건드리지 않는다. 이 파일과 CSS 링크를 빼면 예전 디자인으로 돌아간다.
// ============================================================
(function(){
  const INK = ['#000000','#6b4fd8','#5c7f1e','#c2552b','#1f1d3d'];
  const BLOCKS = ['#dceeb1','#c5b0f4','#efd4d4','#c8e6cd','#f3c9b6','#1f1d3d','#000000','#ffffff','#9b8fd0'];
  if (window.Chart) {
    Chart.defaults.font.family = "'Pretendard Variable','Inter',sans-serif";
    Chart.defaults.color = '#000';
    Chart.defaults.borderColor = '#f1f1f1';
  }
  function txt(id){ const e=document.getElementById(id); return e? e.textContent.trim() : '-'; }
  let applyTries = 0, applied = false;
  function apply(){
    if (applied) return;
    if (typeof KEYWORD_DATA === 'undefined' || !KEYWORD_DATA || !document.getElementById('db-hl-top-kw') || txt('db-hl-top-kw')==='-') {
      if (++applyTries < 50) setTimeout(apply, 200);   // 데이터 로드 실패 시 10초 후 포기 (기존 레이아웃 유지)
      return;
    }
    applied = true;
    const dash = document.getElementById('dashboard');
    // 1) 오늘의 요약 → 라임 컬러블록
    const summaryCard = dash.querySelector(':scope > .card');
    const g3 = dash.querySelector(':scope > .g3');
    const top = txt('db-hl-top-kw'), topV = txt('db-hl-top-kw-val');
    const cat = txt('db-hl-top-cat'), catV = txt('db-hl-top-cat-val');
    const worst = txt('db-hl-worst-kw'), worstV = txt('db-hl-worst-kw-val');
    const meta = txt('db-summaryMeta');
    const block = document.createElement('section');
    block.className = 'cb cb-lime';
    block.innerHTML = `
      <div class="cb-eyebrow">Today's summary · ${meta}</div>
      <div class="cb-headline">이번 주 가장 빠르게 오른 키워드는 <b>${top}</b>.<br>신제품은 <b>${cat}</b>에서 가장 많이 나왔어요.</div>
      <div class="cb-stats">
        <div class="cb-stat" onclick="navigate('trends')"><div class="lbl">Top keyword</div><div class="name">${top}</div><div class="val">${topV}</div></div>
        <div class="cb-stat" onclick="navigate('category')"><div class="lbl">Top category</div><div class="name">${cat}</div><div class="val">${catV}</div></div>
        <div class="cb-stat" onclick="navigate('trends')"><div class="lbl">Watch out</div><div class="name">${worst}</div><div class="val">${worstV}</div></div>
      </div>
      <div class="cb-actions"><button class="btn btn-primary" onclick="navigate('trends')">키워드 비교분석</button><button class="btn btn-secondary" onclick="navigate('weeklyArchive')">위클리 리포트</button></div>`;
    summaryCard.replaceWith(block);
    g3.remove();
    // 2) 하단 카테고리+신제품 → 크림 컬러블록 (중간은 흰 캔버스로 분리)
    const lastG2 = dash.querySelectorAll(':scope > .g2');
    const bottom = lastG2[lastG2.length-1];
    const cream = document.createElement('section');
    cream.className = 'cb cb-cream';
    cream.innerHTML = `<div class="cb-eyebrow">New products · 마켓컬리</div>`;
    bottom.replaceWith(cream); cream.appendChild(bottom);
    // 3) 마퀴 스트립 (상승률 티커)
    const items = Object.entries(KEYWORD_DATA).sort((a,b)=>b[1].changeRate-a[1].changeRate)
      .map(([k,d])=>`<span><b>${k}</b> <span class="mono">${d.changeRate>=0?'▲ +':'▼ '}${d.changeRate}%</span></span>`).join('');
    const strip = document.createElement('div');
    strip.className = 'mk-strip';
    strip.innerHTML = `<div class="mk-track">${items}${items}</div>`;
    document.querySelector('.topbar').after(strip);
    // 4) 차트 색
    if (charts.main) { charts.main.data.datasets.forEach((d,i)=>{ d.borderColor=INK[i%INK.length]; d.pointHoverBackgroundColor=INK[i%INK.length]; d.borderWidth=2; }); charts.main.update('none'); }
    if (charts.donut) { const ds=charts.donut.data.datasets[0]; ds.backgroundColor=BLOCKS.slice(0,ds.data.length); ds.borderColor='#f4ecd6'; ds.borderWidth=2; charts.donut.options.plugins.legend.labels.color='#000'; charts.donut.options.plugins.legend.labels.font.family="'Pretendard Variable',sans-serif"; charts.donut.update('none'); }
    document.body.classList.add('theme-ready');
  }
  // ── 모든 차트를 모노크롬/파스텔로 재색칠 ──
  function recolorCharts(){
    if (typeof charts === 'undefined') return;
    Object.entries(charts).forEach(([key, ch])=>{
      if (!ch || !ch.data || key==='main' || key==='donut') return;
      const type = ch.config.type;
      ch.data.datasets.forEach((d,i)=>{
        if (type==='line') { const c=INK[i%INK.length]; d.borderColor=c; d.backgroundColor=c+'10'; d.pointHoverBackgroundColor=c; d.borderWidth=2; }
        else if (type==='bar') { const n=(d.data||[]).length; d.backgroundColor=Array.from({length:n},(_,j)=>BLOCKS[j%6]); d.borderColor='#000'; d.borderWidth=1; d.borderRadius=8; }
        else if (type==='doughnut' || type==='pie') { d.backgroundColor=BLOCKS.slice(0,d.data.length); d.borderColor='#fff'; }
        else { d.backgroundColor='#000'; d.borderColor='#000'; }
      });
      ch.update('none');
    });
  }
  // ── 메뉴별 인트로 컬러블록 ──
  const pct = v => (v>=0?'+':'')+v+'%';
  function countBy(arr, f){ const m={}; arr.forEach(x=>{ [].concat(f(x)).forEach(k=>{ if(k) m[k]=(m[k]||0)+1; }); }); return Object.entries(m).sort((a,b)=>b[1]-a[1]); }
  function intro(view){
    const kd = Object.entries(KEYWORD_DATA).sort((a,b)=>b[1].changeRate-a[1].changeRate);
    if (view==='products') {
      // 수집기가 키워드마다 최대 4개씩 가져오므로 '가장 많이 나온 맛'은 의미가 없어 '오늘 처음 등장'을 보여준다
      const tracked=NEW_PRODUCTS.filter(p=>p.keywords.some(k=>KEYWORD_DATA[k]));
      const cat=countBy(tracked,p=>p.category)[0]||['-',0];
      const fsd={}; (HISTORY||[]).forEach(e=>{ fsd[e.id]=e.firstSeenDate; });
      const today=(META&&META.kurlyUpdated||'').slice(0,10);
      const nw=tracked.filter(p=>fsd[p.id]===today).length;
      return {c:'lilac', eb:'New products · 마켓컬리 자동 수집', h:`추적 키워드로 찾은 신제품 <b>${tracked.length}개</b>.<br>그중 <b>${nw}개</b>는 오늘 처음 등장했어요.`,
        s:[['Total','신제품',tracked.length+'개'],['New today','오늘 처음 등장',nw+'개'],['Top category',cat[0],cat[1]+'개']]};
    }
    if (view==='news') {
      const pr=NEWS.filter(n=>n.category==='product').length, rg=NEWS.filter(n=>n.category==='regulatory').length;
      return {c:'cream', eb:'Industry news · 식품저널 · 푸드투데이', h:`이번 주 업계 소식 <b>${NEWS.length}건</b>.<br>신제품 ${pr}건, 법규·제도 변화 ${rg}건이에요.`,
        s:[['Product','신제품 기사',pr+'건'],['Regulation','법규·제도',rg+'건'],['Sources','식품 전문지','2곳']]};
    }
    if (view==='trends') {
      const up=kd.filter(([,d])=>d.changeRate>0).length;
      return {c:'mint', eb:'Keyword compare · 네이버 데이터랩 3개월', h:`추적 키워드 ${kd.length}개 중 <b>${up}개</b>가 오르는 중.<br>선두는 <b>${kd[0][0]}</b>예요.`,
        s:[['Top riser',kd[0][0],pct(kd[0][1].changeRate)],['Runner-up',kd[1][0],pct(kd[1][1].changeRate)],['Watch out',kd[kd.length-1][0],pct(kd[kd.length-1][1].changeRate)]]};
    }
    if (view==='customKeywords') {
      const items=CUSTOM_KEYWORD_GROUPS.flatMap(g=>g.items.map(it=>({...it,g:g.midCategory}))).sort((a,b)=>b.changeRate-a.changeRate);
      const up=items.filter(i=>i.changeRate>0).length;
      return {c:'pink', eb:'Category keywords · 지정 키워드 3개월', h:`지정 키워드 ${items.length}개 중 <b>${up}개</b> 상승.<br>가장 크게 오른 건 <b>${items[0].keyword}</b>.`,
        s:[['Groups','중분류',CUSTOM_KEYWORD_GROUPS.length+'개'],['Top riser',items[0].keyword,pct(items[0].changeRate)],['Watch out',items[items.length-1].keyword,pct(items[items.length-1].changeRate)]]};
    }
    if (view==='category') {
      const cats=Object.entries(CATEGORIES).filter(([k])=>k!=='전체').sort((a,b)=>b[1].count-a[1].count);
      return {c:'coral', eb:'Category analysis · 카테고리 심층', h:`신제품이 가장 몰린 곳은 <b>${cats[0][0]}</b>.<br>${cats.length}개 카테고리를 한눈에.`,
        s:[['No.1',cats[0][0],cats[0][1].count+'개'],['No.2',cats[1][0],cats[1][1].count+'개'],['No.3',cats[2][0],cats[2][1].count+'개']]};
    }
    if (view==='reviews' && REVIEW_DATA) {
      return {c:'navy', eb:'Product reviews · 네이버 브랜드관', h:`리뷰 <b>${REVIEW_DATA.totalReviews.toLocaleString()}건</b>으로 본<br>우리 제품의 평판.`,
        s:[['Reviews','총 리뷰',REVIEW_DATA.totalReviews.toLocaleString()],['Products','분석 상품',REVIEW_DATA.totalProducts.toLocaleString()],['Rating','평균 평점','★ '+(REVIEW_DATA.avgRatingOverall??'-')]]};
    }
    if (view==='weeklyArchive') {
      const r=WEEKLY_ARCHIVE[0]||{};
      return {c:'lime', eb:'Weekly report · 매주 월요일 발송', h:`지금까지 보낸 위클리 <b>${WEEKLY_ARCHIVE.length}호</b>.<br>지난주 1위는 <b>${r.topUpKeyword||'-'}</b>.`,
        s:[['Issues','누적 발송',WEEKLY_ARCHIVE.length+'호'],['Last top',r.topUpKeyword||'-',r.topUpPct!=null?pct(r.topUpPct):'-'],['Last watch',r.topDownKeyword||'-',r.topDownPct!=null?pct(r.topDownPct):'-']]};
    }
    return null;
  }
  function addIntro(view){
    const sec=document.getElementById(view); if(!sec || sec.querySelector(':scope > .cb-intro')) return;
    let d; try { d=intro(view); } catch(e){ console.warn(e); return; }
    if(!d) return;
    const el=document.createElement('section'); el.className=`cb cb-intro cb-${d.c}`;
    el.innerHTML=`<div class="cb-eyebrow">${d.eb}</div><div class="cb-headline">${d.h}</div>
      <div class="cb-stats">${d.s.map(([l,n,v])=>`<div class="cb-stat"><div class="lbl">${l}</div><div class="name">${n}</div><div class="val">${v}</div></div>`).join('')}</div>`;
    sec.prepend(el);
    if (view==='reviews') { const lab=sec.querySelector('.hl-mini-label'); const grid=lab&&lab.closest('.card')&&lab.closest('.card').parentElement; if(grid) grid.style.display='none'; }
  }
  window.addEventListener('load', ()=>{
    setTimeout(apply, 300);
    const orig = window.navigate;
    window.navigate = function(v){ const r=orig.apply(this, arguments); setTimeout(()=>{ addIntro(v); recolorCharts(); }, 350); return r; };
    let waitTries=0;
    const wait=()=>{ if (typeof KEYWORD_DATA==='undefined'||!KEYWORD_DATA) { if(++waitTries<50) setTimeout(wait,200); return; }
      const v=location.hash.slice(1)||'dashboard'; setTimeout(()=>{ addIntro(v); recolorCharts(); }, 600); };
    wait();
  });
})();
