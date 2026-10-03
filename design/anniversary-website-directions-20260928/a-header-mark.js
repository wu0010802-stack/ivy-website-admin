/* a-header-mark：頁首 30 週年記號比稿（2026-09-28）
   本檔在 shared/chrome.js 之前載入：先把記號 HTML 填進 data-brand-extra，chrome.js 再把佔位換成頁首。
   另外負責：膠囊重畫、總表格子、iframe 等比縮放、方向自測數字（寬度與對比，未複驗）。
   顏色一律從 CSS token 讀，不在這裡寫色碼。 */
(function () {
  var root = document.documentElement;
  var v = root.dataset.v;
  var frame = root.dataset.frame || '';
  var LOGO = '../../web/public/assets/logo.webp';
  var HERO = '../../web/public/assets/hero-campus-restored-v1-still.webp';
  var HAS_DOT = { a: 1, b: 1, c: 1 };

  var INFO = {
    none: {
      name: '不加', tag: '現況',
      desc: '現況。頁首只有字標，週年只靠首頁開場布幕；膠囊也不加東西。',
      hero: '現況：影片頁首只有字標。',
      paper: '現況：米白頁首只有字標。'
    },
    sign: {
      name: '文字簽名', tag: '建議',
      desc: '字標後一道 1px 細線，接兩行「30 週年」／「1997–2027」。影片頁首的「30」用品牌金，其餘白字；米白頁首全用字標色。≥1281px 才顯示，1280 以下只留膠囊上的文字籤「30 週年」。',
      hero: '細線：白色 45% 透明，和頁首底線同一種；「30」：LINE Seed 800、品牌金，和中文字標同一行高；「週年」：Noto Sans TC 600、白；「1997–2027」：LINE Seed 700、白，對齊英文字標那一行。小標、大標、副文照正式站。',
      paper: '米白頁首不用金色：「30」「週年」改字標中文色，年份用字標英文色，細線用分隔線色。'
    },
    'sign-noto': {
      name: '30 改 Noto', tag: '需另切子集',
      desc: '同文字簽名，但「30」改用品牌字 Noto Sans TC 600。現有品牌子集沒有 <span class="nw">0–9</span>，這一版需要另切子集，本頁只放說明卡。'
    },
    c: {
      name: 'c 上標小籤', tag: '舊案重畫', redraw: 1,
      desc: '中文校名右上角一枚上標小籤「30 週年」。2026-09-18 在凍結原型比過的舊方案，依當時截圖用 HTML＋CSS 重畫，改套現行頁首。膠囊用舊提案的金色「30」小點。',
      hero: '上標小籤在影片上用金色線框＋金字（鏤空），不填底；掛在中文校名右上角，字標不動。',
      paper: '舊提案在淺底用實心金底；本輪依新規則改成字標色線框，米白頁首不用金色。'
    },
    b: {
      name: 'b 第三行', tag: '舊案重畫', redraw: 1,
      desc: '英文行下方第三行「30 週年 · 1997–2027」，和上兩行同寬。舊方案「週年」與年份之間的長橫線改成「·」，年份寫 1997–2027。依 2026-09-18 截圖重畫；膠囊用金色「30」小點。',
      hero: '第三行照舊案整行金色。字標不能移動，第三行只能擠在英文行和頁首底線之間（間距見總表；比稿框架頁首高 90px，正式站 92px，差 2px 也一樣擠）。',
      paper: '米白頁首改字標色：「30 週年」用中文色，「· 1997–2027」用英文色。'
    },
    a: {
      name: 'a 印章', tag: '舊案重畫', redraw: 1,
      desc: '字標右側一枚和校徽等高的圓章：「30」大字＋「週年」小字，只用文字和 CSS 圓框，不用週年校徽圖。依 2026-09-18 截圖重畫；膠囊用金色「30」小點。',
      hero: '印章和校徽等高，品牌區變成「校徽＋字標＋圓章」三件東西並排；影片上用金色線框＋金字（鏤空）。',
      paper: '舊提案在淺底用實心金圓；本輪依新規則改成字標色線框。'
    }
  };

  function crest(w, h) {
    return '<svg class="brand-crest" viewBox="30 26 124 132"' + (w ? ' width="' + w + '" height="' + h + '"' : '') + ' aria-hidden="true" focusable="false"><image href="' + LOGO + '" width="552" height="192" filter="url(#logo-colour-cutout)" /></svg>';
  }

  /* 頁首記號。sr 為真時照正式站慣例接進品牌連結的名稱：「，30週年，1997 到 2027 年」 */
  function mark(kind, sr) {
    var pre = sr ? '<span class="sr-only">，</span>' : '';
    var yr = sr ? '<span class="sr-only">，1997 到 2027 年</span>' : '';
    if (kind === 'sign') {
      return '<span class="anni anni-sign">' + pre + '<span class="anni-rule" aria-hidden="true"></span><span class="anni-stack"><span class="anni-top"><b class="anni-num">30</b><span class="anni-word">週年</span></span><span class="anni-year" aria-hidden="true">1997–2027</span>' + yr + '</span></span>';
    }
    if (kind === 'c') {
      return '<span class="anni anni-c">' + pre + '<b class="anni-num">30</b><span class="anni-word">週年</span></span>';
    }
    if (kind === 'b') {
      return '<span class="anni anni-b">' + pre + '<span class="anni-lead"><b class="anni-num">30</b> <span class="anni-word">週年</span></span><span class="anni-sep" aria-hidden="true">·</span><span class="anni-year" aria-hidden="true">1997–2027</span>' + yr + '</span>';
    }
    if (kind === 'a') {
      return '<span class="anni anni-a">' + pre + '<b class="anni-num">30</b><span class="anni-word">週年</span></span>';
    }
    return '';
  }

  /* 捲動後膠囊：正式站 SiteHeader.vue .header-pill 的重畫。sign 加文字籤，a／b／c 是舊提案的金色小點 */
  function pill(kind) {
    var label = kind === 'sign' ? '<span class="pill-anni"><span class="sr-only">，</span><b>30</b><span>週年</span></span>' : '';
    var dot = HAS_DOT[kind] ? '<span class="pill-dot" aria-hidden="true">30</span>' : '';
    return '<div class="pill' + (label ? ' has-anni' : '') + '">' +
      '<a class="pill-brand" href="#"><span class="sr-only">常春藤教育機構</span><span class="pill-crest">' + crest(34, 36) + dot + '</span>' + label +
      (dot ? '<span class="sr-only">，30 週年</span>' : '') + '<span class="sr-only">，回首頁</span></a>' +
      '<span class="pill-divider" aria-hidden="true"></span>' +
      '<button class="pill-menu" type="button" aria-label="開啟導覽選單"><span class="menu-lines" aria-hidden="true"><span></span><span></span></span><span class="menu-word" aria-hidden="true">選單<small lang="en">Menu</small></span></button>' +
      '<a class="pill-book" href="#"><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-calendar-check" /></svg>預約參觀</a>' +
      '</div>';
  }

  /* 總表的一格：560×100 靜態重畫（照頁首左上角的位置與尺寸），螢幕閱讀器略過 */
  function cellInner(kind, bg) {
    return '<div class="cell-in">' +
      (bg === 'photo' ? '<div class="vhero"><img src="' + HERO + '" alt="" width="1080" height="800"></div>' : '') +
      '<div class="cell-brand brand">' + crest() + '<span class="brand-copy"><span class="brand-name">常春藤教育機構</span><span class="brand-en" lang="en">Ivy Educational Institution</span></span>' + mark(kind, false) + '</div>' +
      '<span class="cell-rule"></span></div>';
  }

  /* ── 填內容（chrome.js 之前） ─────────────────────────────────── */
  var markKind = v === 'sign-noto' ? '' : v;
  document.querySelectorAll('[data-chrome="head"][data-mark]').forEach(function (el) {
    el.setAttribute('data-brand-extra', mark(markKind, true));
  });
  document.querySelectorAll('[data-pill]').forEach(function (el) {
    el.outerHTML = el.hasAttribute('data-pill-left') ? '<div data-pill-left>' + pill(v) + '</div>' : pill(v);
  });

  if (!frame) {
    document.querySelectorAll('.switcher a').forEach(function (a) {
      if (a.getAttribute('data-v') === v) a.setAttribute('aria-current', 'page');
    });
    var info = INFO[v];
    var now = document.getElementById('now-desc');
    now.innerHTML = '<b>' + info.name + '</b>（' + info.tag + '）：' + info.desc + (info.redraw ? '<span class="demo-note">重畫示意</span>' : '');
    document.querySelectorAll('[data-note="hero"]').forEach(function (el) { el.innerHTML = (info.hero || '') + (info.redraw ? '<span class="demo-note">重畫示意</span>' : ''); });
    document.querySelectorAll('[data-note="paper"]').forEach(function (el) { el.innerHTML = (info.paper || '') + (info.redraw ? '<span class="demo-note">重畫示意</span>' : ''); });

    var pillNotes = {
      none: ['現況：白圓校徽、選單、預約參觀。校名收在連結的可及名稱裡，畫面上不顯示。'],
      sign: ['校徽右側加文字籤「30 週年」：「30」品牌金 LINE Seed 800 17px，「週年」白字 13px。', '不蓋住校徽，底部的 IVY KIDS 緞帶完整。', '膠囊變寬 <span data-pill-grow>…</span>，預約鈕位置不受影響。']
    };
    var dotNotes = ['小點壓住校徽底部的 IVY KIDS 緞帶。', '深底上的金色圓點，像 App 的通知數。', '點裡的「30」只有 <span data-dot-size>…</span>，一般距離看不清。', '這是 2026-09-18 舊提案 a／b／c 共用的小點，建議正式否決。<span class="demo-note">重畫示意</span>'];
    var list = HAS_DOT[v] ? dotNotes : (pillNotes[v] || []);
    document.querySelectorAll('[data-note="pill"]').forEach(function (el) {
      el.innerHTML = list.map(function (t) { return '<li>' + t + '</li>'; }).join('');
    });

    var cap = document.querySelector('[data-cap320]');
    if (cap && v !== 'sign') cap.textContent = HAS_DOT[v] ? '手機 320px：小點照樣顯示' : '手機 320px';

    /* 總表：五種做法 × 影片底／米白底 */
    var sheet = document.getElementById('sheet');
    var rows = ['none', 'sign', 'c', 'b', 'a'];
    var html = '';
    rows.forEach(function (k) {
      var i = INFO[k];
      html += '<div class="sheet-label' + (k === v ? ' is-current' : '') + '"><b>' + i.name + '</b><small>' + i.tag + '</small>' +
        (i.redraw ? '<span class="demo-note">重畫示意</span>' : '') + (k === v ? '<span class="now">目前方案</span>' : '') + '</div>';
      ['photo', 'paper'].forEach(function (bg) {
        html += '<figure class="sheet-cell" data-bg="' + (bg === 'photo' ? '影片底' : '米白底') + '"><div class="cell on-' + bg + '" data-cell="' + k + '" data-cell-bg="' + bg + '" aria-hidden="true"></div>' +
          '<figcaption class="cell-num" data-num="' + k + '-' + bg + '"><span>量測中…</span><span>&nbsp;</span></figcaption></figure>';
      });
    });
    sheet.insertAdjacentHTML('beforeend', html);
    document.querySelectorAll('[data-cell]').forEach(function (el) {
      el.innerHTML = cellInner(el.getAttribute('data-cell'), el.getAttribute('data-cell-bg') || 'photo');
    });

    /* iframe：只在主頁面設定 src，iframe 內（?frame=）不再往下載入，避免無限巢狀 */
    document.querySelectorAll('iframe[data-frame-src]').forEach(function (f) {
      var src = '?v=' + encodeURIComponent(v) + '&frame=' + f.getAttribute('data-frame-src') + (f.hasAttribute('data-force') ? '&force=1' : '');
      f.src = location.pathname + src;
    });
  }

  /* ── chrome.js 之後 ─────────────────────────────────────────── */
  function fit() {
    document.querySelectorAll('.frame-scale').forEach(function (box) {
      var w = +box.getAttribute('data-w'), h = +box.getAttribute('data-h');
      box.style.maxWidth = w + 'px';
      var s = Math.min(1, box.clientWidth / w);
      var f = box.querySelector('iframe');
      f.style.transform = s < 1 ? 'scale(' + s + ')' : '';
      box.style.height = Math.round(h * s) + 'px';
    });
    document.querySelectorAll('.cell').forEach(function (c) {
      var inner = c.querySelector('.cell-in');
      if (!inner || !c.clientWidth) return;
      var s = Math.min(1, c.clientWidth / 560);
      inner.style.transform = s < 1 ? 'scale(' + s + ')' : '';
      c.style.height = Math.round(100 * s) + 'px';
      c.dataset.scale = s;
    });
  }

  /* 顏色換成 sRGB：讓瀏覽器把 token 算出來的顏色（oklch 也行）畫到 1×1 canvas 再讀回 */
  var probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  var pctx = probe.getContext('2d', { willReadFrequently: true });
  function rgbOf(css) {
    pctx.clearRect(0, 0, 1, 1);
    pctx.fillStyle = css;
    pctx.fillRect(0, 0, 1, 1);
    var d = pctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }
  function lin(x) { x /= 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
  function lum(r, g, b) { return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
  function ratio(a, b) { var hi = Math.max(a, b), lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05); }
  function fmt(r) { return (Math.floor(r * 10) / 10).toFixed(1) + ':1'; }

  /* 把首屏（1440×900、object-position 50% 35%、三道遮罩）畫到 canvas，和 .vhero 的 CSS 同一套數值 */
  function renderHero(img) {
    var W = 1440, H = 900, c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d', { willReadFrequently: true });
    var s = Math.max(W / img.naturalWidth, H / img.naturalHeight), dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    g.drawImage(img, (W - dw) * 0.5, (H - dh) * 0.35, dw, dh);
    var S = getComputedStyle(root).getPropertyValue('--shadow-rgb').trim();
    function col(a) { return 'rgb(' + S + ' / ' + a + ')'; }
    var top = g.createLinearGradient(0, 0, 0, 140);
    top.addColorStop(0, col(0.6)); top.addColorStop(76 / 140, col(0.6)); top.addColorStop(1, col(0));
    g.fillStyle = top; g.fillRect(0, 0, W, 140);
    g.save();
    g.translate(0.24 * W, 0.49 * H); g.scale(1, (0.42 * H) / (0.40 * W));
    var rad = g.createRadialGradient(0, 0, 0, 0, 0, 0.40 * W);
    rad.addColorStop(0, col(0.68)); rad.addColorStop(0.55, col(0.6)); rad.addColorStop(1, col(0));
    g.fillStyle = rad; g.fillRect(-W, -H * 3, W * 3, H * 6);
    g.restore();
    var side = g.createLinearGradient(0, 0, W, 0);
    [[0, 0.23], [0.34, 0.22], [0.42, 0.17], [0.55, 0.04], [0.62, 0]].forEach(function (p) { side.addColorStop(p[0], col(p[1])); });
    g.fillStyle = side; g.fillRect(0, 0, W, H);
    return g;
  }
  function brightest(g, x, y, w, h) {
    x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
    w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
    var d = g.getImageData(x, y, w, h).data, m = 0;
    for (var i = 0; i < d.length; i += 4) { var L = lum(d[i], d[i + 1], d[i + 2]); if (L > m) m = L; }
    return m;
  }

  function measure(img) {
    var g = img ? renderHero(img) : null;
    var paperL = (function () { var p = rgbOf(getComputedStyle(document.querySelector('.cell.on-paper')).backgroundColor); return lum(p[0], p[1], p[2]); })();
    var base = {};
    ['photo', 'paper'].forEach(function (bg) {
      var b = document.querySelector('.cell[data-cell="none"][data-cell-bg="' + bg + '"] .cell-brand');
      base[bg] = b.offsetWidth;
    });
    document.querySelectorAll('.sheet .cell').forEach(function (cell) {
      var kind = cell.getAttribute('data-cell'), bg = cell.getAttribute('data-cell-bg');
      var out = document.querySelector('[data-num="' + kind + '-' + bg + '"]');
      if (!out) return;
      var inner = cell.querySelector('.cell-in'), s = +cell.dataset.scale || 1, o = inner.getBoundingClientRect();
      var brand = cell.querySelector('.cell-brand');
      var parts = kind === 'none' ? cell.querySelectorAll('.brand-name, .brand-en') : cell.querySelectorAll('.anni-num, .anni-word, .anni-year, .anni-sep');
      /* 第一行：寬度、最小字 */
      var line1;
      var sizes = [];
      parts.forEach(function (el) { sizes.push(parseFloat(getComputedStyle(el).fontSize)); });
      var minFs = Math.round(Math.min.apply(null, sizes));
      if (kind === 'none') {
        line1 = '品牌區寬 ' + brand.offsetWidth + 'px（基準）';
      } else if (kind === 'b') {
        /* 頁首底線在 cell-in 的 y=89；位置除回縮放比例，取到 0.5px，桌機和手機量出來才會一樣 */
        var row = cell.querySelector('.anni-b'), rr = row.getBoundingClientRect();
        var gap = Math.round((89 - (rr.bottom - o.top) / s) * 2) / 2;
        line1 = '寬 +0px · ' + (gap < 0 ? '第三行行框和頁首底線重疊 ' + (-gap) + 'px' : '第三行行框距頁首底線 ' + gap + 'px') + ' · 最小字 ' + minFs + 'px';
      } else {
        line1 = '寬 +' + (brand.offsetWidth - base[bg]) + 'px（' + brand.offsetWidth + 'px）· 最小字 ' + minFs + 'px';
      }
      /* 第二行：對比（依文字色分組取最低） */
      var groups = {};
      parts.forEach(function (el) {
        var cs = getComputedStyle(el), rgb = rgbOf(cs.color), L = lum(rgb[0], rgb[1], rgb[2]);
        var key = rgb.join(',');
        var r;
        if (bg === 'paper') {
          r = ratio(L, paperL);
        } else {
          if (!g) return;
          var e = el.getBoundingClientRect();
          r = ratio(L, brightest(g, (e.left - o.left) / s, (e.top - o.top) / s, e.width / s, e.height / s));
        }
        if (!groups[key] || r < groups[key].r) groups[key] = { r: r, el: el };
      });
      var names = [];
      Object.keys(groups).forEach(function (k) {
        var el = groups[k].el, n;
        var tokenName = colourName(el, bg);
        n = tokenName + ' ' + fmt(groups[k].r);
        names.push(n);
      });
      var line2 = (bg === 'photo' ? '首幀最亮處對比：' : '對比（對米白底）：') + names.join(' · ');
      out.innerHTML = '<span>' + line1 + '</span><span>' + line2 + '</span>';
    });
    /* 膠囊：文字籤讓膠囊變多寬；小點的字級 */
    var grow = document.querySelector('[data-pill-grow]');
    if (grow) {
      var p = document.querySelector('.stage-pill .pill');
      var lab = p && p.querySelector('.pill-anni');
      if (window.innerWidth <= 900) grow.parentNode.innerHTML = '手機膠囊本來就滿版，籤只佔掉校徽和漢堡之間的留白；≤359px 收籤。';
      else if (lab) grow.textContent = (lab.offsetWidth + 10 + 6) + 'px';
    }
    var ds = document.querySelector('[data-dot-size]');
    if (ds) {
      var dot = document.querySelector('.stage-pill .pill-dot');
      if (dot) ds.textContent = Math.round(parseFloat(getComputedStyle(dot).fontSize)) + 'px';
    }
  }
  /* 對比數字前的顏色名稱：用元素實際套到的 token 判斷 */
  function colourName(el, bg) {
    if (el.classList.contains('brand-name') || el.classList.contains('brand-en')) {
      return bg === 'photo' ? '白字標' : (el.classList.contains('brand-name') ? '字標中文色' : '字標英文色');
    }
    var c = rgbOf(getComputedStyle(el).color).join(',');
    var probeEl = document.createElement('span');
    var table = [['--gold', '金'], ['--ivy-logo-chinese', '字標中文色'], ['--ivy-logo-english', '字標英文色']];
    for (var i = 0; i < table.length; i++) {
      probeEl.style.color = 'var(' + table[i][0] + ')';
      document.body.appendChild(probeEl);
      var t = rgbOf(getComputedStyle(probeEl).color).join(',');
      probeEl.remove();
      if (t === c) return table[i][1];
    }
    return '白';
  }

  function relabelNavs() {
    /* 同一頁有兩份頁首：第二份的導覽換個名稱，landmark 才不會重名 */
    document.querySelectorAll('.stage-paper .site-nav').forEach(function (n) { n.setAttribute('aria-label', '主選單（米白頁首）'); });
  }

  function after() {
    relabelNavs();
    fit();
    if (frame) return;
    var img = new Image();
    img.src = HERO;
    var ready = (document.fonts ? document.fonts.ready : Promise.resolve());
    ready.then(function () { return img.decode(); }).then(function () {
      fit();
      measure(img);
    }).catch(function () {
      fit();
      measure(null);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', after);
  else setTimeout(after, 0);
  window.addEventListener('resize', fit);
})();
