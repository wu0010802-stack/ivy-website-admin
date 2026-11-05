/**
 * 首頁五校「淡彩速寫」（2026-09-29 定案，比稿 A）：五校大照片先變成那一校的鉛筆線稿，水彩從建築中央一團團滲開上色，
 * 再從中央暈開回到照片（暈開沿用 /curriculum 照片進場的 bloomCanvas）。第一次捲到五校與手動換校時播，自動輪播不播。
 * 2026-09-29 晚：左右預覽卡改成靜態線稿（paintSketchStill），換到中央才從線稿接手上色（from: 'sketch'）；
 * 自動輪播只暈開、不上水彩（wash: false）。
 *
 * 線稿（campus-line-art-*.webp）是從同一張校園照描的，只差裁切與縮放；下表是線稿框在照片原始像素上的位置，
 * 用邊緣相關性對位算出（國際校線稿垂直多拉了約 12%，已含在高度裡）。只對表上那張照片成立：
 * 後台換了照片、線稿或淡彩層（有 media 版位）就對不上，sketchRegistration 回傳 null，照片照常顯示、不畫。
 * 換新照片要重算對位：照片與線稿各取邊緣圖，逐一試縮放比例，用 FFT 互相關找位移，取分數最高的一組。
 * 義華 v2（2026-09-30）是舊表 × 照片對照片的換算（enhanced-v1 → v2：x×1.480＋312、y×1.474＋82）：
 * 線稿直接對 v2 的分數太低（0.015），塔尖會偏高；照片對照片 0.21，疊圖塔尖、窗戶都對得上。
 *
 * 流暢度（2026-11-05）：畫出來的每一幀都和之前逐位元相同，只是少做重複的工。原圖改在 worker 解碼；濾鏡線稿層、淡彩層、
 * 水彩多邊形依尺寸快取並在閒置時間先準備（prepareSketch）；暫存 canvas 重用；上色時沒有新筆觸的幀不合成，
 * 有新筆觸只重畫碰到的那幾列（整列，不裁左右，理由見 composite）。線稿層「直接畫上主畫布」比經 scratch 中轉省事，但兩者實測最多差 14/255，所以照舊中轉；
 * 自動輪播的預覽線稿（paintSketchStill 直接畫）和換到中央後的第一幀（經 scratch）也因此不同，不能拿來互相代替。
 */
import { decodedBitmap } from './decoded-bitmap'
import { bloomCanvas, grainCanvas, seededRandom, washPolygons, type Point } from './watercolor'

export interface SketchRegistration { image: string, photo: [number, number], left: number, top: number, width: number, height: number }
export const SKETCH_REGISTRATION: Record<string, SketchRegistration> = {
  yihua: { image: 'yihua-exterior-v2', photo: [2820, 1684], left: 317.8, top: 59.2, width: 2265.1, height: 1532.5 },
  minghua: { image: 'minghua-enhanced-v1', photo: [1737, 906], left: 13, top: -56.5, width: 1702.3, height: 1042.2 },
  chongde: { image: 'chongde-enhanced-v1', photo: [1736, 906], left: 26, top: 21.7, width: 1649.2, height: 989.5 },
  international: { image: 'international-enhanced-v1', photo: [1736, 906], left: 0, top: 47.7, width: 1701.3, height: 998.2 },
  renwu: { image: 'renwu-enhanced-v1', photo: [1737, 906], left: 104.2, top: 0, width: 1528.6, height: 977.1 }
}

/** 這一校能不能畫：照片、線稿、淡彩層都還是對位時的那一套才行。 */
export function sketchRegistration(campus: { key: string, image: string, imageMedia?: unknown, lineArtMedia?: unknown, lineArtColourMedia?: unknown }) {
  const reg = SKETCH_REGISTRATION[campus.key]
  if (!reg || campus.image !== reg.image || campus.imageMedia || campus.lineArtMedia || campus.lineArtColourMedia) return null
  return reg
}

/** 線稿框在卡片上的位置（CSS px）：照片以 object-fit: cover ＋ object-position 放進卡片，線稿跟著照片走。 */
export function sketchLayout(reg: SketchRegistration, cardWidth: number, cardHeight: number, objectPosition: string) {
  const cover = Math.max(cardWidth / reg.photo[0], cardHeight / reg.photo[1])
  const [ax, ay] = sketchAlignment(objectPosition)
  const ox = (cardWidth - reg.photo[0] * cover) * ax, oy = (cardHeight - reg.photo[1] * cover) * ay
  return { x: ox + reg.left * cover, y: oy + reg.top * cover, width: reg.width * cover, height: reg.height * cover }
}

