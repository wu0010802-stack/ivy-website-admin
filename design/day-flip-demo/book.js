import { bookState, sceneProgress, turnRange } from './timeline.mjs';

const runway = document.querySelector('.book-runway');
const stage = document.querySelector('.book-stage');
const book = document.querySelector('#book');
const stories = [...document.querySelectorAll('.story-source .story')];
const toggle = document.querySelector('#reading-toggle');
const previous = document.querySelector('#previous');
const next = document.querySelector('#next');
const pagePosition = document.querySelector('#page-position');
const status = document.querySelector('#book-status');
const chapters = [...document.querySelectorAll('[data-chapter]')];
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const narrow = matchMedia('(max-width: 900px)');
const nativeSupported = CSS.supports('animation-timeline: view()') && CSS.supports('animation-range: contain 0% contain 100%');
// ?motion=js makes the older-browser path reviewable without changing the browser.
const useNative = nativeSupported && new URLSearchParams(location.search).get('motion') !== 'js';
const style = document.createElement('style');
document.head.append(style);
let sheets = [], enabled = false, manualReading = false, count = 3, current = 0;
let start = 0, travel = 1, queued = false, resizeFrame = 0;
let configuredNarrow = narrow.matches, configuredEligibility = false;

function page(index) {
  const clone = stories[index].cloneNode(true);
  clone.removeAttribute('id');
  clone.querySelectorAll('img').forEach(img => { img.loading = 'eager'; img.alt = ''; });
  return clone;
}

function fixed(index, side) {
  const element = document.createElement('div');
  element.className = `fixed-page fixed-${side}`;
  element.append(page(index));
  book.append(element);
}

function build() {
  count = narrow.matches ? 6 : 3;
  book.replaceChildren();
  sheets = [];
  if (!narrow.matches) fixed(0, 'left');
  fixed(5, 'right');
  let keyframes = '';
  for (let i = 0; i < count - 1; i++) {
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    const front = document.createElement('div');
    front.className = 'face front';
    front.append(page(narrow.matches ? i : i * 2 + 1));
    const back = document.createElement('div');
    back.className = 'face back';
    if (!narrow.matches) back.append(page(i * 2 + 2));
    sheet.append(front, back);
    book.append(sheet);
    sheets.push(sheet);
    const [from, to] = turnRange(i, count).map(value => (value * 100).toFixed(6));
    const name = `paper-turn-${i}`;
    sheet.style.setProperty('--turn-name', name);
    keyframes += `@keyframes ${name}{0%,${from}%{transform:rotateY(0deg)}${to}%,100%{transform:rotateY(-180deg)}}`;
  }
  style.textContent = keyframes;
  runway.style.setProperty('--travel', `${count * (narrow.matches ? 64 : 88)}svh`);
  runway.dataset.layout = narrow.matches ? 'single' : 'spread';
  runway.classList.toggle('is-native', useNative);
  runway.dataset.driver = useNative ? 'native' : 'javascript';
}

function measure() {
  const header = document.querySelector('.site-header').getBoundingClientRect().height;
  start = runway.getBoundingClientRect().top + scrollY - header;
  travel = Math.max(1, runway.offsetHeight - stage.offsetHeight);
}

function update() {
  queued = false;
  if (!enabled) return;
  const progress = Math.max(0, Math.min(1, (scrollY - start) / travel));
  const state = bookState(progress, count);
  current = state.scene;
  sheets.forEach((sheet, i) => {
    const turn = state.turns[i];
    if (!useNative) sheet.style.transform = `rotateY(${-180 * turn}deg)`;
    sheet.style.zIndex = turn > 0 && turn < 1 ? count + 1 : turn === 1 ? i + 1 : count - i;
    sheet.style.setProperty('--shade', String(Math.sin(turn * Math.PI) * 0.7));
    sheet.style.visibility = narrow.matches && turn === 1 ? 'hidden' : 'visible';
  });
  runway.dataset.scene = String(current);
  runway.dataset.progress = progress.toFixed(5);
  previous.disabled = current === 0;
  next.disabled = current === count - 1;
  const pad = value => String(value).padStart(2, '0');
  pagePosition.textContent = narrow.matches ? `${pad(current + 1)} / 06` : `${pad(current * 2 + 1)}–${pad(current * 2 + 2)} / 06`;
  chapters.forEach((chapter, i) => {
    if (i === (narrow.matches ? Math.floor(current / 2) : current)) chapter.setAttribute('aria-current', 'step');
    else chapter.removeAttribute('aria-current');
  });
}

function requestUpdate() {
  if (!queued && enabled) { queued = true; requestAnimationFrame(update); }
}

