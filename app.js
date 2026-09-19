'use strict';
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
// 預覽用：index.html?hero=quiet#/home 看首屏完全沒有字的樣子（只留頁首與影片控制鈕）。
if (new URLSearchParams(location.search).get('hero') === 'quiet') document.documentElement.classList.add('hero-quiet');
// 預覽用：index.html?pill=split#/home 看離開首屏後的膠囊放在別的位置（center／left／right／split）。
{const place=new URLSearchParams(location.search).get('pill');if(['center','left','right','split','split-mini','side','edge','dock','bare'].includes(place))document.documentElement.dataset.pill=place;}
// 預覽用：index.html?autohide=1#/home 讓膠囊在向下捲時收起、向上捲時出現。
const AUTOHIDE = new URLSearchParams(location.search).get('autohide') === '1';
// 預覽用：index.html?seam=1#/home 讓「關於常春藤」與「常春藤的一天」的大字在接縫處接成同一欄（關於區塊直接捲走，不再用簾幕擦掉）；
// ?seam=2 保留簾幕，但浮水印的「常春藤」對準大標的「常春藤」，擦過去時兩個字疊成一個。
// 2026-09-18 定案：預設走 2（含接力效果）；?seam=0 看舊的簾幕、?seam=1 看同欄版；?study=1 顯示接力效果開關面板。
const SEAM = (()=>{const v=new URLSearchParams(location.search).get('seam');return ['0','1','2'].includes(v)?v:'2';})();
if (SEAM!=='0') document.documentElement.dataset.seam = SEAM;
// 定案只留「的一天」接力進場；幽靈「關於」與金線留在 ?study=1 面板可比較。
if (SEAM==='2') document.documentElement.classList.add('relay-day');
// 園方廣告片剪出的校園片段（design/hero-video/build.sh）。
const HERO_VIDEO_SRC = 'assets/hero-campus.mp4';
// 孩子的一天背景：義華遊藝表演 25 秒循環（design/day-timeline-mockup/README.md）。
const DAY_FILM = 'assets/day-film.mp4';
const DAY_FILM_MOBILE = 'assets/day-film-mobile.mp4';
// 常春藤機構粉絲專頁：明華／崇德／國際／仁武四校的 Facebook 暫時指向這裡，LINE 官方帳號待園方提供（不用義華帳號冒充）。
const ORG_FACEBOOK = 'https://www.facebook.com/ivykid';
const campuses = {
 yihua:{name:'義華校',district:'三民區',address:'高雄市三民區義華路68號',phone:'07-392-8366',image:'yihua-exterior',panoramaPos:'center 12%',photoPos:'85% center',heroPhotoPos:'85% 8%',intro:'在義華路上，走進孩子的日常。',description:'從戶外廣場、綠色園藝到共創教室，認識孩子每天活動、探索與學習的空間。義華校重視愛與關懷、閱讀素養與生活自理，陪伴孩子練習與世界相處。',line:'https://lin.ee/gwl8fnA',facebook:'https://www.facebook.com/ivy.kids.fb/',fbNote:'義華校粉絲專頁'},
 minghua:{name:'明華校',district:'左營區',address:'高雄市左營區明華一路176號',phone:'07-556-6796',image:'minghua',intro:'在明華一路，認識我們的校園。',description:'明華校位於高雄市左營區明華一路。先從校園外觀與所在位置認識學校，再安排一次參觀，親自了解孩子的學習環境與接送動線。',line:null,facebook:ORG_FACEBOOK,fbNote:'常春藤機構粉絲專頁（明華校粉專待補）'},
 chongde:{name:'崇德校',district:'左營區',address:'高雄市左營區崇德路87號',phone:'07-341-6286',image:'chongde',intro:'從崇德路，開始一段校園探索。',description:'崇德校位於高雄市左營區崇德路。歡迎預約到園，看看校園空間，也與園所聊聊孩子的需要、生活安排與入學準備。',line:null,facebook:ORG_FACEBOOK,fbNote:'常春藤機構粉絲專頁（崇德校粉專待補）'},
 international:{name:'國際校',district:'鳥松區',address:'高雄市鳥松區球場路59號',phone:'07-370-8001',image:'international',photoPos:'48% center',intro:'走進鳥松，認識國際校。',description:'國際校位於高雄市鳥松區球場路。透過實際走訪了解校園環境與接送路線，並向園所確認適合孩子的課程與入學安排。',line:null,facebook:ORG_FACEBOOK,fbNote:'常春藤機構粉絲專頁（國際校粉專待補）'},
 renwu:{name:'仁武校',district:'仁武區',address:'高雄市仁武區京吉一路102號',phone:'07-375-7081',image:'renwu',intro:'在仁武，遇見下一段成長。',description:'仁武校位於高雄市仁武區京吉一路。歡迎帶著對孩子成長的期待來認識校園，參觀時也可以與園所討論課程、生活照顧與接送安排。',line:null,facebook:ORG_FACEBOOK,fbNote:'常春藤機構粉絲專頁（仁武校粉專待補）'}
};
const main = document.querySelector('#main');
const nav = document.querySelector('#navigation');
const menu = document.querySelector('#menu-toggle');
const header = document.querySelector('.header');
// 首頁往下捲第一步就把頁首收成膠囊；頁首底色用同一個門檻，免得先變米白再收成膠囊。
const COMPACT_AT = 40;
const updateHeader = () => header.classList.toggle('is-scrolled', window.scrollY > COMPACT_AT);
window.addEventListener('scroll', updateHeader, {passive:true});
updateHeader();
const esc = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const photoSrc = name=>'assets/'+name+'.webp';
const campusArtSrc = key=>photoSrc('campus-line-art-'+key);
const campusArtwork = key=>`<div class="campus-artwork" aria-hidden="true"><img class="campus-art-building" src="${campusArtSrc(key)}" alt="" loading="lazy" decoding="async"></div>`;
const img = (name,alt,cls='',eager=false,priority=false)=>`<img class="${cls}" src="${photoSrc(name)}" alt="${esc(alt)}" loading="${eager?'eager':'lazy'}"${priority?' fetchpriority="high"':''} decoding="async">`;
const mapURL = c=>'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(c.address);
// 免金鑰的單一地點嵌入；五校同框需要園方另建 Google 我的地圖或申請 Maps API 金鑰（見 design/campus-directions/README.md）。
const embedURL = c=>'https://www.google.com/maps?q='+encodeURIComponent(c.address)+'&z=16&hl=zh-TW&output=embed';
const dirURL = c=>'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(c.address);
const bookingLink = key=>'#/visit'+(key?'/'+key:'');
const icon = name=>`<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
const arrow = icon('arrow-up-right');
const external = 'target="_blank" rel="noopener noreferrer"';
// Google 地圖 embed 載入時會把焦點移進地圖，畫面外載入會把整頁捲走；iframe 進到視口附近才補上 src。
const mapFrameObserver = new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){const f=e.target;f.src=f.dataset.src;mapFrameObserver.unobserve(f);}});},{rootMargin:'160px 0px'});
const armMapFrames = scope=>scope.querySelectorAll('iframe[data-src]:not([src])').forEach(f=>mapFrameObserver.observe(f));
// LINE／Facebook 文字連結：品牌原色圖示＋標籤＋外連 ↗。沒有 LINE 帳號的校區顯示「待園方提供」，不用其他校區帳號冒充。
const campusLinks = c=>{
 const line=c.line?`<a class="campus-link line" href="${c.line}" ${external}><span class="campus-link-badge">${icon('line')}</span><span class="campus-link-text"><span class="campus-link-title">加 LINE 好友${arrow}</span><small>${c.name}官方帳號</small></span></a>`
  :`<span class="campus-link line is-pending"><span class="campus-link-badge">${icon('line')}</span><span class="campus-link-text"><span class="campus-link-title">LINE 官方帳號</span><small>${c.name}帳號待園方提供</small></span></span>`;
 const fb=`<a class="campus-link facebook" href="${c.facebook}" ${external}><span class="campus-link-badge">${icon('facebook')}</span><span class="campus-link-text"><span class="campus-link-title">Facebook 粉絲專頁${arrow}</span><small>${esc(c.fbNote)}</small></span></a>`;
 return `<div class="campus-links">${line}${fb}</div>`;
};
const campusMapFrame = (c,cls='')=>`<div class="map-embed ${cls}"><iframe title="${c.name} Google 地圖" data-src="${embedURL(c)}" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe><a class="map-embed-link" href="${dirURL(c)}" ${external}>${icon('navigation-arrow')}規劃路線 ${arrow}</a></div>`;
let currentPage='';
let lastPhotoTrigger=null;
let routeVersion=0;
let disposeMedia=()=>{};
function banner(key='') {return `<section class="visit-banner"><div class="container"><div><span class="eyebrow">預約參觀</span><h2 class="section-title">親自走一趟，感受${key?campuses[key].name:'常春藤'}的日常。</h2><p>帶著孩子，也帶著你想了解的事。我們期待與你相遇。</p></div><a class="button yellow" href="${bookingLink(key)}">預約校園參觀</a></div></section>`;}
function faq(key='') {return `<div class="faq-list"><details><summary>第一次參觀，要怎麼預約？</summary><p>先選擇想參觀的校區，再留下家長稱呼、電話與方便聯絡的時段。這份 prototype 僅示範流程，不會送出資料；實際參觀請直接致電園所。</p></details><details><summary>參觀時可以了解哪些事情？</summary><p>可以詢問校園環境、課程與生活安排、接送方式，以及孩子入學前需要準備的事。各校參觀範圍與接待時間請先向園所確認。</p></details><details><summary>可以查詢招生年齡、名額與費用嗎？</summary><p>招生年齡、名額與費用依校區與學年度而異。請向${key?campuses[key].name:'欲參觀的園所'}確認；這份提案不提供即時招生名額或費用報價。</p></details><details><summary>五所校區的環境與課程都一樣嗎？</summary><p>各校空間與課程安排可能不同。你可以先比較所在地與接送距離，再於參觀時了解該校的實際內容。</p></details></div>`;}
// 時刻取自官網一日流程 https://www.ivykidschool.com/一日流程 ；相片為義華校既有素材，與背景影片非同一天拍攝。
const dayMoments = [
 {key:'hello',time:'08:00',label:'早安入園',tint:'yellow',photo:'day-hello',alt:'孩子在熟悉的環境裡，與身旁的人互動',caption:'陪伴互動 · 入園情境示意',title:'早安，今天的我\n準備好了。',story:'和家人說聲再見，走進熟悉的校園。從整理小書包開始，一點一點，找到自己的步調。',question:'孩子第一次上學，如何陪伴適應？',answer:'參觀時可以與園所聊聊：初次入園的陪伴方式、家長如何與老師聯繫，以及可以事先做哪些準備。'},
 {key:'discover',time:'09:10',label:'好奇探索',tint:'mint',photo:'day-discover',alt:'老師陪伴孩子操作幾何教具',caption:'教具探索 · 義華校影像',title:'我的「為什麼」，\n今天又多了一個。',story:'摸一摸、看一看，再和同伴試一次。那些讓眼睛發亮的小發現，是認識世界的開始。',question:'孩子平常會接觸哪些學習活動？',answer:'可以詢問該校如何安排探索活動、使用哪些教具與素材，以及如何依照年齡和孩子的興趣調整內容。'},
 {key:'lunch',time:'11:40',label:'一起用餐',tint:'peach',photo:'day-lunch',alt:'孩子拿取湯匙與面紙，練習準備餐具',caption:'整理餐具畫面 · 非實際進食',title:'「我自己來！」\n是今天的小進步。',story:'洗洗手、準備用餐，也練習照顧自己。每天重複的小事情，都可以成為成長的練習。',question:'餐點、飲食需求與自理練習怎麼安排？',answer:'參觀時可詢問餐點安排、食物過敏或特殊飲食需求的溝通方式，以及老師如何協助孩子練習用餐。'},
 {key:'rest',time:'12:30',label:'安靜片刻',tint:'cream',photo:'classroom',alt:'義華校明亮的教室空間，作為安靜片刻的空間參考',caption:'教室空間參考 · 午休照片待補',title:'小小的世界，\n也需要休息一下。',story:'把熱鬧的節奏放慢，留一點安靜給自己。休息之後，再帶著精神迎接下午。',question:'孩子睡不著，或有不同的休息需求呢？',answer:'可以向園所了解休息空間與安排，以及孩子尚未習慣午休時，老師會如何陪伴和與家長溝通。'},
 {key:'outside',time:'14:20',label:'午後玩耍',tint:'mint',photo:'day-outside',alt:'孩子在戶外活動，笑著和同伴一起跑動',caption:'戶外活動 · 午後情境示意',title:'和朋友一起，\n把今天玩得好大。',story:'看看植物、動動身體，發現身邊的新鮮事。和同伴一起玩的時候，也在練習分享與表達。',question:'戶外活動與天氣變化如何安排？',answer:'參觀時可詢問戶外活動的空間、陪伴方式，以及下雨或天氣炎熱時，園所如何調整當天的安排。'},
 {key:'home',time:'16:30',label:'帶故事回家',tint:'yellow',photo:'day-home',alt:'孩子專注整理自己的物品，為一天收尾',caption:'整理物品 · 離園情境示意',title:'今天的好多事，\n想第一個告訴你。',story:'帶上書包，也帶上今天的新發現。和家人分享一件開心的小事，讓校園裡的故事繼續走進生活。',question:'接送與家長聯繫，有哪些需要先知道？',answer:'可以詢問園所的接送流程、家長與老師的聯繫方式，以及如何了解孩子在校的生活情況。'}
];
// 大字先留在畫面上，內容靠近時淡成底紋（孩子的一天與關於常春藤共用）。
function fadeBehindContent(content,word,quiet,after){
 let frame=0,stopped=false;
 const paint=()=>{
  frame=0;if(stopped)return;
  const top=content.getBoundingClientRect().top,from=innerHeight*.62,to=innerHeight*.25;
  const progress=Math.min(1,Math.max(0,(from-top)/(from-to)));
  word.style.setProperty('--word-fade',(1-progress*(1-quiet)).toFixed(3));
  if(after)after();
 };
 const schedule=()=>{if(!frame&&!stopped)frame=requestAnimationFrame(paint);};
 addEventListener('scroll',schedule,{passive:true});
 addEventListener('resize',schedule,{passive:true});
 paint();
 return ()=>{
  stopped=true;cancelAnimationFrame(frame);
  removeEventListener('scroll',schedule);removeEventListener('resize',schedule);
 };
}
function dayExperience(){
 const prints=dayMoments.map((m,i)=>{
  const kicker=`${String(i+1).padStart(2,'0')} / ${m.label}`;
  return `<li class="day-print tint-${m.tint}" id="day-${m.key}"><div class="print-card"><span class="print-tape" aria-hidden="true"></span><div class="print-wrap"><div class="print"><div class="print-face print-front"><figure class="print-figure"><img class="print-photo" src="${photoSrc(m.photo)}" alt="${esc(m.alt)}" loading="lazy" decoding="async"><figcaption>${m.caption}</figcaption><time class="print-stamp" datetime="${m.time}">${m.time}</time></figure><div class="print-foot"><p class="print-kicker">${kicker}</p><h3>${m.title.split('\n').join('<br>')}</h3></div></div><div class="print-face print-back" id="day-story-${m.key}"><p class="print-kicker">${kicker}</p><p class="print-story">${m.story}</p><div class="print-ask"><p class="print-question">${m.question}</p><p class="print-answer">${m.answer}</p></div></div></div><button class="print-flip" type="button" aria-expanded="false" aria-controls="day-story-${m.key}"><span class="print-flip-label">翻到背面</span><span class="print-flip-mark" aria-hidden="true">↻</span></button></div></div></li>`;
 }).join('');
 return `<section class="section day-experience" id="life" aria-labelledby="day-heading"><div class="day-film" aria-hidden="true"><img class="day-film-poster" src="${photoSrc('day-poster')}" alt="" decoding="async"><video class="day-film-video" muted loop playsinline preload="none"></video><span class="day-film-shade"></span></div><div class="day-film-ui"><p class="day-film-caption"><span>義華校 · 遊藝表演</span><span lang="en">LITTLE MOMENTS, BIG GROWTH.</span></p><button class="day-film-toggle" type="button" aria-pressed="false" hidden><span class="day-film-mark" aria-hidden="true">▶</span><span class="day-film-state">播放背景</span></button></div><div class="day-stage"><header class="day-intro"><span class="day-ghost" aria-hidden="true">關於</span><span class="eyebrow">孩子的一天<span lang="en">A DAY AT IVY</span></span><h2 class="day-title" id="day-heading"><span class="t-ivy">常春藤</span><span class="t-day">的一天</span></h2></header><ol class="day-prints" aria-label="孩子的一天，${dayMoments.length} 個日常片刻">${prints}</ol><p class="day-note">日常情境提案，以義華校素材呈現；時刻取自官網一日流程，各校、各班實際安排請向園所確認。背景取自義華遊藝表演紀錄，與相片非同一天拍攝。</p></div></section>`;
}
let disposeDay=()=>{};
function setupDayExperience(){
 const section=document.querySelector('.day-experience');if(!section)return;
 const intro=section.querySelector('.day-intro'),list=section.querySelector('.day-prints');
 const prints=[...section.querySelectorAll('.day-print')];
 const reduce=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(hover: hover) and (pointer: fine)');
 let disposed=false;
 // 標出讀者停在哪一段，讓那張相片的時間戳再亮一階。
 const markActive=()=>{
  if(disposed)return;
  const line=innerHeight*.55;let active=-1;
  prints.forEach((print,i)=>{if(print.getBoundingClientRect().top<=line)active=i;});
  prints.forEach((print,i)=>print.classList.toggle('is-active',i===active));
 };
 const stopFade=fadeBehindContent(list,intro,.16,markActive);
 // 相片進入視窗才開始顯影，像剛拍好的拍立得。
 const developing=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-revealed');developing.unobserve(entry.target);}});},{threshold:.15});
 prints.forEach(print=>{
  developing.observe(print);
  const wrap=print.querySelector('.print-wrap'),card=print.querySelector('.print');
  const button=print.querySelector('.print-flip'),front=print.querySelector('.print-front'),back=print.querySelector('.print-back');
  const setFlip=open=>{
   wrap.classList.toggle('is-flipped',open);
   button.setAttribute('aria-expanded',String(open));
   button.querySelector('.print-flip-label').textContent=open?'翻回正面':'翻到背面';
   front.inert=open;back.inert=!open;
  };
  setFlip(false);
  button.addEventListener('click',()=>setFlip(!wrap.classList.contains('is-flipped')));
  // 整張相片都能翻，但讓相片裡的連結與按鈕照常運作。
  wrap.addEventListener('click',event=>{if(!event.target.closest('a,button'))button.click();});
  let tilt=0,point=null;
  const applyTilt=()=>{
   tilt=0;if(disposed||!point)return;
   const box=wrap.getBoundingClientRect();
   const x=(point.x-box.left)/box.width,y=(point.y-box.top)/box.height;
   card.style.setProperty('--ry',`${((x-.5)*14).toFixed(2)}deg`);
   card.style.setProperty('--rx',`${((.5-y)*10).toFixed(2)}deg`);
   card.style.setProperty('--gx',`${(x*100).toFixed(1)}%`);
   card.style.setProperty('--gy',`${(y*100).toFixed(1)}%`);
   card.style.setProperty('--glare','1');
  };
  wrap.addEventListener('pointermove',event=>{
   if(!fine.matches||reduce.matches)return;
   point={x:event.clientX,y:event.clientY};wrap.classList.add('is-tilting');
   if(!tilt)tilt=requestAnimationFrame(applyTilt);
  });
  wrap.addEventListener('pointerleave',()=>{
   point=null;cancelAnimationFrame(tilt);tilt=0;wrap.classList.remove('is-tilting');
   ['--rx','--ry','--glare'].forEach(name=>card.style.removeProperty(name));
  });
 });
 // 背景影片：進入區塊才載入，離開畫面或切換頁籤就暫停。
 const video=section.querySelector('.day-film-video'),toggle=section.querySelector('.day-film-toggle');
 let wants=!reduce.matches,onScreen=false,failed=false;
 const syncFilm=()=>{
  const playing=!video.paused&&!failed;
  toggle.setAttribute('aria-pressed',String(playing));
  toggle.querySelector('.day-film-mark').textContent=playing?'❙❙':'▶';
  toggle.querySelector('.day-film-state').textContent=playing?'暫停背景':'播放背景';
 };
 const applyFilm=()=>{
  if(disposed||failed)return;
  if(!onScreen||!wants||document.hidden){video.pause();syncFilm();return;}
  if(!video.getAttribute('src'))video.src=matchMedia('(max-width: 760px)').matches?DAY_FILM_MOBILE:DAY_FILM;
  video.play().then(()=>{
   // 播放請求進行中時，讀者可能已經捲離或切走頁籤。
   if(disposed||!wants||!onScreen||document.hidden)video.pause();
   syncFilm();
  }).catch(syncFilm);
 };
 video.addEventListener('playing',()=>{video.classList.add('is-ready');syncFilm();});
 video.addEventListener('pause',syncFilm);
 video.addEventListener('error',()=>{failed=true;video.classList.remove('is-ready');toggle.hidden=true;});
 toggle.hidden=false;toggle.addEventListener('click',()=>{wants=video.paused;applyFilm();});
 syncFilm();
 const watching=new IntersectionObserver(entries=>{onScreen=entries[0].isIntersecting;applyFilm();},{threshold:0});
 watching.observe(section);
 const onMotion=()=>{if(reduce.matches){wants=false;applyFilm();}};
 document.addEventListener('visibilitychange',applyFilm);
 reduce.addEventListener('change',onMotion);
 disposeDay=()=>{
  disposed=true;stopFade();
  document.removeEventListener('visibilitychange',applyFilm);
  reduce.removeEventListener('change',onMotion);
  developing.disconnect();watching.disconnect();
  video.pause();video.removeAttribute('src');video.load();
  disposeDay=()=>{};
 };
}

// A 版最新消息；文案、日期與活動均為原型示意，圖片經 photoSrc 支援單檔預覽。
const homepageNews = (() => {
 const articles = [
  {id:'garden',date:'2026-09-16',campus:'義華校',category:'校園日常',title:'小小園丁，把好奇心種進生活裡。',description:'從翻土、澆水到觀察新芽，陪孩子發現一片葉子裡的大世界。',image:'garden',alt:'既有校園果樹情境照片'},
  {id:'learning',date:'2026-09-12',campus:'義華校',category:'學習紀錄',title:'動手試試看，讓每個想法都有形狀。',description:'在創作與探索之間，看見孩子專注的眼神，也聽見他們自己的答案。',image:'learning',alt:'既有義華校學習活動情境照片'},
  {id:'renwu',date:'2026-09-10',campus:'仁武校',category:'分校消息',title:'走進仁武校，認識孩子的成長空間。',description:'透過校園圖像，先認識孩子每天生活與探索的地方。',image:'renwu',alt:'仁武校既有校園外觀示意圖'},
  {id:'minghua',date:'2026-09-08',campus:'明華校',category:'分校消息',title:'在明華，打開新學期的日常。',description:'新學期的相遇，從認識教室、老師與身邊的朋友開始。',image:'minghua',alt:'明華校既有校園照片'},
  {id:'chongde',date:'2026-09-05',campus:'崇德校',category:'分校消息',title:'一起認識崇德校的每個小角落。',description:'從一扇窗、一條走廊開始，慢慢熟悉每天探索的校園。',image:'chongde',alt:'崇德校既有校園照片'},
  {id:'international',date:'2026-09-03',campus:'國際校',category:'分校消息',title:'新朋友、新發現，校園生活開始了。',description:'帶著好奇走進校園，在一起生活的過程中，找到自己的步調。',image:'international',alt:'國際校既有校園照片'}
 ];
 const events = [
  {id:'visit',date:'2026-09-26',month:'SEP',campus:'全校',title:'秋季校園開放日',description:'和孩子一起，來看看未來的日常。'},
  {id:'family',date:'2026-10-03',month:'OCT',campus:'義華校',title:'親子共讀・故事的午後',description:'一本繪本，開啟一段親子對話。'},
  {id:'outdoor',date:'2026-10-17',month:'OCT',campus:'全校',title:'一起出發！親子探索日',description:'在戶外發現身邊的小驚喜。'}
 ];
 const arrow = '<span class="hn-arrow" aria-hidden="true">↗</span>';
 const picture = item => `<img src="${photoSrc(item.image)}" width="720" height="465" alt="${item.alt}" loading="lazy">`;
 const metadata = item => `<span class="hn-meta"><span>${item.campus}</span><time datetime="${item.date}">${item.date.replaceAll('-','.')}</time></span>`;
 const more = (type,label) => `<button type="button" class="hn-more" data-news-list="${type}" aria-haspopup="dialog">${label}${arrow}</button>`;
 const eventCard = item => `<button type="button" class="hn-event" data-news-event="${item.id}" aria-haspopup="dialog"><time class="hn-date" datetime="${item.date}" aria-label="${item.date}"><b>${item.date.slice(-2)}</b><span lang="en">${item.month}</span></time><span class="hn-event-copy"><small>${item.campus}</small><strong>${item.title}</strong></span>${arrow}</button>`;
 const newsCard = item => `<article class="hn-card">${picture(item)}<div class="hn-card-copy">${metadata(item)}<h3><button type="button" data-news-article="${item.id}" aria-haspopup="dialog">${item.title}</button></h3></div></article>`;
 let modal, content, lastTrigger, view = '';
 function section() {
  return `<section id="latest-news" class="home-news" aria-labelledby="latest-news-heading"><div class="container"><div class="hn-layout"><aside class="hn-events" aria-labelledby="upcoming-events-heading"><div class="hn-head"><span class="hn-kicker" lang="en">UPCOMING EVENTS</span><h2 id="upcoming-events-heading">近期活動</h2></div><div class="hn-event-stack">${events.map(eventCard).join('')}</div>${more('events','所有活動')}</aside><div class="hn-news"><div class="hn-head hn-news-head"><div><span class="hn-kicker" lang="en">LATEST NEWS</span><h2 id="latest-news-heading">最新消息</h2></div>${more('articles','所有最新消息')}</div><div class="hn-cards">${articles.slice(0,3).map(newsCard).join('')}</div></div></div><p class="hn-sample-note">設計示意｜消息與活動日期均為範例，圖像取自既有校園素材，非上述消息實拍。</p></div></section>`;
 }
 function show(markup, nextView) {
  const wasOpen = modal.open;
  content.innerHTML = markup;
  view = nextView;
  if (!wasOpen) modal.showModal();
  else content.querySelector('#home-news-dialog-title').focus({preventScroll:true});
  modal.scrollTop = 0;
 }
 function showList(type) {
  const isEvent = type === 'events';
  const rows = articles.map(item => `<button type="button" class="hn-list-row" data-news-article="${item.id}">${picture(item)}<span class="hn-list-copy">${metadata(item)}<strong>${item.title}</strong><span class="hn-category">${item.category}</span></span>${arrow}</button>`).join('');
  show(`<h2 id="home-news-dialog-title" tabindex="-1">${isEvent?'近期活動':'所有最新消息'}</h2><p class="hn-dialog-note">以下為設計示意內容。</p><div class="${isEvent?'hn-event-stack':'hn-list'}">${isEvent?events.map(eventCard).join(''):rows}</div>`,type);
 }
 function showDetail(item, type) {
  const isEvent = type === 'events';
  const back = view === type ? `<button type="button" class="hn-more hn-back" data-news-list="${type}">← 返回${isEvent?'活動':'消息'}清單</button>` : '';
  show(`${back}<span class="hn-kicker">${item.campus} · ${isEvent?'活動示意':item.category}</span><h2 id="home-news-dialog-title" tabindex="-1">${item.title}</h2>${isEvent?`<time class="hn-detail-date" datetime="${item.date}">${item.date.replaceAll('-','.')}</time>`:metadata(item)+picture(item)}<p class="hn-detail-copy">${item.description}</p><p class="hn-dialog-note">${isEvent?'這是示意活動，並非已公告的活動或開放報名。正式內容將由園方提供。':'此為閱讀互動示範，標題、日期與內容皆為範例；圖片使用既有校園素材。'}</p>`,isEvent?'event':'article');
 }
 function init() {
  if (modal) return;
  modal = document.createElement('dialog');
  modal.id = 'home-news-dialog';
  modal.className = 'hn-dialog';
  modal.setAttribute('aria-labelledby','home-news-dialog-title');
  modal.innerHTML = '<div class="hn-dialog-top"><span>常春藤 · 校園消息</span><button type="button" data-news-close aria-label="關閉消息" autofocus>關閉 ×</button></div><div class="hn-dialog-body"></div>';
  document.body.append(modal);
  content = modal.querySelector('.hn-dialog-body');
  modal.querySelector('[data-news-close]').addEventListener('click',close);
  modal.addEventListener('close',()=>{view='';if(lastTrigger?.isConnected)lastTrigger.focus({preventScroll:true});lastTrigger=null;});
  modal.addEventListener('click',e=>{if(e.target!==modal)return;const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();});
  document.addEventListener('click',e=>{
   const trigger=e.target.closest('[data-news-article],[data-news-event],[data-news-list]');
   if(!trigger||!trigger.closest('.home-news,#home-news-dialog'))return;
   if(!modal.open)lastTrigger=trigger;
   if(trigger.dataset.newsList){showList(trigger.dataset.newsList);return;}
   const isEvent=Boolean(trigger.dataset.newsEvent);
   const item=(isEvent?events:articles).find(item=>item.id===(isEvent?trigger.dataset.newsEvent:trigger.dataset.newsArticle));
   if(item)showDetail(item,isEvent?'events':'articles');
  });
 }
 function close() {if(modal?.open)modal.close();}
 return {section,init,close};
})();

function home(){return `
<div class="home-reveal"><div class="home-reveal-track">
<section class="studio-hero" aria-labelledby="home-title"><div class="container studio-hero-grid">
 <div class="studio-hero-copy"><span class="eyebrow">常春藤幼兒園 · 高雄五校</span><h1 id="home-title">在常春藤<span class="punct">，</span><br>每一天都有<span class="hero-title-ending"><span class="growing-word">新發現<svg aria-hidden="true" viewBox="0 0 180 14"><path pathLength="1" d="M3 9Q48 2 92 7T177 6"/></svg></span><span class="punct">。</span></span></h1><p><span class="hero-copy-line">一起讀故事、做作品，也到戶外探索。</span><span class="hero-copy-line">在老師的陪伴下，動手試試，<span class="hero-copy-phrase">說出自己的想法。</span></span></p><div class="studio-actions"><a class="button ghost" href="#/home/life">看看孩子的一天</a></div></div>
 <figure class="studio-hero-image">${img('hero-campus-still','常春藤的孩子在戶外草地上奔跑、微笑的校園影片畫面','',true,true)}<video id="hero-video" muted loop playsinline preload="none" poster="assets/hero-campus-still.webp" aria-hidden="true" hidden></video></figure>
 </div><div class="container studio-media"><div id="video-controls" hidden><button type="button" id="video-play" aria-controls="hero-video"><span class="sr-only">播放影片</span></button></div></div></section></div>
