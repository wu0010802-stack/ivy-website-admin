const params = new URLSearchParams(location.search);
let view = params.get('view') === 'mobile' ? 'mobile' : 'desktop';
const frames = [...document.querySelectorAll('iframe')];

function fitFrames() {
  for (const frame of frames) {
    const wrap = frame.parentElement;
    const width = view === 'mobile' ? 390 : 1440;
    frame.style.width = `${width}px`;
    const height = Math.ceil(frame.contentDocument?.querySelector('.footer')?.getBoundingClientRect().height || 400);
    const scale = Math.min(wrap.clientWidth / width, 1);
    frame.style.height = `${height}px`;
    frame.style.transform = `scale(${scale})`;
    wrap.style.height = `${Math.ceil(height * scale) + 2}px`;
  }
}

function renderView() {
  document.body.dataset.view = view;
  for (const button of document.querySelectorAll('[data-view]')) {
    if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  requestAnimationFrame(fitFrames);
}

for (const frame of frames) {
  frame.addEventListener('load', async () => {
    await frame.contentDocument.fonts.ready;
    fitFrames();
  });
}
for (const button of document.querySelectorAll('button[data-view]')) {
  button.addEventListener('click', () => {
    view = button.dataset.view;
    const url = new URL(location.href);
    url.searchParams.set('view', view);
    history.replaceState(null, '', url);
    renderView();
  });
}
new ResizeObserver(fitFrames).observe(document.querySelector('main'));
renderView();
