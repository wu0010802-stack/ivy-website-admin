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
/* 版面：橫式 16:9 與直式 9:16 各一份，時間軸（格數）完全相同 */
const LAY = VERT ? {
  FR: { x: 60, y: 820, w: 960, h: 540 },
  TL: { x0: 40, y: 1610, x1997: 92, per: 29 },
  odo: { x: 58, y: 262, size: 180 }, odoOpen: { y: 660, big: 1.3 }, rule: { x: 70, y: 480 },
  name: { x: 64, y: 512, size: 72 }, hist: { x: 66, y: 624, size: 40 },
  sprout: { x: 540, y: 1230 },
  paper: { src: 'stills/paper-v.png', w: 1188, h: 2112 },
  foot: { w: 1296, h: 2304 },
  cap: { size: 56, y1: 1400, y2: 1482, tsize: 64, ty1: 1300, ty2: 1394, scrim: 760 },
  crest: { main: [880, 830], up: [700, 790], end: [700, 820], title: 1210, years: 1340, outro1: 1108, outro2: 1306, brand: 1138 },
} : {
  FR: { x: 760, y: 136, w: 1080, h: 608 },
  TL: { x0: 70, y: 905, x1997: 170, per: 54 },
  odo: { x: 112, y: 200, size: 196 }, odoOpen: { y: 318, big: 1.34 }, rule: { x: 124, y: 430 },
  name: { x: 120, y: 470, size: 76 }, hist: { x: 122, y: 590, size: 42 },
  sprout: { x: 960, y: 842 },
  paper: { src: 'stills/paper.png', w: 2112, h: 1188 },
  foot: { w: 2304, h: 1296 },
  cap: { size: 60, y1: 812, y2: 900, tsize: 70, ty1: 760, ty2: 864, scrim: 460 },
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

/* ───────────── 年份滾輪 ───────────── */
class Odometer {
  constructor(parent, o) {
    this.o = Object.assign({ x: 0, y: 0, size: 200, color: C.green, weight: 800 }, o);
    const s = this.o;
    const m = document.createElement('canvas').getContext('2d');
    m.font = `${s.weight} ${s.size}px 'LINE Seed TW'`;
    let mw = 0;
    for (let d = 0; d < 10; d++) mw = Math.max(mw, m.measureText(String(d)).width);
    this.cw = Math.round(mw * 0.94);
    this.lh = Math.round(s.size * 1.08);
    this.root = el('div', parent, { position: 'absolute', left: px(s.x), top: px(s.y), height: px(this.lh), display: 'flex' });
    this.cols = [];
    for (let k = 0; k < 4; k++) {
      const col = el('div', this.root, {
        position: 'relative', width: px(this.cw), height: px(this.lh), overflow: 'hidden',
        maskImage: 'linear-gradient(to bottom, transparent 0%, #000 16%, #000 84%, transparent 100%)',
        webkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 16%, #000 84%, transparent 100%)',
      });
      const strip = el('div', col, { position: 'absolute', left: 0, top: 0, width: '100%' });
      for (let d = 0; d <= 10; d++) {
        const dd = el('div', strip, {
          height: px(this.lh), lineHeight: px(this.lh), textAlign: 'center', fontFamily: "'LINE Seed TW'",
          fontWeight: s.weight, fontSize: px(s.size), color: s.color,
        });
        dd.textContent = String(d % 10);
      }
      this.cols.push({ col, strip });
    }
  }
  /* v：年份（可帶小數，進位像里程表）；reveal：每一位數的出現進度 0~1 */
  set(v, reveal = [1, 1, 1, 1], alpha = 1) {
    setStyle(this.root, 'opacity', alpha.toFixed(3));
    for (let i = 0; i < 4; i++) {
      const k = 3 - i; // 第 i 欄是 10^k 位
      const p10 = Math.pow(10, k);
      const d = Math.floor(v / p10) % 10;
      const rem = v - Math.floor(v / p10) * p10; // 0 ~ p10
      const frac = k === 0 ? v - Math.floor(v) : clamp(rem - (p10 - 1));
      const pos = d + frac;
      const r = reveal[i];
      const { col, strip } = this.cols[i];
      setStyle(strip, 'transform', `translate3d(0,${(-pos * this.lh).toFixed(2)}px,0)`);
      setStyle(col, 'opacity', E.out(r).toFixed(3));
      setStyle(col, 'transform', `translate3d(0,${((1 - E.outQuint(r)) * this.lh * 0.35).toFixed(2)}px,0)`);
      setStyle(col, 'filter', r < 1 ? `blur(${((1 - r) * 12).toFixed(2)}px)` : 'none');
    }
  }
}

/* ───────────── 常春藤葉與藤蔓 ───────────── */
/* 五裂的常春藤葉，葉柄接點在 (0,0)，葉尖朝 -y；size＝葉長 */
function leafPath(ctx, size) {
  const s = size;
  const cy = -0.52 * s;
  const P = (deg, r) => { const a = (deg * Math.PI) / 180; return [Math.sin(a) * r * s, cy - Math.cos(a) * r * s]; };
  const pts = [
    P(0, 0.56), P(30, 0.27), P(62, 0.46), P(92, 0.24), P(128, 0.42), P(168, 0.13),
    [0, -0.02 * s],
    P(-168, 0.13), P(-128, 0.42), P(-92, 0.24), P(-62, 0.46), P(-30, 0.27),
  ];
  // 葉裂尖端（偶數）當控制點、凹處（奇數）當線上點 → 圓潤但有尖
  ctx.beginPath();
  const start = pts[1];
  ctx.moveTo(start[0], start[1]);
  const order = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1];
  for (let i = 0; i < order.length; i += 2) {
    const c = pts[order[i]], e = pts[order[i + 1]];
    ctx.quadraticCurveTo(c[0], c[1], e[0], e[1]);
  }
  ctx.closePath();
}
function drawLeaf(ctx, x, y, angle, size, color, grow, alpha = 1) {
  if (grow <= 0.001) return;
  const g = Math.max(0, grow);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  // 葉柄
  const pet = size * 0.32 * clamp(g * 1.6);
  ctx.strokeStyle = C.leaf;
  ctx.lineWidth = Math.max(1, size * 0.05);
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -pet); ctx.stroke();
  ctx.translate(0, -pet);
  ctx.scale(g, g);
  leafPath(ctx, size);
  ctx.fillStyle = color;
  ctx.fill();
  // 葉脈
  ctx.strokeStyle = 'rgba(206, 220, 208, 0.55)';
  ctx.lineWidth = Math.max(0.6, size * 0.028);
  const cy = -0.52 * size;
  ctx.beginPath();
  for (const deg of [0, 62, -62, 128, -128]) {
    const a = (deg * Math.PI) / 180, r = (deg === 0 ? 0.48 : 0.36) * size;
    ctx.moveTo(0, -0.04 * size);
    ctx.quadraticCurveTo(Math.sin(a) * r * 0.4, cy * 0.7, Math.sin(a) * r, cy - Math.cos(a) * r);
  }
  ctx.stroke();
  ctx.restore();
}

