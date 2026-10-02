<script setup lang="ts">
import { lineArtBlends, lineArtInkImage, pickImage } from '~/utils/media-image'
import { responsiveImage } from '~/utils/responsive-image'
import { createCarouselClock } from '~/utils/carouselClock'
import { campusMapUrl } from '~/utils/site-links'
import { canMorphCampusPhoto, isPlainLeftClick, morphCampusPhoto } from '~/utils/campusPhotoMorph'
import { developSketch, paintSketchStill, pickLineArt, preloadSketch, sketchRegistration, sketchScale, type DevelopHandle } from '~/utils/campusSketch'
import type { Campus, CampusBoardContent } from '~/types/site-content'

const props = defineProps<{ board: CampusBoardContent; campuses: Campus[] }>()
const orderedCampuses = computed(() => props.board.campusOrder
  .map(key => props.campuses.find(campus => campus.key === key))
  .filter((campus): campus is Campus => Boolean(campus)))
const index = ref(Math.max(0, orderedCampuses.value.findIndex(campus => campus.key === props.board.defaultCampus)))
const current = computed(() => orderedCampuses.value[index.value] ?? orderedCampuses.value[0])
const root = ref<HTMLElement | null>(null)
const photoViewport = ref<HTMLElement | null>(null)
const galleryTrack = ref<HTMLElement | null>(null)
const controlsTrigger = ref<HTMLElement | null>(null)
const playbackControls = ref<HTMLElement | null>(null)
const controlsReveal = ref<'static' | 'pending' | 'entering' | 'shown'>('static')
const visible = ref(false)
const hidden = ref(true)
const focused = ref(false)
// 滑鼠停在下方校名／地址／預約欄時暫停：照片區照舊自動播放（2026-09-22 裁定），但「預約參觀Ｘ校」
// 不能在游標底下換成別校（2026-09-29 評析實測停 12 秒連結換了 4 次，使用者同意改）。
const hoveringDetails = ref(false)
const paused = ref(false)
// 手指正在水平拖曳照片（見 onPointerMove）；拖曳中暫停計時，手指底下的照片不會被自動換掉。
const dragging = ref(false)
const reducedMotion = ref(false)
const optedIn = ref(false)
const repositioning = shallowRef(new Set<number>())
const announcement = ref('')
// 換校時，被選中的分頁線稿由左往右畫出來、畫完再染淡彩；-1 表示目前沒有在畫。
const drawing = ref(-1)
let drewOnce = false
// 淡彩速寫（utils/campusSketch.ts）：第一次捲到從預畫線稿上水彩，再暈開回照片；手動換校沿用預覽線稿。
// 自動輪播不重播（左右預覽改成線稿後只暈開，見下）；畫的期間暫停輪播計時。後台換過照片／線稿（對位不上）的學校不畫。
const developing = ref(false)
let develop: DevelopHandle | null = null
// 左右預覽卡＝靜態線稿（2026-09-29 晚，使用者要求）：原本鄰卡是彩色照片，手動換校滑到中央後才被蓋成線稿，
// 看起來「彩色→黑白→彩色」。現在不在中央的卡先在 canvas 畫好線稿（paintSketchStill）才進這個集合，
// 卡片掛 data-art="line" 藏照片；換到中央由 runDevelop 從線稿接手上色。存校名 key，後台換順序不錯位。
const lineArt = shallowRef(new Set<string>())
// 第一張也先準備線稿；SSR 即標記，head 的 JS 標記啟用遮照片，避免 hydration／慢下載時先閃彩色。
const initialSketch = ref(current.value && sketchRegistration(current.value) ? current.value.key : null)
let lineArtStarted = false
let lineArtSize = ''
function setLineArt(key: string, on: boolean) {
  if (lineArt.value.has(key) === on) return
  const next = new Set(lineArt.value)
  if (on) next.add(key)
  else next.delete(key)
  lineArt.value = next
}
async function showLineArt(i: number) {
  const campus = orderedCampuses.value[i]
  const registration = campus && sketchRegistration(campus)
  if (!campus || !registration || reducedMotion.value || matchMedia('(forced-colors: active)').matches) return false
  const card = root.value?.querySelectorAll<HTMLElement>('.photo-card')[i]
  const canvas = card?.querySelector<HTMLCanvasElement>('canvas.sketch-canvas')
  const sources = sketchSources(i)
  if (!card || !canvas || !sources) return false
  // 第一張開始上色前也先畫完整線稿；其他卡換到中央後 canvas 歸 runDevelop，不再重畫。
  const painted = await paintSketchStill({
    card, canvas, registration, lineSrc: sources.lineSrc,
    objectPosition: campus.panoramaPos || 'center 55%',
    wanted: () => !reducedMotion.value && !matchMedia('(forced-colors: active)').matches
      && (current.value?.key !== campus.key || initialSketch.value === campus.key)
  })
  if (painted) setLineArt(campus.key, true)
  return painted
}
function refreshLineArt() {
  if (!lineArtStarted) return
  orderedCampuses.value.forEach((campus, i) => { if (i !== index.value || initialSketch.value === campus.key) void showLineArt(i) })
}
// canvas 依卡片尺寸畫：卡片變大小才重畫（手機網址列伸縮只改視窗高度，卡片不變）
function refreshLineArtOnResize() {
  if (!lineArtStarted) return
  const card = root.value?.querySelector<HTMLElement>('.photo-card')
  const size = card ? `${card.clientWidth}x${card.clientHeight}` : ''
  if (size === lineArtSize) return
  lineArtSize = size
  refreshLineArt()
}
// 分頁鈕 2026-10-02 起是透明底墨線版，淡彩速寫要原線稿：照 manifest 的候選挑夠用的寬度。
// 只有內建線稿會畫（後台換過線稿時 sketchRegistration 回 null）。
function sketchSources(i: number) {
  const campus = orderedCampuses.value[i]
  const card = root.value?.querySelector<HTMLElement>('.photo-card')
  if (!campus) return null
  const lineArt = responsiveImage(`campus-line-art-${campus.key}`)
  const needed = (card?.clientWidth ?? 1200) * sketchScale() * 1.1
  return { lineSrc: pickLineArt(lineArt.srcset ?? '', lineArt.src, needed), colourSrc: `/assets/campus-line-art-${campus.key}-colour.webp` }
}
function preloadCampus(i: number) {
  const campus = orderedCampuses.value[i]
  if (reducedMotion.value || !campus || !sketchRegistration(campus)) return
  const sources = sketchSources(i)
  if (sources) void preloadSketch(sources.lineSrc, sources.colourSrc)
}
// from：'photo' 用於沒有預覽線稿的手動切換；'sketch' 從線稿接手。wash=false 只暈開（自動輪播）。
async function runDevelop(i: number, from: 'photo' | 'sketch' = 'photo', wash = true) {
  develop?.cancel()
  const campus = orderedCampuses.value[i]
  const registration = campus && sketchRegistration(campus)
  // 從預覽線稿接手卻畫不了：直接露出照片
  const showPhoto = () => {
    if (!campus || index.value !== i) return
    setLineArt(campus.key, false)
    if (initialSketch.value === campus.key) initialSketch.value = null
  }
  if (!registration || reducedMotion.value || matchMedia('(forced-colors: active)').matches) { showPhoto(); return }
  if (initialSketch.value === campus?.key) {
    if (!await showLineArt(i)) { showPhoto(); return }
    from = 'sketch'
  }
  await nextTick()
  const card = root.value?.querySelectorAll<HTMLElement>('.photo-card')[i]
  const img = card?.querySelector('img')
  const canvas = card?.querySelector<HTMLCanvasElement>('canvas.sketch-canvas')
  const sources = sketchSources(i)
  if (!card || !img || !canvas || !campus || !sources || index.value !== i) { showPhoto(); return }
  const handle = developSketch({
    card, img, canvas, campusKey: campus.key, registration, ...sources, from, wash,
    objectPosition: campus.panoramaPos || 'center 55%',
    skyRgb: getComputedStyle(document.documentElement).getPropertyValue('--ivy-paint-sky-rgb').trim()
  })
  // from 'sketch' 時 developSketch 已同步接手蓋住照片，這時拿掉預覽狀態照片不會閃出來
  setLineArt(campus.key, false)
  if (initialSketch.value === campus.key) initialSketch.value = null
  develop = handle
  // 只暈開（自動輪播）也暫停計時：照片完整露出後才開始算四秒
  developing.value = true
  void handle.done.then(() => {
    if (develop !== handle) return
    develop = null
    developing.value = false
    clock.reset()
  })
}
const canAuto = computed(() => orderedCampuses.value.length > 1 && !paused.value && (!reducedMotion.value || optedIn.value))
const playing = computed(() => canAuto.value && visible.value && !hidden.value && !focused.value && !dragging.value && !developing.value && !initialSketch.value && !hoveringDetails.value)
// 進度條改由 CSS 動畫走（合成器執行）：原本每 50ms 寫一次 scaleX，停在區塊不動時也每幀重繪、主執行緒一直忙。
// 計時仍由 carouselClock 負責換校；進度條只在這裡換 key 重建、從 from（0–1）接著播：換校歸零，
// 手動暫停（進度條滿格）後再開始，則接續暫停前的進度。播放／暫停跟 playing 同一個開關（data-run）。
const DURATION = 4000
const progressRun = shallowRef({ key: 0, from: 0 })
let lastProgress = 0
const clock = createCarouselClock({
  duration: DURATION,
  onAdvance: () => select(index.value + 1, true),
  onProgress: value => {
    lastProgress = value
    if (value === 0) progressRun.value = { key: progressRun.value.key + 1, from: 0 }
  }
})
watch(canAuto, auto => { if (auto) progressRun.value = { key: progressRun.value.key + 1, from: lastProgress } })
function progressStyle(i: number) {
  if (i !== index.value) return undefined
  if (!canAuto.value) return { transform: 'scaleX(1)' }
  const { from } = progressRun.value
  return from ? { '--run-from': `${Math.round(-from * DURATION)}ms` } : undefined
}