function goToScene(scene, announce = true) {
  const index = Math.max(0, Math.min(count - 1, scene));
  measure();
  // Instant moves avoid forced scrolling through intervening pages for keyboard users.
  scrollTo({ top: start + sceneProgress(index, count) * travel, behavior: 'instant' });
  update();
  if (announce) {
    status.textContent = narrow.matches ? stories[index].dataset.label : `${['上午','午間','午後'][index]}：${stories[index * 2].dataset.label}、${stories[index * 2 + 1].dataset.label}`;
  }
}

function configure(preserve = false) {
  const wasEnabled = enabled;
  const wasInside = wasEnabled && scrollY >= start && scrollY <= start + travel;
  const oldMoment = runway.dataset.layout === 'single' ? current : current * 2;
  const canAnimate = !reduced.matches && innerHeight >= 700;
  configuredNarrow = narrow.matches;
  configuredEligibility = canAnimate;
  enabled = canAnimate && !manualReading;
  toggle.hidden = !canAnimate;
  toggle.textContent = enabled ? '改為一般閱讀' : '切回翻書體驗';
  runway.classList.toggle('is-enhanced', enabled);
  if (enabled) {
    build();
    measure();
    if (preserve && wasInside) goToScene(narrow.matches ? oldMoment : Math.floor(oldMoment / 2), false);
    else update();
  } else {
    book.replaceChildren();
    sheets = [];
    runway.classList.remove('is-native');
    if (preserve && wasInside) stories[oldMoment].scrollIntoView({ block: 'start', behavior: 'instant' });
  }
}

previous.addEventListener('click', () => goToScene(current - 1));
next.addEventListener('click', () => goToScene(current + 1));
chapters.forEach(chapter => chapter.addEventListener('click', event => {
  if (!enabled) return;
  event.preventDefault();
  goToScene(Number(chapter.dataset.chapter) * (narrow.matches ? 2 : 1));
}));
toggle.addEventListener('click', () => {
  const moment = narrow.matches ? current : current * 2;
  manualReading = !manualReading;
  configure(false);
  if (enabled) goToScene(narrow.matches ? moment : Math.floor(moment / 2), false);
  else {
    runway.scrollIntoView({ block: 'start', behavior: 'instant' });
    status.textContent = '一般閱讀模式，六個生活片刻依序顯示。';
  }
});
document.querySelectorAll('a[href="#day"]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  if (enabled) goToScene(0, false);
  else runway.scrollIntoView({ block: 'start', behavior: 'instant' });
  const heading = document.querySelector('#day-title');
  heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
}));
document.querySelector('.skip-book').addEventListener('click', event => {
  event.preventDefault();
  document.querySelector('#after-book').scrollIntoView({ block: 'start', behavior: 'instant' });
  document.querySelector('#after-book').focus({ preventScroll: true });
});
addEventListener('scroll', requestUpdate, { passive: true });
addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    const eligible = !reduced.matches && innerHeight >= 700;
    if (configuredNarrow !== narrow.matches || configuredEligibility !== eligible) configure(true);
    else { measure(); requestUpdate(); }
  });
}, { passive: true });
reduced.addEventListener('change', () => configure(true));
document.fonts.ready.then(() => { measure(); requestUpdate(); });
addEventListener('pageshow', () => { measure(); requestUpdate(); });
configure();

// Video is optional: preserve the poster on data-saving connections or playback failure.
const video = document.querySelector('#hero-video');
const videoButton = document.querySelector('#video-toggle');
let videoVisible = false, manuallyPaused = false, videoFailed = false;
const saveData = navigator.connection?.saveData || /(^|-)2g|3g/.test(navigator.connection?.effectiveType || '');
function loadVideo() {
  if (!video.getAttribute('src')) video.src = '../../assets/hero-campus.mp4';
}
function playVideo() {
  loadVideo();
  video.play().catch(() => { video.classList.remove('is-playing'); });
}
video.addEventListener('playing', () => {
  video.classList.add('is-playing');
  videoButton.setAttribute('aria-label', '暫停校園影片');
  videoButton.firstElementChild.textContent = 'Ⅱ';
});
video.addEventListener('pause', () => {
  videoButton.setAttribute('aria-label', '播放校園影片');
  videoButton.firstElementChild.textContent = '▷';
});
video.addEventListener('error', () => {
  videoFailed = true;
  video.classList.remove('is-playing');
  videoButton.hidden = true;
});
function syncVideo() {
  videoButton.hidden = reduced.matches || videoFailed;
  if (videoVisible && !document.hidden && !manuallyPaused && !reduced.matches && !saveData && !videoFailed) playVideo();
  else video.pause();
}
new IntersectionObserver(([entry]) => { videoVisible = entry.isIntersecting && entry.intersectionRatio >= 0.05; syncVideo(); }, { threshold: 0.05 }).observe(document.querySelector('.hero'));
document.addEventListener('visibilitychange', syncVideo);
reduced.addEventListener('change', syncVideo);
videoButton.addEventListener('click', () => {
  if (video.paused) { manuallyPaused = false; playVideo(); }
  else { manuallyPaused = true; video.pause(); }
});
