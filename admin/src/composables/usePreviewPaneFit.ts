import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

// 內容編輯頁右側預覽欄（LivePreviewPane）的黏住位置與高度，用「量到的」而不是估的。
//
// 預覽欄是 sticky（貼在頂欄下方），下面有黏底的動作列。欄高若只是「視窗高 − 頂欄 − 動作列」，有兩種情況會被蓋住：
// - 還沒捲動：欄的自然位置在頁首說明、工具列的下面（離頂欄還有 30–105px），欄底就伸到動作列底下；
// - 捲到最底：sticky 不能超出所在版面，版面底端到頁面底端還隔著動作列、它上方的 16px 與主區下內距，欄被往上推，頂端鑽到頂欄底下。
// 所以高度取三個限制的最小值（一個固定高度要在所有捲動位置都放得下，才不用邊捲邊改 iframe 的大小）：
//   黏住時：視窗高 − 黏住的 top − 動作列（含它上方的空隙）
//   沒捲動：視窗高 − 動作列 − 欄自然位置的頂端（文件座標）
//   捲到底：視窗高 − 版面底端到頁面底端的距離 − 黏住的 top

export const PREVIEW_PANE_GAP = 24
/** 欄底和動作列之間留的空隙（原本估算值 --editor-actions-h 的 49px 裡也含這 16px）。 */
export const PREVIEW_BAR_GAP = 16
/** 量不到頂欄時的高度，同 style.css 的 --top-h。 */
const FALLBACK_TOP_BAR = 64

export interface PreviewPaneMetrics {
  /** 視窗高度（window.innerHeight） */
  viewportHeight: number
  /** 頂欄實際高度 */
  topBarHeight: number
  /** 黏底動作列實際高度；沒有動作列（唯讀）是 0 */
  actionsHeight: number
  /** 版面（預覽欄所在的格子）頂端在文件上的位置＝沒捲動時預覽欄的位置 */
  layoutTop: number
  /** 版面底端到頁面底端的距離（動作列上方空隙、動作列、主區下內距） */
  tail: number
}

export function previewPaneFit(m: PreviewPaneMetrics): { top: number; height: number } {
  const top = m.topBarHeight + PREVIEW_PANE_GAP
  const reserve = m.actionsHeight + PREVIEW_BAR_GAP
  const stuck = m.viewportHeight - top - reserve
  const atRest = m.viewportHeight - reserve - m.layoutTop
  const atEnd = m.viewportHeight - m.tail - top
  return { top, height: Math.max(0, Math.floor(Math.min(stuck, atRest, atEnd))) }
}

function topBarHeight(): number {
  const bar = document.querySelector<HTMLElement>('header.top')
  if (bar?.offsetHeight) return bar.offsetHeight
  const token = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-h'))
  return Number.isFinite(token) && token > 0 ? token : FALLBACK_TOP_BAR
}

/**
 * 量頂欄、動作列與版面位置，算出預覽欄的 top 與高度，回傳要綁在 .editor 根元素上的 CSS 變數
 * （--live-preview-top、--live-preview-h；LivePreviewPane 用，沒有變數時退回 CSS 裡的估算值）。
 * 量的時機：視窗大小、根元素／動作列／頂欄的大小變了（ResizeObserver）；預覽欄沒顯示時什麼都不掛。
 * 沒有版面可量（jsdom）時不給變數。
 */
export function usePreviewPaneFit(options: {
  active: Ref<boolean>
  root: Ref<HTMLElement | null>
  layout: Ref<HTMLElement | null>
  actions: Ref<HTMLElement | null>
}): Ref<Record<string, string>> {
  const vars = ref<Record<string, string>>({})
  let observer: ResizeObserver | null = null
  let listening = false

  function measure() {
    const root = options.root.value
    const layout = options.layout.value
    if (!root || !layout) return
    const layoutRect = layout.getBoundingClientRect()
    if (!layoutRect.width && !layoutRect.height) return
    const rootRect = root.getBoundingClientRect()
    const main = root.closest('main')
    const mainPadding = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0
    const fit = previewPaneFit({
      viewportHeight: window.innerHeight,
      topBarHeight: topBarHeight(),
      actionsHeight: options.actions.value?.offsetHeight ?? 0,
      layoutTop: layoutRect.top + window.scrollY,
      tail: rootRect.bottom - layoutRect.bottom + mainPadding,
    })
    const next = { '--live-preview-top': `${Math.round(fit.top)}px`, '--live-preview-h': `${fit.height}px` }
    const current = vars.value
    if (current['--live-preview-top'] !== next['--live-preview-top'] || current['--live-preview-h'] !== next['--live-preview-h']) vars.value = next
  }

  function stop() {
    observer?.disconnect()
    observer = null
    if (listening) window.removeEventListener('resize', measure)
    listening = false
  }

  function start() {
    window.addEventListener('resize', measure)
    listening = true
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure)
      for (const el of [options.root.value, options.actions.value, document.querySelector('header.top')]) if (el) observer.observe(el)
    }
    measure()
  }

  // 版面讀好、動作列出現（唯讀時沒有）、預覽欄出現或收起都會換掉要量的元素：重掛一次。
  watch(
    [options.active, options.root, options.layout, options.actions],
    () => {
      stop()
      if (options.active.value && options.root.value && options.layout.value) start()
      else if (Object.keys(vars.value).length) vars.value = {}
    },
    { flush: 'post', immediate: true },
  )
  onBeforeUnmount(stop)
  return vars
}
