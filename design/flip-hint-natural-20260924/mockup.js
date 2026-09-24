import * as THREE from 'three';

// 內容取自 web/server/data/site-fixture.json 的 dayExperience.moments
const M = {
  rest: { key: 'rest', n: '04', label: '安靜片刻', time: '12:30', tint: 'cream', photo: 'classroom', alt: '義華校明亮的教室空間，作為安靜片刻的空間參考', title: ['小小的世界，', '也需要休息一下。'], story: '把熱鬧的節奏放慢，留一點安靜給自己。休息之後，再帶著精神迎接下午。', question: '孩子睡不著，或有不同的休息需求呢？', answer: '可以向園所了解休息空間與安排，以及孩子尚未習慣午休時，老師會如何陪伴和與家長溝通。' },
  outside: { key: 'outside', n: '05', label: '午後玩耍', time: '14:20', tint: 'mint', photo: 'day-outside', alt: '孩子在戶外活動，笑著和同伴一起跑動', title: ['和朋友一起，', '把今天玩得好大。'], story: '看看植物、動動身體，發現身邊的新鮮事。和同伴一起玩的時候，也在練習分享與表達。', question: '戶外活動與天氣變化如何安排？', answer: '參觀時可詢問戶外活動的空間、陪伴方式，以及下雨或天氣炎熱時，園所如何調整當天的安排。' },
  home: { key: 'home', n: '06', label: '帶故事回家', time: '16:30', tint: 'yellow', photo: 'day-home', alt: '孩子專注整理自己的物品，為一天收尾', title: ['今天的好多事，', '想第一個告訴你。'], story: '帶上書包，也帶上今天的新發現。和家人分享一件開心的小事，讓校園裡的故事繼續走進生活。', question: '接送與家長聯繫，有哪些需要先知道？', answer: '可以詢問園所的接送流程、家長與老師的聯繫方式，以及如何了解孩子在校的生活情況。' },
};

// 六版都用現行 A 角落捲起的風（web/app/utils/cornerWind.ts 同參數），只差在「怎麼讓人知道有背面」
const WIND = { phi: 2.7, flutter: 0.16, reach: [50, 80], billow: 0, sway: 0.4, ripple: 0.12, rippleK: 0.045, rippleW: 9 };
const LEDE = '每張相片翻過來，都寫著那一刻的故事，<br>和參觀時可以問的事。';

const BATCHES = {
  1: { moments: [M.outside, M.home], eyebrow: '第一批・換時機與理由', h1: '在讀者停下來的那一刻，<br class="mobile-break">讓他知道相片還有背面。',
    aside: '現在的暗示都發生在捲動中或剛進場，<br>而且輕掀只到 31°，看不到背面有字。', top: '05 與 06 兩張，三種提示 · <b>A 請捲到一張相片、停下來 1 秒</b>', replay: '重播 A',
    notes: ['<strong>建議 A＋B 一起用。</strong>B 在標題下說一次背面有什麼，減少動態的人也收得到；A 在讀者停下來時示範一次，翻過一張就不再打擾。想要靜止時也看得出來，再考慮 C。',
      '不再重提：角落貼籤、「點照片，看看背面」提示字、hover 放大折角、正反小圖示、折角、對光透字、包邊貼紙、靜止時週期微風（09-21～23 已否決或落選）。A 不是週期微風：每張最多一次，只在讀者停在那張時發生。'] },
  2: { moments: [M.rest, M.outside], eyebrow: '第二批・讓背面自己出現', h1: '不用說明，<br class="mobile-break">讓畫面裡本來就看得到背面。',
    aside: '第二批不靠文字、也不靠提示動作：<br>翻著的一張、黏在背後的便條、翻開進場。', top: '04 與 05 兩張，三種讓背面出現的方式 · <b>F 請捲到第一張，看它翻開</b>', replay: '重播 F',
    notes: ['<strong>第二批首推 D。</strong>不動、不加字、不加物件，版面本身就說明「相片有兩面」，還讓目前是參考照的 04 先用故事上場。想再多一層，D 配第一批的 A（取代現行只掀 31°、看不到背面的輕掀）；F 和 D 擇一。E 最含蓄，但六張都多一條紙邊，要看整頁是否顯得雜。', '三版都保留現行的捲動起風與整張可點；可以和第一批的 B 引言疊用。E 與 09-23 落選的「包邊貼紙」都是「背面的東西從紙緣露出來」，差在 E 是一整張紙、不是裝飾物件。'] },
};

