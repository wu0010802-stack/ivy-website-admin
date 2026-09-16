/* 五校介紹呈現方向比較：資料、共用渲染與三個方向的互動。
   只做比較用途；採用後再把選定方向搬進 app.js 的 home()。 */
(function(){
const ASSETS='../../assets/';
const ORG_FB='https://www.facebook.com/ivykid';
// line / facebook：目前只查到義華校的官方帳號（ivykids.tw 頁尾）與機構粉絲專頁（ivykidschool.com）。
// 其他校區的 LINE 官方帳號待園方提供，先以「待補」狀態呈現，不用義華的連結冒充。
const CAMPUSES=[
 {key:'yihua',name:'義華校',district:'三民區',address:'高雄市三民區義華路68號',phone:'07-392-8366',image:'campus',intro:'在義華路上，走進孩子的日常。',line:'https://lin.ee/gwl8fnA',facebook:'https://www.facebook.com/ivy.kids.fb/',fbNote:'義華校粉絲專頁'},
 {key:'minghua',name:'明華校',district:'左營區',address:'高雄市左營區明華一路176號',phone:'07-556-6796',image:'minghua',intro:'在明華一路，認識我們的校園。',line:null,facebook:ORG_FB,fbNote:'常春藤機構粉絲專頁（明華校粉專待補）'},
 {key:'chongde',name:'崇德校',district:'左營區',address:'高雄市左營區崇德路87號',phone:'07-341-6286',image:'chongde',intro:'從崇德路，開始一段校園探索。',line:null,facebook:ORG_FB,fbNote:'常春藤機構粉絲專頁（崇德校粉專待補）'},
 {key:'international',name:'國際校',district:'鳥松區',address:'高雄市鳥松區球場路59號',phone:'07-370-8001',image:'international',intro:'走進鳥松，認識國際校。',line:null,facebook:ORG_FB,fbNote:'常春藤機構粉絲專頁（國際校粉專待補）'},
 {key:'renwu',name:'仁武校',district:'仁武區',address:'高雄市仁武區京吉一路102號',phone:'07-375-7081',image:'renwu',intro:'在仁武，遇見下一段成長。',line:null,facebook:ORG_FB,fbNote:'常春藤機構粉絲專頁（仁武校粉專待補）'}
];
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=n=>`<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${n}"/></svg>`;
const ext='target="_blank" rel="noopener noreferrer"';
const img=(c,cls='')=>`<img class="${cls}" src="${ASSETS}${c.image}.webp" alt="${esc(c.name)}官方校園照片" loading="lazy" decoding="async" width="600" height="522">`;
// Google 地圖：免金鑰的 output=embed 嵌入（單一地點）；規劃路線走 Maps URLs。
const embedURL=c=>`https://www.google.com/maps?q=${encodeURIComponent(c.address)}&z=16&hl=zh-TW&output=embed`;
const dirURL=c=>`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.address)}`;
const pageLink=c=>`../../index.html#/${c.key}`;
const bookLink=c=>`../../index.html#/visit/${c.key}`;

function sprite(){
 const s=document.createElement('div');
 s.innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" hidden aria-hidden="true" focusable="false">${Object.entries(window.CD_ICONS).map(([k,v])=>`<symbol id="i-${k}" viewBox="${v.vb}">${v.body}</symbol>`).join('')}</svg>`;
 document.body.prepend(s.firstElementChild);
}
function socialIcons(c){
 const line=c.line?`<a class="cd-iconbtn line" href="${c.line}" ${ext} aria-label="${esc(c.name)} LINE 官方帳號" title="LINE 官方帳號">${icon('line')}</a>`
  :`<span class="cd-iconbtn line is-pending" role="img" aria-label="${esc(c.name)} LINE 官方帳號待提供" title="LINE 官方帳號待園方提供">${icon('line')}</span>`;
 const fb=`<a class="cd-iconbtn facebook" href="${c.facebook}" ${ext} aria-label="${esc(c.name)} Facebook" title="${esc(c.fbNote)}">${icon('facebook')}</a>`;
 return line+fb;
}
function socialPills(c){
 const line=c.line?`<a class="cd-pill line" href="${c.line}" ${ext}><i>${icon('line')}</i><span>加 LINE 好友<small>${esc(c.name)}官方帳號</small></span></a>`
  :`<span class="cd-pill line is-pending" title="LINE 官方帳號待園方提供"><i>${icon('line')}</i><span>加 LINE 好友<small>${esc(c.name)}帳號待補</small></span></span>`;
 const fb=`<a class="cd-pill facebook" href="${c.facebook}" ${ext}><i>${icon('facebook')}</i><span>Facebook<small>${c.facebook===ORG_FB?'常春藤機構粉絲專頁':esc(c.name)+'粉絲專頁'}</small></span></a>`;
 return line+fb;
}
// iframe 進入視口附近才指定 src：Google 的 output=embed 載入時會把焦點移進地圖，若在畫面外載入會把整頁捲走；
// 同時避免三個方向的地圖一次全部下載。
const io=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){const f=e.target;f.src=f.dataset.src;io.unobserve(f);}});},{rootMargin:'160px 0px'});
function armFrames(scope){scope.querySelectorAll('iframe[data-src]:not([src])').forEach(f=>io.observe(f));}
function mapFrame(c,extraCls=''){
 return `<div class="cd-mapframe ${extraCls}"><iframe title="${esc(c.name)} Google 地圖" data-src="${embedURL(c)}" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe><a class="cd-mapfloat" href="${dirURL(c)}" ${ext}>${icon('navigation-arrow')}規劃路線 ${icon('arrow-up-right')}</a></div>`;
}
function heading(copy){
 return `<div class="section-heading"><div><span class="eyebrow">五校介紹</span><h2 class="section-title">五所校園，等你來認識。</h2></div><p>${copy}</p></div>`;
}

