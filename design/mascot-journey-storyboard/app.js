const chapters = [
  {label:'Hero',name:'從 Logo 出發',intent:'讓熟悉的品牌人物，成為接下來的嚮導。',position:'先在品牌標誌附近，再移到畫面下緣。',action:'Hero 退場時，兩人輕輕分開、走出；皇冠與月桂留在品牌標誌。',purpose:'用方向感提示「繼續往下，跟著我們」。',boy:[[0,18,20,.15,0],[.15,25,65,.6,1],[.38,34,84,1,1],[.76,34,84,1,1],[1,48,84,1,1]],girl:[[0,18,20,.15,0],[.15,33,67,.6,1],[.38,49,84,1,1],[.76,49,84,1,1],[1,88,84,1,1]]},
  {label:'關於',name:'照片旁相見',intent:'先把視線帶到人與環境，再安靜陪伴閱讀。',position:'男孩在照片左側，女孩停在照片右下角。',action:'一位從邊緣探身，一位緩緩落到照片旁，站定後停止移動。',purpose:'帶到校園照片與「把每個孩子放在心上」的內容。',boy:[[0,48,84,1,1],[.3,52,69,1,1],[.76,52,69,1,1],[1,28,98,1,1]],girl:[[0,88,84,1,1],[.3,90,84,1,1],[.76,90,84,1,1],[1,71,98,1,1]]},
  {label:'孩子的一天',name:'兩人分開帶路',intent:'像兩個孩子接力分享自己的日常。',position:'各站在不同的生活片刻旁，沿底部時間線前進。',action:'前半段男孩領路；後半段女孩接棒，位移配合生活內容切換。',purpose:'串起早安、探索與回家，讓使用者知道這是一段連續的日常。',boy:[[0,28,98,1,1],[.3,28,98,1,1],[.55,49,98,1,1],[.8,49,98,1,1],[1,19,74,1,1]],girl:[[0,71,98,1,1],[.48,71,98,1,1],[.72,85,98,1,1],[1,93,87,1,1]]},
  {label:'五所校園',name:'沿著五校尋找',intent:'人物的走向，變成看懂分校選項的線索。',position:'男孩沿五個校園位置移動；女孩在右側等待。',action:'依捲動進度停靠五校，每一站亮起一下；人物不擋住校名與按鈕。',purpose:'帶到「找到離家最近的校園」，之後可接校園卡片切換。',boy:[[0,19,74,1,1],[.2,34,70,1,1],[.4,50,74,1,1],[.6,66,70,1,1],[.8,81,74,1,1],[1,5,90,1,1]],girl:[[0,93,87,1,1],[.8,93,87,1,1],[1,84,64,1,1]]},
  {label:'最新消息',name:'探頭發現新故事',intent:'只用一次小驚喜，提醒有新內容可以看。',position:'男孩停在卡片下緣；女孩在右側消息卡片上探頭。',action:'女孩輕輕上移探頭，再回到卡片邊；不持續跳動或反覆招手。',purpose:'把注意力帶到消息與近期活動，閱讀時人物保持安靜。',boy:[[0,5,90,1,1],[.78,5,90,1,1],[1,34,79,1,1]],girl:[[0,84,64,1,1],[.25,84,57,1,1],[.72,84,57,1,1],[1,66,79,1,1]]},
  {label:'頁尾邀請',name:'會合，邀請見面',intent:'兩位嚮導把整段旅程收回到一次真實的參觀。',position:'在「預約參觀」下方左右會合，社群列保持清楚。',action:'靠近、停下，向中間輕輕傾身；最後保留完整的靜態邀請畫面。',purpose:'讓人物最後指向預約入口與機構社群，完成有目的的導覽。',boy:[[0,34,79,1,1],[.32,37,79,1,1],[1,37,79,1,1]],girl:[[0,66,79,1,1],[.32,64,79,1,1],[1,64,79,1,1]]}
];
const journey=document.querySelector('#journey'),canvas=document.querySelector('#canvas'),progress=document.querySelector('#story-progress');
const actors=[document.querySelector('.boy'),document.querySelector('.girl')];
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const native=CSS.supports('(animation-timeline:view()) and (animation-range:contain 0% contain 100%)');
let motion=!reduced.matches,active=-1,ticking=0,full=0,noticeTimer;
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
function keyframes(key){return `@keyframes ${key}-route{${chapters.flatMap((chapter,index)=>chapter[key].map(([p,x,y,scale,opacity])=>`${((index+p)/6*100).toFixed(4)}%{transform:translate(calc(${x}cqw - 50%),calc(${y}cqh - 100%)) scale(${scale});opacity:${opacity}}`)).join('')}}`;}
document.querySelector('#route-keyframes').textContent=keyframes('boy')+keyframes('girl');
document.querySelector('.chapters').innerHTML=chapters.map((chapter,index)=>`<button data-chapter="${index}"><small>0${index+1}</small>${chapter.label}</button>`).join('');
document.querySelector('.drawer-chapters').innerHTML=chapters.map((chapter,index)=>`<button data-chapter="${index}">${chapter.label}</button>`).join('');
function travel(value){const distance=Math.max(1,journey.offsetHeight-innerHeight);window.scrollTo({top:journey.offsetTop+distance*clamp(value/6),behavior:'instant'});}
document.querySelectorAll('[data-chapter]').forEach(button=>button.onclick=()=>{if(dialog.open)closeDrawer();travel(Number(button.dataset.chapter)+.5);});
document.querySelector('#previous').onclick=()=>travel(Math.max(0,active-1)+.5);
document.querySelector('#next').onclick=()=>travel(Math.min(5,active+1)+.5);
progress.oninput=()=>travel(Number(progress.value)/100);
function interpolate(points,p){let a=points[0],b=points.at(-1);for(let i=1;i<points.length;i++){if(p<=points[i][0]){a=points[i-1];b=points[i];break;}}const n=clamp((p-a[0])/(b[0]-a[0]||1));return a.slice(1).map((value,index)=>value+(b[index+1]-value)*n);}
function paintActor(actor,pose){const [x,y,scale,opacity]=pose;actor.style.transform=`translate(calc(${x}cqw - 50%),calc(${y}cqh - 100%)) scale(${scale})`;actor.style.opacity=opacity;}
function update(){
  ticking=0;full=clamp((scrollY-journey.offsetTop)/Math.max(1,journey.offsetHeight-innerHeight))*6;
  const index=Math.min(5,Math.floor(full)),local=Math.min(.999,full-index),chapter=chapters[index];
  if(index!==active){active=index;canvas.dataset.active=index;document.querySelectorAll('.scene').forEach((scene,i)=>scene.hidden=i!==index);document.querySelectorAll('.chapters button').forEach((button,i)=>{if(i===index)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});document.querySelector('#chapter-name').textContent=chapter.name;document.querySelector('#chapter-intent').textContent=chapter.intent;document.querySelector('#position-note').textContent=chapter.position;document.querySelector('#action-note').textContent=chapter.action;document.querySelector('#purpose-note').textContent=chapter.purpose;document.querySelector('#canvas-step').textContent=`0${index+1}`;document.querySelector('#status').textContent=`0${index+1} / 06 · ${chapter.label}`;document.querySelector('#previous').disabled=index===0;document.querySelector('#next').disabled=index===5;}
  progress.value=Math.round(Math.min(full,5.99)*100);document.querySelector('#rhythm-marker').style.left=`calc(${local*100}% - 3px)`;
  document.querySelectorAll('.campus-stops span').forEach((stop,i)=>stop.classList.toggle('current',index===3&&i===Math.min(4,Math.floor(local*5))));
  if(!native||!motion){actors.forEach((actor,i)=>paintActor(actor,interpolate(chapter[i?'girl':'boy'],motion?local:.5)));}
}
function schedule(){if(!ticking)ticking=requestAnimationFrame(update);}
function setMotion(value){motion=value;document.body.classList.toggle('motion-disabled',!motion);const button=document.querySelector('#motion-toggle');button.setAttribute('aria-pressed',String(motion));button.textContent=motion?'動態開啟':'靜態分鏡';if(native&&motion)actors.forEach(actor=>{actor.style.removeProperty('transform');actor.style.removeProperty('opacity');});update();}
document.querySelector('#motion-toggle').onclick=()=>setMotion(!motion);
reduced.addEventListener('change',event=>setMotion(!event.matches));
window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
const dialog=document.querySelector('#journey-menu'),opener=document.querySelector('#menu-toggle');
let drawerScroll=0;
function closeDrawer(){dialog.close();opener.setAttribute('aria-expanded','false');opener.focus({preventScroll:true});window.scrollTo({top:drawerScroll,behavior:'instant'});}
opener.onclick=()=>{drawerScroll=scrollY;dialog.showModal();window.scrollTo({top:drawerScroll,behavior:'instant'});opener.setAttribute('aria-expanded','true');};
document.querySelector('#close-menu').onclick=closeDrawer;
dialog.addEventListener('close',()=>{opener.setAttribute('aria-expanded','false');opener.focus({preventScroll:true});});
dialog.addEventListener('cancel',event=>{event.preventDefault();closeDrawer();});
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right)closeDrawer();}});
document.querySelectorAll('.visit-button').forEach(button=>button.onclick=()=>{if(dialog.open)document.querySelector('#drawer-feedback').textContent='這裡會接到既有預約參觀流程；目前為分鏡示意。';else{const notice=document.querySelector('#notice');notice.hidden=false;notice.textContent='這裡會接到既有預約參觀流程；目前為分鏡示意。';clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.hidden=true,4000);}});
document.querySelectorAll('.drawer-socials button').forEach(button=>button.onclick=()=>document.querySelector('#drawer-feedback').textContent='機構社群圖示的位置示意。');
setMotion(motion);schedule();
