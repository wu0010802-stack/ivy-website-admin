'use strict';
let direction='a';let device=window.innerWidth<650?'mobile':'desktop';
const frame=document.querySelector('#preview');
const shell=document.querySelector('#frame-shell');
const stage=document.querySelector('.stage');
const notes={a:'一次只做一個決定。先看照片與地址選校，再用簡短表單留下需求。',b:'五校同時可比較。選校後在同頁填寫，右側摘要持續說明接下來會發生什麼。',c:'延續官網的大照片與留白。選校後開啟側邊表單，手機改為底部展開的表單。'};
function size(){stage.classList.toggle('mobile',device==='mobile');const target=device==='mobile'?404:1440;const available=stage.clientWidth-(innerWidth<800?20:48);const scale=Math.min(1,available/target);shell.style.width=target+'px';shell.style.transform=`scale(${scale})`;shell.style.marginLeft=(available-target)/2+'px';shell.style.marginBottom=-(shell.offsetHeight*(1-scale))+'px';document.querySelectorAll('[data-device]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.device===device));}
document.querySelectorAll('[data-direction]').forEach(b=>b.addEventListener('click',()=>{direction=b.dataset.direction;document.querySelectorAll('[data-direction]').forEach(x=>x.setAttribute('aria-pressed',x===b));frame.src=`preview.html?direction=${direction}&capture=1`;frame.title=direction.toUpperCase()+' 方案互動預覽';document.querySelector('#rationale').textContent=notes[direction];document.querySelector('#open').href=`preview.html?direction=${direction}`;document.querySelector('#preselected').href=`preview.html?direction=${direction}&campus=renwu`;document.querySelector('#paused').href=`preview.html?direction=${direction}&campus=renwu&state=paused`;document.querySelector('#desktop-shot').href=`screenshots/${direction}-desktop.png`;document.querySelector('#mobile-shot').href=`screenshots/${direction}-mobile.png`;}));
document.querySelectorAll('[data-device]').forEach(b=>b.addEventListener('click',()=>{device=b.dataset.device;size();}));
window.addEventListener('resize',size);frame.addEventListener('load',size);size();
