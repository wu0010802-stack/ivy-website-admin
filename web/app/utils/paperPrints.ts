/**
 * 「孩子的一天」拍立得的 WebGL 紙張版（比稿 R，2026-09-18；2026-09-21 併進 Nuxt）。
 *
 * DOM 卡片（DayMomentCard.vue）照舊負責版面、鍵盤、aria、inert 與
 * `webgl-ready` class（要走 Vue 的 :class，手動 classList 會被 patch 蓋掉）；這裡只是
 * 把正反面畫成貼圖、貼到一張會彎曲、抬升、翻面的紙上，蓋在 DOM 卡片上方。
 * 和 design/day-timeline-directions/round8.js 的差異：
 *
 * - 整頁只開一個 WebGL context（共用 renderer），每張卡自己的 <canvas> 是
 *   2D 的，渲染完再 drawImage 複製過去；R 的六個 context 在低階裝置吃力。
 * - 貼圖的字型、顏色、字級、版位都從 DOM 的 computed style 與 rect 取，
 *   不寫死 hex；DOM 卡片雖然 opacity:0 但仍有版面，所以位置是真的。
 * - 減少動態、無 WebGL、three 載入失敗：回傳 null，元件維持 CSS 3D 版。
 * - 翻面（2026-09-23）：永遠右緣掀起往左翻（printFlip.ts），紙張依轉速做單側懸臂彎曲、
 *   停下時遠端輕輕回彈；紙膠帶畫進貼圖，跟著紙一起翻，不再停在原位。
 */
import type * as ThreeNS from 'three'
import { FLIP_MS, cantilever, flipEase, restTurn, stepFlex, turnTarget, type FlexState } from './printFlip'

type Three = typeof ThreeNS

export interface PaperCopy {
  kicker: string
  titleLines: string[]
  time: string
  story: string
  question: string
  answer: string
}

export interface PaperHandle {
  setFlipped(flipped: boolean): void
  setRevealed(): void
  setActive(active: boolean): void
  pointerMove(clientX: number, clientY: number): void
  pointerLeave(): void
  /** 右下折角的邊長（px），跟 DOM 的 `--ear` 同步；貼圖在該處挖空露出後方地板。 */
  setEar(px: number): void
  /** 首張進場「偷看」：向左微翻再回正，一次。 */
  peek(): void
  dispose(): void
}

const MARGIN = 70 // 四周留給彎曲與抬升
const EAR_DEFAULT = 32
// 翻面手感：立起時抬升、下緣（折角那側）先起來一點；抬得越高影子越淡越散。
const LIFT = 36
const FLIP_TILT = 0.08
const FLEX_GAIN = 0.024 // 每秒半圈的轉速 → 遠端落後紙寬的比例
const FLEX_MAX = 0.09
const SHADOW_OPACITY = 0.28
const SHADOW_RADIUS = 6
// 首張偷看：與 styles.css 的 card-peek 同參數（12°、1 秒）
const PEEK_MS = 1000
const PEEK_TURN = 12 / 180
// 手機顯影縮到 1 秒內，與 styles.css 的 .print-photo 手機 transition 對齊。
const DEVELOP_MS = 3200
const DEVELOP_MS_MOBILE = 900
const developMs = () => (window.matchMedia('(max-width: 760px)').matches ? DEVELOP_MS_MOBILE : DEVELOP_MS)
const SEGMENTS = 28
// 3× 手機也維持原生像素密度；renderer、畫面與紙面貼圖使用同一比例。
const paperPixelRatio = () => Math.min(window.devicePixelRatio || 1, 3)

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

let threePromise: Promise<Three | null> | null = null
let shared: { renderer: ThreeNS.WebGLRenderer; three: Three; users: number } | null = null

function canUseWebGL(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  if (!('WebGLRenderingContext' in window)) return false
  try {
    const probe = document.createElement('canvas')
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'))
  } catch {
    return false
  }
}

function loadThree(): Promise<Three | null> {
  if (!threePromise) {
    threePromise = import('three').then(
      (mod) => mod as unknown as Three,
      () => null
    )
  }
  return threePromise
}

function acquireRenderer(three: Three) {
  if (!shared) {
    const renderer = new three.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(paperPixelRatio())
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = three.PCFShadowMap
    shared = { renderer, three, users: 0 }
  }
  shared.users += 1
  return shared.renderer
}

function releaseRenderer() {
  if (!shared) return
  shared.users -= 1
  if (shared.users <= 0) {
    shared.renderer.dispose()
    shared = null
  }
}

// ---- 讀 DOM 樣式，讓貼圖跟 CSS 同一套 token ----

function fontOf(el: Element | null, fallback: string): string {
  if (!el) return fallback
  const cs = getComputedStyle(el)
  return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
}

function colorOf(el: Element | null, prop: 'color' | 'backgroundColor', fallback: string): string {
  if (!el) return fallback
  const value = getComputedStyle(el)[prop]
  return value && value !== 'rgba(0, 0, 0, 0)' ? value : fallback
}

function pxOf(el: Element | null, prop: 'fontSize' | 'lineHeight', fallback: number): number {
  if (!el) return fallback
  const n = parseFloat(getComputedStyle(el)[prop])
  return Number.isFinite(n) ? n : fallback
}

function setFill(ctx: CanvasRenderingContext2D, value: string, fallback: string) {
  ctx.fillStyle = fallback
  ctx.fillStyle = value
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    let line = ''
    for (const ch of raw) {
      if (line && ctx.measureText(line + ch).width > max) {
        out.push(line)
        line = ch
      } else {
        line += ch
      }
    }
    out.push(line)
  }
  return out
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

