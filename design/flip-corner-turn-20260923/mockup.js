import * as THREE from 'three';

// 內容取自 web/server/data/site-fixture.json 的 dayExperience.moments
const moments = [
  { key: 'hello', n: '01', label: '早安入園', time: '08:00', tint: 'yellow', photo: 'day-hello', alt: '孩子在熟悉的環境裡，與身旁的人互動', title: ['早安，今天的我', '準備好了。'], story: '和家人說聲再見，走進熟悉的校園。從整理小書包開始，一點一點，找到自己的步調。', question: '孩子第一次上學，如何陪伴適應？', answer: '參觀時可以與園所聊聊：初次入園的陪伴方式、家長如何與老師聯繫，以及可以事先做哪些準備。' },
  { key: 'discover', n: '02', label: '好奇探索', time: '09:10', tint: 'mint', photo: 'day-discover', alt: '老師陪伴孩子操作幾何教具', title: ['我的「為什麼」，', '今天又多了一個。'], story: '摸一摸、看一看，再和同伴試一次。那些讓眼睛發亮的小發現，是認識世界的開始。', question: '孩子平常會接觸哪些學習活動？', answer: '可以詢問該校如何安排探索活動、使用哪些教具與素材，以及如何依照年齡和孩子的興趣調整內容。' },
];

// 翻面提示：上一輪選定的 A 角落捲起（design/flip-wind-20260923/），三版共用
const WIND = { phi: 2.7, flutter: 0.16, reach: [50, 80], billow: 0.05, sway: 0.4, ripple: 0.12, rippleK: 0.045, rippleW: 9 };

const directions = [
  { key: 'a', label: 'A1', title: '捏角翻', subtitle: '像手捏住右下角翻過去', flip: 'twist', ms: 1000, level: 1,
    desc: '<strong>最接近現行，只是換成從角落起手。</strong><br>右下角先捲起（前 0.15 秒左右），整張接著繞中線翻；下半部比上半部轉得快，紙會扭一下，過了一半開始回正，落地時微微反扭再停。',
    feel: '俐落、像真的用手翻', time: '1.0 秒', site: '沿用 printFlip.ts 的中線翻轉；貼圖網格多一段「角落捲曲＋上下扭轉」' },
  { key: 'b', label: 'A2', title: '對角翻滾', subtitle: '角先掀，沿對角線翻過來，落地轉正', flip: 'tumble', ms: 1150, level: 2,
    desc: '<strong>最立體、最俏皮。</strong><br>右下角先掀，整張沿著「右上—左下」那條對角線離牆翻起、抬得比現行高；翻到後段轉軸慢慢轉回垂直，落地時剛好正著。',
    feel: '輕快、有點像翻牌', time: '1.15 秒', site: '翻轉改成四元數曲線（對角軸→垂直軸），抬升 LIFT 加大；需要比現行更大的畫布邊界' },
  { key: 'c', label: 'A3', title: '書頁翻', subtitle: '角先捲，捲曲擴大到整頁，翻完回原位', flip: 'page', ms: 1100, level: 3,
    desc: '<strong>最像紙。</strong><br>像翻書頁：右下角先捲，捲曲一路擴大到大半張，軸心先靠近左緣（整頁往左、往前掀），過半後軸心滑回中線，落在原來的位置。',
    feel: '柔軟、敘事感最強', time: '1.1 秒', site: '軸心位置隨進度移動＋大範圍捲曲；翻到一半會往左超出卡片約 1/3 寬，要確認不壓到隔壁欄' },
];

function cardHTML(d, m) {
  const id = `story-${d.key}-${m.key}`;
  return `<div class="card tint-${m.tint}" data-label="${m.label}">
    <div class="print">
      <span class="tape" aria-hidden="true"></span>
      <div class="face front">
        <figure class="photo"><img src="../../web/public/assets/${m.photo}.webp" alt="${m.alt}"><time class="stamp" datetime="${m.time}">${m.time}</time></figure>
        <div class="foot"><p class="kicker">${m.n} / ${m.label}</p><h3>${m.title.join('<br>')}</h3></div>
      </div>
      <div class="face back" id="${id}" inert><p class="kicker">${m.n} / ${m.label}</p><p class="story">${m.story}</p><div class="ask"><p class="question">${m.question}</p><p class="answer">${m.answer}</p></div></div>
    </div>
    <canvas class="paper" aria-hidden="true"></canvas>
    <button class="turn" type="button" aria-expanded="false" aria-controls="${id}" aria-label="${d.label} ${d.title}：翻到背面，看「${m.label}」的故事"></button>
  </div>`;
}