function offset(photo: number, selected = index.value) {
  const total = orderedCampuses.value.length
  if (!total) return 0
  const value = (photo - selected + total) % total
  return value > Math.floor(total / 2) ? value - total : value
}
const CARD_SIZES = '(max-width: 700px) calc(100vw - 48px), (max-width: 1100px) 84vw, (min-width: 1846px) 1440px, (min-width: 1600px) 78vw, (min-width: 1500px) 1200px, 80vw'
// 只有當前與左右鄰卡綁 src／srcset：再遠的卡雖然在視窗外，仍落在 loading=lazy 的預載邊距內，
// 否則五張會一起下載（手機約 500 KB）。沒綁 src 的卡仍保留 width／height 佔位。
function cardImage(campus: Campus, photo: number) {
  const image = pickImage(campus.image, campus.imageMedia, CARD_SIZES)
  return Math.abs(offset(photo)) <= 1 ? image : { width: image.width, height: image.height }
}
function select(next: number, automatic = false) {
  const total = orderedCampuses.value.length
  if (!total) { index.value = 0; clock.reset(); return }
  const selected = (next + total) % total
  // Wrapped, offscreen cards teleport behind the viewport rather than crossing it.
  repositioning.value = new Set(orderedCampuses.value.flatMap((_, i) =>
    i !== selected && i !== index.value && Math.abs(offset(i, selected) - offset(i)) > total / 2 ? [i] : []))
  const previous = index.value
  const changed = selected !== previous
  if (changed) drawing.value = selected
  index.value = selected
  clock.reset()
  if (changed) {
    stopUncovered()
    develop?.cancel()
    initialSketch.value = null
    // 離開中央的那張褪回線稿；換進來的是預覽線稿就從線稿接手上色（自動輪播只暈開）。
    // 還沒有線稿（素材沒載到、後台換過照片）時照舊：手動換校從照片畫起，自動輪播只滑動。
    void showLineArt(previous)
    if (lineArt.value.has(orderedCampuses.value[selected]!.key)) void runDevelop(selected, 'sketch', !automatic)
    else if (!automatic) void runDevelop(selected)
  }
  if (!automatic) announcement.value = `目前顯示${current.value!.name}，${current.value!.district}`
}
function onKey(event: KeyboardEvent, from: number) {
  const total = orderedCampuses.value.length
  const next = event.key === 'ArrowRight' ? (from + 1) % total
    : event.key === 'ArrowLeft' ? (from - 1 + total) % total
    : event.key === 'Home' ? 0 : event.key === 'End' ? total - 1 : -1
  if (next < 0) return
  event.preventDefault()
  select(next)
  root.value?.querySelector<HTMLButtonElement>(`[data-campus-tab="${next}"]`)?.focus()
}
function togglePlayback() {
  if (reducedMotion.value && !optedIn.value) {
    optedIn.value = true
    paused.value = false
  } else paused.value = !paused.value
}
function focusChanged(target: EventTarget | null) {
  focused.value = target instanceof Element && Boolean(root.value?.contains(target))
    && target.matches(':focus-visible') && !target.closest('.campus-playback')
}
function finishControlsReveal() {
  controlsReveal.value = 'shown'
}
function onControlsAnimationEnd(event: AnimationEvent) {
  if (event.target === playbackControls.value && event.pseudoElement === '::before') finishControlsReveal()
}