// 時間軸（ms）
const LINE_MS = 1100
const WASH_START = 450
const WASH_STAGGER = 120
const WASH_MS = 950
const PHOTO_AT = 2800
const PHOTO_MS = 1700
// 從預覽線稿接手：線已經畫好，跳過描線、第一團水彩提早到 200ms（卡片還在滑進中央）
const SKETCH_SKIP = WASH_START - 200
// 只暈開（自動輪播）：卡片滑到九成再開始
const BLOOM_ONLY_AT = 450
/**
 * 照片暈開的 mask-size 轉場（2026-11-05 切短，推導見 CampusBoard.vue 的 is-develop 樣式）：原本 1.7s cubic-bezier(.33,.12,.3,1)
 * 放大到 520%，468%（第 1100.457ms）時遮罩已整張蓋滿。這裡是原曲線 [0, u] 那一段：u＝0.7913893553664177（y(u)＝0.9），
 * 控制點 a＝u·P1、b＝2u(1−u)·P1＋u²·P2，再各除以 B(u) 的 x、y 正規化；時長 1700×x(u)。數字要完整：只留 6 位有效數字
 * （CSS 壓縮後的樣子）時，暈開中段的暫停截圖和原本不同；用這串完整的值，0–1699ms 取樣的 20 個時間點與結束狀態
 * 都和原本逐位元相同（桌機 1440、手機 390×3）。
 * 寫成 inline style 才不會被 build 的 CSS 壓縮改短。
 */
const BLOOM_EASE = 'cubic-bezier(.4034410597806647,.1055185807155224,.4585777993124224,.7399102780514095)'
export const BLOOM_TRANSITION = `-webkit-mask-size 1100.4567274385ms ${BLOOM_EASE},mask-size 1100.4567274385ms ${BLOOM_EASE}`

// ---------- 原圖 ----------
type SketchImage = HTMLImageElement | ImageBitmap
interface ImageEntry { pending: Promise<SketchImage>, value?: SketchImage }
/**
 * 線稿與淡彩層的原圖：fetch → createImageBitmap，webp 在 worker 解碼（utils/decoded-bitmap.ts）；不支援或失敗才退回 <img>。
 * <img> 給 canvas 用時在主執行緒同步解整張（2026-11-05 基準：桌機 1200w 一張 72–82ms，第一次接近五校時一連四張）。
 * 原圖只拿來建一次濾鏡圖層（sketchLayer）：建好就 close() 並移出 Map。ImageBitmap 不像 <img> 的解碼結果可以被瀏覽器丟掉，
 * 一直留著桌機五校線稿＋淡彩約 27MB；之後卡片變大小或圖層被逐出，再從 HTTP 快取重取（同源、/assets 有快取標頭）。
 */
const images = new Map<string, ImageEntry>()
function loadImage(src: string) {
  let entry = images.get(src)
  if (!entry) {
    const created: ImageEntry = { pending: decodedBitmap(src).then((bitmap): SketchImage | Promise<SketchImage> => bitmap ?? imageElement(src)) }
    created.pending.then((value) => { created.value = value }, () => {})
    images.set(src, entry = created)
  }
  return entry.pending
}
function imageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}
const isBitmap = (image: SketchImage): image is ImageBitmap => 'close' in image
/** 收掉建過圖層的原圖（<img> 留著，交給瀏覽器的解碼快取） */
function releaseImage(src: string, image: SketchImage) {
  if (!isBitmap(image)) return
  if (images.get(src)?.value === image) images.delete(src)
  image.close()
}
/** 拿得到能畫的原圖：同時在等同一張圖的另一個呼叫端已經建好圖層、把點陣圖收掉了（width 變 0），就重取 */
async function drawableImage(src: string) {
  let image = await loadImage(src)
  for (let retry = 0; retry < 3 && isBitmap(image) && !image.width; retry++) {
    if (images.get(src)?.value === image) images.delete(src)
    image = await loadImage(src)
  }
  return image
}

/** canvas 的縮放：DPR 最多算 1.5，再乘 0.85（水彩本來就軟，放大看不出差別） */
export function sketchScale() {
  return Math.min(1.5, window.devicePixelRatio || 1) * 0.85
}

/** 從分頁鈕線稿的 srcset 挑一張夠用的寬度（手機只要 480w，不必下載 1536 原圖）。 */
export function pickLineArt(srcset: string, fallback: string, neededWidth: number) {
  const candidates = srcset.split(',').map((part) => {
    const [url, width] = part.trim().split(/\s+/)
    return { url: url!, width: Number.parseInt(width ?? '', 10) }
  }).filter((c) => c.url && Number.isFinite(c.width)).sort((a, b) => a.width - b.width)
  return (candidates.find((c) => c.width >= neededWidth) ?? candidates[candidates.length - 1])?.url ?? fallback
}