document.querySelector('.directions').innerHTML = directions.map(d => `
  <article class="direction v-${d.key}" data-direction="${d.key}" aria-labelledby="heading-${d.key}">
    <div class="direction-head"><span class="letter" aria-hidden="true">${d.label}</span><div><h2 id="heading-${d.key}">${d.title}</h2><p>${d.subtitle}</p></div></div>
    <div class="stack">${moments.map(m => cardHTML(d, m)).join('')}</div>
    <div class="description"><p>${d.desc}</p>
      <dl class="meta">
        <dt>動作量</dt><dd><span class="dots" role="img" aria-label="三級中的第 ${d.level} 級">${[1, 2, 3].map(i => `<i class="${i <= d.level ? 'on' : ''}"></i>`).join('')}</span></dd>
        <dt>手感</dt><dd>${d.feel}</dd><dt>時長</dt><dd>${d.time}（現行 0.95 秒）</dd><dt>接進官網</dt><dd>${d.site}</dd>
      </dl>
    </div>
  </article>`).join('');

const params = new URLSearchParams(location.search);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const view = ['a', 'b', 'c'].includes(params.get('view')) ? params.get('view') : 'all';
document.body.dataset.view = view;
document.querySelector(`.intro-aside [data-view="${view}"]`).setAttribute('aria-current', 'page');
for (const el of document.querySelectorAll('.direction')) el.hidden = view !== 'all' && el.dataset.direction !== view;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const envelope = (p, rise, fall) => smooth(0, rise, p) * (1 - smooth(rise, fall, p));
const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

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

/* ── 彎曲剖面（同 flip-wind-20260923）：離折線 u 處的轉角
   θ(u) = hinge·[mix·(1−(1−u)³) + (1−mix)·u] + tip·u³
   mix=1：轉角集中在折線附近、外側近乎一整片（風掀起的一頁）；mix 小：曲率平均（捲成筒，書頁翻用）。 ── */
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

// 一段彎曲：折線過 (ox,oy)、(nx,ny) 指向被掀起的那側；z 朝觀者。
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

/* ── 三種翻法：p 是這半圈的進度（0→1，線性時間；翻到一半再點就倒著走回去）。
   回傳整張的剛體姿態（觀者座標，右緣朝觀者＝繞 y 負轉）與這一刻的角落捲曲、上下扭轉。
   p=0 與 p=1 時所有變形都要歸零，換面時才接得上。 ── */
const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const qAxis = (axis, angle) => new THREE.Quaternion().setFromAxisAngle(axis, angle);
// 不做半球修正的 slerp：兩個 180° 旋轉的四元數內積為 0 時，three 的 slerp 可能反向走
function slerpRaw(a, b, t) {
  const d = clamp(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w, -1, 1);
  const th = Math.acos(d), s = Math.sin(th);
  const [wa, wb] = s < 1e-5 ? [1 - t, t] : [Math.sin((1 - t) * th) / s, Math.sin(t * th) / s];
  return new THREE.Quaternion(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb, a.w * wa + b.w * wb).normalize();
}
// A2：先繞「右上—左下」對角附近的斜軸翻（右下角離軸最遠、先離牆），後段轉軸回到垂直
const TUMBLE_AXIS = new THREE.Vector3(Math.sin(0.62), Math.cos(0.62), 0);
const Q0 = new THREE.Quaternion(), QC = qAxis(TUMBLE_AXIS, -Math.PI), Q1 = qAxis(Y, -Math.PI);

