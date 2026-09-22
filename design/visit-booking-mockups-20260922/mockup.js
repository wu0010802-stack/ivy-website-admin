'use strict';
const campuses = window.CAMPUSES;
const params = new URLSearchParams(location.search);
const direction = ['a','b','c'].includes(params.get('direction')) ? params.get('direction') : 'a';
const initialCampus = campuses.find(c => c.key === params.get('campus'))?.key || '';
const state = { campus: initialCampus, step: 1, parentName: '', phone: '', age: '', time: '', questions: '', consent: false, done: false };
const isPaused = params.get('state') === 'paused';
const main = document.querySelector('main');
const bookingDialog = document.querySelector('#booking-dialog');
const noticeDialog = document.querySelector('#notice-dialog');
const esc = v => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const current = () => campuses.find(c => c.key === state.campus);
const asset = c => `../../web/public/assets/${c.image}.webp`;
const nameOf = () => current()?.name || '你選擇的校園';
document.body.classList.add(`direction-${direction}`);
if(params.get('capture')==='1')document.body.classList.add('capture');
document.title = `${direction.toUpperCase()} · ${ {a:'一步一步，安心預約',b:'一頁完成，快速聯絡',c:'先逛校園，再約見面'}[direction]}｜常春藤`;

function choice(c,i,kind) {
  const copy=`<span class="choice-copy"><strong>${c.name}</strong><small>${c.district}</small>${kind==='c'?'':`<p>${c.address.replace('高雄市','')}</p>`}</span>`;
  const photo=`<img src="${asset(c)}" alt="" width="240" height="140">`;
  const dot='<span class="selection-dot" aria-hidden="true"></span>';
  const content=kind==='a'?`${photo}${copy}${dot}`:kind==='b'?`<span class="photo">${photo}${dot}</span>${copy}`:`<span class="ordinal" aria-hidden="true">0${i+1}</span>${copy}${dot}`;
  return `<label class="campus-choice"><input type="radio" name="campus" value="${c.key}" ${state.campus===c.key?'checked':''}><span class="choice-content">${content}</span></label>`;
}
function mini(change=true){const c=current();return c?`<div class="chosen-mini"><img src="${asset(c)}" alt="${c.name}校舍"><div><strong>${c.name}</strong><p>${c.address}</p></div>${change?'<button class="text-button" type="button" data-action="change-campus">更換校區</button>':''}</div>`:'';}
function stepper(){return `<ol class="stepper" aria-label="預約進度"><li ${state.step===1?'aria-current="step"':''}><b>1</b>選擇校園</li><li ${state.step===2?'aria-current="step"':''}><b>2</b>留下聯絡方式</li></ol>`;}
function options(values,key){return values.map(v=>`<option value="${v}" ${state[key]===v?'selected':''}>${v||'請選擇（選填）'}</option>`).join('');}
function form(){
 return `<form id="visit-form" novalidate method="post">
   <h2 class="form-heading">留下聯絡方式</h2><p class="form-intro">${nameOf()}將與你聯繫，一起確認適合的參觀時間。</p>
   ${direction==='a'?mini():''}
   <div class="form-grid" style="${direction!=='a'?'margin-top:22px':''}">
     <div class="field"><label for="parent-name">家長稱呼<small>必填</small></label><input id="parent-name" name="parentName" autocomplete="name" maxlength="40" required placeholder="例如：陳媽媽" value="${esc(state.parentName)}" aria-describedby="parent-name-error"><p id="parent-name-error" class="error"></p></div>
     <div class="field"><label for="phone">手機號碼<small>必填</small></label><input id="phone" name="phone" type="tel" autocomplete="tel-national" inputmode="tel" maxlength="10" pattern="09[0-9]{8}" required placeholder="09xxxxxxxx" value="${esc(state.phone)}" aria-describedby="phone-error"><p id="phone-error" class="error"></p></div>
   </div>
   <details class="optional" ${state.age||state.time||state.questions?'open':''}><summary>多告訴我們一點 <small>選填</small></summary><div class="form-grid">
     <div class="field"><label for="age">孩子年齡</label><select id="age" name="age">${options(['','尚未確定','2 歲以下','2–3 歲','3–4 歲','4–5 歲','5–6 歲'],'age')}</select></div>
     <div class="field"><label for="time">方便接電話的時段</label><select id="time" name="time" aria-describedby="time-hint">${options(['','時間彈性','平日上午','平日下午','其他，另行確認'],'time')}</select><p id="time-hint" class="field-hint">這是聯絡時段，參觀時間將另行確認。</p></div>
     <div class="field full"><label for="questions">有沒有想先了解的事？</label><textarea id="questions" name="questions" maxlength="500" placeholder="例如：課程安排、生活照顧、入學準備……">${esc(state.questions)}</textarea></div>
   </div></details>
   <label class="consent"><input name="consent" id="consent" type="checkbox" required ${state.consent?'checked':''} aria-describedby="consent-error"><span>我同意園所使用上述資料，聯繫本次參觀需求。</span></label>
   <p id="consent-error" class="error"></p><button class="notice-link" type="button" data-action="notice">個資告知與提案說明</button>
   <p id="form-error" class="error" role="alert"></p>
   <div class="submit-row"><p class="submit-note">送出後，由園所聯繫確認。<br>尚不代表預約成立。</p><button type="submit" class="button primary">送出參觀需求 <span aria-hidden="true">→</span></button></div>
 </form>`;
}
function result(){return `<section class="result" tabindex="-1"><div class="result-mark">流程示範完成 · 資料未送出</div><h2>我們期待與你相遇。</h2><p>正式送出後，會顯示「已收到你的參觀需求」，並由${nameOf()}聯繫確認時間。</p><dl><dt>意向校區</dt><dd>${nameOf()}</dd><dt>家長稱呼</dt><dd>${esc(state.parentName)}</dd><dt>手機號碼</dt><dd>${esc(state.phone)}</dd><dt>接電話時段</dt><dd>${esc(state.time)||'未指定'}</dd></dl><p class="result-note">這份 mock-up 沒有建立預約，也不會通知園所。</p><div class="result-actions"><button class="button primary" data-action="edit">返回修改</button><button class="button" data-action="restart">重新體驗</button></div></section>`;}
function paused(){const c=current();return `<section class="paused"><span class="eyebrow">參觀方式</span><h2>歡迎直接聯絡${c.name}</h2><p>目前暫停線上參觀申請。你可以致電園所，了解參觀安排。</p><a class="button primary" href="tel:${c.phone}">致電${c.name} · ${c.phone}</a>${c.line?`<p><a class="text-button" href="${c.line}" target="_blank" rel="noopener noreferrer">LINE 聯絡義華校 ↗</a></p>`:''}<p class="field-hint">以上為暫停狀態提案；各校實際開放狀況依官網設定。</p><button type="button" class="text-button" data-action="change-campus">看看其他校區</button></section>`;}
function renderA(){
 main.innerHTML=`<div class="wrap"><div class="breadcrumb">首頁 / 預約校園參觀</div><section class="a-shell"><aside class="a-story"><div class="a-story-copy"><span class="eyebrow" lang="en">A LITTLE VISIT, A NEW BEGINNING</span><h1>帶著好奇，<br>來校園<em>走走。</em></h1><p>看看孩子未來的日常，<br>也和我們聊聊你的期待。<br>從一所離生活近一點的校園開始。</p></div><figure><img src="../../web/public/assets/campus.webp" alt="義華校的戶外廣場與校舍"><figcaption><span>在常春藤，遇見成長的下一站。</span><span>義華校</span></figcaption></figure></aside><div class="a-right">${!state.done?stepper():''}<div id="a-content">${state.done?result():state.step===1?`<h2>想先認識哪所校園？</h2><p class="a-intro">依照你的生活圈與接送路線選擇。</p><fieldset><legend class="sr-only">選擇想參觀的校區</legend><div class="a-choices">${campuses.map((c,i)=>choice(c,i,'a')).join('')}</div></fieldset><p class="error" id="campus-error" role="alert"></p><div class="a-next"><p>選好校園後，<br>只需留下稱呼與手機號碼。</p><button type="button" class="button primary" data-action="next">下一步：聯絡方式 <span aria-hidden="true">→</span></button></div>`:isPaused?paused():form()}</div></div></section></div>`;
}
function summary(){const c=current();return `<span class="eyebrow" lang="en">YOUR CAMPUS VISIT</span><h3>${c?c.name:'一趟參觀，慢慢認識。'}</h3><p>${c?c.address:'選好校園，剩下的交給我們一起安排。'}</p><hr><ol><li><b>01</b><span>留下參觀需求<small>先讓我們知道怎麼聯絡你。</small></span></li><li><b>02</b><span>園所聯繫確認<small>一起討論合適的參觀時間。</small></span></li><li><b>03</b><span>帶著期待，來校園看看<small>實際安排以園所確認為準。</small></span></li></ol>${c?`<a class="text-button" href="tel:${c.phone}">也可以致電 ${c.phone}</a>`:''}`;}
function renderB(){main.innerHTML=`<div class="wrap"><div class="breadcrumb">首頁 / 預約校園參觀</div><section class="b-top"><div><span class="eyebrow" lang="en">LET'S MEET AT IVY</span><h1>預約校園參觀</h1><p>選一所校園，留一個聯絡方式。一起安排第一次見面。</p></div><div class="b-promise">留下需求後，園所會聯繫你。<br>參觀時間將由雙方確認。</div></section><fieldset><legend class="section-label"><b>01</b> 想參觀哪所校園？</legend><div class="b-choices">${campuses.map((c,i)=>choice(c,i,'b')).join('')}</div></fieldset><div class="b-body"><section class="b-form" id="b-form-area">${state.done?result():current()?isPaused?paused():form():`<div class="section-label"><b>02</b> 留下聯絡方式</div><div class="no-selection"><div><b>先選一所校園。</b><p>選擇上方校區，<br>接著留下稱呼與手機號碼。</p></div><div class="ghost-fields" aria-hidden="true"><i></i><i></i><i></i></div></div>`}</section><aside class="b-summary" id="b-summary">${summary()}</aside></div></div>`;}
function cInfo(){const c=current();return c?`<div><h2>${c.name}</h2><p>${c.address}</p></div><button type="button" class="button primary round" data-action="open-booking">${isPaused?'查看聯絡方式':`預約參觀${c.name}`}</button>`:`<div><h2>五所校園，同一份用心。</h2><p>先從你熟悉的生活圈，認識常春藤。</p></div><p class="empty-invite">選擇一所校園，<br>看看位置，也預約一次見面。</p>`;}
function renderC(){const c=current()||campuses[0];main.innerHTML=`<div class="wrap"><div class="breadcrumb">首頁 / 預約校園參觀</div><section class="c-top"><div><span class="eyebrow" lang="en">COME FOR A VISIT</span><h1>孩子的下一站，<br>我們一起看看。</h1></div><p>照片裡的校園，期待與你見面。<br>選一個方便接送的地點，<br>帶著想了解的事，親自走一趟。</p></section><section class="c-stage"><div class="c-picker"><fieldset><legend>想先認識哪所校園？</legend><div class="c-choices">${campuses.map((c,i)=>choice(c,i,'c')).join('')}</div></fieldset><p>五校位於高雄不同生活圈。<br>可先考慮居家或工作地點的接送路線。</p></div><div class="c-visual"><figure class="c-photo"><img id="c-photo" src="${asset(c)}" alt="${c.name}校園外觀"><figcaption id="c-caption">${current()?c.name+' · '+c.district:'校園一瞥 · 義華校'}</figcaption></figure><div class="c-info" id="c-info">${cInfo()}</div></div></section><section class="c-bottom" aria-label="參觀時可以聊聊"><article><b>01</b><div><h3>看看日常的空間</h3><p>教室、活動空間與孩子的生活環境。</p></div></article><article><b>02</b><div><h3>聊聊你在意的事</h3><p>課程、生活照顧與第一次入園的準備。</p></div></article><article><b>03</b><div><h3>找到適合的步調</h3><p>各校參觀內容與時間，由園所另行確認。</p></div></article></section></div>`;}
function render(){({a:renderA,b:renderB,c:renderC}[direction])();}
function renderDrawer(){document.querySelector('#dialog-body').innerHTML=`<div class="dialog-kicker">預約校園參觀</div><h2 id="dialog-title">${nameOf()}，期待見面。</h2>${mini(true)}${state.done?result():isPaused?paused():form()}`;}
function focusContent(selector){const el=document.querySelector(selector);if(!el)return;el.setAttribute('tabindex','-1');el.focus({preventScroll:true});el.scrollIntoView({block:'start',behavior:'instant'});}
function changeCampus(){if(bookingDialog.open){bookingDialog.close();focusContent('.c-picker');return;}state.step=1;state.done=false;if(direction==='b'){focusContent('.b-choices');return;}render();focusContent('.a-right');}
function updateSelection(value){state.campus=value;state.done=false;document.querySelector('#campus-error')?.replaceChildren();if(direction==='b'){document.querySelector('#b-form-area').innerHTML=isPaused?paused():form();document.querySelector('#b-summary').innerHTML=summary();}else if(direction==='c'){const c=current();document.querySelector('#c-photo').src=asset(c);document.querySelector('#c-photo').alt=c.name+'校園外觀';document.querySelector('#c-caption').textContent=c.name+' · '+c.district;document.querySelector('#c-info').innerHTML=cInfo();}}
function validate(formEl){let invalid=[];for(const [id,message] of [['parent-name','請填寫家長稱呼。'],['phone','請填寫 09 開頭的 10 碼手機號碼。'],['consent','請勾選同意後繼續。']]){const field=formEl.querySelector('#'+id);const valid=field.checkValidity()&&(id!=='parent-name'||field.value.trim().length>0);formEl.querySelector('#'+id+'-error').textContent=valid?'':message;field.setAttribute('aria-invalid',String(!valid));if(!valid)invalid.push(field);}if(invalid.length){formEl.querySelector('#form-error').textContent='還有資料需要確認，請查看標示的欄位。';invalid[0].focus();return false;}return true;}
document.addEventListener('change',e=>{const t=e.target;if(t.name==='campus')updateSelection(t.value);else if(t.name in state){state[t.name]=t.type==='checkbox'?t.checked:t.value;if(t.type==='checkbox'&&t.checked)document.querySelector('#consent-error').textContent='';}});
document.addEventListener('input',e=>{const t=e.target;if(t.name in state&&t.name!=='campus'){state[t.name]=t.value;t.removeAttribute('aria-invalid');document.querySelector('#'+t.id+'-error')?.replaceChildren();document.querySelector('#form-error')?.replaceChildren();}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(e.target.closest('.close-dialog'))e.target.closest('dialog').close();if(!b)return;switch(b.dataset.action){case 'next':if(!current()){document.querySelector('#campus-error').textContent='請先選擇想參觀的校區。';document.querySelector('[name=campus]').focus();return;}state.step=2;render();focusContent('.a-right');break;case 'change-campus':changeCampus();break;case 'open-booking':renderDrawer();bookingDialog.showModal();break;case 'notice':noticeDialog.showModal();break;case 'edit':state.done=false;if(direction==='c'){renderDrawer();focusContent('#dialog-title');}else{render();focusContent('#visit-form');}break;case 'restart':Object.assign(state,{campus:'',step:1,parentName:'',phone:'',age:'',time:'',questions:'',consent:false,done:false});bookingDialog.close();render();focusContent('#main');break;}});
document.addEventListener('submit',e=>{e.preventDefault();if(e.target.id!=='visit-form'||!current()||isPaused)return;if(!validate(e.target))return;state.done=true;if(direction==='c'){renderDrawer();focusContent('.result');}else{render();focusContent('.result');}});
for(const d of [bookingDialog,noticeDialog])d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});
render();