let bloomUrl: Promise<string> | undefined
function bloomMask() {
  return (bloomUrl ??= new Promise<string>((resolve) => bloomCanvas().toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : ''))))
}
let grain: HTMLCanvasElement | undefined

/** object-position（'center 12%'、'center 55%'）→ 0–1 的對齊比例 */
export function sketchAlignment(position: string): [number, number] {
  const parts = position.trim().split(/\s+/)
  const read = (token: string | undefined, fallback: number) => {
    if (!token || token === 'center') return fallback
    if (token === 'left' || token === 'top') return 0
    if (token === 'right' || token === 'bottom') return 1
    const value = Number.parseFloat(token)
    return Number.isFinite(value) ? value / 100 : fallback
  }
  return [read(parts[0], 0.5), read(parts[1], 0.5)]
}

function layer(width: number, height: number) {
  const el = document.createElement('canvas')
  el.width = Math.max(1, Math.round(width))
  el.height = Math.max(1, Math.round(height))
  return { el, ctx: el.getContext('2d')! }
}
type Layer = ReturnType<typeof layer>

// ---------- 尺寸與對位 ----------
export interface CardSize { width: number, height: number }
interface SketchGeometry { W: number, H: number, scale: number, lx: number, ly: number, lw: number, lh: number }
/** 卡片 CSS 尺寸 → canvas 尺寸與線稿框（canvas px） */
function sketchGeometry(reg: SketchRegistration, size: CardSize, objectPosition: string): SketchGeometry {
  const cw = size.width, ch = size.height
  const scale = sketchScale()
  const box = sketchLayout(reg, cw, ch, objectPosition)
  return { W: Math.round(cw * scale), H: Math.round(ch * scale), scale, lx: box.x * scale, ly: box.y * scale, lw: box.width * scale, lh: box.height * scale }
}
const sameGeometry = (a: SketchGeometry, b: SketchGeometry) => a.W === b.W && a.H === b.H && a.lx === b.lx && a.ly === b.ly && a.lw === b.lw && a.lh === b.lh
/** 卡片尺寸：CampusBoard 傳 ResizeObserver 記下的值（換校 task 中途不強制重算版面）；沒給就當場讀 */
const readSize = (card: HTMLElement, size?: () => CardSize | null): CardSize => size?.() ?? { width: card.clientWidth, height: card.clientHeight }

// ---------- 濾鏡圖層 ----------
// 先壓暗再拉對比：紙底被推回全白（multiply 不染色），線條變深；順序反過來整張會變灰
const LINE_FILTER = 'grayscale(1) brightness(.8) contrast(2.4)'
// 淡彩層稍微提一點彩度
const COLOUR_FILTER = 'saturate(1.2)'
interface CachedLayer { campus: string, filter: string, src: string, layer: Layer }
/**
 * 線稿層（加深一次畫好，逐幀用 ctx.filter 太貴）與淡彩層依「濾鏡＋圖＋線稿框尺寸」快取（2026-11-05）：
 * 同一串繪圖指令畫出同一張，預覽線稿與淡彩速寫共用，換校不必每次重畫濾鏡。只留 keepSketches 指定的學校
 * （目前、左右兩校、最近滑到的分頁；桌機一層約 2MB），其他學校的圖層畫完就丟。
 */
const layers = new Map<string, CachedLayer>()
// 水彩多邊形（下面 washPlan）同樣只留這幾校；null＝還沒指定，全部留
let keep: Set<string> | null = null
const kept = (campus: string) => !keep || keep.has(campus)
const layerKey = (filter: string, src: string, lw: number, lh: number) => `${filter}|${src}|${lw}|${lh}`

async function sketchLayer(campus: string, filter: string, src: string, lw: number, lh: number) {
  const key = layerKey(filter, src, lw, lh)
  const cached = layers.get(key)
  if (cached) return cached.layer
  const image = await drawableImage(src)
  // 等圖的時候另一個呼叫端已經建好
  const ready = layers.get(key)
  if (ready) return ready.layer
  const built = layer(lw, lh)
  built.ctx.filter = filter
  built.ctx.drawImage(image, 0, 0, lw, lh)
  if (kept(campus)) {
    // 同一張圖舊尺寸的那層用不到了
    for (const [other, entry] of layers) if (entry.src === src && entry.filter === filter) layers.delete(other)
    layers.set(key, { campus, filter, src, layer: built })
  }
  releaseImage(src, image)
  return built
}