/* 方向 A：地圖清單 */
function overviewSVG(){
 const M=window.CAMPUS_MAP;
 const vb='96 150 440 330';
 const d=M.districts.map(x=>`<path class="district${x.core?' core':''}" d="${x.d}"/>`).join('');
 const names=M.districts.filter(x=>['三民區','左營區','鳥松區','仁武區','鼓山區','鳳山區','苓雅區','大社區'].includes(x.name)).map(x=>{
  const off={'左營區':[36,-10],'三民區':[-30,30],'鳥松區':[10,20],'仁武區':[0,52],'楠梓區':[0,70],'鼓山區':[0,0],'鳳山區':[0,0],'苓雅區':[0,0],'大社區':[0,60]}[x.name]||[0,0];
  return `<text class="dname${x.core?' core':''}" x="${x.cx+off[0]}" y="${x.cy+off[1]}">${x.name}</text>`;}).join('');
 const pins=CAMPUSES.map((c,i)=>{const p=M.pins[c.key];const left=c.key==='chongde'||c.key==='minghua';
  return `<g class="pin" data-key="${c.key}" tabindex="0" role="button" aria-label="在地圖顯示${esc(c.name)}"><circle cx="${p.x}" cy="${p.y}" r="10"/><text class="pnum" x="${p.x}" y="${p.y}">${i+1}</text><text class="plabel" x="${left?p.x-15:p.x+15}" y="${p.y}" text-anchor="${left?'end':'start'}">${esc(c.name)}</text></g>`;}).join('');
 return `<svg class="cd-svg" viewBox="${vb}" role="img" aria-label="北高雄五校位置示意圖"><g>${d}</g><g>${names}</g><g>${pins}</g></svg>`;
}
function renderA(root){
 let active=CAMPUSES[0].key, view='overview', loaded=false;
 root.innerHTML=`<div class="container">${heading('從生活圈與接送路線出發，<br>先看看五校在哪裡。')}<div class="cd-locator">
  <div class="cd-mapcard">
   <div class="cd-seg" role="tablist" aria-label="地圖模式"><button type="button" role="tab" id="cd-a-tab-overview" aria-selected="true" aria-controls="cd-a-overview">${icon('map-trifold')}五校位置</button><button type="button" role="tab" id="cd-a-tab-google" aria-selected="false" aria-controls="cd-a-google" tabindex="-1">${icon('map-pin')}Google 地圖</button></div>
   <div class="cd-mapview"><div id="cd-a-overview" role="tabpanel" aria-labelledby="cd-a-tab-overview">${overviewSVG()}</div><div id="cd-a-google" role="tabpanel" aria-labelledby="cd-a-tab-google" hidden></div></div>
   <div class="cd-mapfoot"><span id="cd-a-foot"></span><a id="cd-a-dir" class="cd-ext" ${ext}>${icon('navigation-arrow')}規劃路線 ${icon('arrow-up-right')}</a></div>
  </div>
  <div class="cd-rows">${CAMPUSES.map((c,i)=>`<article class="cd-row" data-key="${c.key}">${img(c)}<div><h3><button type="button" class="cd-row-select" aria-pressed="false"><span class="cd-num" aria-hidden="true">${i+1}</span>${c.name}</button><small>高雄 · ${c.district}</small></h3><address>${c.address}</address><div class="cd-row-actions"><a class="cd-phone-link" href="tel:${c.phone}">${icon('phone')}${c.phone}</a><a class="cd-more" href="${pageLink(c)}">認識校區</a><div class="cd-social">${socialIcons(c)}</div></div></div></article>`).join('')}</div>
 </div><p class="cd-note" style="margin-top:14px">示意位置圖依各校所在道路概略標示，正式版可換成含五個標記的 Google 地圖。</p></div>`;
 const google=root.querySelector('#cd-a-google'), foot=root.querySelector('#cd-a-foot'), dir=root.querySelector('#cd-a-dir');
 const tabs=[...root.querySelectorAll('.cd-seg [role=tab]')];
 function paint(){
  const c=CAMPUSES.find(x=>x.key===active);
  root.querySelectorAll('.cd-row').forEach(r=>{const on=r.dataset.key===active;r.toggleAttribute('aria-current',on);r.querySelector('.cd-row-select').setAttribute('aria-pressed',String(on));});
  root.querySelectorAll('.pin').forEach(p=>p.classList.toggle('is-active',p.dataset.key===active));
  foot.innerHTML=view==='overview'?`五校位置示意 · 目前選取 <strong>${esc(c.name)}</strong>`:`Google 地圖 · <strong>${esc(c.name)}</strong> ${esc(c.address)}`;
  dir.href=dirURL(c);
  if(view==='google'){ if(!loaded||google.dataset.key!==active){google.innerHTML=mapFrame(c);google.dataset.key=active;loaded=true;armFrames(google);} }
 }
 function setView(v){view=v;tabs.forEach(t=>{const on=t.id.endsWith(v);t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;});root.querySelector('#cd-a-overview').hidden=v!=='overview';google.hidden=v!=='google';paint();}
 function select(key,toGoogle){active=key;if(toGoogle)setView('google');else paint();}
 tabs.forEach(t=>{t.addEventListener('click',()=>setView(t.id.replace('cd-a-tab-','')));t.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const n=tabs[(tabs.indexOf(t)+1)%2];n.focus();setView(n.id.replace('cd-a-tab-',''));}});});
 root.querySelectorAll('.cd-row').forEach(r=>{
  r.querySelector('.cd-row-select').addEventListener('click',()=>select(r.dataset.key,true));
  r.addEventListener('click',e=>{if(e.target.closest('a,button'))return;select(r.dataset.key,true);});
 });
 root.querySelectorAll('.pin').forEach(p=>{const go=()=>select(p.dataset.key,false);p.addEventListener('click',go);p.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});});
 paint();
}

