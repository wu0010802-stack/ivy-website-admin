/**
 * 對齊 app.js 的 setupCurtain()：讓 panel 黏住捲動、由下往上被
 * clip-path 擦掉，露出下一個區塊——首頁 Hero 之後每一道接縫都用同一
 * 種切換（belief→day、day→campuses）。CSS 已經在 studio.css 裡
 * （.belief-reveal/.day-reveal 系列規則），這裡只補 JS 端的量測與
 * clip-path 計算。
 *
 * `root`/`track`/`panel` 對應 `<div class="xxx-reveal">` /
 * `<div class="xxx-reveal-track">` / 實際要被擦掉的區塊（例如
 * `.home-belief`），prefix 對應 CSS 自訂屬性名稱（例如 'belief' →
 * `--belief-own`/`--belief-stick`）。
 */
import { readMotionViewport, type MotionViewport } from '../utils/motionViewport'

type CurtainProgress = ((progress: number | null, screen: number) => void) & { measure?: () => void }
/** 換掉直線 clip-path 的擦除邊（day 簾幕的水彩滲接，composables/useWatercolorSeep.ts）。回傳 true 表示已自行處理這一幀（含 clip-path，useCurtain 不再寫）。 */
export type CurtainEdge = (panel: HTMLElement, progress: number | null, screen: number) => boolean

export function useCurtain(
  rootRef: Ref<HTMLElement | null>,
  trackRef: Ref<HTMLElement | null>,
  panelRef: Ref<HTMLElement | null>,
  prefix: string,
  onProgress?: CurtainProgress,
  edge?: Ref<CurtainEdge | null>
) {
  let disposed = false
  let frame = 0
  let measureFrame = 0
  let start = 0
  let distance = 1
  let screen = 1
  let lastBody = 0
  let viewport: MotionViewport | undefined
  let lastProgress: number | null | undefined
  let reduceQuery: MediaQueryList | null = null
  let panelObserver: ResizeObserver | null = null
  let bodyObserver: ResizeObserver | null = null

  const clamp = (n: number) => Math.max(0, Math.min(1, n))

  function update() {
    frame = 0
    if (disposed) return
    const root = rootRef.value
    const panel = panelRef.value
    if (!root || !panel) return
    if (root.dataset.motion !== 'on') {
      if (lastProgress === null) return
      lastProgress = null
      panel.style.clipPath = ''
      edge?.value?.(panel, null, screen)
      panel.inert = false
      onProgress?.(null, screen)
      return
    }
    const progress = clamp((window.scrollY - start) / distance)
    if (progress === lastProgress) return
    lastProgress = progress
    // edge 接手時由它自己寫 clip-path（遮罩底下仍要裁掉，否則被遮掉的地方還會吃到點擊）
    if (!edge?.value?.(panel, progress, screen)) panel.style.clipPath = `inset(0 0 ${(progress * screen).toFixed(1)}px 0)`
    if (panel.inert !== (progress >= 0.995)) panel.inert = progress >= 0.995
    onProgress?.(progress, screen)
  }

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(update)
  }

  function measure() {
    measureFrame = 0
    if (disposed) return
    const root = rootRef.value
    const track = trackRef.value
    const panel = panelRef.value
    if (!root || !track || !panel) return
    viewport = readMotionViewport(root)
    screen = viewport.height
    // sticky 與裁切不影響 panel 自身高度，無須拆掉整道簾幕再量測。
    const own = panel.getBoundingClientRect().height
    root.style.setProperty(`--${prefix}-own`, `${own}px`)
    root.style.setProperty(`--${prefix}-stick`, `${Math.min(0, screen - own)}px`)
    root.dataset.motion = reduceQuery?.matches ? 'still' : 'on'
    const rect = track.getBoundingClientRect()
    start = rect.top + window.scrollY + own - screen
    distance = Math.max(1, rect.height - own)
    lastBody = document.body.offsetHeight
    onProgress?.measure?.()
    lastProgress = undefined
    update()
  }

  function onResize() {
    if (rootRef.value && readMotionViewport(rootRef.value) !== viewport) scheduleMeasure()
  }

  function scheduleMeasure() {
    if (!disposed && !measureFrame) measureFrame = requestAnimationFrame(measure)
  }

  onMounted(() => {
    reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })
    reduceQuery.addEventListener('change', measure)
    // 擦除邊的遮罩圖非同步產生，好了之後補畫目前這一幀
    if (edge) watch(edge, () => { lastProgress = undefined; schedule() })
    if (panelRef.value) {
      panelObserver = new ResizeObserver(scheduleMeasure)
      panelObserver.observe(panelRef.value)
    }
    // 上方區塊（例如前一道簾幕）改變高度時，黏住的起點也要跟著重量。
    bodyObserver = new ResizeObserver(() => {
      if (document.body.offsetHeight !== lastBody) scheduleMeasure()
    })
    bodyObserver.observe(document.body)
    document.fonts.ready.then(() => {
      if (!disposed) measure()
    })
    measure()
  })

  onUnmounted(() => {
    disposed = true
    cancelAnimationFrame(frame)
    cancelAnimationFrame(measureFrame)
    panelObserver?.disconnect()
    bodyObserver?.disconnect()
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', onResize)
    reduceQuery?.removeEventListener('change', measure)
  })
}
