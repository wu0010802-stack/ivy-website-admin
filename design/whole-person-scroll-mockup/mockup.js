const progress=document.querySelector('.reading-track');
let frame=0;
function updateProgress(){
 frame=0;
 const distance=document.documentElement.scrollHeight-innerHeight;
 progress.style.setProperty('--reading-progress',String(distance>0?Math.min(1,Math.max(0,scrollY/distance)):1));
}
function schedule(){if(!frame)frame=requestAnimationFrame(updateProgress);}
addEventListener('scroll',schedule,{passive:true});
addEventListener('resize',schedule,{passive:true});
document.fonts.ready.then(schedule);
updateProgress();

const menu=document.querySelector('.mobile-menu');
menu.addEventListener('click',event=>{if(event.target.closest('a'))menu.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){menu.open=false;menu.querySelector('summary').focus();}});
document.addEventListener('click',event=>{if(menu.open&&!menu.contains(event.target))menu.open=false;});
