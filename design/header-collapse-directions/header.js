/* 導覽收合 mock-up：狀態切換與選單控制。只作用在這個預覽頁，不寫入主站。 */
(() => {
  const params = new URLSearchParams(location.search);
  const direction = ['a', 'b', 'c'].includes(params.get('direction')) ? params.get('direction') : 'a';
  document.body.dataset.direction = direction;
  // B 調校：尺寸與色調（b-tuning.html 用來比較；預設值＝目前建議）
  const size = ['s', 'm', 'l'].includes(params.get('size')) ? params.get('size') : 'm';
  const tone = ['paper', 'white', 'sage', 'deep'].includes(params.get('tone')) ? params.get('tone') : 'deep';
  document.body.dataset.size = size;
  document.body.dataset.tone = tone;
  if (params.get('reduced') === '1') document.documentElement.classList.add('force-reduced');

  const header = document.getElementById('header');
  const bar = header.querySelector('.header-bar');
  const pill = header.querySelector('.header-pill');
  const panel = document.getElementById('menu-panel');
  const toggles = [...header.querySelectorAll('.menu-toggle')];
  const main = document.getElementById('main');
  const sentinel = document.querySelector('.hero-sentinel');
  const about = document.getElementById('about');
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => reducedQuery.matches || document.documentElement.classList.contains('force-reduced');

  let state = 'hero';
  let opener = null;
  let closeTimer = 0;
  let pendingCompact = null;

  const report = () => {
    if (parent === window) return;
    parent.postMessage({ type: 'ivy-header-state', direction, state, menu: !panel.hidden }, '*');
  };

  /* ---------- 首屏／收合狀態 ---------- */
  function setState(next) {
    if (state === next) return;
    state = next;
    header.dataset.state = next;
    // 回到首屏時導覽會重新攤開，A／B 的小選單就沒有存在的理由。
    if (next === 'hero' && direction !== 'c' && !panel.hidden) closeMenu(false);
    if (next === 'compact' && pendingCompact) { const fn = pendingCompact; pendingCompact = null; fn(); }
    report();
  }
  const observer = new IntersectionObserver(([entry]) => {
    setState(!entry.isIntersecting && entry.boundingClientRect.top < 0 ? 'compact' : 'hero');
  }, { threshold: 0 });
  observer.observe(sentinel);

  const onScroll = () => { header.dataset.scrolled = String(scrollY > 8); };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- 選單 ---------- */
  const visibleToggle = () => toggles.find(t => t.getClientRects().length && getComputedStyle(t).visibility !== 'hidden') || toggles[0];

  function positionPanel() {
    if (direction !== 'b') return;
    const headerRect = header.getBoundingClientRect();
    if (state === 'compact') {
      const rect = pill.getBoundingClientRect();
      panel.classList.remove('from-bar');
      panel.style.top = `${rect.bottom - headerRect.top - 1}px`;
      panel.style.left = `${rect.left - headerRect.left}px`;
      panel.style.width = `${rect.width}px`;
    } else {
      panel.classList.add('from-bar');
      panel.style.top = `${bar.offsetHeight + 8}px`;
      panel.style.left = '16px';
      panel.style.width = `${header.clientWidth - 32}px`;
    }
  }

  function openMenu(button) {
    clearTimeout(closeTimer);
    opener = button || visibleToggle();
    positionPanel();
    if (direction === 'c') {
      const rect = opener.getBoundingClientRect();
      panel.style.setProperty('--mx', `${rect.left + rect.width / 2}px`);
      panel.style.setProperty('--my', `${rect.top + rect.height / 2}px`);
      main.inert = true;
      document.body.classList.add('menu-lock');
    }
    panel.hidden = false;
    header.dataset.menu = 'open';
    toggles.forEach(t => { t.setAttribute('aria-expanded', 'true'); t.setAttribute('aria-label', '關閉導覽選單'); });
    // 先讓 hidden=false 落地，下一幀再加 class，過場才會播。
    requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('is-open')));
    const first = panel.querySelector('a');
    setTimeout(() => first && first.focus({ preventScroll: true }), reduced() ? 0 : 360);
    report();
  }

  function closeMenu(returnFocus = true) {
    if (panel.hidden) return;
    panel.classList.remove('is-open');
    header.dataset.menu = 'closed';
    toggles.forEach(t => { t.setAttribute('aria-expanded', 'false'); t.setAttribute('aria-label', '開啟導覽選單'); });
    main.inert = false;
    document.body.classList.remove('menu-lock');
    const focusInside = panel.contains(document.activeElement);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { panel.hidden = true; report(); }, reduced() ? 0 : (direction === 'c' ? 620 : 320));
    if (returnFocus && opener && (focusInside || document.activeElement === document.body)) opener.focus({ preventScroll: true });
    report();
  }

  toggles.forEach(t => t.addEventListener('click', () => (panel.hidden ? openMenu(t) : closeMenu())));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) closeMenu(); });
  document.addEventListener('pointerdown', e => { if (!panel.hidden && !header.contains(e.target)) closeMenu(false); });
  panel.addEventListener('click', e => { if (e.target.closest('a')) closeMenu(false); });
  addEventListener('resize', () => { if (!panel.hidden) positionPanel(); });

  /* ---------- 給比較頁用的遙控（postMessage）---------- */
  const compactTop = () => Math.max(0, about.offsetTop - 64);
  const behavior = () => (reduced() ? 'instant' : 'smooth');
  addEventListener('message', e => {
    const data = e.data;
    if (!data || data.type !== 'ivy-header') return;
    pendingCompact = null;
    if (data.action === 'hero') { closeMenu(false); scrollTo({ top: 0, behavior: behavior() }); }
    if (data.action === 'compact') { closeMenu(false); scrollTo({ top: compactTop(), behavior: behavior() }); }
    if (data.action === 'menu') {
      if (state === 'compact') { if (panel.hidden) openMenu(visibleToggle()); }
      else { pendingCompact = () => setTimeout(() => openMenu(visibleToggle()), reduced() ? 0 : 480); scrollTo({ top: compactTop(), behavior: behavior() }); }
    }
    if (data.action === 'play') {
      closeMenu(false);
      scrollTo({ top: 0, behavior: 'instant' });
      setTimeout(() => scrollTo({ top: compactTop(), behavior: behavior() }), reduced() ? 0 : 600);
    }
  });
  report();
})();