function flipPose(type, p, W) {
  const pose = { q: new THREE.Quaternion(), x: 0, z: 0, open: Math.sin(Math.PI * p), curl: null, twist: 0, shadowLift: 0 };
  if (p <= 0) return pose;
  if (type === 'twist') {
    const th = Math.PI * easeIO(clamp((p - 0.12) / 0.88, 0, 1));
    pose.q = qAxis(X, -Math.sin(th) * 0.08).multiply(qAxis(Y, -th));
    pose.z = Math.abs(Math.sin(th)) ** 0.75 * 36;
    const e = envelope(p, 0.14, 0.7);
    pose.curl = { hinge: 1.9 * e, tip: -0.45 * e, reach: W * (0.24 + 0.12 * smooth(0, 0.4, p)), angle: lerp(-Math.PI / 4, -0.25, smooth(0.05, 0.5, p)), mix: 1 };
    pose.twist = 0.85 * Math.sin(Math.PI * p) * (1 - 1.25 * p); // 下半部領先，最後微微反扭
  } else if (type === 'tumble') {
    const s = easeIO(clamp((p - 0.14) / 0.86, 0, 1));
    pose.q = slerpRaw(slerpRaw(Q0, QC, s), slerpRaw(QC, Q1, s), s);
    pose.z = Math.sin(Math.PI * p) ** 0.8 * 72;
    const e = envelope(p, 0.14, 0.6);
    pose.curl = { hinge: 1.5 * e, tip: -0.4 * e, reach: W * 0.3, angle: -Math.PI / 4, mix: 1 };
  } else {
    const th = Math.PI * easeIO(clamp((p - 0.12) / 0.88, 0, 1));
    const xa = -0.42 * W * (1 - smooth(0.4, 1, p)); // 軸心：先靠近左緣，過半滑回中線
    pose.q = qAxis(Y, -th);
    pose.x = xa * (1 - Math.cos(th));
    pose.z = -xa * Math.sin(th) + Math.sin(th) * 16;
    const e = envelope(p, 0.3, 0.97);
    pose.curl = { hinge: 1.55 * e, tip: 0.25 * e, reach: W * (0.22 + 0.5 * envelope(p, 0.42, 1)), angle: lerp(-Math.PI / 4, -0.1, smooth(0.05, 0.55, p)), mix: 0.35 };
  }
  return pose;
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
    bKicker: box(q('.kicker'), br), story: box(q('.story'), br), ask: box(q('.ask'), br), question: box(q('.question'), br), answer: box(q('.answer'), br),
    style: {
      frontBg: getComputedStyle(front).backgroundColor, backBg: getComputedStyle(back).backgroundColor,
      line: resolveColor(card, 'rgb(var(--ink) / .07)'), dash: resolveColor(card, 'rgb(var(--ink) / .25)'),
      tapeA: resolveColor(tape, 'var(--tape-a)'), tapeB: resolveColor(tape, 'var(--tape-b)'), tapeShadow: resolveColor(card, 'rgb(var(--ink) / .15)'),
      stampFont: fontOf(stamp), stampColor: getComputedStyle(stamp).color, stampGlow: resolveColor(card, 'var(--stamp-glow)'),
      kickerFont: fontOf(front.querySelector('.kicker')), kickerColor: getComputedStyle(front.querySelector('.kicker')).color,
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
  drawTape(f, m);
  const [bc, b] = make();
  b.fillStyle = st.backBg; b.fillRect(0, 0, W, H);
  b.fillStyle = st.line;
  for (let y = 31; y < H; y += 32) b.fillRect(0, y, W, 1);
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
  b.save(); b.translate(W, 0); b.scale(-1, 1); drawTape(b, m); b.restore();
  return [fc, bc];
}

/* ── 一張紙：mock 每張自己一個 renderer（官網是共用一個 context） ── */
const MARGIN = 160, FLOOR_Z = -26, SEG_X = 44, SEG_Y = 56;
const QN = [new THREE.Quaternion(), qAxis(Y, -Math.PI)];

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

  const [fc, bc] = textures(card, m, img, TOP, dpr);
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
  meshF.receiveShadow = meshB.receiveShadow = true;
  const tapeX = m.tape.x + m.tape.w / 2 - W / 2;
  const pivot = new THREE.Group(); pivot.position.set(tapeX, H / 2, 0);
  const holder = new THREE.Group(); holder.position.set(-tapeX, -H / 2, 0);
  const paper = new THREE.Group(); paper.add(meshF, meshB);
  holder.add(paper); pivot.add(holder); scene.add(pivot);

  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.28, depthWrite: false, depthTest: false });
  shadowMat.transparent = false;
  shadowMat.blending = THREE.CustomBlending;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(VW * 2, VH * 2), shadowMat);
  floor.position.z = FLOOR_Z; floor.renderOrder = -1; floor.receiveShadow = true;
  scene.add(floor);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9)); // 官網 1.35／1.6；拉開明暗讓彎曲讀得出來，平貼時亮度相同
  const key = new THREE.DirectionalLight(0xfff4e0, 2.1);
  key.position.set(W * 0.6, H * 0.9, dist * 0.7);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -VW, right: VW, top: VH, bottom: -VH, far: dist * 2 });
  key.shadow.radius = 6;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.6;
  scene.add(key);

  const base = Float32Array.from(geo.attributes.position.array);
  const pos = geo.attributes.position.array;
  const pt = { x: 0, y: 0, z: 0 };
  const local = { tabs: newTables(), active: false };
  const billow = { tabs: newTables(), active: false, nx: 0, ny: -1, ox: 0, oy: H / 2, D: H, ripple: 0, rippleK: 0, rippleW: 0 };

  // 變形在「翻面起點那一面朝向觀者」的座標裡算：翻到背面後 x、z 反過來，永遠是觀者看到的右下角先起
  function deform(time, pose, facing) {
    const calm = 1 - smooth(0, 0.12, Math.min(pose.open * 2, 1)); // 一開始翻，風的捲曲就讓給翻面
    let hinge = state.phi * calm, tip = state.tip * calm, reach = WIND.reach[0] + WIND.reach[1] * state.reach, angle = -Math.PI / 4 + state.delta, mix = 1, ripple = WIND.ripple;
    const c = pose.curl;
    if (c && c.hinge >= hinge) {
      ({ hinge, tip, reach, angle, mix } = c);
      ripple = 0;
    }
    const nx = Math.cos(angle), ny = Math.sin(angle);
    Object.assign(local, { nx, ny, ox: W / 2 - nx * reach, oy: -H / 2 - ny * reach, D: reach, ripple, rippleK: WIND.rippleK, rippleW: WIND.rippleW, active: hinge > 1e-4 || Math.abs(tip) > 1e-4 });
    if (local.active) fillTables(local.tabs, u => hinge * (mix * (1 - (1 - u) ** 3) + (1 - mix) * u) + tip * u ** 3, ripple);
    const lift = state.billow * calm;
    billow.active = lift > 1e-4;
    if (billow.active) fillTables(billow.tabs, u => lift * u ** 1.4, 0);
    const tw = pose.twist;
    for (let i = 0; i < pos.length; i += 3) {
      pt.x = base[i] * facing; pt.y = base[i + 1]; pt.z = 0;
      bendPoint(pt, local, time);
      if (tw) {
        // 上下扭轉：越下面繞中線多轉一點（同翻面方向），膠帶那一帶不動
        const a = tw * clamp((H / 2 - pt.y) / H, 0, 1) ** 1.3, co = Math.cos(a), si = Math.sin(a), x = pt.x, z = pt.z;
        pt.x = x * co - z * si; pt.z = x * si + z * co;
      }
      bendPoint(pt, billow, time);
      pos[i] = pt.x * facing; pos[i + 1] = pt.y; pos[i + 2] = pt.z * facing;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }

  function draw(now) {
    // 翻面：線性時間推進 rot（每半圈 -1），各版自己的緩動寫在 flipPose；停穩收回 0／-1
    if (state.rotGoal !== state.rot) {
      // rAF 的時間戳是影格開始時間，可能早於點擊當下的 performance.now()：夾在 0–1，否則 rot 會跑到正數
      const t = clamp((now - state.rotStart) / state.rotMs, 0, 1);
      state.rot = state.rotFrom + (state.rotGoal - state.rotFrom) * t;
      if (t >= 1) state.rot = state.rotGoal = (((state.rotGoal % 2) + 2) % 2 === 0 ? 0 : -1);
    }
    const u = -state.rot, n = Math.floor(u + 1e-6), p = Math.max(0, u - n), side = ((n % 2) + 2) % 2;
    const pose = flipPose(state.flip, p, W);
    paper.quaternion.copy(pose.q).multiply(QN[side]);
    paper.position.set(pose.x, 0, pose.z);
    pivot.rotation.z = state.sway * (1 - pose.open);
    deform(now / 1000, pose, side === 0 ? 1 : -1);
    const height = clamp(pose.z / 72, 0, 1);
    shadowMat.opacity = 0.28 * (1 - 0.35 * height);
    key.shadow.radius = 6 + 8 * height;
    renderer.render(scene, camera);
  }

  card.classList.add('webgl');
  return { draw, flipping: () => state.rot !== state.rotGoal };
}

