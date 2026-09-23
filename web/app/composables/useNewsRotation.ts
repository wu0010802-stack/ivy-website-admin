import type { Ref } from 'vue'
import type { NewsArticle } from '~/types/site-content'
import { createCarouselClock } from '~/utils/carouselClock'
import { newsPageCount, newsPageItems } from '~/utils/newsRotation'

const INTERVAL = 6000
const STAGGER = 160
const WIPE = 'cubic-bezier(.65,0,.35,1)'
const SETTLE = 'cubic-bezier(.22,.61,.36,1)'

/**
 * 2026-09-23 C「原地換片」：卡片位置不動，每 6 秒三格由左到右換成下一組。
 * 每格同時放新舊兩層（slots[k] = [舊, 新]），新照片由上往下刷開、舊字淡完才浮出新字，動畫完再收成一層。
 * 只在三欄卡片版面（641px 以上）播；手機維持橫向捲動。滑鼠停留、鍵盤焦點、對話框開著、離屏、分頁在背景都暫停，減少動態不播。
 */
export function useNewsRotation(articles: () => NewsArticle[], zone: Ref<HTMLElement | null>, dialogOpen: Ref<boolean>) {
  const page = ref(0)
  const pages = computed(() => newsPageCount(articles().length))
  const slots = ref<NewsArticle[][]>(newsPageItems(articles(), 0).map(item => [item]))
  const progress = ref(0)
  const wide = ref(false)
  const reduced = ref(false)
  const visible = ref(false)
  const hidden = ref(true)
  const hovered = ref(false)
  const focused = ref(false)
  const turning = ref(false)
  const enabled = computed(() => pages.value > 1 && wide.value && !reduced.value)
  const playing = computed(() => enabled.value && visible.value && !hidden.value
    && !hovered.value && !focused.value && !dialogOpen.value && !turning.value)
  const clock = createCarouselClock({
    duration: INTERVAL,
    onAdvance: () => { void turn() },
    onProgress: value => { progress.value = value }
  })
  // 換組途中被重設（改成手機寬、內容更新）時，舊的 swap 不能再寫回。
  let generation = 0

  function reset() {
    generation++
    turning.value = false
    page.value = 0
    slots.value = newsPageItems(articles(), 0).map(item => [item])
    clock.reset()
  }

  async function swap(slotIndex: number, item: NewsArticle, delay: number, run: number) {
    const layers = slots.value[slotIndex]
    if (!layers || layers[0]?.id === item.id) return
    // 對話框用滑鼠關掉後焦點會回到舊標題；舊層一變 inert，Chrome 就把焦點丟回 body，所以新層一出現就先交接。
    const hadFocus = Boolean(zone.value?.children[slotIndex]?.contains(document.activeElement))
    layers.push(item)
    await nextTick()
    const slot = zone.value?.children[slotIndex] as HTMLElement | undefined
    const [oldImg, newImg] = slot ? [...slot.querySelectorAll<HTMLImageElement>('.hn-media img')] : []
    const [oldCopy, newCopy] = slot ? [...slot.querySelectorAll<HTMLElement>('.hn-card-copy')] : []
    if (hadFocus) newCopy?.querySelector('button')?.focus({ preventScroll: true })
    if (oldImg && newImg && oldCopy && newCopy) {
      await newImg.decode().catch(() => {})
      if (run !== generation) return
      const animations = [
        newImg.animate([{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }], { duration: 1000, delay, easing: WIPE, fill: 'both' }),
        newImg.animate([{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 1700, delay, easing: SETTLE, fill: 'both' }),
        oldImg.animate([{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.03)', filter: 'brightness(.82)' }], { duration: 1000, delay, easing: WIPE, fill: 'forwards' }),
        oldCopy.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: 340, delay: delay + 80, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }),
        newCopy.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 640, delay: delay + 460, easing: SETTLE, fill: 'backwards' })
      ]
      await Promise.all(animations.map(animation => animation.finished)).catch(() => {})
    }
    if (run !== generation) return
    slots.value[slotIndex] = [item]
    await nextTick()
    for (const element of [newImg, newCopy]) element?.getAnimations().forEach(animation => animation.cancel())
  }

  async function turn() {
    if (turning.value || !enabled.value) return
    const run = generation
    turning.value = true
    page.value = (page.value + 1) % pages.value
    const items = newsPageItems(articles(), page.value)
    await Promise.all(items.map((item, slotIndex) => swap(slotIndex, item, slotIndex * STAGGER, run)))
    if (run === generation) turning.value = false
  }

  watch(playing, active => active ? clock.start() : clock.pause())
  watch(enabled, active => { if (!active) reset() })
  watch(() => articles().map(item => item.id).join(), reset)

  let dispose = () => {}
  onMounted(() => {
    const wideQuery = matchMedia('(min-width: 641px)')
    const motionQuery = matchMedia('(prefers-reduced-motion: reduce)')
    const mediaChanged = () => {
      wide.value = wideQuery.matches
      reduced.value = motionQuery.matches
    }
    const visibilityChanged = () => { hidden.value = document.hidden }
    const pointerEntered = (event: PointerEvent) => { if (event.pointerType === 'mouse') hovered.value = true }
    const pointerLeft = () => { hovered.value = false }
    const focusChanged = (event: FocusEvent) => {
      const target = event.type === 'focusout' ? event.relatedTarget : event.target
      focused.value = target instanceof Element && Boolean(zone.value?.contains(target)) && target.matches(':focus-visible')
    }
    mediaChanged()
    visibilityChanged()
    const observer = new IntersectionObserver(entries => {
      const entry = entries[entries.length - 1]
      visible.value = Boolean(entry && entry.isIntersecting && entry.intersectionRatio >= .35)
    }, { threshold: [0, .35, .6] })
    const stopObserving = watch(zone, (element, previous) => {
      if (previous) {
        observer.unobserve(previous)
        previous.removeEventListener('pointerenter', pointerEntered)
        previous.removeEventListener('pointerleave', pointerLeft)
        previous.removeEventListener('focusin', focusChanged)
        previous.removeEventListener('focusout', focusChanged)
      }
      visible.value = false
      if (!element) return
      observer.observe(element)
      element.addEventListener('pointerenter', pointerEntered)
      element.addEventListener('pointerleave', pointerLeft)
      element.addEventListener('focusin', focusChanged)
      element.addEventListener('focusout', focusChanged)
    }, { immediate: true, flush: 'post' })
    wideQuery.addEventListener('change', mediaChanged)
    motionQuery.addEventListener('change', mediaChanged)
    document.addEventListener('visibilitychange', visibilityChanged)
    dispose = () => {
      stopObserving()
      observer.disconnect()
      wideQuery.removeEventListener('change', mediaChanged)
      motionQuery.removeEventListener('change', mediaChanged)
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  })
  onBeforeUnmount(() => {
    generation++
    dispose()
    clock.destroy()
  })

  return { slots, page, pages, progress, enabled, playing }
}
