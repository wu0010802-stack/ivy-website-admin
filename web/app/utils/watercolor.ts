/**
 * 特色教學頁的水彩（2026-09-28，mock：design/curriculum-watercolor-mockup-20260928）。
 *
 * 一團顏料＝一個基底多邊形反覆「在每條邊的中點往法線方向亂推」，再用很低的透明度疊幾十層；
 * 邊緣因為每層形狀不同而自然暈開，中央層層相疊變深（Tyler Hobbs 的生成式水彩做法）。
 * 這支檔案只放演算法與「畫成圖片」的函式；掛到頁面上的事在 composables/useWatercolor.ts。
 * 畫圖的函式要 document（canvas），只能在瀏覽器端呼叫。
 */

export type Point = [number, number]
export const PIGMENTS = ['mint', 'sky', 'sun', 'orange', 'leaf'] as const
export type Pigment = typeof PIGMENTS[number]

/** 可重現的亂數（LCG）：同一個種子每次畫出同一張圖，重新整理不會跳。 */
export function seededRandom(seed: number): () => number {
  let x = (seed >>> 0) || 1
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296)
}

function gauss(random: () => number) {
  let u = 0, v = 0
  while (!u) u = random()
  while (!v) v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function ellipse(random: () => number, cx: number, cy: number, rx: number, ry: number, n = 12): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2, k = 1 + (random() - 0.5) * 0.35
    return [cx + Math.cos(angle) * rx * k, cy + Math.sin(angle) * ry * k] as Point
  })
}

/** 每一輪在每條邊中點插一個點，沿高斯分布推開（推的量與邊長成正比）；點數每輪翻倍。 */
export function deform(random: () => number, points: Point[], depth: number, variance: number): Point[] {
  let pts = points
  for (let d = 0; d < depth; d++) {
    const out: Point[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      out.push(a, [(a[0] + b[0]) / 2 + gauss(random) * variance * len * 0.5, (a[1] + b[1]) / 2 + gauss(random) * variance * len * 0.5])
    }
    pts = out
  }
  return pts
}

/** 一團顏料的所有層：基底變形 2 輪，每層各自再變形 3 輪。 */
export function washPolygons(random: () => number, cx: number, cy: number, rx: number, ry: number, layers: number): Point[][] {
  const base = deform(random, ellipse(random, cx, cy, rx, ry), 2, 0.55)
  return Array.from({ length: layers }, () => deform(random, base, 3, 0.32))
}

export interface WashSpec { pigment: Pigment, fx: number, fy: number, frx: number, fry: number, alpha: number, layers: number }

/**
 * 解析 `data-wash`：「顏料,中心x,中心y,半徑x,半徑y[,每層透明度,層數]」，比例都相對元素框，多團用 `|` 分隔。
 * 不認得的顏料或數字壞掉就整團略過（寧可少一團，也不讓畫面壞掉）。
 */
export function parseWash(definition: string | undefined): WashSpec[] {
  if (!definition) return []
  return definition.split('|').flatMap((part) => {
    const [pigment, ...raw] = part.split(',').map((token) => token.trim())
    if (!(PIGMENTS as readonly string[]).includes(pigment!) || raw.length < 4) return []
    const [fx, fy, frx, fry, alpha = 0.028, layers = 36] = raw.map(Number)
    if (![fx, fy, frx, fry, alpha, layers].every(Number.isFinite)) return []
    return [{ pigment: pigment as Pigment, fx: fx!, fy: fy!, frx: frx!, fry: fry!, alpha, layers }]
  })
}

export interface Box { x: number, y: number, w: number, h: number }

/** 元素框（相對段落）→ 顏料的中心與半徑；半徑碰到段落上下緣就收回來，至少留一團看得見的大小。 */
export function washEllipse(spec: WashSpec, box: Box, sectionHeight: number) {
  const cx = box.x + box.w * spec.fx
  const cy = box.y + box.h * spec.fy
  const rx = Math.max(40, box.w * spec.frx)
  const ry = Math.max(30, Math.min(Math.max(34, box.h * spec.fry), cy - 16, sectionHeight - 16 - cy))
  return { cx, cy, rx, ry }
}

// ---------------------------------------------------------------------------
// 以下需要 canvas（瀏覽器端）。回傳 canvas，由呼叫端用 toBlob 非同步轉成網址（toDataURL 是同步編碼，
// 二十幾張一起做在手機上會卡住主執行緒）。
// ---------------------------------------------------------------------------

export function tracePolygon(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath()
  ctx.moveTo(points[0]![0], points[0]![1])
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]![0], points[i]![1])
  ctx.closePath()
}

function canvas(width: number, height: number) {
  const el = document.createElement('canvas')
  el.width = Math.max(1, Math.round(width))
  el.height = Math.max(1, Math.round(height))
  return { el, ctx: el.getContext('2d')! }
}

/** 顏料團當背景圖（年齡、章節編號、引言底下那一團）；rgb 是 tokens.css 的三元組「r g b」。
 *  顏料邊緣本來就是軟的，長邊最多畫 384px（高 DPR 也一樣），放大看不出差別。 */
