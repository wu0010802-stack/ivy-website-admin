/* 常春藤 30 週年紀念影片《長成自己喜歡的樣子》— 逐格算圖的時間軸。
 *
 * 由 render.mjs 以無頭 Chromium 開啟，對每一格呼叫 window.seek(frame)，畫面全部由 frame 決定（沒有 CSS 動畫、
 * 沒有計時器），所以任何一格都能單獨重算。30fps、90 BPM：一拍 20 格、一小節 80 格；全片 4320 格（144 秒）。
 * 分鏡見 ../TREATMENT.md。素材路徑以 repo 根目錄為網站根目錄（render.mjs 會起一個本機靜態伺服器）。
 */
'use strict';

const VERT = new URLSearchParams(location.search).get('fmt') === 'v'; // 直式 9:16 版
const W = VERT ? 1080 : 1920, H = VERT ? 1920 : 1080, FPS = 30, BEAT = 20, BAR = 80, TOTAL = 4320;
const CX = W / 2;
/* 版面：橫式 16:9 與直式 9:16 各一份，時間軸（格數）完全相同（第一、二幕的版面在 sky.js） */
const LAY = VERT ? {
  paper: { src: 'stills/paper-v.png', w: 1188, h: 2112 },
  foot: { w: 1296, h: 2304 },
  cap: { size: 56, y1: 1400, y2: 1482, tsize: 64, ty1: 300, ty2: 394, scrim: 760 },
  crest: { main: [880, 830], up: [700, 790], end: [700, 820], title: 1210, years: 1340, outro1: 1108, outro2: 1306, brand: 1138 },
} : {
  paper: { src: 'stills/paper.png', w: 2112, h: 1188 },
  foot: { w: 2304, h: 1296 },
  cap: { size: 60, y1: 812, y2: 900, tsize: 70, ty1: 118, ty2: 222, scrim: 460 },
  crest: { main: [880, 430], up: [620, 392], end: [620, 432], title: 772, years: 902, outro1: 700, outro2: 806, brand: 716 },
};
const PAD = { x: (LAY.paper.w - (VERT ? 1080 : 1920)) / 2, y: (LAY.paper.h - (VERT ? 1920 : 1080)) / 2 };
const OUT = '/output/anniversary-film/';
const WEB = '/web/public/assets/';
const C = {
  green: '#244933', deep: '#152F23', leaf: '#386A4B', gold: '#EFBC4B', yellow: '#F8CF68', paper: '#FDFCF6',
  cream: '#F5F2E5', mint: '#CEDCD0', text: '#25342C', muted: '#505F55', line: '#CAD4CA',
  logoGreen: '#075B30', logoBlue: '#29266D', paperBg: '#FBF9F1',
};
const INK = '17, 42, 33';

/* ───────────── 數學 ───────────── */
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (f, a, b) => clamp((f - a) / (b - a));
const bar = (n) => Math.round(n * BAR);
const E = {
  lin: (t) => t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  out2: (t) => 1 - (1 - t) * (1 - t),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  in: (t) => t * t * t,
  in2: (t) => t * t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  inOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  outBack: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
};
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* 可重現的 value noise（256 格循環）與 fbm */
function makeNoise(seed) {
  const r = mulberry32(seed), N = 256, g = new Float32Array(N * N);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const at = (x, y) => g[((y & 255) << 8) | (x & 255)];
  const n = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y, oct = 4) => {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) { s += amp * n(x * f, y * f); norm += amp; amp *= 0.5; f *= 2.03; }
    return s / norm;
  };
}

