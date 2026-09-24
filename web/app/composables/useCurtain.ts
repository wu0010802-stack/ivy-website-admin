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

export function useCurtain(
  rootRef: Ref<HTMLElement | null>,
  trackRef: Ref<HTMLElement | null>,
  panelRef: Ref<HTMLElement | null>,
  prefix: string,
  onProgress?: CurtainProgress
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
      panel.inert = false
      onProgress?.(null, screen)
      return
    }
    const progress = clamp((window.scrollY - start) / distance)
    if (progress === lastProgress) return
    lastProgress = progress
    panel.style.clipPath = `inset(0 0 ${(progress * screen).toFixed(1)}px 0)`
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

/**
 * ?seam=2 接力效果（2026-09-18 定案為預設）：算擦除邊界掃過浮水印
 * 「常春藤」的進度，寫成 CSS 變數給 `.relay-day .t-day` 之類的規則用。
 * 只用在 belief 簾幕的 onProgress。
 */
export function useRelayProgress(panelRef: Ref<HTMLElement | null>) {
  const clamp = (n: number) => Math.max(0, Math.min(1, n))
  let wordBottom = 0
  let wordHeight = 0
  function measure() {
    const word = panelRef.value?.querySelector<HTMLElement>('.wm-b')
    const backdrop = panelRef.value?.querySelector<HTMLElement>('.belief-backdrop')
    if (!word || !backdrop) return
    const wordRect = word.getBoundingClientRect()
    const backdropRect = backdrop.getBoundingClientRect()
    // 簾幕擦除期間，backdrop 固定在自己的 sticky top。只量相對位置，
    // 避免每一幀先寫 clip-path，再讀 rect 強迫瀏覽器同步重排。
    wordHeight = wordRect.height
    wordBottom = wordRect.bottom - backdropRect.top + (Number.parseFloat(getComputedStyle(backdrop).top) || 0)
  }
  const update = (progress: number | null, screen: number) => {
    const style = document.documentElement.style
    if (progress === null) {
      style.setProperty('--relay-day', '1')
      style.setProperty('--relay-glow', '0')
      return
    }
    const seamY = screen - progress * screen
    const t = progress <= 0 ? 0 : progress >= 1 ? 1 : wordHeight ? clamp((wordBottom - seamY) / wordHeight) : 0
    style.setProperty('--seam-inset', `${(progress * screen).toFixed(1)}px`)
    style.setProperty('--relay', t.toFixed(3))
    style.setProperty('--relay-glow', `${Math.min(1, t * 8, (1 - t) * 8).toFixed(3)}`)
    style.setProperty('--relay-day', `${clamp((t - 0.7) / 0.3).toFixed(3)}`)
  }
  return Object.assign(update, { measure })
}
