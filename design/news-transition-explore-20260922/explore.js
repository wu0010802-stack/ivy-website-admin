const names={d:'D · 留白展幅',e:'E · 紙頁覆疊',f:'F · 照片取色',g:'G · 照片接棒'};
const frame=document.querySelector('iframe');
function sync(direction){
  document.querySelectorAll('[data-direction]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.direction===direction)));
  document.querySelectorAll('[data-card]').forEach(card=>card.dataset.selected=String(card.dataset.card===direction));
  document.querySelector('#preview-title').textContent=names[direction];
  document.querySelector('#open-full').href=`stage.html?direction=${direction}`;
  frame.title=`${names[direction]}互動示意`;
  history.replaceState(null,'',`?direction=${direction}`);
}
function select(direction,scroll=false){
  sync(direction);frame.src=`stage.html?direction=${direction}`;
  if(scroll)document.querySelector('#lab').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});
}
document.querySelectorAll('[data-direction]').forEach(button=>button.addEventListener('click',()=>select(button.dataset.direction,Boolean(button.closest('.reference')))));
document.querySelectorAll('button[data-size]').forEach(button=>button.addEventListener('click',()=>{
  document.querySelector('.frame-wrap').dataset.size=button.dataset.size;
  document.querySelectorAll('button[data-size]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));
}));
frame.addEventListener('load',()=>{const direction=new URLSearchParams(frame.contentWindow.location.search).get('direction');if(Object.hasOwn(names,direction))sync(direction);});
const initial=new URLSearchParams(location.search).get('direction');
select(Object.hasOwn(names,initial)?initial:'d');
