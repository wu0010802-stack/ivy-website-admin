/* 第一、二幕〈星圖〉（第 0–1600 格）。
 *
 * 1997 年，深綠夜空裡一點光聚起來，在第 4 小節點亮成第一顆星（義華）；星光往水平拉成一道光，
 * 再上下張開成一扇寬銀幕光窗，裡面是義華校的實景。之後每一顆星在成立那一年的重拍點亮，
 * 金色星座線從上一顆星牽過來；2006–2019 是長曝光的星軌，日常照片像記憶一樣在星空裡亮一下；
 * 第 18 小節五顆星連成星座——星星的相對位置就是五校在高雄的真實位置（取自門牌座標）。
 * 最後鏡頭衝進明華那顆星，白光接進明華的影片。
 *
 * 全部由 frame 決定。共用 film.js 的 clamp／lerp／prog／E／mulberry32／el／KText 等工具（film.js 載入後才會呼叫）。
 */
'use strict';

/* 五校：官網沿革文字（web/app/utils/anniversary/timeline.ts）＋門牌投影座標（map-data.ts 的 campuses） */
const SKY_CAMPUS = {
  yihua: { name: '義華校', year: 1997, hist: ['第一間常春藤，', '在三民區義華路成立。'], map: [711.1, 730], ign: 320, close: [558, 586], crop: [1550, 760, 2500] },
  minghua: { name: '明華校', year: 2001, hist: ['走進左營區，', '有了第二所校園。'], map: [264.7, 462.2], ign: 640, close: [738, 764], crop: [868, 470, 1700] },
  chongde: { name: '崇德校', year: 2005, hist: ['左營區的', '第二所校園。'], map: [275.4, 327.1], ign: 800, close: [904, 932], crop: [868, 480, 1700] },
  international: { name: '國際校', year: 2020, hist: ['在鳥松區', '球場路成立。'], map: [622.4, 555], ign: 1120, close: [1226, 1254], crop: [868, 470, 1700] },
  renwu: { name: '仁武校', year: 2021, hist: ['第五所校園，', '在仁武區成立。'], map: [701.9, 209.9], ign: 1280, close: [1386, 1414], crop: [868, 500, 1700] },
};
const SKY_ORDER = ['yihua', 'minghua', 'chongde', 'international', 'renwu'];
for (const k of SKY_ORDER) {
  const c = SKY_CAMPUS[k];
  c.p = [(c.map[0] - 488) * 2.2, (c.map[1] - 470) * 2.2]; // 星空平面座標（北在上，與地圖相同）
}
const SKY_CENTROID = (() => {
  let x = 0, y = 0;
  for (const k of SKY_ORDER) { x += SKY_CAMPUS[k].p[0]; y += SKY_CAMPUS[k].p[1]; }
  return [x / 5, y / 5];
})();
const SKY_DAILY = ['cur-hero', 'day-hello', 'cur-kite', 'env-hero-hug', 'day-lunch', 'cur-floor-painting', 'about-curious',
  'day-outside', 'cur-activities', 'env-care-meal', 'cur-integrated', 'home-about', 'cur-daily-reading', 'cur-years'];

/* 星光的顏色 */
const SKY_COL = {
  core: [255, 248, 230], gold: [239, 188, 75], warm: [255, 222, 160], mint: [190, 230, 210], cream: '#F4EBD3',
};
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function skyLayout() {
  const V = typeof VERT !== 'undefined' && VERT;
  return V ? {
    A: [540, 1190], Zs: 1.32, Zt: 0.84, Zc: 0.58, Ac: [540, 1180], Acc: [577, 1060], win: [940, 395],
    year: { x: 78, y: 300, size: 196 }, name: { x: 84, y: 560, size: 58 }, hist: { x: 86, y: 652, size: 34 },
    title: { x: 540, y: 250, size: 66, align: 'center' }, orbR: 360, orbD: 146, labelSize: 36,
  } : {
    A: [1316, 540], Zs: 1.45, Zt: 0.8, Zc: 0.64, Ac: [1260, 556], Acc: [1260, 556], win: [1060, 446],
    year: { x: 138, y: 250, size: 236 }, name: { x: 146, y: 548, size: 62 }, hist: { x: 148, y: 648, size: 38 },
    title: { x: 146, y: 404, size: 66, align: 'left' }, orbR: 400, orbD: 150, labelSize: 36,
  };
}