const directions = [
  { key: 'a', batch: 1, title: '讀到才掀', subtitle: '停下來看的那張，角落被吹過來給你看背面', level: 2,
    desc: '<strong>不加任何東西，只改時機和幅度。</strong><br>捲到一張相片、停下約 1 秒，它的右下角被風慢慢翻過來，露出背面的橫線紙和幾個字，停一下再落回。每張最多一次；翻過任何一張，其他張就不再提示。',
    trigger: '這張在畫面中央，且停止捲動 1.2 秒（手機 0.8 秒）', reduce: '不做，靠 B 的引言', site: '取代現行「顯影後 3.4 秒輕掀」：時機改看停留，幅度 0.55→2.8 rad（翻過來約 160°）、範圍 0.35→1，捲法改緊，sessionStorage 記「翻過了」' },
  { key: 'b', batch: 1, title: '一句話先說', subtitle: '在區塊標題下說一次背面有什麼，卡片不變', level: 1,
    desc: '<strong>最安靜，也是減少動態時唯一收得到的提示。</strong><br>不是教人「點這裡」，而是告訴家長翻過來有什麼：那一刻的故事，和參觀時可以問的事。說一次，六張都適用。',
    trigger: '無，靜態文字', reduce: '不受影響', site: 'DayExperience.vue 的 .day-intro 加一行引言（dayExperience.lede，後台可改）；不在 h1–h3，不受標題字型子集限制' },
  { key: 'c', batch: 1, title: '正面留一個問題', subtitle: '像字卡：問題在正面，答案在背面', level: 2,
    desc: '<strong>靜止時也看得出「還沒完」。</strong><br>把背面那題家長提問抄一行到標題下，句尾是問號、答案不在這一面，人會自然想翻過去找。用的是現成內容，不是操作說明。',
    trigger: '無，常駐', reduce: '不受影響', site: 'DayMomentCard.vue 正面 .print-foot 加一行 question，paperPrints.ts 正面貼圖同步畫；卡片高度多一行' },
  { key: 'd', batch: 2, title: '有一張翻著', subtitle: '相片牆上，有一張被人翻過來看了', level: 3,
    desc: '<strong>不動、不加東西，卻最直接。</strong><br>六張裡有一張一開始就背面朝上：橫線紙、故事、提問，膠帶從上緣露出一截。旁邊都是照片，讀者自然明白每張都有兩面；點它就翻回照片。建議用 04 安靜片刻：它現在是教室參考照（午休實拍待補），先讓故事上場反而合適。',
    trigger: '無，初始狀態', reduce: '不受影響', site: 'DayMomentCard 加 startFlipped（後台指定哪一張）：isFlipped 初始 true、turn −1，mountPaper 已支援以背面接手；這張的顯影改在翻回正面時才開始' },
  { key: 'e', batch: 2, title: '背後黏著便條', subtitle: '每張相片背後黏一張橫線便條，紙邊露出一點', level: 2,
    desc: '<strong>靜止時就看得到，但只是一條紙邊。</strong><br>便條比相片稍大、歪一點點，從右下露出幾公釐橫線紙。翻過來就是便條那一面（故事與提問），換相片的邊從便條後面露出來。不寫字、不加圖示，是紙本身的樣子。',
    trigger: '無，常駐', reduce: '不受影響（CSS 版一樣露出紙邊）', site: 'paperPrints.ts 多一片網格（便條）掛在紙的群組裡，一起捲、一起翻；背面文字改畫在便條外側、相紙背面改素面；CSS 版用 .print::before' },
  { key: 'f', batch: 2, title: '第一張翻開進場', subtitle: '第一張背面朝上貼著，讀者到了才翻成照片', level: 3,
    desc: '<strong>把示範變成進場的一部分。</strong><br>第一張一開始背面朝上，進到畫面 0.8 秒後自己翻過來（官網接著顯影）。讀者親眼看到「相片會翻」，之後自然會去翻其他張。每次工作階段一次；沒看到就停在背面，等於 D。',
    trigger: '第一張 60% 進入畫面 0.8 秒', reduce: '不翻，停在背面朝上（等於 D）', site: '取代首張偷看：首張 isFlipped 初始 true，到位後由程式翻回（不算使用者翻過）；sessionStorage 沿用 ivy-day-peek，看過的工作階段直接正面朝上' },
];
const startsBack = (d, i) => i === 0 && (d.key === 'd' || d.key === 'f');

function cardHTML(d, m, i) {
  const id = `story-${d.key}-${m.key}`;
  const tease = d.key === 'c' ? `<p class="tease">${m.question}</p>` : '';
  const back = startsBack(d, i);
  return `<div class="card tint-${m.tint}${back ? ' is-flipped' : ''}" data-label="${m.label}"${back ? ' data-turn="-1" style="--flip:-180deg"' : ''}${d.key === 'e' ? ' data-note' : ''}>
    <div class="print">
      <span class="tape" aria-hidden="true"></span>
      <div class="face front"${back ? ' inert' : ''}>
        <figure class="photo"><img src="../../web/public/assets/${m.photo}.webp" alt="${m.alt}"><time class="stamp" datetime="${m.time}">${m.time}</time></figure>
        <div class="foot"><p class="kicker">${m.n} / ${m.label}</p><h3>${m.title.join('<br>')}</h3>${tease}</div>
      </div>
      <div class="face back" id="${id}"${back ? '' : ' inert'}><p class="kicker">${m.n} / ${m.label}</p><p class="story">${m.story}</p><div class="ask"><p class="question">${m.question}</p><p class="answer">${m.answer}</p></div></div>
    </div>
    <canvas class="paper" aria-hidden="true"></canvas>
    <button class="turn" type="button" aria-expanded="${back}" aria-controls="${id}" aria-label="${m.label}：${back ? '回到照片' : '翻到背面，看這一刻的故事'}"></button>
  </div>`;
}

const secHead = d => `<header class="sec-head"><p class="sec-eyebrow">孩子的一天<span lang="en">A DAY AT IVY</span></p><p class="sec-title">常春藤的一天</p>${
  d.key === 'b' ? `<p class="lede">${LEDE}</p>` : '<p class="sec-head-note">（標題區維持現狀）</p>'}</header>`;

const liveSlot = key => (key === 'a' || key === 'f' ? '<p class="live" aria-live="polite"></p>' : '');
document.querySelector('.directions').innerHTML = directions.map(d => `
  <article class="direction v-${d.key}" data-direction="${d.key}" data-batch="${d.batch}" aria-labelledby="heading-${d.key}">
    <div class="direction-head"><span class="letter" aria-hidden="true">${d.key.toUpperCase()}</span><div><h2 id="heading-${d.key}">${d.title}</h2><p>${d.subtitle}</p></div></div>
    ${secHead(d)}
    <div class="stack">${BATCHES[d.batch].moments.map((m, i) => cardHTML(d, m, i)).join('')}</div>
    <div class="description">${liveSlot(d.key)}<p>${d.desc}</p>
      <dl class="meta">
        <dt>明顯度</dt><dd><span class="dots" role="img" aria-label="三級中的第 ${d.level} 級">${[1, 2, 3].map(i => `<i class="${i <= d.level ? 'on' : ''}"></i>`).join('')}</span></dd>
        <dt>觸發</dt><dd>${d.trigger}</dd><dt>減少動態</dt><dd>${d.reduce}</dd><dt>接進官網</dt><dd>${d.site}</dd>
      </dl>
    </div>
  </article>`).join('');

