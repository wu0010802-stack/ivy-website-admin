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
 * - 翻面暗示 A 角落捲起（2026-09-23 晚）：沒有折角，觀者看到的右下角被風掀起（網格沿對角折線彎曲，
 *   cornerCurl.ts），角度由 DayMomentCard 取風、翻面起手、進場輕掀最大值後經 setCorner 餵進來。
 */
import type * as ThreeNS from 'three'
import { FLIP_MS, cantilever, flipEase, restTurn, stepFlex, turnTarget, type FlexState } from './printFlip'
import { createCurl, curlPoint, setCurl } from './cornerCurl'
import { CORNER_REST, REACH_REFERENCE_WIDTH, WIND_REACH, type CornerPose } from './cornerWind'

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
  /** 觀者看到的右下角被掀起的程度（風、翻面起手、進場輕掀取最大值）；翻面途中固定掀起點那一面。 */
  setCorner(pose: CornerPose): void
  dispose(): void
}

const MARGIN = 70 // 四周留給彎曲與抬升
// 翻面手感：立起時抬升、下緣（折角那側）先起來一點；抬得越高影子越淡越散。
const LIFT = 36
const FLIP_TILT = 0.08
const FLEX_GAIN = 0.024 // 每秒半圈的轉速 → 遠端落後紙寬的比例
const FLEX_MAX = 0.09
const SHADOW_OPACITY = 0.28
const SHADOW_RADIUS = 6
// 手機顯影縮到 1 秒內，與 styles.css 的 .print-photo 手機 transition 對齊。
const DEVELOP_MS = 3200
const DEVELOP_MS_MOBILE = 900
const developMs = () => (window.matchMedia('(max-width: 760px)').matches ? DEVELOP_MS_MOBILE : DEVELOP_MS)
// 角落捲曲的範圍只有 50–130px，網格要夠細才彎得圓（每格約 10px）
const SEGMENTS_X = 44
const SEGMENTS_Y = 56
// 顯影改成「預先畫好幾個中間格、每幀只做兩格的 alpha 交叉淡化」：原本每幀用
// ctx.filter（sepia/contrast/blur）重畫整張照片，手機 4x 節流下一幀就要 100 ms 以上。
// 六格（0、.2、…、1）在 3.2 秒的淡入裡肉眼看不出與逐幀濾鏡的差別；格子用到才畫。
const DEVELOP_STAGES = 6
// 紙面貼圖、共用 renderer 與顯示畫布同步支援最高 3× 像素密度。
const coarsePointer = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches
const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 3)
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

let threePromise: Promise<Three | null> | null = null
let shared: { renderer: ThreeNS.WebGLRenderer; three: Three; users: number; warm: { scene: ThreeNS.Scene; camera: ThreeNS.PerspectiveCamera } } | null = null

// 探測結果整頁只算一次：每次 getContext('webgl') 都是真的建一個 GL context（低階裝置
// 上百毫秒，而且要等 GC 才釋放），六張卡各探一次太浪費。
let webglProbe: boolean | undefined
function canUseWebGL(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  if (webglProbe !== undefined) return webglProbe
  if (!('WebGLRenderingContext' in window)) return (webglProbe = false)
  try {
    const probe = document.createElement('canvas')
    const gl = probe.getContext('webgl2') || probe.getContext('webgl')
    webglProbe = Boolean(gl)
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webglProbe = false
  }
  return webglProbe
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
    renderer.setPixelRatio(pixelRatio())
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = three.PCFShadowMap
    shared = { renderer, three, users: 0, warm: buildWarmScene(three) }
    // 先把紙與地板用到的 shader program 編好並一直持有：three 會在同 program 的
    // 材質全部 dispose 時釋放 program，觸控裝置的掛載名額（paper-budget）卸掉卡片後，
    // 下一張重掛就得重新編譯（4x 節流實測單幀 1 s 以上）。這個暖身場景的材質永不
    // dispose，program 就一直留在快取裡。燈光組合與材質參數必須跟 buildScene 一致。
    void renderer.compileAsync(shared.warm.scene, shared.warm.camera).catch(() => {})
  }
  shared.users += 1
  return shared.renderer
}

