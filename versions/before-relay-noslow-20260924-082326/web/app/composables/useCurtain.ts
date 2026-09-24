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

type CurtainProgress = ((progress: number | null, screen: number, raw?: number) => void) & {
  measure?: (screen: number) => void
  /** 捲動進度 → 擦除進度；沒給就是線性。 */
  remap?: (progress: number) => number
}

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
    const raw = clamp((window.scrollY - start) / distance)
    if (raw === lastProgress) return
    lastProgress = raw
    const progress = onProgress?.remap ? onProgress.remap(raw) : raw
    panel.style.clipPath = `inset(0 0 ${(progress * screen).toFixed(1)}px 0)`
    if (panel.inert !== (progress >= 0.995)) panel.inert = progress >= 0.995
    onProgress?.(progress, screen, raw)
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
    onProgress?.measure?.(screen)
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
 * 「常春藤」的進度，寫成 CSS 變數給 `.relay-day .t-day-ch` 之類的規則用。
 * 只用在 belief 簾幕的 onProgress。
 *
 * 2026-09-23 起讓人看得見「關於＋常春藤＋的一天」接成一句（比稿 ?relay=slow,type 定案）：
 * 擦除線過「常春藤」放慢，過完在兩行之間停一拍，停拍的那段捲動用來逐字寫出「的一天」。
 */
export function useRelayProgress(panelRef: Ref<HTMLElement | null>) {
  const clamp = (n: number) => Math.max(0, Math.min(1, n))
  const smooth = (a: number, b: number, x: number) => {
    const t = clamp((x - a) / (b - a))
    return t * t * (3 - 2 * t)
  }
  let wordBottom = 0
  let wordHeight = 0
  // 擦除線碰到「常春藤」底緣／越過頂緣時的擦除進度。
  let enter = 0
  let exit = 0
  // table[i] 是擦除進度 i/N 對應的捲動進度（單調遞增），反查得擦除進度；hold 是停拍的捲動進度起訖。
  let table: number[] | null = null
  let hold: [number, number] = [0, 1]
  const N = 600

  function buildTable() {
    table = null
    if (exit <= enter) return
    // 字框（前後各 .04 平滑過渡，速度不會突然變）固定分到停拍前 45% 的捲動：
    // 手機字小、字框只佔螢幕 7%，用固定倍率放慢一樣一滑就過。
    const soft = 0.04
    const band = Array.from({ length: N + 1 }, (_, i) => smooth(enter - soft, enter, i / N) * (1 - smooth(exit, exit + soft, i / N)))
    const bandSum = band.reduce((a, b) => a + b, 0)
    const target = 0.45
    const extra = Math.max(0, (target * (N + 1) - bandSum) / (bandSum * (1 - target)))
    // 停拍：過完字頂後，擦除線在兩行之間只再走 .8% 螢幕高，卻吃掉整段 22% 的捲動。
    const base = N + 1 + extra * bandSum
    const share = 0.22
    const from = exit + 0.001
    const to = exit + 0.009
    const shape = band.map((_, i) => {
      const x = (i / N - from) / (to - from)
      return x <= 0 || x >= 1 ? 0 : 1 - Math.cos(2 * Math.PI * x)
    })
    const shapeSum = shape.reduce((a, b) => a + b, 0)
    const mass = (base * share) / (1 - share)
    const density = band.map((b, i) => 1 + extra * b + (shapeSum ? (mass * (shape[i] ?? 0)) / shapeSum : 0))
    let run = 0
    const cumulative = density.map((d, i) => (run += i ? (d + (density[i - 1] ?? d)) / 2 : 0))
    table = cumulative.map(c => c / run)
    hold = [table[Math.floor(from * N)] ?? 0, table[Math.ceil(to * N)] ?? 1]
  }

  function remap(raw: number) {
    const t = table
    if (!t) return raw
    let lo = 0
    let hi = N
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if ((t[mid] ?? 1) <= raw) lo = mid
      else hi = mid
    }
    const a = t[lo] ?? 0
    const span = (t[hi] ?? 1) - a
    return (lo + (span ? (raw - a) / span : 0)) / N
  }

  function measure(screen: number) {
    const word = panelRef.value?.querySelector<HTMLElement>('.wm-b')
    const backdrop = panelRef.value?.querySelector<HTMLElement>('.belief-backdrop')
    if (!word || !backdrop) return
    const wordRect = word.getBoundingClientRect()
    const backdropRect = backdrop.getBoundingClientRect()
    // 簾幕擦除期間，backdrop 固定在自己的 sticky top。只量相對位置，
    // 避免每一幀先寫 clip-path，再讀 rect 強迫瀏覽器同步重排。
    wordHeight = wordRect.height
    wordBottom = wordRect.bottom - backdropRect.top + (Number.parseFloat(getComputedStyle(backdrop).top) || 0)
    enter = clamp((screen - wordBottom) / screen)
    exit = clamp((screen - wordBottom + wordHeight) / screen)
    buildTable()
  }

  const update = (progress: number | null, screen: number, raw = progress ?? 0) => {
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
    // 「的一天」逐字進度：有停拍就跟著停拍的捲動走；量不到字框時退回過字後段。
    const day = table ? clamp((raw - hold[0]) / (hold[1] - hold[0])) : clamp((t - 0.4) / 0.6)
    style.setProperty('--relay-day', day.toFixed(3))
  }
  return Object.assign(update, { measure, remap })
}