/* 方向 B：卡片加地圖抽屜 */
function renderB(root){
 const mq=window.matchMedia('(max-width:760px)');
 let open=mq.matches?null:CAMPUSES[0].key;
 root.innerHTML=`<div class="container">${heading('從生活圈與接送路線出發，<br>找到適合你與孩子的常春藤。')}<div class="cd-cards">${CAMPUSES.map((c,i)=>`<article class="cd-card" data-key="${c.key}" style="--o:${i*2}"><a class="cd-card-pic" href="${pageLink(c)}" aria-label="認識${esc(c.name)}">${img(c)}</a><span class="cd-region">高雄 · ${c.district}</span><h3><a href="${pageLink(c)}">${c.name}</a></h3><p class="cd-addr">${c.address}</p><div class="cd-card-actions"><a class="cd-phone-link" href="tel:${c.phone}">${icon('phone')}${c.phone}</a><div class="cd-social">${socialIcons(c)}<button type="button" class="cd-iconbtn map" aria-expanded="false" aria-controls="cd-b-drawer" aria-label="顯示${esc(c.name)}地圖" title="地圖與路線">${icon('map-pin')}</button><a class="cd-more" href="${pageLink(c)}">認識校區</a></div></div></article>`).join('')}<div class="cd-drawer" id="cd-b-drawer" hidden></div></div></div>`;
 const drawer=root.querySelector('#cd-b-drawer');
 function paint(){
  root.querySelectorAll('.cd-card').forEach(card=>{const on=card.dataset.key===open;card.classList.toggle('is-active',on);card.querySelector('.cd-iconbtn.map').setAttribute('aria-expanded',String(on));});
  if(!open){drawer.hidden=true;drawer.innerHTML='';return;}
  const c=CAMPUSES.find(x=>x.key===open); const i=CAMPUSES.indexOf(c);
  drawer.style.setProperty('--o',i*2+1);
  drawer.innerHTML=`<div class="cd-drawer-info"><header><h3>${c.name}<span class="cd-region">高雄 · ${c.district}</span></h3><button type="button" class="cd-drawer-close" aria-label="收合地圖">${icon('x')}</button></header><dl><dt>${icon('map-pin')}所在地</dt><dd>${c.address}</dd><dt>${icon('phone')}參觀專線</dt><dd><a href="tel:${c.phone}">${c.phone}</a></dd></dl><div class="cd-pills">${socialPills(c)}</div><div class="cd-cta"><a class="button yellow" href="${bookLink(c)}">${icon('calendar-check')}預約參觀${c.name}</a><a class="cd-more" href="${pageLink(c)}">認識校區</a></div></div>${mapFrame(c,'cd-drawer-map')}`;
  drawer.hidden=false;armFrames(drawer);
  drawer.querySelector('.cd-drawer-close').addEventListener('click',()=>{const btn=root.querySelector(`.cd-card[data-key="${open}"] .cd-iconbtn.map`);open=null;paint();btn&&btn.focus();});
 }
 root.querySelectorAll('.cd-iconbtn.map').forEach(b=>b.addEventListener('click',()=>{const key=b.closest('.cd-card').dataset.key;open=open===key?null:key;paint();if(open&&!mq.matches)drawer.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion:no-preference)').matches?'smooth':'auto'});}));
 paint();
}

/* 方向 C：校區分頁 */
function renderC(root){
 let active=CAMPUSES[0].key;
 root.innerHTML=`<div class="container">${heading('一次看一所校園：<br>位置、聯絡方式與 LINE、Facebook。')}<div class="cd-tabs" role="tablist" aria-label="選擇校區">${CAMPUSES.map((c,i)=>`<button type="button" class="cd-tab" role="tab" id="cd-c-tab-${c.key}" aria-selected="${i===0}" aria-controls="cd-c-panel" tabindex="${i===0?0:-1}" data-key="${c.key}"><strong>${c.name}</strong><small>高雄 · ${c.district}</small></button>`).join('')}</div><div class="cd-panel" id="cd-c-panel" role="tabpanel" aria-labelledby="cd-c-tab-${active}"></div></div>`;
 const panel=root.querySelector('#cd-c-panel'), tabs=[...root.querySelectorAll('.cd-tab')];
 function paint(){
  const c=CAMPUSES.find(x=>x.key===active);
  tabs.forEach(t=>{const on=t.dataset.key===active;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;});
  panel.setAttribute('aria-labelledby','cd-c-tab-'+active);
  panel.innerHTML=`<div class="cd-panel-photo">${img(c)}<span>${c.name} · 官方校園照片</span></div><div class="cd-panel-info"><h3>${c.name}</h3><p class="cd-intro-line">${c.intro}</p><dl><dt>${icon('map-pin')}所在地</dt><dd>${c.address}</dd><dt>${icon('phone')}參觀專線</dt><dd><a href="tel:${c.phone}">${c.phone}</a></dd></dl><div class="cd-panel-cta"><a class="button yellow" href="${bookLink(c)}">${icon('calendar-check')}預約參觀</a><a class="cd-more" href="${pageLink(c)}">認識${c.name}</a></div><div class="cd-panel-social">${socialPills(c)}</div></div>${mapFrame(c,'cd-panel-map')}`;
  armFrames(panel);
 }
 tabs.forEach(t=>{
  t.addEventListener('click',()=>{active=t.dataset.key;paint();});
  t.addEventListener('keydown',e=>{const i=tabs.indexOf(t);let n=null;
   if(e.key==='ArrowRight')n=tabs[(i+1)%tabs.length];else if(e.key==='ArrowLeft')n=tabs[(i-1+tabs.length)%tabs.length];else if(e.key==='Home')n=tabs[0];else if(e.key==='End')n=tabs[tabs.length-1];
   if(n){e.preventDefault();n.focus();active=n.dataset.key;paint();}});
 });
 paint();
}

sprite();
const only=new URLSearchParams(location.search).get('only');
if(only){document.body.classList.add('is-embed');document.querySelectorAll('[data-direction]').forEach(s=>{if(s.dataset.direction!==only)s.remove();});}
const map={a:renderA,b:renderB,c:renderC};
document.querySelectorAll('[data-direction]').forEach(s=>map[s.dataset.direction](s));
window.CD={CAMPUSES};
})();
