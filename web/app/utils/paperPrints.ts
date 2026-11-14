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
 * - 翻面暗示 A 角落捲起（2026-09-23 晚）：沒有折角，觀者看到的右下角被掀起（網格沿對角折線彎曲，
 *   cornerCurl.ts），角度由 DayMomentCard 取翻面起手、進場輕掀較大者後經 setCorner 餵進來（捲動起風 10-03 拿掉）。
 * - 共用 context 遺失（2026-11-11）：手機切到背景、記憶體吃緊時系統會把 WebGL context 收走，three 的 render 什麼都不畫。
 *   那一刻起這個 renderer 不再用：掛著的紙各自通知卡片（initial.onLost）退回 CSS 3D 版，之後掛的紙另建 context；
 *   同一頁遺失第二次就整頁停用。見下方 handleContextLost 與 render() 裡的檢查。
 * - 平放時跟 CSS 版逐像素接近（2026-11-14，DESIGN.md「CSS 版與 WebGL 紙平放時要一模一樣」）：手機是卡片已在畫面上才換手。
 *   紙面純漫射、照片不另疊亮面與外框線、字的基線照 CSS 行框算、背面照 DOM 實際的斷行畫（linesOf）、
 *   紙底下的陰影平放時畫 CSS 的 --print-shadow（drawRestShadow），抬起來才交叉淡到光源投的影子。
 */
import type * as ThreeNS from 'three'
import { FLIP_MS, cantilever, flipEase, restTurn, stepFlex, turnTarget, type FlexState } from './printFlip'
import { wrapLines } from './cjkWrap'
import { createCurl, curlPoint, setCurl } from './cornerCurl'
import { computeIndexedNormals } from './gridNormals'
import { CORNER_REACH, CORNER_REST, REACH_REFERENCE_WIDTH, type CornerPose } from './cornerWind'

type Three = typeof import('./three-lite')

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
  /** 觀者看到的右下角被掀起的程度（翻面起手、進場輕掀取較大者）；翻面途中固定掀起點那一面。 */
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
// 平放時紙底下畫的是 CSS 版那道 box-shadow（--print-shadow），抬到這個高度（佔 LIFT 的比例）才完全換成光源投的影子。
const ALOFT_AT = 0.3
// 柔邊陰影先畫在縮小的畫布上再放大貼：模糊半徑 46px，半解析度看不出差別，每張卡少存四分之三。
const REST_SHADOW_SCALE = 0.5
const KEY_LIGHT = 1.6
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
// 顯影期間正面貼圖每秒最多重畫、重傳 30 次（2026-11-10）：原本每幀整張正面重畫＋texSubImage2D（手機 DPR3 一次約 4.6 MB），
// 桌機一張卡 3.2 秒就上傳 190 次。顯影是 3.2 秒（手機 0.9 秒）的慢速交叉淡化，30 fps 一格的差在 1%（手機 3.7%）以內，看不出分格；
// 沒有其他動作（翻面、掀角、游標）時，中間那幀連 render 與複製畫布都省掉（見 render() 的 same）。
const DEVELOP_FRAME_MS = 1000 / 30
// 紙面貼圖、共用 renderer 與顯示畫布同步支援最高 3× 像素密度。
const coarsePointer = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches
const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 3)
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

let threePromise: Promise<Three | null> | null = null
interface SharedRenderer {
  renderer: ThreeNS.WebGLRenderer
  three: Three
  users: number
  warm: { scene: ThreeNS.Scene; camera: ThreeNS.PerspectiveCamera }
  /** context 已遺失：不再給新的紙用，等還拿著它的紙都卸掉就釋放 */
  lost: boolean
  /** 掛在這個 renderer 上的紙；context 遺失時逐一通知 */
  papers: Set<() => void>
  unlisten: () => void
  destroyed: boolean
}
let shared: SharedRenderer | null = null
// 同一頁 context 遺失幾次。第二次就不再用 WebGL：多半是記憶體不夠，重建只會再被收走一次，卡片在 CSS 版與紙之間來回閃。
let contextLosses = 0
const MAX_CONTEXT_LOSSES = 2

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
    threePromise = import('./three-lite').then(
      (mod): Three => mod,
      () => null
    )
  }
  return threePromise
}

/**
 * 先把 three 載好（utils/paper-warm.ts 在閒置或卡片接近時呼叫）；用不到紙張（減少動態、沒有 WebGL）就不載。
 * 載好後再等一次真正的閒置，先建共用 renderer、編好 shader（2026-11-10）：建 WebGL context 在手機 4 倍降速約 73ms，
 * 原本落在第一張卡掛載那一個長任務裡（捲進孩子的一天時卡 100–500ms）。預建時不算使用者，最後一張卡卸掉照舊釋放。
 * 不給 timeout：這一步本身 4 倍降速要 75–100ms，被 timeout 逼在捲動途中跑就白搬了；一直沒閒置的話掛載時照舊自己建。
 */
