/**
 * 對齊 app.js 的 setupHomeReveal()：首屏 Hero 捲動時整段黏住並淡出，
 * 讓「關於常春藤」簾幕接手。優先用原生 CSS `animation-timeline: view()`
 * （新瀏覽器，CSS 已在 studio.css 的 `.home-reveal[data-motion="native"]`
 * 系列規則），不支援時退回這裡手算 clip-path/opacity/transform 插值。
 *
 * `refs` 需要 root(.home-reveal)/track(.home-reveal-track)/
 * hero(.studio-hero)/copy(.studio-hero-copy)/image(.studio-hero-image)/
 * media(.studio-media)/actions(.studio-actions)。
 */
export interface HomeRevealRefs {
  root: Ref<HTMLElement | null>
  track: Ref<HTMLElement | null>
  hero: Ref<HTMLElement | null>
  copy: Ref<HTMLElement | null>
  image: Ref<HTMLElement | null>
  media: Ref<HTMLElement | null>
  actions: Ref<HTMLElement | null>
}

export function useHomeReveal(refs: HomeRevealRefs) {
  let disposed = false
  let frame = 0
  let measureFrame = 0
  let start = 0
  let distance = 1
  let copyRise = 0
  let reduceQuery: MediaQueryList | null = null
  let mobileQuery: MediaQueryList | null = null
  let copyObserver: ResizeObserver | null = null
  let native = false

  const clamp = (n: number) => Math.max(0, Math.min(1, n))

  function update() {
    frame = 0
    if (disposed) return
    const { root, hero, copy, image, media, actions } = refs
    if (!root.value || !hero.value || !copy.value || !image.value || !media.value || !actions.value) return

    const animated = root.value.dataset.motion !== 'still'
    const progress = animated ? clamp((window.scrollY - start) / distance) : 0
    root.value.classList.toggle('is-revealing', animated && progress > 0.08)
    hero.value.inert = animated && progress >= 0.995
    actions.value.inert = animated && progress >= 0.15
    media.value.inert = animated && progress >= 0.2

    if (root.value.dataset.motion === 'fallback') {
      const mobile = mobileQuery?.matches ?? false
      const fade = clamp(progress / 0.48)
      hero.value.style.clipPath = `inset(0 0 ${clamp((progress - 0.1) / 0.9) * 100}% 0)`
      hero.value.style.setProperty('--reveal-film-opacity', String(1 - fade))
      image.value.style.opacity = String(1 - fade)
      copy.value.style.opacity = String(1 - (mobile ? 0.72 : 0.75) * fade)
      copy.value.style.transform = `translateY(${-copyRise * fade}px) scale(${1 - (mobile ? 0.04 : 0.1) * fade})`
      copy.value.style.color = `rgb(${255 - 223 * fade} ${253 - 190 * fade} ${245 - 195 * fade})`
      media.value.style.opacity = String(1 - clamp(progress / 0.2))
    }
  }

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(update)
  }

  function measure() {
    measureFrame = 0
    if (disposed) return
    const { root, track, hero, copy, image, media } = refs
    if (!root.value || !track.value || !hero.value || !copy.value || !image.value || !media.value) return

    root.value.dataset.motion = 'still'
    ;[hero.value, copy.value, image.value, media.value].forEach((el) => el.removeAttribute('style'))
    const height = document.documentElement.clientHeight
    const mobile = mobileQuery?.matches ?? false
    copyRise = mobile ? height * 0.2 : 0
    // 只有內容真的超出可視高度才需要退回 fallback。
    const fits = hero.value.getBoundingClientRect().height <= height + 1
    root.value.style.setProperty('--reveal-height', `${height}px`)
    const quiet = document.documentElement.classList.contains('hero-quiet')
    root.value.dataset.motion = reduceQuery?.matches || !fits || quiet ? 'still' : native ? 'native' : 'fallback'
    const rect = track.value.getBoundingClientRect()
    start = rect.top + window.scrollY
    distance = Math.max(1, rect.height - height)
    update()
  }

  function scheduleMeasure() {
    if (!disposed && !measureFrame) measureFrame = requestAnimationFrame(measure)
  }

  onMounted(() => {
    reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    mobileQuery = window.matchMedia('(max-width: 1000px)')
    native =
      typeof CSS !== 'undefined' &&
      CSS.supports('animation-timeline: view()') &&
      CSS.supports('animation-range: contain 0% contain 100%')

    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', scheduleMeasure, { passive: true })
    reduceQuery.addEventListener('change', measure)
    mobileQuery.addEventListener('change', measure)
    if (refs.copy.value) {
      copyObserver = new ResizeObserver(scheduleMeasure)
      copyObserver.observe(refs.copy.value)
    }
    document.fonts.ready.then(() => {
      if (!disposed) measure()
    })
    measure()
  })

  onUnmounted(() => {
    disposed = true
    cancelAnimationFrame(frame)
    cancelAnimationFrame(measureFrame)
    copyObserver?.disconnect()
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', scheduleMeasure)
    reduceQuery?.removeEventListener('change', measure)
    mobileQuery?.removeEventListener('change', measure)
  })
}