// axis：手指移動超過 8px 後判定的方向，一次手勢只判定一次。
let pointerStart: { id: number; x: number; y: number; axis?: 'x' | 'y' } | null = null
let suppressPhotoClick = false
// 觸控拖曳時照片跟著手指走：水平意圖確定後，把位移寫到 .gallery-track 的 --drag（五張卡的最小共同祖先，
// 值沒變就不寫），拖曳中關掉卡片轉場。垂直滑動交給瀏覽器捲頁面（touch-action:pan-y），瀏覽器接手時送 pointercancel。
// 滑鼠維持放開才判斷；換校門檻仍是放開時水平位移 45px。
let dragX = 0
function setDrag(value: number) {
  if (value === dragX) return
  dragX = value
  if (value) galleryTrack.value?.style.setProperty('--drag', `${value}px`)
  else galleryTrack.value?.style.removeProperty('--drag')
}
function endDrag() {
  pointerStart = null
  dragging.value = false
  setDrag(0)
}
function onPointerDown(event: PointerEvent) {
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
  endDrag()
  pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY }
  suppressPhotoClick = false
}
function onPointerMove(event: PointerEvent) {
  if (!pointerStart || pointerStart.id !== event.pointerId || event.pointerType === 'mouse') return
  const dx = event.clientX - pointerStart.x
  const dy = event.clientY - pointerStart.y
  if (!pointerStart.axis) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return
    pointerStart.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    if (pointerStart.axis === 'x') dragging.value = true
  }
  if (pointerStart.axis === 'x') setDrag(Math.round(dx))
}
function onPointerUp(event: PointerEvent) {
  if (!pointerStart || pointerStart.id !== event.pointerId) return
  const dx = event.clientX - pointerStart.x
  const dy = event.clientY - pointerStart.y
  endDrag()
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
    suppressPhotoClick = true
    select(index.value + (dx < 0 ? 1 : -1))
  }
}
function onPhotoClick(event: MouseEvent, photo: number) {
  if (suppressPhotoClick) { event.preventDefault(); suppressPhotoClick = false; return }
  if (photo !== index.value) { event.preventDefault(); select(photo) }
}
watch(playing, active => active ? clock.start() : clock.pause())
// 第一次捲到五校區塊時，先把預設校的線稿畫一次。
watch(visible, shown => {
  if (!shown || drewOnce) return
  drewOnce = true
  drawing.value = index.value
  developWhenUncovered()
})
// 五校區塊在「孩子的一天」簾幕底下就已經算進視窗（IntersectionObserver 不管遮擋），
// 大照片要等水彩滲接真的露出照片中央才開始畫，不然家長看到時已經畫完一半。
let stopUncovered = () => {}
function developWhenUncovered() {
  const uncovered = () => {
    const viewport = photoViewport.value
    if (!viewport) return false
    const r = viewport.getBoundingClientRect()
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    if (y < 0 || y > window.innerHeight) return false
    const hit = document.elementFromPoint(x, y)
    return Boolean(hit && viewport.contains(hit))
  }
  const start = () => { stopUncovered(); void runDevelop(index.value) }
  if (uncovered()) { start(); return }
  let frame = 0
  const onScroll = () => {
    if (frame) return
    frame = requestAnimationFrame(() => { frame = 0; if (uncovered()) start() })
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  stopUncovered = () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('scroll', onScroll)
    stopUncovered = () => {}
  }
}
// 「預約參觀Ｘ校」：照片接續到預約頁側欄（utils/campusPhotoMorph.ts）。不支援或減少動態時照常換頁。
// 掛在 click.capture：RouterLink 自己的 click 會先導覽，要在它之前 preventDefault。
const nuxtApp = useNuxtApp()
function onBookingClick(event: MouseEvent) {
  if (!isPlainLeftClick(event) || !canMorphCampusPhoto()) return
  const card = root.value?.querySelector<HTMLElement>('.photo-card.is-current')
  if (!card || !current.value) return
  event.preventDefault()
  const to = `/visit/${current.value.key}`
  void morphCampusPhoto(card, async () => {
    const painted = new Promise<void>(resolve => { const off = nuxtApp.hook('page:finish', () => { off(); resolve() }) })
    await navigateTo(to)
    await painted
    // 新畫面要在頂端截圖；路由自己的捲回頂端排在 page:finish 之後，這裡先捲。
    window.scrollTo(0, 0)
  })
}
function onTabArtAnimationEnd(event: AnimationEvent, i: number) {
  if (event.animationName.includes('campus-tab-draw') && drawing.value === i) drawing.value = -1
}
watch(orderedCampuses, (list, previous) => {
  const key = previous[index.value]?.key
  // 後台換了照片或線稿：舊的預覽線稿可能對不上，拿掉重畫
  lineArt.value = new Set()
  if (initialSketch.value && !list.some(campus => campus.key === initialSketch.value && sketchRegistration(campus))) {
    initialSketch.value = null
  }
  select(Math.max(0, list.findIndex(campus => campus.key === key)))
  refreshLineArt()
})

let dispose = () => {}
onMounted(() => {
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  const forcedColors = matchMedia('(forced-colors: active)')
  const motionChanged = () => {
    reducedMotion.value = media.matches
    optedIn.value = false
    if (media.matches || forcedColors.matches) {
      finishControlsReveal()
      lineArt.value = new Set()
      initialSketch.value = null
    } else refreshLineArt()
  }
  const visibilityChanged = () => { hidden.value = document.hidden }
  motionChanged()
  visibilityChanged()
  // 淡彩速寫：區塊離視窗 800px 內就先載目前這一校的線稿與淡彩層（捲到時不必等下載）；沒捲到的人不下載
  const preloadObserver = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return
    preloadObserver.disconnect()
    preloadCampus(index.value)
    // 第一張與左右預覽卡一起畫好，捲到時先看到線稿
    lineArtStarted = true
    refreshLineArtOnResize()
  }, { rootMargin: '800px 0px' })
  if (root.value) preloadObserver.observe(root.value)
  const observer = new IntersectionObserver(entries => {
    const entry = entries[entries.length - 1]
    visible.value = Boolean(entry && entry.isIntersecting && entry.intersectionRatio >= .35)
  }, { threshold: [0, .35, .6] })
  const stopObserving = watch(photoViewport, (element, previous) => {
    if (previous) observer.unobserve(previous)
    visible.value = false
    if (element) observer.observe(element)
  }, { immediate: true, flush: 'post' })
  // Track the toolbar's natural position; sticky controls can enter the viewport
  // while the photo is still scrolling in, before the toolbar is actually reached.
  const controlsObserver = new IntersectionObserver(entries => {
    if (controlsReveal.value !== 'pending') return
    if (!entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= .8)) return
    const controls = playbackControls.value
    if (!controls) return
    for (const [selector, property] of [['.pagination', '--reveal-pill-x'], ['.campus-playback', '--reveal-play-x']] as const) {
      const element = controls.querySelector<HTMLElement>(selector)
      if (element) controls.style.setProperty(property, `${controls.clientWidth / 2 - element.offsetLeft - element.offsetWidth / 2}px`)
    }
    controlsReveal.value = 'entering'
    controlsObserver.disconnect()
  }, { threshold: .8 })
  const stopControlsObserving = watch(controlsTrigger, (element, previous) => {
    if (previous) controlsObserver.unobserve(previous)
    if (!element || controlsReveal.value === 'shown') return
    if (media.matches || forcedColors.matches) { finishControlsReveal(); return }
    controlsReveal.value = 'pending'
    controlsObserver.observe(element)
  }, { immediate: true, flush: 'post' })
  const finishOnResize = () => { if (controlsReveal.value === 'entering') finishControlsReveal() }
  media.addEventListener('change', motionChanged)
  forcedColors.addEventListener('change', motionChanged)
  let lineArtTimer: ReturnType<typeof setTimeout> | undefined
  const lineArtOnResize = () => { clearTimeout(lineArtTimer); lineArtTimer = setTimeout(refreshLineArtOnResize, 200) }
  window.addEventListener('resize', finishOnResize, { passive: true })
  window.addEventListener('resize', lineArtOnResize, { passive: true })
  document.addEventListener('visibilitychange', visibilityChanged)
  dispose = () => {
    stopObserving()
    stopControlsObserving()
    preloadObserver.disconnect()
    observer.disconnect()
    controlsObserver.disconnect()
    media.removeEventListener('change', motionChanged)
    forcedColors.removeEventListener('change', motionChanged)
    window.removeEventListener('resize', finishOnResize)
    window.removeEventListener('resize', lineArtOnResize)
    clearTimeout(lineArtTimer)
    document.removeEventListener('visibilitychange', visibilityChanged)
  }
})
onBeforeUnmount(() => { dispose(); clock.destroy(); stopUncovered(); develop?.cancel() })
</script>