export function warmThree(): void {
  if (!canUseWebGL()) return
  void loadThree().then((three) => {
    if (!three || shared) return
    const build = () => {
      if (!shared && canUseWebGL()) ensureRenderer(three)
    }
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(build)
    else window.setTimeout(build, 0)
  })
}

function acquireRenderer(three: Three): SharedRenderer | null {
  const pool = ensureRenderer(three)
  if (pool) pool.users += 1
  return pool
}

// 建不出 context（記憶體不足、context 數量到上限時 three 會丟錯）就回 null，這一頁之後也不再試：卡片維持 CSS 3D 版。
function ensureRenderer(three: Three): SharedRenderer | null {
  if (!shared) {
    let renderer: ThreeNS.WebGLRenderer
    try {
      renderer = new three.WebGLRenderer({ alpha: true, antialias: true })
    } catch {
      webglProbe = false
      return null
    }
    renderer.setPixelRatio(pixelRatio())
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = three.PCFShadowMap
    const pool: SharedRenderer = { renderer, three, users: 0, warm: buildWarmScene(three), lost: false, papers: new Set(), unlisten: () => {}, destroyed: false }
    // 事件比實際遺失晚一拍才到：中間要畫的那一幀由紙自己在 render() 裡用 isContextLost() 擋。
    const onLost = () => handleContextLost(pool)
    renderer.domElement.addEventListener('webglcontextlost', onLost)
    pool.unlisten = () => renderer.domElement.removeEventListener('webglcontextlost', onLost)
    shared = pool
    // 先把紙與地板用到的 shader program 編好並一直持有：three 會在同 program 的
    // 材質全部 dispose 時釋放 program，觸控裝置的掛載名額（paper-budget）卸掉卡片後，
    // 下一張重掛就得重新編譯（4x 節流實測單幀 1 s 以上）。這個暖身場景的材質永不
    // dispose，program 就一直留在快取裡。燈光組合與材質參數必須跟 buildScene 一致。
    void renderer.compileAsync(pool.warm.scene, pool.warm.camera).catch(() => {})
  }
  return shared
}

/**
 * 共用的 WebGL context 被系統收走（2026-11-11）。three 的 render 之後什麼都不畫，共用畫布留著最後一張成功畫出的卡：
 * 原本照樣 drawImage 到各卡的顯示畫布，WebKit（iPhone）上之後要畫的每一張卡都變成那一張、點了不翻、context 還原後也不重畫；
 * Chromium 則複製到空白，卡片整張不見（DOM 正反面在 .webgl-ready 底下是透明的）。
 * 做法：這個 renderer 從此不再用（three 還原 context 後貼圖、shader 都要重建，不如換一個乾淨的）；掛著的紙逐一通知，
 * 由卡片卸回 CSS 3D 版（DOM 的內容永遠是對的）再照平常的排程重掛。
 */
function handleContextLost(pool: SharedRenderer) {
  if (pool.lost) return
  pool.lost = true
  contextLosses += 1
  if (contextLosses >= MAX_CONTEXT_LOSSES) webglProbe = false
  if (shared === pool) shared = null
  // 通知途中紙會把自己從集合拿掉，先複製一份
  for (const notify of [...pool.papers]) notify()
  if (pool.users <= 0) destroyRenderer(pool)
}

function buildWarmScene(three: Three) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 2
  const tex = new three.CanvasTexture(canvas)
  tex.colorSpace = three.SRGBColorSpace
  const scene = new three.Scene()
  const paper = new three.Mesh(new three.PlaneGeometry(1, 1, 1, 1), new three.MeshLambertMaterial({ map: tex, alphaTest: 0.5 }))
  paper.castShadow = true
  scene.add(paper)
  // buildScene 的地板另設 CustomBlending、不比深度：那些是 GL 狀態，program 的 opaque 旗標兩邊都是 false，快取照樣命中。
  const floor = new three.Mesh(new three.PlaneGeometry(2, 2), new three.ShadowMaterial({ opacity: 0.28 }))
  floor.receiveShadow = true
  scene.add(floor)
  scene.add(new three.AmbientLight(0xffffff, 1.35))
  const key = new three.DirectionalLight(0xffffff, KEY_LIGHT)
  key.castShadow = true
  key.shadow.mapSize.set(512, 512)
  scene.add(key)
  scene.add(new three.PointLight(0xffffff, 0, 10, 1.4))
  const camera = new three.PerspectiveCamera(24, 1, 10, 100)
  return { scene, camera }
}

function releaseRenderer(pool: SharedRenderer) {
  pool.users -= 1
  if (pool.users <= 0) destroyRenderer(pool)
}

function destroyRenderer(pool: SharedRenderer) {
  if (pool.destroyed) return
  pool.destroyed = true
  pool.unlisten()
  pool.warm.scene.traverse((obj) => {
    const mesh = obj as ThreeNS.Mesh
    if (mesh.isMesh) {
      mesh.geometry.dispose()
      const material = mesh.material as ThreeNS.MeshLambertMaterial
      material.map?.dispose()
      material.dispose()
    }
    const light = obj as ThreeNS.DirectionalLight
    if (light.isDirectionalLight) light.shadow.dispose()
  })
  pool.renderer.dispose()
  if (shared === pool) shared = null
}

