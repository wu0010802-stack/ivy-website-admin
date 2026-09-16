'use strict';
const choices={d:{title:'D｜日常照片牆',note:'照片成為入口：不規則大圖搭配深綠底，六個生活片刻自由選擇，點選照片可展開故事。'},e:{title:'E｜孩子的生活手帳',note:'把一天翻成三個章節：桌面像打開一本手帳，一次讀兩個片刻；手機自然轉成直向閱讀。'},f:{title:'F｜從家長的好奇開始',note:'從關心的問題開始：點選四個家長提問，照片隨內容切換，再深入閱讀相關的生活片刻。'}};
const frame=document.querySelector('#preview');
function choose(view){if(!choices[view])view='d';const c=choices[view];document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));document.querySelector('#direction-title').textContent=c.title;document.querySelector('#direction-note').textContent=c.note;document.querySelector('#standalone').href=`view.html?direction=${view}`;frame.title=`${c.title}互動預覽`;frame.src=`view.html?direction=${view}`;history.replaceState(null,'',`?direction=${view}`);}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>choose(b.dataset.view)));
document.querySelectorAll('[data-device]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-device]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));document.querySelector('.preview-area').classList.toggle('mobile',b.dataset.device==='mobile');}));
choose(new URLSearchParams(location.search).get('direction')||'d');