/* 時間軸上的藤蔓：年份 → x；藤蔓頭的位置隨 frame 走（HEAD 表），葉子在藤蔓頭經過後長出來 */
const TL = { x0: LAY.TL.x0, y: LAY.TL.y, xOf: (yr) => LAY.TL.x1997 + (yr - 1997) * LAY.TL.per };
function vineY(x) { return TL.y + 7 * Math.sin((x - TL.x0) / 140) + 4 * Math.sin((x - TL.x0) / 53 + 1.3); }
const HEAD_KEYS = [
  // [frame, x]
  [0, TL.x0], [196, TL.x0], [262, TL.xOf(1997) + 16],
  [606, TL.xOf(1997) + 16], [646, TL.xOf(2001) + 16],
  [766, TL.xOf(2001) + 16], [806, TL.xOf(2005) + 16],
  [956, TL.xOf(2005) + 16], [1096, TL.xOf(2019) + 16],
  [1100, TL.xOf(2019) + 16], [1126, TL.xOf(2020) + 16],
  [1266, TL.xOf(2020) + 16], [1292, TL.xOf(2021) + 16],
  [1452, TL.xOf(2021) + 16], [1560, TL.xOf(2027) + 26],
];
function headX(f) {
  for (let i = 1; i < HEAD_KEYS.length; i++) {
    const [f0, x0] = HEAD_KEYS[i - 1], [f1, x1] = HEAD_KEYS[i];
    if (f <= f1) {
      const t = f1 === f0 ? 1 : prog(f, f0, f1);
      // 年份滾動段（2005→2019）等速，其餘緩進緩出
      const e = f0 === 956 ? t : E.inOut(t);
      return lerp(x0, x1, e);
    }
  }
  return HEAD_KEYS[HEAD_KEYS.length - 1][1];
}
class Vine {
  constructor() {
    this.cv = canvas(W, H, null);
    this.ctx = this.cv.getContext('2d');
    const r = mulberry32(2027);
    const cols = [C.green, C.leaf, '#4D7C5D', C.green, C.leaf];
    this.leaves = [];
    let side = 1;
    for (let x = TL.x0 + 30; x < TL.xOf(2027) + 20; x += 36 + r() * 16) {
      side = -side;
      this.leaves.push({ x, side, size: 22 + r() * 12, ang: (0.5 + r() * 0.55) * side, color: cols[Math.floor(r() * cols.length)] });
    }
    // 成立年份多長兩片大葉
    for (const yr of [1997, 2001, 2005, 2020, 2021]) {
      const x = TL.xOf(yr);
      this.leaves.push({ x: x - 8, side: -1, size: 42, ang: -0.3, color: C.green, big: true });
      this.leaves.push({ x: x + 6, side: 1, size: 34, ang: 0.8, color: C.leaf, big: true });
    }
    // 每片葉子的出生格：藤蔓頭第一次越過它的那一格
    for (const lf of this.leaves) {
      lf.birth = Infinity;
      for (let f = 0; f < TOTAL; f++) if (headX(f) >= lf.x + 8) { lf.birth = f; break; }
    }
  }
  draw(f, alpha = 1) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    if (alpha <= 0) return;
    const hx = headX(f);
    if (hx <= TL.x0 + 1) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    // 莖：沿線取點，舊的部分較粗、尖端收細
    const L = [], R = [];
    const step = 4;
    for (let x = TL.x0; x <= hx; x += step) L.push(x);
    if (L[L.length - 1] < hx) L.push(hx);
    const left = [], right = [];
    for (let i = 0; i < L.length; i++) {
      const x = L[i], y = vineY(x);
      const x2 = L[Math.min(i + 1, L.length - 1)], x1 = L[Math.max(i - 1, 0)];
      const dx = x2 - x1 || 1, dy = vineY(x2) - vineY(x1);
      const len = Math.hypot(dx, dy);
      const nx = -dy / len, ny = dx / len;
      const age = hx - x;
      const w = Math.min(1.6 + 3.6 * clamp(age / 420), 0.8 + age * 0.14) * (x < TL.x0 + 20 ? lerp(0.6, 1, (x - TL.x0) / 20) : 1);
      left.push([x + nx * w, y + ny * w]);
      right.push([x - nx * w, y - ny * w]);
    }
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (const p of left) ctx.lineTo(p[0], p[1]);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fillStyle = C.leaf;
    ctx.fill();
    // 捲鬚：藤蔓頭前端一小圈
    const tip = Math.min(1, (hx - TL.x0) / 60);
    ctx.strokeStyle = C.leaf;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const ty = vineY(hx);
    ctx.moveTo(hx, ty);
    ctx.bezierCurveTo(hx + 14 * tip, ty - 2, hx + 20 * tip, ty - 17 * tip, hx + 9 * tip, ty - 19 * tip);
    ctx.stroke();
    // 葉子
    for (const lf of this.leaves) {
      if (f < lf.birth) continue;
      const g = E.outBack(prog(f, lf.birth, lf.birth + (lf.big ? 20 : 14)), 1.4);
      const y = vineY(lf.x);
      const dy = vineY(lf.x + 2) - vineY(lf.x - 2);
      const base = Math.atan2(dy, 4);
      const ang = base + (lf.side > 0 ? Math.PI / 2 : -Math.PI / 2) * 0 + lf.ang + (lf.side > 0 ? 0.25 : -0.25);
      drawLeaf(ctx, lf.x, y, ang, lf.size, lf.color, g);
    }
    ctx.restore();
  }
}