<div class="belief-reveal"><div class="belief-reveal-track">
<section class="section studio-about home-belief" id="about" aria-labelledby="about-title">
 <div class="belief-backdrop" aria-hidden="true"><div class="container belief-backdrop-inner"><div class="belief-watermark"><span class="wm-a">關於</span><br><span class="wm-b">常春藤</span></div></div></div>
 <div class="container belief-content">
  <div class="belief-layout">
   <div class="belief-main"><p class="belief-since" lang="en">SINCE 1997</p><h2 id="about-title">把每個孩子，<br>放在心上。</h2>
    <p class="belief-text">自 1997 年在高雄創立，常春藤以專業保育與溫暖陪伴，為孩子打造安全、安心的成長環境。近三十年來，我們始終相信，幼兒園不只是上學的地方，更是孩子第一次離開家、認識世界的起點。因此，我們的課程從孩子的興趣與生活出發，讓他們在遊戲、繪本、藝術與戶外觀察中提問、動手嘗試，也在相處中練習合作與關懷；老師細心觀察、適時引導，尊重每個孩子不同的步調，陪伴他們學會照顧自己、理解他人。美語同樣融入每一天，從早晨問候、歌謠繪本到點心時間與遊戲對話，孩子在自然的互動裡聽、說、玩，先喜歡上這個語言，再慢慢累積開口的自信。我們希望每個孩子離開常春藤時，都帶著充滿好奇、值得珍藏的童年，以及面對世界的勇氣。</p>
   </div>
   <figure class="belief-photo-pair">${img('about-curious','孩子在教室裡開心地指向自己的發現','belief-portrait')}${img('learning','孩子們一起趴在地上觀察與探索','belief-moment')}<figcaption>把日常，變成值得記住的童年。</figcaption></figure>
  </div>
 </div>
