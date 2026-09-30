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
 */
import { bloomCanvas, grainCanvas, seededRandom, tracePolygon, washPolygons } from './watercolor'

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

const images = new Map<string, Promise<HTMLImageElement>>()
function loadImage(src: string) {
  let pending = images.get(src)
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = src
    })
    images.set(src, pending)
  }
  return pending
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

/** 先把線稿與淡彩層載好（換校前、區塊接近視窗時呼叫），開始畫時就不會先空白一段。 */
export function preloadSketch(lineSrc: string, colourSrc: string) {
  return Promise.all([loadImage(lineSrc), loadImage(colourSrc)]).catch(() => undefined)
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

/** canvas 依卡片尺寸重設大小（會清空）、算線稿框，並把線稿加深一次畫好。靜態線稿與淡彩速寫共用，兩邊的線才一模一樣。 */
function sketchSurface(card: HTMLElement, canvas: HTMLCanvasElement, reg: SketchRegistration, line: HTMLImageElement, objectPosition: string) {
  const cw = card.clientWidth, ch = card.clientHeight
  const scale = sketchScale()
  canvas.width = Math.round(cw * scale)
  canvas.height = Math.round(ch * scale)
  const W = canvas.width, H = canvas.height
  const ctx = canvas.getContext('2d')!
  const box = sketchLayout(reg, cw, ch, objectPosition)
  const lx = box.x * scale, ly = box.y * scale, lw = box.width * scale, lh = box.height * scale
  // 線稿加深一次畫好（逐幀用 ctx.filter 太貴）
  const lineLayer = layer(lw, lh)
  // 先壓暗再拉對比：紙底被推回全白（multiply 不染色），線條變深；順序反過來整張會變灰
  lineLayer.ctx.filter = 'grayscale(1) brightness(.8) contrast(2.4)'
  lineLayer.ctx.drawImage(line, 0, 0, lw, lh)
  grain ??= grainCanvas()
  return {
    ctx, W, H, scale, lx, ly, lw, lh, lineLayer,
    grainPattern: ctx.createPattern(grain, 'repeat'),
    // 紙色讀卡片的 --paper（--ivy-campus-paper），不寫色碼
    paper: getComputedStyle(card).getPropertyValue('--paper').trim()
  }
}
type SketchSurface = ReturnType<typeof sketchSurface>

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

/**
 * 左右預覽卡的靜態線稿（2026-09-29 晚）：就是淡彩速寫描完線、還沒上色的那一幀，換到中央時 developSketch 才接得上。
 * 線稿載好時 wanted() 不成立（例如這張已經換到中央）就不畫；回傳 false＝沒畫，照片照常顯示。
 */
export async function paintSketchStill(options: {
  card: HTMLElement
  canvas: HTMLCanvasElement
  registration: SketchRegistration
  lineSrc: string
  objectPosition: string
  wanted: () => boolean
}) {
  const line = await loadImage(options.lineSrc).catch(() => null)
  if (!line || !options.wanted()) return false
  const surface = sketchSurface(options.card, options.canvas, options.registration, line, options.objectPosition)
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
}): DevelopHandle {
  const { card, img, canvas, campusKey, registration: reg } = options
  const fromSketch = options.from === 'sketch'
  const washing = options.wash ?? true
  // 從線稿接手時時間軸往後跳，跳過描線
  const skip = fromSketch ? SKETCH_SKIP : 0
  let frame = 0
  let cancelled = false
  let finish: () => void = () => {}
  const done = new Promise<void>((resolve) => { finish = resolve })
  const timers: ReturnType<typeof setTimeout>[] = []
  const onBloomEnd = (event: TransitionEvent) => { if (event.target === img && event.propertyName.includes('mask-size')) cleanup() }
  const cleanup = () => {
    cancelAnimationFrame(frame)
    timers.forEach(clearTimeout)
    img.removeEventListener('transitionend', onBloomEnd)
    card.classList.remove('is-sketch', 'is-develop', 'is-developed')
    finish()
  }

  card.classList.remove('is-sketch', 'is-develop', 'is-developed')
  // 線稿已經在 canvas 上：馬上接手蓋住照片，呼叫端再拿掉預覽狀態時照片不會閃出來
  if (fromSketch) card.classList.add('is-sketch')

  void (async () => {
    // 素材載好才開始（照片這時才淡出），不然第一次會先空白一段
    const [line, colour, bloom] = await Promise.all([
      loadImage(options.lineSrc),
      washing ? loadImage(options.colourSrc) : null,
      bloomMask()
    ]).catch(() => [null, null, ''] as const)
    if (cancelled) return
    if (!line || (washing && !colour)) { cleanup(); return }

    // ---------- 尺寸與對位 ----------
    const surface = sketchSurface(card, canvas, reg, line, options.objectPosition)
    const { ctx, W, H, scale, lx, ly, lw, lh, lineLayer } = surface
    // 淡彩層稍微提一點彩度
    const colourLayer = layer(lw, lh)
    colourLayer.ctx.filter = 'saturate(1.2)'
    if (colour) colourLayer.ctx.drawImage(colour, 0, 0, lw, lh)
    const mask = layer(W, H)
    const sky = layer(W, H)
    const scratch = layer(W, H)

    // ---------- 顏料團：從建築中央往外，一團一團滲開 ----------
    const random = seededRandom(campusKey.length * 977 + campusKey.charCodeAt(0))
    const cx = lx + lw * 0.5, cy = ly + lh * 0.55
    const blobs = !washing ? [] : Array.from({ length: 10 }, () => {
      const x = lx + lw * (0.1 + random() * 0.8), y = ly + lh * (0.22 + random() * 0.62)
      const rx = lw * (0.12 + random() * 0.13)
      return { x, y, rx, ry: rx * (0.55 + random() * 0.3) }
    }).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
      .map((blob, i) => ({ ...blob, start: WASH_START + i * WASH_STAGGER, polys: washPolygons(random, blob.x, blob.y, blob.rx, blob.ry, 22), drawn: 0 }))
    // 天空：兩團很淡的天藍，淡彩速寫常見的「隨手刷一筆天」
    const skies = (washing && options.skyRgb ? [0.3, 0.72] : []).map((fx, i) => ({
      start: WASH_START + 400 + i * 200,
      polys: washPolygons(random, lx + lw * fx, ly + lh * 0.14, lw * 0.26, lh * 0.12, 18),
      drawn: 0
    }))

    const t0 = performance.now()
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
    let settled = false
    const render = (now: number) => {
      frame = 0
      if (cancelled) return
      const t = now - t0 + skip
      let painting = false
      for (const blob of blobs) {
        const want = Math.round(Math.min(1, Math.max(0, (t - blob.start) / WASH_MS)) * blob.polys.length)
        if (want < blob.polys.length) painting = true
        for (; blob.drawn < want; blob.drawn++) {
          tracePolygon(mask.ctx, blob.polys[blob.drawn]!)
          mask.ctx.fillStyle = 'rgb(0 0 0 / .085)'
          mask.ctx.fill()
          // 外圈描邊＝顏料乾掉時邊緣積色
          if (blob.drawn % 5 === 0) { mask.ctx.strokeStyle = 'rgb(0 0 0 / .16)'; mask.ctx.lineWidth = 2 * scale; mask.ctx.stroke() }
        }
      }
      for (const wash of skies) {
        const want = Math.round(Math.min(1, Math.max(0, (t - wash.start) / WASH_MS)) * wash.polys.length)
        if (want < wash.polys.length) painting = true
        for (; wash.drawn < want; wash.drawn++) {
          tracePolygon(sky.ctx, wash.polys[wash.drawn]!)
          sky.ctx.fillStyle = `rgb(${options.skyRgb} / .045)`
          sky.ctx.fill()
        }
      }
      const lineProgress = fromSketch ? 1 : easeOut(Math.min(1, t / LINE_MS))

      paintPaper(surface)
      ctx.drawImage(sky.el, 0, 0)
      scratch.ctx.globalCompositeOperation = 'source-over'
      scratch.ctx.clearRect(0, 0, W, H)
      scratch.ctx.drawImage(colourLayer.el, lx, ly, lw, lh)
      scratch.ctx.globalCompositeOperation = 'destination-in'
      scratch.ctx.drawImage(mask.el, 0, 0)
      ctx.drawImage(scratch.el, 0, 0)
      // 線稿由左往右畫出：硬邊後面帶 30% 羽化（同首頁分頁線稿的畫法）
      scratch.ctx.globalCompositeOperation = 'source-over'
      scratch.ctx.clearRect(0, 0, W, H)
      scratch.ctx.drawImage(lineLayer.el, lx, ly, lw, lh)
      if (lineProgress < 1) {
        const edge = lx + lw * (lineProgress * 1.3)
        const gradient = scratch.ctx.createLinearGradient(edge - lw * 0.3, 0, edge, 0)
        gradient.addColorStop(0, '#000')
        gradient.addColorStop(1, 'rgb(0 0 0 / 0)')
        scratch.ctx.globalCompositeOperation = 'destination-in'
        scratch.ctx.fillStyle = gradient
        scratch.ctx.fillRect(0, 0, W, H)
      }
      ctx.drawImage(scratch.el, 0, 0)
      paintGrain(surface)

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
      card.classList.add('is-develop')
      // 先讓 0% 的遮罩大小生效再換成 520%，轉場才有起點（不靠 rAF：主執行緒忙時 rAF 會被拖好幾百 ms）
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
