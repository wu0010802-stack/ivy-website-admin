// The title fades as the prints reach it, keyed to how far the timeline has risen into view.
(() => {
  const intro = document.querySelector('.round9 .day-intro');
  const timeline = document.querySelector('.round9 .timeline');
  if (!intro || !timeline) return;
  let frame = 0;
  const update = () => {
    frame = 0;
    const top = timeline.getBoundingClientRect().top;
    const start = innerHeight * .78, end = innerHeight * .3;
    const t = Math.min(1, Math.max(0, (start - top) / (start - end)));
    intro.style.setProperty('--intro-fade', (1 - t * .84).toFixed(3));
    intro.classList.toggle('is-faded', t > 0);
  };
  addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(update); }, { passive: true });
  addEventListener('resize', update, { passive: true });
  update();
})();