const params = new URLSearchParams(location.search);
const still = params.has('still');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const picked = directions.find(d => d.key === params.get('view'));
const batch = picked ? picked.batch : params.get('batch') === '1' ? 1 : 2;
const view = picked ? picked.key : 'all';
const B = BATCHES[batch];
document.body.dataset.view = view;
document.body.dataset.batch = String(batch);
document.querySelector('.intro .eyebrow').textContent = B.eyebrow;
document.querySelector('.intro h1').innerHTML = B.h1;
document.querySelector('.intro-aside p').innerHTML = B.aside;
document.querySelector('.board-top > span').innerHTML = B.top;
document.querySelector('.replay').firstChild.textContent = `${B.replay} `;
const notes = document.querySelectorAll('.notes p');
B.notes.forEach((html, i) => { notes[i].innerHTML = html; notes[i].hidden = !html; });
document.querySelector('.intro-aside nav').innerHTML = [
  `<a href="?batch=1" data-view="b1">第一批</a>`, `<a href="?batch=2" data-view="b2">第二批</a>`,
  ...directions.filter(d => d.batch === batch).map(d => `<a href="?view=${d.key}" data-view="${d.key}">${d.key.toUpperCase()}</a>`),
].join('');
document.querySelector(`.intro-aside [data-view="${picked ? view : `b${batch}`}"]`).setAttribute('aria-current', 'page');
for (const el of document.querySelectorAll('.direction')) el.hidden = Number(el.dataset.batch) !== batch || (view !== 'all' && el.dataset.direction !== view);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ── 雜訊：陣風的強弱起伏與紙的顫動都不是正弦波 ── */
function hash(n) {
  n = Math.imul(n ^ 0x27d4eb2d, 0x165667b1);
  n ^= n >>> 15;
  n = Math.imul(n, 0x85ebca6b);
  n ^= n >>> 13;
  return ((n >>> 0) / 4294967295) * 2 - 1;
}
function noise(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
}
const fbm = x => 0.6 * noise(x) + 0.28 * noise(x * 2.13 + 17.1) + 0.12 * noise(x * 4.37 + 31.7);

/* ── 彎曲剖面：被掀起那塊離折線 u（0–1，以 reach 為 1）處的轉角
   θ(u) = hinge·(1−(1−u)³) + tip·u³：大部分轉角集中在折線附近，外側接近一整片，
   像被風翻起的一頁；tip 讓末端再彎（負值＝逆風往回彎）。
   沿邊緣的波用 K 組「轉角乘上 1±ripple」的表，逐點在兩組之間內插；每幀每張重算，約 2k 次三角函數。 ── */
const TU = 64, K = 7;
const newTables = () => Array.from({ length: K }, () => ({ X: new Float32Array(TU + 1), Z: new Float32Array(TU + 1), A: new Float32Array(TU + 1) }));
function fillTables(tabs, theta, ripple) {
  for (let k = 0; k < K; k++) {
    const m = 1 + ripple * ((2 * k) / (K - 1) - 1), T = tabs[k];
    let x = 0, z = 0;
    for (let j = 1; j <= TU; j++) {
      for (let q = 0; q < 4; q++) {
        const th = m * theta((j - 1 + (q + 0.5) / 4) / TU);
        x += Math.cos(th) / (TU * 4);
        z += Math.sin(th) / (TU * 4);
      }
      T.X[j] = x; T.Z[j] = z; T.A[j] = m * theta(j / TU);
    }
  }
}
const lerp = (a, b, t) => a + (b - a) * t;

// 一段彎曲：折線過 (ox,oy)、(nx,ny) 指向被掀起的那側；z 朝觀者。
// 已經被前一段彎過的點（帶著 z），沿這段的局部法線一起轉，兩段才疊得起來。
function bendPoint(p, b, time) {
  if (!b.active) return;
  const dx = p.x - b.ox, dy = p.y - b.oy;
  const s = dx * b.nx + dy * b.ny;
  if (s <= 0) return;
  const t = -dx * b.ny + dy * b.nx;
  const f = b.ripple ? Math.sin(t * b.rippleK - time * b.rippleW) : 0;
  const fk = ((f + 1) / 2) * (K - 1), k0 = Math.min(K - 2, Math.floor(fk)), kb = fk - k0;
  const u = s / b.D, fj = Math.min(u, 1) * TU, j0 = Math.min(TU - 1, Math.floor(fj)), jb = fj - j0;
  const T0 = b.tabs[k0], T1 = b.tabs[k0 + 1];
  const pick = key => lerp(lerp(T0[key][j0], T0[key][j0 + 1], jb), lerp(T1[key][j0], T1[key][j0 + 1], jb), kb);
  let X = pick('X'), Z = pick('Z');
  const th = pick('A');
  if (u > 1) { X += (u - 1) * Math.cos(th); Z += (u - 1) * Math.sin(th); }
  X *= b.D; Z *= b.D;
  const along = X - p.z * Math.sin(th);
  p.x = b.ox - b.ny * t + b.nx * along;
  p.y = b.oy + b.nx * t + b.ny * along;
  p.z = Z + p.z * Math.cos(th);
}

/* ── 貼圖：版位、字型、顏色全部從 DOM 量（同官網 paperPrints.ts 的做法，簡化版） ── */
const fontOf = el => { const cs = getComputedStyle(el); return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; };
const lineOf = el => parseFloat(getComputedStyle(el).lineHeight);
function resolveColor(host, value) {
  const probe = document.createElement('span');
  probe.style.color = value;
  host.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}
const NO_LINE_START = /[，。、；：！？」』）…]/, NO_LINE_END = /[「『（]/;
function wrapLines(ctx, text, max) {
  const out = [];
  let line = '';
  for (const ch of text) {
    if (line && ctx.measureText(line + ch).width > max) {
      const chars = Array.from(line);
      let carry = ch;
      while (chars.length > 1 && (NO_LINE_START.test(carry[0]) || NO_LINE_END.test(chars[chars.length - 1]))) carry = chars.pop() + carry;
      out.push(chars.join(''));
      line = carry;
    } else line += ch;
  }
  out.push(line);
  return out;
}
const angleOf = el => (parseFloat(getComputedStyle(el).rotate) || 0) * Math.PI / 180;

