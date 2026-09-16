'use strict';
const el=document.querySelector('#day-content');
const direction=new URLSearchParams(location.search).get('direction')||'d';
const arrow=(left=false)=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${left?'M19 12H5m6-6-6 6 6 6':'M5 12h14m-6-6 6 6-6 6'}"/></svg>`;
const plus=()=>'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg>';
const check=()=>'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
const num=i=>String(i+1).padStart(2,'0');
const src=m=>`../../assets/${m.image}.webp`;
const photo=m=>`<figure class="photo"><img src="${src(m)}" alt="${m.caption}" width="1000" height="600"><figcaption>${m.caption}</figcaption></figure>`;
const faq=m=>`<details class="faq"><summary>${m.question}${plus()}</summary><p>${m.answer}</p></details>`;
const visit=()=>`<a class="visit" href="../../#/visit" target="_top">${check()}預約參觀</a>`;
const foot=()=>`<footer class="section-foot"><p>校園影像呈現日常情境；各校、各班作息依園所安排。</p><a href="../../#/home/campuses" target="_top">認識五所校園 ${arrow()}</a></footer>`;
const smooth=()=>matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth';
function installDialog(){
 el.insertAdjacentHTML('beforeend','<dialog class="story-dialog" aria-labelledby="dialog-title"><button class="dialog-close" aria-label="關閉故事">×</button><div class="dialog-body"></div></dialog>');
 const dialog=el.querySelector('dialog'),body=dialog.querySelector('.dialog-body');let origin=null,previousOverflow='';
 const close=()=>dialog.close();
 dialog.querySelector('.dialog-close').addEventListener('click',close);
 dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();});
 dialog.addEventListener('close',()=>{document.documentElement.style.overflow=previousOverflow;origin?.focus({preventScroll:true});});
 return (i,trigger)=>{const m=moments[i];origin=trigger;body.innerHTML=`${photo(m)}<div class="dialog-copy"><span class="eyebrow">${num(i)} / ${m.label}</span><h2 id="dialog-title">${m.title}</h2><p>${m.story}</p>${faq(m)}${visit()}</div>`;previousOverflow=document.documentElement.style.overflow;dialog.showModal();document.documentElement.style.overflow='hidden';};
}
function wall(){
 const tile=(i,cls)=>{const m=moments[i];return `<button class="wall-tile ${cls}" data-moment="${i}" aria-haspopup="dialog" aria-label="閱讀${m.label}的故事"><img src="${src(m)}" alt="" width="1000" height="600"><span class="tile-plus">${plus()}</span><span class="tile-copy"><small>${num(i)} / ${m.label}</small><strong>${m.hint}</strong></span></button>`;};
 el.innerHTML=`<section class="wall"><div class="wrap"><header class="wall-heading"><div><span class="eyebrow">孩子的一天</span><h1>每一個小日常，<br>都值得被看見。</h1></div><p>不必按順序，跟著好奇心走。<br>選一張照片，看看孩子的日常。</p></header><div class="photo-wall">${tile(1,'tile-discover')}${tile(4,'tile-outside')}${tile(0,'tile-hello')}${tile(5,'tile-home')}<aside class="quiet-tile"><span class="eyebrow">還有這些小片刻</span><h2>吃飽，休息，<br>再出發。</h2><p>成長，也在生活的小事裡。</p>${[2,3].map(i=>`<button data-moment="${i}" aria-haspopup="dialog">${moments[i].label}${arrow()}</button>`).join('')}</aside></div>${foot()}</div></section>`;
 const open=installDialog();el.querySelectorAll('[data-moment]').forEach(b=>b.addEventListener('click',()=>open(Number(b.dataset.moment),b)));
}
const chapters=[{label:'上午',name:'出發與發現',moments:[0,1],titles:['一聲早安，<br>故事開始。','原來，世界有好多為什麼。']},{label:'午間',name:'照顧自己',moments:[2,3],titles:['「我自己來！」<br>是今天的小進步。','慢一點，也是在好好長大。']},{label:'午後',name:'玩耍與分享',moments:[4,5],titles:['把今天，<br>玩得好大。','今天的好多事，想告訴你。']}];
function journal(){
 el.innerHTML=`<section class="journal"><div class="wrap"><header class="journal-heading"><span class="eyebrow">孩子的生活手帳</span><h1>今天，又多了一點點長大。</h1><p>一聲早安、一個發現，都是今天值得留下的小事。</p></header><div class="book-tabs" role="tablist" aria-label="選擇生活手帳的章節">${chapters.map((c,i)=>`<button id="bookmark-${i}" role="tab" aria-selected="false" aria-controls="book-spread" tabindex="-1"><strong>${c.label}</strong><span>${c.name}</span></button>`).join('')}</div><div class="book-spread" id="book-spread" role="tabpanel" tabindex="0"></div><nav class="book-controls" aria-label="翻閱生活手帳"><button id="book-prev" aria-label="上一個章節">${arrow(true)}</button><p id="book-page" aria-live="polite"></p><button id="book-next" aria-label="下一個章節">${arrow()}</button></nav>${foot()}</div></section>`;
 const tabs=[...el.querySelectorAll('[role=tab]')],spread=el.querySelector('#book-spread'),prev=el.querySelector('#book-prev'),next=el.querySelector('#book-next');let current=0;
 function show(i){current=i;const c=chapters[i];tabs.forEach((t,j)=>{t.setAttribute('aria-selected',String(i===j));t.tabIndex=i===j?0:-1;});spread.setAttribute('aria-labelledby',`bookmark-${i}`);spread.innerHTML=c.moments.map((mi,j)=>{const m=moments[mi];return `<article class="book-page page-${j}"><span class="page-overline">${num(mi)} / ${m.label}</span>${j===0?`<h2>${c.titles[j]}</h2>`:''}<div class="book-photo">${photo(m)}</div>${j===1?`<h2>${c.titles[j]}</h2>`:''}<p class="page-story">${m.story}</p>${faq(m)}</article>`;}).join('');prev.disabled=i===0;next.disabled=i===2;el.querySelector('#book-page').textContent=`${num(i)} / 03　${c.label}`;}
 tabs.forEach((t,i)=>{t.addEventListener('click',()=>show(i));t.addEventListener('keydown',e=>{let n;if(e.key==='ArrowRight')n=(i+1)%3;if(e.key==='ArrowLeft')n=(i+2)%3;if(e.key==='Home')n=0;if(e.key==='End')n=2;if(n!==undefined){e.preventDefault();show(n);tabs[n].focus();}});});
 function turn(delta){show(current+delta);spread.focus({preventScroll:true});if(matchMedia('(max-width:700px)').matches)spread.scrollIntoView({block:'start',behavior:smooth()});}
 prev.addEventListener('click',()=>turn(-1));next.addEventListener('click',()=>turn(1));show(0);
}
const curiosities=[
 {title:'第一次上學，孩子能慢慢適應嗎？',lead:'從熟悉環境、認識老師開始，一起聊聊孩子的步調。',detail:'每個孩子面對新環境的方式都不同。參觀時，可以一起討論入園準備、陪伴方式與親師聯繫。',indices:[0],image:'../believe-directions/value-company.jpg',caption:'常春藤影像素材 · 大人與孩子的陪伴片刻',note:'陪伴，是故事的開始。'},
 {title:'吃飯和休息，會怎麼被陪伴？',lead:'吃得好、好好休息，也是孩子日常裡重要的小事。',detail:'帶著孩子的飲食與休息習慣，和園所聊聊餐點、特殊飲食需求，以及不同的午休需要。',indices:[2,3],image:'../../assets/classroom.webp',caption:'義華校教室空間參考 · 用餐與午休實拍待補',note:'小小的生活，慢慢練習。'},
 {title:'在遊戲裡，孩子發現了什麼？',lead:'一個「為什麼」，就能開啟一場小小探索。',detail:'看一看、摸一摸，和同伴一起試試看。透過生活裡的素材，練習觀察、表達與分享。',indices:[1,4],image:'../../assets/learning.webp',caption:'義華校 · 孩子的探索片刻',note:'讓好奇心，帶著孩子走。'},
 {title:'今天的小故事，怎麼帶回家？',lead:'放學後的一句「我跟你說」，讓故事繼續。',detail:'孩子的分享、家長的觀察，都能成為交流的開始。參觀時，也可以詢問園所平日的聯繫方式。',indices:[5],image:'../../assets/hero-campus-still.webp',caption:'常春藤校園影片畫面 · 離園情境示意',note:'把新發現，帶回家。'}
];
function curiosity(){
 el.innerHTML=`<section class="curiosity"><div class="wrap"><header class="curiosity-heading"><span class="eyebrow">孩子的一天 · 從家長的好奇開始</span><h1>你在意的小事，<br>是我們想聊的大事。</h1><p>選一個你想了解的問題，走進孩子的日常。</p></header><div class="curiosity-layout"><div class="questions">${curiosities.map((q,i)=>`<details class="curiosity-question" name="parent-curiosity" ${i===0?'open':''}><summary><span class="question-number">${num(i)}</span><span>${q.title}</span>${plus()}</summary><div class="answer"><p class="answer-lead">${q.lead}</p><p>${q.detail}</p><figure class="mobile-photo"><img src="${q.image}" alt="${q.caption}" width="760" height="570"><figcaption>${q.caption}</figcaption></figure><div class="moment-links">${q.indices.map(mi=>`<button data-moment="${mi}" aria-haspopup="dialog">看${moments[mi].label}的故事 ${arrow()}</button>`).join('')}</div></div></details>`).join('')}<div class="visit-note"><p>把想了解的事，留給一次親自見面。</p>${visit()}</div></div><div class="curiosity-visual" aria-hidden="true"><figure class="main-photo"><img id="curiosity-photo" alt="" width="632" height="790"><figcaption id="curiosity-caption"></figcaption></figure><div class="image-note"><span id="curiosity-note"></span><svg aria-hidden="true" viewBox="0 0 140 15"><path d="M2 10Q40 2 70 8T138 5"/></svg></div><figure class="small-photo"><img src="../../assets/campus.webp" alt="" width="960" height="600"><figcaption>常春藤・義華校</figcaption></figure></div></div>${foot()}</div></section>`;
 const details=[...el.querySelectorAll('.curiosity-question')];
 function select(i){const q=curiosities[i];el.querySelector('#curiosity-photo').src=q.image;el.querySelector('#curiosity-caption').textContent=q.caption;el.querySelector('#curiosity-note').textContent=q.note;}
 details.forEach((d,i)=>d.addEventListener('toggle',()=>{if(d.open){details.forEach(other=>{if(other!==d)other.open=false;});select(i);}}));select(0);
 const open=installDialog();el.querySelectorAll('[data-moment]').forEach(b=>b.addEventListener('click',()=>open(Number(b.dataset.moment),b)));
}
const names={d:'日常照片牆',e:'孩子的生活手帳',f:'從家長的好奇開始'};
document.title=`${names[direction]||names.d}｜孩子的一天`;
if(direction==='e')journal();else if(direction==='f')curiosity();else wall();