<template>
  <section
    v-if="current" id="campuses" ref="root" class="campus-panorama campus-gallery" data-cta-entry="home_campus_board"
    aria-roledescription="輪播" aria-labelledby="campuses-heading"
    :data-campus="current.key" :data-campus-key="current.key" :data-playing="playing"
    @focusin="focusChanged($event.target)" @focusout="focusChanged($event.relatedTarget)"
  >
    <header class="gallery-heading content-width">
      <div class="gallery-title"><span lang="en">{{ board.eyebrow }}</span><h2 id="campuses-heading">{{ board.sectionTitle }}</h2></div>
      <div class="campus-tabs" role="tablist" aria-label="選擇分校">
        <button
          v-for="(campus, i) in orderedCampuses" :id="`campus-tab-${campus.key}`" :key="campus.key"
          type="button" role="tab" :data-campus-tab="i" :aria-selected="i === index"
          :tabindex="i === index ? 0 : -1" aria-controls="campus-stage" :class="{ 'is-drawing': drawing === i }"
          @click="select(i)" @keydown="onKey($event, i)" @animationend="onTabArtAnimationEnd($event, i)"
          @pointerenter="preloadCampus(i)" @pointerdown="preloadCampus(i)"
        >
          <span class="campus-tab-figure" aria-hidden="true">
            <img
              class="campus-tab-art" :class="{ 'is-blend': lineArtBlends(campus) }"
              v-bind="lineArtInkImage(campus, '(max-width: 360px) 48px, (max-width: 700px) 60px, 160px')"
              alt="" aria-hidden="true" loading="lazy" decoding="async"
            >
            <img
              class="campus-tab-colour"
              v-bind="pickImage(`campus-line-art-${campus.key}-colour`, campus.lineArtColourMedia, '160px')"
              alt="" aria-hidden="true" loading="lazy" decoding="async"
            >
          </span>
          <span class="campus-tab-label">{{ campus.name }}</span>
        </button>
      </div>
    </header>
    <div class="gallery-media">
      <div
        ref="photoViewport" class="gallery-viewport" aria-label="校園照片，可左右滑動"
        @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="endDrag"
        @pointerleave="endDrag" @dragstart.prevent
      >
        <div ref="galleryTrack" class="gallery-track" :class="{ 'is-dragging': dragging }">
          <div
            v-for="(campus, i) in orderedCampuses" :key="campus.key"
            class="photo-card" :class="{ 'is-current': i === index, 'is-neighbor': Math.abs(offset(i)) === 1, 'is-repositioning': repositioning.has(i) }"
            :style="{ '--offset': offset(i) }" :data-art="lineArt.has(campus.key) ? 'line' : undefined"
            :data-initial-sketch="initialSketch === campus.key ? '' : undefined"
            tabindex="-1" :aria-hidden="i !== index" :inert="Math.abs(offset(i)) > 1"
            :role="i === index ? undefined : 'button'" :aria-label="i === index ? undefined : `選擇${campus.name}`"
            draggable="false" @click.capture="onPhotoClick($event, i)"
          >
            <canvas v-if="sketchRegistration(campus)" class="sketch-canvas" aria-hidden="true" />
            <img
              v-bind="cardImage(campus, i)"
              :alt="i === index ? `${campus.name}校園外觀` : ''"
              :style="{ objectPosition: campus.panoramaPos || 'center 55%' }"
              :fetchpriority="i === index ? 'auto' : 'low'" loading="lazy" decoding="async" draggable="false"
            >
          </div>
        </div>
      </div>
      <span v-if="orderedCampuses.length > 1" ref="controlsTrigger" class="controls-reveal-trigger" aria-hidden="true" />
      <div v-if="orderedCampuses.length > 1" class="gallery-toolbar content-width">
        <div
          ref="playbackControls" class="playback-controls" :data-reveal="controlsReveal"
          @focusin="finishControlsReveal" @animationend="onControlsAnimationEnd"
        >
          <div class="pagination" role="group" aria-label="分校輪播進度">
            <button
              v-for="(campus, i) in orderedCampuses" :key="campus.key"
              class="page-dot" type="button" :aria-label="`切換至${campus.name}`"
              :aria-pressed="i === index" aria-controls="campus-stage" @click="select(i)"
            >
              <span class="progress-track" aria-hidden="true"><span
                :key="i === index ? `run-${progressRun.key}` : 'idle'"
                :data-run="i === index && canAuto ? (playing ? 'playing' : 'paused') : undefined" :style="progressStyle(i)"
              /></span>
            </button>
          </div>
          <button
            class="campus-playback round-button" type="button"
            :aria-label="canAuto ? '暫停分校自動播放' : '開始分校自動播放'"
            :title="canAuto ? '暫停自動播放' : '開始自動播放'" aria-controls="campus-stage" @click="togglePlayback"
          ><svg class="icon" aria-hidden="true"><use :href="canAuto ? '#i-pause' : '#i-play'" /></svg></button>
        </div>
      </div>
    </div>
    <div
      id="campus-stage" class="campus-details content-width" role="tabpanel" :aria-labelledby="`campus-tab-${current.key}`" tabindex="0"
      @pointerenter="hoveringDetails = $event.pointerType === 'mouse'" @pointerleave="hoveringDetails = false"
    >
      <div class="campus-identity">
        <span class="campus-district">高雄 · {{ current.district }}</span>
        <h3>{{ current.name }}</h3>
        <span lang="en">{{ current.key.toUpperCase() }} CAMPUS</span>
      </div>
      <div class="campus-contact">
        <div class="contact-row">
          <svg class="icon" aria-hidden="true"><use href="#i-map-pin" /></svg>
          <a :href="campusMapUrl(current)" :aria-label="`${current.address}，在 Google 地圖開啟（另開分頁）`" target="_blank" rel="noopener noreferrer">{{ current.address }}<span class="map-hint" aria-hidden="true">地圖 ↗</span></a>
        </div>
        <div class="contact-row"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg><a class="phone" :href="`tel:${current.phone}`">{{ current.phone }}</a></div>
        <div class="social-row">
          <a v-if="current.line" :href="current.line" aria-label="LINE 好友（另開分頁）" target="_blank" rel="noopener noreferrer"><svg class="icon" aria-hidden="true"><use href="#i-line" /></svg>LINE 好友</a>
          <span v-else><svg class="icon" aria-hidden="true"><use href="#i-line" /></svg>LINE · 待園方提供</span>
          <a v-if="current.facebook" :href="current.facebook" aria-label="Facebook（另開分頁）" target="_blank" rel="noopener noreferrer"><svg class="icon" aria-hidden="true"><use href="#i-facebook" /></svg>Facebook</a>
          <a v-if="current.instagram" :href="current.instagram" aria-label="Instagram（另開分頁）" target="_blank" rel="noopener noreferrer"><svg class="icon" aria-hidden="true"><use href="#i-instagram" /></svg>Instagram</a>
          <a v-if="current.youtube" :href="current.youtube" aria-label="YouTube（另開分頁）" target="_blank" rel="noopener noreferrer"><svg class="icon" aria-hidden="true"><use href="#i-youtube" /></svg>YouTube</a>
        </div>
      </div>
      <div class="campus-actions">
        <NuxtLink class="booking-link" :to="`/visit/${current.key}`" @click.capture="onBookingClick">預約參觀{{ current.name }}<svg class="icon" aria-hidden="true"><use href="#i-arrow-right" /></svg></NuxtLink>
      </div>
    </div>
    <p class="campus-live" role="status" aria-live="polite">{{ announcement }}</p>
  </section>