function measure(card) {
  const front = card.querySelector('.front'), back = card.querySelector('.back'), tape = card.querySelector('.tape');
  const h3 = front.querySelector('h3'), stamp = front.querySelector('.stamp');
  const angles = { tape: angleOf(tape), title: angleOf(h3) };
  // 量平的：拿掉卡片、膠帶、標題的 rotate，紙的翻轉與時間戳的斜體
  const undo = [[card, 'rotate', 'none'], [tape, 'rotate', 'none'], [h3, 'rotate', 'none'], [card.querySelector('.print'), 'transform', 'none'], [back, 'transform', 'none'], [stamp, 'transform', 'none']];
  const saved = undo.map(([el]) => el.getAttribute('style'));
  undo.forEach(([el, prop, v]) => el.style.setProperty(prop, v, 'important'));
  const fr = front.getBoundingClientRect(), br = back.getBoundingClientRect();
  const box = (el, o) => { const r = el.getBoundingClientRect(); return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height }; };
  const q = sel => back.querySelector(sel);
  const m = {
    W: front.offsetWidth, H: front.offsetHeight, angles,
    photo: box(front.querySelector('.photo'), fr), stamp: box(stamp, fr), kicker: box(front.querySelector('.kicker'), fr), title: box(h3, fr), tape: box(tape, fr),
    tease: front.querySelector('.tease') ? box(front.querySelector('.tease'), fr) : null,
    bKicker: box(q('.kicker'), br), story: box(q('.story'), br), ask: box(q('.ask'), br), question: box(q('.question'), br), answer: box(q('.answer'), br),
    style: {
      frontBg: getComputedStyle(front).backgroundColor, backBg: getComputedStyle(back).backgroundColor,
      line: resolveColor(card, 'rgb(var(--ink) / .07)'), dash: resolveColor(card, 'rgb(var(--ink) / .25)'),
      noteEdgeLine: resolveColor(card, 'rgb(var(--ink) / .12)'), photoBackBg: resolveColor(card, 'var(--photo-back)'),
      tapeA: resolveColor(tape, 'var(--tape-a)'), tapeB: resolveColor(tape, 'var(--tape-b)'), tapeShadow: resolveColor(card, 'rgb(var(--ink) / .15)'),
      stampFont: fontOf(stamp), stampColor: getComputedStyle(stamp).color, stampGlow: resolveColor(card, 'var(--stamp-glow)'),
      kickerFont: fontOf(front.querySelector('.kicker')), kickerColor: getComputedStyle(front.querySelector('.kicker')).color,
      teaseFont: front.querySelector('.tease') ? fontOf(front.querySelector('.tease')) : '', teaseColor: front.querySelector('.tease') ? getComputedStyle(front.querySelector('.tease')).color : '',
      titleFont: fontOf(h3), titleColor: getComputedStyle(h3).color, titleLine: lineOf(h3),
      storyFont: fontOf(q('.story')), storyColor: getComputedStyle(q('.story')).color, storyLine: lineOf(q('.story')),
      qFont: fontOf(q('.question')), qColor: getComputedStyle(q('.question')).color, qLine: lineOf(q('.question')),
      aFont: fontOf(q('.answer')), aColor: getComputedStyle(q('.answer')).color, aLine: lineOf(q('.answer')),
    },
  };
  undo.forEach(([el], i) => (saved[i] === null ? el.removeAttribute('style') : el.setAttribute('style', saved[i])));
  return m;
}