/** 只留這幾校的圖層與水彩多邊形（CampusBoard 換校、預載時呼叫）。 */
export function keepSketches(campuses: Iterable<string>) {
  keep = new Set(campuses)
  for (const [key, entry] of layers) if (!keep.has(entry.campus)) layers.delete(key)
  for (const [key, job] of plans) if (!keep.has(job.campus)) plans.delete(key)
}

// ---------- 水彩多邊形 ----------
interface Stroke { start: number, polys: Float64Array[], boxes: Float64Array }
interface WashPlan { blobs: Stroke[], skies: Stroke[] }
interface PlanJob { campus: string, plan: WashPlan, steps: Generator<void, void>, done: boolean }
/**
 * 十團顏料＋兩筆天空、共 256 個多邊形（每個 384 點），只取決於種子（校名）與線稿框，2026-11-05 前每次上色都在點擊的
 * task 裡重算（數十 ms）。改成依完整幾何快取，並在閒置時間一團一團先算（prepareSketch）；上色時還沒算完就同步補完。
 * random 的取用順序（先 40 個參數、排序後依序產生每團、最後天空）和原本一樣，座標逐位元相同。
 * 點存成 Float64Array（同樣的 double），一校約 1.6MB；另記每個多邊形的外接矩形，給上色時只重畫變動的那幾列用。
 */
const plans = new Map<string, PlanJob>()
function toStroke(start: number, polys: Point[][]): Stroke {
  const boxes = new Float64Array(polys.length * 4)
  return {
    start, boxes,
    polys: polys.map((poly, i) => {
      const flat = new Float64Array(poly.length * 2)
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      poly.forEach(([x, y], k) => {
        flat[k * 2] = x
        flat[k * 2 + 1] = y
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      })
      boxes.set([x0, y0, x1, y1], i * 4)
      return flat
    })
  }
}
function* washSteps(plan: WashPlan, campusKey: string, g: SketchGeometry, hasSky: boolean): Generator<void, void> {
  const { lx, ly, lw, lh } = g
  // 從建築中央往外，一團一團滲開
  const random = seededRandom(campusKey.length * 977 + campusKey.charCodeAt(0))
  const cx = lx + lw * 0.5, cy = ly + lh * 0.55
  const spots = Array.from({ length: 10 }, () => {
    const x = lx + lw * (0.1 + random() * 0.8), y = ly + lh * (0.22 + random() * 0.62)
    const rx = lw * (0.12 + random() * 0.13)
    return { x, y, rx, ry: rx * (0.55 + random() * 0.3) }
  }).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
  for (const [i, spot] of spots.entries()) {
    yield
    plan.blobs.push(toStroke(WASH_START + i * WASH_STAGGER, washPolygons(random, spot.x, spot.y, spot.rx, spot.ry, 22)))
  }
  // 天空：兩團很淡的天藍，淡彩速寫常見的「隨手刷一筆天」
  if (!hasSky) return
  for (const [i, fx] of [0.3, 0.72].entries()) {
    yield
    plan.skies.push(toStroke(WASH_START + 400 + i * 200, washPolygons(random, lx + lw * fx, ly + lh * 0.14, lw * 0.26, lh * 0.12, 18)))
  }
}
function planJob(campusKey: string, g: SketchGeometry, hasSky: boolean) {
  const key = `${campusKey}|${g.lx}|${g.ly}|${g.lw}|${g.lh}|${hasSky}`
  const cached = plans.get(key)
  if (cached) return cached
  const plan: WashPlan = { blobs: [], skies: [] }
  const job: PlanJob = { campus: campusKey, plan, steps: washSteps(plan, campusKey, g, hasSky), done: false }
  if (kept(campusKey)) {
    // 同一校舊尺寸的那份用不到了
    for (const [other, entry] of plans) if (entry.campus === campusKey) plans.delete(other)
    plans.set(key, job)
  }
  return job
}
/** 往下算一團；回傳是否算完 */
function advancePlan(job: PlanJob) {
  if (!job.done) job.done = Boolean(job.steps.next().done)
  return job.done
}
function washPlan(campusKey: string, g: SketchGeometry, hasSky: boolean) {
  const job = planJob(campusKey, g, hasSky)
  while (!advancePlan(job)) { /* 閒置時間還沒算完的部分在這裡同步補完 */ }
  return job.plan
}
function traceFlat(ctx: CanvasRenderingContext2D, flat: Float64Array) {
  ctx.beginPath()
  ctx.moveTo(flat[0]!, flat[1]!)
  for (let i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i]!, flat[i + 1]!)
  ctx.closePath()
}

