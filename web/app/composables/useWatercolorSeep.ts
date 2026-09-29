import { seepEdgeJob } from '../utils/watercolor'
import type { CurtainEdge } from './useCurtain'

/**
 * 首頁「孩子的一天 → 五校」水彩滲接（2026-09-29 定案，比稿 B）：簾幕擦除邊從一條直線改成水彩濕邊往上滲。
 * 兩張不同種子的遮罩帶（utils/watercolor.ts 的 seepEdgeCanvas）一起往上推，第二張帶一點橫向漂移與上下錯位，
 * 兩張聯集的輪廓一路在變，不像一條固定的波浪線在平移（同 /curriculum 換頁三團遮罩不同速度的做法）。
 *
 * 每幀只寫三個數值（studio.css 註冊過的 --day-seep-y／-bx／-by，inherits:false），寫在被遮罩的元素本身，值沒變就不寫。
 * 遮罩圖在閒置時間分塊產生（每塊不超過 8ms）、toBlob 非同步編碼；產生好之前照舊用直線 clip-path。
 * 減少動態、強制色彩（掛上時或中途切換）、不支援 mask：交回 useCurtain 用直線 clip-path。
 */
export function useWatercolorSeep() {
  const edge = shallowRef<CurtainEdge | null>(null)
  const urls: string[] = []
  let disposed = false
  let idle: number | ReturnType<typeof setTimeout> | undefined

  onMounted(() => {
    const plain = [matchMedia('(forced-colors: active)'), matchMedia('(prefers-reduced-motion: reduce)')]
    if (plain.some((query) => query.matches)) return
    if (!CSS.supports('mask-image', 'linear-gradient(#000,#000)') && !CSS.supports('-webkit-mask-image', 'linear-gradient(#000,#000)')) return
    const requestIdle = (fn: () => void) => window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 32)
    const jobs = [seepEdgeJob(11), seepEdgeJob(23)]
    const finished: HTMLCanvasElement[] = []
    const run = () => {
      idle = undefined
      if (disposed) return
      const t0 = performance.now()
      while (jobs.length && performance.now() - t0 < 8) {
        if (jobs[0]!.steps.next().done) finished.push(jobs.shift()!.canvas)
      }
      if (jobs.length) { idle = requestIdle(run); return }
      void Promise.all(finished.map(encode)).then(([a, b]) => {
        if (disposed || !a || !b) return
        edge.value = createSeepEdge(a, b, plain)
      })
    }
    const encode = (canvas: HTMLCanvasElement) => new Promise<string>((resolve) => {
      canvas.toBlob((blob) => {
        const url = blob ? URL.createObjectURL(blob) : ''
        if (url) urls.push(url)
        resolve(url)
      })
    })
    idle = requestIdle(run)
  })

  onBeforeUnmount(() => {
    disposed = true
    if (idle !== undefined) {
      if (window.cancelIdleCallback && typeof idle === 'number') window.cancelIdleCallback(idle)
      else clearTimeout(idle)
    }
    urls.forEach((url) => URL.revokeObjectURL(url))
  })

  return edge
}

/**
 * 濕邊的位置（panel 內的 px）：濕邊在遮罩帶高度的 30%–70%。progress 0 時整條落在 panel 底下（畫面照舊），
 * 1 時整條離開 panel 可見範圍的頂端（panel 黏住時，看得到的是最底下的 screen 高）。
 */
export function seepOffsets(progress: number, own: number, screen: number) {
  const band = Math.round(Math.min(340, Math.max(200, screen * 0.32)))
  return {
    band,
    y: own - band * 0.3 - progress * (screen + band * 0.45),
    bx: -progress * 180,
    by: (progress - 0.5) * band * 0.2
  }
}

/**
 * 產生 useCurtain 的 edge：寫遮罩位置與 clip-path、回傳 true；簾幕停用或使用者中途開了減少動態／強制色彩時
 * 拿掉遮罩、回傳 false（useCurtain 接回直線 clip-path）。
 */
export function createSeepEdge(urlA: string, urlB: string, plain: { matches: boolean }[] = []): CurtainEdge {
  let applied: HTMLElement | null = null
  let own = 0
  let observer: ResizeObserver | null = null
  const written = new Map<string, string>()
  const write = (panel: HTMLElement, name: string, value: string) => {
    if (written.get(name) === value) return
    written.set(name, value)
    panel.style.setProperty(name, value)
  }
  const release = (panel: HTMLElement) => {
    panel.classList.remove('is-seep')
    observer?.disconnect()
    observer = null
    applied = null
  }
  return (panel, progress, screen) => {
    if (progress === null || plain.some((query) => query.matches)) {
      if (applied) release(panel)
      return false
    }
    if (applied !== panel) {
      own = panel.offsetHeight
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => { own = panel.offsetHeight })
        observer.observe(panel)
      }
      panel.style.setProperty('--day-seep-a', `url(${urlA})`)
      panel.style.setProperty('--day-seep-b', `url(${urlB})`)
      panel.classList.add('is-seep')
      written.clear()
      applied = panel
    }
    const { band, y, bx, by } = seepOffsets(progress, own, screen)
    write(panel, '--day-seep-h', `${band}px`)
    write(panel, '--day-seep-y', `${y.toFixed(1)}px`)
    write(panel, '--day-seep-bx', `${bx.toFixed(1)}px`)
    write(panel, '--day-seep-by', `${by.toFixed(1)}px`)
    // 遮罩只管看不看得到，不管點擊：兩張遮罩帶最底下以下再用 clip-path 裁掉，露出來的五校才點得到
    write(panel, 'clip-path', `inset(0 0 ${Math.max(0, own - (y + band + Math.max(0, by))).toFixed(1)}px 0)`)
    return true
  }
}