function drawTape(ctx, m) {
  const t = m.tape;
  ctx.save();
  ctx.translate(t.x + t.w / 2, t.y + t.h / 2);
  ctx.rotate(m.angles.tape);
  ctx.translate(-t.w / 2, -t.h / 2);
  ctx.beginPath();
  ctx.moveTo(t.w * 0.02, 0); ctx.lineTo(t.w * 0.98, t.h * 0.03); ctx.lineTo(t.w, t.h * 0.96); ctx.lineTo(0, t.h);
  ctx.closePath();
  ctx.shadowColor = m.style.tapeShadow; ctx.shadowBlur = 2; ctx.shadowOffsetY = 1;
  ctx.fillStyle = m.style.tapeB; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.clip();
  ctx.fillStyle = m.style.tapeA;
  for (let x = -t.h; x < t.w + t.h; x += 12) {
    ctx.beginPath(); ctx.moveTo(x, t.h); ctx.lineTo(x + 6, t.h); ctx.lineTo(x + 6 + t.h, 0); ctx.lineTo(x + t.h, 0); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function textures(card, m, img, TOP, dpr) {
  const { W, H, style: st } = m;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = Math.round(W * dpr); c.height = Math.round((H + TOP) * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, TOP * dpr); // 紙面座標：原點在紙的左上角，上方留一條給膠帶的透明帶
    ctx.imageSmoothingQuality = 'high';
    return [c, ctx];
  };
  // 正面
  const [fc, f] = make();
  f.fillStyle = st.frontBg; f.fillRect(0, 0, W, H);
  const p = m.photo, iw = img.naturalWidth, ih = img.naturalHeight, scale = Math.max(p.w / iw, p.h / ih);
  const sw = p.w / scale, sh = p.h / scale;
  f.drawImage(img, (iw - sw) * 0.5, (ih - sh) * 0.4, sw, sh, p.x, p.y, p.w, p.h);
  f.save();
  f.font = st.stampFont; f.fillStyle = st.stampColor; f.textBaseline = 'middle'; f.letterSpacing = '0.06em';
  f.shadowColor = st.stampGlow; f.shadowBlur = 6;
  f.translate(m.stamp.x, m.stamp.y + m.stamp.h / 2); f.transform(1, 0, Math.tan(-6 * Math.PI / 180), 1, 0, 0);
  f.fillText(card.querySelector('.stamp').textContent, 0, 0);
  f.restore();
  f.font = st.kickerFont; f.fillStyle = st.kickerColor; f.textBaseline = 'middle'; f.letterSpacing = '0.08em';
  f.fillText(card.querySelector('.front .kicker').textContent, m.kicker.x, m.kicker.y + m.kicker.h / 2);
  f.save();
  const tb = m.title;
  f.translate(tb.x + tb.w / 2, tb.y + tb.h / 2); f.rotate(m.angles.title); f.translate(-tb.w / 2, -tb.h / 2);
  f.font = st.titleFont; f.fillStyle = st.titleColor; f.letterSpacing = '0.02em';
  card.querySelector('h3').innerHTML.split('<br>').forEach((line, i) => {
    const shift = line[0] === '「' ? 0.32 * f.measureText('「').width : 0; // 同 CSS text-spacing-trim:trim-start
    f.fillText(line, -shift, st.titleLine * (i + 0.5));
  });
  f.restore();
  if (m.tease) {
    f.font = st.teaseFont; f.fillStyle = st.teaseColor; f.textBaseline = 'middle'; f.letterSpacing = '0.02em';
    f.fillText(card.querySelector('.tease').textContent, m.tease.x, m.tease.y + m.tease.h / 2);
  }
  drawTape(f, m);
  // 背面：從背面看的版面；紙膠帶左右對調
  const [bc, b] = make();
  if (card.hasAttribute('data-note')) {
    // E：相紙背面是素面（字寫在黏在後面的便條上）
    b.fillStyle = st.photoBackBg; b.fillRect(0, 0, W, H);
    b.save(); b.translate(W, 0); b.scale(-1, 1); drawTape(b, m); b.restore();
    return [fc, bc, noteTextures(card, m, dpr)];
  }
  drawBack(b, card, m, W, H, 0, 0);
  b.save(); b.translate(W, 0); b.scale(-1, 1); drawTape(b, m); b.restore();
  return [fc, bc];
}

// 便條尺寸：比相紙寬高各多 NOTE_GROW，往右下偏移、微微轉動，只從右緣與下緣露出紙邊
const NOTE_GROW = 4, NOTE_DX = 6, NOTE_DY = 7, NOTE_ROT = -0.9 * Math.PI / 180, NOTE_Z = -0.8;
function noteTextures(card, m, dpr) {
  const NW = m.W + NOTE_GROW, NH = m.H + NOTE_GROW;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = Math.round(NW * dpr); c.height = Math.round(NH * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [c, ctx];
  };
  // 外側（翻過來看到的那面）：故事與提問，版位同 DOM 的 .back
  const [oc, o] = make();
  drawBack(o, card, m, NW, NH, NOTE_GROW / 2, NOTE_GROW / 2);
  // 內側（黏在相紙背面、平常只露出紙邊）：素面橫線
  const [ic, n] = make();
  n.fillStyle = m.style.backBg; n.fillRect(0, 0, NW, NH);
  n.fillStyle = m.style.noteEdgeLine;
  for (let y = 31; y < NH; y += 32) n.fillRect(0, y, NW, 1);
  return { outer: oc, inner: ic, NW, NH };
}

function drawBack(b, card, m, W, H, ox, oy) {
  const st = m.style;
  b.fillStyle = st.backBg; b.fillRect(0, 0, W, H);
  b.fillStyle = st.line;
  for (let y = 31; y < H; y += 32) b.fillRect(0, y, W, 1);
  b.save(); b.translate(ox, oy);
  b.font = st.kickerFont; b.fillStyle = st.kickerColor; b.textBaseline = 'middle'; b.letterSpacing = '0.08em';
  b.fillText(card.querySelector('.back .kicker').textContent, m.bKicker.x, m.bKicker.y + m.bKicker.h / 2);
  b.letterSpacing = '0px';
  const para = (el, box, font, color, lh) => {
    b.font = font; b.fillStyle = color;
    wrapLines(b, el.textContent, box.w + 0.5).forEach((line, i) => b.fillText(line, box.x, box.y + lh * (i + 0.5)));
  };
  para(card.querySelector('.story'), m.story, st.storyFont, st.storyColor, st.storyLine);
  b.strokeStyle = st.dash; b.setLineDash([3, 3]); b.beginPath(); b.moveTo(m.ask.x, m.ask.y + 0.5); b.lineTo(m.ask.x + m.ask.w, m.ask.y + 0.5); b.stroke(); b.setLineDash([]);
  para(card.querySelector('.question'), m.question, st.qFont, st.qColor, st.qLine);
  para(card.querySelector('.answer'), m.answer, st.aFont, st.aColor, st.aLine);
  b.restore();
}

/* ── 一張紙：mock 每張自己一個 renderer（官網是共用一個 context） ── */
const MARGIN = 90, FLOOR_Z = -26, SEG_X = 44, SEG_Y = 56, FLIP_MS = 950;
const easeFlip = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

async function mountPaper(state) {
  const { card } = state;
  const img = card.querySelector('.photo img');
  await img.decode().catch(() => {});
  const m = measure(card);
  const { W, H } = m;
  const TOP = Math.ceil(Math.max(0, -m.tape.y + Math.abs(Math.sin(m.angles.tape)) * m.tape.w / 2) + 4);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const VW = W + MARGIN * 2, VH = H + MARGIN * 2;
  const view = card.querySelector('.paper');
  Object.assign(view.style, { width: `${VW}px`, height: `${VH}px`, left: `${-MARGIN}px`, top: `${-MARGIN}px` });
  const renderer = new THREE.WebGLRenderer({ canvas: view, alpha: true, antialias: true });
  renderer.setPixelRatio(dpr);
  renderer.setSize(VW, VH, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const fov = 24, dist = VH / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const camera = new THREE.PerspectiveCamera(fov, VW / VH, 10, dist * 3);
  camera.position.z = dist;

  const [fc, bc, note] = textures(card, m, img, TOP, dpr);
  const frontTex = new THREE.CanvasTexture(fc), backTex = new THREE.CanvasTexture(bc);
  frontTex.colorSpace = backTex.colorSpace = THREE.SRGBColorSpace;
  frontTex.anisotropy = backTex.anisotropy = 4;
  // 背面貼圖是「從背面看」畫的：同一張網格的背面左右對調取樣
  backTex.wrapS = THREE.RepeatWrapping; backTex.repeat.x = -1; backTex.offset.x = 1;

  const geo = new THREE.PlaneGeometry(W, H + TOP, SEG_X, Math.round((SEG_Y * (H + TOP)) / H));
  geo.translate(0, TOP / 2, 0);
  const matF = new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.62, metalness: 0, alphaTest: 0.5, side: THREE.FrontSide, shadowSide: THREE.DoubleSide });
  const matB = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.8, metalness: 0, alphaTest: 0.5, side: THREE.BackSide });
  const meshF = new THREE.Mesh(geo, matF), meshB = new THREE.Mesh(geo, matB);
  meshF.castShadow = true;
  meshF.receiveShadow = meshB.receiveShadow = true; // 掀起來的那塊把影子投在自己的紙面上
  // 擺動繞膠帶：pivot 放在膠帶中心（紙的上緣），翻面繞紙的中線
  const tapeX = m.tape.x + m.tape.w / 2 - W / 2;
  const pivot = new THREE.Group(); pivot.position.set(tapeX, H / 2, 0);
  const holder = new THREE.Group(); holder.position.set(-tapeX, -H / 2, 0);
  const paper = new THREE.Group(); paper.add(meshF, meshB);
  holder.add(paper); pivot.add(holder); scene.add(pivot);
  // 要跟著捲的網格：相紙本身＋（E）黏在背後的便條
  const sheets = [{ geo, z: 0 }];
  if (note) {
    const noteGeo = new THREE.PlaneGeometry(note.NW, note.NH, SEG_X, SEG_Y);
    noteGeo.rotateZ(NOTE_ROT);
    noteGeo.translate(NOTE_DX, -NOTE_DY, 0);
    const tex = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
    const outer = tex(note.outer);
    outer.wrapS = THREE.RepeatWrapping; outer.repeat.x = -1; outer.offset.x = 1; // 外側是從背面看畫的
    const noteF = new THREE.Mesh(noteGeo, new THREE.MeshStandardMaterial({ map: tex(note.inner), roughness: 0.85, metalness: 0, side: THREE.FrontSide, shadowSide: THREE.DoubleSide }));
    const noteB = new THREE.Mesh(noteGeo, new THREE.MeshStandardMaterial({ map: outer, roughness: 0.85, metalness: 0, side: THREE.BackSide }));
    noteF.castShadow = true;
    noteF.receiveShadow = noteB.receiveShadow = true;
    paper.add(noteF, noteB);
    sheets.push({ geo: noteGeo, z: NOTE_Z });
  }

  // 牆：只接影子。排進最先畫、不寫不比深度（同官網，避免翻面時假摺痕）
  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.28, depthWrite: false, depthTest: false });
  shadowMat.transparent = false;
  shadowMat.blending = THREE.CustomBlending;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(VW * 2, VH * 2), shadowMat);
  floor.position.z = FLOOR_Z; floor.renderOrder = -1; floor.receiveShadow = true;
  scene.add(floor);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9)); // 官網 1.35／1.6；這裡拉開明暗讓彎曲讀得出來，平貼時亮度相同
  const key = new THREE.DirectionalLight(0xfff4e0, 2.1);
  key.position.set(W * 0.6, H * 0.9, dist * 0.7);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -VW, right: VW, top: VH, bottom: -VH, far: dist * 2 });
  key.shadow.radius = 6;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.6;
  scene.add(key);

  for (const sheet of sheets) sheet.base = Float32Array.from(sheet.geo.attributes.position.array);
  const pt = { x: 0, y: 0, z: 0 };
  const local = { tabs: newTables(), active: false };
  const billow = { tabs: newTables(), active: false, nx: 0, ny: -1, ox: 0, oy: H / 2, D: H, rippleK: 0.02, rippleW: -5 };

  // 風在「觀者看到的那一面」的座標裡算：翻到背面時 x、z 反過來，紙永遠往觀者這邊掀
  function deform(time, amt, facing) {
    // 範圍以 460px 寬為準、依紙寬等比（同官網 cornerWind.ts 的 REACH_REFERENCE_WIDTH）
    const w = state.wind, reach = (w.reach[0] + w.reach[1] * state.reach) * (W / 460), tilt = state.delta;
    // 三版都是現行的角落捲起：折線沿對角線，從右下角往內量
    const a = -Math.PI / 4 + tilt;
    const nx = Math.cos(a), ny = Math.sin(a), cx = W / 2;
    const hinge = state.phi * amt, tip = state.tip * amt;
    Object.assign(local, { nx, ny, ox: cx - nx * reach, oy: -H / 2 - ny * reach, D: reach, ripple: w.ripple, rippleK: w.rippleK, rippleW: w.rippleW, active: hinge > 1e-4 || Math.abs(tip) > 1e-4 });
    // 風用現行剖面 θ(u)=hinge·(1−(1−u)³)+tip·u³；A 的提示用更緊的 (1−u)⁶，轉角集中在折線，背面整片朝向觀者
    const pw = state.curlPow || 3;
    if (local.active) fillTables(local.tabs, u => hinge * (1 - (1 - u) ** pw) + tip * u ** 3, w.ripple);
    const lift = state.billow * amt;
    billow.ripple = 0;
    billow.active = lift > 1e-4;
    if (billow.active) fillTables(billow.tabs, u => lift * u ** 1.4, billow.ripple);
    // 便條在相紙後面 0.8px：在觀者座標裡帶著 z 一起彎，捲起來時兩張紙保持貼合
    for (const { geo: g, base, z } of sheets) {
      const pos = g.attributes.position.array;
      for (let i = 0; i < pos.length; i += 3) {
        pt.x = base[i] * facing; pt.y = base[i + 1]; pt.z = z * facing;
        bendPoint(pt, local, time);
        bendPoint(pt, billow, time);
        pos[i] = pt.x * facing; pos[i + 1] = pt.y; pos[i + 2] = pt.z * facing;
      }
      g.attributes.position.needsUpdate = true;
      g.computeVertexNormals();
    }
  }

  function draw(now) {
    // 翻面：永遠右緣掀起往左翻（半圈累加，停穩收回 0／-1），同官網 printFlip.ts
    if (state.rotGoal !== state.rot) {
      const t = Math.min(1, (now - state.rotStart) / state.rotMs);
      state.rot = state.rotFrom + (state.rotGoal - state.rotFrom) * easeFlip(t);
      if (t >= 1) state.rot = state.rotGoal = (((state.rotGoal % 2) + 2) % 2 === 0 ? 0 : -1);
    }
    const open = Math.abs(Math.sin(state.rot * Math.PI));
    const facing = Math.round(state.rot) % 2 === 0 ? 1 : -1;
    paper.rotation.set(-open * 0.08, state.rot * Math.PI, 0);
    paper.position.z = open ** 0.75 * 36;
    pivot.rotation.z = state.sway * (1 - open);
    deform(now / 1000, 1 - open, facing);
    renderer.render(scene, camera);
  }

  card.classList.add('webgl');
  return { draw, flipping: () => state.rot !== state.rotGoal };
}