</template>

<style scoped>

.campus-panorama.campus-gallery{--green:var(--ivy-campus-green);--deep:var(--ivy-campus-deep);--paper:var(--ivy-campus-paper);--gold:var(--ivy-campus-gold);--muted:var(--ivy-campus-muted);--line:var(--ivy-campus-line);--control:var(--ivy-campus-control);--control-border:var(--ivy-campus-control-border);--control-dot:var(--ivy-campus-control-dot);--control-hover:var(--ivy-campus-control-hover);--background:var(--ivy-campus-bg);--selected:color-mix(in oklch,var(--green) 7%,var(--background));--font:'PingFang TC','Microsoft JhengHei',system-ui,sans-serif;--font-head:var(--font-serif);--heading-ink:var(--ivy-campus-heading-ink);--heading-accent:var(--ivy-campus-heading-accent);--heading-rule:var(--ivy-campus-heading-rule);--heading-selected:var(--ivy-campus-heading-selected);--font-latin:'Source Sans 3','Helvetica Neue',Arial,sans-serif;--card-width:min(80vw,1200px);--card-gap:20px;--radius:28px;--ease:cubic-bezier(.22,1,.36,1)}
.campus-gallery,.campus-gallery *{box-sizing:border-box}
.campus-panorama.campus-gallery{position:relative;isolation:isolate;min-height:0;color:var(--deep);background:var(--background);font:var(--fs-md)/1.7 var(--font);-webkit-font-smoothing:antialiased}
.campus-gallery :is(button,a){-webkit-tap-highlight-color:transparent}
.campus-gallery button{font:inherit;cursor:pointer;color:inherit}
.campus-gallery a{color:inherit;text-decoration:none}
.campus-gallery :is(button,a,[tabindex]):focus-visible{outline:3px solid var(--green);outline-offset:5px}
/* 觸控點過會殘留 :hover（sticky hover），輪播換校後舊分頁仍像被選中；hover 樣式只給滑鼠裝置，就地包起來以保留原本的先後順序。 */
@media(hover:hover){.campus-gallery button:hover{color:var(--green)}}


.content-width{width:var(--card-width);margin-inline:auto}
.campus-panorama.campus-gallery{padding:64px 0 60px}
.gallery-heading{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:16px;margin-bottom:36px}
.gallery-title{display:flex;flex-direction:column;align-items:center;gap:4px;margin-top:24px;text-align:center}
.gallery-title h2{margin:0;color:var(--heading-ink);font:500 clamp(40px,3.9vw,56px)/1.4 var(--font-head);letter-spacing:.1em;padding-inline-start:.1em;white-space:nowrap}
.gallery-title>span{color:var(--heading-accent);font:italic clamp(var(--fs-lg),1.7vw,var(--fs-2xl))/1.3 Georgia,'Times New Roman',serif;letter-spacing:.015em}
.campus-tabs{--tab-hover-line:var(--ivy-campus-tab-hover-line);display:flex;justify-content:center;width:min(100%,1040px);gap:12px}
.campus-tabs button{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;min-width:0;min-height:176px;gap:8px;padding:12px 10px 15px;border:1px solid transparent;border-radius:0;background:transparent;font-size:var(--fs-lg);letter-spacing:.065em;white-space:nowrap;color:var(--muted);transition:color .2s}
.campus-tabs button[aria-selected=true]{color:var(--heading-ink);font-weight:600}
@media(hover:hover){.campus-tabs button:hover:not([aria-selected=true]){color:var(--heading-ink)}}
.campus-tab-figure{position:relative;display:block;width:160px;max-width:100%;aspect-ratio:3/2}
/* 線稿（2026-10-02 起）是透明底墨線版 `-ink`（media-image.ts lineArtInkImage），不用混合模式：原本白底圖靠 filter＋multiply
   融進底色，iPhone 只要把圖或祖先移到獨立合成層，multiply 就碰不到底色，露出整塊紙底方塊。後台換過的線稿沒有墨線版，
   掛 is-blend 照舊 filter＋multiply。淡彩層（只在 hover 裝置顯示）仍是白底圖靠 multiply。
   直接對 opacity／filter 做 transition 時，WebKit（iPhone、Safari）會把圖移到獨立合成層，multiply 碰不到底色，轉場那
   0.2–0.35 秒露出白底長方形（每次自動輪播切換都閃）。所以轉場註冊過的數值變數，由主執行緒逐幀更新，不升合成層；
   未支援 @property 的瀏覽器退回瞬間切換（var 的後備值即靜止狀態）。 */
