const params = new URLSearchParams(location.search);
let view = params.get('view') === 'mobile' ? 'mobile' : 'desktop';
let filter = params.get('filter') || 'all';
const PICK_KEY = 'ivy-footer-colour-20260924-picks';
const frames = [...document.querySelectorAll('iframe')];
const articles = [...document.querySelectorAll('article[data-variant]')];

function readPicks() {
  try { return new Set(JSON.parse(localStorage.getItem(PICK_KEY) || '[]')); } catch { return new Set(); }
}
const picks = readPicks();
function savePicks() {
  try { localStorage.setItem(PICK_KEY, JSON.stringify([...picks])); } catch { /* 私密視窗等情況只在本頁記住 */ }
}

function fitFrames() {
  for (const frame of frames) {
    const wrap = frame.parentElement;
    if (!wrap.offsetParent) continue;
    const width = view === 'mobile' ? 390 : 1440;
    frame.style.width = `${width}px`;
    // 量頁尾底緣（含上方暖白那截）。尚未載入的 lazy iframe 是空白頁，body 會跟著 iframe 高度走，不能拿來量。
    const height = Math.ceil(frame.contentDocument?.querySelector('.footer')?.getBoundingClientRect().bottom || 410);
    const scale = Math.min(wrap.clientWidth / width, 1);
    frame.style.height = `${height}px`;
    frame.style.transform = `scale(${scale})`;
    wrap.style.height = `${Math.ceil(height * scale) + 2}px`;
  }
}

function setParam(key, value, fallback) {
  const url = new URL(location.href);
  if (value === fallback) url.searchParams.delete(key); else url.searchParams.set(key, value);
  history.replaceState(null, '', url);
}

function render() {
  document.body.dataset.view = view;
  for (const button of document.querySelectorAll('button[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  for (const button of document.querySelectorAll('button[data-filter]')) button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
  for (const article of articles) {
    const key = article.dataset.variant;
    const show = filter === 'all' || (filter === 'picked' ? picks.has(key) : article.dataset.tone === filter);
    article.hidden = !show;
    article.querySelector('.pick').setAttribute('aria-pressed', String(picks.has(key)));
  }
  for (const group of document.querySelectorAll('.group')) group.hidden = !group.querySelector('article:not([hidden])');
  document.querySelector('[data-pick-count]').textContent = picks.size;
  document.querySelector('.empty').hidden = !(filter === 'picked' && picks.size === 0);
  requestAnimationFrame(fitFrames);
}

for (const frame of frames) {
  frame.addEventListener('load', async () => {
    await frame.contentDocument.fonts.ready;
    fitFrames();
  });
}
for (const button of document.querySelectorAll('button[data-view]')) {
  button.addEventListener('click', () => { view = button.dataset.view; setParam('view', view, 'desktop'); render(); });
}
for (const button of document.querySelectorAll('button[data-filter]')) {
  button.addEventListener('click', () => { filter = button.dataset.filter; setParam('filter', filter, 'all'); render(); });
}
for (const button of document.querySelectorAll('button[data-pick]')) {
  button.addEventListener('click', () => {
    const key = button.dataset.pick;
    if (picks.has(key)) picks.delete(key); else picks.add(key);
    savePicks();
    render();
  });
}
new ResizeObserver(fitFrames).observe(document.querySelector('main'));
render();