/* ── 捲動 → 風（同官網 cornerWind.ts：速度越快風越大，三版都有） ── */
let velocity = 0, lastY = scrollY, lastScrollAt = performance.now(), windDir = 1;
addEventListener('scroll', () => {
  const now = performance.now();
  const v = ((scrollY - lastY) / Math.max(16, now - lastScrollAt)) * 1000;
  lastY = scrollY;
  lastScrollAt = now;
  velocity = velocity * 0.5 + v * 0.5;
  if (Math.abs(velocity) > 30) windDir = Math.sign(velocity);
  kick();
  armHint();
}, { passive: true });

const spring = (s, key, target, k, c, dt) => {
  s[key + 'V'] += (k * (target - s[key]) - c * s[key + 'V']) * dt;
  s[key] += s[key + 'V'] * dt;
};
const REST = { w: 0, phi: 0, phiV: 0, tip: 0, reach: 0, reachV: 0, billow: 0, billowV: 0, sway: 0, swayV: 0, delta: 0 };
const cards = [...document.querySelectorAll('.card')].map((card, i) => {
  const key = card.closest('.direction').dataset.direction;
  const back = card.classList.contains('is-flipped') ? -1 : 0;
  return { card, key, wind: WIND, seed: i * 7.31 + 3.7, rot: back, rotGoal: back, rotFrom: back, rotStart: 0, rotMs: FLIP_MS, paper: null, visible: false, dirty: false, hinted: false, hintAt: 0, ...REST };
});

