// 關於頁第三章「我們的期許」的蠟筆畫（2026-10-19，比稿 design/about-hope-picturebook-directions-20261019/ 選 B「孩子的蠟筆畫」）。
// 孩子畫的天空色帶、角落的太陽、草地印在書頁上（跨過書脊），房子和兩棵樹是剪下來的圖畫紙卡紙，煙囪冒一圈圈的煙，藤蔓爬上屋簷。
// 路徑在這裡用固定種子的亂數一次算好、寫成 JSON：伺服器端就畫得出來，各瀏覽器的 Math.sin 尾數不同也不會讓 hydration 對不上。
// 蠟筆質感（紙紋雜訊、手抖）是 AboutContent.vue 裡的 SVG 濾鏡，顏色是 about.css 的 token（c＝顏色代號）。
// 執行（repo 根目錄）：node scripts/about-crayon/build.mjs → web/app/generated/about-crayon.ts；web/tests/about-crayon.spec.ts 會比對兩者一致。
// 輸出成有型別標註的 .ts（不是 .json）：讓 TS 推導 26KB JSON 的型別會拖垮整個 nuxt typecheck（別支檔案跟著 TS2321）。
//
// 座標：一頁寬 620（＝桌機一頁的實際寬），上緣色帶與下緣草地是整個跨頁寬 1240，兩頁各露一半（preserveAspectRatio slice）。
// 每一筆：k:'cut'＝剪刀剪的白邊（填色、不套濾鏡）；其餘是蠟筆線：c 顏色代號、w 粗細、o 不透明度、
// a:'fill'＝翻開時塗上去（t 秒、l 秒後開始）、a:'grow'＝房子站好後畫出來。
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function seededRandom(seed) {
  let x = (seed >>> 0) || 1
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296)
}
function gauss(random) {
  let u = 0, v = 0
  while (!u) u = random()
  while (!v) v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
function densify(points, step) {
  const out = []
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]]
    const k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
    for (let j = 0; j < k; j++) out.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k])
  }
  out.push(points[points.length - 1])
  return out
}
/** 二次貝茲：[p0, c0, p1, c1, p2, …] 取樣成折線 */
function curve(points, n = 10) {
  const out = []
  for (let i = 0; i + 2 < points.length; i += 2) {
    const [a, c, b] = [points[i], points[i + 1], points[i + 2]]
    for (let k = 0; k < n; k++) {
      const t = k / n
      out.push([(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]])
    }
  }
  out.push(points[points.length - 1])
  return out
}
/** 手抖的線：每 step 取一點，抖動有慣性；overshoot＝兩端多畫出去（小朋友描邊常出頭） */
function wobbly(random, points, { step = 7, jitter = 0.7, overshoot = 0 } = {}) {
  let pts = points
  if (overshoot) {
    const [a, b] = [pts[0], pts[1]], [c, d] = [pts[pts.length - 2], pts[pts.length - 1]]
    const la = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, lc = Math.hypot(d[0] - c[0], d[1] - c[1]) || 1
    pts = [[a[0] - (b[0] - a[0]) / la * overshoot, a[1] - (b[1] - a[1]) / la * overshoot], ...pts.slice(1, -1), [d[0] + (d[0] - c[0]) / lc * overshoot, d[1] + (d[1] - c[1]) / lc * overshoot]]
  }
  let drift = 0
  return densify(pts, step).map(([x, y]) => { drift = drift * 0.7 + gauss(random) * jitter; return [x + drift * 0.6, y + drift] })
}
/** 塗滿：沿 angle 方向來回塗，每一列在形狀裡折返，偶爾塗出去一點 */
function zigzag(random, poly, { angle = -0.2, gap = 6, inset = 2, over = 4 } = {}) {
  const c = Math.cos(angle), s = Math.sin(angle)
  const rot = poly.map(([x, y]) => [x * c + y * s, -x * s + y * c])
  const vs = rot.map((p) => p[1]), vmin = Math.min(...vs), vmax = Math.max(...vs)
  const out = []
  let dir = 1
  for (let v = vmin + gap * 0.5; v < vmax - gap * 0.2; v += gap * (0.75 + random() * 0.5)) {
    const xs = []
    for (let i = 0; i < rot.length; i++) {
      const a = rot[i], b = rot[(i + 1) % rot.length]
      if ((a[1] - v) * (b[1] - v) < 0) xs.push(a[0] + (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]))
    }
    if (xs.length < 2) continue
    const u0 = Math.min(...xs) + inset - over * random() * random(), u1 = Math.max(...xs) - inset + over * random() * random()
    const row = [[u0, v + gauss(random) * gap * 0.15], [u1, v + gauss(random) * gap * 0.15]]
    out.push(...(dir > 0 ? row : row.reverse()))
    dir *= -1
  }
  return out.map(([u, v]) => [u * c - v * s, u * s + v * c])
}
/** 樹冠：一圈一圈繞著塗 */
function loops(random, poly, { gap = 7, r = 6.5, step = 0.8 } = {}) {
  const ys = poly.map((p) => p[1]), ymin = Math.min(...ys), ymax = Math.max(...ys)
  const out = []
  let t = 0, dir = 1
  for (let y = ymin + gap * 0.6; y < ymax - gap * 0.3; y += gap) {
    const xs = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      if ((a[1] - y) * (b[1] - y) < 0) xs.push(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]))
    }
    if (xs.length < 2) continue
    const x0 = Math.min(...xs) + r, x1 = Math.max(...xs) - r
    for (let x = dir > 0 ? x0 : x1; dir > 0 ? x <= x1 : x >= x0; x += dir * 2.6) {
      t += step
      out.push([x + Math.cos(t) * r, y + Math.sin(t) * r * 0.85 + gauss(random) * 0.4])
    }
    dir *= -1
  }
  return out
}