// ---- 讀 DOM 樣式，讓貼圖跟 CSS 同一套 token ----

function fontOf(el: Element | null, fallback: string): string {
  if (!el) return fallback
  const cs = getComputedStyle(el)
  return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
}

// 元素不在或是透明底時，改用 CSS 那條規則引用的 token（fallback 是 CSS 色彩式，例如 'var(--muted)'，
// 在 probe 上解析）：顏色只有 tokens.css 一份，不在這裡另抄 hex（2026-10-20）。
function colorOf(el: Element | null, prop: 'color' | 'backgroundColor', probe: HTMLElement, fallback: string): string {
  const value = el ? getComputedStyle(el)[prop] : ''
  return value && value !== 'rgba(0, 0, 0, 0)' ? value : resolveColorOn(probe, fallback)
}

function pxOf(el: Element | null, prop: 'fontSize' | 'lineHeight', fallback: number): number {
  if (!el) return fallback
  const n = parseFloat(getComputedStyle(el)[prop])
  return Number.isFinite(n) ? n : fallback
}

// 照片在相片框裡的裁切位置照 DOM 的 object-position（CSS 預設或後台設定的焦點），貼圖不另寫一份
// （2026-10-13：原本寫死 50% 40%，CSS 改成避開照片右上角台標後兩邊會裁得不一樣）。
// slack＝照片比框多出來的長度；百分比照 CSS 定義乘上它，px 直接當位移；讀不懂的寫法退回 fallback。
export function objectOffset(token: string | undefined, slack: number, fallback: number): number {
  const n = parseFloat(token ?? '')
  if (!token || !Number.isFinite(n)) return slack * fallback
  if (token.endsWith('%')) return slack * (n / 100)
  return token.endsWith('px') ? n : slack * fallback
}

// 文字基線照 CSS 行框算：(行高 − 字型 ascent − descent) / 2 + ascent。canvas 的 fontBoundingBox 就是 CSS 排行用的那組值，
// 背面每行字才會跟 DOM 一樣落在兩條橫線中間（2026-10-13）；量不到時退回原本的 0.72 行高。
function baselineIn(ctx: CanvasRenderingContext2D, top: number, lineHeight: number): number {
  const m = ctx.measureText('永')
  const ascent = m.fontBoundingBoxAscent
  const descent = m.fontBoundingBoxDescent
  if (!Number.isFinite(ascent) || !Number.isFinite(descent)) return top + lineHeight * 0.72
  return top + (lineHeight - ascent - descent) / 2 + ascent
}

function setFill(ctx: CanvasRenderingContext2D, value: string, fallback: string) {
  ctx.fillStyle = fallback
  ctx.fillStyle = value
}

// 對應 CSS 標題的 text-spacing-trim:trim-start：行首開括號照 LINE Seed TW 的 halt 數值收，
// 字形左移（「 0.32em、（ 0.283em），後面的字少半格。換標題字型時要重查 GPOS halt。
// 相鄰標點（」，）canvas 跟 DOM 一樣會自動收，不用另外處理。
const HALT_OPEN: Record<string, number> = { '「': 0.32, '（': 0.283 }

// CSS letter-spacing 的 px 值（normal 為 0）。
function spacingOf(el: Element | null): number {
  if (!el) return 0
  const n = Number.parseFloat(getComputedStyle(el).letterSpacing)
  return Number.isFinite(n) ? n : 0
}

// 照 CSS 字距畫字（2026-10-20）：canvas 預設不吃 letter-spacing，手機停下滑動、卡片在畫面上換成 WebGL 紙時，
// 小標（.08em）、標題（.02em）、時間戳（.06em）會整排縮窄一下。支援 ctx.letterSpacing 就直接設；
// 不支援的瀏覽器逐字畫（少了相鄰標點擠壓，只差在不支援的版本）。CSS 每個字後面都加字距，最後一個也算，靠右對齊照算。
export function fillSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  if (!spacing) {
    ctx.fillText(text, x, y)
    return
  }
  // lib.dom 已宣告 letterSpacing，用 object 檢查才不會把下面的逐字分支收窄成 never
  if ('letterSpacing' in (ctx as object)) {
    ctx.letterSpacing = `${spacing}px`
    ctx.fillText(text, x, y)
    ctx.letterSpacing = '0px'
    return
  }
  const chars = Array.from(text)
  const widths = chars.map((ch) => ctx.measureText(ch).width)
  const total = widths.reduce((sum, w) => sum + w + spacing, 0)
  const align = ctx.textAlign
  let cursor = align === 'right' || align === 'end' ? x - total : align === 'center' ? x - total / 2 : x
  ctx.textAlign = 'left'
  chars.forEach((ch, i) => {
    ctx.fillText(ch, cursor, y)
    cursor += widths[i]! + spacing
  })
  ctx.textAlign = align
}