function stepCard(s, target, dt, t) {
  s.w += (target - s.w) * (1 - Math.exp(-dt / (target > s.w ? 0.07 : 0.6))); // 風起得快、收得慢
  const w = s.w, p = s.wind;
  const gusty = 0.65 + 0.35 * fbm(t * 1.1 + s.seed); // 同一陣風裡的強弱
  // 被掀起那塊：欠阻尼；落回牆面時反彈 25%
  spring(s, 'phi', p.phi * w * gusty, 45, 4.8, dt);
  if (s.phi < 0) { s.phi = 0; if (s.phiV < 0) s.phiV *= -0.25; }
  spring(s, 'reach', w, 40, 9, dt);
  spring(s, 'sway', windDir * ((p.sway * Math.PI) / 180) * w * (0.6 + 0.4 * fbm(t * 0.9 + s.seed * 11)), 22, 3, dt);
  s.delta = 0.2 * fbm(t * 0.6 + s.seed * 5) * Math.min(1, w * 2); // 風向小幅飄移，折線跟著斜
  s.tip = -0.28 * s.phi - 0.004 * s.phiV; // 末端逆風往回彎，翻得越快彎得越多
  return w > 0.002 || s.phi > 0.002 || Math.abs(s.phiV) > 0.01 || Math.abs(s.sway) > 0.0002 || Math.abs(s.swayV) > 0.001 || Math.abs(s.reach) > 0.002;
}

/* ── A 讀到才掀 ──
   讀者停在一張相片上（這張在畫面中央、至少 60% 在畫面內），停止捲動 1.2 秒（手機 0.8 秒），
   它的右下角被風慢慢掀過 90°、露出背面，停一下再落回、輕彈一下。每張最多一次；
   這一欄翻過任何一張之後就不再提示（官網是六張共用、存 sessionStorage）。 */
const HINT_MS = 2600, HINT_HINGE = 2.8, HINT_TIP = -0.1, HINT_REACH = 1, HINT_POW = 6;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const envelope = (p, rise, fall) => smooth(0, rise, p) * (1 - smooth(rise, fall, p));
function hintPose(s, now) {
  if (!s.hintAt) return null;
  const k = (now - s.hintAt) / HINT_MS;
  if (k >= 1) { s.hintAt = 0; return null; }
  if (k <= 0) return null;
  // 0–30% 慢慢翻過來（約 150°，背面朝向觀者），30–58% 停著被風輕輕托住，58–88% 落回，最後輕彈一次。
  // 只掀到 90° 附近時角落是側面對著人，看得出「捲起」卻看不到背面，所以要翻過頭。
  const hold = smooth(0, 0.3, k) * (1 - smooth(0.58, 0.88, k));
  const phi = HINT_HINGE * hold + 0.12 * envelope((k - 0.88) / 0.12, 0.5, 1) + 0.06 * hold * fbm(now / 1000 * 2.3 + s.seed);
  return { phi, tip: HINT_TIP * phi, reach: HINT_REACH, curlPow: HINT_POW };
}
const hintCards = cards.filter(s => s.key === 'a');
const live = document.querySelector('.v-a .live');
let learned = false, idleTimer = 0;
const idleMs = () => (matchMedia('(max-width: 760px)').matches ? 800 : 1200);
function updateLive() {
  if (!live) return;
  const done = hintCards.filter(s => s.hinted).length;
  if (reduced.matches) live.textContent = '減少動態：不掀，只靠 B 的引言。';
  else if (learned) live.textContent = '翻過了，這一欄不再提示。按「重播 A」重來。';
  else if (!done) live.textContent = '捲到一張相片、停下來約 1 秒。';
  else live.textContent = `已提示 ${done}／${hintCards.length} 張；翻過任何一張就停。`;
}
function focusCard(list) {
  const mid = innerHeight / 2;
  let best = null, bestD = Infinity;
  for (const s of list) {
    const r = s.card.getBoundingClientRect();
    if (r.height <= 0) continue;
    const seen = (Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / r.height;
    if (seen < 0.6) continue;
    const d = Math.abs((r.top + r.bottom) / 2 - mid);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
function armHint(delay = idleMs()) {
  clearTimeout(idleTimer);
  if (batch !== 1 || learned || reduced.matches || still) return;
  idleTimer = setTimeout(tryHint, delay);
}
function tryHint() {
  if (learned || reduced.matches || document.hidden) return;
  if (performance.now() - lastScrollAt < idleMs() - 20) return armHint();
  const s = focusCard(hintCards);
  if (!s || s.hinted || !s.paper || s.card.classList.contains('is-flipped') || s.rot !== s.rotGoal) return;
  s.hinted = true;
  s.hintAt = performance.now();
  updateLive();
  kick();
}

/* ── 共用時鐘 ── */
let frame = 0, prevFrame = 0;
function kick() {
  if (frame || reduced.matches || still) return;
  prevFrame = performance.now();
  frame = requestAnimationFrame(tick);
}
function tick(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - prevFrame) / 1000));
  prevFrame = now;
  const t = now / 1000;
  if (now - lastScrollAt > 60) velocity *= 0.02 ** dt;
  const target = Math.min(1, Math.abs(velocity) / 2100);
  let moving = Math.abs(velocity) > 4;
  for (const s of cards) {
    if (!s.paper) continue;
    const active = stepCard(s, target, dt, t);
    const hint = hintPose(s, now);
    const flipping = s.paper.flipping();
    if (active || flipping || hint || s.hintAt) moving = true;
    if (!s.visible || !(active || flipping || hint || s.dirty)) continue;
    // 顫動不經彈簧（紙很輕，8–10Hz 會被彈簧濾掉），畫的時候直接疊上去；提示與風取掀得比較大的那個
    const keep = [s.phi, s.tip, s.reach, s.curlPow];
    s.phi = Math.max(0, s.phi + 0.4 * s.wind.flutter * s.w * fbm(t * 7.1 + s.seed));
    s.tip += s.wind.flutter * s.w * fbm(t * 10.3 + s.seed * 3);
    if (hint && hint.phi > s.phi) Object.assign(s, hint);
    s.paper.draw(now);
    [s.phi, s.tip, s.reach, s.curlPow] = keep;
    s.dirty = active || flipping || Boolean(hint);
  }
  if (moving) { frame = requestAnimationFrame(tick); return; }
  frame = 0;
  velocity = 0;
  // 停穩：收回完全平貼，補畫一幀
  for (const s of cards) if (s.paper) { Object.assign(s, REST); if (s.visible) s.paper.draw(now); }
}

