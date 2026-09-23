const $ = selector => document.querySelector(selector);
const variants = {
  a: { title: '經典對開', number: '01 / 03', duration: 3.2, material: '酒紅絨布', mood: '隆重、溫暖，帶一點典禮的期待。', description: '厚實的酒紅絨幕由中央向左右打開，摺痕隨拉力逐漸收密，讓首頁從中間慢慢出現。' },
  b: { title: '劇院升幕', number: '02 / 03', duration: 3.0, material: '深紅劇院幕', mood: '有舞台感，也有揭曉驚喜的儀式感。', description: '整幅布幕向上提起，金色波浪下襬隨布料收攏，首頁由下往上顯現，像一場節目正式開始。' },
  c: { title: '柔弧攬幕', number: '03 / 03', duration: 3.6, material: '柔紅緞布', mood: '柔軟、輕盈，像張開雙手的歡迎。', description: '兩片紅幕沿著柔和弧線向上方兩角攬起，帶一點輕盈的擺動；開口從下方展開，再完整露出首頁。' }
};
const params = new URLSearchParams(location.search);
let view = Object.hasOwn(variants, params.get('view')) ? params.get('view') : 'a';
let progress = 0;
let playing = false;
let frame = 0;
let last = 0;
let engine;
let failed = false;
let visibilityPaused = false;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const stage = $('#stage');
const pause = $('#pause');
const range = $('#progress');
const status = $('#status');

function clamp(value) { return Math.min(1, Math.max(0, value)); }
function render() {
  engine?.draw(progress, progress * variants[view].duration);
  range.value = Math.round(progress * 1000);
  range.setAttribute('aria-valuetext', `${Math.round(progress * 100)}%`);
  $('#time').value = `${(progress * variants[view].duration).toFixed(1)} / ${variants[view].duration.toFixed(1)} 秒`;
  $('.opening-copy').style.opacity = Math.max(0, 1 - progress / 0.22);
  $('.corner-note').style.opacity = Math.max(0, 1 - progress / 0.55);
  $('.scrim').style.opacity = (1 - progress) * 0.16;
  stage.dataset.complete = String(progress >= 1);
  stage.dataset.progress = progress.toFixed(4);
  $('#curtain').style.visibility = progress >= 1 || failed ? 'hidden' : 'visible';
  pause.textContent = playing ? '暫停' : progress >= 1 ? '播放' : '繼續';
}
function stop() {
  playing = false;
  cancelAnimationFrame(frame);
  frame = 0;
  render();
}
function tick(now) {
  if (!playing) return;
  // Use elapsed wall-clock time: slow hardware must not keep the entrance blocked.
  progress = clamp(progress + (now - last) / (variants[view].duration * 1000));
  last = now;
  if (progress >= 1) {
    stop();
    status.textContent = '開幕完成，可重播或切換方案';
    return;
  }
  render();
  frame = requestAnimationFrame(tick);
}
function play(restart = false) {
  if (!engine || failed) return;
  if (restart || progress >= 1) progress = 0;
  if (reducedMotion.matches) {
    progress = 1;
    stop();
    status.textContent = '已依「減少動態」設定略過動畫，可拖曳進度查看靜態姿態';
    return;
  }
  cancelAnimationFrame(frame);
  playing = true;
  last = performance.now();
  status.textContent = '播放中 · 可拖曳進度細看布料';
  render();
  frame = requestAnimationFrame(tick);
}
function choose(key, autoplay = true) {
  stop();
  view = key;
  progress = 0;
  const item = variants[view];
  for (const id of ['title', 'number', 'mood', 'description', 'material']) $(`#${id}`).textContent = item[id];
  $('#duration').textContent = `${item.duration.toFixed(1)} 秒`;
  $('#corner-letter').textContent = view.toUpperCase();
  $('#corner-name').textContent = item.title;
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  stage.dataset.view = view;
  engine?.select(view);
  const url = new URL(location.href);
  url.searchParams.set('view', view);
  url.searchParams.delete('p');
  url.searchParams.delete('paused');
  history.replaceState(null, '', url);
  render();
  if (failed) { progress = 1; render(); }
  else if (autoplay) play(true);
}
function immersive(enabled) {
  document.body.classList.toggle('immersive', enabled);
  $('#exit').hidden = !enabled;
  if (enabled) { $('#exit').focus(); play(true); }
  else { $('#full').focus(); }
}
function fail() {
  failed = true;
  progress = 1;
  stop();
  $('#replay').disabled = true;
  pause.disabled = true;
  range.disabled = true;
  status.textContent = '此瀏覽器未能啟用 3D 布幕，已直接顯示首頁';
  stage.dataset.renderer = 'fallback';
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => choose(button.dataset.view)));
$('#replay').addEventListener('click', () => play(true));
pause.addEventListener('click', () => {
  if (playing) { stop(); status.textContent = '已暫停 · 可繼續播放或拖曳進度'; }
  else play();
});
range.addEventListener('input', () => {
  const next = Number(range.value) / 1000;
  stop(); progress = next; render();
  status.textContent = '靜態比較 · 可繼續播放或重新開幕';
});
$('#skip').addEventListener('click', () => { progress = 1; stop(); status.textContent = '已略過開場動畫'; });
$('#full').addEventListener('click', () => immersive(true));
$('#exit').addEventListener('click', () => immersive(false));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.body.classList.contains('immersive')) immersive(false); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { visibilityPaused = playing; stop(); }
  else if (visibilityPaused) { visibilityPaused = false; play(); }
});
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) { progress = 1; stop(); status.textContent = '已依「減少動態」設定略過動畫'; } });
$('#curtain').addEventListener('webglcontextlost', event => { event.preventDefault(); fail(); });
window.addEventListener('pagehide', () => { stop(); engine?.dispose(); engine = undefined; });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

// DOM controls remain available if the optional module cannot be fetched.
choose(view, false);
const watchdog = setTimeout(fail, 7000);
try {
  const { createCurtains } = await import('./curtains.js');
  if (!failed) {
    engine = createCurtains($('#curtain'), stage);
    clearTimeout(watchdog);
    engine.select(view);
    stage.dataset.renderer = 'three';
    const requestedProgress = Number(params.get('p'));
    if (params.has('p') && Number.isFinite(requestedProgress)) {
      progress = clamp(requestedProgress);
      render();
      status.textContent = '靜態比較 · 可拖曳進度或重新開幕';
    } else if (params.has('paused')) {
      render();
      status.textContent = '已暫停 · 可播放或拖曳進度';
    } else play(true);
  }
} catch (error) {
  clearTimeout(watchdog);
  console.warn('Curtain preview unavailable:', error.message);
  fail();
}
