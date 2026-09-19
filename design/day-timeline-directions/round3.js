(() => {
  const moments = [...document.querySelectorAll('.moment')];
  if (!moments.length) return;
  const markerOf = moment => moment.querySelector('.time-marker');

  // Reading state mirrors D: the shared scroll controller owns progress; we only
  // reflect its class changes into text, aria-current and focus behaviour.
  function syncReadingState() {
    moments.forEach((moment, index) => {
      const link = markerOf(moment);
      const current = moment.classList.contains('is-active');
      const past = moment.classList.contains('is-past');
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
    refreshReadout();
  }
  const observer = new MutationObserver(syncReadingState);
  moments.forEach(moment => {
    observer.observe(moment, { attributes: true, attributeFilter: ['class'] });
    const link = markerOf(moment);
    link.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (location.hash !== link.hash) history.pushState(null, '', link.hash);
      moment.scrollIntoView({ behavior: 'instant', block: 'start' });
      link.focus({ preventScroll: true });
    });
  });

  // E only: the clock hands follow the reading line, interpolated between the
  // six marker times, so the dial agrees with whichever label is beside it.
  const clock = document.querySelector('.clock');
  const times = moments.map(moment => {
    const [hours, minutes] = moment.querySelector('time').getAttribute('datetime').split(':').map(Number);
    return hours * 60 + minutes;
  });
  const readout = clock && {
    time: clock.querySelector('.clock-time'),
    title: clock.querySelector('.clock-title'),
    state: clock.querySelector('.clock-state'),
    stops: [...clock.querySelectorAll('.clock-stops circle')]
  };
  function refreshReadout() {
    if (!readout) return;
    const active = moments.findIndex(moment => moment.classList.contains('is-active'));
    const index = Math.max(0, active);
    const marker = markerOf(moments[index]);
    const text = marker.querySelector('time').textContent;
    const state = active < 0 ? '準備出發' : index === moments.length - 1 ? '最後一站' : '正在看';
    if (readout.time.textContent !== text) readout.time.textContent = text;
    const title = marker.querySelector('.marker-title').textContent;
    if (readout.title.textContent !== title) readout.title.textContent = title;
    if (readout.state.textContent !== state) readout.state.textContent = state;
    readout.stops.forEach((stop, k) => stop.classList.toggle('is-past', k <= active));
  }
  if (clock) {
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
      clock.style.setProperty('--clock-minutes', String(minutes));
      clock.style.setProperty('--clock-progress', ((minutes - times[0]) / span).toFixed(4));
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const measure = () => {
      tops = moments.map(moment => markerOf(moment).getBoundingClientRect().top + scrollY);
      lastMinutes = -1;
      update();
    };
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', measure, { passive: true });
    document.fonts.ready.then(measure);
    addEventListener('load', measure, { once: true });
    measure();
  }
  // G only: sticky chapters report their stuck position while the shared
  // controller measures on load. Re-measure from the top in one frame, after the
  // comparison script has resolved the incoming anchor, so no paint shows the jump.
  if (document.body.classList.contains('direction-g')) {
    const settled = document.readyState === 'complete' ? Promise.resolve() : new Promise(resolve => addEventListener('load', resolve, { once: true }));
    Promise.all([settled, document.fonts.ready]).then(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      const y = scrollY;
      if (!y) return;
      scrollTo({ top: 0, behavior: 'instant' });
      dispatchEvent(new Event('resize'));
      scrollTo({ top: y, behavior: 'instant' });
    }))));
  }
  syncReadingState();
})();
