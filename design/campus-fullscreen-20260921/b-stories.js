(() => {
  if (!document.body.classList.contains('direction-b')) return;
  document.body.classList.add('story-nav');
  const nav = document.querySelector('.campus-nav');
  const stage = document.querySelector('.stage');
  const buttons = [...nav.querySelectorAll('button')];
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelector('#scenes').before(nav);
  nav.setAttribute('aria-label', '分校限時動態導覽');
  const ranges = buttons.map((button, index) => {
    const start = index === 0 ? 0 : index - .225;
    const end = index === buttons.length - 1 ? 4 : index + .775;
    button.replaceChildren();
    const track = document.createElement('span');
    track.className = 'story-track';
    track.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('span');
    fill.className = 'story-fill';
    track.append(fill);
    const label = document.createElement('span');
    label.className = 'story-label';
    label.textContent = window.CAMPUS_DATA[index].name;
    button.append(track, label);
    button.style.setProperty('--story-start', `${start / 4 * 100}%`);
    button.style.setProperty('--story-end', `${end / 4 * 100}%`);
    return {start, end};
  });
  function update() {
    const position = Number(stage.style.getPropertyValue('--progress')) * 5 - 1;
    const active = buttons.findIndex(button => button.getAttribute('aria-current') === 'true');
    buttons.forEach((button, index) => {
      const {start, end} = ranges[index];
      const progress = media.matches ? Number(index <= active) : Math.max(0, Math.min(1, (position - start) / (end - start)));
      button.style.setProperty('--story-progress', String(progress));
      button.classList.toggle('is-past', index < active);
    });
  }
  // Reuse the existing scroll state and navigation handlers; no extra scroll loop.
  new MutationObserver(update).observe(stage, {attributes: true, attributeFilter: ['style']});
  new MutationObserver(update).observe(document.body, {attributes: true, attributeFilter: ['data-active-campus']});
  media.addEventListener('change', update);
  update();
})();