function fillTitleLine(ctx: CanvasRenderingContext2D, line: string, y: number, spacing = 0) {
  const first = line[0] ?? ''
  const shift = HALT_OPEN[first]
  if (shift === undefined) {
    fillSpaced(ctx, line, 0, y, spacing)
    return
  }
  const em = ctx.measureText(first).width // 全形括號寬 1em
  ctx.fillText(first, -shift * em, y)
  fillSpaced(ctx, line.slice(1), em * 0.5 + spacing, y, spacing)
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

// 把 CSS 色彩式（var()、color-mix()）解析成 canvas 認得的計算值。瀏覽器的 computed color 一定有值
// （變數未定義時退回繼承的 color），不需要再備一份 hex。
// 探針是已經在卡片裡的元素（canvas.paper-view，.print-wrap 的子元素），只改它的 inline color、讀完在同一個同步工作內還原
// （2026-11-05）：原本每取一色就 append 再 remove 一個 span，每張卡掛載 8 次 DOM 插拔，每次都要重判 :has() 這類結構相依的樣式
// （頁首還用 body:has(…) 時每次整頁重算 680–770 個元素，改成 header class 後仍有 6–7 個）；改 inline style 只重算探針自己。
// var() 的繼承鏈跟插在 .print-wrap 的 span 相同，取到的顏色字串逐字相同。
export function resolveColorOn(probe: HTMLElement, value: string): string {
  const prev = probe.style.getPropertyValue('color')
  probe.style.setProperty('color', value)
  const color = getComputedStyle(probe).color
  if (prev) probe.style.setProperty('color', prev)
  else probe.style.removeProperty('color')
  return color
}

const COLOR_RE = /(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^()]*\)|#[0-9a-f]{3,8}\b/i

// 第一個 box-shadow 的顏色；讀不到才解析 fallback（多半用不到，不要先算好再傳進來）。
function shadowColorOf(el: Element, fallback: () => string): string {
  const match = COLOR_RE.exec(getComputedStyle(el).boxShadow)
  return match?.[0] ?? fallback()
}

export interface BoxShadow {
  color: string
  x: number
  y: number
  blur: number
  spread: number
}

// computed 的 box-shadow／text-shadow 拆成一道道（各家順序不同：顏色可能在前或在後；顏色函式裡也有逗號，只切最外層的）。
// inset 的不要：畫在紙底下的只有外側陰影。
export function parseShadows(value: string): BoxShadow[] {
  if (!value || value === 'none') return []
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i <= value.length; i++) {
    const ch = value[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (i === value.length || (ch === ',' && depth === 0)) {
      parts.push(value.slice(start, i))
      start = i + 1
    }
  }
  const shadows: BoxShadow[] = []
  for (const part of parts) {
    if (/\binset\b/.test(part)) continue
    const color = COLOR_RE.exec(part)?.[0]
    const lengths = (part.replace(COLOR_RE, '').match(/-?[\d.]+px/g) ?? []).map((length) => Number.parseFloat(length))
    if (!color || lengths.length < 2) continue
    shadows.push({ color, x: lengths[0]!, y: lengths[1]!, blur: lengths[2] ?? 0, spread: lengths[3] ?? 0 })
  }
  return shadows
}

// 把 CSS 的陰影式（var(--print-shadow)）解析成計算值再拆開；跟 resolveColorOn 一樣借卡片裡的探針，同一個同步工作內還原。
function resolveShadowsOn(probe: HTMLElement, value: string): BoxShadow[] {
  const prev = probe.style.getPropertyValue('box-shadow')
  probe.style.setProperty('box-shadow', value)
  const shadows = parseShadows(getComputedStyle(probe).boxShadow)
  if (prev) probe.style.setProperty('box-shadow', prev)
  else probe.style.removeProperty('box-shadow')
  return shadows
}

/**
 * DOM 實際排出來的每一行字（2026-11-14）：逐字量 Range 的框，往下跳了半個字高就是換行。
 * 背面段落是 text-wrap:pretty，各家瀏覽器斷法不同（Safari 26 會整段重新平均，Chromium 只救孤字），
 * 貼圖自己折行（cjkWrap 的 wrapLines）對不上：手機換成 WebGL 紙那一刻整段字重排。量不到（沒有版面的環境）回 null，呼叫端退回 wrapLines。
 * 要在 measureFlatPrint 裡呼叫：紙還帶著旋轉時同一行的字 top 不一樣。
 */
export function linesOf(el: Element | null): string[] | null {
  if (!el || typeof document.createRange !== 'function') return null
  const range = document.createRange()
  if (typeof range.getClientRects !== 'function') return null
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const lines: string[] = []
  let line = ''
  let top = Number.NaN
  let measured = false
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    let offset = 0
    for (const ch of node.textContent ?? '') {
      range.setStart(node, offset)
      range.setEnd(node, offset + ch.length)
      offset += ch.length
      // 行尾被收掉的空白沒有框：留在原本那一行
      const rect = range.getClientRects()[0]
      if (rect && rect.height > 0) {
        measured = true
        if (line && rect.top - top > rect.height / 2) {
          lines.push(line)
          line = ''
        }
        if (!line) top = rect.top
      }
      line += ch
    }
  }
  if (line) lines.push(line)
  return measured ? lines : null
}