/* ── 捲動 → 風（A 角落捲起） ── */
let velocity = 0, lastY = scrollY, lastScrollAt = performance.now(), gustUntil = 0;
addEventListener('scroll', () => {
  const now = performance.now();
  const v = ((scrollY - lastY) / Math.max(16, now - lastScrollAt)) * 1000;
  lastY = scrollY;
  lastScrollAt = now;
  velocity = velocity * 0.5 + v * 0.5;
  kick();
}, { passive: true });

const spring = (s, key, target, k, c, dt) => {
  s[key + 'V'] += (k * (target - s[key]) - c * s[key + 'V']) * dt;
  s[key] += s[key + 'V'] * dt;
};
const REST = { w: 0, phi: 0, phiV: 0, tip: 0, reach: 0, reachV: 0, billow: 0, billowV: 0, sway: 0, swayV: 0, delta: 0 };
const cards = [...document.querySelectorAll('.card')].map((card, i) => {
  const d = directions.find(x => x.key === card.closest('.direction').dataset.direction);
  return { card, key: d.key, flip: d.flip, ms: d.ms, seed: i * 7.31 + 3.7, rot: 0, rotGoal: 0, rotFrom: 0, rotStart: 0, rotMs: d.ms, paper: null, visible: false, dirty: false, ...REST };
});