// ---------- 閒置時間的準備工作：每塊不超過 8ms（同 useWatercolor） ----------
const idleTasks: (() => boolean)[] = []
let idleQueued = false
function requestIdle(fn: () => void) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 1000 })
  else setTimeout(fn, 32)
}
function runIdle() {
  idleQueued = false
  const t0 = performance.now()
  while (idleTasks.length && performance.now() - t0 < 8) if (idleTasks[0]!()) idleTasks.shift()
  if (idleTasks.length) { idleQueued = true; requestIdle(runIdle) }
}
/** task 回傳 true＝做完了，否則下次接著做 */
function enqueueIdle(task: () => boolean) {
  idleTasks.push(task)
  if (!idleQueued) { idleQueued = true; requestIdle(runIdle) }
}

/**
 * 閒置時間先把這一校之後會用到的準備好（2026-11-05）：水彩多邊形（一團一塊）、線稿層；有給 colourSrc 才建淡彩層
 * （呼叫端只在原本就會載淡彩圖的時機給：區塊接近時的目前這校、滑到／按下分頁）。沒準備好也沒關係，用到時同步補完，結果一樣。
 */
export function prepareSketch(options: {
  campusKey: string
  registration: SketchRegistration
  lineSrc: string
  colourSrc?: string
  objectPosition: string
  size: CardSize
  /** 同 developSketch 的 skyRgb：讀不到就沒有天空那兩筆 */
  skyRgb: string
}) {
  const g = sketchGeometry(options.registration, options.size, options.objectPosition)
  const job = planJob(options.campusKey, g, Boolean(options.skyRgb))
  if (!job.done) enqueueIdle(() => advancePlan(job))
  const prebuild = (filter: string, src: string) => {
    if (layers.has(layerKey(filter, src, g.lw, g.lh))) return
    drawableImage(src).then(() => enqueueIdle(() => {
      void sketchLayer(options.campusKey, filter, src, g.lw, g.lh).catch(() => undefined)
      return true
    }), () => undefined)
  }
  prebuild(LINE_FILTER, options.lineSrc)
  if (options.colourSrc) prebuild(COLOUR_FILTER, options.colourSrc)
}

// ---------- 畫布 ----------
/** 線稿層（依卡片目前尺寸）；等圖的時候卡片變了大小，就照新尺寸再取一次（同原本「載好才量」） */
async function sketchLines(options: { card: HTMLElement, campusKey?: string, registration: SketchRegistration, lineSrc: string, objectPosition: string, size?: () => CardSize | null }) {
  const measure = () => sketchGeometry(options.registration, readSize(options.card, options.size), options.objectPosition)
  let geometry = measure()
  for (;;) {
    const line = await sketchLayer(options.campusKey ?? options.lineSrc, LINE_FILTER, options.lineSrc, geometry.lw, geometry.lh)
    const now = measure()
    if (sameGeometry(now, geometry)) return { geometry, line }
    geometry = now
  }
}

/** canvas 依卡片尺寸重設大小、記下線稿框與紙色。靜態線稿與淡彩速寫共用，兩邊的線才一模一樣。 */
function sketchSurface(canvas: HTMLCanvasElement, geometry: SketchGeometry, lineLayer: Layer, paper: string) {
  const ctx = canvas.getContext('2d')!
  // 同尺寸不重設 width／height（2026-11-05）：重設會整張重配置；接下來 paintPaper 用不透明的紙色整張蓋過，
  // 畫出來和清空再畫逐位元相同。讀不到紙色時照舊重設（不然會沿用上一次的 fillStyle）。
  if (canvas.width !== geometry.W || canvas.height !== geometry.H || !paper) {
    canvas.width = geometry.W
    canvas.height = geometry.H
  } else {
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
  grain ??= grainCanvas()
  return { ctx, ...geometry, lineLayer, grainPattern: ctx.createPattern(grain, 'repeat'), paper }
}
type SketchSurface = ReturnType<typeof sketchSurface>
// 紙色讀卡片的 --paper（--ivy-campus-paper），不寫色碼
const paperOf = (card: HTMLElement) => getComputedStyle(card).getPropertyValue('--paper').trim()

/** 鋪紙；之後的顏料與線稿用 multiply 疊上去 */
function paintPaper({ ctx, W, H, paper }: SketchSurface) {
  ctx.globalCompositeOperation = 'source-over'
  if (paper) ctx.fillStyle = paper
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'multiply'
}
/** 紙紋；畫完把合成模式還原 */
function paintGrain({ ctx, W, H, grainPattern }: SketchSurface) {
  if (grainPattern) { ctx.globalAlpha = 0.45; ctx.fillStyle = grainPattern; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1 }
  ctx.globalCompositeOperation = 'source-over'
}

// 上色用的暫存 canvas（遮罩、天空、合成）：同時只會有一個淡彩速寫在跑，收尾時放回來給下一次用，不再每次新建三張（2026-11-05）。
// 拿出來時 clearRect 清空，和新建的一樣是全透明。
interface Scratch { W: number, H: number, mask: Layer, sky: Layer, work: Layer }
let spareScratch: Scratch | null = null
function takeScratch(W: number, H: number): Scratch {
  const spare = spareScratch && spareScratch.W === W && spareScratch.H === H ? spareScratch : null
  spareScratch = null
  if (!spare) return { W, H, mask: layer(W, H), sky: layer(W, H), work: layer(W, H) }
  for (const { ctx } of [spare.mask, spare.sky, spare.work]) {
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, W, H)
  }
  return spare
}
// 只暈開時沒有淡彩：原本是一張沒畫東西的淡彩層，透明的圖畫上去什麼都不變，用 1×1 的透明 canvas 代替
let blank: Layer | undefined

