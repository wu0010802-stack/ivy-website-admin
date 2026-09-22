const variants={a:['A · 霧藍漸退','色彩慢慢交接，文字維持自然閱讀。'],b:['B · 頁尾揭幕','上層消息移開，露出底下的品牌與連結。'],c:['C · 圓弧收邊','用一段弧面，呼應剛看過的圓角照片。'],original:['現況 · 直接交接','保留目前霧藍與暖白的分界作為對照。']};
const frame=document.querySelector('iframe');
function sync(direction){document.querySelectorAll('[data-direction]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.direction===direction)));document.querySelector('#preview-title').textContent=variants[direction][0];document.querySelector('#preview-note').textContent=variants[direction][1];document.querySelector('#open-full').href=`stage.html?direction=${direction}`;frame.title=`${variants[direction][0]}互動預覽`;history.replaceState(null,'',`?direction=${direction}`)}
function select(direction){sync(direction);frame.src=`stage.html?direction=${direction}&p=0.45`}
document.querySelectorAll('[data-direction]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.direction)));
document.querySelectorAll('[data-size]').forEach(b=>{if(b.tagName!=='BUTTON')return;b.addEventListener('click',()=>{document.querySelector('.frame-wrap').dataset.size=b.dataset.size;document.querySelectorAll('button[data-size]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))})});
frame.addEventListener('load',()=>{const d=new URLSearchParams(frame.contentWindow.location.search).get('direction');if(Object.hasOwn(variants,d))sync(d)});
const initial=new URLSearchParams(location.search).get('direction');select(Object.hasOwn(variants,initial)?initial:'a');