// 座標取整數（筆畫 2.6–6.5 粗，半個單位看不出來）；葉子、門把、鳥這種小圖形 fine:true 留一位小數
const f = (n, fine) => String(fine ? Math.round(n * 10) / 10 : Math.round(n))
const d = (pts, closed = false, fine = false) => 'M' + pts.map(([x, y]) => `${f(x, fine)} ${f(y, fine)}`).join('L') + (closed ? 'Z' : '')
const line = (c, pts, w, { fine = false, ...extra } = {}) => ({ c, d: d(pts, false, fine), w, ...extra })
/** 剪刀剪的白邊：一段段直線、角不太準 */
const cut = (random, pts) => ({ k: 'cut', d: d(pts.map(([x, y]) => [x + gauss(random) * 1.4, y + gauss(random) * 1.4]), true) })

// ---------- 上緣（跨頁 1240×260）：天空色帶、右頁右上角四分之一個太陽、兩隻鳥 ----------
function sky() {
  const random = seededRandom(3)
  const band = []
  for (let x = -10; x <= 1250; x += 30) band.push([x, 58 + 9 * Math.sin(x / 73) + 5 * Math.sin(x / 23) + gauss(random) * 2])
  const poly = [[-10, -10], [1250, -10], ...band.reverse()]
  const out = [
    line('sky', zigzag(random, poly, { angle: -0.06, gap: 6.5, over: 10 }), 6.5, { o: 0.78, a: 'fill', t: 1.1 }),
    line('sky', zigzag(random, poly, { angle: 0.12, gap: 13, over: 6 }), 5, { o: 0.4, a: 'fill', t: 1.1, l: 0.25 })
  ]
  const sun = Array.from({ length: 28 }, (_, i) => { const a = Math.PI / 2 + i / 27 * Math.PI / 2; return [1248 + Math.cos(a) * 96, -8 + Math.sin(a) * 96] })
  const sunPoly = [[1250, -10], ...sun]
  out.push(line('sun', zigzag(random, sunPoly, { angle: 0.7, gap: 6, over: 3 }), 6.5, { a: 'fill', t: 0.8, l: 0.5 }))
  out.push(line('sun', loops(random, sunPoly, { gap: 11, r: 6, step: 0.95 }), 4, { o: 0.6, a: 'fill', t: 0.8, l: 0.6 }))
  out.push(line('sun-line', wobbly(random, sun, { jitter: 0.5 }), 3.4, { a: 'fill', t: 0.6, l: 0.9 }))
  ;[100, 115, 130, 145, 160, 172].forEach((deg, i) => {
    const a = deg * Math.PI / 180, r0 = 112, r1 = r0 + 26 + (i % 2) * 14
    out.push(line('sun-line', wobbly(random, [[1248 + Math.cos(a) * r0, -8 + Math.sin(a) * r0], [1248 + Math.cos(a) * r1, -8 + Math.sin(a) * r1]], { step: 5, jitter: 0.4 }), 3.6, { a: 'fill', t: 0.3, l: 1 + i * 0.06 }))
  })
  // 鳥只畫在右頁：左頁那半在手機上是標題的位置
  ;[[790, 150, 11], [828, 128, 9]].forEach(([x, y, s], i) => {
    out.push(line('ink', wobbly(random, curve([[x - s, y - s * 0.5], [x - s * 0.4, y - s * 0.7], [x, y], [x + s * 0.4, y - s * 0.7], [x + s, y - s * 0.5]], 6), { step: 3, jitter: 0.3 }), 2.6, { a: 'fill', t: 0.4, l: 1.2 + i * 0.1, fine: true }))
  })
  return out
}