function stepCard(s, target, dt, t) {
  s.w += (target - s.w) * (1 - Math.exp(-dt / (target > s.w ? 0.07 : 0.6)));
  const w = s.w, gusty = 0.65 + 0.35 * fbm(t * 1.1 + s.seed);
  spring(s, 'phi', WIND.phi * w * gusty, 45, 4.8, dt);
  if (s.phi < 0) { s.phi = 0; if (s.phiV < 0) s.phiV *= -0.25; }
  spring(s, 'reach', w, 40, 9, dt);
  spring(s, 'billow', WIND.billow * w * (0.75 + 0.25 * fbm(t * 1.6 + s.seed * 7)), 22, 3.2, dt);
  s.billow = Math.max(0, s.billow);
  spring(s, 'sway', Math.sign(velocity || 1) * ((WIND.sway * Math.PI) / 180) * w * (0.6 + 0.4 * fbm(t * 0.9 + s.seed * 11)), 22, 3, dt);
  s.delta = 0.2 * fbm(t * 0.6 + s.seed * 5) * Math.min(1, w * 2);
  s.tip = -0.28 * s.phi - 0.004 * s.phiV;
  return w > 0.002 || s.phi > 0.002 || Math.abs(s.phiV) > 0.01 || s.billow > 0.0005 || Math.abs(s.billowV) > 0.002 || Math.abs(s.sway) > 0.0002 || Math.abs(s.swayV) > 0.001 || Math.abs(s.reach) > 0.002;
}

/* ── 共用時鐘 ── */
let frame = 0, prevFrame = 0, frozen = false;
function kick() {
  if (frame || reduced.matches || frozen) return;
  prevFrame = performance.now();
  frame = requestAnimationFrame(tick);
}
function tick(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - prevFrame) / 1000));
  prevFrame = now;
  const t = now / 1000;
  if (now - lastScrollAt > 60 && now > gustUntil) velocity *= 0.02 ** dt;
  const target = now < gustUntil ? 1 : Math.min(1, Math.abs(velocity) / 2100);
  let moving = Math.abs(velocity) > 4 || now < gustUntil;
  for (const s of cards) {
    if (!s.paper) continue;
    const active = stepCard(s, target, dt, t);
    const flipping = s.paper.flipping();
    if (active || flipping) moving = true;
    if (!s.visible || !(active || flipping || s.dirty)) continue;
    // 顫動不經彈簧（紙很輕，8–10Hz 會被彈簧濾掉），畫的時候直接疊上去
    const keep = [s.phi, s.tip];
    s.phi = Math.max(0, s.phi + 0.4 * WIND.flutter * s.w * fbm(t * 7.1 + s.seed));
    s.tip += WIND.flutter * s.w * fbm(t * 10.3 + s.seed * 3);
    s.paper.draw(now);
    [s.phi, s.tip] = keep;
    s.dirty = active || flipping;
  }
  if (moving) { frame = requestAnimationFrame(tick); return; }
  frame = 0;
  velocity = 0;
  for (const s of cards) if (s.paper) { Object.assign(s, REST); if (s.visible) s.paper.draw(now); }
}