</section></div>
<div class="day-reveal"><div class="day-reveal-track">${dayExperience()}</div>
${campusBoardSection()}</div>
</div></div>
${homepageNews.section()}
`;}
// This is a flat-photo tour. Real 360 media can be supplied separately later.
const tourScenes = [
 {key:'courtyard',name:'戶外廣場',image:'campus',intro:'先從廣場開始，看看孩子每天活動的地方。',spots:[
  {name:'戶外活動空間',x:68,y:72,text:'從照片可以看見校舍圍繞的戶外廣場。開闊的地面與周邊空間，是認識校園環境的第一個視角。',question:'可以詢問戶外活動時段、陪伴方式，以及雨天的替代安排。'},
  {name:'遊戲設施',x:12,y:51,text:'照片左側可看見溜滑梯與遊戲設施。放大照片，看看設施與周邊活動空間的配置。',question:'參觀時可以了解設施適用年齡、使用方式與日常維護。'},
  {name:'校舍與走廊',x:66,y:26,text:'廣場周圍是校舍與走廊。從這個視角，可以先認識室內外空間的關係。',question:'教室配置、孩子移動路線與接送出入口，請向園所確認。'}]},
 {key:'garden',name:'綠色園藝',image:'garden',intro:'靠近一點，看看校園裡的自然細節。',spots:[
  {name:'觀察果實',x:52,y:62,text:'義華校官網的園藝照片記錄了枝葉間的果實。從顏色、形狀與大小開始，看看自然裡的小細節。',question:'可以詢問孩子接觸植物時的活動內容與陪伴方式。'},
  {name:'葉片與枝條',x:29,y:35,text:'綠葉、枝條與果實相互交錯。放大照片，可以看見平常容易忽略的葉片紋理。',question:'參觀時可以了解植物照顧、觀察或種植活動如何安排。'}]},
 {key:'classroom',name:'共創教室',image:'classroom',intro:'走進教室，認識孩子創作與學習的空間。',spots:[
  {name:'桌椅與共作空間',x:63,y:66,text:'教室照片中可以看見成排的桌椅與活動空間。這個視角呈現室內學習環境的配置。',question:'可以向園所了解分組方式，以及如何配合活動調整桌椅。'},
  {name:'材料收納',x:22,y:51,text:'照片左側的櫃架放置了多種材料。透過收納區，可以先認識教室內的素材與空間安排。',question:'參觀時可以詢問材料使用、收拾習慣與生活自理的練習。'},
  {name:'展示與教學區',x:45,y:44,text:'教室前方可見黑板與展示區。搭配完整照片，一起看看不同區域如何分布。',question:'各年齡層的教室與學習安排，請向園所確認。'}]}
];
function scenesFor(key){if(key==='yihua')return tourScenes;const c=campuses[key];return [{key:'exterior',name:'校園外觀',image:c.image,intro:`先從外觀與位置，認識${c.name}。`,spots:[{name:`認識${c.name}`,x:50,y:48,text:`${c.name}位於${c.address}。這張照片取自常春藤機構官網，歡迎放大觀察校園外觀。`,question:'室內環境、參觀動線與接送安排，可直接向園所詢問。'}]}];}
function campusTour(key,homePreview=false){const c=campuses[key],scenes=scenesFor(key);return `<section class="section tour-section" id="${homePreview?'campus-tour':'environment'}" aria-labelledby="tour-heading"><div class="container"><div class="section-heading"><div><span class="eyebrow">校園探索</span><h2 class="section-title" id="tour-heading">先走進校園，<br>再想像孩子的日常。</h2></div><p>點一下照片上的標記，<br>從你最感興趣的地方開始。</p></div><div class="tour-explorer" data-tour-campus="${key}"><div class="tour-toolbar"><div class="tour-location"><span class="tour-location-dot" aria-hidden="true"></span><strong>${c.name}</strong><span>照片探索</span></div><button type="button" class="tour-expand">${icon('arrows-out')}展開檢視</button></div><div class="tour-layout"><div class="tour-visual"><div class="tour-photo-area" role="group" tabindex="0" aria-label="校園照片，放大後可以使用方向鍵移動"><div class="tour-canvas"></div></div><div class="tour-image-tools"><p class="tour-image-help">點選標記，認識這個空間</p><div class="tour-zoom"><button type="button" data-tour-zoom="out" aria-label="縮小照片">${icon('minus')}</button><output class="tour-zoom-value" aria-label="照片縮放比例">100%</output><button type="button" data-tour-zoom="in" aria-label="放大照片">${icon('plus')}</button><button type="button" data-tour-zoom="reset">${icon('arrow-counter-clockwise')}重設</button></div></div><div class="tour-scene-list" role="tablist" aria-label="${c.name}照片場景">${scenes.map((scene,i)=>`<button type="button" class="tour-scene" id="tour-scene-${key}-${i}" role="tab" aria-controls="tour-scene-panel" aria-selected="${i===0}" tabindex="${i===0?0:-1}" data-tour-scene="${i}">${img(scene.image,'')}<span>${scene.name}</span></button>`).join('')}</div></div><div class="tour-detail" id="tour-scene-panel" role="tabpanel" aria-labelledby="tour-scene-${key}-0" tabindex="0"></div></div><div class="tour-footnote"><span>${homePreview?'本段為義華校實景；各校環境不同。':'照片取自校區官方網站，實際環境請以到園參觀為準。'}</span><a href="${bookingLink(key)}">預約參觀${c.name}</a></div></div>${homePreview?'<div class="tour-more"><a class="text-link" href="#/home/campuses">繼續認識其他校區</a></div>':''}</div></section>`;}
let disposeTour=()=>{};
function setupCampusTour(){
 const root=document.querySelector('.tour-explorer');if(!root)return;
 const key=root.dataset.tourCampus,scenes=scenesFor(key),area=root.querySelector('.tour-photo-area'),canvas=root.querySelector('.tour-canvas'),detail=root.querySelector('.tour-detail');
 const tabs=[...root.querySelectorAll('[data-tour-scene]')],expand=root.querySelector('.tour-expand');
 let sceneIndex=0,spotIndex=0,zoom=1,panX=0,panY=0,drag=null;const originalParent=root.parentNode;const placeholder=document.createComment('tour-position');root.before(placeholder);
 const fullDialog=document.createElement('dialog');fullDialog.className='tour-dialog';fullDialog.setAttribute('aria-label',campuses[key].name+'照片探索');document.body.append(fullDialog);
 function restore(){if(placeholder.isConnected)placeholder.after(root);root.classList.remove('expanded');expand.innerHTML=icon('arrows-out')+'展開檢視';expand.focus({preventScroll:true});transform();}
 fullDialog.addEventListener('close',restore);
 expand.addEventListener('click',()=>{if(fullDialog.open){fullDialog.close();return;}root.classList.add('expanded');expand.innerHTML=icon('x')+'返回頁面';fullDialog.append(root);fullDialog.showModal();zoom=1;panX=panY=0;transform();});
 function transform(){const maxX=area.clientWidth*(zoom-1)/2,maxY=area.clientHeight*(zoom-1)/2;panX=Math.max(-maxX,Math.min(maxX,panX));panY=Math.max(-maxY,Math.min(maxY,panY));canvas.style.transform=`translate(${panX}px,${panY}px) scale(${zoom})`;root.style.setProperty('--tour-pin-scale',String(1/zoom));area.classList.toggle('zoomed',zoom>1);root.querySelector('.tour-zoom-value').textContent=Math.round(zoom*100)+'%';root.querySelector('[data-tour-zoom="out"]').disabled=zoom===1;root.querySelector('[data-tour-zoom="in"]').disabled=zoom===2;root.querySelector('.tour-image-help').textContent=zoom>1?'拖曳照片，或用方向鍵移動':'點選標記，認識這個空間';}
 function selectSpot(index,focusDetail=false){spotIndex=index;const scene=scenes[sceneIndex],spot=scene.spots[index];canvas.querySelectorAll('.tour-pin').forEach((pin,i)=>pin.setAttribute('aria-pressed',String(index===i)));detail.innerHTML=`<div class="tour-detail-kicker"><span>${scene.name}</span><span>${String(index+1).padStart(2,'0')} / ${String(scene.spots.length).padStart(2,'0')}</span></div><h3 class="tour-spot-title" tabindex="-1">${spot.name}</h3><p class="tour-description">${spot.text}</p><div class="tour-observe"><span>到園時，還可以聊聊</span><p>${spot.question}</p></div><div class="tour-points"><span>這張照片裡</span>${scene.spots.map((s,i)=>`<button type="button" data-tour-spot="${i}" aria-pressed="${i===index}"><span>${String(i+1).padStart(2,'0')}</span>${s.name}<span aria-hidden="true">${i===index?'●':'○'}</span></button>`).join('')}</div><p class="tour-photo-credit">${campuses[key].name} · 官方實景照片</p>`;
  if(focusDetail){detail.querySelector('h3').focus({preventScroll:true});if(matchMedia('(max-width: 760px)').matches)detail.scrollIntoView({block:'nearest',behavior:'instant'});}
 }
 function selectScene(index,focusTab=false){sceneIndex=index;spotIndex=0;const scene=scenes[index];zoom=1;panX=panY=0;tabs.forEach((t,i)=>{t.setAttribute('aria-selected',String(i===index));t.tabIndex=i===index?0:-1;});detail.setAttribute('aria-labelledby',tabs[index].id);canvas.innerHTML=`${img(scene.image,campuses[key].name+' · '+scene.name,'tour-image',true)}${scene.spots.map((s,i)=>`<button type="button" class="tour-pin" style="left:${s.x}%;top:${s.y}%" data-tour-pin="${i}" aria-label="${i+1}：${s.name}" aria-pressed="${i===0}" aria-controls="tour-scene-panel"><span>${i+1}</span><span class="tour-pin-label">${s.name}</span></button>`).join('')}`;const photo=canvas.querySelector('img');photo.draggable=false;const fit=()=>{if(photo.naturalWidth){canvas.style.aspectRatio=photo.naturalWidth+'/'+photo.naturalHeight;transform();}};photo.addEventListener('load',fit,{once:true});if(photo.complete)fit();selectSpot(0);transform();if(focusTab)tabs[index].focus({preventScroll:true});}
 tabs.forEach((t,i)=>{t.addEventListener('click',()=>selectScene(i));t.addEventListener('keydown',e=>{let next;if(e.key==='ArrowRight')next=(i+1)%tabs.length;if(e.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;if(e.key==='Home')next=0;if(e.key==='End')next=tabs.length-1;if(next!==undefined){e.preventDefault();selectScene(next,true);}});});
 canvas.addEventListener('click',e=>{const pin=e.target.closest('[data-tour-pin]');if(pin)selectSpot(Number(pin.dataset.tourPin),true);});
 detail.addEventListener('click',e=>{const button=e.target.closest('[data-tour-spot]');if(button){selectSpot(Number(button.dataset.tourSpot),true);}});
 root.querySelector('.tour-zoom').addEventListener('click',e=>{const b=e.target.closest('[data-tour-zoom]');if(!b)return;const action=b.dataset.tourZoom;zoom=action==='reset'?1:Math.min(2,Math.max(1,zoom+(action==='in'?.5:-.5)));if(zoom===1)panX=panY=0;transform();if(b.disabled)area.focus({preventScroll:true});});
 area.addEventListener('pointerdown',e=>{if(zoom===1||e.target.closest('button'))return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,panX,panY};area.setPointerCapture(e.pointerId);area.classList.add('dragging');});
 area.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;panX=drag.panX+e.clientX-drag.x;panY=drag.panY+e.clientY-drag.y;transform();});
 const endDrag=()=>{drag=null;area.classList.remove('dragging');};area.addEventListener('pointerup',endDrag);area.addEventListener('pointercancel',endDrag);area.addEventListener('lostpointercapture',endDrag);
 area.addEventListener('keydown',e=>{if(e.target!==area||zoom===1)return;const directions={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]};if(directions[e.key]){e.preventDefault();panX+=directions[e.key][0];panY+=directions[e.key][1];transform();}});
 const resize=new ResizeObserver(transform);resize.observe(area);selectScene(0);
 disposeTour=()=>{resize.disconnect();if(fullDialog.open)fullDialog.close();fullDialog.remove();placeholder.remove();disposeTour=()=>{};};
}

function campusPage(key){const c=campuses[key];return `<div class="container breadcrumb"><a href="#/home">首頁</a> / <a href="#/home/campuses">五校介紹</a> / ${c.name}</div><section class="hero campus-hero" style="--campus-photo-position:${c.heroPhotoPos||'center'}">${img(c.image,c.name+'校園外觀','hero-photo',true,true)}<div class="hero-shade"></div><div class="container"><span class="eyebrow">常春藤幼兒園 · 高雄${c.district}</span><h1>${c.name}</h1><p>${c.intro}</p><div class="hero-cta"><a class="button yellow" href="${bookingLink(key)}">預約參觀${c.name}</a></div></div><div class="hero-bottom"><span class="hero-caption">${c.name} · 官方校園照片</span></div></section><nav class="campus-subnav" aria-label="${c.name}頁面段落"><div class="container"><a href="#/${key}/about">認識${c.name}</a><a href="#/${key}/environment">校園環境</a><a href="#/${key}/faq">參觀須知</a><a href="#/${key}/contact">交通與聯絡</a></div></nav>
<section class="section" id="about"><div class="container detail-grid"><div><span class="eyebrow">認識${c.name}</span><h2 class="section-title">${c.intro}</h2><p class="section-copy">${c.description}</p><p class="section-copy">不急著做決定，先從一次親自走訪開始。帶著你想了解的事情，看看這裡是否適合孩子。</p></div><div class="contact-panel"><h3>來認識${c.name}</h3><dl><div><dt>${icon('map-pin')}所在地</dt><dd>${c.address}</dd></div><div><dt>${icon('phone')}參觀專線</dt><dd><a href="tel:${c.phone}">${c.phone}</a></dd></div><div><dt>${icon('clock')}到園參觀</dt><dd>請事先聯絡園所確認接待時間。</dd></div></dl><a class="text-link" href="${mapURL(c)}" ${external}>查看地圖與路線 ${arrow}</a></div></div></section>
${campusTour(key)}
<section class="section" id="faq"><div class="container faq-grid"><div><span class="eyebrow">參觀須知</span><h2 class="section-title">讓第一次參觀，<br>更安心一點。</h2><p class="section-copy">參觀時間、課程與入學安排，<br>請直接向${c.name}確認。</p></div>${faq(key)}</div></section>
<section class="section campuses" id="contact">${campusArtwork(key)}<div class="container detail-grid"><div class="contact-location"><span class="eyebrow">交通與聯絡</span><h2 class="section-title">我們在這裡，等你來。</h2><a class="phone-link" href="tel:${c.phone}">${icon('phone')}${c.phone}</a><p>${c.address}</p>${campusLinks(c)}<div><a class="button primary" href="${bookingLink(key)}">預約${c.name}</a></div></div>${campusMapFrame(c,'campus-contact-map')}</div></section>${banner(key)}`;}
function visitPage(key){return `<section class="visit-page"><div class="container"><div class="breadcrumb"><a href="#/home">首頁</a> / 預約校園參觀</div><div class="visit-layout"><div class="visit-intro"><span class="eyebrow">預約校園參觀</span><h1>一起認識，<br>孩子未來的日常。</h1><p>選一所你想了解的校園，<br>留下方便聯絡的方式。</p><p class="demo-note">這是官網互動提案，請使用測試資料。<br>資料不會送出或儲存，也不會建立預約。<br>實際參觀請直接致電各校。</p></div><div><ol class="stepper" aria-label="預約步驟"><li id="step-one" aria-current="step"><span>1</span>選擇校區</li><li id="step-two"><span>2</span>填寫聯絡資料</li></ol><div class="form-panel"><section id="choose-campus"><h2>想先認識哪所校園？</h2><p>依照你的生活圈與接送路線選擇。</p><form id="campus-form"><fieldset class="campus-options"><legend class="sr-only">選擇想參觀的校區（必填）</legend>${Object.entries(campuses).map(([id,c])=>`<label class="campus-option"><input type="radio" name="campus" value="${id}" ${key===id?'checked':''} required><span><strong>${c.name}</strong><small>${c.address}</small></span><span class="district">${c.district}</span></label>`).join('')}</fieldset><div class="form-buttons"><button class="button primary" type="submit">下一步：填寫資料${icon('arrow-right')}</button></div></form></section>
<section id="contact-step" hidden><h2 tabindex="-1" id="contact-title">怎麼稱呼你？</h2><div class="selected-school"><span id="selected-school-name"></span><button id="change-campus" type="button">更換校區</button></div><form id="booking-form"><div class="field-grid"><div class="field"><label for="parent-name">家長稱呼<span class="required">必填</span></label><input id="parent-name" name="parentName" autocomplete="off" maxlength="40" required placeholder="例如：陳媽媽"></div><div class="field"><label for="parent-phone">手機號碼<span class="required">必填</span></label><input id="parent-phone" name="phone" autocomplete="off" type="tel" inputmode="tel" maxlength="16" required pattern="09[0-9]{8}" title="09 開頭的 10 碼手機號碼" placeholder="09xxxxxxxx" aria-describedby="phone-hint"><small id="phone-hint">請填寫 09 開頭的 10 碼手機號碼。</small></div><div class="field"><label for="child-age">孩子年齡</label><select id="child-age" name="age"><option>尚未確定</option><option>2 歲以下</option><option>2–3 歲</option><option>3–4 歲</option><option>4–5 歲</option><option>5–6 歲</option></select></div><div class="field"><label for="contact-time">方便聯絡的時段</label><select id="contact-time" name="time"><option>時間彈性</option><option>平日上午</option><option>平日下午</option><option>其他，另行確認</option></select></div><div class="field full"><label for="questions">有沒有想先了解的事？<span class="required">選填</span></label><textarea id="questions" name="questions" maxlength="500" placeholder="例如：課程安排、生活照顧、入學準備……"></textarea></div></div><label class="consent"><input type="checkbox" required id="demo-consent"><span>我了解這是操作示範，資料不會傳送給學校，不代表預約成立。</span></label><p class="form-error" id="form-error" role="alert"></p><div class="form-buttons"><button type="button" class="button outline" id="back-step">${icon('arrow-left')}上一步</button><button type="submit" class="button primary">預覽填寫結果${icon('arrow-right')}</button></div></form></section><section id="booking-result" hidden tabindex="-1"><div class="result-mark" aria-hidden="true">${icon('check')}</div><span class="eyebrow">示範結果</span><h2>示範完成，尚未送出預約。</h2><p>以下為本次填寫內容。若要實際安排參觀，請撥打所選校區的電話；離開此頁後將清除輸入資料。</p><dl class="result-list" id="result-list"></dl><div class="form-buttons"><button class="button outline" type="button" id="edit-result">修改內容</button><a class="button primary" id="call-campus">${icon('phone')}致電園所</a></div><a class="text-link" style="margin-top:24px" href="#/home">回到首頁</a></section></div></div></div></div></section>`;}
/* 頁首選單。首頁用膠囊的選單卡（離開首屏後導覽收進三條線，見 DESIGN.md「離開首屏的浮動膠囊」）；
   分校頁與預約頁沿用原本頁首下方的展開列。 */
const headerTop=document.querySelector('.header-top');
const pill=document.querySelector('.header-pill');
const panel=document.querySelector('#menu-panel');
const menuToggles=[menu,document.querySelector('#pill-menu-toggle')];
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
let usePanel=false,panelOpener=null,panelHideTimer=0,panelFocusTimer=0;
const labelToggles=open=>menuToggles.forEach(t=>{t.setAttribute('aria-expanded',String(open));t.setAttribute('aria-label',open?'關閉導覽選單':'開啟導覽選單');});
// 選單卡貼齊目前露出的那一組：收合後貼膠囊下緣，還在首屏時貼頁首容器。
function positionPanel(){
 const compact=header.dataset.state==='compact';
 const split=/^split/.test(document.documentElement.dataset.pill||'')&&innerWidth>900;
 const side=document.documentElement.dataset.pill==='side'&&innerWidth>900;
 // 分成兩顆時貼齊右邊那組，其餘貼齊整顆膠囊；還在首屏時貼頁首容器。
 const anchor=compact?(split?pill.querySelector('.pill-actions'):pill):headerTop;
 const base=header.getBoundingClientRect(),rect=anchor.getBoundingClientRect();
 panel.classList.toggle('beside',side&&compact);
 // 底部停靠（?pill=dock）：選單卡往上開，貼膠囊上緣、右緣對齊。
 const dock=document.documentElement.dataset.pill==='dock'&&innerWidth>900;
 panel.classList.toggle('above',dock&&compact);
 if(dock&&compact){
  const w=Math.max(rect.width,420);
  panel.classList.remove('from-bar');
  panel.style.width=w+'px';
  panel.style.left=Math.max(16,rect.right-w)+'px';
  panel.style.top=(rect.top-panel.offsetHeight-10)+'px';
  return;
 }
 // 側邊直欄：選單卡開在直欄左側，與直欄頂端齊平。
 if(side&&compact){
  const w=420;
  panel.classList.remove('from-bar');
  panel.style.top=(rect.top-base.top)+'px';
  panel.style.left=Math.max(16,rect.left-base.left-w-10)+'px';
  panel.style.width=w+'px';
  return;
 }
 // 膠囊 2026-09-18 晚已縮到 220 寬，選單卡不再跟膠囊同寬：至少 420，右緣對齊膠囊右緣，與膠囊留 8px 間距。
 const width=Math.max(rect.width,compact?420:0);
 let left=rect.right-base.left-width;
 if(width===rect.width)left=rect.left-base.left;
 left=Math.min(Math.max(left,16),Math.max(16,header.clientWidth-width-16));
 panel.classList.toggle('from-bar',!compact);
 panel.style.top=(rect.bottom-base.top+8)+'px';
 panel.style.left=left+'px';
 panel.style.width=width+'px';
}
function openPanel(button){
 clearTimeout(panelHideTimer);clearTimeout(panelFocusTimer);
 panelOpener=button;
 if(header.dataset.peek==='out')header.dataset.peek='in';
 panel.hidden=false;
 positionPanel();
 header.dataset.menu='open';
 labelToggles(true);
 // 先讓 hidden=false 落地，下一幀再加 class，過場才會播。
 requestAnimationFrame(()=>requestAnimationFrame(()=>panel.classList.add('is-open')));
 const first=panel.querySelector('a');
 panelFocusTimer=setTimeout(()=>first&&first.focus({preventScroll:true}),reduceMotion.matches?0:320);
}
function closePanel(returnFocus=true){
 if(panel.hidden)return;
 const inside=panel.contains(document.activeElement);
 panel.classList.remove('is-open');
 header.dataset.menu='closed';
 labelToggles(false);
 clearTimeout(panelHideTimer);clearTimeout(panelFocusTimer);
 panelHideTimer=setTimeout(()=>{panel.hidden=true;},reduceMotion.matches?0:320);
 if(returnFocus&&inside&&panelOpener)panelOpener.focus({preventScroll:true});
}
function closeNav(){nav.classList.remove('open');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','開啟導覽選單');}
function closeMenu(){closeNav();closePanel(false);}
menuToggles.forEach(button=>button.addEventListener('click',()=>{
 if(button===menu&&!usePanel){const open=nav.classList.toggle('open');menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'關閉導覽選單':'開啟導覽選單');return;}
 if(panel.hidden)openPanel(button);else closePanel();
}));
panel.addEventListener('click',e=>{if(e.target.closest('a'))closePanel(false);});
document.addEventListener('pointerdown',e=>{if(!panel.hidden&&!header.contains(e.target))closePanel(false);});
document.addEventListener('keydown',e=>{
 if(e.key!=='Escape')return;
 if(!panel.hidden){closePanel();return;}
 if(nav.classList.contains('open')){closeNav();menu.focus();}
});
window.matchMedia('(min-width: 901px)').addEventListener('change',closeMenu);
document.querySelector('#footer-campuses').innerHTML=Object.entries(campuses).map(([key,c])=>`<a href="#/${key}">${c.name}</a>`).join('');
document.querySelector('#menu-campuses').innerHTML=Object.entries(campuses).map(([key,c])=>`<a href="#/${key}">${c.name}</a>`).join('');
/* 收合狀態：首頁只要往下捲超過 COMPACT_AT 就換成膠囊，捲回最上面還原成完整頁首。 */
let headerStateFrame=0;
function updateHeaderState(){
 headerStateFrame=0;
 if(!usePanel)return;
 const next=scrollY>COMPACT_AT?'compact':'hero';
 if(header.dataset.state===next)return;
 header.dataset.state=next;
 if(next==='hero')closePanel(false);
 else if(!panel.hidden)positionPanel();
}
function setupHeaderMode(page){
 usePanel=page==='home';
 menu.setAttribute('aria-controls',usePanel?'menu-panel':'navigation');
 header.dataset.state='hero';
 updateHeaderState();
}
window.addEventListener('scroll',()=>{if(!headerStateFrame)headerStateFrame=requestAnimationFrame(updateHeaderState);},{passive:true});
window.addEventListener('resize',()=>{if(!panel.hidden)positionPanel();},{passive:true});
/* 向下捲收起、向上捲出現。只看捲動方向，不綁計時器；選單開著或焦點在膠囊裡時一律留著。 */
if(AUTOHIDE){
 let lastY=Math.max(0,scrollY),peekFrame=0;
 const showPill=()=>{lastY=Math.max(0,scrollY);header.dataset.peek='in';};
 const updatePeek=()=>{
  peekFrame=0;
  const y=Math.max(0,scrollY),doc=document.documentElement;
  if(header.dataset.state!=='compact'||!panel.hidden||header.contains(document.activeElement)||reduceMotion.matches){showPill();return;}
  // 回到最上面、或已經捲到底（橡皮筋回彈）時不判斷方向。
  if(y<=COMPACT_AT+80||y+innerHeight>=doc.scrollHeight-2){showPill();return;}
  const delta=y-lastY;
  if(Math.abs(delta)<6)return;
  lastY=y;
  // 錨點跳轉、按 End 這種一次跳很遠的，只更新基準，不當成使用者在翻頁。
  if(Math.abs(delta)>240)return;
  header.dataset.peek=delta>0?'out':'in';
 };
 addEventListener('scroll',()=>{if(!peekFrame)peekFrame=requestAnimationFrame(updatePeek);},{passive:true});
 header.addEventListener('focusin',showPill);
 addEventListener('keydown',e=>{if(e.key==='Tab')showPill();});
 header.dataset.peek='in';
}
function setupBooking(key){
 let selected=campuses[key]?key:'';
 const choose=document.querySelector('#choose-campus'),contact=document.querySelector('#contact-step'),result=document.querySelector('#booking-result');
 const form=document.querySelector('#booking-form');
 function step(n,focus=true){choose.hidden=n!==1;contact.hidden=n!==2;result.hidden=n!==3;document.querySelector('#step-one').toggleAttribute('aria-current',n===1);document.querySelector('#step-two').toggleAttribute('aria-current',n===2);if(n<3)document.querySelector(n===1?'#step-one':'#step-two').setAttribute('aria-current','step');if(n===2){document.querySelector('#selected-school-name').textContent=`${campuses[selected].name} · ${campuses[selected].district}`;}if(focus){const target=n===1?choose.querySelector('input:checked')||choose.querySelector('input'):n===2?document.querySelector('#contact-title'):result;target.focus({preventScroll:true});const panel=document.querySelector('.form-panel');if(panel.getBoundingClientRect().top<90||window.innerWidth<761)panel.scrollIntoView({block:'start',behavior:'instant'});}}
 document.querySelector('#campus-form').addEventListener('submit',e=>{e.preventDefault();selected=new FormData(e.currentTarget).get('campus');if(campuses[selected])step(2);});
 document.querySelector('#change-campus').addEventListener('click',()=>step(1));document.querySelector('#back-step').addEventListener('click',()=>step(1));document.querySelector('#edit-result').addEventListener('click',()=>step(2));
 const name=document.querySelector('#parent-name'),phone=document.querySelector('#parent-phone');
 name.addEventListener('input',()=>name.setCustomValidity(''));
 name.addEventListener('blur',()=>{name.value=name.value.trim();name.setCustomValidity(name.value?'':'請填寫家長稱呼。');});
 phone.addEventListener('input',()=>{phone.value=phone.value.replace(/[\s-]/g,'');});
 form.addEventListener('submit',e=>{e.preventDefault();name.value=name.value.trim();name.setCustomValidity(name.value?'':'請填寫家長稱呼。');if(!form.reportValidity())return;const c=campuses[selected];const data=new FormData(form);const values=[['想參觀的校區',c.name],['家長稱呼',data.get('parentName')],['手機號碼',data.get('phone')],['孩子年齡',data.get('age')],['方便聯絡時段',data.get('time')],['想了解的事',data.get('questions').trim()||'未填寫']];const dl=document.querySelector('#result-list');dl.replaceChildren();for(const [title,value] of values){const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=title;dd.textContent=value;div.append(dt,dd);dl.append(div);}document.querySelector('#call-campus').href='tel:'+c.phone;step(3);});
 if(selected)step(2,false);
}
function setupVideo(){
 if(!HERO_VIDEO_SRC)return;
 const video=document.querySelector('#hero-video'),controls=document.querySelector('#video-controls'),play=document.querySelector('#video-play');
 if(!video)return;
 let disposed=false,wantsPlayback=false,revealVisible=true;
 const reduce=matchMedia('(prefers-reduced-motion: reduce)');
 const sync=()=>{const label=video.paused?'播放影片':'暫停影片';play.innerHTML=icon(video.paused?'play':'pause')+`<span class="sr-only">${label}</span>`;play.title=label;};
 const start=()=>{wantsPlayback=true;if(!disposed&&!document.hidden&&revealVisible)video.play().catch(()=>{if(!disposed)sync();});};
 const setVisible=visible=>{revealVisible=visible;if(disposed)return;if(document.hidden||!visible)video.pause();else if(wantsPlayback)start();};
 video.muted=true;
 video.addEventListener('play',sync);
 video.addEventListener('pause',sync);
 video.addEventListener('error',()=>{
  if(disposed)return;
  wantsPlayback=false;video.hidden=true;controls.hidden=true;
 });
 video.src=HERO_VIDEO_SRC;
 video.hidden=false;controls.hidden=false;
 play.addEventListener('click',()=>{if(video.paused)start();else{wantsPlayback=false;video.pause();}});
 sync();
 const conn=navigator.connection,frugal=conn?.saveData||/^(slow-2g|2g|3g)$/.test(conn?.effectiveType||'');
 if(!reduce.matches&&!frugal)start();
 const visibility=()=>setVisible(revealVisible);
 const onMotion=()=>{if(reduce.matches){wantsPlayback=false;video.pause();}};
 document.addEventListener('visibilitychange',visibility);
 reduce.addEventListener('change',onMotion);
 disposeMedia=()=>{
  disposed=true;
  document.removeEventListener('visibilitychange',visibility);
  reduce.removeEventListener('change',onMotion);
  video.pause();video.removeAttribute('src');video.load();
 };
 return setVisible;
}
let disposeBeliefCurtain=()=>{},disposeDayCurtain=()=>{};
// 區塊簾幕：panel 捲到最後一個畫面時黏住，再由下往上被擦掉，露出下一個區塊（首屏之後的每道接縫都用同一種切換）。
function setupCurtain({root,track,panel,prefix,onProgress}){
 const reduce=matchMedia('(prefers-reduced-motion: reduce)');
 const clamp=n=>Math.max(0,Math.min(1,n));
 let disposed=false,frame=0,measureFrame=0,start=0,distance=1,screen=1,lastBody=0;
 function update(){
  frame=0;if(disposed)return;
  if(root.dataset.motion!=='on'){panel.style.clipPath='';panel.inert=false;if(onProgress)onProgress(null,screen);return;}
  const progress=clamp((scrollY-start)/distance);
  // 只擦掉最後一個畫面：區塊比視窗高時，前面的內容照常捲動。
  panel.style.clipPath=`inset(0 0 ${(progress*screen).toFixed(1)}px 0)`;
  panel.inert=progress>=.995;
  if(onProgress)onProgress(progress,screen);
 }
 const schedule=()=>{if(!disposed&&!frame)frame=requestAnimationFrame(update);};
 function measure(){
  measureFrame=0;if(disposed)return;
  // 先回到靜止狀態量自然高度，再決定要黏在哪裡。
  root.dataset.motion='still';
  panel.style.clipPath='';panel.inert=false;
  screen=document.documentElement.clientHeight;
  const own=panel.getBoundingClientRect().height;
  root.style.setProperty(`--${prefix}-own`,own+'px');
  root.style.setProperty(`--${prefix}-stick`,Math.min(0,screen-own)+'px');
  root.dataset.motion=reduce.matches?'still':'on';
  const rect=track.getBoundingClientRect();
  start=rect.top+scrollY+own-screen;
  distance=Math.max(1,rect.height-own);
  lastBody=document.body.offsetHeight;
  update();
 }
 const scheduleMeasure=()=>{if(!disposed&&!measureFrame)measureFrame=requestAnimationFrame(measure);};
 addEventListener('scroll',schedule,{passive:true});
 addEventListener('resize',scheduleMeasure,{passive:true});
 reduce.addEventListener('change',measure);
 const observer=new ResizeObserver(scheduleMeasure);observer.observe(panel);
 // 上方區塊（例如前一道簾幕）改變高度時，黏住的起點也要跟著重量。
 const bodyObserver=new ResizeObserver(()=>{if(document.body.offsetHeight!==lastBody)scheduleMeasure();});bodyObserver.observe(document.body);
 document.fonts.ready.then(()=>{if(!disposed)measure();});
 measure();
 return ()=>{
  disposed=true;cancelAnimationFrame(frame);cancelAnimationFrame(measureFrame);observer.disconnect();bodyObserver.disconnect();
  removeEventListener('scroll',schedule);removeEventListener('resize',scheduleMeasure);
  reduce.removeEventListener('change',measure);
 };
}
// ?seam=2 接力：接縫掃過浮水印「常春藤」的進度（0 = 還在字下方，1 = 已越過字頂），寫成 CSS 變數給接力效果用。
function relayProgress(panel){
 const word=panel.querySelector('.wm-b'),style=document.documentElement.style,clamp=n=>Math.max(0,Math.min(1,n));
 return (progress,screen)=>{
  if(progress===null){style.setProperty('--relay-day','1');style.setProperty('--relay-glow','0');return;}
  const seamY=screen-progress*screen,r=word.getBoundingClientRect();
  // 簾幕還沒開始就是 0、走完就是 1，中間才看接縫相對字框的位置（區塊捲走後字框座標會亂跑，不能再算）。
  const t=progress<=0?0:progress>=1?1:r.height?clamp((r.bottom-seamY)/r.height):0;
  style.setProperty('--seam-inset',(progress*screen).toFixed(1)+'px');
  style.setProperty('--relay',t.toFixed(3));
  style.setProperty('--relay-glow',Math.min(1,t*8,(1-t)*8).toFixed(3));
  style.setProperty('--relay-day',clamp((t-.7)/.3).toFixed(3));
 };
}
// ?seam=2 的接力效果面板：三個效果各自開關，記在 localStorage。
function setupRelayStudy(){
 if(SEAM!=='2'||new URLSearchParams(location.search).get('study')!=='1'||document.querySelector('.relay-study'))return;
 const items=[['ghost','幽靈「關於」留在影片上'],['day','「的一天」接力進場'],['glint','接棒金線']];
 let saved={};try{saved=JSON.parse(localStorage.getItem('relay-study')||'{}');}catch{}
 const root=document.documentElement;
 const apply=()=>{items.forEach(([k])=>root.classList.toggle('relay-'+k,saved[k]===undefined?k==='day':saved[k]));try{localStorage.setItem('relay-study',JSON.stringify(saved));}catch{}};
 apply();
 const panel=document.createElement('aside');panel.className='relay-study';
 panel.innerHTML=`<details open><summary>接力效果</summary>${items.map(([k,n])=>`<label><input type="checkbox" value="${k}"${(saved[k]===undefined?k==='day':saved[k])?' checked':''}>${n}</label>`).join('')}</details>`;
 panel.querySelectorAll('input').forEach(i=>i.addEventListener('change',()=>{saved[i.value]=i.checked;apply();}));
 document.body.append(panel);
}
// 第二道簾幕：關於常春藤捲到底時被由下往上掀開，露出「孩子的一天」（與首屏同一種區塊切換）。
function setupBeliefCurtain(){
 const root=document.querySelector('.belief-reveal');if(!root)return;
 if(SEAM==='1'){root.dataset.motion='seam';return;}
 const track=root.querySelector('.belief-reveal-track'),panel=root.querySelector('.home-belief');
 if(!track||!panel)return;
 const dispose=setupCurtain({root,track,panel,prefix:'belief',onProgress:SEAM==='2'?relayProgress(panel):undefined});
 disposeBeliefCurtain=()=>{dispose();disposeBeliefCurtain=()=>{};};
}
// 第三道簾幕：「孩子的一天」最後一個畫面被掀開，露出「分校資訊」。
function setupDayCurtain(){
 const root=document.querySelector('.day-reveal');if(!root)return;
 const track=root.querySelector('.day-reveal-track'),panel=root.querySelector('.day-experience');
 if(!track||!panel)return;
 const dispose=setupCurtain({root,track,panel,prefix:'day'});
 disposeDayCurtain=()=>{dispose();disposeDayCurtain=()=>{};};
}
let disposeHomeReveal=()=>{};
function setupHomeReveal(setMediaVisible=()=>{}){
 const root=document.querySelector('.home-reveal');if(!root)return;
 const track=root.querySelector('.home-reveal-track'),hero=root.querySelector('.studio-hero');
 const copy=root.querySelector('.studio-hero-copy'),image=root.querySelector('.studio-hero-image');
 const media=root.querySelector('.studio-media'),actions=root.querySelector('.studio-actions');
 const reduce=matchMedia('(prefers-reduced-motion: reduce)'),mobile=matchMedia('(max-width: 1000px)');
 const native=CSS.supports('animation-timeline: view()')&&CSS.supports('animation-range: contain 0% contain 100%');
 const clamp=n=>Math.max(0,Math.min(1,n));
 let disposed=false,frame=0,measureFrame=0,start=0,distance=1,copyRise=0,lastVisible;
 function update(){
  frame=0;if(disposed)return;
  const animated=root.dataset.motion!=='still',progress=animated?clamp((scrollY-start)/distance):0;
  root.classList.toggle('is-revealing',animated&&progress>.08);
  hero.inert=animated&&progress>=.995;
  actions.inert=animated&&progress>=.15;
  media.inert=animated&&progress>=.2;
  if(root.dataset.motion==='fallback'){
   const fade=clamp(progress/.48);
   hero.style.clipPath=`inset(0 0 ${clamp((progress-.1)/.9)*100}% 0)`;
   hero.style.setProperty('--reveal-film-opacity',String(1-fade));
   image.style.opacity=String(1-fade);
   copy.style.opacity=String(1-(mobile.matches ? .72 : .75)*fade);
   copy.style.transform=`translateY(${-copyRise*fade}px) scale(${1-(mobile.matches ? .04 : .1)*fade})`;
   copy.style.color=`rgb(${255-223*fade} ${253-190*fade} ${245-195*fade})`;
   media.style.opacity=String(1-clamp(progress/.2));
  }
  const rect=hero.getBoundingClientRect();
  const visible=animated?progress<1:rect.bottom>0&&rect.top<document.documentElement.clientHeight;
  if(visible!==lastVisible){lastVisible=visible;setMediaVisible(visible);}
 }
 function schedule(){if(!disposed&&!frame)frame=requestAnimationFrame(update);}
 function measure(){
  measureFrame=0;if(disposed)return;
  root.dataset.motion='still';
  [hero,copy,image,media].forEach(el=>el.removeAttribute('style'));
  const height=document.documentElement.clientHeight;
  copyRise=mobile.matches?height*.2:0;
  // Only fall back when the content really exceeds the available viewport.
  const fits=hero.getBoundingClientRect().height<=height+1;
  root.style.setProperty('--reveal-height',height+'px');
  root.dataset.motion=reduce.matches||!fits||document.documentElement.classList.contains('hero-quiet')?'still':native?'native':'fallback';
  const rect=track.getBoundingClientRect();start=rect.top+scrollY;distance=Math.max(1,rect.height-height);
  update();
 }
 function scheduleMeasure(){if(!disposed&&!measureFrame)measureFrame=requestAnimationFrame(measure);}
 window.addEventListener('scroll',schedule,{passive:true});
 window.addEventListener('resize',scheduleMeasure,{passive:true});
 reduce.addEventListener('change',measure);mobile.addEventListener('change',measure);
 const observer=new ResizeObserver(scheduleMeasure);observer.observe(copy);
 document.fonts.ready.then(()=>{if(!disposed)measure();});
 measure();
 disposeHomeReveal=()=>{
  disposed=true;cancelAnimationFrame(frame);cancelAnimationFrame(measureFrame);observer.disconnect();
  window.removeEventListener('scroll',schedule);window.removeEventListener('resize',scheduleMeasure);
  reduce.removeEventListener('change',measure);mobile.removeEventListener('change',measure);
  disposeHomeReveal=()=>{};
 };
}
let disposeCampusShowcase=()=>{};
function setupCampusShowcase(){
 const root=document.querySelector('.campuses');if(!root||!root.querySelector('.campus-track'))return;
 const tabs=[...root.querySelectorAll('.campus-seg')],keys=tabs.map(t=>t.dataset.campus);
 const stage=root.querySelector('#campus-stage'),media=root.querySelector('.campus-stage-media'),photo=root.querySelector('.campus-stage-photo'),info=root.querySelector('.campus-stage-info'),live=root.querySelector('#campus-live');
 const reduce=matchMedia('(prefers-reduced-motion:reduce)');
 const interval=6000;
 let current=keys.find(k=>root.querySelector(`#campus-tab-${k}`).getAttribute('aria-selected')==='true')||keys[0],switchId=0;
 let hovered=root.matches(':hover'),touching=false,visible=false,disposed=false,timer=0,transitionTimer=0;
 function syncPlayback(){
  clearTimeout(timer);
  const active=document.activeElement;
  const focused=active!==root&&root.contains(active)&&active.matches(':focus-visible');
  const paused=reduce.matches||hovered||touching||focused;
  live.setAttribute('aria-live',paused?'polite':'off');
  if(disposed||paused||!visible||document.hidden)return;
  timer=setTimeout(()=>{select(keys[(keys.indexOf(current)+1)%keys.length],false,false);syncPlayback();},interval);
 }
 function apply(c,key){photo.src=photoSrc(c.image);photo.alt=c.name+'校園外觀';media.style.setProperty('--photo-pos',c.photoPos||'center');media.style.setProperty('--panorama-pos',c.panoramaPos||'center 55%');info.innerHTML=boardInfo(c);root.querySelector('.campus-stage-actions').innerHTML=boardActions(c,key);root.querySelector('.campus-art-building').src=campusArtSrc(key);}
 function select(key,focusTab=false,announce=true){
  const c=campuses[key];
  tabs.forEach(t=>{const on=t.dataset.campus===key;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;if(on&&focusTab)t.focus({preventScroll:true});});
  if(key===current)return;
  current=key;stage.setAttribute('aria-labelledby','campus-tab-'+key);
  live.textContent=announce?`目前顯示 ${c.name}，高雄${c.district}`:'';
  // 照片與校舍線稿先預載、內容淡出後一起換；減少動態時直接換。
  const token=++switchId,next=new Image(),nextArt=new Image();next.src=photoSrc(c.image);nextArt.src=campusArtSrc(key);
  const ready=Promise.all([next.decode().catch(()=>{}),nextArt.decode().catch(()=>{})]);
  clearTimeout(transitionTimer);
  if(reduce.matches){apply(c,key);stage.classList.remove('is-switching');return;}
  stage.classList.add('is-switching');
  const done=()=>{if(disposed||token!==switchId)return;apply(c,key);requestAnimationFrame(()=>{if(!disposed&&token===switchId)stage.classList.remove('is-switching');});};
  transitionTimer=setTimeout(()=>{ready.then(done);},200);
 }
 function onClick(e){
  syncPlayback();
  const tab=e.target.closest('.campus-seg');if(tab){select(tab.dataset.campus);return;}
  const step=e.target.closest('.campus-stage-btn');if(step){const i=keys.indexOf(current);select(keys[(i+Number(step.dataset.step)+keys.length)%keys.length]);return;}
 }
 function onKey(e){const tab=e.target.closest('.campus-seg');if(!tab)return;const i=keys.indexOf(tab.dataset.campus);const next={ArrowRight:i+1,ArrowLeft:i-1,Home:0,End:keys.length-1}[e.key];if(next===undefined)return;e.preventDefault();syncPlayback();select(keys[(next+keys.length)%keys.length],true);}
 const onPointerDown=e=>{touching=e.pointerType!=='mouse';syncPlayback();};
 const onPointerEnd=()=>{if(touching){touching=false;syncPlayback();}};
 const onFocus=()=>queueMicrotask(()=>{if(!disposed)syncPlayback();});
 const onEnter=e=>{if(e.pointerType==='mouse'){hovered=true;syncPlayback();}};
 const onLeave=e=>{if(e.pointerType==='mouse'){hovered=false;syncPlayback();}};
 const onMotion=()=>syncPlayback();
 const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting&&entries[0].intersectionRatio>=.2;syncPlayback();},{threshold:[0,.2]});
 observer.observe(stage);
 root.addEventListener('click',onClick);root.addEventListener('keydown',onKey);
 root.addEventListener('pointerdown',onPointerDown);document.addEventListener('pointerup',onPointerEnd);document.addEventListener('pointercancel',onPointerEnd);
 root.addEventListener('focusin',onFocus);root.addEventListener('focusout',onFocus);root.addEventListener('pointerenter',onEnter);root.addEventListener('pointerleave',onLeave);
 document.addEventListener('visibilitychange',syncPlayback);reduce.addEventListener('change',onMotion);
 syncPlayback();
 disposeCampusShowcase=()=>{
  disposed=true;++switchId;clearTimeout(timer);clearTimeout(transitionTimer);observer.disconnect();
  root.removeEventListener('click',onClick);root.removeEventListener('keydown',onKey);
  root.removeEventListener('pointerdown',onPointerDown);document.removeEventListener('pointerup',onPointerEnd);document.removeEventListener('pointercancel',onPointerEnd);
  root.removeEventListener('focusin',onFocus);root.removeEventListener('focusout',onFocus);root.removeEventListener('pointerenter',onEnter);root.removeEventListener('pointerleave',onLeave);
  document.removeEventListener('visibilitychange',syncPlayback);reduce.removeEventListener('change',onMotion);
  disposeCampusShowcase=()=>{};
 };
}
// 首頁「分校資訊」底板卡（2026-09-18 定案 e3）：置中標題、右上線稿、← 校名軌道 →；舞台是 1320px 照片卡騎在區塊下方的墨綠色帶上，底板一列放校名、地址專線、社群、預約。切換走 setupCampusShowcase()。
const boardInfo=c=>`<h3 class="board-name"><span class="board-name-zh">${c.name}</span><span class="board-name-area">高雄 · ${c.district}</span></h3><dl class="board-facts"><div><dt>${icon('map-pin')}所在地</dt><dd>${c.address}</dd></div><div><dt>${icon('phone')}參觀專線</dt><dd><a href="tel:${c.phone}">${c.phone}</a></dd></div></dl>${campusLinks(c)}`;
const boardActions=(c,key)=>`<a class="button primary" href="${bookingLink(key)}">預約參觀${c.name}${icon('arrow-right')}</a><a class="text-link" href="${mapURL(c)}" ${external}>在 Google 地圖開啟${arrow}</a>`;
function campusBoardSection(){
 const keys=Object.keys(campuses),selected=keys[0],c=campuses[selected];
 const segs=keys.map(key=>{const on=key===selected;return `<button type="button" role="tab" class="campus-seg" id="campus-tab-${key}" aria-selected="${on}" tabindex="${on?0:-1}" aria-controls="campus-stage" data-campus="${key}">${campuses[key].name}</button>`;}).join('');
 const prev=`<button type="button" class="campus-stage-btn" data-step="-1" aria-label="上一校">${icon('arrow-left')}</button>`,next=`<button type="button" class="campus-stage-btn" data-step="1" aria-label="下一校">${icon('arrow-right')}</button>`;
 return `<section class="section campuses campus-panorama campus-board" id="campuses" aria-roledescription="輪播" aria-labelledby="campuses-heading">${campusArtwork(selected)}<div class="container"><div class="section-heading is-centered"><div><span class="eyebrow">Campuses</span><h2 class="section-title" id="campuses-heading">分校資訊</h2></div></div><div class="campus-picker"><span class="campus-picker-nav">${prev}</span><div class="campus-track" role="tablist" aria-label="選擇校區">${segs}</div><span class="campus-picker-nav">${next}</span></div><div class="campus-stage board-stage" id="campus-stage" role="tabpanel" aria-labelledby="campus-tab-${selected}"><figure class="campus-stage-media" style="--photo-pos:${c.photoPos||'center'};--panorama-pos:${c.panoramaPos||'center 55%'}">${img(c.image,c.name+'校園外觀','campus-stage-photo')}</figure><div class="campus-stage-nav">${prev}${next}</div><div class="board-plate"><div class="campus-stage-info">${boardInfo(c)}</div><div class="campus-stage-actions">${boardActions(c,selected)}</div></div></div></div><p class="sr-only" aria-live="off" id="campus-live"></p></section>`;
}
const dialog=document.querySelector('#photo-dialog');document.querySelector('#photo-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{lastPhotoTrigger?.focus({preventScroll:true});});dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
main.addEventListener('click',e=>{const trigger=e.target.closest('[data-photo]');if(!trigger)return;lastPhotoTrigger=trigger;document.querySelector('#photo-title').textContent=trigger.dataset.title;document.querySelector('#photo-image').src='assets/'+trigger.dataset.photo+'.webp';document.querySelector('#photo-image').alt=trigger.dataset.title;dialog.showModal();});
function render(){const version=++routeVersion;const parts=location.hash.replace(/^#\/?/,'').split('/');let page=parts[0]||'home';if(!campuses[page]&&page!=='visit')page='home';const school=page==='visit'&&campuses[parts[1]]?parts[1]:'';const id=page==='visit'?'':parts[1]||'';const pageKey=page+(page==='visit'?'/'+school:'');closeMenu();homepageNews.close();if(currentPage!==pageKey){disposeTour();disposeHomeReveal();disposeDay();disposeBeliefCurtain();disposeDayCurtain();disposeMedia();disposeMedia=()=>{};disposeCampusShowcase();if(dialog.open)dialog.close();currentPage=pageKey;main.innerHTML=page==='home'?home():page==='visit'?visitPage(school):campusPage(page);document.title=page==='home'?'常春藤幼兒園｜每一天都有新發現':page==='visit'?'預約校園參觀｜常春藤幼兒園':campuses[page].name+'｜常春藤幼兒園';{const book=document.querySelector('.header-book');book.href=bookingLink(campuses[page]?page:'');// 人已經在預約頁時，這顆指向原地；視覺照舊，但要讓輔助科技知道。
if(page==='visit')book.setAttribute('aria-current','page');else book.removeAttribute('aria-current');}if(page==='visit')setupBooking(school);if(page==='home'){setupDayExperience();setupBeliefCurtain();setupDayCurtain();setupRelayStudy();setupHomeReveal(setupVideo());setupCampusShowcase();}setupCampusTour();armMapFrames(main);setupHeaderMode(page);}document.querySelectorAll('.nav-inner a').forEach(a=>{if(a.getAttribute('href')===location.hash)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});requestAnimationFrame(()=>{if(version!==routeVersion)return;const target=id?document.getElementById(id):null;if(target){target.scrollIntoView({block:'start',behavior:'instant'});target.setAttribute('tabindex','-1');target.focus({preventScroll:true});}else{window.scrollTo({top:0,behavior:'instant'});main.focus({preventScroll:true});}});}
homepageNews.init();
window.addEventListener('hashchange',render);document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#/"]');if(a&&a.getAttribute('href')===location.hash){e.preventDefault();render();}});render();
