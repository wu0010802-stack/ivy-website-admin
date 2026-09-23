// 內容取自 web/server/data/site-fixture.json 的 dayExperience.moments
const moments = [
  { key: 'lunch', n: '03', label: '一起用餐', time: '11:40', tint: 'peach', photo: 'day-lunch', icon: 'fork-knife', alt: '孩子拿取湯匙與面紙，練習準備餐具', title: ['「我自己來！」', '是今天的小進步。'], story: '洗洗手、準備用餐，也練習照顧自己。每天重複的小事情，都可以成為成長的練習。', question: '餐點、飲食需求與自理練習怎麼安排？', answer: '參觀時可詢問餐點安排、食物過敏或特殊飲食需求的溝通方式，以及老師如何協助孩子練習用餐。' },
  { key: 'discover', n: '02', label: '好奇探索', time: '09:10', tint: 'mint', photo: 'day-discover', icon: 'magnifying-glass', alt: '老師陪伴孩子操作幾何教具', title: ['我的「為什麼」，', '今天又多了一個。'], story: '摸一摸、看一看，再和同伴試一次。那些讓眼睛發亮的小發現，是認識世界的開始。', question: '孩子平常會接觸哪些學習活動？', answer: '可以詢問該校如何安排探索活動、使用哪些教具與素材，以及如何依照年齡和孩子的興趣調整內容。' },
];

const directions = [
  { key: 'a', title: '對光透字', subtitle: '游標是一盞紙後面的燈', level: 1,
    desc: '<strong>平常看不到，靠近才透出來。</strong><br>滑鼠移到相紙上，光從紙後透過來，隱約看見背面的橫線與反向字跡，像把照片舉起來對著光看。',
    trigger: '滑鼠靠近；手機在停留的那張掃過一次光', reduce: '保留滑鼠透光，不做掃光', site: '正面貼圖取背面鏡像，依現有游標點光源衰減混入' },
  { key: 'b', title: '捲動飄角', subtitle: '膠帶只黏上緣，下緣會被風掀起', level: 2,
    desc: '<strong>不自動播放，只回應你的捲動。</strong><br>捲得越快，右下折角掀得越高（32→最多 52px），停下時回彈一次收回；紙也順著膠帶微微擺動。',
    trigger: '頁面捲動，手機滑動一樣有效', reduce: '不做，維持靜態折角', site: '沿用 setEar() 單一時鐘；手機捲動中本來就是 CSS 版' },
  { key: 'c', title: '包邊貼紙', subtitle: '半顆好寶寶貼紙，另一半在背面', level: 2,
    desc: '<strong>靜態、不靠動畫的好奇心。</strong><br>每個時刻一枚圖示貼紙，貼在紙緣再折到背面：正面只看得到半顆，翻過去才湊齊。',
    trigger: '不用觸發，常駐', reduce: '不受影響', site: '正反貼圖各畫半顆；六枚圖示皆用 Phosphor Regular' },
];

const EAR_FRONT = '<span class="ear" aria-hidden="true"><svg viewBox="0 0 100 100" focusable="false"><path class="ear-paper" d="M0 0Q48 7 100 0L0 100Q7 48 0 0Z"/><path class="ear-lines" d="M2 21H79M3 42H58M3 63H37M2 84H16"/></svg></span>';
const EAR_BACK = '<span class="ear" aria-hidden="true"><svg viewBox="0 0 100 100" focusable="false"><path class="ear-paper" d="M0 0Q48 7 100 0L0 100Q7 48 0 0Z"/></svg></span>';

function cardHTML(d, m) {
  const id = `story-${d.key}-${m.key}`;
  const back = `<p class="kicker">${m.n} / ${m.label}</p><p class="story">${m.story}</p><div class="ask"><p class="question">${m.question}</p><p class="answer">${m.answer}</p></div>`;
  const sticker = d.key === 'c' ? `<span class="sticker" aria-hidden="true"><svg><use href="#ph-${m.icon}"/></svg></span>` : '';
  const ghost = d.key === 'a' ? `<div class="ghost" aria-hidden="true"><div class="ghost-in">${back}</div></div><span class="glow" aria-hidden="true"></span>` : '';
  return `<div class="card tint-${m.tint}" data-label="${m.label}">
    <div class="sway"><div class="print">
      <span class="tape" aria-hidden="true"></span>
      <div class="face front">
        <figure class="photo"><img src="../../web/public/assets/${m.photo}.webp" alt="${m.alt}"><time class="stamp" datetime="${m.time}">${m.time}</time></figure>
        <div class="foot"><p class="kicker">${m.n} / ${m.label}</p><h3>${m.title.join('<br>')}</h3></div>
        ${ghost}${sticker}${EAR_FRONT}
      </div>
      <div class="face back" id="${id}" inert>${back}${sticker}${EAR_BACK}</div>
    </div></div>
    <button class="turn" type="button" aria-expanded="false" aria-controls="${id}" aria-label="${d.key.toUpperCase()} 版：翻到背面，看「${m.label}」的故事"></button>
  </div>`;
}