// ---------- 下緣（跨頁 1240×300，底＝300）：草地，草頂離頁底約 112 ----------
export const GRASS_TOP = 112
function grass() {
  const random = seededRandom(11)
  const H = 300
  const top = (x) => H - (GRASS_TOP + 5 * Math.sin(x / 80) + 3 * Math.sin(x / 27))
  const edge = []
  for (let x = -10; x <= 1250; x += 24) edge.push([x, top(x)])
  const poly = [...edge, [1250, H + 10], [-10, H + 10]]
  const out = [
    line('grass', zigzag(random, poly, { angle: 0.04, gap: 5.5, over: 8 }), 6.5, { o: 0.6, a: 'fill', t: 1.1 }),
    line('grass-dark', zigzag(random, poly, { angle: -0.5, gap: 16, over: 6 }), 4, { o: 0.22, a: 'fill', t: 1, l: 0.2 })
  ]
  const blades = []
  for (let x = -6; x <= 1250; x += 9 + random() * 6) { const y = top(x); blades.push([x, y + 3], [x + 3 + random() * 2, y - 8 - random() * 8]) }
  out.push(line('grass-dark', wobbly(random, blades, { step: 30, jitter: 0.3 }), 3, { o: 0.85, a: 'fill', t: 1.3, l: 0.3 }))
  return out
}