function buildWarmScene(three: Three) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 2
  const tex = new three.CanvasTexture(canvas)
  tex.colorSpace = three.SRGBColorSpace
  const scene = new three.Scene()
  const paper = new three.Mesh(new three.PlaneGeometry(1, 1, 1, 1), new three.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0, alphaTest: 0.5 }))
  paper.castShadow = true
  scene.add(paper)
  // buildScene 的地板另設 CustomBlending、不比深度：那些是 GL 狀態，program 的 opaque 旗標兩邊都是 false，快取照樣命中。
  const floor = new three.Mesh(new three.PlaneGeometry(2, 2), new three.ShadowMaterial({ opacity: 0.28 }))
  floor.receiveShadow = true
  scene.add(floor)
  scene.add(new three.AmbientLight(0xffffff, 1.35))
  const key = new three.DirectionalLight(0xfff4e0, 1.6)
  key.castShadow = true
  key.shadow.mapSize.set(512, 512)
  scene.add(key)
  scene.add(new three.PointLight(0xffffff, 0, 10, 1.4))
  const camera = new three.PerspectiveCamera(24, 1, 10, 100)
  return { scene, camera }
}

function releaseRenderer() {
  if (!shared) return
  shared.users -= 1
  if (shared.users <= 0) {
    shared.warm.scene.traverse((obj) => {
      const mesh = obj as ThreeNS.Mesh
      if (mesh.isMesh) {
        mesh.geometry.dispose()
        const material = mesh.material as ThreeNS.MeshStandardMaterial
        material.map?.dispose()
        material.dispose()
      }
      const light = obj as ThreeNS.DirectionalLight
      if (light.isDirectionalLight) light.shadow.dispose()
    })
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

// 對應 CSS 標題的 text-spacing-trim:trim-start：行首開括號照 LINE Seed TW 的 halt 數值收，
// 字形左移（「 0.32em、（ 0.283em），後面的字少半格。換標題字型時要重查 GPOS halt。
// 相鄰標點（」，）canvas 跟 DOM 一樣會自動收，不用另外處理。
const HALT_OPEN: Record<string, number> = { '「': 0.32, '（': 0.283 }

function fillTitleLine(ctx: CanvasRenderingContext2D, line: string, y: number) {
  const first = line[0] ?? ''
  const shift = HALT_OPEN[first]
  if (shift === undefined) {
    ctx.fillText(line, 0, y)
    return
  }
  const em = ctx.measureText(first).width // 全形括號寬 1em
  ctx.fillText(first, -shift * em, y)
  ctx.fillText(line.slice(1), em * 0.5, y)
}

// 中文禁則：這些標點不放行首、開括號不留在行尾。跟瀏覽器一樣把前一個字一起帶到下一行，
// 否則「。」「？」會自己掉到新的一行（DOM 版由瀏覽器處理，canvas 要自己來）。
const NO_LINE_START = /[，。、；：！？」』）…,.;:!?)]/
const NO_LINE_END = /[「『（(]/

function wrapLines(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    let line = ''
    for (const ch of raw) {
      if (line && ctx.measureText(line + ch).width > max) {
        const chars = Array.from(line)
        let carry = ch
        while (chars.length > 1 && (NO_LINE_START.test(carry[0]!) || NO_LINE_END.test(chars[chars.length - 1]!))) {
          carry = chars.pop()! + carry
        }
        out.push(chars.join(''))
        line = carry
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

  const DPR = pixelRatio()
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)')
  const renderer = acquireRenderer(three)

  // 元件狀態（由 DayMomentCard 透過 handle 餵進來）
  let flipped = initial.flipped ?? false
  let revealed = initial.developed ?? false
  let active = false
  let corner: CornerPose = CORNER_REST
  let disposed = false

  // 每次尺寸變動就整組重建（貼圖尺寸與幾何都綁著像素寬）
  let scene: Awaited<ReturnType<typeof buildScene>> | null = null
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

  // 分三段各讓出主執行緒一次：量版位＋畫貼圖 → 建 three 場景 → 非同步編譯 shader
  // （compileAsync 用 KHR_parallel_shader_compile 輪詢，不在第一幀 render 時同步等 link）。
  // 4x CPU 節流實測第一張卡原本單一 LoAF 1.6 s。
  async function buildScene() {
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
      const backRect = back!.getBoundingClientRect()

      const style = {
        frontBg: colorOf(front, 'backgroundColor', '#fffdf7'),
        backBg: colorOf(back, 'backgroundColor', '#fff6df'),
        figureBg: colorOf(figure, 'backgroundColor', '#e8e2d2'),
        lineColor: 'rgb(32 64 47 / .07)',
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
    // 顯示畫布的尺寸留到場景建好（最後一個 await 之後）才改：rebuild 期間舊場景還在畫，
    // 這裡先重設 width/height 會把畫布清空或拉伸，轉向／拉視窗時卡片會閃一下。
    const sizeView = () => {
      view.width = VW * DPR
      view.height = VH * DPR
      view.style.width = `${VW}px`
      view.style.height = `${VH}px`
      view.style.left = `${-MARGIN}px`
      view.style.top = `${-MARGIN}px`
    }

    const frontCanvas = document.createElement('canvas')
    const backCanvas = document.createElement('canvas')
    frontCanvas.width = backCanvas.width = Math.round(W * DPR)
    frontCanvas.height = backCanvas.height = Math.round((H + TOP) * DPR)
    const fctx = frontCanvas.getContext('2d')!
    const bctx = backCanvas.getContext('2d')!
    // 支援時使用高品質照片縮圖，其他瀏覽器沿用原生平滑取樣。
    if ('imageSmoothingQuality' in fctx) fctx.imageSmoothingQuality = 'high'
    // 紙面座標：原點在紙的左上角，上方留給膠帶的透明帶
    const paperSpace = (ctx: CanvasRenderingContext2D) => ctx.setTransform(DPR, 0, 0, DPR, 0, TOP * DPR)
    const clearAll = (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      paperSpace(ctx)
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
          fillTitleLine(ctx, line, y)
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

    const cover = Math.max(box.figure.w / img!.naturalWidth, box.figure.h / img!.naturalHeight)
    const photoW = img!.naturalWidth * cover
    const photoH = img!.naturalHeight * cover
    // 相紙底＋照片（依顯影程度加濾鏡與透明度）＋乳白覆蓋層，畫在 (ox, oy) 起的相片區。
    function drawDeveloping(ctx: CanvasRenderingContext2D, d: number, ox = box.figure.x, oy = box.figure.y) {
      const f = box.figure
      setFill(ctx, style.figureBg, '#e8e2d2')
      ctx.fillRect(ox, oy, f.w, f.h)
      ctx.filter =
        d >= 1
          ? 'none'
          : `sepia(${(1 - d) * 0.55}) contrast(${0.28 + 0.72 * d}) brightness(${1.55 - 0.55 * d}) saturate(${0.35 + 0.65 * d}) blur(${(1 - d) * 2.5}px)`
      ctx.globalAlpha = 0.28 + 0.72 * d
      ctx.drawImage(img!, ox + (f.w - photoW) / 2, oy + (f.h - photoH) * 0.4, photoW, photoH)
      ctx.filter = 'none'
      ctx.globalAlpha = 1
      if (d < 1) {
        ctx.fillStyle = `rgba(226,233,231,${(1 - d) * 0.8})`
        ctx.fillRect(ox, oy, f.w, f.h)
      }
    }
    // 顯影中間格（用到才畫，一格一次濾鏡；顯影完成後釋放）
    const stages: (HTMLCanvasElement | null)[] = Array.from({ length: DEVELOP_STAGES }, () => null)
    function developStage(i: number): HTMLCanvasElement {
      let stage = stages[i]
      if (!stage) {
        const f = box.figure
        stage = document.createElement('canvas')
        stage.width = Math.max(1, Math.ceil(f.w * DPR))
        stage.height = Math.max(1, Math.ceil(f.h * DPR))
        const sctx = stage.getContext('2d')!
        sctx.setTransform(DPR, 0, 0, DPR, 0, 0)
        sctx.beginPath()
        sctx.rect(0, 0, f.w, f.h)
        sctx.clip()
        drawDeveloping(sctx, i / (DEVELOP_STAGES - 1), 0, 0)
        stages[i] = stage
      }
      return stage
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
      ctx.save()
      ctx.beginPath()
      ctx.rect(f.x, f.y, f.w, f.h)
      ctx.clip()
      const d = develop
      if (d >= 1) {
        drawDeveloping(ctx, 1)
        stages.fill(null)
      } else {
        // 兩個相鄰中間格交叉淡化（格子含不透明相紙底，alpha 疊加就是線性插值）
        const pos = d * (DEVELOP_STAGES - 1)
        const lo = Math.floor(pos)
        const hi = Math.min(DEVELOP_STAGES - 1, lo + 1)
        ctx.drawImage(developStage(lo), f.x, f.y, f.w, f.h)
        if (hi !== lo && pos - lo > 0.001) {
          ctx.globalAlpha = pos - lo
          ctx.drawImage(developStage(hi), f.x, f.y, f.w, f.h)
          ctx.globalAlpha = 1
        }
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

    let develop = revealed ? 1 : 0
    drawFrontBase()
    drawPhoto(develop, active)
    drawBack()
    await nextFrame()
    if (disposed) return null
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
    const geoF = new three.PlaneGeometry(W, H + TOP, SEGMENTS_X, SEGMENTS_Y)
    const geoB = new three.PlaneGeometry(W, H + TOP, SEGMENTS_X, SEGMENTS_Y)
    geoF.translate(0, TOP / 2, 0)
    geoB.translate(0, TOP / 2, 0)
    // alphaTest 讓膠帶外緣硬邊透空，不走透明排序
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
    // 影子只是紙後方一片柔邊（radius 6），512 與 1024 肉眼無差，記憶體與每幀 shadow pass 少四分之三。
    key.shadow.mapSize.set(512, 512)
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
    const baseB = Float32Array.from(geoB.attributes.position!.array as ArrayLike<number>)
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

    const cols = SEGMENTS_X + 1
    const curl = createCurl()
    const point = { x: 0, y: 0, z: 0 }
    let shaped = false
    const isBackTurn = (value: number) => Math.abs(Math.round(value)) % 2 === 1

    // 紙張變形＝右下角捲曲（風／翻面起手／進場輕掀）＋翻面時的單側懸臂彎曲。
    // 角落在「觀者看到的那一面」的座標裡算：翻到背面時 x、z 反過來，永遠是觀者右下角被掀起；
    // 翻面途中固定是起點那一面，才不會翻到一半換到另一個角。
    // 懸臂：手捏的那一側平直，遠端因慣性落後、往起翻時朝向觀者的那一面彎。
    // 背面幾何繞 Y 轉了 180°：同一列左右對調、x 與 z 取負，逐點由正面結果鏡射過去。
    function deform(time: number) {
      const pf = geoF.attributes.position!
      const pb = geoB.attributes.position!
      const af = pf.array as Float32Array
      const ab = pb.array as Float32Array
      const depth = grip * bent * W
      const facing = isBackTurn(turn === turnGoal ? turn : turnFrom) ? -1 : 1
      const scale = W / REACH_REFERENCE_WIDTH
      const reach = (WIND_REACH[0] + WIND_REACH[1] * corner.reach) * scale
      const angle = -Math.PI / 4 + corner.tilt
      const nx = Math.cos(angle)
      const ny = Math.sin(angle)
      setCurl(curl, { hinge: corner.hinge, tip: corner.tip, nx, ny, ox: halfW - nx * reach, oy: -H / 2 - ny * reach, reach, ripple: 0.12, rippleK: 0.045 / scale, rippleW: 9 })
      if (!curl.active && !depth) {
        if (!shaped) return
        af.set(base)
        ab.set(baseB)
        shaped = false
      } else {
        for (let i = 0; i < pf.count; i++) {
          const bx = base[i * 3]!
          point.x = bx * facing
          point.y = base[i * 3 + 1]!
          point.z = 0
          curlPoint(point, curl, time)
          const x = point.x * facing
          const z = point.z * facing + depth * cantilever(bx, halfW, grip)
          af[i * 3] = x
          af[i * 3 + 1] = point.y
          af[i * 3 + 2] = z
          const row = Math.floor(i / cols)
          const j = row * cols + (cols - 1 - (i - row * cols))
          ab[j * 3] = -x
          ab[j * 3 + 1] = point.y
          ab[j * 3 + 2] = -z
        }
        shaped = true
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
    let dirtyFront = false
    let dirtyCorner = corner.hinge > 0
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
      const rot = turn
      // 轉得越快遠端越落後；停下時彈簧帶出一次輕微回彈
      const velocity = (rot - lastRot) / dt
      lastRot = rot
      const flexAim = Math.max(-FLEX_MAX, Math.min(FLEX_MAX, -velocity * FLEX_GAIN))
      flex = stepFlex(flex, flexAim, dt)
      if (Math.abs(flex.value) > 2e-4 || Math.abs(flex.velocity) > 2e-3 || flexAim !== 0) busy = true
      else flex = { value: 0, velocity: 0 }
      if (flex.value !== bent || dirtyCorner) {
        bent = flex.value
        dirtyCorner = false
        deform(now / 1000)
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
      if (dirtyFront) {
        drawPhoto(develop, active)
        frontTex.needsUpdate = true
        dirtyFront = false
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

    const built = {
      W,
      kick,
      setFlipped(next: boolean) {
        const position = turn
        const goal = turnTarget(position, next)
        if (goal === turnGoal) return
        // 從靜止起翻才換手；翻到一半再點是原路翻回，手不換
        if (turn === turnGoal) grip = Math.abs(turn) % 2 === 1 ? -1 : 1
        turn = turnFrom = position
        turnGoal = goal
        turnMs = FLIP_MS * Math.max(0.55, Math.abs(goal - position))
        turnStart = performance.now()
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
      redrawCorner() {
        dirtyCorner = true
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
        // shadow map 是 renderer 持有的 render target，不隨 light 被 GC；觸控名額反覆卸掛時每次都會配一張 512²。
        key.shadow.dispose()
      }
    }
    try {
      await renderer.compileAsync(sceneObj, camera)
    } catch {
      /* 沒有 compileAsync 或編譯失敗：第一幀 render 會照常同步編譯 */
    }
    if (disposed) {
      built.dispose()
      return null
    }
    // 改完尺寸馬上同步畫第一幀：改 width/height 會清空畫布，若等下一個 rAF 才畫，中間會有一格空白。
    sizeView()
    render()
    return built
  }

  // 重建期間舊場景繼續畫，新場景好了才換；token 擋掉重建途中又來一次的情況。
  let buildToken = 0
  async function rebuild() {
    resizeFrame = 0
    if (disposed) return
    const width = front!.offsetWidth
    if (scene && Math.abs(width - lastWidth) < 1) return
    const token = ++buildToken
    const next = await buildScene()
    if (disposed || token !== buildToken) {
      next?.dispose()
      return
    }
    scene?.dispose()
    scene = next
    lastWidth = width
    if (scene) {
      if (revealed) scene.startDevelop()
      scene.kick()
    }
  }

  scene = await buildScene()
  if (!scene) {
    view.remove()
    releaseRenderer()
    return null
  }
  lastWidth = scene.W
  const resizer = new ResizeObserver(() => {
    if (!resizeFrame && !disposed) resizeFrame = requestAnimationFrame(() => void rebuild())
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
    setCorner(pose) {
      // 前後都是平的就不必重畫（風收尾那幾秒，角度已經小到看不出來）
      const flat = (p: CornerPose) => p.hinge < 1e-3 && Math.abs(p.tip) < 1e-3
      const skip = pose === corner || (flat(pose) && flat(corner))
      corner = pose
      if (skip) return
      scene?.redrawCorner()
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