/** 讓出主執行緒（2026-11-05）：點擊那一幀先畫出來，準備與第一幀放到下一個 task。有 scheduler.yield 就用，否則等下一幀畫完。 */
function yieldToFrame() {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (typeof scheduler?.yield === 'function') return scheduler.yield()
  return new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
}

/**
 * 左右預覽卡的靜態線稿（2026-09-29 晚）：就是淡彩速寫描完線、還沒上色的那一幀，換到中央時 developSketch 才接得上。
 * 線稿載好時 wanted() 不成立（例如這張已經換到中央）就不畫；回傳 false＝沒畫，照片照常顯示。
 */
export async function paintSketchStill(options: {
  card: HTMLElement
  canvas: HTMLCanvasElement
  /** 圖層快取依校名（keepSketches）；沒給就以線稿網址代替 */
  campusKey?: string
  registration: SketchRegistration
  lineSrc: string
  objectPosition: string
  wanted: () => boolean
  /** 卡片尺寸（CampusBoard 的 ResizeObserver 快取）；沒給就讀 card.clientWidth／clientHeight */
  size?: () => CardSize | null
  /** 紙色（卡片的 --paper，CampusBoard 掛載時讀一次）；沒給就當場讀 */
  paper?: string
}) {
  const art = await sketchLines(options).catch(() => null)
  if (!art || !options.wanted()) return false
  const surface = sketchSurface(options.canvas, art.geometry, art.line, options.paper || paperOf(options.card))
  paintPaper(surface)
  surface.ctx.drawImage(surface.lineLayer.el, surface.lx, surface.ly, surface.lw, surface.lh)
  paintGrain(surface)
  return true
}

export interface DevelopHandle { cancel: () => void, done: Promise<void> }

