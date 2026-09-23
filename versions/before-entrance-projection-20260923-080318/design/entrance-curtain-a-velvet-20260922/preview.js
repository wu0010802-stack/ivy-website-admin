const $ = s => document.querySelector(s);
let engine, frame = 0, progress = 0, last = 0, playing = false, failed = false;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
function draw() {
  engine?.draw(progress);
  $('#progress').value = Math.round(progress * 1000);
  $('#time').value = `${(progress * 3.4).toFixed(1)} / 3.4 秒`;
  $('.opening-copy').style.opacity = Math.max(0, 1-progress/0.23);
  $('#curtain').style.visibility = progress >= 1 ? 'hidden' : 'visible';
  $('#stage').dataset.complete = String(progress >= 1);
  $('#stage').dataset.progress = progress;
  $('#pause').textContent = playing ? '暫停' : '繼續';
}
function stop(){ cancelAnimationFrame(frame); playing=false; draw(); }
function tick(now){ progress=Math.min(1,progress+(now-last)/3400);last=now;draw();if(progress>=1){stop();$('#status').textContent='開幕完成，可重播或拖曳細看';}else frame=requestAnimationFrame(tick); }
function play(restart=false){ if(!engine)return;stop();if(reduced.matches){progress=1;draw();$('#status').textContent='減少動態已略過，可拖曳查看靜態';return;}if(restart||progress>=1)progress=0;playing=true;last=performance.now();$('#status').textContent='播放中';frame=requestAnimationFrame(tick); }
$('#replay').onclick=()=>play(true);
$('#pause').onclick=()=>playing?stop():play();
$('#skip').onclick=()=>{progress=1;stop();};
$('#progress').oninput=()=>{const p=Number($('#progress').value)/1000;stop();progress=p;draw();$('#status').textContent='靜態比較';};
$('#full').onclick=()=>{document.body.classList.add('immersive');$('#exit').hidden=false;$('#exit').focus();play(true);};
function exit(){document.body.classList.remove('immersive');$('#exit').hidden=true;$('#full').focus();}
$('#exit').onclick=exit;document.addEventListener('keydown',e=>{if(e.key==='Escape')exit();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
reduced.addEventListener('change',()=>{if(reduced.matches){progress=1;stop();}});
function fail(){failed=true;progress=1;stop();$('#replay').disabled=$('#pause').disabled=$('#progress').disabled=true;$('#stage').dataset.renderer='fallback';$('#status').textContent='3D 無法啟用，已直接顯示首頁';}
$('#curtain').addEventListener('webglcontextlost',e=>{e.preventDefault();fail();});
window.addEventListener('pagehide',()=>{stop();engine?.dispose();engine=undefined;});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
const timer=setTimeout(fail,6000);
try{
 const {createEntranceCurtain}=await import('./velvet.js');
 if(failed)throw new Error('Preview loading timed out');
 engine=createEntranceCurtain($('#curtain'),$('#stage'));clearTimeout(timer);$('#stage').dataset.renderer='three';
 const p=new URLSearchParams(location.search).get('p');
 if(p!==null&&Number.isFinite(Number(p))){progress=Math.max(0,Math.min(1,Number(p)));draw();$('#status').textContent='靜態比較';}else play(true);
}catch(error){clearTimeout(timer);console.warn(error);fail();}