/* 開場的嫩芽（畫在自己的 canvas，之後縮小移到時間軸起點） */
function drawSprout(ctx, f, cx, cy) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const g = E.out(prog(f, 18, 96));
  if (g <= 0) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1.45, 1.45);
  const hgt = 120 * g;
  ctx.strokeStyle = C.leaf;
  ctx.lineCap = 'round';
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(4, -hgt * 0.35, -10, -hgt * 0.7, 2, -hgt);
  ctx.stroke();
  const l1 = E.outBack(prog(f, 52, 76), 1.6), l2 = E.outBack(prog(f, 70, 94), 1.6), l3 = E.outBack(prog(f, 86, 110), 1.6);
  drawLeaf(ctx, 1, -hgt * 0.42, -1.05, 30, C.leaf, l1);
  drawLeaf(ctx, -3, -hgt * 0.66, 0.95, 34, C.green, l2);
  drawLeaf(ctx, 2, -hgt, 0.08, 26, '#4D7C5D', l3);
  ctx.restore();
}

/* ───────────── 校園站：線稿 → 水彩 → 實景照 ───────────── */
const FR = LAY.FR; // 主畫框
const CAMPUS = {
  yihua: { name: '義華校', year: 1997, hist: ['第一間常春藤，', '在三民區義華路成立。'], view: [0, 60, 2820] },
  minghua: { name: '明華校', year: 2001, hist: ['走進左營區，', '有了第二所校園。'], view: [40, 0, 1611] },
  chongde: { name: '崇德校', year: 2005, hist: ['左營區的', '第二所校園。'], view: [60, 0, 1611] },
  international: { name: '國際校', year: 2020, hist: ['在鳥松區', '球場路成立。'], view: [60, 0, 1611] },
  renwu: { name: '仁武校', year: 2021, hist: ['第五所校園，', '在仁武區成立。'], view: [62, 0, 1611] },
};
const ORDER = ['yihua', 'minghua', 'chongde', 'international', 'renwu'];
/* 各站時間（全片格數） */
const ST = {
  yihua: { ink: [214, 330], col: [318, 400], photo: [392, 470], push: [214, 610], fly: [606, 640], name: [236, 600], hist: [262, 600] },
  minghua: { ink: [640, 690], col: [676, 712], photo: [700, 742], push: [640, 770], fly: [766, 800], name: [648, 762], hist: [662, 762] },
  chongde: { ink: [800, 850], col: [836, 872], photo: [860, 902], push: [800, 930], fly: [926, 960], name: [808, 922], hist: [822, 922] },
  international: { ink: [1120, 1170], col: [1156, 1192], photo: [1180, 1222], push: [1120, 1250], fly: [1246, 1280], name: [1128, 1242], hist: [1142, 1242] },
  renwu: { ink: [1280, 1330], col: [1316, 1352], photo: [1340, 1382], push: [1280, 1410], fly: [1406, 1440], name: [1288, 1402], hist: [1302, 1402] },
};
/* 時間軸上的小相片：上下交錯 */
const THUMB = { w: 128, h: 72 };
const thumbRect = (k) => {
  const i = ORDER.indexOf(k), x = TL.xOf(CAMPUS[k].year) - THUMB.w / 2;
  const up = i % 2 === 0;
  return { x: Math.max(40, x), y: up ? TL.y - 40 - THUMB.h - 36 : TL.y + 50, up };
};