document.querySelector('.directions').innerHTML = directions.map(d => `
  <article class="direction v-${d.key}" data-direction="${d.key}" aria-labelledby="heading-${d.key}">
    <div class="direction-head"><span class="letter" aria-hidden="true">${d.key.toUpperCase()}</span><div><h2 id="heading-${d.key}">${d.title}</h2><p>${d.subtitle}</p></div></div>
    <div class="stack">${moments.map(m => cardHTML(d, m)).join('')}</div>
    <div class="description"><p>${d.desc}</p>
      <dl class="meta">
        <dt>明顯度</dt><dd><span class="dots" role="img" aria-label="三級中的第 ${d.level} 級">${[1, 2, 3].map(i => `<i class="${i <= d.level ? 'on' : ''}"></i>`).join('')}</span></dd>
        <dt>觸發</dt><dd>${d.trigger}</dd><dt>減少動態</dt><dd>${d.reduce}</dd><dt>接進官網</dt><dd>${d.site}</dd>
      </dl>
    </div>
  </article>`).join('');

const params = new URLSearchParams(location.search);
const still = params.has('still');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const noHover = matchMedia('(hover: none)');
const view = ['a', 'b', 'c'].includes(params.get('view')) ? params.get('view') : 'all';
document.body.dataset.view = view;
document.querySelector(`.intro-aside [data-view="${view}"]`).setAttribute('aria-current', 'page');
document.querySelectorAll('.direction').forEach(el => { el.hidden = view !== 'all' && el.dataset.direction !== view; });
const setVar = (el, name, value) => el.style.setProperty(name, value);

/* 翻面：永遠右緣掀起往左翻（半圈累加），與官網 printFlip.ts 同方向 */
for (const card of document.querySelectorAll('.card')) {
  const button = card.querySelector('.turn');
  const letter = card.closest('.direction').dataset.direction.toUpperCase();
  button.addEventListener('click', () => {
    const turn = (Number(card.dataset.turn) || 0) - 1;
    const flipped = turn % 2 !== 0;
    card.dataset.turn = String(turn);
    setVar(card, '--flip', `${turn * 180}deg`);
    card.classList.toggle('is-flipped', flipped);
    card.classList.remove('is-lit');
    card.querySelector('.front').inert = flipped;
    card.querySelector('.back').inert = !flipped;
    button.setAttribute('aria-expanded', String(flipped));
    button.setAttribute('aria-label', `${letter} 版：${flipped ? `回到「${card.dataset.label}」的照片` : `翻到背面，看「${card.dataset.label}」的故事`}`);
  });
}

/* ── A 對光透字 ── */
const aCards = [...document.querySelectorAll('.v-a .card')];
function placeLight(card, x, y) {
  setVar(card, '--lx', `${x.toFixed(1)}px`);
  setVar(card, '--ly', `${y.toFixed(1)}px`);
}
for (const card of aCards) {
  const button = card.querySelector('.turn');
  const light = { x: 0, y: 0, tx: 0, ty: 0, frame: 0 };
  const follow = () => {
    light.x += (light.tx - light.x) * 0.18;
    light.y += (light.ty - light.y) * 0.18;
    placeLight(card, light.x, light.y);
    light.frame = Math.hypot(light.tx - light.x, light.ty - light.y) > 0.3 ? requestAnimationFrame(follow) : 0;
  };
  button.addEventListener('pointerenter', e => {
    if (e.pointerType === 'touch' || card.classList.contains('is-flipped')) return;
    light.x = light.tx = e.offsetX;
    light.y = light.ty = e.offsetY;
    placeLight(card, light.x, light.y);
    card.classList.add('is-lit');
  });
  button.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    light.tx = e.offsetX;
    light.ty = e.offsetY;
    if (!card.classList.contains('is-flipped')) card.classList.add('is-lit');
    if (!light.frame) light.frame = requestAnimationFrame(follow);
  });
  button.addEventListener('pointerleave', () => card.classList.remove('is-lit'));
}
// 手機沒有游標：停留的那張，光沿相紙下緣掃過一次
function sweep(card) {
  if (reduced.matches || card.classList.contains('is-flipped') || card.dataset.sweeping) return;
  card.dataset.sweeping = '1';
  const w = card.offsetWidth, h = card.offsetHeight, start = performance.now(), MS = 2400;
  card.classList.add('is-lit');
  const step = now => {
    const t = Math.min(1, (now - start) / MS);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    placeLight(card, w * (0.12 + 0.76 * e), h * (0.8 - 0.1 * Math.sin(Math.PI * e)));
    if (t > 0.78) card.classList.remove('is-lit');
    if (t < 1) requestAnimationFrame(step);
    else delete card.dataset.sweeping;
  };
  requestAnimationFrame(step);
}
const sweepObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting && noHover.matches) {
    setTimeout(() => sweep(entry.target), 500);
    sweepObserver.unobserve(entry.target);
  }
}, { threshold: 0.75 });
if (!still) aCards.forEach(card => sweepObserver.observe(card));