/* ───────── 攝影機：T（對準的星空座標）、A（T 在畫面上的位置）、Z（縮放）、R（旋轉，繞 A） ───────── */
function skyCamera(f) {
  const L = skyLayout();
  const st = (k, z) => ({ T: SKY_CAMPUS[k].p, A: L.A, Z: z, R: 0 });
  const whole = (z, R = 0, A = L.Ac) => ({ T: SKY_CENTROID, A, Z: z, R }); // Ac：星軌全景；Acc：第 18 小節星座（直式要留兩側標籤的寬度）
  const mix = (a, b, t, dip = 0.3) => {
    const e = E.inOut(t);
    return {
      T: [lerp(a.T[0], b.T[0], e), lerp(a.T[1], b.T[1], e)], A: [lerp(a.A[0], b.A[0], e), lerp(a.A[1], b.A[1], e)],
      Z: Math.exp(lerp(Math.log(a.Z), Math.log(b.Z), e)) * (1 - dip * Math.sin(Math.PI * t)), R: lerp(a.R, b.R, e),
    };
  };
  const push = (k, f0, f1, z0, z1) => st(k, lerp(z0, z1, E.inOutSine(prog(f, f0, f1))));
  const Zs = L.Zs;
  const tlR = (ff) => 0.75 * E.inOutSine(prog(ff, 962, 1092)); // 星軌時天空轉 43°
  if (f < 588) return push('yihua', 0, 600, Zs * 0.86, Zs * 1.06);
  if (f < 640) return mix(push('yihua', 0, 600, Zs * 0.86, Zs * 1.06), st('minghua', Zs), prog(f, 588, 640));
  if (f < 762) return push('minghua', 640, 780, Zs, Zs * 1.05);
  if (f < 800) return mix(push('minghua', 640, 780, Zs, Zs * 1.05), st('chongde', Zs), prog(f, 762, 800));
  if (f < 930) return push('chongde', 800, 950, Zs, Zs * 1.05);
  if (f < 962) return mix(push('chongde', 800, 950, Zs, Zs * 1.05), whole(L.Zt), prog(f, 930, 962), 0.1);
  if (f < 1092) return whole(L.Zt * lerp(1, 1.04, prog(f, 962, 1092)), tlR(f));
  if (f < 1122) return mix(whole(L.Zt * 1.04, tlR(1092)), st('international', Zs), prog(f, 1092, 1122));
  if (f < 1252) return push('international', 1122, 1270, Zs, Zs * 1.05);
  if (f < 1282) return mix(push('international', 1122, 1270, Zs, Zs * 1.05), st('renwu', Zs), prog(f, 1252, 1282));
  if (f < 1412) return push('renwu', 1282, 1430, Zs, Zs * 1.05);
  if (f < 1446) return mix(push('renwu', 1282, 1430, Zs, Zs * 1.05), whole(L.Zc, 0, L.Acc), prog(f, 1412, 1446), 0.05);
  if (f < 1556) return whole(L.Zc * lerp(1, 1.06, E.inOutSine(prog(f, 1446, 1556))), 0, L.Acc);
  // 衝進明華那顆星
  const t = prog(f, 1556, 1601);
  const e = E.in(t);
  const from = whole(L.Zc * 1.06, 0, L.Acc);
  const mp = SKY_CAMPUS.minghua.p;
  return {
    T: [lerp(from.T[0], mp[0], E.out(t)), lerp(from.T[1], mp[1], E.out(t))],
    A: [lerp(from.A[0], W / 2, E.inOut(t)), lerp(from.A[1], H / 2, E.inOut(t))],
    Z: from.Z * Math.pow(60 / from.Z, e), R: 0,
  };
}
/* k：視差（1＝星座所在平面，越小越遠） */
function skyProject(p, cam, k = 1) {
  const z = Math.pow(cam.Z, k);
  const dx = (p[0] - cam.T[0] * k) * z, dy = (p[1] - cam.T[1] * k) * z;
  const c = Math.cos(cam.R), s = Math.sin(cam.R);
  return [cam.A[0] + c * dx - s * dy, cam.A[1] + s * dx + c * dy, z];
}