/* ───────────── DOM ───────────── */
const stage = document.getElementById('stage');
stage.style.width = `${W}px`; stage.style.height = `${H}px`;
function el(tag, parent, style = {}, cls = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  Object.assign(e.style, style);
  (parent || stage).appendChild(e);
  return e;
}
const px = (v) => `${v}px`;
function show(e, on) { const d = on ? '' : 'none'; if (e.style.display !== d) e.style.display = d; }
function setStyle(e, k, v) { if (e.style[k] !== v) e.style[k] = v; }
const pending = [];
function loadImg(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => im.decode().then(() => res(im), () => res(im));
    im.onerror = () => rej(new Error('load failed: ' + url));
    im.src = url;
  });
}
function canvas(w, h, parent, style = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  Object.assign(c.style, { position: 'absolute', left: 0, top: 0, width: px(w), height: px(h) }, style);
  if (parent) parent.appendChild(c);
  return c;
}

/* ───────────── 逐字浮現的字卡 ───────────── */
class KText {
  constructor(parent, lines, o) {
    this.o = Object.assign({ size: 64, weight: 700, color: C.green, align: 'left', lh: 1.4, ls: 0.04, x: 0, y: 0, family: "'LINE Seed TW'", shadow: '' }, o);
    const s = this.o;
    this.root = el('div', parent, {
      position: 'absolute', left: px(s.x), top: px(s.y), fontFamily: s.family, fontWeight: s.weight,
      fontSize: px(s.size), lineHeight: String(s.lh), letterSpacing: `${s.ls}em`, color: s.color, textAlign: s.align,
      textShadow: s.shadow, display: 'none', whiteSpace: 'nowrap',
    });
    if (s.align === 'center') Object.assign(this.root.style, { width: px(s.w || 1600), marginLeft: px(-(s.w || 1600) / 2) });
    if (s.align === 'right') Object.assign(this.root.style, { width: px(s.w || 1600), marginLeft: px(-(s.w || 1600)) });
    this.chars = [];
    lines.forEach((line) => {
      const ld = el('div', this.root, {}, 'kline');
      [...line].forEach((ch) => { const sp = el('span', ld, {}, 'ch'); sp.textContent = ch; this.chars.push(sp); });
    });
  }
  /* tin：開始浮現的格；tout：開始消失的格（null＝不消失） */
  update(f, tin, tout, o = {}) {
    const { stagger = 1.6, dur = 24, rise = 0.34, blur = 10, outDur = 16, outRise = 0.18 } = o;
    const end = tout == null ? Infinity : tout + outDur;
    if (f < tin || f >= end) { show(this.root, false); return; }
    show(this.root, true);
    const po = tout == null ? 0 : E.inOut(prog(f, tout, tout + outDur));
    const sz = this.o.size;
    this.chars.forEach((c, i) => {
      const p = E.outQuint(prog(f, tin + i * stagger, tin + i * stagger + dur));
      const op = p * (1 - po);
      const ty = (1 - p) * rise * sz - po * outRise * sz;
      const bl = (1 - p) * blur + po * 5;
      setStyle(c, 'opacity', op.toFixed(3));
      setStyle(c, 'transform', `translate3d(0,${ty.toFixed(2)}px,0)`);
      setStyle(c, 'filter', bl > 0.05 ? `blur(${bl.toFixed(2)}px)` : 'none');
    });
  }
}

/* ───────────── 主程式 ───────────── */
const S = {}; // 場景物件
let READY = null;

