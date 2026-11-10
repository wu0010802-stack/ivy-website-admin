import type { Ref } from 'vue'
import { readMotionViewport, type MotionViewport } from '~/utils/motionViewport'
import { cancelScrollFrame, requestScrollFrame, type ScrollFrameTask } from '~/utils/scrollFrame'

/** Fade the news surface into the footer without moving either section. */
export function useHomeFooterFade(rootRef: Ref<HTMLElement | null>, footerRef: Ref<HTMLElement | null>) {
  let cleanup = () => {}

  onMounted(() => {
    const root = rootRef.value
    const footer = footerRef.value
    if (!root || !footer) return

    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const forced = matchMedia('(forced-colors: active)')
    const native = CSS.supports('animation-timeline: view()')
      && CSS.supports('animation-range: entry 0% entry 100%')
      && CSS.supports('timeline-scope: --home-footer')
    const viewportRoot = root.querySelector<HTMLElement>('.home-reveal') ?? root
    // 備援進度寫在消息紙上（HomeNewsTransition.vue 在紙上宣告衍生值）：讀者只有紙裡的陰影與 .home-news::after，
    // 變數是繼承型 @property，寫在 .home-page 的話整頁每幀重算。
    const target = root.querySelector<HTMLElement>('.news-transition-paper') ?? root
    let viewport: MotionViewport
    let disposed = false
    let lastProgress = -1
    let progress = -1

    // 讀寫分開排進共用的捲動幀（utils/scrollFrame.ts，2026-11-10），不在別人寫完之後才量頁尾。
    function measureFooter() {
      if (disposed || root!.dataset.footerMotion !== 'fallback') return
      const distance = Math.min(footer!.offsetHeight, viewport.height)
      progress = Math.max(0, Math.min(1, (viewport.height - footer!.getBoundingClientRect().top) / Math.max(1, distance)))
    }
    function paint() {
      if (disposed || root!.dataset.footerMotion !== 'fallback' || progress < 0) return
      if (progress !== lastProgress) target.style.setProperty('--home-footer-progress', String(progress))
      lastProgress = progress
    }
    const task: ScrollFrameTask = { read: measureFooter, write: paint }
    function schedule() {
      if (!disposed && root!.dataset.footerMotion === 'fallback') requestScrollFrame(task)
    }
    function measure() {
      if (disposed) return
      viewport = readMotionViewport(viewportRoot)
      root!.style.setProperty('--home-footer-screen', `${viewport.height}px`)
      schedule()
    }
    function configure() {
      cancelScrollFrame(task)
      progress = -1
      root!.dataset.footerMotion = reduced.matches || forced.matches ? 'off' : native ? 'native' : 'fallback'
      target.style.removeProperty('--home-footer-progress')
      lastProgress = -1
      measure()
    }

    const observer = new ResizeObserver(measure)
    observer.observe(root)
    observer.observe(footer)
    configure()
    document.fonts.ready.then(measure)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', measure, { passive: true })
    reduced.addEventListener('change', configure)
    forced.addEventListener('change', configure)

    cleanup = () => {
      disposed = true
      cancelScrollFrame(task)
      observer.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', measure)
      reduced.removeEventListener('change', configure)
      forced.removeEventListener('change', configure)
    }
  })

  onBeforeUnmount(() => cleanup())
}