// scale：版面寬／外框寬，抵銷祖先元素的縮放，讓位置跟 offsetWidth 同一套單位。
function boxIn(el: Element | null, origin: DOMRect, scale = 1): Box | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: (r.left - origin.left) * scale, y: (r.top - origin.top) * scale, w: r.width * scale, h: r.height * scale }
}

// CSS 的 rotate 屬性（例如 "-4deg"）轉成弧度；沒有旋轉回 0。
function angleOf(el: Element | null): number {
  if (!el) return 0
  const value = getComputedStyle(el).rotate.trim().split(/\s+/).at(-1) ?? ''
  const n = Number.parseFloat(value)
  if (!Number.isFinite(n)) return 0
  if (value.endsWith('rad')) return n
  if (value.endsWith('turn')) return n * Math.PI * 2
  if (value.endsWith('grad')) return (n * Math.PI) / 200
  return (n * Math.PI) / 180
}

// clip-path: polygon(…) 轉成元素局部座標；讀不到就用整個矩形。
function polygonOf(el: Element, w: number, h: number): Array<[number, number]> {
  const rect: Array<[number, number]> = [[0, 0], [w, 0], [w, h], [0, h]]
  const match = /^polygon\((.*)\)$/.exec(getComputedStyle(el).clipPath.trim())
  if (!match) return rect
  const points = match[1]!
    .split(',')
    .map((pair) => pair.trim().split(/\s+/))
    .filter((pair) => pair.length === 2)
    .map((pair) => pair.map((v, i) => (v.endsWith('%') ? (Number.parseFloat(v) / 100) * (i ? h : w) : Number.parseFloat(v))) as [number, number])
  return points.length >= 3 && points.every((p) => p.every(Number.isFinite)) ? points : rect
}

// 把 CSS 自訂屬性（可能是 color-mix）解析成 canvas 認得的顏色。
function resolveColor(host: Element, value: string, fallback: string): string {
  const probe = document.createElement('span')
  probe.style.color = value
  host.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color || fallback
}

// 第一個 box-shadow 的顏色。
function shadowColorOf(el: Element, fallback: string): string {
  const match = /(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^()]*\)|#[0-9a-f]{3,8}\b/i.exec(getComputedStyle(el).boxShadow)
  return match?.[0] ?? fallback
}

// 可能在 CSS 已翻到背面後才初始化。量測紙面局部位置時先排除所有旋轉：紙張的翻轉
// （否則正面的標籤與時間戳會左右鏡像）、整張卡片與紙膠帶的 rotate、手寫標題的微斜
// （否則量到旋轉後的外框，卡片 -2.2° 會讓紙大約 5% 並往右下偏）。同一個同步工作內還原。
function measureFlatPrint<T>(wrap: HTMLElement, read: () => T): T {
  const unturn = { transition: 'none', animation: 'none', transform: 'none' }
  const unrotate = { rotate: 'none' }
  const targets: Array<[HTMLElement | null, Record<string, string>]> = [
    [wrap.querySelector<HTMLElement>('.print'), unturn],
    [wrap.querySelector<HTMLElement>('.print-back'), unturn],
    [wrap.closest<HTMLElement>('.print-card'), unrotate],
    [wrap.querySelector<HTMLElement>('.print-tape'), unrotate],
    [wrap.querySelector<HTMLElement>('.print-foot h3'), unrotate]
  ]
  const saved = targets.flatMap(([element, props]) => element ? [{ element, props, style: element.getAttribute('style') }] : [])
  try {
    for (const { element, props } of saved) {
      for (const [prop, value] of Object.entries(props)) element.style.setProperty(prop, value, 'important')
    }
    return read()
  } finally {
    for (const { element, style } of saved) {
      if (style === null) element.removeAttribute('style')
      else element.setAttribute('style', style)
    }
  }
}

async function waitImage(img: HTMLImageElement): Promise<HTMLImageElement> {
  if (img.complete && img.naturalWidth) return img
  await new Promise<void>((resolve) => {
    img.addEventListener('load', () => resolve(), { once: true })
    img.addEventListener('error', () => resolve(), { once: true })
  })
  return img
}

// ---- 主入口 ----

