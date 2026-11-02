// ============================================================
//  js/visit-stats.js — 방문자 통계 (GoatCounter)
//  - 통계 화면은 https://<CODE>.goatcounter.com 에 로그인한 사람만 볼 수 있다.
//    (대시보드 화면에는 아무것도 표시하지 않음)
//  - 쿠키·개인정보를 쓰지 않는다. 같은 사람이 하루에 여러 번 와도 방문자 1명으로 센다.
//  - 메뉴(해시 화면)를 옮길 때마다 '/products' 처럼 화면별 페이지뷰로도 집계해서
//    어떤 메뉴를 많이 보는지 알 수 있다.
//  - 내 방문은 빼고 싶으면, 그 PC 브라우저에서 사이트 주소 뒤에 #toggle-goatcounter 를
//    붙여 한 번 열면 된다 (브라우저별 설정, 다시 열면 해제).
// ============================================================
(function () {
  var CODE = 'nhfood-trend';   // goatcounter.com 가입 때 정한 사이트 코드 (예: 'nhfood-trend')
  if (!CODE || location.protocol === 'file:' || /^(localhost|127\.)/.test(location.hostname)) return;

  window.goatcounter = { no_onload: true };   // 첫 화면은 아래에서 화면 이름으로 직접 집계
  var last = null, lastAt = 0;
  function count(view) {
    view = view || 'dashboard';
    var now = Date.now();
    if (view === last && now - lastAt < 2000) return;   // 같은 화면 연속 호출은 1번만
    last = view; lastAt = now;
    if (window.goatcounter && typeof window.goatcounter.count === 'function') {
      window.goatcounter.count({ path: '/' + view, title: document.title });
    }
  }

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.setAttribute('data-goatcounter', 'https://' + CODE + '.goatcounter.com/count');
  s.onload = function () { count(location.hash.slice(1)); };
  document.head.appendChild(s);

  window.addEventListener('load', function () {
    var orig = window.navigate;
    if (typeof orig !== 'function') return;
    window.navigate = function (v) {
      var r = orig.apply(this, arguments);
      count(v);
      return r;
    };
  });
})();