// 時間戳的 CSS transform（skewX）取 matrix(a, b, c, d, e, f) 的 c；沒有 transform 回 0，讀不懂退回 CSS 現行的 -6°。
function skewOf(el: Element | null): number {
  if (!el) return 0
  const value = getComputedStyle(el).transform
  if (!value || value === 'none') return 0
  const c = Number.parseFloat(/^matrix\(([^)]+)\)$/.exec(value)?.[1]?.split(',')[2] ?? '')
  return Number.isFinite(c) ? c : -Math.tan(Math.PI / 30)
}

// 第一道 text-shadow 的顏色與模糊半徑（px）；讀不到才解析 fallback、半徑退回 CSS 現行的 6px。
function glowOf(el: Element | null, fallback: () => string): { color: string; blur: number } {
  const glow = el ? parseShadows(getComputedStyle(el).textShadow)[0] : undefined
  return glow ? { color: glow.color, blur: glow.blur } : { color: fallback(), blur: 6 }
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
    [wrap.querySelector<HTMLElement>('.print-foot h3'), unrotate],
    // 時間戳的 skewX 會把外框撐寬（每邊多半個字高 × tan 6°），要量的是斜切前的版面框
    [wrap.querySelector<HTMLElement>('.print-stamp'), { transform: 'none' }]
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
  /** onLost：共用的 WebGL context 遺失、這張紙不能再畫了；呼叫端要 dispose() 並露出 DOM 卡片（只在拿到 handle 之後才會呼叫）。 */
  initial: { developed?: boolean; flipped?: boolean; active?: boolean; canMount?: () => boolean; onLost?: () => void } = {}
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
  const acquired = acquireRenderer(three)
  if (!acquired) return null
  const pool: SharedRenderer = acquired
  const renderer = pool.renderer
  const gl = renderer.getContext()
  // context 遺失：建場途中（還沒交出 handle）就讓 mountPaper 回 null；交出去之後通知卡片。
  let lost = false
  let delivered = false
  const onContextLost = () => {
    if (lost) return
    lost = true
    if (delivered) initial.onLost?.()
  }
  pool.papers.add(onContextLost)
  const leaveRenderer = () => {
    pool.papers.delete(onContextLost)
    releaseRenderer(pool)
  }

  // 元件狀態（由 DayMomentCard 透過 handle 餵進來）。active 也在這裡讀：原本先用「非停留」的時間戳畫好、上傳，
  // 接手時 setActive 又整張正面重畫重傳一次（手機 DPR3 約 4.6 MB），畫面上只看得到第二次（2026-11-05）。
  let flipped = initial.flipped ?? false
  let revealed = initial.developed ?? false
  let active = initial.active ?? false
  let corner: CornerPose = CORNER_REST
  let disposed = false

  // 每次尺寸變動就整組重建（貼圖尺寸與幾何都綁著像素寬）
  let scene: Awaited<ReturnType<typeof buildScene>> | null = null
  let resizeFrame = 0
  let lastWidth = 0

  const view = document.createElement('canvas')
  view.className = 'paper-view'
  view.setAttribute('aria-hidden', 'true')
  // 插入前就放在最終位置：之後 sizeView 只改大小、不移動起點，不算版面位移
  // （原本先停在靜態位置、場景建好才移到 -MARGIN，手機首頁 CLS 0.29 全來自這裡，2026-10-02）
  view.style.left = view.style.top = `${-MARGIN}px`
  wrap.append(view)
  const viewCtx = view.getContext('2d')
  if (!viewCtx) {
    view.remove()
    leaveRenderer()
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
    // 斜切也要在 measureFlatPrint 拿掉 transform 之前讀
    const stampSkew = skewOf(front!.querySelector('.print-stamp'))
    const { W, H, style, box, lines } = measureFlatPrint(wrap, () => {
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
      // 紙膠帶的兩色只定義在 .print-tape 上，探針（view）看不到：先在膠帶上讀出代換好 var() 的值再交給探針解析。
      const tapeVar = (name: string) => getComputedStyle(tapeEl!).getPropertyValue(name).trim()

      const style = {
        frontBg: colorOf(front, 'backgroundColor', view, 'var(--print-face-bg)'),
        backBg: colorOf(back, 'backgroundColor', view, 'var(--print-back-bg)'),
        figureBg: colorOf(figure, 'backgroundColor', view, 'var(--line)'),
        photoPosition: getComputedStyle(img!).objectPosition.trim().split(/\s+/),
        lineColor: resolveColorOn(view, 'rgb(var(--ink) / .07)'),
        stampFont: fontOf(stamp, "400 22px 'Source Sans 3', sans-serif"),
        stampColor: colorOf(stamp, 'color', view, 'var(--ivy-print-spark)'),
        stampSpacing: spacingOf(stamp),
        stampGlow: glowOf(stamp, () => resolveColorOn(view, 'var(--ivy-print-spark-glow)')),
        kickerFont: fontOf(kickerEl, "400 10px 'PingFang TC', sans-serif"),
        kickerColor: colorOf(kickerEl, 'color', view, 'var(--muted)'),
        kickerSpacing: spacingOf(kickerEl),
        titleFont: fontOf(titleEl, "700 22px 'LINE Seed TW', 'PingFang TC', sans-serif"),
        titleSpacing: spacingOf(titleEl),
        titleColor: colorOf(titleEl, 'color', view, 'var(--green)'),
        titleLine: pxOf(titleEl, 'lineHeight', 32),
        storyFont: fontOf(storyEl, "400 15px 'PingFang TC', sans-serif"),
        storyColor: colorOf(storyEl, 'color', view, 'var(--text)'),
        storyLine: pxOf(storyEl, 'lineHeight', 31),
        questionFont: fontOf(questionEl, "600 13px 'PingFang TC', sans-serif"),
        questionColor: colorOf(questionEl, 'color', view, 'var(--green)'),
        questionLine: pxOf(questionEl, 'lineHeight', 22),
        answerFont: fontOf(answerEl, "400 13px 'PingFang TC', sans-serif"),
        answerColor: colorOf(answerEl, 'color', view, 'var(--muted)'),
        answerLine: pxOf(answerEl, 'lineHeight', 25),
        tapeA: tapeEl ? resolveColorOn(view, tapeVar('--tape-a')) : '',
        tapeB: tapeEl ? resolveColorOn(view, tapeVar('--tape-b')) : '',
        tapeShadow: tapeEl ? shadowColorOf(tapeEl, () => resolveColorOn(view, 'rgb(var(--ink) / .15)')) : '',
        // 不直接讀 .print::after：游標停在卡片上時那裡是 hover 的加深版，接手後又被 display:none
        restShadows: resolveShadowsOn(view, 'var(--print-shadow)')
      }
      const tapeBox = boxIn(tapeEl, frontRect, k)
      // 背面三段照 DOM 實際的斷行畫（見 linesOf）
      const lines = { story: linesOf(storyEl), question: linesOf(questionEl), answer: linesOf(answerEl) }
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

      return { W, H, style, box, lines }
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

    // 平放時的陰影照 CSS 版的 box-shadow 畫（2026-11-14）：手機是卡片已在畫面上才換成 WebGL 紙，原本光源投的影子又小又偏左下，
    // 換手那一刻卡片右側與下方的背景亮 15～20 階。柔邊的幾道先畫成一張縮小的圖（畫在畫布外的矩形只留下陰影），
    // 沒有模糊的（紙緣那道 2px）每次直接填色才不會被縮放抹開。陰影也鋪在紙底下：紙角掀起時露出來的就是它。
    const softShadows = style.restShadows.filter((shadow) => shadow.blur > 0)
    const hardShadows = style.restShadows.filter((shadow) => shadow.blur <= 0)
    let restShadow: HTMLCanvasElement | null = null
    if (softShadows.length) {
      const q = REST_SHADOW_SCALE
      restShadow = document.createElement('canvas')
      restShadow.width = Math.ceil(VW * q)
      restShadow.height = Math.ceil(VH * q)
      const sctx = restShadow.getContext('2d')
      if (sctx) {
        // shadowOffset／shadowBlur 的單位是畫布像素、不吃 transform：矩形畫在畫布左邊外面，陰影位移回原位
        const far = restShadow.width + 64
        sctx.fillStyle = '#000'
        for (const shadow of softShadows) {
          sctx.shadowColor = shadow.color
          sctx.shadowBlur = shadow.blur * q
          sctx.shadowOffsetX = shadow.x * q + far
          sctx.shadowOffsetY = shadow.y * q
          sctx.fillRect((MARGIN - shadow.spread) * q - far, (MARGIN - shadow.spread) * q, (W + shadow.spread * 2) * q, (H + shadow.spread * 2) * q)
        }
      } else {
        restShadow = null
      }
    }
    // 紙平放（aloft 0）畫 CSS 的陰影，抬起來就淡出、交給光源投的影子。CSS 版翻到背面時 .print::after 跟著紙轉了半圈，陰影左右相反。
    function drawRestShadow(alpha: number, mirrored: boolean) {
      const ctx = viewCtx!
      if (mirrored) ctx.setTransform(-1, 0, 0, 1, view.width, 0)
      ctx.globalAlpha = alpha
      if (restShadow) ctx.drawImage(restShadow, 0, 0, view.width, view.height)
      for (const shadow of hardShadows) {
        setFill(ctx, shadow.color, 'transparent')
        ctx.fillRect((MARGIN + shadow.x - shadow.spread) * DPR, (MARGIN + shadow.y - shadow.spread) * DPR, (W + shadow.spread * 2) * DPR, (H + shadow.spread * 2) * DPR)
      }
      ctx.globalAlpha = 1
      ctx.setTransform(1, 0, 0, 1, 0, 0)
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
        fillSpaced(ctx, copy.kicker, k.x, baselineIn(ctx, k.y, k.h), style.kickerSpacing)
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
        let y = baselineIn(ctx, 0, style.titleLine)
        for (const line of copy.titleLines) {
          fillTitleLine(ctx, line, y, style.titleSpacing)
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
    // 兩個值以外的寫法（四值 right 10px bottom 0 等）退回原本的 50% 40%
    const [posX, posY] = style.photoPosition.length === 2 ? style.photoPosition : []
    const photoX = objectOffset(posX, box.figure.w - photoW, 0.5)
    const photoY = objectOffset(posY, box.figure.h - photoH, 0.4)
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
      ctx.drawImage(img!, ox + photoX, oy + photoY, photoW, photoH)
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
        // 光暈照 CSS 的 text-shadow；shadowBlur 的單位是畫布像素、不吃 transform，要自己乘 DPR
        ctx.shadowColor = style.stampGlow.color
        ctx.shadowBlur = style.stampGlow.blur * DPR
        // 跟 CSS 一樣繞時間戳的中心斜切（transform-origin 預設在框中心），字靠版面框右緣、基線照行框算
        ctx.translate(st.x + st.w / 2, st.y + st.h / 2)
        ctx.transform(1, 0, stampSkew, 1, 0, 0)
        ctx.translate(-(st.x + st.w / 2), -(st.y + st.h / 2))
        fillSpaced(ctx, copy.time, st.x + st.w, baselineIn(ctx, st.y, st.h), style.stampSpacing)
        ctx.restore()
      }
      ctx.restore()
    }

    function drawBack() {
      const ctx = bctx
      clearAll(ctx)
      setFill(ctx, style.backBg, '#fff6df')
      ctx.fillRect(0, 0, W, H)
      ctx.strokeStyle = style.lineColor
      ctx.lineWidth = 1
      // 橫線距＝故事行高、對齊故事段落的行框（同 styles.css 的 .print-story::before）：線佔每格最後 1px
      const pitch = style.storyLine > 4 ? style.storyLine : 32
      const anchor = box.story ? box.story.y : 0
      for (let y = (((anchor % pitch) + pitch) % pitch) - 0.5; y < H; y += pitch) {
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
        fillSpaced(ctx, copy.kicker, bk.x, baselineIn(ctx, bk.y, bk.h), style.kickerSpacing)
      }
      const s = box.story
      if (s) {
        setFill(ctx, style.storyColor, '#3f5045')
        ctx.font = style.storyFont
        let y = baselineIn(ctx, s.y, style.storyLine)
        for (const line of lines.story ?? wrapLines(ctx, copy.story, s.w)) {
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
        let y = baselineIn(ctx, q.y, style.questionLine)
        for (const line of lines.question ?? wrapLines(ctx, copy.question, q.w)) {
          ctx.fillText(line, q.x, y)
          y += style.questionLine
        }
      }
      const an = box.answer
      if (an) {
        setFill(ctx, style.answerColor, '#6e7c5b')
        ctx.font = style.answerFont
        let y = baselineIn(ctx, an.y, style.answerLine)
        for (const line of lines.answer ?? wrapLines(ctx, copy.answer, an.w)) {
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
    // alphaTest 讓膠帶外緣硬邊透空，不走透明排序。
    // 純漫射材質（2026-11-14）：原本的 MeshStandardMaterial 有鏡面反射，主光在平放的紙上加一層固定的亮度（線性約 +0.025），
    // 淺色的紙看不出來，照片暗部卻整片亮 15～30 階——手機換成 WebGL 紙那一刻照片像蒙一層霧。翻面、掀角的明暗靠漫射的 N·L 就有。
    // 暖身場景（buildWarmScene）要用同一種材質，program 才會命中快取。
    const matF = new three.MeshLambertMaterial({ map: frontTex, alphaTest: 0.5 })
    const matB = new three.MeshLambertMaterial({ map: backTex, alphaTest: 0.5 })
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
    // 紙平放、正對觀者時要跟 CSS 版同色（2026-10-20）：手機是停下滑動、卡片已在畫面上才換成 WebGL，
    // 原本主光偏暖（0xfff4e0）、環境光 1.35，換手那一刻紙面從 247,237,217 暗成 234,219,193，整張黃一下。
    // 漫射 BRDF 是 albedo／π，所以主光改白光、環境光補到「環境＋主光 × 平放時的 N·L ＝ π」，平放就是貼圖原色；
    // 翻面、掀角時 N·L 變小照樣有明暗。
    const key = new three.DirectionalLight(0xffffff, KEY_LIGHT)
    key.position.set(W * 0.6, H * 0.9, dist * 0.7)
    sceneObj.add(new three.AmbientLight(0xffffff, Math.PI - KEY_LIGHT * (key.position.z / key.position.length())))
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

    // 紙張變形＝右下角捲曲（翻面起手／進場輕掀）＋翻面時的單側懸臂彎曲。
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
      const reach = (CORNER_REACH[0] + CORNER_REACH[1] * corner.reach) * scale
      // 折線固定沿 45° 對角
      const nx = Math.SQRT1_2
      const ny = -Math.SQRT1_2
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
      // 結果與 geoF/geoB.computeVertexNormals() 逐位元相同，只是不經過 three 的 Vector3（gridNormals.ts）
      const nf = geoF.attributes.normal!
      const nb = geoB.attributes.normal!
      computeIndexedNormals(af, geoF.index!.array, nf.array as Float32Array)
      computeIndexedNormals(ab, geoB.index!.array, nb.array as Float32Array)
      nf.needsUpdate = nb.needsUpdate = true
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
    let developDrawn = 0
    let dirtyFront = false
    let dirtyCorner = corner.hinge > 0
    const rendererSize = new three.Vector2()
    // 上一次真的畫出去的狀態：這一幀什麼都沒變就不 render、不複製畫布（view 畫布保留上一張）。
    // 共用 renderer 只在 render 之後馬上複製到自己的 view，所以跳過這張卡不影響別張。
    let shapeVersion = 0
    const drawn = { shape: -1, rx: Number.NaN, ry: Number.NaN, z: Number.NaN, glare: Number.NaN, gx: Number.NaN, gy: Number.NaN }

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
        shapeVersion++
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
      // 平放時不畫光源投的影子（由 drawRestShadow 畫 CSS 那道），抬起的頭三成高度交叉淡過來
      const rise = Math.min(1, height / ALOFT_AT)
      const aloft = rise * rise * (3 - 2 * rise)
      shadowMat.opacity = SHADOW_OPACITY * (1 - 0.35 * height) * aloft
      key.shadow.radius = SHADOW_RADIUS + 8 * height
      if (!busy && turn === turnGoal) {
        // 停穩後收回 0／-1，數字不會越翻越大（旋轉等價，看不出跳動）
        turn = turnGoal = turnFrom = lastRot = restTurn(turn)
      }
      if (developStart) {
        const d = Math.min(1, (now - developStart) / developMs())
        // 最後一格一定畫；中間依 DEVELOP_FRAME_MS 降頻（第一格 developDrawn 是 0，馬上畫）
        if (d >= 1 || now - developDrawn >= DEVELOP_FRAME_MS) {
          develop = ease(d)
          dirtyFront = true
          developDrawn = now
        }
        if (d >= 1) developStart = 0
        else busy = true
      }
      const redrawn = dirtyFront
      if (dirtyFront) {
        drawPhoto(develop, active)
        frontTex.needsUpdate = true
        dirtyFront = false
      }
      const same =
        !redrawn &&
        drawn.shape === shapeVersion &&
        drawn.rx === paper.rotation.x &&
        drawn.ry === paper.rotation.y &&
        drawn.z === paper.position.z &&
        drawn.glare === glare.intensity &&
        drawn.gx === glare.position.x &&
        drawn.gy === glare.position.y
      if (!same) {
        // context 遺失時 three 的 render 直接回來，共用畫布留著最後一張成功畫出的卡：不能複製（見 handleContextLost）。
        // 事件晚一拍才到，所以每次要畫之前自己問一次；handleContextLost 會通知所有掛著的紙，包含這一張。
        if (lost || gl.isContextLost()) {
          handleContextLost(pool)
          return
        }
        // 共用 renderer 切到不同尺寸的卡片時才重設 backing buffer。
        // three 的 setSize 即使尺寸相同也會寫入 canvas.width／height。
        renderer.getSize(rendererSize)
        if (rendererSize.x !== VW || rendererSize.y !== VH) renderer.setSize(VW, VH, false)
        renderer.render(sceneObj, camera)
        viewCtx!.setTransform(1, 0, 0, 1, 0, 0)
        viewCtx!.clearRect(0, 0, view.width, view.height)
        if (aloft < 1) drawRestShadow(1 - aloft, isBackTurn(Math.round(rot)))
        viewCtx!.drawImage(renderer.domElement, 0, 0, view.width, view.height)
        drawn.shape = shapeVersion
        drawn.rx = paper.rotation.x
        drawn.ry = paper.rotation.y
        drawn.z = paper.position.z
        drawn.glare = glare.intensity
        drawn.gx = glare.position.x
        drawn.gy = glare.position.y
      }
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
    if (disposed || lost) {
      built.dispose()
      return null
    }
    // 改完尺寸馬上同步畫第一幀：改 width/height 會清空畫布，若等下一個 rAF 才畫，中間會有一格空白。
    sizeView()
    render()
    // 第一幀才發現 context 已遺失：畫布是空的，這個場景不能用
    if (lost) {
      built.dispose()
      return null
    }
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
    leaveRenderer()
    return null
  }
  delivered = true
  lastWidth = scene.W
  const resizer = new ResizeObserver(() => {
    if (!resizeFrame && !disposed) resizeFrame = requestAnimationFrame(() => void rebuild())
  })
  resizer.observe(front)
  // 這裡不再 kick：buildScene 最後已經同步畫好當下的狀態，再排一幀只是畫出一模一樣的畫面（2026-11-05）。
  // 之後任何狀態改變（翻面、顯影、停留、掀角、游標）都會自己 kick。

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
      // 前後都是平的就不必重畫（輕掀收尾那幾格，角度已經小到看不出來）
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
      leaveRenderer()
    }
  }
}
