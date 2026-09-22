import type { Ref } from 'vue'
import { readMotionViewport, type MotionViewport } from '~/utils/motionViewport'

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
    let viewport: MotionViewport
    let frame = 0
    let disposed = false
    let lastProgress = -1

    function paint() {
      frame = 0
      if (disposed || root!.dataset.footerMotion !== 'fallback') return
      const distance = Math.min(footer!.offsetHeight, viewport.height)
      const progress = Math.max(0, Math.min(1, (viewport.height - footer!.getBoundingClientRect().top) / Math.max(1, distance)))
      if (progress !== lastProgress) root!.style.setProperty('--home-footer-progress', String(progress))
      lastProgress = progress
    }
    function schedule() {
      if (!disposed && !frame && root!.dataset.footerMotion === 'fallback') frame = requestAnimationFrame(paint)
    }
    function measure() {
      if (disposed) return
      viewport = readMotionViewport(viewportRoot)
      root!.style.setProperty('--home-footer-screen', `${viewport.height}px`)
      schedule()
    }
    function configure() {
      cancelAnimationFrame(frame)
      frame = 0
      root!.dataset.footerMotion = reduced.matches || forced.matches ? 'off' : native ? 'native' : 'fallback'
      root!.style.removeProperty('--home-footer-progress')
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
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', measure)
      reduced.removeEventListener('change', configure)
      forced.removeEventListener('change', configure)
    }
  })

  onBeforeUnmount(() => cleanup())
}
