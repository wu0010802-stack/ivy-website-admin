/**
 * 特色教學頁的水彩（2026-09-28，mock：design/curriculum-watercolor-mockup-20260928）。
 * 2026-09-29 起首頁也用：五校淡彩速寫（utils/campusSketch.ts）、孩子的一天→五校水彩滲接（seepEdgeCanvas）。
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

// 改這裡會改到進入特色教學頁的轉場遮罩（revealMaskCanvas）：轉場遮罩的跨頁快取以 buildId 區分，部署後自動重產（plugins/curriculum-enter.client.ts）。
function ellipse(random: () => number, cx: number, cy: number, rx: number, ry: number, n = 12): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2, k = 1 + (random() - 0.5) * 0.35
    return [cx + Math.cos(angle) * rx * k, cy + Math.sin(angle) * ry * k] as Point
  })
}

// 改這裡會改到進入特色教學頁的轉場遮罩（revealMaskCanvas）：轉場遮罩的跨頁快取以 buildId 區分，部署後自動重產（plugins/curriculum-enter.client.ts）。
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

/** 一團顏料的基底：橢圓變形 2 輪。 */
export function washBase(random: () => number, cx: number, cy: number, rx: number, ry: number): Point[] {
  return deform(random, ellipse(random, cx, cy, rx, ry), 2, 0.55)
}
/** 一團顏料的其中一層：基底再變形 3 輪。 */
export function washLayer(random: () => number, base: Point[]): Point[] {
  return deform(random, base, 3, 0.32)
}
/**
 * 一團顏料的所有層：基底變形 2 輪，每層各自再變形 3 輪。
 * 要分段算（campusSketch.ts 閒置時間一次算幾層）就照同樣順序呼叫 washBase、washLayer，random 取用順序相同、結果逐位元一樣。
 */