/* 翻面：WebGL 版由紙自己轉；沒有 WebGL 就是 CSS 3D 版。F 的進場翻開也走這裡（不算使用者翻過） */
function turnCard(s) {
  const flipped = s.card.classList.toggle('is-flipped');
  s.hintAt = 0; // 翻面接管提示
  if (s.paper) {
    const goal = s.rot === s.rotGoal ? s.rot - 1 : s.rotFrom; // 翻到一半再點：原路翻回
    s.rotFrom = s.rot;
    s.rotGoal = goal;
    s.rotMs = FLIP_MS * Math.max(0.55, Math.abs(goal - s.rot));
    s.rotStart = performance.now();
    kick();
  } else {
    const turn = (Number(s.card.dataset.turn) || 0) - 1;
    s.card.dataset.turn = String(turn);
    s.card.style.setProperty('--flip', `${turn * 180}deg`);
  }
  s.card.querySelector('.front').inert = flipped;
  s.card.querySelector('.back').inert = !flipped;
  const button = s.card.querySelector('.turn');
  button.setAttribute('aria-expanded', String(flipped));
  button.setAttribute('aria-label', `${s.card.dataset.label}：${flipped ? '回到照片' : '翻到背面，看這一刻的故事'}`);
}
for (const s of cards) {
  const button = s.card.querySelector('.turn');
  button.addEventListener('click', event => {
    if (s.key === 'a' && !learned) { learned = true; clearTimeout(idleTimer); updateLive(); }
    if (s === opener && !openerDone) { openerDone = true; clearTimeout(openerTimer); updateOpener(); }
    turnCard(s);
    if (event.detail > 0) button.blur();
  });
}

/* ── F 第一張翻開進場：背面朝上貼著，60% 進入畫面 0.8 秒後自己翻成照片；每次工作階段一次（mock：每次載入） ── */
const opener = cards.find(s => s.key === 'f' && s.card.classList.contains('is-flipped'));
const openerLive = document.querySelector('.v-f .live');
const OPEN_DELAY = 800;
let openerDone = false, openerTimer = 0;
function updateOpener() {
  if (!openerLive) return;
  if (reduced.matches) openerLive.textContent = '減少動態：不翻，停在背面朝上（等於 D）。';
  else if (openerDone) openerLive.textContent = '翻開了；每次工作階段一次。按「重播 F」重來。';
  else openerLive.textContent = '第一張背面朝上，捲到它 60% 進入畫面。';
}
const openerSeen = new IntersectionObserver(entries => {
  const e = entries.at(-1);
  clearTimeout(openerTimer);
  if (openerDone || reduced.matches || still || !e.isIntersecting || e.intersectionRatio < 0.6) return;
  openerTimer = setTimeout(() => {
    const r = opener.card.getBoundingClientRect();
    if (openerDone || (Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / r.height < 0.6) return;
    openerDone = true;
    turnCard(opener);
    updateOpener();
  }, OPEN_DELAY);
}, { threshold: [0, 0.6, 1] });

/* ── 控制列：第一批重播 A（清掉「提示過／翻過了」），第二批重播 F（第一張回到背面朝上） ── */
const replayButton = document.querySelector('.replay');
replayButton.addEventListener('click', () => {
  if (batch === 1) {
    learned = false;
    for (const s of hintCards) { s.hinted = false; s.hintAt = 0; }
    updateLive();
    armHint(600);
    return;
  }
  if (!opener) return;
  clearTimeout(openerTimer);
  if (!opener.card.classList.contains('is-flipped')) {
    // 直接回到背面朝上（不播翻面）
    turnCard(opener);
    if (opener.paper) { opener.rot = opener.rotGoal = opener.rotFrom = -1; opener.dirty = true; kick(); }
  }
  openerDone = false;
  updateOpener();
  openerSeen.unobserve(opener.card);
  setTimeout(() => openerSeen.observe(opener.card), 300);
});
function applyMotionPreference() {
  replayButton.disabled = reduced.matches;
  updateLive();
  updateOpener();
}
reduced.addEventListener('change', applyMotionPreference);
applyMotionPreference();

/* ── 載入紙張：減少動態、沒有 WebGL 就維持 DOM 版（平貼、不起風、不提示） ── */
const seen = new IntersectionObserver(entries => {
  for (const e of entries) {
    const s = cards.find(c => c.card === e.target);
    s.visible = e.isIntersecting;
    if (s.visible && s.paper) { s.dirty = true; kick(); }
  }
}, { rootMargin: '120px 0px' });
async function boot() {
  if (reduced.matches && !still) { document.body.dataset.ready = '1'; return; }
  await document.fonts.ready;
  for (const s of cards) {
    if (s.card.closest('[hidden]')) continue;
    try {
      s.paper = await mountPaper(s);
      seen.observe(s.card);
    } catch (error) {
      console.warn('WebGL 紙張失敗，維持 DOM 版', error);
    }
  }
  if (still) {
    // ?still=1：A 第一張停在提示最高點，其他平貼
    const a = hintCards.find(s => s.paper);
    if (a) Object.assign(a, { phi: HINT_HINGE, tip: HINT_TIP * HINT_HINGE, reach: HINT_REACH, curlPow: HINT_POW });
  }
  for (const s of cards) if (s.paper) s.paper.draw(performance.now());
  document.body.dataset.ready = '1';
  if (batch === 1) armHint();
  else if (opener && !opener.card.closest('[hidden]')) openerSeen.observe(opener.card);
}
boot();