/* 五校五聯屏：橫式是五格直幅並排，直式是五條橫幅上下疊 */
function panelRect(i) {
  if (VERT) return { x: 60, y: 470 + i * 254, w: 960, h: 232 };
  const PW = 318, PH = 560, GAP = 24, X0 = (W - (PW * 5 + GAP * 4)) / 2;
  return { x: X0 + i * (PW + GAP), y: 264, w: PW, h: PH };
}

class Station {
  constructor(key, assets) {
    this.key = key;
    this.c = CAMPUS[key];
    this.t = ST[key];
    const { photo, ink, colour } = assets;
    this.photo = photo; this.ink = ink; this.colour = colour;
    const [vx, vy, vw] = this.c.view;
    this.view = { x: vx, y: vy, w: vw, h: (vw * 9) / 16 };
    // 揭露圖（在畫框座標）：鉛筆由左而右帶一點雜訊；水彩由建築中心往外暈；實景由下往上、雲狀
    const nz = makeNoise(ORDER.indexOf(key) * 97 + 11);
    const w = FR.w, h = FR.h;
    this.mInk = new Float32Array(w * h);
    this.mCol = new Float32Array(w * h);
    this.mPho = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const n1 = nz(x / 90, y / 90, 4), n2 = nz(x / 220 + 13, y / 220 + 7, 4);
        this.mInk[i] = clamp(0.78 * (x / w * 0.86 + y / h * 0.14) + 0.22 * n1);
        const d = Math.hypot((x - w * 0.55) / w, (y - h * 0.5) / h * 0.8);
        this.mCol[i] = clamp(0.55 * d / 0.65 + 0.45 * n2);
        this.mPho[i] = clamp(0.4 * (1 - y / h) + 0.6 * n2);
      }
    }
    this.layer = document.createElement('canvas');
    this.layer.width = w; this.layer.height = h;
    this.lctx = this.layer.getContext('2d');
    this.mask = document.createElement('canvas');
    this.mask.width = w; this.mask.height = h;
    this.mctx = this.mask.getContext('2d');
    this.mdata = this.mctx.createImageData(w, h);
  }
  /* 依揭露圖與進度 p 產生遮罩（soft＝邊緣寬） */
  buildMask(map, p, soft) {
    const d = this.mdata.data, n = map.length;
    const pp = p * (1 + soft);
    for (let i = 0, j = 3; i < n; i++, j += 4) {
      const a = (pp - map[i]) / soft;
      d[j] = a <= 0 ? 0 : a >= 1 ? 255 : (a * a * (3 - 2 * a)) * 255;
    }
    this.mctx.putImageData(this.mdata, 0, 0);
  }
  drawLayer(img, zoom, mapArr, p, soft, mode, ctx, alpha = 1) {
    if (p <= 0) return;
    const l = this.lctx;
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, FR.w, FR.h);
    const v = this.view, s = (FR.w / v.w) * zoom;
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    l.setTransform(s, 0, 0, s, FR.w / 2 - cx * s, FR.h / 2 - cy * s);
    l.imageSmoothingQuality = 'high';
    l.drawImage(img, 0, 0);
    l.setTransform(1, 0, 0, 1, 0, 0);
    if (p < 1) {
      this.buildMask(mapArr, p, soft);
      l.globalCompositeOperation = 'destination-in';
      l.drawImage(this.mask, 0, 0);
      l.globalCompositeOperation = 'source-over';
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = mode;
    ctx.drawImage(this.layer, 0, 0);
    ctx.restore();
  }
  /* 把這一站在 frame f 的樣子畫進 ctx（畫框大小，含紙底） */
  render(ctx, f, paperImg) {
    const t = this.t;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(paperImg, FR.x + PAD.x, FR.y + PAD.y, FR.w, FR.h, 0, 0, FR.w, FR.h);
    const zoom = lerp(1.0, 1.055, E.inOutSine(prog(f, t.push[0], t.push[1] + 40)));
    const pInk = E.inOutSine(prog(f, t.ink[0], t.ink[1]));
    const pCol = E.inOutSine(prog(f, t.col[0], t.col[1]));
    const pPho = E.inOutSine(prog(f, t.photo[0], t.photo[1]));
    // 實景完全出現後，線稿與水彩不必再畫
    if (pPho < 1) {
      this.drawLayer(this.colour, zoom, this.mCol, pCol, 0.35, 'multiply', ctx, 0.92);
      this.drawLayer(this.ink, zoom, this.mInk, pInk, 0.07, 'source-over', ctx, lerp(0.9, 0.55, pCol));
    }
    this.drawLayer(this.photo, zoom, this.mPho, pPho, 0.32, 'source-over', ctx, 1);
    return pPho;
  }
}

