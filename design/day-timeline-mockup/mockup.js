(() => {
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const native = CSS.supports('(animation-timeline: view()) and (animation-range: contain 0% contain 100%)');
  const track = document.querySelector('.entry-track');
  const curtain = document.querySelector('.entry-panel');
  const copy = document.querySelector('.entry-copy');
  const day = document.querySelector('.day');
  const timeline = document.querySelector('.timeline');
  const moments = [...document.querySelectorAll('.moment')];
  const video = document.querySelector('.film');
  const toggle = document.querySelector('.film-toggle');
  const menu = document.querySelector('.mobile-menu');
  let frame = 0, distance = 1, start = 0, timelineStart = 0, timelineHeight = 1;
  let markerPositions = [], userPaused = reduce.matches, mediaVisible = false, mediaFailed = false;
  const clamp = n => Math.min(1, Math.max(0, n));

  function update() {
    frame = 0;
    const progress = clamp((scrollY - start) / distance);
    const animated = root.dataset.motion !== 'still';
    curtain.inert = animated && progress > .93;
    if (root.dataset.motion === 'fallback') {
      curtain.style.clipPath = `inset(0 0 ${clamp((progress - .06) / .94) * 100}% 0)`;
      copy.style.opacity = String(1 - clamp(progress / .75) * .84);
      copy.style.transform = `translateY(${-65 * clamp(progress / .75)}px)`;
    }
    const reading = scrollY + innerHeight * .55;
    timeline.style.setProperty('--progress', String(clamp((reading - timelineStart) / timelineHeight)));
    let current = -1;
    markerPositions.forEach((pos, i) => { if (reading >= pos) current = i; });
    moments.forEach((item, i) => {
      item.classList.toggle('is-past', i < current);
      item.classList.toggle('is-active', i === current);
    });
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  function measure() {
    root.dataset.motion = 'still';
    curtain.removeAttribute('style');
    copy.removeAttribute('style');
    const header = document.querySelector('.site-header').offsetHeight;
    const height = document.documentElement.clientHeight - header;
    root.style.setProperty('--screen', `${height}px`);
    const fits = curtain.offsetHeight <= height + 1;
    root.dataset.motion = reduce.matches || !fits ? 'still' : native ? 'native' : 'fallback';
    start = track.getBoundingClientRect().top + scrollY - header;
    distance = Math.max(1, track.offsetHeight - height);
    timelineStart = timeline.getBoundingClientRect().top + scrollY;
    timelineHeight = timeline.offsetHeight;
    markerPositions = moments.map(item => item.querySelector('.time-marker').getBoundingClientRect().top + scrollY);
    update();
  }

  function renderMediaState() {
    const playing = !video.paused && !mediaFailed;
    toggle.setAttribute('aria-label', playing ? '暫停背景影片' : '播放背景影片');
    toggle.setAttribute('aria-pressed', String(playing));
    toggle.querySelector('.film-icon').textContent = playing ? 'Ⅱ' : '▶';
    toggle.querySelector('.film-state').textContent = playing ? '暫停背景' : '播放背景';
  }
  function syncMedia() {
    if (!mediaVisible || userPaused || document.hidden || mediaFailed) {
      video.pause();
      renderMediaState();
      return;
    }
    if (!video.hasAttribute('src')) video.src = matchMedia('(max-width: 800px)').matches ? video.dataset.mobileSrc : video.dataset.src;
    video.play().then(() => {
      // A visibility change may occur while play() is pending.
      if (userPaused || !mediaVisible || document.hidden) video.pause();
      renderMediaState();
    }).catch(renderMediaState);
  }
  video.addEventListener('playing', () => { video.classList.add('is-ready'); renderMediaState(); });
  video.addEventListener('pause', renderMediaState);
  video.addEventListener('error', () => {
    mediaFailed = true;
    video.classList.remove('is-ready');
    toggle.hidden = true;
  });
  toggle.addEventListener('click', () => {
    userPaused = !video.paused;
    syncMedia();
  });
  new IntersectionObserver(entries => {
    mediaVisible = entries[0].isIntersecting;
    syncMedia();
  }, { rootMargin: '0px', threshold: 0 }).observe(day);

  const reveals = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add('is-revealed');
    });
  }, { threshold: .08 });
  moments.forEach(item => reveals.observe(item));
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', measure, { passive: true });
  document.addEventListener('visibilitychange', syncMedia);
  reduce.addEventListener('change', () => {
    if (reduce.matches) userPaused = true;
    measure();
    syncMedia();
  });
  document.fonts.ready.then(measure);
  window.addEventListener('load', measure, { once: true });
  menu.addEventListener('click', event => { if (event.target.closest('a')) menu.open = false; });
  document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
  measure();
})();