export function blotCanvas(seed: number, rgb: string, width: number, height: number, dpr = 1) {
  const k = Math.min(Math.min(1.5, dpr), 384 / Math.max(width, height))
  const { el, ctx } = canvas(Math.max(16, width * k), Math.max(16, height * k))
  const W = el.width, H = el.height, random = seededRandom(seed)
  ctx.fillStyle = `rgb(${rgb} / .085)`
  ctx.strokeStyle = `rgb(${rgb} / .14)`
  // 半徑留在框內 ~1/3：變形後的邊最多推出去 1.5 倍，再大就會被 canvas 切成直線
  washPolygons(random, W / 2, H / 2, W * 0.34, H * 0.31, 26).forEach((poly, i) => {
    tracePolygon(ctx, poly)
    ctx.fill()
    if (i % 5 === 0) ctx.stroke()
  })
  // 顆粒：顏料沉進紙紋的小點
  ctx.fillStyle = `rgb(${rgb} / .22)`
  for (let i = 0; i < W * H / 900; i++) {
    const angle = random() * Math.PI * 2, d = Math.sqrt(random()) * 0.32
    ctx.fillRect(W / 2 + Math.cos(angle) * d * W, H / 2 + Math.sin(angle) * d * H, 1.2, 1.2)
  }
  return el
}

/** 照片的撕紙毛邊遮罩（黑＝看得見）。半解析度畫，邊緣本來就要軟。 */
export function deckleCanvas(width: number, height: number, seed: number) {
  const { el, ctx } = canvas(Math.max(8, width * 0.5), Math.max(8, height * 0.5))
  const W = el.width, H = el.height, random = seededRandom(seed)
  const inset = 4, step = 14, perimeter: Point[] = []
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / step))
    for (let i = 0; i < n; i++) perimeter.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n])
  }
  edge(inset, inset, W - inset, inset); edge(W - inset, inset, W - inset, H - inset)
  edge(W - inset, H - inset, inset, H - inset); edge(inset, H - inset, inset, inset)
  // 往內縮的量隨機、再和鄰點平均兩次，像撕過的紙邊而不是鋸齒
  let depth = perimeter.map(() => random() * 5)
  for (let k = 0; k < 2; k++) depth = depth.map((v, i) => (v + depth[(i + 1) % depth.length]! + depth[(i - 1 + depth.length) % depth.length]!) / 3)
  const at = (i: number, extra: number): Point => {
    const [px, py] = perimeter[i]!, dx = W / 2 - px, dy = H / 2 - py, d = Math.hypot(dx, dy) || 1
    const m = depth[i]! + extra
    return [px + dx / d * m, py + dy / d * m]
  }
  ctx.fillStyle = 'rgb(0 0 0 / .16)'
  for (let k = 0; k < 8; k++) { tracePolygon(ctx, perimeter.map((_, i) => at(i, gauss(random) * 1.6 + k * 0.5))); ctx.fill() }
  ctx.fillStyle = 'rgb(0 0 0)'
  tracePolygon(ctx, perimeter.map((_, i) => at(i, 5)))
  ctx.fill()
  return el
}

/** 照片進場「從中間暈開」用的第二層遮罩：一團邊緣柔軟的顏料，mask-size 從 0 放大。 */
export function bloomCanvas() {
  const S = 128
  const { el, ctx } = canvas(S, S)
  const random = seededRandom(3)
  ctx.fillStyle = 'rgb(0 0 0 / .13)'
  washPolygons(random, S / 2, S / 2, S * 0.3, S * 0.28, 16).forEach((poly) => { tracePolygon(ctx, poly); ctx.fill() })
  ctx.fillStyle = 'rgb(0 0 0)'
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.17, 0, Math.PI * 2); ctx.fill()
  return el
}

/**
 * 換頁暈開的遮罩（進入特色教學頁，plugins/curriculum-enter.client.ts）：外圈幾十層很淡的變形多邊形是濕邊，
 * 中間一塊變形過的實心核心（半徑約 0.29，最窄約 0.25 → utils/curriculumEnter.ts 的 REVEAL_CORE）。
 * 三張不同種子的遮罩以略不同的速度長大，邊緣形狀一路在變，不像一個圓在放大。
 */
export function revealMaskCanvas(seed: number, size = 1024) {
  const { el, ctx } = canvas(size, size)
  const random = seededRandom(seed)
  const base = deform(random, ellipse(random, size / 2, size / 2, size * 0.33, size * 0.33), 2, 0.5)
  ctx.fillStyle = 'rgb(0 0 0 / .07)'
  for (let i = 0; i < 28; i++) { tracePolygon(ctx, deform(random, base, 3, 0.3)); ctx.fill() }
  ctx.fillStyle = 'rgb(0 0 0)'
  tracePolygon(ctx, deform(random, ellipse(random, size / 2, size / 2, size * 0.29, size * 0.29, 16), 3, 0.18))
  ctx.fill()
  return el
}

/** 冷壓水彩紙的紋理（256px 平鋪，multiply 疊在頁面上）。 */
export function grainCanvas() {
  const S = 256
  const { el, ctx } = canvas(S, S)
  const random = seededRandom(5)
  const image = ctx.createImageData(S, S)
  for (let i = 0; i < S * S; i++) {
    const v = 255 - Math.pow(random(), 5) * 46 - random() * 5
    image.data[i * 4] = v; image.data[i * 4 + 1] = v; image.data[i * 4 + 2] = v - 2; image.data[i * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  // 紙纖維：幾十條很淡的短線
  ctx.strokeStyle = 'rgb(120 110 90 / .05)'
  for (let i = 0; i < 70; i++) {
    const px = random() * S, py = random() * S, angle = random() * Math.PI
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(angle) * 14, py + Math.sin(angle) * 14); ctx.stroke()
  }
  return el
}
