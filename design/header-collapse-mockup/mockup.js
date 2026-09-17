/* Disposable presentation layer; does not write to the source website or storage. */
const frame = document.querySelector('#preview');
const controls = [...document.querySelectorAll('.demo-buttons button')];
const status = document.querySelector('#status');
let dispose = () => {};

frame.addEventListener('load', () => {
  dispose();
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  const header = doc.querySelector('.header');
  const hero = doc.querySelector('.studio-hero');
  const about = doc.querySelector('#about');
  if (!header || !hero || !about) return;
  doc.body.classList.add('header-mockup');
  const variant = new URLSearchParams(location.search).get('variant');
  if (['outline', 'filled', 'soft'].includes(variant)) doc.body.dataset.headerVariant = variant;
  doc.body.classList.toggle('mock-menu-only', variant === 'menu-only');
  const sheet = doc.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = new URL('header.css', location.href).href;
  doc.head.append(sheet);
  const brand = header.querySelector('.brand');
  const nav = header.querySelector('.navigation');
  const links = [...nav.querySelectorAll('a')];
  const actions = header.querySelector('.header-actions');
  const book = header.querySelector('.header-book');
  const oldMenu = header.querySelector('.menu-toggle');
  oldMenu.hidden = true;
  oldMenu.style.setProperty('display', 'none', 'important');
  const menu = doc.createElement('button');
  menu.className = 'mock-menu';
  menu.type = 'button';
  menu.setAttribute('aria-label', '開啟導覽選單');
  menu.setAttribute('aria-expanded', 'false');
  menu.setAttribute('aria-controls', 'mock-dropdown');
  menu.innerHTML = '<span></span><span></span><span></span>';
  actions.append(menu);
  const dropdown = doc.createElement('nav');
  dropdown.id = 'mock-dropdown';
  dropdown.className = 'mock-dropdown';
  dropdown.setAttribute('aria-label', '收合後的導覽');
  dropdown.hidden = true;
  dropdown.innerHTML = '<span>EXPLORE IVY</span>';
  links.forEach(link => dropdown.append(link.cloneNode(true)));
  let menuVisit;
  if (variant === 'menu-only') {
    menuVisit = book.cloneNode(false);
    menuVisit.className = 'mock-menu-visit';
    menuVisit.textContent = '預約參觀';
    dropdown.append(menuVisit);
  }
  header.querySelector('.header-top').append(dropdown);
  let animation = 0;
  let timer = 0;
  let noteTimer = 0;
  let ticking = 0;
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = win.matchMedia('(max-width: 900px)');

  function closeMenu(focus = false) {
    dropdown.hidden = true;
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', '開啟導覽選單');
    if (focus) menu.focus();
  }
  menu.addEventListener('click', () => {
    const opening = dropdown.hidden;
    dropdown.hidden = !opening;
    menu.setAttribute('aria-expanded', String(opening));
    menu.setAttribute('aria-label', opening ? '關閉導覽選單' : '開啟導覽選單');
  });
  doc.addEventListener('click', event => {
    if (!dropdown.contains(event.target) && !menu.contains(event.target)) closeMenu();
  });
  doc.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !dropdown.hidden) closeMenu(true);
  });
  dropdown.addEventListener('click', event => {
    if (event.target.closest('a')) closeMenu();
  });
  function showVisitNotice(event) {
    event.preventDefault();
    if (dropdown.contains(event.currentTarget)) closeMenu(true);
    let note = doc.querySelector('.mock-visit-note');
    if (!note) {
      note = doc.createElement('p');
      note.className = 'mock-visit-note';
      note.setAttribute('role', 'status');
      doc.body.append(note);
    }
    note.textContent = '預約入口會沿用現有參觀流程。此頁僅預覽導覽外觀與動畫。';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => note.remove(), 3500);
  }
  book.addEventListener('click', showVisitNotice);
  menuVisit?.addEventListener('click', showVisitNotice);

  function positions() {
    const root = doc.querySelector('.home-reveal');
    const track = doc.querySelector('.home-reveal-track');
    const animated = root && root.dataset.motion && root.dataset.motion !== 'still';
    const start = hero.getBoundingClientRect().top + win.scrollY;
    if (animated) {
      const top = track.getBoundingClientRect().top + win.scrollY;
      const distance = Math.max(1, track.offsetHeight - hero.offsetHeight);
      return { trigger: top + distance * .32, ink: top + distance * .12, end: top + distance + 2 };
    }
    return { trigger: start + hero.offsetHeight - 92, ink: start + hero.offsetHeight - 92, end: about.getBoundingClientRect().top + win.scrollY };
  }
  function update() {
    ticking = 0;
    const point = positions();
    const compact = win.scrollY >= point.trigger;
    header.classList.toggle('mock-compact', compact);
    header.classList.toggle('mock-ink', win.scrollY >= point.ink);
    brand.inert = compact;
    book.inert = variant === 'menu-only' && compact;
    nav.inert = compact || narrow.matches;
    menu.inert = !compact && !narrow.matches;
    if (!compact && !narrow.matches) closeMenu();
    status.textContent = compact ? (menu.classList.contains('frame-mascot') ? '收合後 · 人物 Logo' : variant === 'menu-only' ? '收合後 · 只留三條線' : '收合後 · 三條線 ＋ 預約') : 'Hero · 完整導覽';
    document.querySelector('#hero').setAttribute('aria-pressed', String(!compact));
    document.querySelector('#compact').setAttribute('aria-pressed', String(compact));
  }
  function measure() {
    header.style.setProperty('--mock-book-width', `${book.getBoundingClientRect().width}px`);
    header.style.setProperty('--mock-nav-width', `${nav.querySelector('.nav-inner').getBoundingClientRect().width}px`);
    update();
  }
  function schedule() { if (!ticking) ticking = requestAnimationFrame(update); }
  function stopPlayback() { cancelAnimationFrame(animation); clearTimeout(timer); }
  function scrollTo(y, duration = 1100) {
    stopPlayback();
    closeMenu();
    if (reduced.matches) { win.scrollTo({ top: y, behavior: 'instant' }); update(); return; }
    const start = win.scrollY;
    const begin = performance.now();
    function step(time) {
      const p = Math.min(1, (time - begin) / duration);
      const ease = p < .5 ? 4*p*p*p : 1-Math.pow(-2*p+2,3)/2;
      win.scrollTo({ top: start + (y-start)*ease, behavior: 'instant' });
      if (p < 1) animation = requestAnimationFrame(step);
    }
    animation = requestAnimationFrame(step);
  }
  document.querySelector('#hero').onclick = () => scrollTo(0, 850);
  document.querySelector('#compact').onclick = () => scrollTo(positions().end);
  document.querySelector('#play').onclick = () => {
    stopPlayback(); closeMenu();
    win.scrollTo({ top: 0, behavior: 'instant' }); update();
    timer = setTimeout(() => scrollTo(positions().end, 2000), reduced.matches ? 0 : 600);
  };
  win.addEventListener('scroll', schedule, { passive: true });
  win.addEventListener('resize', measure);
  win.addEventListener('wheel', stopPlayback, { passive: true });
  win.addEventListener('touchstart', stopPlayback, { passive: true });
  // The existing hero re-measures asynchronously and briefly switches to still mode.
  // Re-read the threshold after it settles, even when no new scroll event occurs.
  const reveal = doc.querySelector('.home-reveal');
  const motionObserver = new win.MutationObserver(schedule);
  if (reveal) motionObserver.observe(reveal, { attributes: true, attributeFilter: ['data-motion'] });
  const revealSize = new win.ResizeObserver(schedule);
  if (reveal) revealSize.observe(reveal.querySelector('.home-reveal-track'));
  sheet.addEventListener('load', measure);
  doc.fonts.ready.then(measure);
  if (variant) {
    Promise.all([doc.fonts.ready, new Promise(resolve => sheet.addEventListener('load', resolve, { once: true }))])
      .then(() => requestAnimationFrame(() => scrollTo(positions().end)));
  }
  controls.forEach(button => { button.disabled = false; });
  measure();
  frame.dispatchEvent(new CustomEvent('header-ready', { detail: { win, doc, header, menu, book, links } }));
  dispose = () => { stopPlayback(); clearTimeout(noteTimer); cancelAnimationFrame(ticking); motionObserver.disconnect(); revealSize.disconnect(); };
});