export async function mountPaper(
  wrap: HTMLElement,
  copy: PaperCopy,
  initial: { developed?: boolean; flipped?: boolean; canMount?: () => boolean } = {}
): Promise<PaperHandle | null> {
  if (initial.canMount && !initial.canMount()) return null
  if (!canUseWebGL()) return null
  const loadedThree = await loadThree()
  if (!loadedThree) return null
  const three: Three = loadedThree
  if (!wrap.isConnected) return null

  const front = wrap.querySelector<HTMLElement>('.print-front')
  const back = wrap.querySelector<HTMLElement>('.print-back')
  const img = wrap.querySelector<HTMLImageElement>('.print-photo')
  if (!front || !back || !img) return null
  await waitImage(img)
  if (!wrap.isConnected || !img.naturalWidth) return null
  try {
    await document.fonts.ready
  } catch {
    /* 沒有 FontFaceSet 也照畫 */
  }
  // import／圖片／字型等待期間可能又開始滑動或離頁，避免此時建立場景。
  if (!wrap.isConnected || (initial.canMount && !initial.canMount())) return null

  const DPR = paperPixelRatio()
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)')
  const renderer = acquireRenderer(three)

  // 元件狀態（由 DayMomentCard 透過 handle 餵進來）
  let flipped = initial.flipped ?? false
  let revealed = initial.developed ?? false
  let active = false
  let earPx = Number.parseFloat(getComputedStyle(wrap).getPropertyValue('--ear')) || EAR_DEFAULT
  let disposed = false

  // 每次尺寸變動就整組重建（貼圖尺寸與幾何都綁著像素寬）
  let scene: ReturnType<typeof buildScene> | null = null
  let resizeFrame = 0
  let lastWidth = 0

  const view = document.createElement('canvas')
  view.className = 'paper-view'
  view.setAttribute('aria-hidden', 'true')
  wrap.append(view)
  const viewCtx = view.getContext('2d')
  if (!viewCtx) {
    view.remove()
    releaseRenderer()
    return null
  }

  function buildScene() {
    const tapeEl = wrap.querySelector<HTMLElement>('.print-tape')
    // 旋轉角要在 measureFlatPrint 拿掉 rotate 之前讀
    const tapeAngle = angleOf(tapeEl)
    const titleAngle = angleOf(front!.querySelector('.print-foot h3'))
    const { W, H, style, box } = measureFlatPrint(wrap, () => {
      const frontRect = front!.getBoundingClientRect()
      // 用版面尺寸，不用外框：外框會吃進祖先的 rotate／scale
      const W = front!.offsetWidth
      const H = front!.offsetHeight
      const k = frontRect.width ? W / frontRect.width : 1
      // 版位與樣式全部從 DOM 取
      const figure = front!.querySelector('.print-figure')
      const stamp = front!.querySelector('.print-stamp')
      const kickerEl = front!.querySelector('.print-kicker')
      const titleEl = front!.querySelector('h3')
      const backKicker = back!.querySelector('.print-kicker')
      const storyEl = back!.querySelector('.print-story')
      const askEl = back!.querySelector('.print-ask')
      const questionEl = back!.querySelector('.print-question')
      const answerEl = back!.querySelector('.print-answer')
      const earEl = front!.querySelector<HTMLElement>('.print-ear')
      const backRect = back!.getBoundingClientRect()

      const style = {
        frontBg: colorOf(front, 'backgroundColor', '#fffdf7'),
        backBg: colorOf(back, 'backgroundColor', '#fff6df'),
        figureBg: colorOf(figure, 'backgroundColor', '#e8e2d2'),
        lineColor: 'rgb(32 64 47 / .07)',
        earLineColor: earEl ? getComputedStyle(earEl).color : getComputedStyle(front!).color,
        earShadow: getComputedStyle(wrap).getPropertyValue('--print-ear-shadow').trim(),
        stampFont: fontOf(stamp, "400 22px 'Source Sans 3', sans-serif"),
        stampColor: colorOf(stamp, 'color', '#ffb347'),
        kickerFont: fontOf(kickerEl, "400 10px 'PingFang TC', sans-serif"),
        kickerColor: colorOf(kickerEl, 'color', '#7a8570'),
        titleFont: fontOf(titleEl, "700 22px 'LINE Seed TW', 'PingFang TC', sans-serif"),
        titleColor: colorOf(titleEl, 'color', '#203f32'),
        titleLine: pxOf(titleEl, 'lineHeight', 32),
        storyFont: fontOf(storyEl, "400 15px 'PingFang TC', sans-serif"),
        storyColor: colorOf(storyEl, 'color', '#3f5045'),
        storyLine: pxOf(storyEl, 'lineHeight', 31),
        questionFont: fontOf(questionEl, "600 13px 'PingFang TC', sans-serif"),
        questionColor: colorOf(questionEl, 'color', '#203f32'),
        questionLine: pxOf(questionEl, 'lineHeight', 22),
        answerFont: fontOf(answerEl, "400 13px 'PingFang TC', sans-serif"),
        answerColor: colorOf(answerEl, 'color', '#6e7c5b'),
        answerLine: pxOf(answerEl, 'lineHeight', 25),
        tapeA: tapeEl ? resolveColor(tapeEl, 'var(--tape-a)', '#f6e7ae') : '',
        tapeB: tapeEl ? resolveColor(tapeEl, 'var(--tape-b)', '#fbf3d6') : '',
        tapeShadow: tapeEl ? shadowColorOf(tapeEl, 'rgba(32,64,47,.15)') : ''
      }
      const tapeBox = boxIn(tapeEl, frontRect, k)
      const box = {
        figure: boxIn(figure, frontRect, k) ?? { x: W * 0.08, y: W * 0.08, w: W * 0.84, h: W * 0.84 },
        stamp: boxIn(stamp, frontRect, k),
        kicker: boxIn(kickerEl, frontRect, k),
        title: boxIn(titleEl, frontRect, k),
        backKicker: boxIn(backKicker, backRect, k),
        story: boxIn(storyEl, backRect, k),
        ask: boxIn(askEl, backRect, k),
        question: boxIn(questionEl, backRect, k),
        answer: boxIn(answerEl, backRect, k),
        tape: tapeBox && tapeEl ? { ...tapeBox, poly: polygonOf(tapeEl, tapeBox.w, tapeBox.h) } : null
      }

      return { W, H, style, box }
    })
    if (!W || !H) return null
    // 紙膠帶有一截超出紙的上緣：網格與貼圖往上多留一條透明帶（TOP），
    // 讓膠帶畫在同一張紙上一起翻。取整到實體像素，照片的像素對齊清除才不會錯半格。
    const tape = box.tape
    let tapeTop = 0
    if (tape) {
      const cx = tape.x + tape.w / 2
      const cy = tape.y + tape.h / 2
      const sin = Math.sin(tapeAngle)
      const cos = Math.cos(tapeAngle)
      for (const [px, py] of tape.poly) {
        const y = cy + (px - tape.w / 2) * sin + (py - tape.h / 2) * cos
        tapeTop = Math.max(tapeTop, -y)
      }
    }
    const TOP = tapeTop > 0 ? Math.ceil((tapeTop + 4) * DPR) / DPR : 0
    const VW = W + MARGIN * 2
    const VH = H + MARGIN * 2

    view.width = VW * DPR
    view.height = VH * DPR
    view.style.width = `${VW}px`
    view.style.height = `${VH}px`
    view.style.left = `${-MARGIN}px`
    view.style.top = `${-MARGIN}px`

    const frontCanvas = document.createElement('canvas')
    const backCanvas = document.createElement('canvas')
    frontCanvas.width = backCanvas.width = Math.round(W * DPR)
    frontCanvas.height = backCanvas.height = Math.round((H + TOP) * DPR)
    const fctx = frontCanvas.getContext('2d')!
    const bctx = backCanvas.getContext('2d')!
    // 支援時用高品質縮圖；不支援的瀏覽器沿用原生平滑取樣。
    if ('imageSmoothingQuality' in fctx) fctx.imageSmoothingQuality = 'high'
    // 紙面座標：原點在紙的左上角，上方留給膠帶的透明帶
    const paperSpace = (ctx: CanvasRenderingContext2D) => ctx.setTransform(DPR, 0, 0, DPR, 0, TOP * DPR)
    const clearAll = (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      paperSpace(ctx)
    }

    // 折角缺口：正面挖右下、背面挖左下（背面幾何繞 Y 轉 180°，左下才會落在觀者右下）
    function cutEar(ctx: CanvasRenderingContext2D, side: 'right' | 'left') {
      if (earPx <= 0) return
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.beginPath()
      if (side === 'right') {
        ctx.moveTo(W, H - earPx)
        ctx.lineTo(W, H)
        ctx.lineTo(W - earPx, H)
      } else {
        ctx.moveTo(0, H - earPx)
        ctx.lineTo(earPx, H)
        ctx.lineTo(0, H)
      }
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    // 折角直接畫在紙面貼圖上，隨同一張 mesh 彎曲、旋轉，不留固定 DOM 浮層。
    function drawEar(ctx: CanvasRenderingContext2D, side: 'right' | 'left') {
      if (earPx <= 0) return
      const e = earPx
      ctx.save()
      ctx.translate(side === 'right' ? W - e : e, H - e)
      if (side === 'left') ctx.scale(-1, 1)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.quadraticCurveTo(e * 0.48, e * 0.07, e, 0)
      ctx.lineTo(0, e)
      ctx.quadraticCurveTo(e * 0.07, e * 0.48, 0, 0)
      ctx.closePath()
      ctx.shadowColor = style.earShadow
      ctx.shadowBlur = 2
      ctx.shadowOffsetX = -1
      ctx.shadowOffsetY = -1
      setFill(ctx, side === 'right' ? style.backBg : style.frontBg, style.frontBg)
      ctx.fill()
      ctx.shadowColor = 'transparent'
      if (side === 'right') {
        ctx.clip()
        ctx.strokeStyle = style.earLineColor
        ctx.lineWidth = 0.65
        for (let y = e * 0.21; y < e; y += e * 0.21) {
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(e - y, y)
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    function drawFrontBase() {
      const ctx = fctx
      clearAll(ctx)
      setFill(ctx, style.frontBg, '#fffdf7')
      ctx.fillRect(0, 0, W, H)
      // 編號小標與手寫標題
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      const k = box.kicker
      if (k) {
        setFill(ctx, style.kickerColor, '#7a8570')
        ctx.font = style.kickerFont
        ctx.fillText(copy.kicker, k.x, k.y + k.h * 0.78)
      }
      const t = box.title
      if (t) {
        // 跟 CSS 一樣繞標題中心轉（t 是拿掉 rotate 後量的框）
        ctx.save()
        ctx.translate(t.x + t.w / 2, t.y + t.h / 2)
        ctx.rotate(titleAngle)
        ctx.translate(-t.w / 2, -t.h / 2)
        setFill(ctx, style.titleColor, '#203f32')
        ctx.font = style.titleFont
        let y = style.titleLine * 0.76
        for (const line of copy.titleLines) {
          ctx.fillText(line, 0, y)
          y += style.titleLine
        }
        ctx.restore()
      }
      drawTape(ctx, 'front')
    }

    // 紙膠帶：照 CSS 的 rotate、clip-path 與 repeating-linear-gradient(45deg, a 0 6px, b 6px 12px) 重畫。
    // 背面只看得到超出紙緣的那一截（黏在正面的部分被紙擋住），左右相反、蒙一層紙色當作膠面。
    function drawTape(ctx: CanvasRenderingContext2D, side: 'front' | 'back') {
      if (!tape || !TOP) return
      ctx.save()
      if (side === 'back') {
        ctx.beginPath()
        ctx.rect(0, -TOP, W, TOP)
        ctx.clip()
        ctx.translate(W, 0)
        ctx.scale(-1, 1)
      }
      ctx.translate(tape.x + tape.w / 2, tape.y + tape.h / 2)
      ctx.rotate(tapeAngle)
      ctx.translate(-tape.w / 2, -tape.h / 2)
      ctx.beginPath()
      tape.poly.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
      ctx.closePath()
      if (side === 'front') {
        ctx.shadowColor = style.tapeShadow
        ctx.shadowBlur = 2 * DPR
        ctx.shadowOffsetY = DPR
      }
      setFill(ctx, style.tapeA, '#f6e7ae')
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.clip()
      const length = (tape.w + tape.h) * Math.SQRT1_2
      ctx.translate(tape.w / 2, tape.h / 2)
      ctx.rotate(-Math.PI / 4)
      setFill(ctx, style.tapeB, '#fbf3d6')
      for (let s = -length / 2 + 6; s < length / 2; s += 12) ctx.fillRect(s, -length, 6, length * 2)
      if (side === 'back') {
        ctx.globalAlpha = 0.22
        setFill(ctx, style.backBg, '#fff6df')
        ctx.fillRect(-length, -length, length * 2, length * 2)
      }
      ctx.restore()
    }

    // 紙底與標題不隨顯影改變，只在建場／寬度改變時繪製一次。
    // 每幀只更新照片框，保留原本的濾鏡、說明籤與時間戳顯影。
    function drawPhoto(develop: number, isActive: boolean) {
      const ctx = fctx
      paperSpace(ctx)
      const f = box.figure
      // 清除對齊實體像素的照片範圍，避免小數邊界疊畫後殘留上一幀。
      const x = Math.floor(f.x * DPR) / DPR
      const y = Math.floor(f.y * DPR) / DPR
      const w = Math.ceil((f.x + f.w) * DPR) / DPR - x
      const h = Math.ceil((f.y + f.h) * DPR) / DPR - y
      ctx.clearRect(x, y, w, h)
      setFill(ctx, style.frontBg, '#fffdf7')
      ctx.fillRect(x, y, w, h)
      setFill(ctx, style.figureBg, '#e8e2d2')
      ctx.fillRect(f.x, f.y, f.w, f.h)
      // 照片顯影：從糊、淡、偏黃慢慢到清楚（跟 .print-photo 的 CSS 同參數）
      const cover = Math.max(f.w / img!.naturalWidth, f.h / img!.naturalHeight)
      const dw = img!.naturalWidth * cover
      const dh = img!.naturalHeight * cover
      ctx.save()
      ctx.beginPath()
      ctx.rect(f.x, f.y, f.w, f.h)
      ctx.clip()
      const d = develop
      ctx.filter =
        d >= 1
          ? 'none'
          : `sepia(${(1 - d) * 0.55}) contrast(${0.28 + 0.72 * d}) brightness(${1.55 - 0.55 * d}) saturate(${0.35 + 0.65 * d}) blur(${(1 - d) * 2.5}px)`
      ctx.globalAlpha = 0.28 + 0.72 * d
      ctx.drawImage(img!, f.x + (f.w - dw) / 2, f.y + (f.h - dh) * 0.4, dw, dh)
      ctx.filter = 'none'
      ctx.globalAlpha = 1
      if (d < 1) {
        ctx.fillStyle = `rgba(226,233,231,${(1 - d) * 0.8})`
        ctx.fillRect(f.x, f.y, f.w, f.h)
      }
      const gloss = ctx.createLinearGradient(f.x, f.y, f.x + f.w * 0.6, f.y + f.h)
      gloss.addColorStop(0, 'rgba(255,255,255,.18)')
      gloss.addColorStop(0.4, 'rgba(255,255,255,0)')
      ctx.fillStyle = gloss
      ctx.fillRect(f.x, f.y, f.w, f.h)
      // 橘色時間戳：顯影到六成後浮現，停在該段時再亮一階
      const stampAlpha = Math.max(0, (d - 0.6) / 0.4) * (isActive ? 1 : 0.85)
      const st = box.stamp
      if (stampAlpha > 0 && st) {
        ctx.save()
        ctx.globalAlpha = stampAlpha
        ctx.font = style.stampFont
        ctx.textAlign = 'right'
        ctx.textBaseline = 'alphabetic'
        setFill(ctx, style.stampColor, '#ffb347')
        ctx.shadowColor = 'rgba(255,138,0,.75)'
        ctx.shadowBlur = 6
        ctx.transform(1, 0, -0.105, 1, 0, 0)
        const baseline = st.y + st.h * 0.82
        ctx.fillText(copy.time, st.x + st.w + baseline * 0.105, baseline)
        ctx.restore()
      }
      ctx.restore()
      ctx.strokeStyle = 'rgba(0,0,0,.08)'
      ctx.lineWidth = 1
      ctx.strokeRect(f.x + 0.5, f.y + 0.5, f.w - 1, f.h - 1)
    }

    function drawBack() {
      const ctx = bctx
      clearAll(ctx)
      setFill(ctx, style.backBg, '#fff6df')
      ctx.fillRect(0, 0, W, H)
      ctx.strokeStyle = style.lineColor
      ctx.lineWidth = 1
      for (let y = 31.5; y < H; y += 32) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
        ctx.stroke()
      }
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      const bk = box.backKicker
      if (bk) {
        setFill(ctx, style.kickerColor, '#6e7c5b')
        ctx.font = style.kickerFont
        ctx.fillText(copy.kicker, bk.x, bk.y + bk.h * 0.78)
      }
      const s = box.story
      if (s) {
        setFill(ctx, style.storyColor, '#3f5045')
        ctx.font = style.storyFont
        let y = s.y + style.storyLine * 0.72
        for (const line of wrapLines(ctx, copy.story, s.w)) {
          ctx.fillText(line, s.x, y)
          y += style.storyLine
        }
      }
      const a = box.ask
      if (a) {
        ctx.setLineDash([3, 4])
        ctx.strokeStyle = 'rgba(32,63,50,.25)'
        ctx.beginPath()
        ctx.moveTo(a.x, a.y + 0.5)
        ctx.lineTo(a.x + a.w, a.y + 0.5)
        ctx.stroke()
        ctx.setLineDash([])
      }
      const q = box.question
      if (q) {
        setFill(ctx, style.questionColor, '#203f32')
        ctx.font = style.questionFont
        let y = q.y + style.questionLine * 0.72
        for (const line of wrapLines(ctx, copy.question, q.w)) {
          ctx.fillText(line, q.x, y)
          y += style.questionLine
        }
      }
      const an = box.answer
      if (an) {
        setFill(ctx, style.answerColor, '#6e7c5b')
        ctx.font = style.answerFont
        let y = an.y + style.answerLine * 0.72
        for (const line of wrapLines(ctx, copy.answer, an.w)) {
          ctx.fillText(line, an.x, y)
          y += style.answerLine
        }
      }
      drawTape(ctx, 'back')
    }

    // 掀角只改缺口：快取未裁切的小塊底角，不重畫照片、故事與換行量測。
    // 連同折角陰影保留一圈底色，縮小時不留下上一幀的痕跡。
    const frontCorner = document.createElement('canvas')
    const backCorner = document.createElement('canvas')
    const frontCornerCtx = frontCorner.getContext('2d')!
    const backCornerCtx = backCorner.getContext('2d')!
    let cornerPixels = 0

    function restoreCorner(ctx: CanvasRenderingContext2D, corner: HTMLCanvasElement, side: 'right' | 'left') {
      if (!cornerPixels) return
      const x = side === 'right' ? ctx.canvas.width - cornerPixels : 0
      const y = ctx.canvas.height - cornerPixels
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(x, y, cornerPixels, cornerPixels)
      ctx.drawImage(corner, x, y)
      paperSpace(ctx)
    }

    function updateTextures(photoChanged = false) {
      restoreCorner(fctx, frontCorner, 'right')
      restoreCorner(bctx, backCorner, 'left')
      if (photoChanged) drawPhoto(develop, active)
      const nextPixels = Math.min(frontCanvas.width, frontCanvas.height, Math.ceil((Math.max(earPx, EAR_DEFAULT) + 6) * DPR))
      const grew = nextPixels > cornerPixels
      if (grew) {
        cornerPixels = nextPixels
        frontCorner.width = frontCorner.height = backCorner.width = backCorner.height = cornerPixels
      }
      if (grew || photoChanged) {
        frontCornerCtx.clearRect(0, 0, cornerPixels, cornerPixels)
        frontCornerCtx.drawImage(frontCanvas, frontCanvas.width - cornerPixels, frontCanvas.height - cornerPixels, cornerPixels, cornerPixels, 0, 0, cornerPixels, cornerPixels)
      }
      if (grew) {
        backCornerCtx.clearRect(0, 0, cornerPixels, cornerPixels)
        backCornerCtx.drawImage(backCanvas, 0, backCanvas.height - cornerPixels, cornerPixels, cornerPixels, 0, 0, cornerPixels, cornerPixels)
      }
      cutEar(fctx, 'right')
      cutEar(bctx, 'left')
      drawEar(fctx, 'right')
      drawEar(bctx, 'left')
    }

    let develop = revealed ? 1 : 0
    drawFrontBase()
    drawPhoto(develop, active)
    drawBack()
    updateTextures()
    const frontTex = new three.CanvasTexture(frontCanvas)
    const backTex = new three.CanvasTexture(backCanvas)
    frontTex.colorSpace = backTex.colorSpace = three.SRGBColorSpace
    frontTex.anisotropy = backTex.anisotropy = 4

    const sceneObj = new three.Scene()
    const fov = 24
    const dist = VH / 2 / Math.tan(three.MathUtils.degToRad(fov / 2))
    const camera = new three.PerspectiveCamera(fov, VW / VH, 10, dist * 3)
    camera.position.z = dist

    // 網格往上多一條膠帶帶（TOP），再平移讓紙的中心留在原點，翻轉軸不變
    const geoF = new three.PlaneGeometry(W, H + TOP, SEGMENTS, SEGMENTS)
    const geoB = new three.PlaneGeometry(W, H + TOP, SEGMENTS, SEGMENTS)
    geoF.translate(0, TOP / 2, 0)
    geoB.translate(0, TOP / 2, 0)
    // alphaTest 讓折角缺口與膠帶外緣硬邊透空，不走透明排序
    const matF = new three.MeshStandardMaterial({ map: frontTex, roughness: 0.62, metalness: 0, alphaTest: 0.5 })
    const matB = new three.MeshStandardMaterial({ map: backTex, roughness: 0.8, metalness: 0, alphaTest: 0.5 })
    const meshF = new three.Mesh(geoF, matF)
    const meshB = new three.Mesh(geoB, matB)
    meshB.rotation.y = Math.PI
    meshF.castShadow = meshB.castShadow = true
    const paper = new three.Group()
    paper.add(meshF, meshB)
    sceneObj.add(paper)
    // 後面一片地板接影子，抬起時影子位移、變淡、變散，才讀得出高度。
    // 紙翻到一半時有半邊會穿到 z=-26 後面；地板若照深度蓋上去，被蓋住的半邊疊上自己的影子，
    // 看起來像多一道摺痕。所以地板排進不透明佇列最先畫、不寫也不比深度，紙永遠畫在它上面。
    const shadowMat = new three.ShadowMaterial({ opacity: SHADOW_OPACITY, depthWrite: false, depthTest: false })
    shadowMat.transparent = false
    shadowMat.blending = three.CustomBlending
    shadowMat.blendSrc = three.SrcAlphaFactor
    shadowMat.blendDst = three.OneMinusSrcAlphaFactor
    shadowMat.blendSrcAlpha = three.OneFactor
    shadowMat.blendDstAlpha = three.OneMinusSrcAlphaFactor
    const floor = new three.Mesh(new three.PlaneGeometry(VW * 2, VH * 2), shadowMat)
    floor.position.z = -26
    floor.renderOrder = -1
    floor.receiveShadow = true
    sceneObj.add(floor)
    sceneObj.add(new three.AmbientLight(0xffffff, 1.35))
    const key = new three.DirectionalLight(0xfff4e0, 1.6)
    key.position.set(W * 0.6, H * 0.9, dist * 0.7)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.left = -VW
    key.shadow.camera.right = VW
    key.shadow.camera.top = VH
    key.shadow.camera.bottom = -VH
    key.shadow.camera.far = dist * 2
    key.shadow.radius = SHADOW_RADIUS
    sceneObj.add(key)
    const glare = new three.PointLight(0xffffff, 0, dist * 1.5, 1.4)
    glare.position.z = dist * 0.35
    sceneObj.add(glare)

    const base = Float32Array.from(geoF.attributes.position!.array as ArrayLike<number>)
    const halfW = W / 2
    // 翻面位置以半圈為單位（printFlip.ts）：0 正面、-1 背面；負值＝右緣掀起往左翻。
    let turn = flipped ? -1 : 0
    let turnGoal = turn
    let turnFrom = turn
    let turnStart = 0
    let turnMs = FLIP_MS
    // 手捏住紙的哪一側（紙面局部 x 的正負）：起翻時在觀者右邊的那一側
    let grip: 1 | -1 = 1
    let flex: FlexState = { value: 0, velocity: 0 }
    let bent = 0
    let lastRot = turn
    let lastNow = 0
    let peekNow = 0

    // 單側懸臂：手捏的那一側平直，遠端因慣性落後、往起翻時朝向觀者的那一面彎。
    // 背面幾何繞 Y 轉了 180°：它的 x 對到紙的 -x、z 對到 -z。
    function bend(amount: number) {
      const pf = geoF.attributes.position!
      const pb = geoB.attributes.position!
      const af = pf.array as Float32Array
      const ab = pb.array as Float32Array
      const depth = grip * amount * W
      for (let i = 0; i < pf.count; i++) {
        const x = base[i * 3]!
        af[i * 3 + 2] = depth * cantilever(x, halfW, grip)
        ab[i * 3 + 2] = -depth * cantilever(-x, halfW, grip)
      }
      pf.needsUpdate = pb.needsUpdate = true
      geoF.computeVertexNormals()
      geoB.computeVertexNormals()
    }

    let tiltX = 0
    let tiltY = 0
    let aimX = 0
    let aimY = 0
    let glareAim = 0
    let hover = 0
    let hoverAim = 0
    let frame = 0
    let developStart = 0
    let peekStart = 0
    let dirtyFront = false
    let dirtyEar = false
    const rendererSize = new three.Vector2()

    function render() {
      frame = 0
      if (disposed) return
      const now = performance.now()
      // 閒置後第一幀的 dt 用 1/60；背景分頁回來最多算 50ms，避免彈簧一步跳太遠
      const dt = lastNow ? Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000)) : 1 / 60
      lastNow = now
      let busy = false
      if (turn !== turnGoal) {
        const t = Math.min(1, (now - turnStart) / turnMs)
        turn = turnFrom + (turnGoal - turnFrom) * flipEase(t)
        if (t >= 1) turn = turnGoal
        busy = true
      }
      peekNow = 0
      if (peekStart) {
        const t = Math.min(1, (now - peekStart) / PEEK_MS)
        peekNow = -Math.sin(t * Math.PI) * PEEK_TURN
        if (t >= 1) {
          peekStart = 0
          peekNow = 0
        } else busy = true
      }
      const rot = turn + peekNow
      // 轉得越快遠端越落後；停下時彈簧帶出一次輕微回彈
      const velocity = (rot - lastRot) / dt
      lastRot = rot
      const flexAim = Math.max(-FLEX_MAX, Math.min(FLEX_MAX, -velocity * FLEX_GAIN))
      flex = stepFlex(flex, flexAim, dt)
      if (Math.abs(flex.value) > 2e-4 || Math.abs(flex.velocity) > 2e-3 || flexAim !== 0) busy = true
      else flex = { value: 0, velocity: 0 }
      if (flex.value !== bent) {
        bent = flex.value
        bend(bent)
      }
      // 游標微傾與懸停抬升：依實際經過時間平滑，高更新率螢幕不會變快
      const follow = 1 - Math.pow(0.82, dt * 60)
      tiltX += (aimX - tiltX) * follow
      tiltY += (aimY - tiltY) * follow
      hover += (hoverAim - hover) * follow
      if (Math.abs(aimX - tiltX) > 0.0005 || Math.abs(aimY - tiltY) > 0.0005 || Math.abs(hoverAim - hover) > 0.05) busy = true
      glare.intensity += (glareAim - glare.intensity) * (1 - Math.pow(0.85, dt * 60))
      if (Math.abs(glareAim - glare.intensity) > 0.01) busy = true
      // 立起的程度：抬升比轉角早到、晚退；折角那側（下緣）先起來一點
      const open = Math.abs(Math.sin(rot * Math.PI))
      const lift = Math.pow(open, 0.75) * LIFT
      paper.rotation.set(tiltX - open * FLIP_TILT, tiltY + rot * Math.PI, 0)
      paper.position.z = lift + hover
      const height = Math.min(1, (lift + hover) / LIFT)
      shadowMat.opacity = SHADOW_OPACITY * (1 - 0.35 * height)
      key.shadow.radius = SHADOW_RADIUS + 8 * height
      if (!busy && turn === turnGoal) {
        // 停穩後收回 0／-1，數字不會越翻越大（旋轉等價，看不出跳動）
        turn = turnGoal = turnFrom = lastRot = restTurn(turn)
      }
      if (developStart) {
        const d = Math.min(1, (now - developStart) / developMs())
        develop = ease(d)
        dirtyFront = true
        if (d >= 1) developStart = 0
        else busy = true
      }
      if (dirtyFront || dirtyEar) {
        updateTextures(dirtyFront)
        frontTex.needsUpdate = true
        if (dirtyEar) backTex.needsUpdate = true
        dirtyFront = dirtyEar = false
      }
      // 共用 renderer 切到不同尺寸的卡片時才重設 backing buffer。
      // three 的 setSize 即使尺寸相同也會寫入 canvas.width／height。
      renderer.getSize(rendererSize)
      if (rendererSize.x !== VW || rendererSize.y !== VH) renderer.setSize(VW, VH, false)
      renderer.render(sceneObj, camera)
      viewCtx!.setTransform(1, 0, 0, 1, 0, 0)
      viewCtx!.clearRect(0, 0, view.width, view.height)
      viewCtx!.drawImage(renderer.domElement, 0, 0, view.width, view.height)
      if (busy) frame = requestAnimationFrame(render)
      else lastNow = 0
    }
    const kick = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(render)
    }

    return {
      W,
      kick,
      setFlipped(next: boolean) {
        // 偷看途中被點：把當下的偷看角度併進翻面起點，不會先彈回正面
        const position = turn + peekNow
        const goal = turnTarget(position, next)
        if (goal === turnGoal && !peekStart) return
        // 從靜止起翻才換手；翻到一半再點是原路翻回，手不換
        if (turn === turnGoal) grip = Math.abs(turn) % 2 === 1 ? -1 : 1
        turn = turnFrom = position
        turnGoal = goal
        turnMs = FLIP_MS * Math.max(0.55, Math.abs(goal - position))
        turnStart = performance.now()
        peekStart = 0
        peekNow = 0
        aimX = aimY = glareAim = hoverAim = 0
        kick()
      },
      startDevelop() {
        if (develop >= 1 || developStart) return
        developStart = performance.now()
        kick()
      },
      redrawFront() {
        dirtyFront = true
        kick()
      },
      redrawEar() {
        dirtyEar = true
        kick()
      },
      peek() {
        if (peekStart || flipped || turn !== turnGoal) return
        grip = 1
        peekStart = performance.now()
        kick()
      },
      aim(x: number, y: number) {
        if (turn !== turnGoal) return
        aimY = x * 0.28
        aimX = -y * 0.2
        glareAim = 3.2
        hoverAim = 10
        glare.position.x = x * W * 1.2
        glare.position.y = -y * H * 1.2
        kick()
      },
      rest() {
        aimX = aimY = 0
        glareAim = 0
        hoverAim = 0
        kick()
      },
      dispose() {
        cancelAnimationFrame(frame)
        frame = 0
        geoF.dispose()
        geoB.dispose()
        matF.dispose()
        matB.dispose()
        frontTex.dispose()
        backTex.dispose()
        floor.geometry.dispose()
        shadowMat.dispose()
      }
    }
  }

  function rebuild() {
    resizeFrame = 0
    if (disposed) return
    const width = front!.offsetWidth
    if (scene && Math.abs(width - lastWidth) < 1) return
    scene?.dispose()
    scene = buildScene()
    lastWidth = width
    if (scene) {
      if (revealed) scene.startDevelop()
      scene.kick()
    }
  }

  scene = buildScene()
  if (!scene) {
    view.remove()
    releaseRenderer()
    return null
  }
  lastWidth = scene.W
  const resizer = new ResizeObserver(() => {
    if (!resizeFrame && !disposed) resizeFrame = requestAnimationFrame(rebuild)
  })
  resizer.observe(front)
  scene.kick()

  return {
    setFlipped(next) {
      flipped = next
      scene?.setFlipped(next)
    },
    setRevealed() {
      revealed = true
      scene?.startDevelop()
    },
    setActive(next) {
      if (active === next) return
      active = next
      scene?.redrawFront()
    },
    pointerMove(clientX, clientY) {
      if (!fine.matches || !scene) return
      const r = wrap.getBoundingClientRect()
      scene.aim((clientX - r.left) / r.width - 0.5, (clientY - r.top) / r.height - 0.5)
    },
    pointerLeave() {
      scene?.rest()
    },
    setEar(px) {
      const next = Math.max(0, Math.round(px))
      if (next === earPx) return
      earPx = next
      scene?.redrawEar()
    },
    peek() {
      scene?.peek()
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(resizeFrame)
      resizer.disconnect()
      scene?.dispose()
      scene = null
      view.remove()
      releaseRenderer()
    }
  }
}
