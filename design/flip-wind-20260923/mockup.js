import * as THREE from 'three';

// 內容取自 web/server/data/site-fixture.json 的 dayExperience.moments
const moments = [
  { key: 'hello', n: '01', label: '早安入園', time: '08:00', tint: 'yellow', photo: 'day-hello', alt: '孩子在熟悉的環境裡，與身旁的人互動', title: ['早安，今天的我', '準備好了。'], story: '和家人說聲再見，走進熟悉的校園。從整理小書包開始，一點一點，找到自己的步調。', question: '孩子第一次上學，如何陪伴適應？', answer: '參觀時可以與園所聊聊：初次入園的陪伴方式、家長如何與老師聯繫，以及可以事先做哪些準備。' },
  { key: 'discover', n: '02', label: '好奇探索', time: '09:10', tint: 'mint', photo: 'day-discover', alt: '老師陪伴孩子操作幾何教具', title: ['我的「為什麼」，', '今天又多了一個。'], story: '摸一摸、看一看，再和同伴試一次。那些讓眼睛發亮的小發現，是認識世界的開始。', question: '孩子平常會接觸哪些學習活動？', answer: '可以詢問該校如何安排探索活動、使用哪些教具與素材，以及如何依照年齡和孩子的興趣調整內容。' },
];

/* 每版的風（弧度／px）：
   phi 被掀起那塊的末端最多轉幾度（超過 π/2 就翻過來露出背面）、reach 被掀起的範圍 [基本, 風滿時再加]、
   billow 整張以上緣為軸離牆、sway 繞膠帶擺（deg）、ripple 沿邊緣傳遞的波（rippleW 正負決定方向） */