export function washPolygons(random: () => number, cx: number, cy: number, rx: number, ry: number, layers: number): Point[][] {
  const base = washBase(random, cx, cy, rx, ry)
  return Array.from({ length: layers }, () => washLayer(random, base))
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

export interface WashBox { x: number, y: number, w: number, h: number }

/** 元素框（相對段落）→ 顏料的中心與半徑；半徑碰到段落上下緣就收回來，至少留一團看得見的大小。 */
export function washEllipse(spec: WashSpec, box: WashBox, sectionHeight: number) {
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

/** 把多邊形各軸分開往 (cx, cy) 壓，讓所有點落在半寬 hx、半高 hy 的框內；本來就在框內就原樣回傳。
 *  回傳新的點：washPolygons 的各層共用基底的點物件（deform 直接沿用上一輪的點），就地改會讓同一點被縮放好幾次。 */
export function fitInside(polys: Point[][], cx: number, cy: number, hx: number, hy: number): Point[][] {
  let dx = 0, dy = 0
  for (const poly of polys) for (const [x, y] of poly) { dx = Math.max(dx, Math.abs(x - cx)); dy = Math.max(dy, Math.abs(y - cy)) }
  return scalePolygons(polys, cx, cy, dx > hx ? hx / dx : 1, dy > hy ? hy / dy : 1)
}

function scalePolygons(polys: Point[][], cx: number, cy: number, sx: number, sy: number): Point[][] {
  if (sx === 1 && sy === 1) return polys
  return polys.map((poly) => poly.map(([x, y]): Point => [cx + (x - cx) * sx, cy + (y - cy) * sy]))
}

/** 扁長的顏料團最多先用幾比一的橢圓變形，剩下的比例再拉伸（見 blotPolygons）。 */
export const BLOT_MAX_ASPECT = 2

/**
 * 顏料團背景圖的多邊形，畫在 W×H 的 canvas 正中央。
 * 半徑留在框內 ~1/3：變形後的邊最多推出去 1.5 倍，再大就會被 canvas 切成直線。
 * 2026-11-11：「推出去 1.5 倍」只對接近方形的框成立。變形推的量和邊長成正比，扁長的框（年段的「一年一年學」、
 * 理念清單，約 4:1）上下兩條長邊會被推出超過框高，背景圖在框的下緣切成一條水平直線。
 * 所以照原本畫會超出框時，先用比例收斂到 BLOT_MAX_ASPECT 的橢圓變形、再沿長軸拉回原本的寬度：
 * 上下推出去的量跟著高度走，形狀還是軟的。（直接把超出的那一軸壓回框內試過：整團被壓扁、變形的尖刺變成一條條直紋。）
 * 最後 fitInside 只當保險：拉伸後仍超出的極少數點收回框內。沒超出框、基底沒反折的團（年齡、章節編號、首屏大標等）照舊，圖逐像素相同。
 */
export function blotPolygons(random: () => number, W: number, H: number): Point[][] {
  const cx = W / 2, cy = H / 2, rx = W * 0.34, ry = H * 0.31
  // 基底反折就重抽（2026-11-11，年段「4 歲」）：基底變形 2 輪時偶爾有一個點被推過頭，邊繞回去和自己交叉，
  // 每一層都沿著同一個結走，反折處疊出一段一段的直邊和分離的小三角，看起來像被切開。
  // 小交叉很常見（約六成的基底都有）而且看不出來，只換反折面積超過 BLOT_MAX_FOLD 的；其他團第一次就過，圖不變。
  const paint = (ex: number, ey: number) => {
    let base = washBase(random, cx, cy, ex, ey)
    for (let retry = 0; retry < 8 && foldRatio(base) > BLOT_MAX_FOLD; retry++) base = washBase(random, cx, cy, ex, ey)
    return Array.from({ length: 26 }, () => washLayer(random, base))
  }
  const polys = paint(rx, ry)
  // 照原本畫沒超出框就用它；只有真的會被切的團才改走拉伸，沒被切的扁長團（首屏大標、短的理念）形狀不變
  if (!polys.some((poly) => poly.some(([x, y]) => x < 1 || x > W - 1 || y < 1 || y > H - 1))) return polys
  const ex = Math.min(rx, ry * BLOT_MAX_ASPECT), ey = Math.min(ry, rx * BLOT_MAX_ASPECT)
  const stretched = ex === rx && ey === ry ? polys : scalePolygons(paint(ex, ey), cx, cy, rx / ex, ry / ey)
  // 留 3px：描邊線寬 1、反鋸齒會再往外吃一點，只留 1px 時邊上那一列還有淡淡的顏料
  return fitInside(stretched, cx, cy, cx - 3, cy - 3)
}

/**
 * 反折面積佔多邊形面積的比例：在外框裡取 64×64 個點算環繞數，主要方向（+1 或 −1）以外的非零點都算反折。
 * 正式站特色教學頁 21 塊：「4 歲」1.1%（分離小塊＋直邊）、五件事編號 0.7%（小缺口），其餘 ≤0.5% 看不出來（2026-11-11 總表）。
 */
export const BLOT_MAX_FOLD = 0.005
export function foldRatio(points: Point[]): number {
  if (!selfIntersects(points)) return 0
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of points) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
  const N = 64, counts = new Map<number, number>()
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const w = winding(points, x0 + (i + 0.5) * (x1 - x0) / N, y0 + (j + 0.5) * (y1 - y0) / N)
    if (w) counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  let inside = 0
  for (const n of counts.values()) inside += n
  return inside ? (inside - Math.max(counts.get(1) ?? 0, counts.get(-1) ?? 0)) / inside : 0
}

function winding(points: Point[], x: number, y: number) {
  let w = 0
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i]!, [bx, by] = points[(i + 1) % points.length]!
    const side = (bx - ax) * (y - ay) - (x - ax) * (by - ay)
    if (ay <= y) { if (by > y && side > 0) w++ } else if (by <= y && side < 0) w--
  }
  return w
}

/** 封閉多邊形有沒有兩條不相鄰的邊互相交叉。 */
export function selfIntersects(points: Point[]): boolean {
  const n = points.length
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  for (let i = 0; i < n; i++) {
    const a = points[i]!, b = points[(i + 1) % n]!
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      const c = points[j]!, d = points[(j + 1) % n]!
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true
    }
  }
  return false
}

/** 顏料團當背景圖（年齡、章節編號、引言底下那一團）；rgb 是 tokens.css 的三元組「r g b」。
 *  顏料邊緣本來就是軟的，長邊最多畫 384px（高 DPR 也一樣），放大看不出差別。 */