/* ── B 捲動飄角：捲動速度 → 目標折角；欠阻尼彈簧，停下回彈一次 ── */
const EAR_REST = 32, EAR_MAX = 52;
const springs = [...document.querySelectorAll('.v-b .card')].map(card => ({ card, ear: EAR_REST, earV: 0, sway: 0, swayV: 0 }));
let velocity = 0, lastY = scrollY, lastScrollAt = performance.now(), prevFrame = 0, bFrame = 0;
function kickB() {
  if (bFrame || reduced.matches || still) return;
  prevFrame = performance.now();
  bFrame = requestAnimationFrame(tickB);
}
addEventListener('scroll', () => {
  const now = performance.now();
  const v = (scrollY - lastY) / Math.max(16, now - lastScrollAt) * 1000;
  lastY = scrollY;
  lastScrollAt = now;
  velocity = velocity * 0.5 + v * 0.5;
  kickB();
}, { passive: true });
function tickB(now) {
  const dt = Math.min(0.05, (now - prevFrame) / 1000);
  prevFrame = now;
  if (now - lastScrollAt > 60) velocity *= 0.02 ** dt;
  let moving = Math.abs(velocity) > 4;
  for (const s of springs) {
    const target = EAR_REST + Math.min(EAR_MAX - EAR_REST, Math.abs(velocity) / 110);
    s.earV += (190 * (target - s.ear) - 13 * s.earV) * dt;
    s.ear = Math.max(26, s.ear + s.earV * dt);
    const swayTarget = Math.max(-1, Math.min(1, velocity / 2600)) * 0.7;
    s.swayV += (120 * (swayTarget - s.sway) - 9 * s.swayV) * dt;
    s.sway += s.swayV * dt;
    if (Math.abs(s.earV) > 0.4 || Math.abs(target - s.ear) > 0.1 || Math.abs(s.swayV) > 0.01 || Math.abs(swayTarget - s.sway) > 0.004) moving = true;
    setVar(s.card, '--ear', `${s.ear.toFixed(2)}px`);
    setVar(s.card, '--lift', ((s.ear - EAR_REST) / (EAR_MAX - EAR_REST)).toFixed(3));
    setVar(s.card, '--sway', `${s.sway.toFixed(3)}deg`);
  }
  if (moving) bFrame = requestAnimationFrame(tickB);
  else {
    bFrame = 0;
    velocity = 0;
    for (const s of springs) {
      Object.assign(s, { ear: EAR_REST, earV: 0, sway: 0, swayV: 0 });
      ['--ear', '--lift', '--sway'].forEach(name => s.card.style.removeProperty(name));
    }
  }
}
// 桌機示意用：模擬一陣快速捲動
function gustB() {
  velocity = 2300;
  lastScrollAt = performance.now() + 350; // 當作持續捲動 0.35 秒，之後才開始衰減
  kickB();
}

/* ── 控制列 ── */
const replay = document.querySelector('.replay');
replay.addEventListener('click', () => { aCards.forEach(sweep); gustB(); });
const earToggle = document.querySelector('.toggle-ear');
earToggle.addEventListener('click', () => {
  const on = earToggle.getAttribute('aria-pressed') !== 'true';
  earToggle.setAttribute('aria-pressed', String(on));
  document.body.classList.toggle('no-ear', !on);
});
if (params.get('ear') === '0') earToggle.click();
function applyMotionPreference() { replay.disabled = reduced.matches; }
reduced.addEventListener('change', applyMotionPreference);
applyMotionPreference();

/* ?still=1：截圖用定格（A 光停在下緣、B 折角掀到 48px） */
if (still) {
  for (const card of aCards) {
    placeLight(card, card.offsetWidth * 0.3, card.offsetHeight * 0.64);
    card.classList.add('is-lit');
  }
  for (const s of springs) {
    setVar(s.card, '--ear', '48px');
    setVar(s.card, '--lift', '.8');
    setVar(s.card, '--sway', '.45deg');
  }
}
