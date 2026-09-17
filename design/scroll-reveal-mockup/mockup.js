(() => {
  const root = document.documentElement;
  const track = document.querySelector('.hero-track');
  const hero = document.querySelector('.hero');
  const copy = document.querySelector('.hero-copy');
  const heroLink = document.querySelector('.hero-link');
  const visual = document.querySelector('.hero-visual');
  const controls = document.querySelector('.hero-bottom');
  const header = document.querySelector('.site-header');
  const video = document.querySelector('video');
  const toggle = document.querySelector('.video-toggle');
  const toolbar = document.querySelector('.preview-tools');
  const stages = [...toolbar.querySelectorAll('button')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const shortScreen = matchMedia('(max-height: 680px)');
  const mobile = matchMedia('(max-width: 760px)');
  const supportsNative = CSS.supports('animation-timeline: view()') && CSS.supports('animation-range: contain 0% contain 100%');
  const forceFallback = new URLSearchParams(location.search).get('motion') === 'fallback';
  const clamp = value => Math.max(0, Math.min(1, value));
  let frame = 0;
  let distance = 1;
  let start = 0;
  let progress = 0;
  let manuallyPaused = false;
  let manuallyStarted = false;
  let videoFailed = false;

  function syncVideo() {
    const allowed = manuallyStarted || (!reduced.matches && !navigator.connection?.saveData);
    const visible = hero.getBoundingClientRect().bottom > 0 && progress < 1;
    if (!allowed || !visible || document.hidden || manuallyPaused || videoFailed) {
      video.pause();
      return;
    }
    if (!video.getAttribute('src')) video.src = '../../assets/hero-campus.mp4';
    if (video.paused) video.play().catch(() => {});
  }

  function update() {
    frame = 0;
    const animated = root.dataset.motion !== 'still';
    progress = animated ? clamp((scrollY - start) / distance) : (scrollY >= hero.offsetHeight ? 1 : 0);
    header.classList.toggle('is-scrolled', scrollY > 24);
    hero.inert = animated && progress >= .99;
    heroLink.inert = animated && progress >= .15;
    controls.inert = animated && progress >= .2;
    const stage = progress < .18 ? 0 : progress < .9 ? 1 : 2;
    stages.forEach((button, index) => button.setAttribute('aria-pressed', String(index === stage)));
    if (root.dataset.motion === 'fallback') {
      const fade = clamp(progress / .48);
      hero.style.clipPath = `inset(0 0 ${clamp((progress - .1) / .9) * 100}% 0)`;
      hero.style.setProperty('--mobile-backdrop-opacity', String(1 - fade));
      visual.style.opacity = String(1 - fade);
      copy.style.opacity = String(1 - (mobile.matches ? .72 : .75) * fade);
      copy.style.transform = `scale(${1 - (mobile.matches ? .04 : .1) * fade})`;
      copy.style.color = `rgb(${255 - 223 * fade} ${253 - 190 * fade} ${245 - 195 * fade})`;
      controls.style.opacity = String(1 - clamp(progress / .2));
    }
    syncVideo();
  }

  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  function measure() {
    root.dataset.motion = reduced.matches || shortScreen.matches ? 'still' : supportsNative && !forceFallback ? 'native' : 'fallback';
    [hero, copy, visual, controls].forEach(element => element.removeAttribute('style'));
    start = track.getBoundingClientRect().top + scrollY;
    // The CSS 'contain' interval runs from the top of the tall track reaching
    // the viewport top until its bottom reaches the viewport bottom.
    distance = Math.max(1, track.getBoundingClientRect().height - document.documentElement.clientHeight);
    stages[1].disabled = root.dataset.motion === 'still';
    update();
  }

  toolbar.hidden = false;
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    if (video.paused) { manuallyPaused = false; manuallyStarted = true; }
    else manuallyPaused = true;
    syncVideo();
  });
  function renderPlaybackState() {
    toggle.setAttribute('aria-label', video.paused ? '播放校園影片' : '暫停校園影片');
    toggle.firstElementChild.textContent = video.paused ? '▶' : 'Ⅱ';
  }
  video.addEventListener('play', renderPlaybackState);
  video.addEventListener('pause', renderPlaybackState);
  video.addEventListener('error', () => { videoFailed = true; video.hidden = true; toggle.hidden = true; });
  stages.forEach(button => button.addEventListener('click', () => {
    const target = root.dataset.motion === 'still' ? (Number(button.dataset.progress) ? document.querySelector('#about').offsetTop : 0) : start + distance * Number(button.dataset.progress);
    scrollTo({ top: target, behavior: reduced.matches ? 'instant' : 'smooth' });
  }));
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', measure, { passive: true });
  reduced.addEventListener('change', measure);
  shortScreen.addEventListener('change', measure);
  mobile.addEventListener('change', measure);
  document.addEventListener('visibilitychange', syncVideo);
  addEventListener('pagehide', () => video.pause());
  addEventListener('pageshow', measure);
  document.fonts.ready.then(measure);
  measure();
})();