/* ── 翻面 ── */
const slowButton = document.querySelector('.slow');
const slowFactor = () => (slowButton.getAttribute('aria-pressed') === 'true' ? 3 : 1);
function flip(s, event) {
  const button = s.card.querySelector('.turn');
  const title = s.card.closest('.direction').querySelector('h2').textContent;
  const flipped = s.card.classList.toggle('is-flipped');
  if (s.paper) {
    // 翻到一半再點：往反方向回到最近的整數半圈（連點幾次都不會停在半路）
    const goal = s.rot === s.rotGoal ? s.rot - 1 : s.rotGoal < s.rot ? Math.ceil(s.rot) : Math.floor(s.rot);
    s.rotFrom = s.rot;
    s.rotGoal = goal;
    s.rotMs = s.ms * slowFactor() * Math.max(0.35, Math.abs(goal - s.rot));
    s.rotStart = performance.now();
    kick();
  } else {
    const turn = (Number(s.card.dataset.turn) || 0) - 1;
    s.card.dataset.turn = String(turn);
    s.card.style.setProperty('--flip', `${turn * 180}deg`);
  }
  s.card.querySelector('.front').inert = flipped;
  s.card.querySelector('.back').inert = !flipped;
  button.setAttribute('aria-expanded', String(flipped));
  button.setAttribute('aria-label', `${title}：${flipped ? `回到「${s.card.dataset.label}」的照片` : `翻到背面，看「${s.card.dataset.label}」的故事`}`);
  if (event?.detail > 0) button.blur();
}
for (const s of cards) s.card.querySelector('.turn').addEventListener('click', event => flip(s, event));

/* ── 控制列 ── */
slowButton.addEventListener('click', () => slowButton.setAttribute('aria-pressed', String(slowButton.getAttribute('aria-pressed') !== 'true')));
const gustButton = document.querySelector('.gust');
gustButton.addEventListener('click', () => {
  velocity = 2300;
  gustUntil = performance.now() + 450;
  lastScrollAt = performance.now() + 450; // 當作持續捲動 0.45 秒
  kick();
});
// 並排比較：每一列的三版同時翻，上下兩列錯開 0.25 秒
document.querySelector('.flip-all').addEventListener('click', () => {
  for (const s of cards) {
    if (s.card.closest('[hidden]')) continue;
    const row = [...s.card.parentElement.children].indexOf(s.card);
    setTimeout(() => flip(s), row * 250);
  }
});
function applyMotionPreference() {
  for (const b of [gustButton, slowButton, document.querySelector('.flip-all')]) b.disabled = reduced.matches;
}
reduced.addEventListener('change', applyMotionPreference);
applyMotionPreference();

/* ── 載入紙張：減少動態、沒有 WebGL 就維持 DOM 版（平貼、CSS 翻面） ── */
const seen = new IntersectionObserver(entries => {
  for (const e of entries) {
    const s = cards.find(c => c.card === e.target);
    s.visible = e.isIntersecting;
    if (s.visible && s.paper) { s.dirty = true; kick(); }
  }
}, { rootMargin: '160px 0px' });

// 截圖用：把所有紙停在翻面進度 p（0–1），不跑時鐘
window.mockPose = p => {
  frozen = true;
  cancelAnimationFrame(frame);
  frame = 0;
  for (const s of cards) if (s.paper) { Object.assign(s, REST, { rot: -p, rotGoal: -p, rotFrom: -p }); s.paper.draw(performance.now()); }
};

async function boot() {
  if (reduced.matches) { document.body.dataset.ready = '1'; return; }
  await document.fonts.ready;
  for (const s of cards) {
    if (s.card.closest('[hidden]')) continue;
    try {
      s.paper = await mountPaper(s);
      seen.observe(s.card);
      s.paper.draw(performance.now());
    } catch (error) {
      console.warn('WebGL 紙張失敗，維持 DOM 版', error);
    }
  }
  document.body.dataset.ready = '1';
}
boot();
