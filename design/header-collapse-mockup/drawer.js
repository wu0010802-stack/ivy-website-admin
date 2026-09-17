// A standalone design study. Social buttons intentionally do not navigate externally.
if (new URLSearchParams(location.search).get('variant') !== 'menu-only') {
  const initialUrl = new URL(location.href);
  initialUrl.searchParams.set('variant', 'menu-only');
  history.replaceState(null, '', initialUrl);
}
const drawerFrame = document.querySelector('#preview');
drawerFrame.addEventListener('header-ready', ({ detail }) => {
  const { win, doc, menu, book, links } = detail;
  doc.body.classList.add('mock-drawer-preview');
  const css = doc.createElement('link');
  css.rel = 'stylesheet'; css.href = new URL('drawer.css', location.href).href;
  doc.head.append(css);
  const proportionCss = doc.createElement('link');
  proportionCss.rel = 'stylesheet'; proportionCss.href = new URL('mascot-proportions.css', location.href).href; doc.head.append(proportionCss);
  const modernCss = doc.createElement('link');
  modernCss.rel = 'stylesheet'; modernCss.href = new URL('mascot-modern.css', location.href).href; doc.head.append(modernCss);
  const proportionParams = new URLSearchParams(location.search);
  const modern = window.IvyModernMascot.designs.find(design => design.id === proportionParams.get('modern'));
  const proportion = proportionParams.has('ratio') ? window.IvyMascotProportions.normalize(Object.fromEntries(proportionParams)) : null;
  const proportionAsset = new URL('../../assets/logo.png', location.href).href;
  const circleMarkup = '<svg aria-hidden="true" focusable="false" viewBox="0 0 56 56"><circle cx="28" cy="28" r="25"/></svg>';
  const moreFrames = window.IvyFineFrames?.frames || [];
  const frameList = [{id:'corners',code:'A',name:'雙角留白'},{id:'circle',code:'B',name:'開口圓框'},{id:'leaf',code:'C',name:'葉形細框'},...moreFrames,{id:'mascot',code:'X',name:'人物 Logo 選單'}];
  const knownFrames = frameList.map(frame => frame.id);
  const allFrames = document.querySelector('#all-frames');
  allFrames.replaceChildren(...frameList.map(frame => new Option(`${frame.code} · ${frame.name}`,frame.id)));
  const frameButtons = [...document.querySelectorAll('.frame-choice')];
  const mascotMark = '<svg class="mascot-menu-mark" aria-hidden="true" focusable="false" viewBox="0 0 28 28"><circle cx="14" cy="14" r="13"/><path d="M8 10h12M8 14h12M8 18h12"/></svg>';
  // Reuse the exact crest already displayed in the website header.
  function crestFor(targetDoc, preview = false) {
    const crest = targetDoc.importNode(doc.querySelector('.brand-crest'), true);
    crest.setAttribute('class', 'mascot-art');
    crest.setAttribute('width', '80'); crest.setAttribute('height', '85');
    if (preview) {
      crest.querySelector('image').setAttribute('href', new URL(crest.querySelector('image').getAttribute('href'), doc.baseURI).href);
      const filter = doc.querySelector('#logo-colour-cutout');
      if (filter) {
        const defs = targetDoc.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const copy = targetDoc.importNode(filter, true);
        copy.id = 'mascot-preview-cutout'; defs.append(copy); crest.prepend(defs);
        crest.querySelector('image').setAttribute('filter', 'url(#mascot-preview-cutout)');
      }
    }
    return crest;
  }
  const specimen = document.querySelector('.mascot-specimen');
  specimen.replaceChildren(crestFor(document, true));
  specimen.insertAdjacentHTML('beforeend', mascotMark);
  function setFrame(name) {
    const chosen = knownFrames.includes(name) ? name : 'corners';
    menu.classList.remove(...knownFrames.map(name => `frame-${name}`));
    menu.classList.add(`frame-${chosen}`);
    menu.closest('.header').classList.toggle('mock-mascot', chosen === 'mascot');
    menu.querySelectorAll('svg,.proportion-emblem,.modern-emblem').forEach(svg => svg.remove());
    menu.removeAttribute('data-proportion');
    menu.removeAttribute('data-modern');
    if (chosen === 'circle') menu.insertAdjacentHTML('beforeend',circleMarkup);
    else if (moreFrames.some(frame => frame.id === chosen)) menu.insertAdjacentHTML('beforeend',window.IvyFineFrames.border(chosen));
    else if (chosen === 'mascot') {
      if (modern) {
        menu.dataset.modern = modern.id;
        menu.closest('.header').style.setProperty('--modern-width', `${modern.width}px`);
        menu.closest('.header').style.setProperty('--modern-height', `${modern.height}px`);
        menu.insertAdjacentHTML('beforeend', window.IvyModernMascot.markup(modern, proportionAsset, 'live'));
        specimen.innerHTML = window.IvyModernMascot.markup(modern, proportionAsset, 'panel');
        document.querySelector('.mascot-concept h1').textContent = modern.name;
        document.querySelector('.mascot-concept p').innerHTML = `${modern.note}<br>人物 ${modern.logo}px · 三條線 ${modern.lines}px`;
      } else if (proportion) {
        const dimensions = window.IvyMascotProportions.geometry(proportion);
        menu.dataset.proportion = 'true';
        menu.closest('.header').style.setProperty('--proportion-width', `${dimensions.width}px`);
        menu.closest('.header').style.setProperty('--proportion-height', `${dimensions.height}px`);
        menu.insertAdjacentHTML('beforeend', window.IvyMascotProportions.markup(proportion, proportionAsset, 'live'));
        specimen.innerHTML = window.IvyMascotProportions.markup(proportion, proportionAsset, 'panel');
        document.querySelector('.mascot-concept p').innerHTML = `人物 ${proportion.logo}px · 三條線 ${proportion.lines}px<br>${proportion.shape === 'none' ? '透明背景' : `底板 ${proportion.backing}px · 人物佔 ${Math.round(proportion.logo/proportion.backing*100)}%`}`;
        document.querySelector('.mascot-ratio-link').href = `mascot-ratios.html?${window.IvyMascotProportions.query(proportion)}`;
      } else { menu.append(crestFor(doc)); menu.insertAdjacentHTML('beforeend', mascotMark); }
    }
    document.body.classList.toggle('mascot-study', chosen === 'mascot');
    document.body.classList.toggle('modern-study', chosen === 'mascot' && !!modern);
    document.querySelector('.panel-heading strong').textContent = chosen === 'mascot' ? '人物徽章，成為選單入口。' : '三條線，也可以有一點個性。';
    document.title = chosen === 'mascot' ? '常春藤｜人物 Logo 抽屜按鈕 Mock-up' : '常春藤｜簡約外框與社群抽屜 Mock-up';
    menu.title = chosen === 'mascot' ? '開啟選單' : '';
    if (document.querySelector('#compact').getAttribute('aria-pressed') === 'true') document.querySelector('#status').textContent = chosen === 'mascot' ? '收合後 · 人物 Logo' : '收合後 · 只留三條線';
    allFrames.value = chosen;
    document.querySelector('.frame-library a').href = chosen === 'mascot' || moreFrames.find(frame => frame.id === chosen)?.round === 3 ? 'frames.html?round=3' : 'frames.html';
    frameButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.frame === chosen)));
    const url = new URL(location.href); url.searchParams.set('frame', chosen); history.replaceState(null, '', url);
  }
  frameButtons.forEach(button => button.onclick = () => setFrame(button.dataset.frame));
  allFrames.onchange = () => setFrame(allFrames.value);
  setFrame(new URLSearchParams(location.search).get('frame'));
  const dialog = doc.createElement('dialog');
  dialog.id = 'ivy-menu-drawer';
  dialog.className = 'ivy-menu-drawer';
  dialog.setAttribute('aria-label', '常春藤網站導覽');
  dialog.setAttribute('tabindex', '-1');
  const arrow = '<svg aria-hidden="true" viewBox="0 0 30 30"><path d="M4 15h21M17 7l8 8-8 8"/></svg>';
  const icons = {
    Facebook: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M14 22v-9h3l.5-3.5H14V7.3c0-1 .3-1.8 1.8-1.8h1.9V2.3c-.8-.1-1.7-.3-2.8-.3-2.8 0-4.7 1.7-4.7 4.8v2.7H7V13h3.2v9z"/></svg>',
    Instagram: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect class="stroke" x="3" y="3" width="18" height="18" rx="5"/><circle class="stroke" cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.7" r="1"/></svg>',
    LINE: '<svg aria-hidden="true" viewBox="0 0 24 24"><path class="stroke" d="M21 10.5c0 4.5-5.6 8.6-10.2 10.2-.6.2-.5-.6-.3-2.2C6 18 3 15 3 10.5 3 6.4 7 3 12 3s9 3.4 9 7.5Z"/><text x="5.5" y="12.8" font-size="5.5" font-family="sans-serif" font-weight="700">LINE</text></svg>',
    YouTube: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect class="stroke" x="2" y="5" width="20" height="14" rx="4"/><path d="m10 8 6 4-6 4z"/></svg>'
  };
  dialog.innerHTML = `<div class="ivy-drawer-inner">
    <div class="ivy-drawer-top"><div class="ivy-drawer-identity">常春藤教育機構<small>Ivy Educational Institution</small></div><a class="ivy-drawer-book" href="${book.getAttribute('href')}">預約參觀 <span aria-hidden="true">↗</span></a><button class="ivy-drawer-close" type="button" aria-label="關閉抽屜"></button></div>
    <nav class="ivy-drawer-nav" aria-label="主要導覽"></nav>
    <div class="ivy-drawer-bottom"><p class="ivy-drawer-social-title"><small>FOLLOW IVY</small>和常春藤保持聯繫</p><div class="ivy-drawer-socials" aria-label="機構社群">${Object.entries(icons).map(([name,svg]) => `<button class="ivy-social" aria-label="${name}（社群連結示意）" data-social="${name}">${svg}</button>`).join('')}</div></div>
    <p class="ivy-drawer-feedback" role="status" aria-live="polite"></p>
  </div>`;
  links.forEach((link,index) => {
    const item = link.cloneNode(true);
    const label = link.querySelector('.nav-zh')?.textContent || link.textContent;
    item.innerHTML = `<span aria-hidden="true">0${index+1}</span>${label}${arrow}`;
    dialog.querySelector('.ivy-drawer-nav').append(item);
  });
  doc.body.append(dialog);
  menu.setAttribute('aria-controls', dialog.id);
  menu.setAttribute('aria-haspopup', 'dialog');
  const panel = document.querySelector('.design-panel');
  let closeTimer;
  let closing = false;
  let afterClose;
  let opener = menu;
  const reduce = win.matchMedia('(prefers-reduced-motion: reduce)');
  function finishClose() {
    clearTimeout(closeTimer);
    dialog.close(); dialog.classList.remove('is-closing'); closing = false;
    doc.documentElement.classList.remove('ivy-drawer-lock');
    document.body.classList.remove('drawer-open'); panel.inert = false;
    menu.setAttribute('aria-expanded','false');
    opener.focus({ preventScroll: true });
    const next = afterClose; afterClose = null; next?.();
  }
  function closeDrawer(callback) {
    if (!dialog.open || closing) return;
    afterClose = callback; closing = true;
    if (reduce.matches) { finishClose(); return; }
    dialog.classList.add('is-closing');
    closeTimer = setTimeout(finishClose, 290);
  }
  function openDrawer(trigger = menu) {
    if (dialog.open) return;
    opener = trigger;
    dialog.querySelector('.ivy-drawer-feedback').textContent = '';
    doc.documentElement.classList.add('ivy-drawer-lock');
    document.body.classList.add('drawer-open'); panel.inert = true;
    dialog.showModal();
    menu.setAttribute('aria-expanded','true');
    dialog.focus({ preventScroll: true });
  }
  menu.addEventListener('click', event => {event.stopImmediatePropagation(); openDrawer();}, true);
  document.querySelector('#open-drawer').onclick = event => openDrawer(event.currentTarget);
  dialog.querySelector('.ivy-drawer-close').onclick = () => closeDrawer();
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDrawer(); });
  dialog.addEventListener('animationend', event => {if (event.animationName === 'ivy-drawer-leave' && closing) finishClose();});
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDrawer();
  });
  dialog.querySelectorAll('.ivy-drawer-nav a').forEach(link => link.addEventListener('click', event => {
    event.preventDefault(); closeDrawer(() => {win.location.hash = link.getAttribute('href');});
  }));
  dialog.querySelector('.ivy-drawer-book').onclick = event => {
    event.preventDefault(); dialog.querySelector('.ivy-drawer-feedback').textContent = '預約入口將沿用現有參觀流程；這裡是設計預覽。';
  };
  dialog.querySelectorAll('.ivy-social').forEach(button => button.onclick = () => {
    dialog.querySelector('.ivy-drawer-feedback').textContent = `${button.dataset.social} 為機構社群位置示意，連結待提供。`;
  });
});
