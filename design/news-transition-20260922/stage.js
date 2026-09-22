const directions = {
  a: {title:'A · 直線揭幕',note:'深綠色幕往上退，露出霧藍色的消息區塊。節奏最接近 Wellington。'},
  b: {title:'B · 圓弧展開',note:'暖米色從下方舒展成一個大圓弧，接住下一段校園日常。'},
  c: {title:'C · 整面漸染',note:'深綠慢慢轉成鼠尾草綠，消息隨色彩變亮而浮現。'}
};
const params = new URLSearchParams(location.search);
const direction = Object.hasOwn(directions,params.get('direction')) ? params.get('direction') : 'a';
document.body.dataset.direction = direction;
document.title = `${directions[direction].title}｜常春藤轉場提案`;
document.querySelector('#direction-title').textContent = directions[direction].title;
document.querySelector('#direction-note').textContent = directions[direction].note;
document.querySelector(`[data-choice=${direction}]`).setAttribute('aria-current','page');

const track = document.querySelector('.track');
const stage = document.querySelector('.stage');
const news = document.querySelector('.news');
const slider = document.querySelector('#progress');
const output = document.querySelector('#progress-value');
const play = document.querySelector('#play');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const forced = matchMedia('(forced-colors: active)');
const supportsNative = CSS.supports('animation-timeline:view()') && CSS.supports('animation-range:0% 100%') && CSS.supports('timeline-scope:--news-transition');
let travel = 900, start = 0, pending = 0, playing = 0, progress = 0;

function paint() {
  pending = 0;
  progress = document.body.dataset.motion === 'off' ? 1 : Math.max(0,Math.min(1,(scrollY - start) / travel));
  if (document.body.dataset.motion === 'fallback') stage.style.setProperty('--progress',String(progress));
  const percent = Math.round(progress * 100);
  slider.value = String(percent);
  slider.setAttribute('aria-valuetext',`轉場進度 ${percent}%`);
  output.value = `${percent}%`;
  // Masked content only becomes keyboard-accessible after the colour reveal.
  news.inert = progress < .98;
}
function schedule() { if(!pending) pending = requestAnimationFrame(paint); }
function measure() {
  const bar = document.querySelector('.demo-bar').getBoundingClientRect().height;
  travel = Math.round(Math.max(620,innerHeight * 1.08));
  start = track.getBoundingClientRect().top + scrollY - bar;
  document.documentElement.style.setProperty('--travel',`${travel}px`);
  // The reveal is limited to one viewport; mobile content continues in normal flow.
  document.documentElement.style.setProperty('--reveal-h',`${innerHeight - bar}px`);
  schedule();
}
function stop() { cancelAnimationFrame(playing); playing = 0; play.textContent = '播放轉場'; }
function go(value) { stop(); scrollTo({top:start + travel * value,behavior:'instant'}); paint(); }
function playback() {
  if(playing){stop();return;}
  if(document.body.dataset.motion === 'off') return;
  go(0);
  const began = performance.now();
  play.textContent = '暫停';
  function step(now) {
    const p = Math.min(1,(now - began) / 5200);
    scrollTo({top:start + travel * p,behavior:'instant'});
    if(p < 1) playing = requestAnimationFrame(step); else stop();
  }
  playing = requestAnimationFrame(step);
}
function configure() {
  stop();
  document.body.dataset.motion = reduced.matches || forced.matches ? 'off' : supportsNative && params.get('motion') !== 'fallback' ? 'native' : 'fallback';
  stage.style.removeProperty('--progress');
  const off = document.body.dataset.motion === 'off';
  play.disabled = off;slider.disabled = off;
  document.querySelectorAll('[data-progress],#replay-end').forEach(button => button.disabled = off);
  if(off) play.textContent = '減少動態';
  measure();
}
slider.addEventListener('input',()=>go(Number(slider.value)/100));
document.querySelectorAll('[data-progress]').forEach(button => button.addEventListener('click',()=>go(Number(button.dataset.progress))));
play.addEventListener('click',playback);
document.querySelector('#replay-end').addEventListener('click',playback);
window.addEventListener('scroll',schedule,{passive:true});
window.addEventListener('resize',measure,{passive:true});
window.addEventListener('wheel',stop,{passive:true});
window.addEventListener('touchstart',stop,{passive:true});
window.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key)) stop();});
document.addEventListener('visibilitychange',()=>{if(document.hidden) stop();});
reduced.addEventListener('change',configure);forced.addEventListener('change',configure);
const resizeObserver = new ResizeObserver(measure);resizeObserver.observe(news);
document.fonts.ready.then(measure);
const dialog = document.querySelector('#detail');
document.querySelectorAll('[data-detail]').forEach(button => button.addEventListener('click',()=>{
  stop();document.querySelector('#detail-title').textContent = button.dataset.detail;dialog.showModal();
}));
configure();
if(params.has('p')) requestAnimationFrame(()=>go(Math.max(0,Math.min(1,Number(params.get('p')) || 0))));
