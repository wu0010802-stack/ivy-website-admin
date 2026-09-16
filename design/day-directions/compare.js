'use strict';
const choices={a:{title:'A｜章節故事',note:'推薦：片刻導覽集中在左側，照片與短故事放大呈現。可切換六個片刻，也能展開家長提問。'},b:{title:'B｜生活相簿',note:'照片先說話：滑動相簿，或點前後按鈕與片刻名稱。相鄰照片露出一角，提示還有故事可看。'},c:{title:'C｜一天旅程',note:'順著一天慢慢讀：往下捲動看六個片刻；左側導覽可快速跳到感興趣的段落。'}};
const frame=document.querySelector('#preview');let current='a';
function choose(view){if(!choices[view])view='a';current=view;const c=choices[view];document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));document.querySelector('#direction-title').textContent=c.title;document.querySelector('#direction-note').textContent=c.note;document.querySelector('#standalone').href=`view.html?direction=${view}`;frame.title=`${c.title}互動預覽`;frame.src=`view.html?direction=${view}`;history.replaceState(null,'',`?direction=${view}`);}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>choose(b.dataset.view)));
document.querySelectorAll('[data-device]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-device]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));document.querySelector('.preview-area').classList.toggle('mobile',b.dataset.device==='mobile');}));
choose(new URLSearchParams(location.search).get('direction')||'a');
