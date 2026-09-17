'use strict';

// Pre-rendered story panels share native tabs and keyboard navigation.
const tabs = [...document.querySelectorAll('[role="tab"]')];
const panels = [...document.querySelectorAll('[role="tabpanel"]')];
function selectStory(index, focus = false) {
  tabs.forEach((tab, i) => {
    tab.setAttribute('aria-selected', String(i === index));
    tab.tabIndex = i === index ? 0 : -1;
    panels[i].hidden = i !== index;
  });
  if (focus) tabs[index].focus({ preventScroll: true });
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectStory(index));
  tab.addEventListener('keydown', event => {
    const targets = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 };
    if (targets[event.key] !== undefined) {
      event.preventDefault();
      selectStory(targets[event.key], true);
    }
  });
});
document.querySelectorAll('[data-next]').forEach(button => button.addEventListener('click', () => {
  selectStory(Number(button.dataset.next), true);
  document.querySelector('.story-tabs').scrollIntoView({ block: 'start', behavior: 'instant' });
}));

const video = document.querySelector('#hero-video');
const toggle = document.querySelector('#video-toggle');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let requestedPlayback = !reducedMotion.matches;
let inView = true;
let generation = 0;
toggle.hidden = false;

function updateVideoControl() {
  toggle.innerHTML = video.paused ? '<span aria-hidden="true">▷</span> 播放校園片刻' : '<span aria-hidden="true">Ⅱ</span> 暫停影片';
}
async function reconcileVideo() {
  const currentGeneration = ++generation;
  if (!requestedPlayback || !inView || document.hidden) {
    video.pause();
    updateVideoControl();
    return;
  }
  if (!video.getAttribute('src')) video.src = video.dataset.src;
  try {
    await video.play();
    if (currentGeneration !== generation) return;
    video.classList.add('is-playing');
  } catch {
    if (currentGeneration === generation) {
      requestedPlayback = false;
      video.classList.remove('is-playing');
    }
  }
  updateVideoControl();
}
toggle.addEventListener('click', () => {
  requestedPlayback = video.paused;
  reconcileVideo();
});
video.addEventListener('play', updateVideoControl);
video.addEventListener('pause', updateVideoControl);
video.addEventListener('error', () => {
  requestedPlayback = false;
  video.classList.remove('is-playing');
  toggle.hidden = true;
});
document.addEventListener('visibilitychange', reconcileVideo);
reducedMotion.addEventListener('change', () => {
  requestedPlayback = !reducedMotion.matches;
  if (reducedMotion.matches) video.classList.remove('is-playing');
  reconcileVideo();
});
if ('IntersectionObserver' in window) {
  new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    reconcileVideo();
  }, { threshold: 0.05 }).observe(document.querySelector('.hero'));
} else {
  reconcileVideo();
}
