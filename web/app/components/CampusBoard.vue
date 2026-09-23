<script setup lang="ts">
import { responsiveImage } from '~/utils/responsive-image'
import { createCarouselClock } from '~/utils/carouselClock'
import type { Campus, CampusBoardContent } from '~/types/site-content'

const props = defineProps<{ board: CampusBoardContent; campuses: Campus[] }>()
const orderedCampuses = computed(() => props.board.campusOrder
  .map(key => props.campuses.find(campus => campus.key === key))
  .filter((campus): campus is Campus => Boolean(campus)))
const index = ref(Math.max(0, orderedCampuses.value.findIndex(campus => campus.key === props.board.defaultCampus)))
const current = computed(() => orderedCampuses.value[index.value] ?? orderedCampuses.value[0])
const root = ref<HTMLElement | null>(null)
const photoViewport = ref<HTMLElement | null>(null)
const controlsTrigger = ref<HTMLElement | null>(null)
const playbackControls = ref<HTMLElement | null>(null)
const controlsReveal = ref<'static' | 'pending' | 'entering' | 'shown'>('static')
const progress = ref(0)
const visible = ref(false)
const hidden = ref(true)
const focused = ref(false)
const paused = ref(false)
const reducedMotion = ref(false)
const optedIn = ref(false)
const repositioning = shallowRef(new Set<number>())
const announcement = ref('')
const canAuto = computed(() => orderedCampuses.value.length > 1 && !paused.value && (!reducedMotion.value || optedIn.value))
const playing = computed(() => canAuto.value && visible.value && !hidden.value && !focused.value)
const clock = createCarouselClock({
  duration: 4000,
  onAdvance: () => select(index.value + 1, true),
  onProgress: value => { progress.value = value }
})

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
  const image = responsiveImage(campus.image, CARD_SIZES)
  return Math.abs(offset(photo)) <= 1 ? image : { width: image.width, height: image.height }
}
function select(next: number, automatic = false) {
  const total = orderedCampuses.value.length
  if (!total) { index.value = 0; clock.reset(); return }
  const selected = (next + total) % total
  // Wrapped, offscreen cards teleport behind the viewport rather than crossing it.
  repositioning.value = new Set(orderedCampuses.value.flatMap((_, i) =>
    i !== selected && i !== index.value && Math.abs(offset(i, selected) - offset(i)) > total / 2 ? [i] : []))
  index.value = selected
  clock.reset()
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

let pointerStart: { id: number; x: number; y: number } | null = null
let suppressPhotoClick = false
function onPointerDown(event: PointerEvent) {
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
  pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY }
  suppressPhotoClick = false
}
function onPointerUp(event: PointerEvent) {
  if (!pointerStart || pointerStart.id !== event.pointerId) return
  const dx = event.clientX - pointerStart.x
  const dy = event.clientY - pointerStart.y
  pointerStart = null
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
watch(orderedCampuses, (list, previous) => {
  const key = previous[index.value]?.key
  select(Math.max(0, list.findIndex(campus => campus.key === key)))
})

let dispose = () => {}
onMounted(() => {
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  const forcedColors = matchMedia('(forced-colors: active)')
  const motionChanged = () => {
    reducedMotion.value = media.matches
    optedIn.value = false
    if (media.matches || forcedColors.matches) finishControlsReveal()
  }
  const visibilityChanged = () => { hidden.value = document.hidden }
  motionChanged()
  visibilityChanged()
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
  window.addEventListener('resize', finishOnResize, { passive: true })
  document.addEventListener('visibilitychange', visibilityChanged)
  dispose = () => {
    stopObserving()
    stopControlsObserving()
    observer.disconnect()
    controlsObserver.disconnect()
    media.removeEventListener('change', motionChanged)
    forcedColors.removeEventListener('change', motionChanged)
    window.removeEventListener('resize', finishOnResize)
    document.removeEventListener('visibilitychange', visibilityChanged)
  }
})
onBeforeUnmount(() => { dispose(); clock.destroy() })
</script>

<template>
  <section
    v-if="current" id="campuses" ref="root" class="campus-panorama campus-gallery"
    aria-roledescription="輪播" aria-labelledby="campuses-heading"
    :data-campus="current.key" :data-campus-key="current.key" :data-playing="playing"
    @focusin="focusChanged($event.target)" @focusout="focusChanged($event.relatedTarget)"
  >
    <header class="gallery-heading content-width">
      <div class="gallery-title"><h2 id="campuses-heading">{{ board.sectionTitle }}</h2><span lang="en">{{ board.eyebrow }}</span></div>
      <div class="campus-tabs" role="tablist" aria-label="選擇分校">
        <button
          v-for="(campus, i) in orderedCampuses" :id="`campus-tab-${campus.key}`" :key="campus.key"
          type="button" role="tab" :data-campus-tab="i" :aria-selected="i === index"
          :tabindex="i === index ? 0 : -1" aria-controls="campus-stage"
          @click="select(i)" @keydown="onKey($event, i)"
        >
          <img
            class="campus-tab-art"
            v-bind="responsiveImage(`campus-line-art-${campus.key}`, '(max-width: 360px) 48px, (max-width: 700px) 60px, 160px')"
            alt="" aria-hidden="true" loading="lazy" decoding="async"
          >
          <span class="campus-tab-label">{{ campus.name }}</span>
        </button>
      </div>
    </header>
    <div class="gallery-media">
      <div
        ref="photoViewport" class="gallery-viewport" aria-label="校園照片，可左右滑動"
        @pointerdown="onPointerDown" @pointerup="onPointerUp" @pointercancel="pointerStart = null"
        @pointerleave="pointerStart = null" @dragstart.prevent
      >
        <div class="gallery-track">
          <NuxtLink
            v-for="(campus, i) in orderedCampuses" :key="campus.key"
            class="photo-card" :class="{ 'is-current': i === index, 'is-neighbor': Math.abs(offset(i)) === 1, 'is-repositioning': repositioning.has(i) }"
            :style="{ '--offset': offset(i) }" :to="`/campuses/${campus.key}`"
            :tabindex="i === index ? 0 : -1" :aria-hidden="i !== index" :inert="Math.abs(offset(i)) > 1"
            :aria-label="i === index ? `認識${campus.name}，查看校園介紹` : `選擇${campus.name}`"
            draggable="false" @click.capture="onPhotoClick($event, i)"
          >
            <img
              v-bind="cardImage(campus, i)"
              :alt="i === index ? `${campus.name}校園外觀` : ''"
              :style="{ objectPosition: campus.panoramaPos || 'center 55%' }"
              :fetchpriority="i === index ? 'auto' : 'low'" loading="lazy" decoding="async" draggable="false"
            >
          </NuxtLink>
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
              <span class="progress-track" aria-hidden="true"><span :style="{ transform: `scaleX(${i === index ? (canAuto ? progress : 1) : 0})` }" /></span>
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
    <div id="campus-stage" class="campus-details content-width" role="tabpanel" :aria-labelledby="`campus-tab-${current.key}`" tabindex="0">
      <div class="campus-identity">
        <span class="campus-district">高雄 · {{ current.district }}</span>
        <h3><NuxtLink :to="`/campuses/${current.key}`">{{ current.name }}</NuxtLink></h3>
        <span lang="en">{{ current.key.toUpperCase() }} CAMPUS</span>
      </div>
      <div class="campus-contact">
        <div class="contact-row">
          <svg class="icon" aria-hidden="true"><use href="#i-map-pin" /></svg>
          <a :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(current.address)}`" :aria-label="`${current.address}，在 Google 地圖開啟（另開分頁）`" target="_blank" rel="noopener noreferrer">{{ current.address }} ↗</a>
        </div>
        <div class="contact-row"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg><a class="phone" :href="`tel:${current.phone}`">{{ current.phone }}</a></div>
        <div class="social-row">
          <a v-if="current.line" :href="current.line" aria-label="LINE 好友（另開分頁）" target="_blank" rel="noopener noreferrer"><svg class="icon" aria-hidden="true"><use href="#i-line" /></svg>LINE 好友</a>
          <span v-else><svg class="icon" aria-hidden="true"><use href="#i-line" /></svg>LINE · 待園方提供</span>
          <a v-if="current.facebook" :href="current.facebook" aria-label="Facebook（另開分頁）" target="_blank" rel="noopener noreferrer"><svg class="icon" aria-hidden="true"><use href="#i-facebook" /></svg>Facebook</a>
        </div>
      </div>
      <div class="campus-actions">
        <NuxtLink class="booking-link" :to="`/visit/${current.key}`">預約參觀{{ current.name }}<svg class="icon" aria-hidden="true"><use href="#i-arrow-right" /></svg></NuxtLink>
      </div>
    </div>
    <p class="campus-live" role="status" aria-live="polite">{{ announcement }}</p>
  </section>
</template>

<style scoped>

.campus-panorama.campus-gallery{--green:oklch(37% .035 160);--deep:oklch(29% .022 160);--paper:oklch(99% .006 95);--gold:oklch(82% .065 85);--mint:oklch(88% .022 150);--muted:oklch(49% .018 150);--line:oklch(86% .012 95);--control:oklch(93% .009 95);--control-border:oklch(86% .01 95);--control-dot:oklch(53% .018 155);--control-hover:oklch(88% .013 95);--background:oklch(98% .006 95);--selected:color-mix(in oklch,var(--green) 7%,var(--background));--font:'PingFang TC','Microsoft JhengHei',system-ui,sans-serif;--font-head:var(--font-serif);--heading-ink:#3d5057;--heading-accent:#786c5c;--heading-rule:#cdd3d0;--heading-selected:#ebefec;--font-latin:'Source Sans 3','Helvetica Neue',Arial,sans-serif;--card-width:min(80vw,1200px);--card-gap:20px;--radius:28px;--ease:cubic-bezier(.22,1,.36,1)}
.campus-gallery,.campus-gallery *{box-sizing:border-box}
.campus-panorama.campus-gallery{position:relative;isolation:isolate;min-height:0;color:var(--deep);background:var(--background);font:var(--fs-md)/1.7 var(--font);-webkit-font-smoothing:antialiased}
.campus-gallery :is(button,a){-webkit-tap-highlight-color:transparent}
.campus-gallery button{font:inherit;cursor:pointer;color:inherit}
.campus-gallery a{color:inherit;text-decoration:none}
.campus-gallery :is(button,a,[tabindex]):focus-visible{outline:3px solid var(--green);outline-offset:5px}
.campus-gallery button:hover{color:var(--green)}


.content-width{width:var(--card-width);margin-inline:auto}
.campus-panorama.campus-gallery{padding:64px 0 60px}
.gallery-heading{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:28px;margin-bottom:36px}
.gallery-title{display:flex;justify-content:center;align-items:baseline;gap:24px;text-align:center}
.gallery-title h2{margin:0;color:var(--heading-ink);font:500 clamp(32px,3.3vw,48px)/1.5 var(--font-head);letter-spacing:.1em;padding-inline-start:.1em;white-space:nowrap}
.gallery-title>span{color:var(--heading-accent);font:italic var(--fs-3xl)/1.3 Georgia,'Times New Roman',serif;letter-spacing:.015em}
.campus-tabs{--tab-hover-line:#cbd2cd;display:flex;justify-content:center;width:min(100%,1040px);gap:12px}
.campus-tabs button{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;min-width:0;min-height:176px;gap:8px;padding:12px 10px 15px;border:1px solid transparent;border-radius:0;background:transparent;font-size:var(--fs-lg);letter-spacing:.065em;white-space:nowrap;color:var(--muted);transition:color .2s}
.campus-tabs button[aria-selected=true]{color:var(--heading-ink);font-weight:600}
.campus-tabs button:hover:not([aria-selected=true]){color:var(--heading-ink)}
.campus-tab-art{display:block;width:160px;max-width:100%;height:auto;aspect-ratio:3/2;object-fit:contain;mix-blend-mode:multiply;filter:grayscale(1) brightness(.72) contrast(3.2);pointer-events:none;user-select:none;opacity:.75;transition:opacity .2s}
.campus-tabs button:is([aria-selected=true],:hover) .campus-tab-art{opacity:1}
.campus-tab-label{position:relative;display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding-inline:14px;white-space:nowrap}
.campus-tab-label::after{content:'';position:absolute;inset-block-end:-6px;inset-inline-start:50%;width:25px;height:2px;background:transparent;transform:translateX(-50%);transition:background .2s}
.campus-tabs button:hover .campus-tab-label::after{background:var(--tab-hover-line)}
.campus-tabs button[aria-selected=true] .campus-tab-label::after{background:var(--heading-ink)}
.gallery-media{position:relative;--toolbar-height:94px}
.controls-reveal-trigger{position:absolute;left:50%;bottom:0;width:1px;height:var(--toolbar-height);pointer-events:none}
.gallery-viewport{overflow:hidden;padding-block:4px;touch-action:pan-y;cursor:grab}
.gallery-viewport:active{cursor:grabbing}
.gallery-track{position:relative;width:100%;height:clamp(350px,37.5vw,540px)}
.photo-card{position:absolute;left:calc((100% - var(--card-width))/2);top:0;width:var(--card-width);height:100%;margin:0;border:0;padding:0;overflow:hidden;border-radius:var(--radius);background:var(--selected);transform:translateX(calc(var(--offset)*(100% + var(--card-gap))));transition:transform .8s var(--ease);will-change:transform;cursor:pointer;pointer-events:none}
.photo-card img{max-width:none;width:100%;height:100%;display:block;object-fit:cover;user-select:none;pointer-events:none}
.photo-card:not(.is-current)::after{content:'';position:absolute;inset:0;background:var(--background);opacity:.18;pointer-events:none}
.photo-card.is-current,.photo-card.is-neighbor{pointer-events:auto}
.photo-card:focus-visible{outline-offset:-7px}
.photo-card.is-repositioning{transition:none}
.gallery-toolbar{position:sticky;bottom:max(12px,env(safe-area-inset-bottom));z-index:2;pointer-events:none;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:20px;min-height:var(--toolbar-height)}
.playback-controls{position:relative;grid-column:2;display:flex;align-items:center;gap:10px;pointer-events:auto}
.pagination{display:flex;align-items:center;min-height:48px;padding:1px 4px;border:1px solid var(--control-border);border-radius:999px;background:var(--control)}
.page-dot{display:grid;place-items:center;min-width:44px;height:44px;border:0;padding:0;background:none;border-radius:999px}
.page-dot[aria-pressed=true]{width:62px}
.progress-track{display:block;width:6px;height:6px;border-radius:999px;overflow:hidden;background:var(--control-dot)}
.page-dot[aria-pressed=true] .progress-track{width:44px;height:7px;background:var(--line)}
.progress-track>span{display:block;width:100%;height:100%;transform:scaleX(0);transform-origin:left;background:var(--deep);border-radius:inherit}
.round-button{display:grid;place-items:center;width:48px;height:48px;flex:none;padding:0;border:1px solid var(--control-border);border-radius:50%;background:var(--control);transition:background .2s}
.round-button:hover,.page-dot:hover{background:var(--control-hover)}
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
.campus-identity h3 a:hover{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:9px}
.campus-identity [lang=en]{display:block;font-family:var(--font-latin);font-size:var(--fs-xs);letter-spacing:.15em;color:var(--heading-accent)}
.campus-contact{min-width:0;padding:4px 0 4px clamp(24px,3vw,44px);border-inline-start:1px solid var(--line)}
.contact-row{display:flex;align-items:center;gap:13px;min-height:44px;font-size:var(--fs-md)}
.contact-row .icon{width:18px;height:18px;color:var(--muted)}
.contact-row a{display:inline-flex;align-items:center;min-height:44px;overflow-wrap:anywhere}
.contact-row a:hover{text-decoration:underline;text-underline-offset:5px}
.phone{font-family:var(--font-latin);font-size:var(--fs-3xl);font-weight:400;letter-spacing:.015em;font-variant-numeric:tabular-nums}
.social-row{display:flex;align-items:center;gap:8px 20px;color:var(--muted);font-size:var(--fs-sm);margin-top:7px;flex-wrap:wrap}
.social-row a,.social-row span{display:inline-flex;align-items:center;min-height:44px;gap:8px}
.social-row a{text-decoration:none}.social-row a:hover{text-decoration:underline;text-underline-offset:5px}
.campus-actions{display:flex;align-items:center;justify-content:flex-end}
.booking-link{display:inline-flex;align-items:center;justify-content:space-between;gap:30px;min-height:54px;padding:14px 24px;border-radius:999px;background:var(--gold);color:var(--deep);font-size:var(--fs-sm);font-weight:500;letter-spacing:.035em;transition:background .2s,color .2s;white-space:nowrap}
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
  .gallery-heading{gap:23px;margin-bottom:24px}
  .gallery-title{gap:14px}
  .gallery-title h2{font-size:var(--fs-4xl);letter-spacing:.06em}
  .gallery-title>span{font-size:var(--fs-xl)}
  .campus-tabs{gap:5px}
  .campus-tabs button{font-size:var(--fs-xs);min-height:92px;padding:6px 2px 9px;gap:2px;letter-spacing:.015em}
  .campus-tab-art{width:60px;height:40px}
  .campus-tab-label{min-height:28px;padding-inline:5px}
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
  .booking-link{width:100%;justify-content:space-between;min-height:52px;font-size:var(--fs-sm)}
}
@media(max-width:360px){
  .playback-controls{gap:4px}
  .page-dot[aria-pressed=true]{width:44px}
  .gallery-title{gap:12px}
  .gallery-title h2{font-size:var(--fs-3xl)}
  .gallery-title>span{font-size:var(--fs-xl)}
  .campus-tabs{gap:4px}
  .campus-tabs button{font-size:var(--fs-xs);padding-inline:1px}
  .campus-tab-art{width:48px;height:34px}
  .campus-tab-label{padding-inline:3px}
  .contact-row{font-size:var(--fs-sm)}
}
@media(prefers-reduced-motion:reduce){.campus-gallery *,.campus-gallery *::before,.campus-gallery *::after{transition:none!important;animation:none!important}}
@media(forced-colors:active){.photo-card,.round-button,.pagination,.booking-link{border:1px solid CanvasText}.campus-tabs button[aria-selected=true],.page-dot[aria-pressed=true]{outline:2px solid Highlight}.progress-track{background:CanvasText}}
@media(forced-colors:active){.campus-tab-art{visibility:hidden}.campus-tabs button[aria-selected=true] .campus-tab-label::after{background:Highlight}}

</style>
