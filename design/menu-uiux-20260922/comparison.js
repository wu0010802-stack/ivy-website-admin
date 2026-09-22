const viewButtons = [...document.querySelectorAll('[data-size]')];
function setSize(size) {
  document.body.dataset.size = size;
  viewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.size === size)));
  resizeFrames();
}
function resizeFrames() {
  const mobile = document.body.dataset.size === 'mobile';
  const width = mobile ? 390 : 640;
  const height = mobile ? 960 : 900;
  document.querySelectorAll('.frame-wrap').forEach(wrap => {
    const frame = wrap.querySelector('iframe');
    const scale = Math.min(1, (wrap.clientWidth - 2) / width);
    frame.style.width = width + 'px';
    frame.style.height = height + 'px';
    frame.style.maxWidth = 'none';
    frame.style.flexShrink = '0';
    frame.style.transformOrigin = 'top center';
    frame.style.transform = `scale(${scale})`;
    wrap.style.height = Math.ceil(height * scale + 2) + 'px';
  });
}
viewButtons.forEach(button => button.addEventListener('click', () => setSize(button.dataset.size)));
new ResizeObserver(resizeFrames).observe(document.querySelector('.comparison-grid'));
if (new URLSearchParams(location.search).get('size') === 'mobile') setSize('mobile');
else resizeFrames();
