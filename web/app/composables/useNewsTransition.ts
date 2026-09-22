import type { Ref } from 'vue'
import { readMotionViewport, type MotionViewport } from '~/utils/motionViewport'

/** Paper enters in normal flow while the preceding campus pauses behind it. */
export function useNewsTransition(
  rootRef: Ref<HTMLElement | null>,
  previousRef: Ref<HTMLElement | null>,
  paperRef: Ref<HTMLElement | null>
) {
  let cleanup = () => {}

  onMounted(() => {
    const root = rootRef.value
    const previous = previousRef.value
    const paper = paperRef.value
    if (!root || !previous || !paper) return

    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const forced = matchMedia('(forced-colors: active)')
    const native = CSS.supports('animation-timeline: view()') && CSS.supports('animation-range: entry 0% entry 100%') && CSS.supports('timeline-scope: --news-paper')
    let viewport: MotionViewport
    let frame = 0
    let measureFrame = 0
    let disposed = false
    let lastProgress = -1

    function paint() {
      frame = 0
      if (disposed) return
      const off = root!.dataset.newsMotion === 'off'
      const progress = off ? 1 : Math.max(0, Math.min(1, 1 - paper!.getBoundingClientRect().top / viewport.height))
      // The previous section must stop receiving focus once covered by the paper.
      previous!.inert = !off && progress >= .995
      if (root!.dataset.newsMotion === 'fallback' && progress !== lastProgress) {
        root!.style.setProperty('--news-paper-progress', String(progress))
      }
      lastProgress = progress
    }
    function schedule() {
      if (!disposed && !frame) frame = requestAnimationFrame(paint)
    }
    function measure() {
      measureFrame = 0
      if (disposed) return
      viewport = readMotionViewport(root!)
      const previousHeight = previous!.offsetHeight
      root!.style.setProperty('--news-screen', `${viewport.height}px`)
      root!.style.setProperty('--news-prior-stick', `${Math.min(0, viewport.height - previousHeight)}px`)
      schedule()
    }
    function scheduleMeasure() {
      if (!disposed && !measureFrame) measureFrame = requestAnimationFrame(measure)
    }
    function onResize() {
      if (readMotionViewport(root!) !== viewport) scheduleMeasure()
    }
    function configure() {
      root!.dataset.newsMotion = reduced.matches || forced.matches ? 'off' : native ? 'native' : 'fallback'
      root!.style.removeProperty('--news-paper-progress')
      lastProgress = -1
      measure()
    }

    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(previous)
    observer.observe(paper)
    configure()
    document.fonts.ready.then(scheduleMeasure)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })
    reduced.addEventListener('change', configure)
    forced.addEventListener('change', configure)

    cleanup = () => {
      disposed = true
      cancelAnimationFrame(frame)
      cancelAnimationFrame(measureFrame)
      observer.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', onResize)
      reduced.removeEventListener('change', configure)
      forced.removeEventListener('change', configure)
      previous.inert = false
    }
  })
  onBeforeUnmount(() => cleanup())
}