/* ───────── 預先做好的光點貼圖 ───────── */
function skySprite(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

class Sky {
  constructor(parent, imgs) {
    this.L = skyLayout();
    this.root = el('div', parent, { position: 'absolute', inset: 0, background: '#050C09', overflow: 'hidden' });
    this.cv = canvas(W, H, this.root);
    this.ctx = this.cv.getContext('2d');
    this.far = imgs.far; this.near = imgs.near; this.photos = imgs.photos; this.daily = imgs.daily;
    this.glow = skySprite(256, [[0, 'rgba(255,250,236,1)'], [0.12, 'rgba(255,232,180,0.85)'], [0.35, 'rgba(239,188,75,0.28)'], [0.7, 'rgba(239,188,75,0.06)'], [1, 'rgba(239,188,75,0)']]);
    this.soft = skySprite(64, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
    this.mintGlow = skySprite(128, [[0, 'rgba(190,230,210,0.5)'], [0.5, 'rgba(120,190,160,0.12)'], [1, 'rgba(120,190,160,0)']]);
    // 背景星：位置、視差、亮度、色溫、閃爍
    const r = mulberry32(1997);
    this.stars = [];
    for (let i = 0; i < 2600; i++) {
      const k = 0.12 + Math.pow(r(), 1.6) * 0.95;
      const span = 1900 / Math.pow(0.6, k) + 600;
      const b = Math.pow(r(), 3.2);
      const tint = r();
      this.stars.push({
        p: [(r() - 0.5) * 2 * span, (r() - 0.5) * 2 * span], k, b,
        rad: 0.5 + b * 1.9, col: tint < 0.62 ? [255, 246, 228] : tint < 0.86 ? [255, 222, 160] : [196, 236, 218],
        ph: r() * 6.283, sp: 0.03 + r() * 0.08,
      });
    }
    // 少量前景星（比星座平面近，移動時視差大）
    for (let i = 0; i < 40; i++) this.stars.push({ p: [(r() - 0.5) * 3000, (r() - 0.5) * 3000], k: 1.15 + r() * 0.3, b: 0.4 + r() * 0.5, rad: 1.6 + r() * 1.4, col: [255, 236, 200], ph: r() * 6.283, sp: 0.02 });
    // 每顆校園星點亮時的火花
    this.sparks = {};
    for (const key of SKY_ORDER) {
      const rr = mulberry32(SKY_CAMPUS[key].year);
      this.sparks[key] = Array.from({ length: 90 }, () => ({ a: rr() * 6.283, v: 2 + rr() * 9, life: 26 + rr() * 50, s: 0.6 + rr() * 1.8, gold: rr() < 0.6 }));
    }
    // 開場往中心聚的光點
    const rg = mulberry32(30);
    this.gather = Array.from({ length: 120 }, () => ({ a: rg() * 6.283, d: 160 + rg() * 520, t0: 20 + rg() * 220, dur: 70 + rg() * 90, s: 0.5 + rg() * 1.2 }));
    // 光窗的離屏畫布
    this.win = document.createElement('canvas');
    this.win.width = this.L.win[0] + 4; this.win.height = this.L.win[1] + 4;
    this.wctx = this.win.getContext('2d');
    this.orb = document.createElement('canvas');
    this.orb.width = this.orb.height = this.L.orbD + 4;
    this.octx = this.orb.getContext('2d');

    // 文字：年份（細體、會交叉淡換）、校名、沿革
    const L = this.L;
    this.yearEls = [0, 1].map(() => el('div', this.root, {
      position: 'absolute', left: px(L.year.x), top: px(L.year.y), fontFamily: "'LINE Seed TW'", fontWeight: 100,
      fontSize: px(L.year.size), lineHeight: '1', letterSpacing: '.05em', color: SKY_COL.cream, whiteSpace: 'nowrap',
      textShadow: '0 0 28px rgba(239,188,75,0.38), 0 0 2px rgba(255,240,210,0.5)', opacity: 0,
    }));
    const nameStyle = { size: L.name.size, weight: 700, color: '#FFF6E2', ls: 0.08, x: L.name.x, y: L.name.y, shadow: '0 0 22px rgba(239,188,75,0.25)' };
    const histStyle = { size: L.hist.size, weight: 400, color: '#CFE3D6', ls: 0.06, lh: 1.55, x: L.hist.x, y: L.hist.y };
    this.names = {}; this.hists = {};
    for (const k of SKY_ORDER) {
      this.names[k] = new KText(this.root, [SKY_CAMPUS[k].name], nameStyle);
      this.hists[k] = new KText(this.root, SKY_CAMPUS[k].hist, histStyle);
    }
    this.years = new KText(this.root, ['一年，又一年。'], { ...nameStyle });
    this.title = new KText(this.root, ['從一間幼兒園，', '長成五所校園。'], {
      size: L.title.size, weight: 700, color: '#FFF6E2', ls: 0.08, lh: 1.4, x: L.title.x, y: L.title.y, align: L.title.align, w: 1000,
      shadow: '0 0 26px rgba(239,188,75,0.25)',
    });
    this.labels = {};
    for (const k of SKY_ORDER) {
      const d = el('div', this.root, {
        position: 'absolute', left: 0, top: 0, whiteSpace: 'nowrap', fontFamily: "'LINE Seed TW'", fontWeight: 700,
        fontSize: px(L.labelSize), letterSpacing: '.1em', color: '#FFF6E2', opacity: 0, textShadow: '0 0 14px rgba(5,12,9,0.9)',
      });
      d.innerHTML = `${SKY_CAMPUS[k].name.replace('校', '')}<span style="font-weight:400;margin-left:12px;letter-spacing:.08em;color:#F0DDA8">${SKY_CAMPUS[k].year}</span>`;
      this.labels[k] = d;
    }
  }

  /* 年份排程：[淡入, 淡出, 年份, 快?] */
  yearPlan() {
    const p = [[90, 590, 1997], [622, 762, 2001], [782, 932, 2005]];
    for (let i = 0; i < 14; i++) p.push([958 + i * 10, 958 + (i + 1) * 10, 2006 + i, true]);
    p[p.length - 1][1] = 1094;
    p.push([1104, 1252, 2020], [1264, 1410, 2021]);
    return p;
  }

  drawYears(f) {
    const act = this.yearPlan().filter(([a, b, , fast]) => f >= a - 1 && f < b + (fast ? 4 : 18));
    this.yearEls.forEach((e, i) => {
      const it = act[i];
      if (!it) { setStyle(e, 'opacity', '0'); return; }
      const [a, b, yr, fast] = it;
      const inD = fast ? 4 : 26, outD = fast ? 4 : 18;
      const pin = E.outQuint(prog(f, a, a + inD)), pout = E.inOut(prog(f, b, b + outD));
      const o = pin * (1 - pout);
      if (e.textContent !== String(yr)) e.textContent = String(yr);
      setStyle(e, 'opacity', o.toFixed(3));
      const bl = (1 - pin) * (fast ? 6 : 16) + pout * 10;
      setStyle(e, 'filter', bl > 0.05 ? `blur(${bl.toFixed(2)}px)` : 'none');
      setStyle(e, 'transform', `translate3d(0,${((1 - pin) * 14 - pout * 18).toFixed(2)}px,0) scale(${(1 + (1 - pin) * 0.04).toFixed(4)})`);
      setStyle(e, 'letterSpacing', `${(0.05 + (1 - pin) * 0.06).toFixed(3)}em`);
    });
  }

  /* 星星亮度（點亮的星：點亮前完全沒有；點亮瞬間強光後收成常亮） */
  flash(f, g) { if (f < g) return 0; const a = f - g; return Math.min(1, a / 2) * Math.exp(-a / 9); }

  render(f) {
    const ctx = this.ctx, L = this.L;
    const cam = skyCamera(f);
    const camA = skyCamera(f - 0.5), camB = skyCamera(f + 0.5);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#050C09';
    ctx.fillRect(0, 0, W, H);
    // 遠景星雲（幾乎不動）＋第 18 小節稍微亮起來
    const neb = 1 + 0.35 * E.inOutSine(prog(f, 1440, 1480)) * (1 - prog(f, 1540, 1600));
    this.drawLayer(this.far, cam, 0.06, 1.08, 1, 'source-over');
    if (neb > 1) this.drawLayer(this.far, cam, 0.06, 1.08, neb - 1, 'lighter');

    // 背景星（含移動時的拖影與星軌）
    ctx.globalCompositeOperation = 'lighter';
    // 星軌只在鏡頭不動的那段（962–1092）畫，鏡頭開始移動前就淡完
    const trails = f >= 962 && f < 1092;
    const trailA = E.inOutSine(prog(f, 962, 990)) * (1 - E.inOut(prog(f, 1068, 1092)));
    const R0 = 0;
    for (const s of this.stars) {
      const tw = 0.72 + 0.28 * Math.sin(s.ph + f * s.sp);
      const [x, y, z] = skyProject(s.p, cam, s.k);
      if (x < -60 || x > W + 60 || y < -60 || y > H + 60) {
        if (!trails) continue;
      }
      const a = Math.min(1, s.b * 1.4 + 0.12) * tw;
      if (trails && s.b > 0.05) {
        // 星軌：繞旋轉中心（A）從星軌開始的角度畫到現在
        const cx = cam.A[0], cy = cam.A[1];
        const dx = x - cx, dy = y - cy;
        const rr = Math.hypot(dx, dy);
        if (rr > 4 && rr < 2400) {
          const now = Math.atan2(dy, dx);
          const sweep = cam.R - R0;
          ctx.strokeStyle = rgba(s.col, (a * 0.55 * trailA).toFixed(3));
          ctx.lineWidth = Math.max(0.6, s.rad * 0.9);
          ctx.beginPath();
          ctx.arc(cx, cy, rr, now - sweep, now, false);
          ctx.stroke();
        }
      }
      if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
      const p0 = skyProject(s.p, camA, s.k), p1 = skyProject(s.p, camB, s.k);
      const mv = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const rad = s.rad * Math.min(2.2, Math.pow(z, 0.25));
      if (mv > 1.2) {
        ctx.strokeStyle = rgba(s.col, Math.min(1, a * (1.6 / Math.sqrt(mv / 1.2))).toFixed(3));
        ctx.lineWidth = rad * 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      } else {
        ctx.fillStyle = rgba(s.col, a.toFixed(3));
        ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.283); ctx.fill();
      }
      if (s.b > 0.35) {
        const g = 10 + s.b * 26;
        ctx.globalAlpha = a * 0.35;
        ctx.drawImage(this.soft, x - g / 2, y - g / 2, g, g);
        ctx.globalAlpha = 1;
      }
    }
    // 近景塵埃
    this.drawLayer(this.near, cam, 0.32, 1.25, 0.85, 'lighter');
    // 星座中心一團很淡的暖光，讓深綠夜空帶一點溫度
    {
      const pc = skyProject(SKY_CENTROID, cam, 0.5);
      const sz = 2600 * Math.pow(cam.Z, 0.3);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.10 + 0.08 * E.inOutSine(prog(f, 1440, 1480)) * (1 - prog(f, 1540, 1600));
      ctx.drawImage(this.glow, pc[0] - sz / 2, pc[1] - sz / 2, sz, sz);
      ctx.globalAlpha = 1;
    }

    // 開場：光往義華聚
    const pY = skyProject(SKY_CAMPUS.yihua.p, cam, 1);
    if (f < 330) {
      for (const g of this.gather) {
        const t = prog(f, g.t0, g.t0 + g.dur);
        if (t <= 0 || t >= 1) continue;
        const d = g.d * (1 - E.in(t)) * cam.Z / 1.3;
        const x = pY[0] + Math.cos(g.a + t * 0.6) * d, y = pY[1] + Math.sin(g.a + t * 0.6) * d;
        const s = (6 + g.s * 8) * (0.4 + t);
        ctx.globalAlpha = Math.sin(Math.PI * t) * 0.8;
        ctx.drawImage(this.glow, x - s / 2, y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
      const pre = E.in(prog(f, 40, 318));
      this.drawStarCore(pY[0], pY[1], 3 + pre * 22, 0.25 + pre * 0.75, pre * 0.6);
    }

    // 星座線
    this.drawLines(f, cam);
    // 校園星與點亮特效
    for (const k of SKY_ORDER) this.drawCampusStar(f, k, cam);
    // 光窗（每站的實景）
    for (const k of SKY_ORDER) this.drawWindow(f, k, cam);
    // 星軌時的記憶光球
    if (f >= 958 && f < 1150) this.drawOrbs(f, cam);
    // 第 18 小節：全部星星一起亮一下
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // 文字
    this.drawYears(f);
    for (const k of SKY_ORDER) {
      const c = SKY_CAMPUS[k];
      this.names[k].update(f, c.ign + 12, c.close[0] - 6, { stagger: 1.8, dur: 26, rise: 0.25, blur: 14, outDur: 16 });
      this.hists[k].update(f, c.ign + 26, c.close[0] - 6, { stagger: 1.0, dur: 24, rise: 0.25, blur: 10, outDur: 16 });
    }
    this.years.update(f, 968, 1088, { stagger: 2.2, dur: 26, rise: 0.25, blur: 14, outDur: 14 });
    this.title.update(f, 1456, 1546, { stagger: 1.8, dur: 28, rise: 0.25, blur: 14, outDur: 16 });
    for (const [i, k] of SKY_ORDER.entries()) {
      const lab = this.labels[k];
      const a = E.out(prog(f, 1450 + i * 6, 1476 + i * 6)) * (1 - E.inOut(prog(f, 1544, 1562)));
      if (a <= 0) { setStyle(lab, 'opacity', '0'); continue; }
      const p = skyProject(SKY_CAMPUS[k].p, cam, 1);
      const left = { minghua: true, chongde: true }[k];
      const w = lab.getBoundingClientRect().width;
      const x = left ? p[0] - 30 - w : p[0] + 30;
      setStyle(lab, 'transform', `translate3d(${x.toFixed(1)}px,${(p[1] - L.labelSize * 0.62).toFixed(1)}px,0)`);
      setStyle(lab, 'opacity', a.toFixed(3));
    }
  }

  drawLayer(img, cam, k, base, alpha, mode) {
    const ctx = this.ctx;
    const z = Math.pow(cam.Z, k) * base;
    ctx.save();
    ctx.globalCompositeOperation = mode;
    ctx.globalAlpha = alpha;
    ctx.translate(cam.A[0], cam.A[1]);
    ctx.rotate(cam.R);
    ctx.scale(z, z);
    ctx.translate(-cam.T[0] * k * 0.4, -cam.T[1] * k * 0.4);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  }

  /* 星核：光暈＋四道繞射芒＋一道水平的寬銀幕光 */
  drawStarCore(x, y, r, a, spike, streak = 0) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, a);
    const s = r * 6;
    ctx.drawImage(this.glow, x - s / 2, y - s / 2, s, s);
    ctx.globalAlpha = Math.min(1, a * 0.9);
    const c2 = r * 1.6;
    ctx.drawImage(this.soft, x - c2, y - c2, c2 * 2, c2 * 2);
    if (spike > 0.01) {
      for (const [ang, len] of [[0, 1], [Math.PI / 2, 1], [Math.PI / 4, 0.42], [-Math.PI / 4, 0.42]]) {
        const l = r * 9 * spike * len;
        const gx = Math.cos(ang) * l, gy = Math.sin(ang) * l;
        const gr = ctx.createLinearGradient(x - gx, y - gy, x + gx, y + gy);
        gr.addColorStop(0, 'rgba(255,230,180,0)');
        gr.addColorStop(0.5, `rgba(255,246,226,${Math.min(1, a * 0.85)})`);
        gr.addColorStop(1, 'rgba(255,230,180,0)');
        ctx.strokeStyle = gr;
        ctx.lineWidth = Math.max(1, r * 0.09);
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.moveTo(x - gx, y - gy); ctx.lineTo(x + gx, y + gy); ctx.stroke();
      }
    }
    if (streak > 0.01) {
      const l = streak;
      const gr = ctx.createLinearGradient(x - l, y, x + l, y);
      gr.addColorStop(0, 'rgba(239,188,75,0)');
      gr.addColorStop(0.42, 'rgba(255,214,140,0.35)');
      gr.addColorStop(0.5, 'rgba(255,248,232,0.95)');
      gr.addColorStop(0.58, 'rgba(255,214,140,0.35)');
      gr.addColorStop(1, 'rgba(239,188,75,0)');
      ctx.fillStyle = gr;
      ctx.globalAlpha = Math.min(1, a);
      ctx.fillRect(x - l, y - 1.6, l * 2, 3.2);
      ctx.globalAlpha = Math.min(1, a) * 0.35;
      ctx.fillRect(x - l * 0.7, y - 9, l * 1.4, 18);
    }
    ctx.globalAlpha = 1;
  }

  drawCampusStar(f, k, cam) {
    const c = SKY_CAMPUS[k], ctx = this.ctx;
    const g = c.ign;
    const p = skyProject(c.p, cam, 1);
    if (p[0] < -400 || p[0] > W + 400 || p[1] < -400 || p[1] > H + 400) return;
    const zs = Math.min(3, Math.max(0.78, cam.Z / this.L.Zs));
    // 點亮前：鏡頭到了才開始醞釀（第一顆另外處理）
    if (f < g) {
      if (k === 'yihua') return;
      const pre = E.in(prog(f, g - 26, g));
      if (pre > 0) this.drawStarCore(p[0], p[1], (3 + pre * 14) * zs, 0.2 + pre * 0.7, pre * 0.5);
      return;
    }
    const fl = this.flash(f, g);
    const all = f >= 1440 ? Math.exp(-(f - 1440) / 14) * Math.min(1, (f - 1440) / 2) : 0; // 第 18 小節一起亮
    const breathe = 0.85 + 0.15 * Math.sin(f * 0.07 + c.year);
    const dive = k === 'minghua' ? E.in(prog(f, 1560, 1600)) : 0;
    const r = (13 + fl * 70 + all * 22) * zs * breathe + dive * 260;
    this.drawStarCore(p[0], p[1], r, 0.9 + fl, 0.55 + fl * 1.6 + all, (160 + fl * 1100 + all * 300) * Math.min(1.4, zs) + dive * 2400);
    // 點亮的光環與火花
    const age = f - g;
    if (age < 80) {
      ctx.globalCompositeOperation = 'lighter';
      const t = age / 40;
      if (t < 1) {
        ctx.strokeStyle = `rgba(255,226,160,${(0.75 * (1 - t)).toFixed(3)})`;
        ctx.lineWidth = 3 * (1 - t) + 0.5;
        ctx.beginPath(); ctx.arc(p[0], p[1], E.outQuint(t) * 460 * zs, 0, 6.283); ctx.stroke();
      }
      for (const s of this.sparks[k]) {
        if (age > s.life) continue;
        const d = s.v * 9 * (1 - Math.exp(-age / 9)) * zs;
        const x = p[0] + Math.cos(s.a) * d, y = p[1] + Math.sin(s.a) * d;
        const a = Math.pow(1 - age / s.life, 1.5);
        const sz = (3 + s.s * 4) * zs;
        ctx.globalAlpha = a;
        ctx.drawImage(s.gold ? this.glow : this.mintGlow, x - sz, y - sz, sz * 2, sz * 2);
      }
      ctx.globalAlpha = 1;
      // 鏡頭眩光的幾個殘影（沿著星→畫面中心的直線）
      if (fl > 0.02) {
        const cxs = W / 2, cys = H / 2;
        for (const [t2, sz, col] of [[0.55, 70, this.mintGlow], [1.25, 130, this.mintGlow], [1.7, 46, this.glow]]) {
          const x = p[0] + (cxs - p[0]) * t2, y = p[1] + (cys - p[1]) * t2;
          ctx.globalAlpha = fl * 0.35;
          ctx.drawImage(col, x - sz / 2, y - sz / 2, sz, sz);
        }
        // 整個畫面亮一下
        const sc = 1400;
        ctx.globalAlpha = fl * 0.22;
        ctx.drawImage(this.glow, p[0] - sc / 2, p[1] - sc / 2, sc, sc);
        ctx.globalAlpha = 1;
      }
    }
  }

  /* 星座線：每一段在鏡頭移到下一顆星的那段時間由上一顆星牽過去，前端有一顆亮點 */
  drawLines(f, cam) {
    const ctx = this.ctx;
    const seg = [['yihua', 'minghua', 594, 640], ['minghua', 'chongde', 768, 800], ['chongde', 'international', 1094, 1120], ['international', 'renwu', 1256, 1280]];
    const boost = 1 + 0.8 * Math.exp(-Math.max(0, f - 1440) / 20) * (f >= 1440 ? 1 : 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const [a, b, f0, f1] of seg) {
      const t = E.inOut(prog(f, f0, f1));
      if (t <= 0) continue;
      const pa = skyProject(SKY_CAMPUS[a].p, cam, 1), pb = skyProject(SKY_CAMPUS[b].p, cam, 1);
      const x = lerp(pa[0], pb[0], t), y = lerp(pa[1], pb[1], t);
      const shimmer = 0.85 + 0.15 * Math.sin(f * 0.05 + f0);
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(239,188,75,${(0.16 * boost * shimmer).toFixed(3)})`;
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(x, y); ctx.stroke();
      ctx.strokeStyle = `rgba(255,232,180,${(0.8 * Math.min(1, boost) * shimmer).toFixed(3)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(x, y); ctx.stroke();
      if (t < 1) {
        const s = 46;
        ctx.globalAlpha = 0.9;
        ctx.drawImage(this.glow, x - s / 2, y - s / 2, s, s);
        ctx.globalAlpha = 1;
      }
    }
  }

  /* 光窗：點亮後星光水平拉開，再上下張開成寬銀幕的實景；離開前收回成一道光、回到星裡 */
  drawWindow(f, k, cam) {
    const c = SKY_CAMPUS[k];
    const g = c.ign;
    const open = E.outExpo(prog(f, g + 6, g + 40));
    const close = E.in(prog(f, c.close[0], c.close[1]));
    const h01 = open * (1 - close);
    if (h01 <= 0.001) return;
    const ctx = this.ctx, wc = this.wctx;
    const [Ww, Wh] = this.L.win;
    const p = skyProject(c.p, cam, 1);
    const wNow = Ww * lerp(0.55, 1, E.outQuint(prog(f, g + 2, g + 30))) * lerp(1, 0.7, close);
    const hNow = Math.max(2, Wh * h01);
    // 離屏：照片（慢推）＋邊緣柔化
    const img = this.photos[k];
    const [fx, fy, cw0] = c.crop;
    const push = lerp(1.12, 1.0, E.outQuint(prog(f, g + 6, g + 70))) * lerp(1, 0.95, E.inOutSine(prog(f, g + 70, c.close[1])));
    const cw = cw0 * push, ch = cw * Wh / Ww;
    wc.setTransform(1, 0, 0, 1, 0, 0);
    wc.globalCompositeOperation = 'source-over';
    wc.globalAlpha = 1;
    wc.clearRect(0, 0, this.win.width, this.win.height);
    wc.imageSmoothingQuality = 'high';
    wc.drawImage(img, fx - cw / 2, fy - ch / 2, cw, ch, 2, 2, Ww, Wh);
    // 暖一點、邊緣暗一點，跟夜空接得起來
    const vg = wc.createRadialGradient(Ww / 2, Wh / 2, Wh * 0.2, Ww / 2, Wh / 2, Ww * 0.62);
    vg.addColorStop(0, 'rgba(255,236,200,0.06)');
    vg.addColorStop(1, 'rgba(5,12,9,0.42)');
    wc.fillStyle = vg;
    wc.fillRect(0, 0, this.win.width, this.win.height);
    // 遮罩：上下依目前開口高度、左右兩端長羽化
    wc.globalCompositeOperation = 'destination-in';
    const top = 2 + (Wh - hNow) / 2, bot = top + hNow;
    const fe = Math.min(36, hNow / 2);
    const gv = wc.createLinearGradient(0, top, 0, bot);
    gv.addColorStop(0, 'rgba(0,0,0,0)');
    gv.addColorStop(fe / hNow, 'rgba(0,0,0,1)');
    gv.addColorStop(1 - fe / hNow, 'rgba(0,0,0,1)');
    gv.addColorStop(1, 'rgba(0,0,0,0)');
    wc.fillStyle = gv;
    wc.fillRect(0, 0, this.win.width, this.win.height);
    wc.fillStyle = 'rgba(0,0,0,0)';
    const ex = (Ww - wNow) / 2 + 2;
    const gh = wc.createLinearGradient(ex, 0, ex + wNow, 0);
    gh.addColorStop(0, 'rgba(0,0,0,0)');
    gh.addColorStop(0.1, 'rgba(0,0,0,1)');
    gh.addColorStop(0.9, 'rgba(0,0,0,1)');
    gh.addColorStop(1, 'rgba(0,0,0,0)');
    wc.fillStyle = gh;
    wc.fillRect(0, 0, this.win.width, this.win.height);
    wc.globalCompositeOperation = 'source-over';
    // 畫上主畫面（以星為中心）
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.win, p[0] - Ww / 2 - 2, p[1] - Wh / 2 - 2);
    // 上下緣的金色光線
    ctx.globalCompositeOperation = 'lighter';
    const edgeA = 0.6 * (1 - E.inOut(prog(f, g + 40, g + 90))) + 0.18 + close * 0.8;
    for (const yy of [p[1] - hNow / 2, p[1] + hNow / 2]) {
      const gr = ctx.createLinearGradient(p[0] - wNow / 2, 0, p[0] + wNow / 2, 0);
      gr.addColorStop(0, 'rgba(239,188,75,0)');
      gr.addColorStop(0.5, `rgba(255,230,180,${Math.min(1, edgeA).toFixed(3)})`);
      gr.addColorStop(1, 'rgba(239,188,75,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(p[0] - wNow / 2, yy - 0.8, wNow, 1.6);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* 2006–2019：每個八分音符一顆記憶光球（日常照片），繞著星座慢慢轉 */
  drawOrbs(f, cam) {
    const ctx = this.ctx, oc = this.octx, D = this.L.orbD;
    for (let i = 0; i < 14; i++) {
      const t0 = 960 + i * 10;
      const a = E.outBack(prog(f, t0, t0 + 10), 1.6);
      // 鏡頭在 1092 開始移動，最後幾顆提早收
      const out = E.inOut(prog(f, Math.min(t0 + 34, 1066), Math.min(t0 + 54, 1090)));
      if (a <= 0 || out >= 1) continue;
      // 黃金角散佈：相鄰兩年的光球出現在漩渦的不同位置
      const ang = -2.2 + i * 2.39996 + cam.R * 0.6;
      const R = this.L.orbR * (0.72 + 0.28 * ((i * 0.618) % 1));
      const x = cam.A[0] + Math.cos(ang) * R, y = cam.A[1] + Math.sin(ang) * R * 0.92;
      const d = D * a * (1 - out * 0.3);
      const img = this.daily[i];
      const s = Math.max(D / img.width, D / img.height);
      oc.setTransform(1, 0, 0, 1, 0, 0);
      oc.globalCompositeOperation = 'source-over';
      oc.clearRect(0, 0, this.orb.width, this.orb.height);
      oc.drawImage(img, 2 + D / 2 - img.width * s / 2, 2 + D / 2 - img.height * s / 2, img.width * s, img.height * s);
      oc.globalCompositeOperation = 'destination-in';
      const gr = oc.createRadialGradient(2 + D / 2, 2 + D / 2, D * 0.38, 2 + D / 2, 2 + D / 2, D / 2);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      oc.fillStyle = gr;
      oc.fillRect(0, 0, this.orb.width, this.orb.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = (1 - out) * Math.min(1, a);
      ctx.drawImage(this.orb, x - d / 2, y - d / 2, d, d);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - out) * 0.5 * Math.min(1, a);
      ctx.strokeStyle = 'rgba(255,226,160,0.8)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, d * 0.47, 0, 6.283); ctx.stroke();
      const flare = Math.exp(-(f - t0) / 5) * (f >= t0 ? 1 : 0);
      if (flare > 0.02) {
        ctx.globalAlpha = flare * 0.8;
        ctx.drawImage(this.glow, x - d, y - d, d * 2, d * 2);
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