// ---------- 房子（卡紙 300×340；剪邊會超出框一點） ----------
function house() {
  const random = seededRandom(7)
  const roof = [[146, 12], [300, 138], [0, 142]], wall = [[34, 134], [268, 129], [272, 337], [30, 338]]
  const chimney = [[206, 46], [230, 48], [232, 110], [204, 108]]
  const door = [[130, 338], [131, 300], ...Array.from({ length: 9 }, (_, i) => { const a = Math.PI + i / 8 * Math.PI; return [150 + Math.cos(a) * 19, 300 + Math.sin(a) * 19 * 1.05] }), [169, 300], [170, 338]]
  const frame = [[80, 146], [222, 143], [224, 258], [78, 260]]
  return [
    cut(random, [[146, -2], [205, 48], [206, 34], [242, 36], [244, 82], [318, 146], [282, 146], [284, 348], [18, 348], [20, 150], [-16, 150]]),
    line('roof-line', zigzag(random, chimney, { angle: 1.45, gap: 5 }), 5),
    line('ink', wobbly(random, [...chimney, chimney[0]]), 3),
    line('wall', zigzag(random, wall, { angle: -0.08, gap: 6 }), 6.5, { o: 0.9 }),
    line('wall', zigzag(random, wall, { angle: 0.5, gap: 12 }), 5, { o: 0.45 }),
    line('glass', zigzag(random, frame, { angle: 0.8, gap: 7 }), 5, { o: 0.7 }),
    line('roof', zigzag(random, roof, { angle: 0.55, gap: 6 }), 6.5, { o: 0.92 }),
    line('roof-line', zigzag(random, roof, { angle: -0.6, gap: 14 }), 4, { o: 0.4 }),
    line('door', zigzag(random, door, { angle: 1.5, gap: 5 }), 5.5),
    line('knob', wobbly(random, Array.from({ length: 9 }, (_, i) => [160 + Math.cos(i) * 3, 322 + Math.sin(i) * 3]), { step: 2, jitter: 0.1 }), 3.4, { fine: true }),
    line('roof-line', wobbly(random, [[-4, 144], [146, 10], [304, 140]], { overshoot: 6 }), 3.6),
    line('roof-line', wobbly(random, [[-4, 143], [304, 139]], { overshoot: 4 }), 3.2),
    line('wall-line', wobbly(random, [[34, 138], [30, 338], [272, 337], [268, 133]], { overshoot: 3 }), 3.4),
    line('ink', wobbly(random, [...frame, frame[0]], { overshoot: 4 }), 3),
    line('ink', wobbly(random, door), 3)
  ]
}
// 藤蔓（同一個 300×340 框）：從牆角彎彎爬上屋簷，葉子是小小的三角心形；房子站好後依序畫出來
function ivy() {
  const random = seededRandom(13)
  const vine = curve([[44, 340], [26, 314], [50, 286], [72, 258], [44, 230], [20, 204], [46, 178], [66, 156], [48, 136], [52, 118], [80, 104], [100, 92], [118, 76]], 10)
  const out = [line('ivy', wobbly(random, vine, { step: 5, jitter: 0.4 }), 3.6, { a: 'grow', t: 1.3 })]
  ;[[36, 318], [62, 288], [32, 258], [66, 232], [28, 204], [62, 176], [40, 150], [70, 112], [100, 96]].forEach(([x, y], i) => {
    const a = (i % 2 ? 0.5 : -0.5) + gauss(random) * 0.2, s = 9 + random() * 3
    const leaf = [[0, 0], [-s * 0.9, -s * 0.5], [-s * 0.6, -s * 1.1], [0, -s * 0.8], [s * 0.6, -s * 1.1], [s * 0.9, -s * 0.5]].map(([u, v]) => [x + u * Math.cos(a) - v * Math.sin(a), y + u * Math.sin(a) + v * Math.cos(a)])
    out.push(line(i % 3 === 1 ? 'crown' : 'leaf', zigzag(random, leaf, { angle: a + 1.2, gap: 3.2, inset: 0.5, over: 1 }), 3.6, { a: 'grow', t: 0.35, l: 0.5 + i * 0.12, fine: true }))
    out.push(line('ivy', wobbly(random, [...leaf, leaf[0]], { step: 3, jitter: 0.25 }), 2, { a: 'grow', t: 0.3, l: 0.6 + i * 0.12, fine: true }))
  })
  return out
}
// 煙囪的煙（120×180，煙囪頂在 (90, 172)）：一圈圈往左上飄，房子站好後畫出來
export const SMOKE_BOX = { w: 120, h: 180, x: 90, y: 172 }
function smoke() {
  const random = seededRandom(17)
  const spiral = []
  for (let t = 0; t < Math.PI * 6.2; t += 0.18) { const k = t / (Math.PI * 6.2); spiral.push([SMOKE_BOX.x - 70 * k + Math.cos(t) * (6 + 12 * k), SMOKE_BOX.y - 150 * k + Math.sin(t) * (5 + 10 * k)]) }
  return [line('smoke', wobbly(random, spiral, { step: 4, jitter: 0.3 }), 3, { a: 'grow', t: 1.4, l: 0.4 })]
}
// 棒棒糖樹：圓的（左）與橢圓的（右）
function tree(seed, { crown: [cx, cy, r, ry], trunk: [tx, ty, tw, th], round }) {
  const random = seededRandom(seed)
  const crownPoly = round
    ? Array.from({ length: 56 }, (_, i) => { const a = i / 56 * Math.PI * 2 + 0.3; const k = 1 + 0.12 * Math.abs(Math.sin(a * 3.5)); return [cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k * 1.02] })
    : Array.from({ length: 40 }, (_, i) => { const a = i / 40 * Math.PI * 2; return [cx + Math.cos(a) * r * (1 + 0.05 * Math.sin(a * 5)), cy + Math.sin(a) * ry] })
  const trunk = [[tx, ty], [tx + tw, ty], [tx + tw + 3, ty + th], [tx - 3, ty + th]]
  const ring = Array.from({ length: 13 }, (_, i) => { const a = i / 13 * Math.PI * 2; return [cx + Math.cos(a) * (r + 11), cy + Math.sin(a) * ((ry ?? r) + 11)] })
  return [
    cut(random, ring),
    cut(random, [[tx - 9, ty - 6], [tx + tw + 9, ty - 6], [tx + tw + 12, ty + th + 6], [tx - 12, ty + th + 6]]),
    line('trunk', zigzag(random, trunk, { angle: 1.5, gap: 4.5 }), 5.5),
    line('ink', wobbly(random, [[tx, ty + 2], [tx - 3, ty + th]]), 2.8),
    line('ink', wobbly(random, [[tx + tw, ty + 2], [tx + tw + 3, ty + th]]), 2.8),
    line('crown', loops(random, crownPoly), 5.5, { o: 0.92 }),
    line('crown2', zigzag(random, crownPoly, { angle: 0.7, gap: 12 }), 4.5, { o: 0.6 }),
    line('grass-dark', wobbly(random, [...crownPoly, crownPoly[0]], { step: 6, jitter: 0.5 }), 3.4)
  ]
}

export function buildAboutCrayon() {
  return {
    sky: sky(),
    grass: grass(),
    house: house(),
    ivy: ivy(),
    smoke: smoke(),
    treeL: tree(23, { crown: [70, 74, 54], trunk: [62, 120, 16, 86], round: true }),
    treeR: tree(29, { crown: [58, 86, 42, 74], trunk: [51, 152, 14, 64] })
  }
}

export const OUTPUT = fileURLToPath(new URL('../../web/app/generated/about-crayon.ts', import.meta.url))
export function moduleSource(art = buildAboutCrayon()) {
  return [
    '// 由 scripts/about-crayon/build.mjs 產生，不要手改（改畫法改那支再重跑）。',
    "export interface CrayonStroke { k?: string, c?: string, d: string, w?: number, o?: number, a?: string, t?: number, l?: number }",
    `export type CrayonName = ${Object.keys(art).map((k) => `'${k}'`).join(' | ')}`,
    `export const ABOUT_CRAYON: Record<CrayonName, CrayonStroke[]> = ${JSON.stringify(art)}`,
    ''
  ].join('\n')
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUTPUT, moduleSource())
  console.log(`wrote ${OUTPUT}`)
}
