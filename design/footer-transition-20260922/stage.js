const names={original:['現況 · 直接交接','霧藍消息結束後，直接進入暖白頁尾。'],a:['A · 霧藍漸退','霧藍慢慢回到暖白，讓交界安靜消失。'],b:['B · 頁尾揭幕','消息往上離開，底下的頁尾以較慢速度露出。'],c:['C · 圓弧收邊','暖白弧面接住消息，隨捲動緩緩收平。']};
const params=new URLSearchParams(location.search),direction=Object.hasOwn(names,params.get('direction'))?params.get('direction'):'a';
const composition=document.querySelector('#composition'),zone=document.querySelector('.footer-zone'),footer=document.querySelector('.footer'),play=document.querySelector('#play'),range=document.querySelector('#progress'),output=document.querySelector('output');
const reduced=matchMedia('(prefers-reduced-motion:reduce)'),forced=matchMedia('(forced-colors:active)');
let frame=0,playFrame=0,start=0,travel=1,playing=false;
document.body.dataset.direction=direction;document.querySelector('#direction-title').textContent=names[direction][0];document.querySelector('#direction-note').textContent=names[direction][1];
document.querySelectorAll('[data-direction]').forEach(a=>a.setAttribute('aria-current',a.dataset.direction===direction?'page':'false'));
const clamp=v=>Math.max(0,Math.min(1,v));
function progress(){return clamp((scrollY-start)/travel)}
function paint(){frame=0;const p=progress();if(document.body.dataset.motion==='fallback')composition.style.setProperty('--footer-progress',p);range.value=String(Math.round(p*100));output.value=`${Math.round(p*100)}%`;range.setAttribute('aria-valuetext',`轉場進度 ${Math.round(p*100)}%`)}
function schedule(){if(!frame)frame=requestAnimationFrame(paint)}
function measure(){const h=footer.offsetHeight,bar=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-height'));document.documentElement.style.setProperty('--footer-height',`${h}px`);document.documentElement.style.setProperty('--footer-shift',`${Math.min(h*.6,220)}px`);document.documentElement.style.setProperty('--screen',`${innerHeight}px`);start=scrollY+zone.getBoundingClientRect().top-innerHeight;travel=Math.min(h,innerHeight-bar);paint()}
function stop(){cancelAnimationFrame(playFrame);playing=false;play.textContent='播放轉場';play.setAttribute('aria-pressed','false')}
function go(p){document.body.dataset.reading='false';scrollTo({top:Math.max(0,start+clamp(p)*travel),behavior:'instant'});paint()}
function run(){if(playing){stop();return}if(reduced.matches||forced.matches){go(1);return}stop();go(0);const began=performance.now();playing=true;play.textContent='停止播放';play.setAttribute('aria-pressed','true');function tick(now){const t=clamp((now-began)/4400);go(t<.5?2*t*t:1-((-2*t+2)**2)/2);if(t<1)playFrame=requestAnimationFrame(tick);else stop()}playFrame=requestAnimationFrame(tick)}
function configure(){stop();document.body.dataset.reading='false';const off=reduced.matches||forced.matches;document.body.dataset.motion=off?'off':params.get('motion')!=='fallback'&&CSS.supports('animation-timeline:view()')&&CSS.supports('animation-range:entry 0% entry 100%')&&CSS.supports('timeline-scope:--footer-entry')?'native':'fallback';composition.style.removeProperty('--footer-progress');play.disabled=off;measure()}
addEventListener('scroll',schedule,{passive:true});addEventListener('resize',measure,{passive:true});reduced.addEventListener('change',configure);forced.addEventListener('change',configure);
new ResizeObserver(measure).observe(footer);new ResizeObserver(measure).observe(document.querySelector('.home-news'));
for(const name of ['wheel','touchstart'])addEventListener(name,stop,{passive:true});addEventListener('keydown',e=>{if(['PageDown','PageUp','ArrowDown','ArrowUp','Home','End',' '].includes(e.key))stop()});document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});
play.addEventListener('click',run);document.querySelector('#replay').addEventListener('click',run);range.addEventListener('input',()=>{stop();go(Number(range.value)/100)});document.querySelectorAll('[data-progress]').forEach(b=>b.addEventListener('click',()=>{stop();go(Number(b.dataset.progress))}));
footer.addEventListener('focusin',()=>{stop();document.body.dataset.reading='true'});
const dialog=document.querySelector('#preview-detail');document.querySelectorAll('.home-news button').forEach(b=>b.addEventListener('click',()=>{stop();dialog.showModal()}));dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
configure();document.fonts.ready.then(()=>{measure();go(params.has('p')?Number(params.get('p')):0)});