@property --tab-art-opacity{syntax:'<number>';inherits:false;initial-value:.75}
@property --tab-art-brightness{syntax:'<number>';inherits:false;initial-value:.72}
@property --tab-colour-opacity{syntax:'<number>';inherits:false;initial-value:0}
.campus-tab-art{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none;user-select:none;opacity:var(--tab-art-opacity,.75);transition:--tab-art-opacity .2s,--tab-art-brightness .2s}
.campus-tab-art.is-blend{mix-blend-mode:multiply;filter:grayscale(1) brightness(var(--tab-art-brightness,.72)) contrast(3.2)}
.campus-tabs button[aria-selected=true] .campus-tab-art{--tab-art-opacity:1}
@media(hover:hover){.campus-tabs button:hover .campus-tab-art{--tab-art-opacity:1;--tab-art-brightness:.68}}
/* 淡彩層只有顏色、不含線條，multiply 疊在線稿上，淡入時線條濃淡不變；觸控裝置不載入 */
.campus-tab-colour{position:absolute;inset:0;display:none;width:100%;height:100%;object-fit:contain;mix-blend-mode:multiply;pointer-events:none;user-select:none;opacity:var(--tab-colour-opacity,0);transition:--tab-colour-opacity .35s ease}
@media(hover:hover){.campus-tab-colour{display:block}.campus-tabs button:is([aria-selected=true],:hover) .campus-tab-colour{--tab-colour-opacity:1}}
/* 換校畫線稿：遮罩的硬邊後面帶 30% 羽化，由左往右掃過；淡彩等線畫完才染上。遮罩位置同樣走註冊過的數值變數
   （理由同上：不升合成層，multiply 才碰得到底色）。initial-value 為 1，減少動態關掉動畫時就是完整線稿。 */