export function developSketch(options: {
  card: HTMLElement
  img: HTMLImageElement
  canvas: HTMLCanvasElement
  campusKey: string
  registration: SketchRegistration
  lineSrc: string
  colourSrc: string
  objectPosition: string
  /** tokens.css 的 --ivy-paint-sky-rgb；讀不到就不刷天空 */
  skyRgb: string
  /** 'photo'（預設）：照片淡出、線稿由左往右畫出；'sketch'：canvas 上已經是 paintSketchStill 的線稿，直接上色 */
  from?: 'photo' | 'sketch'
  /** false：不上水彩，線稿直接暈開回照片（自動輪播） */
  wash?: boolean
  /** 卡片尺寸（CampusBoard 的 ResizeObserver 快取）；沒給就讀 card.clientWidth／clientHeight */
  size?: () => CardSize | null
  /** 紙色（卡片的 --paper）；沒給就當場讀 */
  paper?: string
}): DevelopHandle {
  const { card, img, canvas, campusKey, registration: reg } = options
  const fromSketch = options.from === 'sketch'
  const washing = options.wash ?? true
  // 從線稿接手時時間軸往後跳，跳過描線
  const skip = fromSketch ? SKETCH_SKIP : 0
  let frame = 0
  let cancelled = false
  let scratch: Scratch | null = null
  let finish: () => void = () => {}
  const done = new Promise<void>((resolve) => { finish = resolve })
  const timers: ReturnType<typeof setTimeout>[] = []
  // 暈開的轉場在遮罩蓋滿照片時（原曲線第 1100ms）就停（2026-11-05，CampusBoard.vue 的 is-develop 樣式）；收尾照舊
  // 在轉場開始後 PHOTO_MS 才做：done 之後輪播才開始算四秒，提早收尾會讓自動輪播的節奏變快。
  const onBloomEnd = (event: TransitionEvent) => {
    if (event.target !== img || !event.propertyName.includes('mask-size')) return
    timers.push(setTimeout(cleanup, Math.max(0, Math.ceil(PHOTO_MS - event.elapsedTime * 1000))))
  }
  const cleanup = () => {
    cancelAnimationFrame(frame)
    timers.forEach(clearTimeout)
    img.removeEventListener('transitionend', onBloomEnd)
    img.style.removeProperty('transition')
    card.classList.remove('is-sketch', 'is-develop', 'is-developed')
    if (scratch) { spareScratch = scratch; scratch = null }
    finish()
  }

  card.classList.remove('is-sketch', 'is-develop', 'is-developed')
  // 線稿已經在 canvas 上：馬上接手蓋住照片，呼叫端再拿掉預覽狀態時照片不會閃出來
  if (fromSketch) card.classList.add('is-sketch')

  void (async () => {
    // 先讓出一幀：手動換校時點擊那一幀（分頁選取、卡片開始滑）先畫出來。from 'sketch' 時上面已經同步掛 is-sketch，
    // 畫布上本來就是預覽線稿，這一幀畫面不變；水彩時間軸從下面的 t0 起算，各幀內容不變。
    await yieldToFrame()
    if (cancelled) return
    // ---------- 尺寸與對位；素材載好才開始（照片這時才淡出），不然第一次會先空白一段 ----------
    const measure = () => sketchGeometry(reg, readSize(card, options.size), options.objectPosition)
    let geometry = measure()
    let line: Layer | null = null, colour: Layer | null = null, bloom = ''
    try {
      for (;;) {
        ;[line, colour, bloom] = await Promise.all([
          sketchLayer(campusKey, LINE_FILTER, options.lineSrc, geometry.lw, geometry.lh),
          washing ? sketchLayer(campusKey, COLOUR_FILTER, options.colourSrc, geometry.lw, geometry.lh) : null,
          bloomMask()
        ])
        const now = measure()
        if (sameGeometry(now, geometry)) break
        geometry = now
      }
    } catch {
      line = null
    }
    if (cancelled) return
    if (!line || (washing && !colour)) { cleanup(); return }

    const surface = sketchSurface(canvas, geometry, line, options.paper || paperOf(card))
    const { ctx, W, H, scale, lx, ly, lw, lh, lineLayer } = surface
    const colourLayer = colour ?? (blank ??= layer(1, 1))
    scratch = takeScratch(W, H)
    const { mask, sky, work } = scratch

    // ---------- 顏料團與天空（快取的多邊形；drawn 是這一次畫到第幾層） ----------
    const plan = washing ? washPlan(campusKey, geometry, Boolean(options.skyRgb)) : null
    const blobs = (plan?.blobs ?? []).map((stroke) => ({ stroke, drawn: 0 }))
    const skies = (plan?.skies ?? []).map((stroke) => ({ stroke, drawn: 0 }))
    // 只重畫變動的那一塊：遮罩描邊 2·scale 寬、轉角是 miter（miterLimit 10），最多凸出頂點 10·scale；再多留 2px 反鋸齒
    const strokeMargin = Math.ceil(10 * scale) + 2, fillMargin = 2

    const t0 = performance.now()
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
    let settled = false
    // 上一次合成時的描線進度；NaN＝還沒合成過（第一幀一定整張畫）
    let shownLine = Number.NaN
    // 合成：整張，或只重畫 rows（[上, 下)，整數）這幾列。只裁上下、左右整列保留：軟體 canvas 縮放畫圖時沿著每一列
    // 逐點累加取樣座標，裁掉左邊會換掉每列的起點，實測某些欄因此差 1–5 階；整列的 clip 每個像素算法和整張畫時一樣。
    const composite = (lineProgress: number, rows: [number, number] | null) => {
      if (rows) {
        for (const c of [ctx, work.ctx]) { c.save(); c.beginPath(); c.rect(0, rows[0], W, rows[1] - rows[0]); c.clip() }
      }
      paintPaper(surface)
      ctx.drawImage(sky.el, 0, 0)
      work.ctx.globalCompositeOperation = 'source-over'
      work.ctx.clearRect(0, 0, W, H)
      work.ctx.drawImage(colourLayer.el, lx, ly, lw, lh)
      work.ctx.globalCompositeOperation = 'destination-in'
      work.ctx.drawImage(mask.el, 0, 0)
      ctx.drawImage(work.el, 0, 0)
      // 線稿由左往右畫出：硬邊後面帶 30% 羽化（同首頁分頁線稿的畫法）
      work.ctx.globalCompositeOperation = 'source-over'
      work.ctx.clearRect(0, 0, W, H)
      work.ctx.drawImage(lineLayer.el, lx, ly, lw, lh)
      if (lineProgress < 1) {
        const edge = lx + lw * (lineProgress * 1.3)
        const gradient = work.ctx.createLinearGradient(edge - lw * 0.3, 0, edge, 0)
        gradient.addColorStop(0, '#000')
        gradient.addColorStop(1, 'rgb(0 0 0 / 0)')
        work.ctx.globalCompositeOperation = 'destination-in'
        work.ctx.fillStyle = gradient
        work.ctx.fillRect(0, 0, W, H)
      }
      ctx.drawImage(work.el, 0, 0)
      paintGrain(surface)
      if (rows) { ctx.restore(); work.ctx.restore() }
    }
    const render = (now: number) => {
      frame = 0
      if (cancelled) return
      const t = now - t0 + skip
      let painting = false
      // 這一幀新筆觸的外接矩形（canvas px）
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      const grow = (boxes: Float64Array, i: number, margin: number) => {
        x0 = Math.min(x0, boxes[i * 4]! - margin)
        y0 = Math.min(y0, boxes[i * 4 + 1]! - margin)
        x1 = Math.max(x1, boxes[i * 4 + 2]! + margin)
        y1 = Math.max(y1, boxes[i * 4 + 3]! + margin)
      }
      // （x 只用來判斷新筆觸是否整個落在畫布外；重畫範圍是整列，見 composite）
      for (const blob of blobs) {
        const { polys, boxes, start } = blob.stroke
        const want = Math.round(Math.min(1, Math.max(0, (t - start) / WASH_MS)) * polys.length)
        if (want < polys.length) painting = true
        for (; blob.drawn < want; blob.drawn++) {
          traceFlat(mask.ctx, polys[blob.drawn]!)
          mask.ctx.fillStyle = 'rgb(0 0 0 / .085)'
          mask.ctx.fill()
          // 外圈描邊＝顏料乾掉時邊緣積色
          if (blob.drawn % 5 === 0) { mask.ctx.strokeStyle = 'rgb(0 0 0 / .16)'; mask.ctx.lineWidth = 2 * scale; mask.ctx.stroke() }
          grow(boxes, blob.drawn, strokeMargin)
        }
      }
      for (const wash of skies) {
        const { polys, boxes, start } = wash.stroke
        const want = Math.round(Math.min(1, Math.max(0, (t - start) / WASH_MS)) * polys.length)
        if (want < polys.length) painting = true
        for (; wash.drawn < want; wash.drawn++) {
          traceFlat(sky.ctx, polys[wash.drawn]!)
          sky.ctx.fillStyle = `rgb(${options.skyRgb} / .045)`
          sky.ctx.fill()
          grow(boxes, wash.drawn, fillMargin)
        }
      }
      const lineProgress = fromSketch ? 1 : easeOut(Math.min(1, t / LINE_MS))

      // 沒有新筆觸、描線進度也沒變：這一幀畫出來和上一幀一樣，不合成（2026-11-05；從線稿接手時約兩成的幀）。
      // 描線進度沒變且已畫完：只重畫新筆觸碰到的那幾列；描線中（從照片畫起的前 1.1 秒）照舊整張。
      const rows: [number, number] = [Math.max(0, Math.floor(y0)), Math.min(H, Math.ceil(y1))]
      const touched = rows[0] < rows[1] && Math.max(0, Math.floor(x0)) < Math.min(W, Math.ceil(x1))
      if (lineProgress !== shownLine) composite(lineProgress, null)
      else if (touched) composite(lineProgress, lineProgress >= 1 ? rows : null)
      shownLine = lineProgress

      settled = !painting && lineProgress >= 1
      if (!settled) frame = requestAnimationFrame(render)
    }
    // 先畫好第一幀（空白紙）再讓照片淡出
    render(t0)
    card.classList.add('is-sketch')

    // ---------- 照片從中央暈開回來 ----------
    timers.push(setTimeout(() => {
      if (cancelled) return
      if (bloom) card.style.setProperty('--develop-mask', `url(${bloom})`)
      img.style.transition = BLOOM_TRANSITION
      card.classList.add('is-develop')
      // 先讓 0% 的遮罩大小生效再換成 468%，轉場才有起點（不靠 rAF：主執行緒忙時 rAF 會被拖好幾百 ms）
      void getComputedStyle(img).getPropertyValue('mask-size')
      void getComputedStyle(img).getPropertyValue('-webkit-mask-size')
      card.classList.add('is-developed')
      img.addEventListener('transitionend', onBloomEnd)
      // 保險：轉場事件沒來（例如分頁在背景）也要收尾
      timers.push(setTimeout(() => { if (!cancelled) cleanup() }, PHOTO_MS + 900))
    }, washing ? PHOTO_AT - skip : BLOOM_ONLY_AT))
  })()

  return {
    done,
    cancel() {
      if (cancelled) return
      cancelled = true
      cleanup()
    }
  }
}