export function blotCanvas(seed: number, rgb: string, width: number, height: number, dpr = 1) {
  const k = Math.min(Math.min(1.5, dpr), 384 / Math.max(width, height))
  const { el, ctx } = canvas(Math.max(16, width * k), Math.max(16, height * k))
  const W = el.width, H = el.height, random = seededRandom(seed)
  ctx.fillStyle = `rgb(${rgb} / .085)`
  ctx.strokeStyle = `rgb(${rgb} / .14)`
  blotPolygons(random, W, H).forEach((poly, i) => {
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
 * 轉場遮罩的跨頁快取以 buildId 區分（每次部署重產）；改這支或它用到的 deform、ellipse 不用手動清快取，改種子或尺寸則把 plugin 的版本號加一。
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

/**
 * 首頁「孩子的一天 → 五校」水彩滲接的遮罩帶（2026-09-29 定案，比稿 B）：上段實心、中段一排水彩團的濕邊、下段透明。
 * 遮罩帶跟著捲動往上推，上一段就被「滲」掉，不是一條直線擦過去（composables/useWatercolorSeep.ts）。
 * 寬度畫成 2048，CSS 以 max(100%, 1400px) 置中，手機只取中段，濕邊的尺度不會被壓扁。
 *
 * 一次畫完約幾十 ms，所以拆成產生器：每 yield 一次是一小塊工作，呼叫端在閒置時間裡每塊不超過 8ms 地推進
 * （同 useWatercolor 的做法）。步驟照順序跑，同一個種子畫出同一張圖。
 */
export function seepEdgeCanvas(seed: number, width = 2048, height = 384) {
  const job = seepEdgeJob(seed, width, height)
  while (!job.steps.next().done) { /* 一口氣跑完（測試與不在乎長任務的呼叫端） */ }
  return job.canvas
}

export function seepEdgeJob(seed: number, width = 2048, height = 384) {
  const { el, ctx } = canvas(width, height)
  return { canvas: el, steps: seepEdgeSteps(ctx, seededRandom(seed), el.width, el.height) }
}

function* seepEdgeSteps(ctx: CanvasRenderingContext2D, random: () => number, W: number, H: number): Generator<void> {
  // 濕邊的基線：幾個頻率疊起來的緩慢起伏，振幅約帶高的 ±12%
  const phases = [random() * 6.3, random() * 6.3, random() * 6.3]
  const edgeY = (x: number) => H * (0.5
    + 0.07 * Math.sin(x / W * Math.PI * 2 * 1.3 + phases[0]!)
    + 0.035 * Math.sin(x / W * Math.PI * 2 * 3.7 + phases[1]!)
    + 0.02 * Math.sin(x / W * Math.PI * 2 * 9.1 + phases[2]!))
  // 實心核心：只變形上緣以下那條開放折線（deform 的推量與邊長成正比，封閉多邊形的頂邊太長，會被推進畫面裡破洞）
  let core: Point[] = Array.from({ length: 33 }, (_, i) => { const x = -W * 0.02 + W * 1.04 * i / 32; return [x, edgeY(x) - H * 0.12] })
  for (let d = 0; d < 3; d++) {
    const out: Point[] = []
    for (let i = 0; i < core.length - 1; i++) {
      const a = core[i]!, b = core[i + 1]!, len = Math.hypot(b[0] - a[0], b[1] - a[1])
      out.push(a, [(a[0] + b[0]) / 2 + gauss(random) * 0.2 * len * 0.5, (a[1] + b[1]) / 2 + gauss(random) * 0.2 * len * 0.5])
    }
    out.push(core[core.length - 1]!)
    core = out
  }
  ctx.fillStyle = 'rgb(0 0 0)'
  tracePolygon(ctx, [[-W * 0.02, -2], [W * 1.02, -2], ...core.reverse()])
  ctx.fill()
  yield
  // 濕邊：沿邊緣排一整排顏料團（同 revealMaskCanvas 的做法），圓潤、半透明、深淺不一；
  // 每團的外圈描幾次邊，顏料乾掉時邊緣積色的「水痕」
  for (let x = -40; x < W + 40; x += 70 + random() * 60) {
    const rx = 60 + random() * 110, ry = rx * (0.55 + random() * 0.35)
    const cy = edgeY(x) + (random() - 0.35) * H * 0.12
    washPolygons(random, x, cy, rx, ry, 16).forEach((poly, i) => {
      tracePolygon(ctx, poly)
      ctx.fillStyle = 'rgb(0 0 0 / .065)'
      ctx.fill()
      if (i % 5 === 0) { ctx.strokeStyle = 'rgb(0 0 0 / .12)'; ctx.lineWidth = 1.5; ctx.stroke() }
    })
    yield
  }
  // 更外圈幾團很淡的回滲（backrun）
  for (let x = random() * 200; x < W; x += 180 + random() * 220) {
    const rx = 40 + random() * 70
    washPolygons(random, x, edgeY(x) + H * 0.14, rx, rx * 0.7, 10).forEach((poly) => { tracePolygon(ctx, poly); ctx.fillStyle = 'rgb(0 0 0 / .045)'; ctx.fill() })
    yield
  }
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
