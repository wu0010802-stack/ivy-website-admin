'use strict';
const moments = [
  { key:'hello', label:'早安入園', period:'一天的開始', type:'陪伴互動短片', english:'A LITTLE COURAGE', title:'有你在，\n我就安心了。', narrative:'剛開始，想再靠近你一點。\n一個擁抱、一句溫柔的回應，\n讓我慢慢準備好，走進今天。', learningTitle:'安心，是探索的第一步。', learning:'在被理解的關係裡，練習表達需要，也累積嘗試新事物的勇氣。', badge:'園方影片 · 陪伴互動情境', caption:'一個溫柔的回應，是安心的開始。', alt:'大人與孩子靠近彼此、溫柔互動的片刻', note:'影像取自園方廣告片的陪伴互動段落，作為入園故事情境示範。', questions:[['第一次上學，哭了怎麼辦？','參觀時，可以請園所說明初次入園的適應方式、老師如何陪伴，以及家長可以事先做哪些準備。'],['我怎麼了解孩子在校的狀況？','可以詢問家長與老師的聯繫方式、分享孩子日常的管道，以及需要特別關注時如何溝通。']] },
  { key:'discover', label:'好奇探索', period:'上午的發現', type:'探索學習短片', english:'FOLLOW THE WONDER', title:'我的「為什麼」，\n今天又多了一個。', narrative:'這是什麼？為什麼會這樣？\n用眼睛看，用小手試，\n再把我的發現，說給你聽。', learningTitle:'讓好奇，長出自己的答案。', learning:'從觀察、提問到動手嘗試，陪孩子練習思考，也練習說出自己的想法。', badge:'園方影片 · 探索學習情境', caption:'一個小問題，也能打開大大的世界。', alt:'孩子專心觀察、動手參與探索活動', note:'影像取自園方廣告片的探索情境，文案為日常故事提案。', questions:[['孩子平常接觸哪些學習活動？','可以詢問該校的探索活動、使用的素材，以及老師如何依年齡與孩子的興趣安排內容。'],['孩子的步調不一樣，怎麼陪伴？','參觀時，可請園所分享老師如何觀察孩子、調整引導方式，以及如何與家長討論孩子的需要。']] },
  { key:'lunch', label:'一起用餐', period:'午間的小事', type:'餐具準備短片', english:'I CAN TRY IT MYSELF', title:'「我自己來！」\n是今天的小進步。', narrative:'把小湯匙、餐碗準備好。\n一件一件，自己試試。\n原來，小小的我也可以照顧自己。', learningTitle:'生活的小事，成長的大事。', learning:'在每天重複的練習裡，認識身體的需要，也一點一點累積自理的信心。', badge:'園方影片 · 餐具準備情境', caption:'把餐具準備好，是自己來的第一步。', alt:'孩子自己拿取湯匙、面紙與整理紅色餐碗', note:'影片呈現餐具準備與自理片刻，並非實際進食或供餐紀錄。', questions:[['餐點與特殊飲食需求怎麼安排？','請向欲參觀的園所確認餐點內容、食物過敏與特殊飲食需求的溝通方式。'],['還不太會自己吃，會有人幫忙嗎？','可以詢問老師如何協助用餐，以及如何依孩子的發展與需要，陪伴生活自理的練習。']] },
  { key:'rest', label:'安靜片刻', period:'慢下來的午後', type:'午休實拍待補', english:'A LITTLE TIME TO REST', title:'小小的世界，\n也需要休息一下。', narrative:'把熱鬧的聲音調小，\n讓忙了一上午的自己，慢慢安靜。\n休息好了，再繼續今天的發現。', learningTitle:'慢下來，也是在好好長大。', learning:'學習察覺自己的感受，在安心的陪伴裡，找到動與靜之間的節奏。', badge:'分鏡示意 · 非實拍畫面', caption:'', pending:true, pendingTitle:'把今天的節奏，放慢一點。', pendingDescription:'整理寢具 → 安靜準備 → 老師輕聲陪伴', note:'午休實拍待補。此處為敘事與鏡頭示意；實際休息空間與安排，請向各校確認。', questions:[['孩子睡不著，或不習慣午休呢？','參觀時，可以了解園所如何陪伴還不習慣午休的孩子，以及有不同休息需求時的安排。'],['休息環境與照顧方式是什麼？','可以請園所帶你認識實際休息空間，並說明寢具、環境與老師的照顧方式。']] },
  { key:'outside', label:'午後玩耍', period:'午後的冒險', type:'戶外活動短片', english:'A WORLD TO EXPLORE', title:'和朋友一起，\n把今天玩得好大。', narrative:'跑一跑，看看身邊的新鮮事。\n有時候等一等朋友，\n有時候一起，試一個新的玩法。', learningTitle:'在遊戲裡，認識自己與別人。', learning:'活動身體、感受環境，也在和同伴相處的過程中，練習表達與互相等待。', badge:'園方影片 · 戶外活動情境', caption:'今天的快樂，想和你一起分享。', alt:'常春藤孩子在戶外草地上奔跑、遊戲', note:'影像取自園方廣告片的戶外遊戲段落，並不代表實際拍攝時段為午後。', questions:[['戶外活動都在哪裡進行？','各校空間不同，參觀時可了解園所使用的戶外場地、活動安排與老師的陪伴方式。'],['下雨或天氣太熱，怎麼安排？','可以詢問園所遇到雨天、高溫或其他天氣變化時，會如何調整當天的活動。']] },
  { key:'home', label:'帶故事回家', period:'把今天帶回家', type:'生活自理短片', english:'A STORY TO TAKE HOME', title:'今天的好多事，\n想第一個告訴你。', narrative:'拿好自己的東西，\n也帶上今天的小小發現。\n見到你的時候，再一件一件告訴你。', learningTitle:'小小的整理，也是自主的練習。', learning:'從留意自己的物品開始，練習照顧自己；也把校園裡的發現，帶回家人的對話裡。', badge:'園方影片 · 整理書包情境', caption:'把今天的新發現，帶回最熟悉的懷抱。', alt:'孩子拿取物品、整理藍綠色書包與拉網袋拉鍊', note:'影像為園方影片中的整理書包情境，搭配離園故事示範，並非真實接送紀錄。', questions:[['接送時，有哪些需要先知道？','請向園所確認接送流程、接送人員的確認方式，以及臨時變更安排時如何聯繫。'],['怎麼和老師一起了解孩子的成長？','可以詢問園所平時分享日常觀察的方式，以及家長想進一步討論時可使用的聯繫管道。']] }
];

