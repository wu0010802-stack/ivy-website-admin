(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const layout = ['a', 'b', 'c'].includes(params.get('layout')) ? params.get('layout') : 'a';
  const campuses = window.CAMPUSES;
  let index = Math.max(0, campuses.findIndex(c => c.key === params.get('campus')));
  let state = params.get('state') === 'open' ? 'open' : 'paused';
  const app = document.querySelector('#app');
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => `<svg class="icon icon-${name}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  document.body.dataset.layout = layout;
  if (params.get('capture') === '1') document.body.classList.add('capture');
  document.querySelector('#booking-state').value = state;

  function syncUrl() {
    params.set('layout', layout);
    params.set('campus', campuses[index].key);
    params.set('state', state);
    history.replaceState(null, '', `?${params}`);
    document.querySelectorAll('[data-layout]').forEach(a => {
      const next = new URLSearchParams(params);
      next.set('layout', a.dataset.layout);
      a.href = `?${next}`;
      a.toggleAttribute('aria-current', a.dataset.layout === layout);
      if (a.dataset.layout === layout) a.setAttribute('aria-current', 'page');
    });
  }

  const header = () => `<header class="site-chrome"><a class="brand-mini" href="index.html" aria-label="回到三種版型比較"><svg viewBox="30 26 124 132" role="img" aria-label="常春藤校徽"><image href="../../assets/logo.png" width="552" height="192" /></svg></a><span class="chrome-separator"></span><a class="chrome-menu" href="index.html"><span class="menu-lines" aria-hidden="true"></span><span>選單<small lang="en">Menu</small></span></a><button class="chrome-book" data-demo="visit">${icon('calendar-check')}預約參觀</button></header>`;
  const heading = () => `<div class="section-heading"><span lang="en" class="eyebrow">CAMPUSES</span><h1>分校資訊</h1></div>`;
  function tabs(vertical = false) {
    return `<div class="campus-picker ${vertical ? 'is-vertical' : ''}">${vertical ? '' : `<button class="round-control" data-step="-1" aria-label="上一校">${icon('arrow-left')}</button>`}<div class="tabs" role="tablist" aria-label="選擇校區" aria-orientation="${vertical ? 'vertical' : 'horizontal'}">${campuses.map((c, i) => `<button class="campus-tab" id="tab-${c.key}" role="tab" aria-selected="${i === index}" aria-controls="campus-panel" tabindex="${i === index ? 0 : -1}" data-campus="${i}">${vertical ? `<span class="tab-number" aria-hidden="true">0${i + 1}</span>` : ''}<span>${c.name}</span>${vertical ? `<span class="tab-district">${c.district}</span>${icon('arrow-right')}` : ''}</button>`).join('')}</div>${vertical ? '' : `<button class="round-control" data-step="1" aria-label="下一校">${icon('arrow-right')}</button>`}</div>`;
  }
  const mobileSelect = () => `<div class="mobile-picker"><label for="campus-select">選擇校區</label><div><select id="campus-select">${campuses.map((c, i) => `<option value="${i}" ${index === i ? 'selected' : ''}>${c.name} · ${c.district}</option>`).join('')}</select><button class="round-control" data-step="-1" aria-label="上一校">${icon('arrow-left')}</button><button class="round-control" data-step="1" aria-label="下一校">${icon('arrow-right')}</button></div></div>`;
  const identity = c => `<div class="campus-identity"><p class="location-label">高雄 · ${c.district}</p><h2>${c.name}<span class="name-dot" aria-hidden="true">。</span></h2><p class="campus-en" lang="en">${c.key.toUpperCase()} CAMPUS</p></div>`;
  const photo = c => `<figure class="campus-photo"><img src="../../assets/${c.image}.webp" alt="${c.name}校園外觀" style="--photo-pos:${escape(c.panoramaPos || 'center 35%')};--detail-pos:${escape(c.photoPos || 'center')}" fetchpriority="high"><figcaption>${icon('map-pin')}高雄 · ${c.district}</figcaption></figure>`;
  const facts = c => `<dl class="campus-facts"><div class="fact-location"><dt>${icon('map-pin')}校園位置</dt><dd>${c.address}</dd></div><div class="fact-phone"><dt>${icon('phone')}參觀專線</dt><dd><a href="tel:${c.phone}">${c.phone}</a></dd></div></dl>`;
  const social = c => `<div class="social-links">${c.line ? `<a href="${escape(c.line)}" target="_blank" rel="noopener noreferrer">${icon('line')}LINE 好友${icon('arrow-up-right')}</a>` : `<span class="pending">${icon('line')}LINE 待補</span>`}${c.facebook ? `<a href="${escape(c.facebook)}" target="_blank" rel="noopener noreferrer">${icon('facebook')}Facebook${icon('arrow-up-right')}</a>` : `<span class="pending">${icon('facebook')}Facebook 待補</span>`}</div>`;
  const map = c => `<a class="map-link" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}" target="_blank" rel="noopener noreferrer">查看位置與路線${icon('arrow-up-right')}</a>`;
  function actions(c) {
    return `<div class="campus-actions">${state === 'paused' ? `<p class="booking-note">目前暫停開放參觀預約</p><button class="primary-button" data-demo="news">查看最新消息${icon('arrow-right')}</button>` : `<p class="booking-note">安排一次校園參觀</p><button class="primary-button" data-demo="visit">預約參觀${c.name}${icon('arrow-right')}</button>`}${map(c)}</div>`;
  }
  const panelAttributes = c => `id="campus-panel" role="tabpanel" aria-labelledby="tab-${c.key}"`;

  function render() {
    const c = campuses[index];
    const a = `<section class="campus-section layout-a">${heading()}<div class="section-wrap">${tabs()}<article class="panorama-board" ${panelAttributes(c)}>${photo(c)}<div class="contact-strip">${identity(c)}<div class="contact-details">${facts(c)}${social(c)}</div>${actions(c)}</div></article></div></section>`;
    const b = `<section class="campus-section layout-b"><div class="section-wrap">${heading()}${tabs()}<article class="split-board" ${panelAttributes(c)}>${photo(c)}<div class="split-info">${identity(c)}<div class="contact-details">${facts(c)}${social(c)}</div>${actions(c)}</div></article></div></section>`;
    const cc = `<section class="campus-section layout-c"><div class="section-wrap">${heading()}<div class="side-board"><aside class="school-sidebar"><p class="sidebar-label">選擇你的校園</p>${tabs(true)}${mobileSelect()}<img class="campus-line-art" src="../../assets/campus-line-art-${c.key}.webp" alt="" aria-hidden="true"></aside><article class="overlap-board" ${panelAttributes(c)}>${photo(c)}<div class="floating-contact"><div class="floating-top">${identity(c)}${actions(c)}</div><div class="floating-bottom">${facts(c)}${social(c)}</div></div></article></div></div></section>`;
    app.innerHTML = window.ICON_SPRITE + header() + ({a, b, c: cc}[layout]);
    syncUrl();
    document.title = `${layout.toUpperCase()} · ${c.name} · 分校版型 mock-up`;
  }

  function choose(nextIndex, focusTab = false) {
    const scroll = window.scrollY;
    index = (nextIndex + campuses.length) % campuses.length;
    render();
    if (focusTab) document.querySelector(`[data-campus="${index}"]`).focus({ preventScroll: true });
    window.scrollTo(0, scroll);
    document.querySelector('#live').textContent = `目前顯示${campuses[index].name}，高雄${campuses[index].district}`;
  }
  let noteTimer;
  app.addEventListener('click', event => {
    const tab = event.target.closest('[data-campus]');
    const step = event.target.closest('[data-step]');
    const demo = event.target.closest('[data-demo]');
    if (tab) choose(Number(tab.dataset.campus), true);
    if (step) {
      const stepValue = step.dataset.step;
      choose(index + Number(stepValue));
      [...document.querySelectorAll(`[data-step="${stepValue}"]`)].find(el => el.getClientRects().length)?.focus({ preventScroll: true });
    }
    if (demo) {
      const note = document.querySelector('#demo-note');
      note.textContent = demo.dataset.demo === 'news' ? '此為版型預覽，正式版會前往最新消息。' : '此為版型預覽，未送出任何預約資料。';
      note.hidden = false;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => { note.hidden = true; }, 3800);
    }
  });
  app.addEventListener('keydown', event => {
    const tab = event.target.closest('[data-campus]');
    if (!tab) return;
    const vertical = tab.closest('[aria-orientation="vertical"]');
    const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
    const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';
    const target = event.key === nextKey ? index + 1 : event.key === prevKey ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? campuses.length - 1 : null;
    if (target !== null) { event.preventDefault(); choose(target, true); }
  });
  app.addEventListener('change', event => {
    if (event.target.id === 'campus-select') {
      choose(Number(event.target.value));
      document.querySelector('#campus-select').focus({ preventScroll: true });
    }
  });
  document.querySelector('#booking-state').addEventListener('change', event => {
    state = event.target.value;
    render();
  });
  render();
})();