async function init() {
  await document.fonts.load("800 200px 'LINE Seed TW'", '0123456789');
  await document.fonts.load("700 64px 'LINE Seed TW'", '常春藤');
  await document.fonts.load("400 24px 'Source Sans 3'", '1997');
  await document.fonts.load("600 24px 'Source Sans 3'", '1997');
  await document.fonts.load("600 60px 'Ivy Brand TC'", '常春藤教育機構');
  await document.fonts.load("400 30px 'Ivy Brand EN'", 'Ivy Educational Institution');

  const paper = await loadImg(OUT + LAY.paper.src);
  S.paper = paper;
  /* 第一、二幕〈星圖〉 */
  const [far, near] = await Promise.all([loadImg(OUT + 'stills/sky-far.png'), loadImg(OUT + 'stills/sky-near.png')]);
  const photos = {};
  await Promise.all(SKY_ORDER.map(async (k) => { photos[k] = await loadImg(`${OUT}stills/${k}-photo.png`); }));
  const daily = await Promise.all(SKY_DAILY.map((n) => loadImg(`${WEB}${n}.webp`)));
  await document.fonts.load("100 200px 'LINE Seed TW'", '0123456789');
  await document.fonts.load("400 36px 'LINE Seed TW'", '第一間常春藤在三民區義華路成立');
  S.sky = new Sky(stage, { far, near, photos, daily });

  /* 第三、四幕：影片 */
  S.footLayer = el('div', stage, { position: 'absolute', inset: 0, display: 'none', background: '#000', overflow: 'hidden' });
  S.footA = el('img', S.footLayer, { position: 'absolute', left: 0, top: 0, width: px(LAY.foot.w), height: px(LAY.foot.h), transformOrigin: '0 0' });
  S.footB = el('img', S.footLayer, { position: 'absolute', left: 0, top: 0, width: px(LAY.foot.w), height: px(LAY.foot.h), transformOrigin: '0 0', display: 'none' });
  S.scrim = el('div', S.footLayer, { position: 'absolute', left: 0, right: 0, bottom: 0, height: px(LAY.cap.scrim), background: `linear-gradient(to top, rgba(${INK},0.62), rgba(${INK},0.30) 45%, rgba(${INK},0))`, opacity: 0 });
  // 片名句放在聚光燈鏡頭上方的暗處（不壓孩子的白衣服），用自己的上方漸層
  S.scrimTop = el('div', S.footLayer, { position: 'absolute', left: 0, right: 0, top: 0, height: px(LAY.cap.scrim), background: `linear-gradient(to bottom, rgba(${INK},0.55), rgba(${INK},0.25) 50%, rgba(${INK},0))`, opacity: 0 });
  S.flash = el('div', S.footLayer, { position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 60% 40%, rgba(255,236,200,1), rgba(255,220,170,0.6) 45%, rgba(255,210,160,0) 75%)', mixBlendMode: 'screen', opacity: 0 });
  const capStyle = { size: LAY.cap.size, weight: 700, color: '#FFFFFF', align: 'center', w: 1800, ls: 0.08, shadow: `0 2px 18px rgba(${INK},0.55), 0 1px 3px rgba(${INK},0.5)` };
  S.caps = {
    home1: new KText(S.footLayer, ['孩子的第一所學校，'], { ...capStyle, x: CX, y: LAY.cap.y1 }),
    home2: new KText(S.footLayer, ['也是第二個家。'], { ...capStyle, x: CX, y: LAY.cap.y2 }),
    play1: new KText(S.footLayer, ['在遊戲裡，'], { ...capStyle, x: CX, y: LAY.cap.y1 }),
    play2: new KText(S.footLayer, ['慢慢長大。'], { ...capStyle, x: CX, y: LAY.cap.y2 }),
    day1: new KText(S.footLayer, ['每一天，'], { ...capStyle, x: CX, y: LAY.cap.y1 }),
    day2: new KText(S.footLayer, ['都有新發現。'], { ...capStyle, x: CX, y: LAY.cap.y2 }),
    heart1: new KText(S.footLayer, ['把每個孩子，'], { ...capStyle, x: CX, y: LAY.cap.y1 }),
    heart2: new KText(S.footLayer, ['放在心上。'], { ...capStyle, x: CX, y: LAY.cap.y2 }),
    title1: new KText(S.footLayer, ['陪伴每一個孩子，'], { ...capStyle, size: LAY.cap.tsize, x: CX, y: LAY.cap.ty1 }),
    title2: new KText(S.footLayer, ['長成自己喜歡的樣子。'], { ...capStyle, size: LAY.cap.tsize, x: CX, y: LAY.cap.ty2 }),
  };

  /* 第五幕：校徽組裝 */
  S.crestMeta = await (await fetch(OUT + 'stills/crest/layers.json')).json();
  S.crestLayer = el('div', stage, { position: 'absolute', inset: 0, display: 'none' });
  S.crestPaper = el('img', S.crestLayer, { position: 'absolute', left: px(-PAD.x), top: px(-PAD.y), width: px(LAY.paper.w), height: px(LAY.paper.h) });
  S.crestPaper.src = paper.src;
  S.crestBox = el('div', S.crestLayer, { position: 'absolute', left: 0, top: 0, width: '1254px', height: '1254px', transformOrigin: '0 0' });
  S.crest = {};
  for (const k of ['ribbon', 'banner', 'wreathL', 'wreathR', 'kids', 'crown', 'star1', 'star2', 'star3', 'star4', 'star5', 'star6']) {
    const im = el('img', S.crestBox, { position: 'absolute', left: 0, top: 0, width: '1254px', height: '1254px', transformOrigin: '0 0' });
    im.src = `${OUT}stills/crest/${k}.png`;
    S.crest[k] = im;
  }
  await Promise.all(Object.values(S.crest).map((im) => im.decode()));
  S.shine = el('div', S.crestBox, {
    position: 'absolute', left: 0, top: 0, width: '1254px', height: '1254px',
    maskImage: `url(${OUT}stills/crest/ribbon.png)`, webkitMaskImage: `url(${OUT}stills/crest/ribbon.png)`,
    maskSize: '1254px 1254px', webkitMaskSize: '1254px 1254px', mixBlendMode: 'screen', opacity: 0,
  });
  S.glints = canvas(W, H, S.crestLayer);
  S.glintCtx = S.glints.getContext('2d');
  S.anniTitle = new KText(S.crestLayer, ['常春藤 30 週年'], { x: CX, y: LAY.crest.title, size: 92, weight: 800, color: C.green, align: 'center', ls: 0.08 });
  S.anniYears = new KText(S.crestLayer, ['1997 — 2027'], { x: CX, y: LAY.crest.years, size: 34, weight: 600, family: "'Source Sans 3'", color: C.muted, align: 'center', ls: 0.32 });
  S.outro1 = new KText(S.crestLayer, VERT ? ['從義華的第一間，', '到現在高雄的五所校園。'] : ['從義華的第一間，到現在高雄的五所校園。'], { x: CX, y: LAY.crest.outro1, size: 52, weight: 700, color: C.text, align: 'center', ls: 0.06, lh: 1.45 });
  S.outro2 = new KText(S.crestLayer, ['義華・明華・崇德・國際・仁武'], { x: CX, y: LAY.crest.outro2, size: 36, weight: 700, color: C.leaf, align: 'center', ls: 0.3 });
  S.brand = el('div', S.crestLayer, { position: 'absolute', left: '0', top: '0', width: px(W), textAlign: 'center', opacity: 0 });
  S.brand.innerHTML = `<div id="brandBox" style="display:inline-block;position:absolute;left:50%;top:${LAY.crest.brand}px;transform:translateX(-50%)">
     <div id="brandTc" style="font-family:'Ivy Brand TC';font-weight:600;font-size:66px;line-height:1.1;color:${C.logoGreen};letter-spacing:.05em;white-space:nowrap">常春藤教育機構</div>
     <div id="brandEn" style="font-family:'Ivy Brand EN';font-weight:400;font-size:40px;line-height:1.45;color:${C.logoBlue};white-space:nowrap;text-align:left"><span id="brandEnText">Ivy Educational Institution</span></div></div>`;

  /* 衝進明華那顆星的白光（蓋在夜空與影片上） */
  S.white = el('div', stage, { position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 50%, #FFFDF8, #FFF3DE 60%, #F9E3B8)', opacity: 0, display: 'none' });

  /* 全片：黑場 */
  S.black = el('div', stage, { position: 'absolute', inset: 0, background: '#000', opacity: 0 });

  await document.fonts.ready;
  return true;
}

/* 影片剪接表（全片格數；len 取自 prepare_footage.py 的拍數 × 20） */
const EDIT = [
  ['mh-yard-hug', 1600, 80], ['mh-hug-smile', 1680, 80], ['mh-run-girls', 1760, 40], ['mh-climb', 1800, 40],
  ['mh-laugh-drum', 1840, 40], ['mh-hand-up', 1880, 40], ['mh-colour-wheel', 1920, 40], ['mh-water-cups', 1960, 40],
  ['mh-water-hands', 2000, 40], ['mh-water-table', 2040, 40], ['mh-curious', 2080, 40], ['mh-art-mess', 2120, 40],
  ['mh-chicken', 2160, 80], ['mh-basketball', 2240, 80], ['mh-paint', 2320, 40], ['mh-boy-laugh', 2360, 80],
  ['mh-boy-look-up', 2440, 40], ['mh-run-camera', 2480, 80], ['mh-purple-hands', 2560, 80], ['mh-look-up', 2640, 80],
  ['gr-hands', 2720, 160], ['gr-crowns', 2880, 80], ['gr-drum', 2960, 80], ['gr-sing', 3040, 80], ['gr-arm-up', 3120, 80],
  ['gr-gowns', 3200, 80], ['gr-arms-raised', 3280, 80], ['gr-spotlight', 3360, 160],
].map(([id, start, len]) => ({ id, start, len, src: id.slice(0, 2) }));
/* 每個鏡頭的慢推（相對於填滿畫面的縮放）與構圖微調（以 2304 寬素材的 px 計） */
const KB = {
  'mh-yard-hug': { s: [1.0, 1.08] }, 'mh-hug-smile': { s: [1.04, 1.12] }, 'gr-hands': { s: [1.0, 1.1] },
  'gr-spotlight': { s: [1.0, 1.12], y: [0, -30] }, 'mh-purple-hands': { s: [1.02, 1.1] }, 'mh-look-up': { s: [1.0, 1.08] },
  'mh-run-camera': { s: [1.06, 1.0] }, 'gr-gowns': { s: [1.0, 1.06] }, 'gr-arms-raised': { s: [1.06, 1.0] },
};
const GRADE = { mh: 'saturate(0.96) contrast(1.02)', gr: 'saturate(0.92) contrast(1.04) brightness(0.99)' };
const pad4 = (n) => String(n).padStart(4, '0');
function clipAt(f) { for (const c of EDIT) if (f >= c.start && f < c.start + c.len) return c; return null; }
async function setFootage(img, c, k, f) {
  const url = `${OUT}${VERT ? 'shots-v' : 'shots'}/${c.id}/${pad4(clamp(k, 1, c.len))}.jpg`;
  if (!img.src.endsWith(url)) {
    img.src = url;
    pending.push(img.decode().catch(() => { throw new Error('decode ' + url); }));
  }
  const kb = KB[c.id] || { s: [1.0, 1.05] };
  const t = E.inOutSine(clamp((f - c.start) / c.len));
  const sc = lerp(kb.s[0], kb.s[1], t) * (W / LAY.foot.w);
  const oy = kb.y ? lerp(kb.y[0], kb.y[1], t) : 0;
  const ox = kb.x ? lerp(kb.x[0], kb.x[1], t) : 0;
  const tx = W / 2 - (LAY.foot.w / 2 + ox) * sc, ty = H / 2 - (LAY.foot.h / 2 + oy) * sc;
  setStyle(img, 'transform', `translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,0) scale(${sc.toFixed(5)})`);
  setStyle(img, 'filter', GRADE[c.src]);
}

/* 一格 */
async function render(f) {
  pending.length = 0;
  const footage = f >= 1600 && f < 3540;
  const crest = f >= 3510;

  /* ── 第一、二幕〈星圖〉── */
  show(S.sky.root, f < 1600);
  if (f < 1600) S.sky.render(f);
  const wh = Math.max(E.in(prog(f, 1584, 1600)) * (f < 1600 ? 1 : 0), f >= 1600 ? 1 - E.out(prog(f, 1600, 1616)) : 0);
  show(S.white, wh > 0.001);
  setStyle(S.white, 'opacity', wh.toFixed(3));

  /* ── 第三、四幕：影片 ── */
  show(S.footLayer, footage);
  if (footage) {
    // 3520 之後（淡入紙色的那幾格）停在最後一個鏡頭的最後一格。
    // 一律由 frame 算出要哪一格，平行算圖時從任何一格開始都一樣。
    const ff = clamp(f, 1600, 3519);
    const c = clipAt(ff);
    if (c) await setFootage(S.footA, c, ff - c.start + 1, ff);
    // 第三幕 → 第四幕：交疊 10 格＋暖光
    const xf = f >= 2712 && f < 2722;
    show(S.footB, xf);
    if (xf) {
      const prev = EDIT.find((e) => e.id === 'mh-look-up');
      await setFootage(S.footB, prev, prev.len, 2719);
      setStyle(S.footB, 'opacity', (1 - prog(f, 2712, 2722)).toFixed(3));
    }
    setStyle(S.flash, 'opacity', (0.55 * Math.sin(Math.PI * prog(f, 2708, 2730))).toFixed(3));
    // 字卡（每一行是一個 KText；上一行先出、下一行晚半拍）
    const cap = (k, a, b) => S.caps[k].update(f, a, b, { stagger: 2.0, dur: 26, rise: 0.3, blur: 12, outDur: 14 });
    cap('home1', 1612, 1748); cap('home2', 1644, 1748);
    cap('play1', 2172, 2300); cap('play2', 2200, 2300);
    cap('day1', 2574, 2700); cap('day2', 2604, 2700);
    cap('heart1', 2742, 2862); cap('heart2', 2776, 2862);
    cap('title1', 3378, 3500); cap('title2', 3414, 3500);
    const scr = Math.max(prog(f, 1606, 1630) * (1 - prog(f, 1748, 1770)), prog(f, 2166, 2186) * (1 - prog(f, 2300, 2320)),
      prog(f, 2568, 2590) * (1 - prog(f, 2700, 2718)), prog(f, 2730, 2750) * (1 - prog(f, 2862, 2880)));
    setStyle(S.scrim, 'opacity', E.inOutSine(scr).toFixed(3));
    setStyle(S.scrimTop, 'opacity', E.inOutSine(prog(f, 3368, 3392) * (1 - prog(f, 3500, 3518))).toFixed(3));
  }

  /* ── 第五幕：30 ── */
  show(S.crestLayer, crest);
  if (crest) {
    // 影片 → 紙：第 44 小節（3520）以紙色淡入
    const dip = E.inOut(prog(f, 3506, 3528));
    setStyle(S.crestLayer, 'opacity', dip.toFixed(3));
    const M = S.crestMeta;
    // 校徽位置：先置中偏上，第 48 小節往上收，第 50 小節縮成片尾大小
    const up = E.inOutQuint(prog(f, 3884, 3926));
    const end = E.inOutQuint(prog(f, 3998, 4046));
    const Lc = LAY.crest;
    const size = lerp(lerp(Lc.main[0], Lc.up[0], up), Lc.end[0], end);
    const sc = size / 1254;
    const cy = lerp(lerp(Lc.main[1], Lc.up[1], up), Lc.end[1], end);
    const drift = 1 + 0.02 * E.inOutSine(prog(f, 3520, 4320));
    const s2 = sc * drift;
    setStyle(S.crestBox, 'transform', `translate3d(${(CX - 627 * s2).toFixed(2)}px,${(cy - 627 * s2).toFixed(2)}px,0) scale(${s2.toFixed(5)})`);
    // 各層動畫
    const lay = (k, op, tr) => { setStyle(S.crest[k], 'opacity', clamp(op).toFixed(3)); setStyle(S.crest[k], 'transform', tr || 'none'); };
    const pivot = (k, ex = 0.5, ey = 0.5) => { const m = M[k]; return [lerp(m.x0, m.x1, ex), lerp(m.y0, m.y1, ey)]; };
    const scaleAt = (k, s, ex, ey, rot = 0, dy = 0) => { const [px0, py0] = pivot(k, ex, ey); return `translate(${px0}px,${py0 + dy}px) rotate(${rot}deg) scale(${s}) translate(${-px0}px,${-py0}px)`; };
    // 月桂：由下往上長
    for (const k of ['wreathL', 'wreathR']) {
      const g = E.inOutSine(prog(f, 3528, 3604));
      const m = M[k];
      const top = lerp(m.y1, m.y0 - 10, g);
      setStyle(S.crest[k], 'clipPath', `polygon(0 ${top}px, 1254px ${top - 60}px, 1254px 1254px, 0 1254px)`);
      lay(k, g > 0 ? 1 : 0, scaleAt(k, lerp(0.94, 1, g), 0.5, 1, (k === 'wreathL' ? -6 : 6) * (1 - g)));
    }
    // 星星：三對（外→內）在第 45 小節的前三個十六分音符位置，皇冠第四個，孩子第 46 小節
    const pops = [['star1', 'star6', 3600], ['star2', 'star5', 3620], ['star3', 'star4', 3640]];
    for (const [a, b, t0] of pops) {
      for (const k of [a, b]) {
        const p = prog(f, t0, t0 + 16);
        lay(k, p > 0 ? 1 : 0, scaleAt(k, E.outBack(p, 2.6), 0.5, 0.5, (1 - E.out(p)) * (k === a ? -70 : 70)));
      }
    }
    const pc = prog(f, 3660, 3684);
    lay('crown', pc > 0 ? E.out(pc * 2) : 0, scaleAt('crown', lerp(0.7, 1, E.outBack(pc, 2.2)), 0.5, 1, 0, (1 - E.outBack(pc, 1.6)) * -60));
    const pk = prog(f, 3680, 3714);
    lay('kids', E.out(pk * 1.6), scaleAt('kids', lerp(0.86, 1, E.outBack(pk, 1.5)), 0.5, 1, 0, (1 - E.out(pk)) * 46));
    // IVY KIDS 緞帶由中間往兩側展開，30th 緞帶在第 47 小節
    const ub = E.outQuint(prog(f, 3700, 3732));
    { const m = M.banner, mid = (m.x0 + m.x1) / 2, hw = ((m.x1 - m.x0) / 2 + 20) * lerp(0.3, 1, ub); setStyle(S.crest.banner, 'clipPath', `inset(0 ${1254 - mid - hw}px 0 ${mid - hw}px)`); lay('banner', clamp(prog(f, 3700, 3708)), scaleAt('banner', lerp(0.86, 1, ub), 0.5, 0.5)); }
    const ur = E.outQuint(prog(f, 3758, 3790));
    { const m = M.ribbon, mid = (m.x0 + m.x1) / 2, hw = ((m.x1 - m.x0) / 2 + 20) * lerp(0.3, 1, ur); setStyle(S.crest.ribbon, 'clipPath', `inset(0 ${1254 - mid - hw}px 0 ${mid - hw}px)`); lay('ribbon', clamp(prog(f, 3758, 3766)), scaleAt('ribbon', lerp(0.8, 1, ur), 0.5, 0.4, 0, (1 - ur) * 26)); }
    // 金色光澤掃過 30th 緞帶
    const sh = prog(f, 3780, 3830);
    const shx = lerp(-40, 140, E.inOutSine(sh));
    setStyle(S.shine, 'opacity', (Math.sin(Math.PI * sh) * 0.9).toFixed(3));
    setStyle(S.shine, 'background', `linear-gradient(105deg, rgba(255,255,255,0) ${shx - 14}%, rgba(255,250,225,0.95) ${shx}%, rgba(255,255,255,0) ${shx + 14}%)`);
    // 星星出現時的閃光
    drawGlints(f, s2, cy);
    // 標題與年份
    S.anniTitle.update(f, 3784, 3880, { stagger: 2.2, dur: 28, outDur: 18 });
    S.anniYears.update(f, 3810, 3880, { stagger: 1.4, dur: 22, outDur: 16 });
    S.outro1.update(f, 3912, 3988, { stagger: 1.3, dur: 26, outDur: 18 });
    S.outro2.update(f, 3944, 3988, { stagger: 2.0, dur: 24, outDur: 18 });
    // 片尾：品牌字標。英文行與中文等寬、左右對齊（品牌規範）；要在圖層顯示後才量得到寬度
    if (!S.brandW) {
      const tc = document.getElementById('brandTc');
      S.brandW = tc.getBoundingClientRect().width - 0.05 * 66;
      const en = document.getElementById('brandEnText');
      const txt = en.textContent;
      const natural = en.getBoundingClientRect().width;
      // 以字距把英文撐到與中文同寬（最後一個字後面不留字距）
      en.style.letterSpacing = px((S.brandW - natural) / (txt.length - 1));
      en.style.marginRight = px(-(S.brandW - natural) / (txt.length - 1));
      document.getElementById('brandEn').style.width = px(S.brandW);
    }
    const b = E.out(prog(f, 4022, 4064));
    setStyle(S.brand, 'opacity', b.toFixed(3));
    setStyle(S.brand, 'transform', `translate3d(0,${((1 - b) * 16).toFixed(2)}px,0)`);
    setStyle(S.brand, 'filter', b < 1 ? `blur(${((1 - b) * 8).toFixed(2)}px)` : 'none');
  }

  /* 開頭黑場淡入、結尾淡出 */
  const blk = Math.max(1 - E.inOutSine(prog(f, 0, 50)), E.inOutSine(prog(f, 4250, 4316)));
  setStyle(S.black, 'opacity', blk.toFixed(3));
  await Promise.all(pending);
}

/* 星星彈出時的四角閃光 */
function drawGlints(f, s2, cy) {
  const ctx = S.glintCtx;
  ctx.clearRect(0, 0, W, H);
  const M = S.crestMeta;
  const pops = [['star1', 3600], ['star6', 3600], ['star2', 3620], ['star5', 3620], ['star3', 3640], ['star4', 3640], ['crown', 3666]];
  for (const [k, t0] of pops) {
    const p = prog(f, t0 + 4, t0 + 26);
    if (p <= 0 || p >= 1) continue;
    const m = M[k];
    const x = CX + (m.cx - 627) * s2, y = cy + (m.cy - 627) * s2;
    const a = Math.sin(Math.PI * p);
    const r = 46 * E.out(p) * (k === 'crown' ? 1.4 : 1);
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(255, 244, 205, ${0.85 * a})`;
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.quadraticCurveTo(0, 0, r, 0); ctx.quadraticCurveTo(0, 0, 0, r); ctx.quadraticCurveTo(0, 0, -r, 0); ctx.quadraticCurveTo(0, 0, 0, -r);
    ctx.fill();
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + 0.4;
      const d = 30 + 50 * E.out(p);
      ctx.fillStyle = `rgba(239, 188, 75, ${0.9 * a})`;
      ctx.beginPath(); ctx.arc(Math.cos(ang) * d, Math.sin(ang) * d, 3.2 * (1 - p) + 0.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

window.seek = async (f) => {
  if (!READY) READY = init();
  await READY;
  await render(f);
  return f;
};
window.FILM = { TOTAL, FPS, EDIT };
// 方便除錯：?f=1234 直接看那一格
const q = new URLSearchParams(location.search);
if (q.has('f')) window.seek(Number(q.get('f')));