const directions = [
  { key: 'a', title: '角落捲起', subtitle: '原本折角的位置，被風從牆上捲起來', level: 1,
    wind: { phi: 2.7, flutter: 0.16, reach: [50, 80], billow: 0.05, sway: 0.4, ripple: 0.12, rippleK: 0.045, rippleW: 9 },
    desc: '<strong>只動右下角，最含蓄。</strong><br>捲得越快，被掀起的角越大、捲得越過去；一陣強風會整個翻過來，露出一角背面的橫線紙。停下時落回牆面，輕輕彈一下。',
    trigger: '頁面捲動，手機滑動一樣有效', reduce: '不做，維持平貼', site: 'WebGL：角落網格沿對角線捲曲（本頁做法）；手機 CSS 版需另做近似' },
  { key: 'b', title: '右緣掀起', subtitle: '風從右邊來，預演翻面的方向', level: 2,
    wind: { phi: 2.8, flutter: 0.14, reach: [40, 96], billow: 0.07, sway: 0.5, ripple: 0.12, rippleK: 0.03, rippleW: 7 },
    desc: '<strong>掀起的方式就是翻面的方式。</strong><br>右緣翹起、往左倒，下半段掀得比上半段多（上緣有膠帶）；波從下往上沿著邊緣傳。點下去時，紙就照同一個方向整張翻過去。',
    trigger: '頁面捲動，手機滑動一樣有效', reduce: '不做，維持平貼', site: 'WebGL：右側網格帶狀捲曲，和 printFlip.ts「右緣掀起往左翻」同向' },
  { key: 'c', title: '下緣飄起', subtitle: '膠帶黏上緣，整張下半部被吹得飄', level: 3,
    wind: { phi: 2.3, flutter: 0.14, reach: [30, 62], billow: 0.3, sway: 1.1, ripple: 0.18, rippleK: 0.028, rippleW: -8 },
    desc: '<strong>最像風。</strong><br>以膠帶為軸，整張下半部離開牆面、繞膠帶擺；下緣再往上捲，一陣強風時露出一條背面。波沿著下緣從右往左跑。',
    trigger: '頁面捲動，手機滑動一樣有效', reduce: '不做，維持平貼', site: 'WebGL：上緣為軸的整片彎曲＋下緣捲曲兩段疊加' },
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
    <button class="turn" type="button" aria-expanded="false" aria-controls="${id}" aria-label="${d.title}：翻到背面，看「${m.label}」的故事"></button>
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
const view = ['a', 'b', 'c'].includes(params.get('view')) ? params.get('view') : 'all';
document.body.dataset.view = view;
document.querySelector(`.intro-aside [data-view="${view}"]`).setAttribute('aria-current', 'page');
for (const el of document.querySelectorAll('.direction')) el.hidden = view !== 'all' && el.dataset.direction !== view;

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
  drawTape(f, m);
  // 背面：從背面看的版面；紙膠帶左右對調
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
  meshF.receiveShadow = meshB.receiveShadow = true; // 掀起來的那塊把影子投在自己的紙面上
  // 擺動繞膠帶：pivot 放在膠帶中心（紙的上緣），翻面繞紙的中線
  const tapeX = m.tape.x + m.tape.w / 2 - W / 2;
  const pivot = new THREE.Group(); pivot.position.set(tapeX, H / 2, 0);
  const holder = new THREE.Group(); holder.position.set(-tapeX, -H / 2, 0);
  const paper = new THREE.Group(); paper.add(meshF, meshB);
  holder.add(paper); pivot.add(holder); scene.add(pivot);

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

  const base = Float32Array.from(geo.attributes.position.array);
  const pos = geo.attributes.position.array;
  const pt = { x: 0, y: 0, z: 0 };
  const local = { tabs: newTables(), active: false };
  const billow = { tabs: newTables(), active: false, nx: 0, ny: -1, ox: 0, oy: H / 2, D: H, rippleK: 0.02, rippleW: -5 };

  // 風在「觀者看到的那一面」的座標裡算：翻到背面時 x、z 反過來，紙永遠往觀者這邊掀
  function deform(time, amt, facing) {
    const w = state.wind, reach = w.reach[0] + w.reach[1] * state.reach, tilt = state.delta;
    let a;
    if (state.key === 'a') a = -Math.PI / 4 + tilt;
    else if (state.key === 'b') a = -0.15 + tilt * 0.5;
    else a = -Math.PI / 2 + tilt * 0.4;
    const nx = Math.cos(a), ny = Math.sin(a), cx = state.key === 'c' ? 0 : W / 2; // A、B 從右下角往內量，C 從下緣中點往上量
    const hinge = state.phi * amt, tip = state.tip * amt;
    Object.assign(local, { nx, ny, ox: cx - nx * reach, oy: -H / 2 - ny * reach, D: reach, ripple: w.ripple, rippleK: w.rippleK, rippleW: w.rippleW, active: hinge > 1e-4 || Math.abs(tip) > 1e-4 });
    if (local.active) fillTables(local.tabs, u => hinge * (1 - (1 - u) ** 3) + tip * u ** 3, w.ripple);
    const lift = state.billow * amt;
    billow.ripple = state.key === 'c' ? 0.15 : 0;
    billow.active = lift > 1e-4;
    if (billow.active) fillTables(billow.tabs, u => lift * u ** 1.4, billow.ripple);
    for (let i = 0; i < pos.length; i += 3) {
      pt.x = base[i] * facing; pt.y = base[i + 1]; pt.z = 0;
      bendPoint(pt, local, time);
      bendPoint(pt, billow, time);
      pos[i] = pt.x * facing; pos[i + 1] = pt.y; pos[i + 2] = pt.z * facing;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
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

/* ── 捲動 → 風：速度越快風越大；按鈕模擬一陣 0.45 秒的快速捲動 ── */
let velocity = 0, lastY = scrollY, lastScrollAt = performance.now(), windDir = 1, gustUntil = 0;
addEventListener('scroll', () => {
  const now = performance.now();
  const v = ((scrollY - lastY) / Math.max(16, now - lastScrollAt)) * 1000;
  lastY = scrollY;
  lastScrollAt = now;
  velocity = velocity * 0.5 + v * 0.5;
  if (Math.abs(velocity) > 30) windDir = Math.sign(velocity);
  kick();
}, { passive: true });

const spring = (s, key, target, k, c, dt) => {
  s[key + 'V'] += (k * (target - s[key]) - c * s[key + 'V']) * dt;
  s[key] += s[key + 'V'] * dt;
};
const REST = { w: 0, breeze: 0, phi: 0, phiV: 0, tip: 0, reach: 0, reachV: 0, billow: 0, billowV: 0, sway: 0, swayV: 0, delta: 0 };
const cards = [...document.querySelectorAll('.card')].map((card, i) => {
  const key = card.closest('.direction').dataset.direction;
  return { card, key, wind: directions.find(d => d.key === key).wind, seed: i * 7.31 + 3.7, rot: 0, rotGoal: 0, rotFrom: 0, rotStart: 0, rotMs: FLIP_MS, paper: null, visible: false, dirty: false, breezeFrom: 0, ...REST };
});

function stepCard(s, target, dt, t) {
  s.w += (target - s.w) * (1 - Math.exp(-dt / (target > s.w ? 0.07 : 0.6))); // 風起得快、收得慢
  const w = Math.max(s.w, s.breeze), p = s.wind;
  const gusty = 0.65 + 0.35 * fbm(t * 1.1 + s.seed); // 同一陣風裡的強弱
  const dir = s.breeze > s.w ? -1 : windDir;
  // 被掀起那塊：比折角重一點、欠阻尼；落回牆面時反彈 25%
  spring(s, 'phi', p.phi * w * gusty, 45, 4.8, dt);
  if (s.phi < 0) { s.phi = 0; if (s.phiV < 0) s.phiV *= -0.25; }
  spring(s, 'reach', w, 40, 9, dt);
  // 整張：更重，慢一點、晃得久一點
  spring(s, 'billow', p.billow * w * (0.75 + 0.25 * fbm(t * 1.6 + s.seed * 7)), 22, 3.2, dt);
  s.billow = Math.max(0, s.billow);
  spring(s, 'sway', dir * ((p.sway * Math.PI) / 180) * w * (0.6 + 0.4 * fbm(t * 0.9 + s.seed * 11)), 22, 3, dt);
  s.delta = 0.2 * fbm(t * 0.6 + s.seed * 5) * Math.min(1, w * 2); // 風向小幅飄移，折線跟著斜
  s.tip = -0.28 * s.phi - 0.004 * s.phiV; // 末端逆風往回彎，翻得越快彎得越多
  return w > 0.002 || s.phi > 0.002 || Math.abs(s.phiV) > 0.01 || s.billow > 0.0005 || Math.abs(s.billowV) > 0.002 || Math.abs(s.sway) > 0.0002 || Math.abs(s.swayV) > 0.001 || Math.abs(s.reach) > 0.002;
}

/* ── 靜止時微風（開關）：停止捲動 2 秒後每 5–9 秒一陣 2 秒的微風，從右往左掃過 ── */
const BREEZE_MS = 2000;
const breezeButton = document.querySelector('.breeze');
let breezeTimer = 0;
function scheduleBreeze(ms = 5000 + Math.random() * 4000) {
  clearTimeout(breezeTimer);
  if (breezeButton.getAttribute('aria-pressed') === 'true') breezeTimer = setTimeout(tryBreeze, ms);
}
function tryBreeze() {
  if (reduced.matches || document.hidden) return scheduleBreeze();
  if (performance.now() - lastScrollAt < 2000) return scheduleBreeze(2000);
  const now = performance.now();
  for (const s of cards) {
    if (!s.paper || !s.visible || s.rot !== s.rotGoal) continue;
    const r = s.card.getBoundingClientRect();
    s.breezeFrom = now + (1 - (r.left + r.width / 2) / innerWidth) * 650; // 右邊那張先被吹到
    s.breezeAmp = 0.5 + Math.random() * 0.15;
  }
  kick();
  scheduleBreeze();
}
function breezeLevel(s, now) {
  if (!s.breezeFrom) return 0;
  const k = (now - s.breezeFrom) / BREEZE_MS;
  if (k <= 0) return 0;
  if (k >= 1) { s.breezeFrom = 0; return 0; }
  return s.breezeAmp * Math.sin(Math.PI * k) ** 2;
}
breezeButton.addEventListener('click', () => {
  const on = breezeButton.getAttribute('aria-pressed') !== 'true';
  breezeButton.setAttribute('aria-pressed', String(on));
  if (on) scheduleBreeze(1200);
  else clearTimeout(breezeTimer);
});

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
  if (now - lastScrollAt > 60 && now > gustUntil) velocity *= 0.02 ** dt;
  const target = now < gustUntil ? 1 : Math.min(1, Math.abs(velocity) / 2100);
  let moving = Math.abs(velocity) > 4 || now < gustUntil;
  for (const s of cards) {
    if (!s.paper) continue;
    s.breeze = breezeLevel(s, now);
    if (s.breezeFrom) moving = true;
    const active = stepCard(s, target, dt, t);
    const flipping = s.paper.flipping();
    if (active || flipping) moving = true;
    if (!s.visible || !(active || flipping || s.dirty)) continue;
    // 顫動不經彈簧（紙很輕，8–10Hz 會被彈簧濾掉），畫的時候直接疊上去
    const w = Math.max(s.w, s.breeze), keep = [s.phi, s.tip, s.billow];
    s.phi = Math.max(0, s.phi + 0.4 * s.wind.flutter * w * fbm(t * 7.1 + s.seed));
    s.tip += s.wind.flutter * w * fbm(t * 10.3 + s.seed * 3);
    s.billow = Math.max(0, s.billow + 0.02 * w * fbm(t * 5.3 + s.seed * 2));
    s.paper.draw(now);
    [s.phi, s.tip, s.billow] = keep;
    s.dirty = active || flipping;
  }
  if (moving) { frame = requestAnimationFrame(tick); return; }
  frame = 0;
  velocity = 0;
  // 停穩：收回完全平貼，補畫一幀
  for (const s of cards) if (s.paper) { Object.assign(s, REST); if (s.visible) s.paper.draw(now); }
}

/* 翻面：WebGL 版由紙自己轉；沒有 WebGL 就是 CSS 3D 版 */
for (const s of cards) {
  const button = s.card.querySelector('.turn');
  const title = s.card.closest('.direction').querySelector('h2').textContent;
  button.addEventListener('click', event => {
    const flipped = s.card.classList.toggle('is-flipped');
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
    button.setAttribute('aria-expanded', String(flipped));
    button.setAttribute('aria-label', `${title}：${flipped ? `回到「${s.card.dataset.label}」的照片` : `翻到背面，看「${s.card.dataset.label}」的故事`}`);
    if (event.detail > 0) button.blur();
  });
}

/* ── 控制列 ── */
const gustButton = document.querySelector('.gust');
gustButton.addEventListener('click', () => {
  velocity = 2300 * windDir;
  gustUntil = performance.now() + 450;
  lastScrollAt = performance.now() + 450; // 當作持續捲動 0.45 秒
  kick();
});
function applyMotionPreference() {
  gustButton.disabled = breezeButton.disabled = reduced.matches;
}
reduced.addEventListener('change', applyMotionPreference);
applyMotionPreference();

/* ── 載入紙張：減少動態、沒有 WebGL 就維持 DOM 版（平貼、不起風） ── */
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
    // ?still=1：一陣風最強時的定格
    const poses = { a: { phi: 2.3, tip: -0.55, reach: 0.9, billow: 0.03 }, b: { phi: 2.2, tip: -0.5, reach: 0.85, billow: 0.05 }, c: { phi: 1.9, tip: -0.45, reach: 0.8, billow: 0.24, sway: 0.014 } };
    for (const s of cards) if (s.paper) { Object.assign(s, poses[s.key]); s.paper.draw(performance.now()); }
  } else {
    for (const s of cards) if (s.paper) s.paper.draw(performance.now());
  }
  document.body.dataset.ready = '1';
}
boot();