@property --tab-draw{syntax:'<number>';inherits:true;initial-value:1}
.campus-tabs button.is-drawing{animation:campus-tab-draw 1.4s linear both}
.campus-tabs button.is-drawing .campus-tab-art{-webkit-mask-image:linear-gradient(90deg,#000 calc(var(--tab-draw) * 130% - 30%),transparent calc(var(--tab-draw) * 130%));mask-image:linear-gradient(90deg,#000 calc(var(--tab-draw) * 130% - 30%),transparent calc(var(--tab-draw) * 130%))}
.campus-tabs button.is-drawing .campus-tab-colour{animation:campus-tab-wash 1.4s ease both}
@keyframes campus-tab-draw{0%{--tab-draw:0;animation-timing-function:cubic-bezier(.45,.05,.35,1)}64%,100%{--tab-draw:1}}
@keyframes campus-tab-wash{0%,55%{--tab-colour-opacity:0}100%{--tab-colour-opacity:1}}
.campus-tab-label{position:relative;display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding-inline:14px;white-space:nowrap}
.campus-tab-label::after{content:'';position:absolute;inset-block-end:-6px;inset-inline-start:50%;width:25px;height:2px;background:transparent;transform:translateX(-50%);transition:background .2s}
@media(hover:hover){.campus-tabs button:hover .campus-tab-label::after{background:var(--tab-hover-line)}}
.campus-tabs button[aria-selected=true] .campus-tab-label::after{background:var(--heading-ink)}
.gallery-media{position:relative;--toolbar-height:94px}
.controls-reveal-trigger{position:absolute;left:50%;bottom:0;width:1px;height:var(--toolbar-height);pointer-events:none}
.gallery-viewport{overflow:hidden;padding-block:4px;touch-action:pan-y;cursor:grab}
.gallery-viewport:active{cursor:grabbing}
.gallery-track{position:relative;width:100%;height:clamp(350px,37.5vw,540px)}
.photo-card{position:absolute;left:calc((100% - var(--card-width))/2);top:0;width:var(--card-width);height:100%;margin:0;border:0;padding:0;overflow:hidden;border-radius:var(--radius);background:var(--selected);transform:translateX(calc(var(--offset)*(100% + var(--card-gap)) + var(--drag,0px)));transition:transform .8s var(--ease);will-change:transform;pointer-events:none}
.photo-card img{max-width:none;width:100%;height:100%;display:block;object-fit:cover;user-select:none;pointer-events:none}
.photo-card:not(.is-current)::after{content:'';position:absolute;inset:0;background:var(--background);opacity:.18;pointer-events:none}
.photo-card.is-current,.photo-card.is-neighbor{pointer-events:auto}
.photo-card.is-neighbor{cursor:pointer}
.photo-card:focus-visible{outline-offset:-7px}
.photo-card.is-repositioning,.gallery-track.is-dragging .photo-card{transition:none}
/* 淡彩速寫（utils/campusSketch.ts）：canvas 墊在照片下面；畫的時候照片淡出，最後照片以水彩團遮罩從中央暈開回來。
   卡片有 transform（自成堆疊環境），canvas 用 z-index:-1 壓在照片底下，照片本身不必定位，
   非當前卡的淡化遮罩（::after）才不會被照片蓋掉。 */
.photo-card .sketch-canvas{position:absolute;inset:0;z-index:-1;width:100%;height:100%;opacity:0;pointer-events:none;transition:opacity .4s}
.photo-card.is-sketch .sketch-canvas{opacity:1;transition:none}
.photo-card.is-sketch img{opacity:0;transition:opacity .45s ease}
.photo-card.is-sketch.is-develop img{opacity:1;transition:-webkit-mask-size 1.7s cubic-bezier(.33,.12,.3,1),mask-size 1.7s cubic-bezier(.33,.12,.3,1);-webkit-mask-image:var(--develop-mask);mask-image:var(--develop-mask);-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:var(--develop,0%) var(--develop,0%);mask-size:var(--develop,0%) var(--develop,0%)}
.photo-card.is-sketch.is-developed img{--develop:520%}
/* 左右預覽卡＝靜態線稿（data-art=line，2026-09-29 晚）：canvas 直接露出、照片淡出（離開中央的那張邊滑邊褪回線稿）；
   換到中央由 campusSketch 掛 is-sketch 接手，上色後照片暈開回來。 */
.photo-card[data-art=line] .sketch-canvas{opacity:1;transition:none}
.photo-card[data-art=line] img{opacity:0;transition:opacity .6s ease}
/* JS 由 head 啟用：第一張線稿尚未載好時保留紙底；無 JS 照常顯示照片。 */
html[data-ivy-motion] .photo-card[data-initial-sketch]{background:var(--paper)}
html[data-ivy-motion] .photo-card[data-initial-sketch] img{opacity:0;transition:none}
@media(prefers-reduced-motion:reduce),(forced-colors:active){
  html[data-ivy-motion] .photo-card[data-initial-sketch] img{opacity:1}
}
.gallery-toolbar{position:sticky;bottom:max(12px,env(safe-area-inset-bottom));z-index:2;pointer-events:none;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:20px;min-height:var(--toolbar-height)}
.playback-controls{position:relative;grid-column:2;display:flex;align-items:center;gap:10px;pointer-events:auto}
.pagination{display:flex;align-items:center;min-height:48px;padding:1px 4px;border:1px solid var(--control-border);border-radius:999px;background:var(--control)}
.page-dot{display:grid;place-items:center;min-width:44px;height:44px;border:0;padding:0;background:none;border-radius:999px}
.page-dot[aria-pressed=true]{width:62px}
.progress-track{display:block;width:6px;height:6px;border-radius:999px;overflow:hidden;background:var(--control-dot)}
.page-dot[aria-pressed=true] .progress-track{width:44px;height:7px;background:var(--line)}
.progress-track>span{display:block;width:100%;height:100%;transform:scaleX(0);transform-origin:left;background:var(--deep);border-radius:inherit}
/* 4s 對應 script 的 DURATION；--run-from 是負的延遲，讓重建的動畫從暫停前的進度接著播。 */
@keyframes campus-progress{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.progress-track>span[data-run]{animation:campus-progress 4s linear forwards paused;animation-delay:var(--run-from,0s)}
.progress-track>span[data-run=playing]{animation-play-state:running}
.round-button{display:grid;place-items:center;width:48px;height:48px;flex:none;padding:0;border:1px solid var(--control-border);border-radius:50%;background:var(--control);transition:background .2s}
@media(hover:hover){.round-button:hover,.page-dot:hover{background:var(--control-hover)}}
.icon{width:20px;height:20px;display:block;fill:currentColor;flex:none}

/* One small drop rises, settles, then separates into the two controls. */
.playback-controls[data-reveal=pending]{opacity:0;pointer-events:none}
.playback-controls[data-reveal=entering]::before{content:'';position:absolute;left:50%;top:50%;width:48px;height:48px;border-radius:999px;background:var(--control);pointer-events:none;animation:campus-control-droplet 1.2s both}
.playback-controls[data-reveal=entering] .pagination{position:relative;isolation:isolate;background:transparent;border-color:transparent;animation:campus-control-pill-travel 1.2s both}
.playback-controls[data-reveal=entering] .pagination::before{content:'';position:absolute;z-index:-1;left:50%;top:50%;box-sizing:border-box;width:100%;height:100%;border:1px solid var(--control-border);border-radius:999px;background:var(--control);transform:translate(-50%,-50%);pointer-events:none;animation:campus-control-pill-shape 1.2s both}
.playback-controls[data-reveal=entering] .page-dot{animation:campus-control-dots 1.2s both}
.playback-controls[data-reveal=entering] .campus-playback{animation:campus-control-split 1.2s both}
.playback-controls[data-reveal=entering] .campus-playback .icon{animation:campus-control-icon 1.2s both}
@keyframes campus-control-droplet{
  0%{opacity:0;transform:translate(-50%,calc(-50% + 72px)) scale(.48,1.18);animation-timing-function:cubic-bezier(.16,1,.3,1)}
  18%{opacity:1;transform:translate(-50%,calc(-50% - 9px)) scale(.72,1.16);animation-timing-function:ease-in-out}
  32%{opacity:1;transform:translate(-50%,calc(-50% + 3px)) scale(1.14,.78);animation-timing-function:ease-out}
  44%{opacity:1;transform:translate(-50%,-50%) scale(1);animation-timing-function:ease-out}
  54%,100%{opacity:0;transform:translate(-50%,-50%) scale(.8)}
}
@keyframes campus-control-pill-travel{
  0%,38%{transform:translateX(var(--reveal-pill-x));animation-timing-function:cubic-bezier(.22,1,.36,1)}
  78%{transform:translateX(-2px);animation-timing-function:ease-in-out}
  100%{transform:translateX(0)}
}
@keyframes campus-control-pill-shape{
  0%,30%{opacity:0;width:48px;height:36px;border-color:transparent}
  38%{opacity:1;width:48px;height:36px;animation-timing-function:cubic-bezier(.22,1,.36,1)}
  70%{border-color:transparent}
  78%{opacity:1;width:calc(100% + 6px);height:calc(100% - 2px);border-color:var(--control-border);animation-timing-function:ease-in-out}
  100%{opacity:1;width:100%;height:100%}
}
@keyframes campus-control-split{
  0%,40%{opacity:0;transform:translateX(var(--reveal-play-x)) scale(.45,.72);border-color:transparent}
  47%{opacity:1;transform:translateX(var(--reveal-play-x)) scale(.76,.9);animation-timing-function:cubic-bezier(.22,1,.36,1)}
  70%{border-color:transparent}
  80%{opacity:1;transform:translateX(3px) scale(1.04,.96);border-color:var(--control-border);animation-timing-function:ease-in-out}
  100%{opacity:1;transform:translateX(0) scale(1)}
}
@keyframes campus-control-dots{
  0%,58%{opacity:0;transform:translateX(12px) scale(.82);animation-timing-function:ease-out}
  86%,100%{opacity:1;transform:translateX(0) scale(1)}
}
@keyframes campus-control-icon{
  0%,72%{opacity:0;transform:scale(.65);animation-timing-function:ease-out}
  94%,100%{opacity:1;transform:scale(1)}
}
@media(prefers-reduced-motion:reduce),(forced-colors:active){
  .playback-controls[data-reveal]{opacity:1;pointer-events:auto}
  .playback-controls[data-reveal=entering]::before,.playback-controls[data-reveal=entering] .pagination::before{display:none}
  .playback-controls[data-reveal=entering] :is(.pagination,.campus-playback,.page-dot,.icon){animation:none!important;transform:none;opacity:1}
  .playback-controls[data-reveal=entering] .pagination{background:var(--control);border-color:var(--control-border)}
}

.campus-details{display:grid;grid-template-columns:minmax(220px,.95fr) minmax(0,1.35fr) auto;align-items:center;gap:clamp(24px,3.2vw,48px);padding-block:32px 12px;border-top:1px solid var(--line);scroll-margin-top:80px}
.campus-identity{min-width:0}
.campus-district{display:block;font-size:var(--fs-sm);letter-spacing:.12em;color:var(--muted)}
.campus-identity h3{margin:9px 0 12px;color:var(--heading-ink);font:500 var(--fs-campus-name)/1.25 var(--font-head);letter-spacing:.065em}
.campus-identity [lang=en]{display:block;font-family:var(--font-latin);font-size:var(--fs-xs);letter-spacing:.15em;color:var(--heading-accent)}
.campus-contact{min-width:0;padding:4px 0 4px clamp(24px,3vw,44px);border-inline-start:1px solid var(--line)}
.contact-row{display:flex;align-items:center;gap:13px;min-height:44px;font-size:var(--fs-md)}
.contact-row .icon{width:18px;height:18px;color:var(--muted)}
.contact-row a{display:inline-flex;align-items:center;min-height:44px;overflow-wrap:anywhere}
.contact-row a:hover{text-decoration:underline;text-underline-offset:5px}
/* 單一個 ↗ 在手機上看不出是地圖連結；補一段「地圖」字樣（2026-09-27）。 */
.map-hint{flex-shrink:0;margin-left:8px;font-size:var(--fs-sm);text-decoration:underline;text-underline-offset:4px;white-space:nowrap}
.phone{font-family:var(--font-latin);font-size:var(--fs-3xl);font-weight:400;letter-spacing:.015em;font-variant-numeric:tabular-nums}
.social-row{display:flex;align-items:center;gap:8px 20px;color:var(--muted);font-size:var(--fs-sm);margin-top:7px;flex-wrap:wrap}
.social-row a,.social-row span{display:inline-flex;align-items:center;min-height:44px;gap:8px}
.social-row a{text-decoration:none}.social-row a:hover{text-decoration:underline;text-underline-offset:5px}
.campus-actions{display:flex;align-items:center;justify-content:flex-end}
.booking-link{display:inline-flex;align-items:center;justify-content:space-between;gap:30px;min-height:54px;padding:14px 24px;border-radius:999px;background:var(--yellow);color:var(--deep);font-size:var(--fs-sm);font-weight:600;letter-spacing:.035em;transition:background .2s,color .2s;white-space:nowrap}
/* 2026-09-27：底色從低彩度杏色（--ivy-campus-gold）改用頁首預約鈕同一個金色，首頁唯一帶校區的預約入口要像主要行動。 */
.booking-link:hover{background:var(--green);color:var(--paper)}

.campus-live{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(min-width:1600px){.campus-panorama.campus-gallery{--card-width:min(78vw,1440px)}.gallery-track{height:620px}.campus-panorama.campus-gallery{padding-top:76px}}
@media(max-width:1100px){
  .campus-panorama.campus-gallery{--card-width:84vw}
  .gallery-track{height:clamp(340px,46vw,480px)}
  .campus-details{grid-template-columns:minmax(200px,.85fr) minmax(0,1.15fr);gap:18px 32px;align-items:start}
  .campus-identity{grid-row:1/3;padding-top:8px}
  
  .campus-actions{grid-column:2;justify-content:flex-start;padding-inline-start:24px}
  .campus-contact{padding-inline-start:24px}
}
@media(max-width:700px){
  .campus-panorama.campus-gallery{--card-width:calc(100vw - 48px);--card-gap:12px;--radius:24px;padding:38px 0 40px}
  .gallery-heading{gap:12px;margin-bottom:24px}
  .gallery-title{gap:2px;margin-top:14px}
  .gallery-title h2{font-size:var(--fs-5xl);letter-spacing:.06em;white-space:normal}
  .gallery-title>span{font-size:var(--fs-lg)}
  .campus-tabs{gap:5px}
  .campus-tabs button{font-size:var(--fs-xs);min-height:92px;padding:6px 2px 9px;gap:2px;letter-spacing:.015em}
  .campus-tab-figure{width:60px;height:40px}
  .campus-tab-label{min-height:28px;padding-inline:5px}
  /* 文字放大 200% 時校名在自己的分頁裡換行，不溢進隔壁分頁連成一串；預設字級放得下，不會換行。
     行高不另外收緊：改行高會讓預設字級的校名上移約 0.6px。 */
  .campus-tabs button,.campus-tab-label{white-space:normal}
  .campus-tab-label::after{inset-block-end:-4px;width:20px}
  .gallery-track{height:calc(var(--card-width) / 1.5)}
  .gallery-media{--toolbar-height:84px}
  .gallery-toolbar{grid-template-columns:1fr;gap:12px}
  .playback-controls{grid-column:1;gap:8px;justify-self:center}
  .round-button{width:44px;height:44px}
  .pagination{min-height:48px;padding-inline:1px}
  .page-dot{min-width:44px}
  .page-dot[aria-pressed=true]{width:60px}
  .page-dot[aria-pressed=true] .progress-track{width:34px}
  .campus-details{grid-template-columns:1fr;gap:23px;padding-top:27px}
  .campus-identity{grid-row:auto;padding:0}
  .campus-district{font-size:var(--fs-xs)}
  .campus-identity h3{margin:8px 0 11px}
  .campus-identity [lang=en]{font-size:11px;letter-spacing:.13em}
  .campus-contact{padding:20px 0 0;border-inline-start:0;border-top:1px solid var(--line)}
  .contact-row{font-size:var(--fs-sm);gap:12px}
  .phone{font-size:var(--fs-2xl)}
  .social-row{font-size:var(--fs-sm);gap:8px 20px;margin-top:5px}
  .campus-actions{grid-column:auto;display:block;padding:0}
  .booking-link{width:100%;justify-content:space-between;min-height:52px;font-size:var(--fs-sm);white-space:normal}
}
@media(max-width:360px){
  .playback-controls{gap:4px}
  .page-dot[aria-pressed=true]{width:44px}
  .campus-tabs{gap:4px}
  .campus-tabs button{font-size:var(--fs-xs);padding-inline:1px}
  .campus-tab-figure{width:48px;height:34px}
  .campus-tab-label{padding-inline:3px}
  .contact-row{font-size:var(--fs-sm)}
}
/* 288 以下分頁只剩 43px，校名連左右 3px 內距放不下，改成可換行後會斷成兩行；內距看不見，拿掉就維持一行。 */
@media(max-width:300px){.campus-tab-label{padding-inline:0}}
@media(prefers-reduced-motion:reduce){.campus-gallery *,.campus-gallery *::before,.campus-gallery *::after{transition:none!important;animation:none!important}}
/* 減少動態時使用者手動開始輪播，進度條照樣前進（改 CSS 動畫前由 JS 逐格寫入，不受上面全面關動畫影響）。 */
@media(prefers-reduced-motion:reduce){.progress-track>span[data-run]{animation:campus-progress 4s linear forwards paused!important;animation-delay:var(--run-from,0s)!important}.progress-track>span[data-run=playing]{animation-play-state:running!important}}
@media(forced-colors:active){.photo-card,.round-button,.pagination,.booking-link{border:1px solid CanvasText}.campus-tabs button[aria-selected=true],.page-dot[aria-pressed=true]{outline:2px solid Highlight}.progress-track{background:CanvasText}}
@media(forced-colors:active){.campus-tab-figure{visibility:hidden}.campus-tabs button[aria-selected=true] .campus-tab-label::after{background:Highlight}}
@media(forced-colors:active){.photo-card .sketch-canvas{display:none}.photo-card.is-sketch img,.photo-card[data-art=line] img{opacity:1;-webkit-mask:none;mask:none}}

</style>
