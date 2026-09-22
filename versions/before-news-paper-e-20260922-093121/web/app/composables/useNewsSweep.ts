import type { Ref } from 'vue'

/** One vertical colour boundary shared by the section, cards and text. */
export function useNewsSweep(section: Ref<HTMLElement | null>, content: () => unknown) {
  let cleanup = () => {}
  let measure = () => {}

  onMounted(() => {
    const root = section.value
    if (!root) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const forced = window.matchMedia('(forced-colors: active)')
    const native = CSS.supports('animation-timeline: view()') && CSS.supports('animation-range: 0% 100%')
    let frame = 0
    let height = 0
    let disposed = false

    function updateFallback() {
      frame = 0
      if (root!.dataset.sweepMotion !== 'fallback') return
      const viewport = document.documentElement.clientHeight
      // Match the native view timeline: entry 15% → cover 65%, with no inset.
      const start = viewport - Math.min(viewport, height) * 0.15
      const end = viewport - (viewport + height) * 0.65
      const progress = Math.max(0, Math.min(1, (start - root!.getBoundingClientRect().top) / (start - end)))
      root!.style.setProperty('--hn-sweep-progress', String(progress))
    }

    function scheduleFallback() {
      if (!frame && root!.dataset.sweepMotion === 'fallback') frame = requestAnimationFrame(updateFallback)
    }

    function configure() {
      root!.dataset.sweepMotion = reduced.matches || forced.matches ? 'off' : native ? 'native' : 'fallback'
      root!.style.removeProperty('--hn-sweep-progress')
      scheduleFallback()
    }

    measure = () => {
      if (disposed) return
      const bounds = root.getBoundingClientRect()
      const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-sweep-ink], .hn-event'))
      // Read geometry together; writes only happen after all reads are complete.
      const geometry = targets.map(el => ({ el, bounds: el.getBoundingClientRect() }))
      height = bounds.height
      root.style.setProperty('--hn-section-height', `${height}px`)
      for (const target of geometry) {
        target.el.style.setProperty('--hn-offset-y', `${target.bounds.top - bounds.top}px`)
        target.el.style.setProperty('--hn-ink-height', `${target.bounds.height}px`)
      }
      root.classList.add('hn-sweep-ready')
      scheduleFallback()
    }

    const observer = new ResizeObserver(measure)
    observer.observe(root)
    measure()
    configure()
    document.fonts.ready.then(() => measure())
    window.addEventListener('resize', measure, { passive: true })
    if (!native) window.addEventListener('scroll', scheduleFallback, { passive: true })
    reduced.addEventListener('change', configure)
    forced.addEventListener('change', configure)

    cleanup = () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', scheduleFallback)
      reduced.removeEventListener('change', configure)
      forced.removeEventListener('change', configure)
    }
  })

  watch(content, () => nextTick(() => measure()), { deep: true })
  onBeforeUnmount(() => cleanup())
}