const $ = selector => document.querySelector(selector);
const tabs = [...document.querySelectorAll('[role="tab"]')];
const video = $('#scene-video');
const toggle = $('#play-toggle');
const dialog = $('#film-dialog');
const film = $('#film-video');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let current = 0;
let generation = 0;
let userPaused = motion.matches;
let inView = true;
let failed = false;

const illustrations = {
  lunch:'<svg viewBox="0 0 220 180" aria-hidden="true"><ellipse cx="110" cy="108" rx="61" ry="36"/><ellipse cx="110" cy="108" rx="43" ry="24"/><path d="M20 55v35q0 12 10 12t10-12V55M30 55v104M192 55v104M192 55q-20 32 0 45M96 43q-7 9 0 17M114 34q-7 9 0 17M132 43q-7 9 0 17"/></svg>',
  rest:'<svg viewBox="0 0 220 180" aria-hidden="true"><path d="M143 22c-36 2-46 56-9 70-40 18-70-7-66-36 3-25 35-44 75-34ZM49 125h122v36H49ZM49 135h122M61 123v-11h42v11M32 149h17M171 149h17M33 147v25M187 147v25M172 29v17M164 37h16M187 73v12M181 79h12"/></svg>'
};
function lines(element, value) {
  element.replaceChildren(...value.split('\n').flatMap((line, i) => i ? [document.createElement('br'), document.createTextNode(line)] : [document.createTextNode(line)]));
}
function updateControl() {
  toggle.innerHTML = video.paused ? '<span aria-hidden="true">▷</span> 播放片刻' : '<span aria-hidden="true">Ⅱ</span> 暫停影片';
}
async function reconcilePlayback() {
  const request = ++generation;
  const m = moments[current];
  if (m.pending || userPaused || !inView || document.hidden || dialog.open || failed) {
    video.pause();
    updateControl();
    return;
  }
  const path = `media/${m.key}.mp4`;
  if (video.getAttribute('src') !== path) video.src = path;
  try {
    await video.play();
    if (request !== generation) return;
    video.classList.add('is-playing');
  } catch {
    if (request === generation) video.classList.remove('is-playing');
  }
  updateControl();
}
function showMoment(index, focusTab = false) {
  current = (index + moments.length) % moments.length;
  const m = moments[current];
  ++generation;
  video.pause();
  video.classList.remove('is-playing');
  video.removeAttribute('src');
  video.load();
  failed = false;
  $('#video-progress').style.transform = 'scaleX(0)';
  tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === current)); tab.tabIndex = i === current ? 0 : -1; });
  $('#story').setAttribute('aria-labelledby', `tab-${m.key}`);
  $('#story').dataset.moment = m.key;
  $('#moment-period').textContent = m.period;
  $('#moment-type').textContent = m.type;
  $('#moment-count').innerHTML = `${String(current + 1).padStart(2, '0')} <span>/ 06</span>`;
  $('#story-label').textContent = m.label;
  $('#story-english').textContent = m.english;
  lines($('#story-title'), m.title);
  lines($('#story-narrative'), m.narrative);
  $('#learning-title').textContent = m.learningTitle;
  $('#learning-copy').textContent = m.learning;
  $('#scene-badge').textContent = m.badge;
  $('#scene-caption').textContent = m.caption;
  $('#source-note').textContent = m.note;
  $('#continue-story').innerHTML = `${current === 5 ? '再看一次：' : '接著看：'}${moments[(current+1)%6].label} <span aria-hidden="true">→</span>`;
  $('#scene-image').hidden = !!m.pending;
  video.hidden = !!m.pending;
  $('#scene-bottom').hidden = !!m.pending;
  $('#enlarge').hidden = !!m.pending;
  $('.video-track').hidden = !!m.pending;
  $('#pending-scene').hidden = !m.pending;
  toggle.hidden = false;
  if (m.pending) {
    $('#pending-scene').innerHTML = `${illustrations[m.key]}<p class="pending-title">${m.pendingTitle}</p><p class="pending-description">${m.pendingDescription}</p><span class="pending-label">${m.label === '一起用餐' ? '用餐' : '午休'}實拍片段準備中</span>`;
  } else {
    $('#scene-image').src = `media/${m.key}.webp`;
    $('#scene-image').alt = m.alt;
    video.poster = `media/${m.key}.webp`;
  }
  $('#parent-questions').innerHTML = '<p class="eyebrow">家長想知道</p>' + m.questions.map(([q,a]) => `<details><summary>${q}<span aria-hidden="true">＋</span></summary><p>${a}</p></details>`).join('');
  if (focusTab) tabs[current].focus({ preventScroll:true });
  const strip = $('#chapter-tabs');
  const rect = tabs[current].getBoundingClientRect(), parentRect = strip.getBoundingClientRect();
  if (rect.left < parentRect.left) strip.scrollLeft -= parentRect.left - rect.left + 4;
  if (rect.right > parentRect.right) strip.scrollLeft += rect.right - parentRect.right + 4;
  reconcilePlayback();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => showMoment(index));
  tab.addEventListener('keydown', event => {
    const targets = {ArrowRight:(index+1)%6,ArrowLeft:(index+5)%6,Home:0,End:5};
    if (targets[event.key] !== undefined) { event.preventDefault(); showMoment(targets[event.key], true); }
  });
});
$('#previous').addEventListener('click', () => showMoment(current - 1));
$('#next').addEventListener('click', () => showMoment(current + 1));
$('#continue-story').addEventListener('click', () => {
  showMoment(current + 1, true);
  $('#chapter-tabs').scrollIntoView({ block:'start', behavior:'instant' });
});
toggle.addEventListener('click', () => { userPaused = !video.paused; reconcilePlayback(); });
video.addEventListener('play', updateControl);
video.addEventListener('pause', updateControl);
video.addEventListener('timeupdate', () => {
  if (Number.isFinite(video.duration) && video.duration > 0) $('#video-progress').style.transform = `scaleX(${video.currentTime/video.duration})`;
});
video.addEventListener('error', () => {
  if (!video.getAttribute('src')) return;
  failed = true;
  video.classList.remove('is-playing');
  toggle.hidden = true;
  $('#enlarge').hidden = true;
  $('#scene-caption').textContent = '影片暫時無法播放，先看看這個片刻的照片。';
});
$('#enlarge').addEventListener('click', () => {
  const m = moments[current];
  if (m.pending) return;
  $('#film-title').textContent = `${m.label} · 校園片刻`;
  $('#film-description').textContent = `${m.alt}。${m.note}（無聲片段）`;
  film.src = `media/${m.key}.mp4`;
  film.poster = `media/${m.key}.webp`;
  dialog.showModal();
  reconcilePlayback();
});
$('#close-film').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { film.pause(); film.removeAttribute('src'); film.load(); reconcilePlayback(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) film.pause(); reconcilePlayback(); });
motion.addEventListener('change', () => { userPaused = motion.matches; if (motion.matches) video.classList.remove('is-playing'); reconcilePlayback(); });
if ('IntersectionObserver' in window) new IntersectionObserver(entries => { inView = entries[0].isIntersecting; reconcilePlayback(); }, {threshold:.1}).observe($('#scene'));
showMoment(0);
