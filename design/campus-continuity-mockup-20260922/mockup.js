(function () {
  'use strict';
  var content = window.CAMPUS_PROPOSAL;
  var key = new URLSearchParams(location.search).get('campus');
  var campus = content.campuses.find(function (c) { return c.key === key; }) || content.campuses[0];
  var asset = '../../web/public/assets/';
  var live = 'http://127.0.0.1:3010';
  function e(value) { return String(value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function icon(name) { return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"></use></svg>'; }
  function image(name, alt, cls) { return '<img class="' + (cls || '') + '" src="' + asset + e(name) + '.webp" alt="' + e(alt) + '" loading="lazy" decoding="async">'; }
  function schoolLink(c) { return 'preview.html?campus=' + c.key; }
  var map = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(campus.address);
  var introParts = campus.intro.split('，');
  var intro = introParts.map(e).join('，<br>');
  var schoolMenu = content.campuses.map(function (c) { return '<a href="' + schoolLink(c) + '"' + (c.key === campus.key ? ' aria-current="page"' : '') + '>' + e(c.name) + '</a>'; }).join('');
  var social = campus.line ? '<a class="text-link" href="' + e(campus.line) + '" target="_blank" rel="noopener noreferrer">' + icon('line') + 'LINE 聯絡' + e(campus.name) + ' ↗</a>' : '<span class="pending">LINE · 待園方提供</span>';
  var contactText = '<a class="text-link" href="' + map + '" target="_blank" rel="noopener noreferrer">在 Google 地圖開啟 ↗</a>';
  document.title = campus.name + '｜首頁延續版 mock-up';
  document.getElementById('app').innerHTML =
    '<svg aria-hidden="true" class="sprite">' + content.symbols + '</svg>' +
    '<header class="site-header"><a class="brand" href="' + live + '/" target="_top" aria-label="常春藤教育機構首頁"><img src="../../web/public/favicon-48.png" width="48" height="48" alt=""><span><strong>常春藤教育機構</strong><small lang="en">Ivy Educational Institution</small></span></a>' +
      '<nav class="desktop-nav" aria-label="主要導覽"><a href="#about">認識' + e(campus.name) + '<small lang="en">Our Campus</small></a><a href="#spaces">校園環境<small lang="en">Campus Life</small></a><a href="#faq">參觀須知<small lang="en">Plan Your Visit</small></a><a href="#contact">交通與聯絡<small lang="en">Contact Us</small></a></nav>' +
      '<a class="header-book" href="' + live + '/visit/' + campus.key + '" target="_blank" rel="noopener">' + icon('calendar-check') + '<span>預約參觀<small lang="en">Book a Visit</small></span></a><button class="menu-toggle" aria-expanded="false" aria-controls="mobile-menu" aria-label="開啟導覽選單"><span></span><span></span></button>' +
      '<nav id="mobile-menu" class="mobile-menu" aria-label="手機導覽" hidden><a href="#about">認識' + e(campus.name) + '</a><a href="#spaces">校園環境</a><a href="#faq">參觀須知</a><a href="#contact">交通與聯絡</a><div class="mobile-schools">' + schoolMenu + '</div></nav></header>' +
    '<main id="main"><div class="wrap breadcrumb"><a href="' + live + '/" target="_top">首頁</a><span>/</span><a href="' + live + '/#campuses" target="_top">分校資訊</a><span>/</span><span aria-current="page">' + e(campus.name) + '</span></div>' +
      '<section class="campus-hero wrap" aria-labelledby="campus-title"><div class="hero-heading"><div class="identity"><span class="eyebrow">高雄 · ' + e(campus.district) + '</span><div class="name-row"><h1 id="campus-title">' + e(campus.name) + '</h1><span class="campus-english" lang="en">' + e(campus.key.toUpperCase()) + '<br>CAMPUS</span></div></div><div class="hero-message"><p>' + intro + '</p><a class="gold-button" href="#contact">參觀與聯絡' + icon('arrow-right') + '</a></div></div>' +
      '<figure class="hero-photo"><img src="' + asset + e(campus.image) + '.webp" alt="' + e(campus.name) + '校園外觀" fetchpriority="high" decoding="async" style="object-position:' + e(campus.panoramaPos || 'center') + '"></figure>' +
      '<div class="quick-info"><a href="' + map + '" target="_blank" rel="noopener noreferrer">' + icon('map-pin') + '<span><small>校園位置</small>' + e(campus.address) + '</span></a><a href="tel:' + e(campus.phone) + '">' + icon('phone') + '<span><small>參觀專線</small><b lang="en">' + e(campus.phone) + '</b></span></a><a class="quiet-link" href="#spaces">看看校園環境<span>↓</span></a></div></section>' +
      '<section id="about" class="about wrap"><div><span class="eyebrow">認識' + e(campus.name) + '</span><h2>' + intro + '</h2></div><div class="about-copy"><p>' + e(campus.description) + '</p><p>不急著做決定，先從一次親自走訪開始。帶著你想了解的事情，看看這裡是否適合孩子。</p></div></section>' +
      '<section id="spaces" class="spaces"><div class="wrap"><div class="section-heading"><div><span class="eyebrow">校園環境</span><h2>先走進校園，<br>再想像孩子的日常。</h2></div><p>點選照片，認識' + e(campus.name) + '的空間。<br>實際參觀範圍請先向園所確認。</p></div><div class="tour"><div class="tour-media"><img id="scene-photo" src="' + asset + e(campus.scenes[0].image) + '.webp" alt="' + e(campus.name + ' · ' + campus.scenes[0].name) + '" loading="lazy" decoding="async"><div class="scene-tabs" role="group" aria-label="選擇校園照片">' + campus.scenes.map(function (s, i) { return '<button type="button" data-scene="' + i + '" aria-pressed="' + (i === 0) + '">' + image(s.image, '') + '<span>' + e(s.name) + '</span></button>'; }).join('') + '</div></div><div class="tour-copy"><span class="eyebrow" id="scene-count">01 / ' + String(campus.scenes.length).padStart(2, '0') + '</span><h3 id="scene-name"></h3><p id="scene-intro"></p><div class="tour-note"><span>參觀時，聊聊這些事</span><p id="scene-question"></p></div><a class="text-link" href="' + live + '/campuses/' + campus.key + '#environment" target="_blank" rel="noopener">開啟現有互動校園導覽</a></div></div></div></section>' +
      '<section id="faq" class="faq wrap"><div><span class="eyebrow">參觀須知</span><h2>讓第一次參觀，<br>更安心一點。</h2><p>參觀時間、課程與入學安排，<br>請直接向' + e(campus.name) + '確認。</p></div><div class="faq-list">' + campus.faq.map(function (item) { return '<details><summary>' + e(item.q) + '<span aria-hidden="true"></span></summary><p>' + e(item.a) + '</p></details>'; }).join('') + '</div></section>' +
      '<section id="contact" class="contact"><div class="wrap contact-grid"><div><span class="eyebrow">交通與聯絡</span><h2>我們在這裡，<br>等你來。</h2><p>帶著孩子，也帶著你想了解的事。</p></div><div class="contact-main"><a class="contact-phone" href="tel:' + e(campus.phone) + '" lang="en">' + e(campus.phone) + '</a><p class="contact-address">' + e(campus.address) + '</p><div class="contact-actions"><a class="gold-button" href="tel:' + e(campus.phone) + '">' + icon('phone') + '致電' + e(campus.name) + '</a>' + social + '</div><p class="visit-note">請事先聯絡園所確認接待時間。</p>' + contactText + '</div></div></section>' +
      '<section class="other-campuses wrap"><div><span class="eyebrow">我們的大家庭</span><h2>分校資訊</h2></div><nav aria-label="五校導覽">' + schoolMenu + '</nav></section></main>' +
    '<footer><div class="wrap footer-row"><div><a class="footer-name" href="' + live + '/" target="_top">常春藤教育機構</a><p>陪伴每一個孩子，長成自己喜歡的樣子。</p></div><p>© 2026 常春藤教育機構<br>參觀時間與入學資訊，請向各校確認。</p></div></footer>';

  function updateScene(index) {
    var scene = campus.scenes[index];
    var photo = document.getElementById('scene-photo');
    photo.src = asset + scene.image + '.webp';
    photo.alt = campus.name + ' · ' + scene.name;
    document.getElementById('scene-count').textContent = String(index + 1).padStart(2, '0') + ' / ' + String(campus.scenes.length).padStart(2, '0');
    document.getElementById('scene-name').textContent = scene.name;
    document.getElementById('scene-intro').textContent = scene.spots[0].text;
    document.getElementById('scene-question').textContent = scene.spots[0].question;
    document.querySelectorAll('[data-scene]').forEach(function (button) { button.setAttribute('aria-pressed', String(Number(button.dataset.scene) === index)); });
  }
  updateScene(0);
  document.querySelectorAll('[data-scene]').forEach(function (button) { button.addEventListener('click', function () { updateScene(Number(button.dataset.scene)); }); });
  var toggle = document.querySelector('.menu-toggle');
  var menu = document.getElementById('mobile-menu');
  function closeMenu() { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-label', '開啟導覽選單'); }
  toggle.addEventListener('click', function () { var open = menu.hidden; menu.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? '關閉導覽選單' : '開啟導覽選單'); });
  menu.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', closeMenu); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !menu.hidden) { closeMenu(); toggle.focus(); } });
})();