/* ───────────── 時間軸刻度 ───────────── */
function drawTicks(ctx, f, alpha) {
  ctx.clearRect(0, 0, W, H);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const hx = headX(f);
  for (let yr = 1997; yr <= 2027; yr++) {
    const x = TL.xOf(yr);
    const on = hx >= x - 2;
    const ms = [1997, 2001, 2005, 2020, 2021, 2027].includes(yr);
    ctx.fillStyle = on ? (ms ? C.leaf : 'rgba(56,106,75,0.55)') : 'rgba(56,106,75,0.2)';
    const hh = ms ? 14 : 8;
    ctx.fillRect(Math.round(x) - 1, TL.y + 26, 2, hh);
  }
  ctx.restore();
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
  const assets = {};
  await Promise.all(ORDER.map(async (k) => {
    const [photo, ink, colour] = await Promise.all(['photo', 'ink', 'colour'].map((n) => loadImg(`${OUT}stills/${k}-${n}.png`)));
    assets[k] = { photo, ink, colour };
  }));

  /* 背景：紙（整片跟著鏡頭微動） */
  S.cam = el('div', stage, { position: 'absolute', inset: 0, transformOrigin: '50% 60%' });
  S.paperEl = el('img', S.cam, { position: 'absolute', left: px(-PAD.x), top: px(-PAD.y), width: px(LAY.paper.w), height: px(LAY.paper.h) });
  S.paperEl.src = paper.src;

  /* 第一、二幕：校園站 */
  S.stationLayer = el('div', S.cam, { position: 'absolute', inset: 0 });
  S.ticks = canvas(W, H, S.stationLayer);
  S.ticksCtx = S.ticks.getContext('2d');
  S.vine = new Vine();
  S.stationLayer.appendChild(S.vine.cv);
  S.sprout = canvas(400, 400, S.stationLayer);  // 嫩芽畫在 (200,330) 往上長
  S.sproutCtx = S.sprout.getContext('2d');
  S.labels = {};
  S.thumbs = {};
  for (const k of ORDER) {
    const tr = thumbRect(k);
    const th = canvas(THUMB.w * 2, THUMB.h * 2, S.stationLayer, {
      left: px(tr.x), top: px(tr.y), width: px(THUMB.w), height: px(THUMB.h), borderRadius: '3px',
      boxShadow: `0 4px 14px rgba(${INK},0.18), 0 1px 3px rgba(${INK},0.2)`, display: 'none',
    });
    S.thumbs[k] = th;
    const lab = el('div', S.stationLayer, {
      position: 'absolute', left: px(tr.x), top: px(tr.up ? tr.y - 30 : tr.y + THUMB.h + 6), width: px(THUMB.w + 60),
      fontFamily: "'LINE Seed TW'", fontWeight: 700, fontSize: '19px', color: C.green, whiteSpace: 'nowrap', display: 'none',
    });
    lab.innerHTML = `<span style="font-family:'Source Sans 3';font-weight:600;color:${C.muted};letter-spacing:.04em;margin-right:8px">${CAMPUS[k].year}</span>${CAMPUS[k].name.replace('校', '')}`;
    S.labels[k] = lab;
  }
  S.stations = {};
  for (const k of ORDER) S.stations[k] = new Station(k, assets[k]);
  S.print = canvas(FR.w, FR.h, S.stationLayer, { left: px(FR.x), top: px(FR.y), transformOrigin: '0 0', borderRadius: '4px' });
  S.printCtx = S.print.getContext('2d');
  // 年份與文字（左欄）
  S.odo = new Odometer(S.stationLayer, { x: LAY.odo.x, y: LAY.odo.y, size: LAY.odo.size });
  S.rule = el('div', S.stationLayer, { position: 'absolute', left: px(LAY.rule.x), top: px(LAY.rule.y), width: '72px', height: '5px', background: C.gold, borderRadius: '3px', transformOrigin: '0 50%' });
  S.names = {}; S.hists = {};
  for (const k of ORDER) {
    S.names[k] = new KText(S.stationLayer, [CAMPUS[k].name], { x: LAY.name.x, y: LAY.name.y, size: LAY.name.size, weight: 800, color: C.green, ls: 0.06 });
    S.hists[k] = new KText(S.stationLayer, CAMPUS[k].hist, { x: LAY.hist.x, y: LAY.hist.y, size: LAY.hist.size, weight: 700, color: C.text, ls: 0.05, lh: 1.5 });
  }
  S.years = new KText(S.stationLayer, ['一年，', '又一年。'], { x: LAY.name.x, y: LAY.name.y, size: LAY.name.size, weight: 800, color: C.green, ls: 0.06, lh: 1.3 });
  // 開場置中的 1997（之後滑到左欄）由 Odometer 自己移動

  /* 年份滾動段：日常照片翻頁 */
  const FLIP = ['cur-hero', 'day-hello', 'cur-kite', 'env-hero-hug', 'day-lunch', 'cur-floor-painting', 'about-curious',
    'day-outside', 'cur-activities', 'env-care-meal', 'cur-integrated', 'home-about', 'cur-daily-reading', 'cur-years'];
  S.flip = await Promise.all(FLIP.map((n) => loadImg(`${WEB}${n}.webp`)));

  /* 五校五聯屏 */
  S.panelLayer = el('div', stage, { position: 'absolute', inset: 0, display: 'none' });
  S.panelTitle = new KText(S.panelLayer, VERT ? ['從一間幼兒園，', '長成五所校園。'] : ['從一間幼兒園，長成五所校園。'], { x: CX, y: VERT ? 200 : 128, size: VERT ? 70 : 66, weight: 800, color: C.green, align: 'center', w: 1800, ls: 0.06, lh: 1.35 });
  S.panels = ORDER.map((k, i) => {
    const p = el('div', S.panelLayer, {
      position: 'absolute', overflow: 'hidden', borderRadius: '6px',
      backgroundImage: `url(${OUT}stills/${k}-photo.png)`, backgroundSize: 'cover',
      boxShadow: `0 18px 40px rgba(${INK},0.16), 0 2px 6px rgba(${INK},0.18)`,
    });
    const cap = el('div', S.panelLayer, VERT ? {
      position: 'absolute', fontFamily: "'LINE Seed TW'", fontWeight: 800, fontSize: '44px', color: '#fff', zIndex: 3,
      letterSpacing: '.08em', whiteSpace: 'nowrap', textShadow: `0 2px 14px rgba(${INK},0.6), 0 1px 2px rgba(${INK},0.5)`,
    } : {
      position: 'absolute', fontFamily: "'LINE Seed TW'", fontWeight: 800, fontSize: '40px', color: C.green,
      textAlign: 'center', width: '318px', letterSpacing: '.08em', whiteSpace: 'nowrap',
    });
    cap.innerHTML = VERT
      ? `${CAMPUS[k].name.replace('校', '')}<span style="font-family:'Source Sans 3';font-weight:600;font-size:26px;letter-spacing:.14em;margin-left:16px">${CAMPUS[k].year}</span>`
      : `${CAMPUS[k].name.replace('校', '')}<span style="display:block;font-family:'Source Sans 3';font-weight:600;font-size:22px;letter-spacing:.14em;color:${C.muted};margin-top:2px">${CAMPUS[k].year}</span>`;
    return { k, p, cap };
  });

  /* 第三、四幕：影片 */
  S.footLayer = el('div', stage, { position: 'absolute', inset: 0, display: 'none', background: '#000', overflow: 'hidden' });
  S.footA = el('img', S.footLayer, { position: 'absolute', left: 0, top: 0, width: px(LAY.foot.w), height: px(LAY.foot.h), transformOrigin: '0 0' });
  S.footB = el('img', S.footLayer, { position: 'absolute', left: 0, top: 0, width: px(LAY.foot.w), height: px(LAY.foot.h), transformOrigin: '0 0', display: 'none' });
  S.scrim = el('div', S.footLayer, { position: 'absolute', left: 0, right: 0, bottom: 0, height: px(LAY.cap.scrim), background: `linear-gradient(to top, rgba(${INK},0.62), rgba(${INK},0.30) 45%, rgba(${INK},0))`, opacity: 0 });
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

  /* 全片：黑場 */
  S.black = el('div', stage, { position: 'absolute', inset: 0, background: '#000', opacity: 0 });

  await document.fonts.ready;

  // 時間軸小相片：直接用每一站起飛那一格的樣子先畫好（平行算圖時每個 worker 從不同格開始）
  const tmp = document.createElement('canvas');
  tmp.width = FR.w; tmp.height = FR.h;
  const tctx = tmp.getContext('2d');
  for (const k of ORDER) {
    S.stations[k].render(tctx, ST[k].fly[0], S.paper);
    const th = S.thumbs[k], c2 = th.getContext('2d');
    c2.imageSmoothingQuality = 'high';
    c2.drawImage(tmp, 0, 0, th.width, th.height);
  }
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
  const actI_II = f < 1612;
  const footage = f >= 1585 && f < 3540;
  const crest = f >= 3510;

  /* ── 第一、二幕 ── */
  show(S.cam, actI_II);
  if (actI_II) {
    const camS = 1 + 0.018 * E.inOutSine(prog(f, 0, 1600));
    setStyle(S.cam, 'transform', `scale(${camS.toFixed(5)})`);
    const panelPhase = f >= 1440;
    // 開場嫩芽：先在畫面中央，再縮小移到時間軸起點，交給藤蔓
    if (f < 270) {
      show(S.sprout, true);
      drawSprout(S.sproutCtx, f, 200, 330);
      const m = E.inOutQuint(prog(f, 176, 250));
      const sx = lerp(LAY.sprout.x - 200, TL.x0 - 200 + 4, m), sy = lerp(LAY.sprout.y - 330, TL.y - 330, m), sc = lerp(1, 0.42, m);
      setStyle(S.sprout, 'transform', `translate3d(${sx}px,${sy}px,0) scale(${sc})`);
      setStyle(S.sprout, 'transformOrigin', '200px 330px');
      setStyle(S.sprout, 'opacity', (1 - prog(f, 236, 262)).toFixed(3));
    } else show(S.sprout, false);

    // 藤蔓與刻度
    const tlAlpha = prog(f, 176, 230) * (1 - E.inOut(prog(f, 1446, 1480)));
    S.vine.draw(f, tlAlpha);
    drawTicks(S.ticksCtx, f, tlAlpha);

    // 年份：開場在中央 → 滑到左欄；之後依站滾動
    let yr = 1997;
    const rollTo = (f0, f1, a, b) => lerp(a, b, E.inOutQuint(prog(f, f0, f1)));
    if (f >= 606) yr = rollTo(606, 640, 1997, 2001);
    if (f >= 766) yr = rollTo(766, 800, 2001, 2005);
    if (f >= 950) {
      // 2005 → 2019：每個八分音符跳一年（第 12 小節起）
      const k = Math.floor((f - 960) / 10) + 1; // 第 k 次跳
      const within = ((f - 960) % 10 + 10) % 10;
      const base = 2005 + clamp(k - 1, 0, 14);
      yr = f < 960 ? 2005 : Math.min(2019, base + (k <= 14 ? E.outQuint(clamp(within / 6)) : 0));
    }
    if (f >= 1100) yr = rollTo(1100, 1120, 2019, 2020);
    if (f >= 1262) yr = rollTo(1262, 1280, 2020, 2021);
    const rv = [0, 1, 2, 3].map((i) => prog(f, 84 + i * 7, 84 + i * 7 + 26));
    const odoIn = f < 176;
    const mv = E.inOutQuint(prog(f, 170, 236));
    const big = LAY.odoOpen.big;
    const ox = lerp(CX - (S.odo.cw * 4 * big) / 2, LAY.odo.x, mv), oy = lerp(LAY.odoOpen.y, LAY.odo.y, mv), osc = lerp(big, 1, mv);
    setStyle(S.odo.root, 'transform', `translate3d(${(ox - LAY.odo.x).toFixed(2)}px,${(oy - LAY.odo.y).toFixed(2)}px,0) scale(${osc.toFixed(4)})`);
    setStyle(S.odo.root, 'transformOrigin', '0 0');
    const odoOut = E.inOut(prog(f, 1440, 1466));
    S.odo.set(yr, odoIn ? rv : [1, 1, 1, 1], 1 - odoOut);
    const ruleP = E.outQuint(prog(f, 226, 262)) * (1 - odoOut);
    setStyle(S.rule, 'transform', `scaleX(${ruleP.toFixed(3)})`);

    // 校名、沿革
    for (const k of ORDER) {
      const t = ST[k];
      S.names[k].update(f, t.name[0], t.name[1]);
      S.hists[k].update(f, t.hist[0], t.hist[1], { stagger: 1.1 });
    }
    S.years.update(f, 966, 1112, { stagger: 2.2 });

    // 主畫框
    let shown = null;
    for (const k of ORDER) { const t = ST[k]; if (f >= t.ink[0] && f < t.fly[1]) shown = k; }
    const flipOn = f >= 960 && f < 1124;
    if (shown || flipOn) {
      show(S.print, true);
      const ctx = S.printCtx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      let shadowA = 0;
      if (shown) {
        const st = S.stations[shown];
        const pPho = st.render(ctx, f, S.paper);
        shadowA = pPho;
        // 飛向時間軸上的小相片
        const t = ST[shown];
        const fl = E.inOutQuint(prog(f, t.fly[0], t.fly[1]));
        const tr = thumbRect(shown);
        const sc = lerp(1, THUMB.w / FR.w, fl);
        const tx = lerp(FR.x, tr.x, fl) - FR.x, ty = lerp(FR.y, tr.y, fl) - FR.y;
        const rot = Math.sin(fl * Math.PI) * -3;
        setStyle(S.print, 'transform', `translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,0) rotate(${rot.toFixed(3)}deg) scale(${sc.toFixed(5)})`);
      } else {
        // 翻頁：每個八分音符一張日常照片疊上來
        ctx.drawImage(S.paper, FR.x + PAD.x, FR.y + PAD.y, FR.w, FR.h, 0, 0, FR.w, FR.h);
        const n = clamp(Math.floor((f - 960) / 10) + 1, 0, S.flip.length);
        for (let i = Math.max(0, n - 3); i < n; i++) {
          const im = S.flip[i];
          const t0 = 960 + i * 10;
          const p = E.outQuint(prog(f, t0, t0 + 8));
          const s = Math.max(FR.w / im.width, FR.h / im.height) * lerp(1.12, 1.0, p);
          const dx = lerp(70, 0, p), rot = lerp(2.2, 0, p) * (i % 2 ? -1 : 1);
          ctx.save();
          ctx.globalAlpha = clamp(p * 1.6);
          ctx.translate(FR.w / 2 + dx, FR.h / 2);
          ctx.rotate((rot * Math.PI) / 180);
          ctx.drawImage(im, -im.width * s / 2, -im.height * s / 2, im.width * s, im.height * s);
          ctx.restore();
        }
        const fade = E.inOut(prog(f, 1100, 1122));
        if (fade > 0) {
          ctx.globalAlpha = fade;
          ctx.drawImage(S.paper, FR.x + PAD.x, FR.y + PAD.y, FR.w, FR.h, 0, 0, FR.w, FR.h);
          ctx.globalAlpha = 1;
        }
        shadowA = n > 0 ? 1 - fade : 0;
        setStyle(S.print, 'transform', 'none');
      }
      setStyle(S.print, 'boxShadow', `0 ${Math.round(26 * shadowA)}px ${Math.round(60 * shadowA)}px rgba(${INK},${(0.20 * shadowA).toFixed(3)}), 0 2px 6px rgba(${INK},${(0.16 * shadowA).toFixed(3)})`);
    } else show(S.print, false);

    // 時間軸上的小相片與標籤
    for (const k of ORDER) {
      const t = ST[k];
      const on = f >= t.fly[1] - 1 && !panelPhase;
      show(S.thumbs[k], on);
      show(S.labels[k], f >= t.fly[1] - 4 && !panelPhase);
      setStyle(S.labels[k], 'opacity', prog(f, t.fly[1] - 4, t.fly[1] + 10).toFixed(3));
    }
  }

  /* ── 五校五聯屏（第 18–19 小節）── */
  const panelsOn = f >= 1440 && f < 1612;
  show(S.panelLayer, panelsOn);
  if (panelsOn) {
    S.panelTitle.update(f, 1466, 1560, { stagger: 1.4 });
    const exp = E.inOutQuint(prog(f, 1584, 1608));
    S.panels.forEach(({ k, p, cap }, i) => {
      const tr = thumbRect(k);
      const R = panelRect(i);
      const m = E.inOutQuint(prog(f, 1440 + i * 5, 1478 + i * 5));
      let x = lerp(tr.x, R.x, m), y = lerp(tr.y, R.y, m), w = lerp(THUMB.w, R.w, m), h = lerp(THUMB.h, R.h, m);
      let op = 1;
      if (k === 'minghua') {
        // 明華這一格放大成全畫面，接進明華的影片
        x = lerp(x, 0, exp); y = lerp(y, 0, exp); w = lerp(w, W, exp); h = lerp(h, H, exp);
        op = 1 - E.inOut(prog(f, 1598, 1606));
      } else {
        // 其他四格留到明華那一格放大蓋過去才淡掉，畫面不會空
        const out = E.inOut(prog(f, 1594, 1608));
        op = 1 - out;
      }
      const foc = { yihua: 62, minghua: 42, chongde: 70, international: 40, renwu: 50 }[k];
      Object.assign(p.style, { left: px(x), top: px(y), width: px(w), height: px(h), opacity: op.toFixed(3), backgroundPosition: VERT ? '50% 62%' : `${foc}% 50%`, borderRadius: px(lerp(6, 0, exp)) });
      p.style.zIndex = k === 'minghua' ? 2 : 1;
      const cIn = E.out(prog(f, 1486 + i * 4, 1510 + i * 4)) * (1 - E.inOut(prog(f, 1556, 1580)));
      if (VERT) Object.assign(cap.style, { left: px(R.x + 28 + (1 - cIn) * 14), top: px(R.y + R.h - 72), opacity: cIn.toFixed(3) });
      else Object.assign(cap.style, { left: px(R.x), top: px(R.y + R.h + 22 + (1 - cIn) * 14), opacity: cIn.toFixed(3) });
    });
  }

  /* ── 第三、四幕：影片 ── */
  show(S.footLayer, footage);
  if (footage) {
    // 從明華那一格長出來：影片先被裁在那一格裡
    const exp = E.inOutQuint(prog(f, 1584, 1608));
    if (f < 1612) {
      const R = panelRect(1);
      const x = lerp(R.x, 0, exp), y = lerp(R.y, 0, exp), w = lerp(R.w, W, exp), h = lerp(R.h, H, exp);
      setStyle(S.footLayer, 'clipPath', `inset(${y.toFixed(1)}px ${(W - x - w).toFixed(1)}px ${(H - y - h).toFixed(1)}px ${x.toFixed(1)}px round ${lerp(6, 0, exp).toFixed(1)}px)`);
      setStyle(S.footLayer, 'zIndex', '3');
      setStyle(S.footLayer, 'opacity', E.inOutSine(prog(f, 1585, 1598)).toFixed(3)); // 明華校舍照 → 明華的影片
    } else {
      setStyle(S.footLayer, 'clipPath', 'none');
      setStyle(S.footLayer, 'zIndex', '');
      setStyle(S.footLayer, 'opacity', '1');
    }
    // 1585–1600 先用第一個鏡頭的第一格；3520 之後（淡入紙色的那幾格）停在最後一個鏡頭的最後一格。
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
      prog(f, 2568, 2590) * (1 - prog(f, 2700, 2718)), prog(f, 2730, 2750) * (1 - prog(f, 2862, 2880)), prog(f, 3368, 3392));
    setStyle(S.scrim, 'opacity', E.inOutSine(scr).toFixed(3));
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
