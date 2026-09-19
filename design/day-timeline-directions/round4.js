(() => {
  const moments = [...document.querySelectorAll('.moment')];
  if (!moments.length) return;
  const markerOf = moment => moment.querySelector('.time-marker');
  const timeline = document.querySelector('.timeline');
  const jumps = [...document.querySelectorAll('[data-jump]')];
  const readouts = [...document.querySelectorAll('.clock-readout')];
  const stops = [...document.querySelectorAll('.clock-stops circle')];
  const times = moments.map(moment => {
    const [hours, minutes] = moment.querySelector('time').getAttribute('datetime').split(':').map(Number);
    return hours * 60 + minutes;
  });

  function jumpTo(moment, link) {
    if (location.hash !== `#${moment.id}`) history.pushState(null, '', `#${moment.id}`);
    moment.scrollIntoView({ behavior: 'instant', block: 'start' });
    link.focus({ preventScroll: true });
  }
  const plainClick = event => !(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);

  // Reading state mirrors D: the shared scroll controller owns progress; we only
  // reflect its class changes into text, aria-current, dial stops and focus behaviour.
  function syncReadingState() {
    let active = -1;
    moments.forEach((moment, index) => {
      const link = markerOf(moment);
      const current = moment.classList.contains('is-active');
      const past = moment.classList.contains('is-past');
      if (current) active = index;
      const position = `${String(index + 1).padStart(2, '0')} / ${String(moments.length).padStart(2, '0')}`;
      const state = current ? '正在看' : past ? '已走過' : '尚未瀏覽';
      const status = link.querySelector('.marker-status');
      if (status) {
        const text = current ? '正在看' : past ? '已走過' : position;
        if (status.textContent !== text) status.textContent = text;
      }
      if (current) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
      link.setAttribute('aria-label', `第 ${index + 1} 個片刻，共 ${moments.length} 個，${link.querySelector('time').textContent}，${link.querySelector('.marker-title').textContent}，${state}。回到此片刻`);
    });
    jumps.forEach(link => {
      const moment = document.getElementById(link.dataset.jump);
      const current = moment.classList.contains('is-active');
      link.dataset.state = current ? 'current' : moment.classList.contains('is-past') ? 'past' : 'upcoming';
      if (current) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
    const index = Math.max(0, active);
    const marker = markerOf(moments[index]);
    const state = active < 0 ? '準備出發' : index === moments.length - 1 ? '最後一站' : '正在看';
    readouts.forEach(readout => {
      readout.querySelector('.clock-time').textContent = marker.querySelector('time').textContent;
      readout.querySelector('.clock-title').textContent = marker.querySelector('.marker-title').textContent;
      readout.querySelector('.clock-state').textContent = state;
    });
    stops.forEach((stop, k) => stop.classList.toggle('is-past', k <= active));
  }
  const observer = new MutationObserver(syncReadingState);
  moments.forEach(moment => {
    observer.observe(moment, { attributes: true, attributeFilter: ['class'] });
    const link = markerOf(moment);
    link.addEventListener('click', event => { if (!plainClick(event)) return; event.preventDefault(); jumpTo(moment, link); });
  });
  jumps.forEach(link => {
    link.addEventListener('click', event => { if (!plainClick(event)) return; event.preventDefault(); jumpTo(document.getElementById(link.dataset.jump), link); });
  });

  // I: flip a photograph to read the story on its back. The hidden face is inert.
  document.querySelectorAll('.flip').forEach(button => {
    const wrap = button.closest('.polaroid-wrap');
    const front = wrap.querySelector('.polaroid-front');
    const back = wrap.querySelector('.polaroid-back');
    const set = open => {
      wrap.classList.toggle('is-flipped', open);
      button.setAttribute('aria-expanded', String(open));
      button.querySelector('span').textContent = open ? '翻回正面' : '翻到背面';
      back.inert = !open;
      front.inert = open;
    };
    set(false);
    button.addEventListener('click', () => set(!wrap.classList.contains('is-flipped')));
  });

  // Clock hands follow the reading line, interpolated between the six marker
  // times; the values live on the timeline so every dial and strip inherits them.
  let tops = [], frame = 0, lastMinutes = -1;
  const span = times[times.length - 1] - times[0];
  function update() {
    frame = 0;
    const reading = scrollY + innerHeight * .55;
    let minutes = times[0];
    if (reading >= tops[tops.length - 1]) minutes = times[times.length - 1];
    else for (let i = 0; i < tops.length - 1; i++) {
      if (reading >= tops[i] && reading < tops[i + 1]) {
        minutes = times[i] + (times[i + 1] - times[i]) * (reading - tops[i]) / (tops[i + 1] - tops[i]);
        break;
      }
    }
    minutes = Math.round(minutes);
    if (minutes === lastMinutes) return;
    lastMinutes = minutes;
    timeline.style.setProperty('--clock-minutes', String(minutes));
    timeline.style.setProperty('--clock-progress', ((minutes - times[0]) / span).toFixed(4));
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const sticky = document.body.classList.contains('direction-k');
  const measure = () => {
    // Sticky photographs (K) report their stuck position; measure from the top in
    // one frame and return, which never paints in between.
    const y = scrollY;
    if (sticky && y) scrollTo({ top: 0, behavior: 'instant' });
    tops = moments.map(moment => markerOf(moment).getBoundingClientRect().top + scrollY);
    if (sticky && y) { dispatchEvent(new Event('resize')); scrollTo({ top: y, behavior: 'instant' }); }
    lastMinutes = -1;
    update();
  };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', () => { if (!sticky) measure(); }, { passive: true });
  const settled = document.readyState === 'complete' ? Promise.resolve() : new Promise(resolve => addEventListener('load', resolve, { once: true }));
  Promise.all([settled, document.fonts.ready]).then(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(measure))));
  if (!sticky) { document.fonts.ready.then(measure); measure(); }
  syncReadingState();
})();
