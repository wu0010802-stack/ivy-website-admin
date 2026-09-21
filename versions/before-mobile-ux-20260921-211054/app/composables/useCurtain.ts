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
export function useCurtain(
  rootRef: Ref<HTMLElement | null>,
  trackRef: Ref<HTMLElement | null>,
  panelRef: Ref<HTMLElement | null>,
  prefix: string,
  onProgress?: (progress: number | null, screen: number) => void
) {
  let disposed = false
  let frame = 0
  let measureFrame = 0
  let start = 0
  let distance = 1
  let screen = 1
  let lastBody = 0
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
      panel.style.clipPath = ''
      panel.inert = false
      onProgress?.(null, screen)
      return
    }
    const progress = clamp((window.scrollY - start) / distance)
    panel.style.clipPath = `inset(0 0 ${(progress * screen).toFixed(1)}px 0)`
    panel.inert = progress >= 0.995
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
    // 先回到靜止狀態量自然高度，再決定要黏在哪裡。
    root.dataset.motion = 'still'
    panel.style.clipPath = ''
    panel.inert = false
    screen = document.documentElement.clientHeight
    const own = panel.getBoundingClientRect().height
    root.style.setProperty(`--${prefix}-own`, `${own}px`)
    root.style.setProperty(`--${prefix}-stick`, `${Math.min(0, screen - own)}px`)
    root.dataset.motion = reduceQuery?.matches ? 'still' : 'on'
    const rect = track.getBoundingClientRect()
    start = rect.top + window.scrollY + own - screen
    distance = Math.max(1, rect.height - own)
    lastBody = document.body.offsetHeight
    update()
  }

  function scheduleMeasure() {
    if (!disposed && !measureFrame) measureFrame = requestAnimationFrame(measure)
  }

  onMounted(() => {
    reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', scheduleMeasure, { passive: true })
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
    window.removeEventListener('resize', scheduleMeasure)
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
  return (progress: number | null, screen: number) => {
    const style = document.documentElement.style
    if (progress === null) {
      style.setProperty('--relay-day', '1')
      style.setProperty('--relay-glow', '0')
      return
    }
    const word = panelRef.value?.querySelector<HTMLElement>('.wm-b')
    const seamY = screen - progress * screen
    const rect = word?.getBoundingClientRect()
    const t = progress <= 0 ? 0 : progress >= 1 ? 1 : rect?.height ? clamp((rect.bottom - seamY) / rect.height) : 0
    style.setProperty('--seam-inset', `${(progress * screen).toFixed(1)}px`)
    style.setProperty('--relay', t.toFixed(3))
    style.setProperty('--relay-glow', `${Math.min(1, t * 8, (1 - t) * 8).toFixed(3)}`)
    style.setProperty('--relay-day', `${clamp((t - 0.7) / 0.3).toFixed(3)}`)
  }
}
