<script setup lang="ts">
import { responsiveImage } from '~/utils/responsive-image'
import type { Campus, CampusBoardContent } from '~/types/site-content'
import { createCarouselClock } from '~/utils/carouselClock'

const props = defineProps<{ board: CampusBoardContent; campuses: Campus[] }>()
const orderedCampuses = computed(() => props.board.campusOrder
  .map(key => props.campuses.find(c => c.key === key))
  .filter((c): c is Campus => Boolean(c)))
const index = ref(Math.max(0, orderedCampuses.value.findIndex(c => c.key === props.board.defaultCampus)))
const current = computed(() => orderedCampuses.value[index.value] ?? orderedCampuses.value[0])
const root = ref<HTMLElement | null>(null)
const progress = ref(0)
const visible = ref(false)
const hidden = ref(true)
const reading = ref(false)
const focused = ref(false)
const paused = ref(false)
const reducedMotion = ref(false)
const optedIn = ref(false)
const canAuto = computed(() => orderedCampuses.value.length > 1 && !paused.value && (!reducedMotion.value || optedIn.value))
const playing = computed(() => canAuto.value && visible.value && !hidden.value && !reading.value && !focused.value && orderedCampuses.value.length > 1)
const clock = createCarouselClock({
  duration: 6000,
  onAdvance: () => select((index.value + 1) % orderedCampuses.value.length),
  onProgress: value => { progress.value = value }
})

function select(next: number) {
  if (!orderedCampuses.value[next]) return
  index.value = next
  clock.reset()
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
  // Keep keyboard reading still; a mouse/touch selection starts a fresh countdown.
  focused.value = target instanceof Element && Boolean(root.value?.contains(target)) && target.matches(':focus-visible') && !target.closest('.campus-playback')
}
function hover(event: PointerEvent, value: boolean) {
  if (event.pointerType === 'mouse') reading.value = value
}
watch(playing, active => active ? clock.start() : clock.pause())
watch(orderedCampuses, list => { if (index.value >= list.length) select(0) })

let dispose = () => {}
onMounted(() => {
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  const motionChanged = () => { reducedMotion.value = media.matches; optedIn.value = false }
  const visibilityChanged = () => { hidden.value = document.hidden }
  motionChanged()
  visibilityChanged()
  const observer = new IntersectionObserver((entries) => {
    // Rapid scroll/resize can batch an older hidden entry with a newer visible one.
    const entry = entries[entries.length - 1]
    visible.value = Boolean(entry && entry.isIntersecting && entry.intersectionRatio >= .35)
  }, { threshold: [0, .35, .6] })
  if (root.value) observer.observe(root.value)
  media.addEventListener('change', motionChanged)
  document.addEventListener('visibilitychange', visibilityChanged)
  dispose = () => {
    observer.disconnect()
    media.removeEventListener('change', motionChanged)
    document.removeEventListener('visibilitychange', visibilityChanged)
  }
})
onBeforeUnmount(() => { dispose(); clock.destroy() })
</script>

<template>
  <section v-if="current" id="campuses" ref="root" class="campus-panorama campus-stories" aria-roledescription="輪播" aria-labelledby="campuses-heading" :data-campus="current.key" :data-campus-key="current.key" :data-playing="playing" @focusin="focusChanged($event.target)" @focusout="focusChanged($event.relatedTarget)">
    <header class="campus-story-header">
      <div class="campus-section-title"><span lang="en">{{ board.eyebrow }}</span><h2 id="campuses-heading">{{ board.sectionTitle }}</h2></div>
    </header>
    <div class="campus-story-tabs" role="tablist" aria-label="選擇分校" @pointerenter="hover($event, true)" @pointerleave="hover($event, false)">
      <button v-for="(campus, i) in orderedCampuses" :id="`campus-tab-${campus.key}`" :key="campus.key" :data-campus-tab="i" class="campus-story-tab" type="button" role="tab" :aria-selected="i === index" :tabindex="i === index ? 0 : -1" aria-controls="campus-stage" @click="select(i)" @keydown="onKey($event, i)">
        <span class="campus-story-label">{{ campus.name }}</span>
      </button>
    </div>
    <div id="campus-stage" class="campus-story-stage" role="tabpanel" :aria-labelledby="`campus-tab-${current.key}`" :aria-live="playing ? 'off' : 'polite'">
      <div class="campus-story-photos" @pointerenter="hover($event, true)" @pointerleave="hover($event, false)">
        <figure v-for="(campus, i) in orderedCampuses" :key="campus.key" class="campus-story-photo" :class="{ 'is-current': i === index }" :aria-hidden="i !== index" :inert="i !== index">
          <NuxtLink class="campus-story-photo-link" :to="`/campuses/${campus.key}`" :aria-label="`認識${campus.name}，查看校園介紹`">
          <img v-bind="responsiveImage(campus.image, '(max-width: 760px) 100vw, (max-width: 1100px) 55vw, 61vw')" :fetchpriority="i === index ? 'auto' : 'low'" :alt="i === index ? `${campus.name}校園外觀` : ''" :style="{ objectPosition: campus.panoramaPos || 'center 55%' }" loading="lazy" decoding="async">
          </NuxtLink>
          <figcaption><span>{{ String(i + 1).padStart(2, '0') }}</span>{{ campus.name }} · 校園一隅</figcaption>
        </figure>
      </div>
      <div class="campus-story-copy" @pointerenter="hover($event, true)" @pointerleave="hover($event, false)">
        <div class="campus-story-identity"><span class="campus-story-district">高雄 · {{ current.district }}</span><h3><NuxtLink :to="`/campuses/${current.key}`">{{ current.name }}</NuxtLink></h3><span class="campus-story-english" lang="en">{{ current.key.toUpperCase() }} CAMPUS</span></div>
        <dl class="campus-story-facts">
          <div><dt><svg class="icon" aria-hidden="true"><use href="#i-map-pin" /></svg>校園位置</dt><dd><a class="campus-story-address" :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(current.address)}`" :aria-label="`${current.address}，在 Google 地圖開啟（另開分頁）`" target="_blank" rel="noopener noreferrer"><span>{{ current.address }}</span><svg class="icon" aria-hidden="true"><use href="#i-arrow-up-right" /></svg></a></dd></div>
          <div><dt><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>參觀專線</dt><dd><a class="campus-story-phone" :href="`tel:${current.phone}`">{{ current.phone }}</a></dd></div>
        </dl>
        <div class="campus-story-socials">
          <a v-if="current.line" :href="current.line" target="_blank" rel="noopener noreferrer"><svg class="icon" aria-hidden="true"><use href="#i-line" /></svg>LINE 好友</a>
          <span v-else><svg class="icon" aria-hidden="true"><use href="#i-line" /></svg>LINE <small>待補</small></span>
          <a v-if="current.facebook" :href="current.facebook" target="_blank" rel="noopener noreferrer"><svg class="icon" aria-hidden="true"><use href="#i-facebook" /></svg>Facebook</a>
        </div>
        <div class="campus-story-booking"><NuxtLink class="campus-discover" :to="`/campuses/${current.key}`"><span>認識{{ current.name }}</span><svg class="icon" aria-hidden="true"><use href="#i-arrow-right" /></svg></NuxtLink><BookingCta :campus-key="current.key" button-class="button primary">預約參觀{{ current.name }}<svg class="icon" aria-hidden="true"><use href="#i-arrow-right" /></svg></BookingCta></div>
      </div>
    </div>
    <div v-if="orderedCampuses.length > 1" class="campus-story-foot">
      <div class="campus-story-controls">
        <div class="campus-pagination" role="group" aria-label="分校輪播進度">
          <button v-for="(campus, i) in orderedCampuses" :key="campus.key" class="campus-page" :class="{ 'is-current': i === index }" type="button" :aria-label="`切換至${campus.name}`" :aria-pressed="i === index" aria-controls="campus-stage" @click="select(i)">
            <span class="campus-progress-track" aria-hidden="true"><span :style="{ transform: `scaleX(${i === index ? progress : 0})` }" /></span>
          </button>
        </div>
        <button class="campus-playback" type="button" :aria-label="canAuto ? '暫停分校自動播放' : '開始分校自動播放'" @click="togglePlayback">
          <svg class="icon" aria-hidden="true"><use :href="canAuto ? '#i-pause' : '#i-play'" /></svg>
        </button>
      </div>
      <div class="campus-story-meta" aria-hidden="true"><span>{{ reading || focused ? '閱讀中，暫停播放' : canAuto ? '每 6 秒，走訪一所校園' : '點選校名，探索校園' }}</span><span>{{ String(index + 1).padStart(2, '0') }} / {{ String(orderedCampuses.length).padStart(2, '0') }}</span></div>
    </div>
  </section>
</template>

<style scoped>
.campus-stories {
  --campus-paper:#fcfaf3; --campus-rule:#d3dbcf; --campus-muted:#637c6c; --campus-control:#eeede8; --campus-gutter:clamp(24px,4vw,80px); --campus-info-width:39%;
  position:relative; isolation:isolate; background:var(--campus-paper); color:var(--deep); padding:0;
  min-height:max(760px,100svh); display:grid; grid-template-rows:96px 64px minmax(600px,1fr); scroll-margin-top:0;
}
.campus-story-header{display:flex;align-items:center;padding:0 var(--campus-gutter)}
.campus-section-title{display:flex;align-items:baseline;gap:16px}
.campus-section-title h2{margin:0;font-family:var(--font-head);font-size:24px;font-weight:700;letter-spacing:.06em}
.campus-section-title>span{font-size:10px;letter-spacing:.15em;color:var(--campus-muted);text-box:trim-both cap alphabetic}
.campus-story-tabs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:clamp(10px,2vw,32px);padding:0 var(--campus-gutter) 16px}
.campus-story-tab{display:flex;align-items:center;justify-content:center;position:relative;min-width:0;min-height:48px;padding:0 0 8px;border:0;border-bottom:1px solid var(--campus-rule);background:none;font:16px var(--font);color:var(--campus-muted);cursor:pointer}
.campus-story-label{line-height:24px;letter-spacing:.08em}
.campus-story-tab[aria-selected=true]{color:var(--deep);font-weight:700;border-bottom-color:var(--green)}
.campus-story-tab:hover{color:var(--deep)}
.campus-story-stage{display:grid;grid-template-columns:var(--campus-info-width) minmax(0,1fr);min-height:0}
.campus-story-photos{position:relative;grid-column:2;grid-row:1;overflow:hidden;background:var(--deep);min-height:600px}
.campus-story-photo{position:absolute;inset:0;margin:0;opacity:0;pointer-events:none;transition:opacity .4s ease}
.campus-story-photo.is-current{opacity:1;pointer-events:auto}
.campus-story-photo-link{display:block;width:100%;height:100%}
.campus-stories .campus-story-photo-link:focus-visible{outline-color:var(--gold);outline-offset:-6px}
.campus-story-identity h3 a:hover{text-decoration:underline;text-underline-offset:8px;text-decoration-thickness:2px}
.campus-story-photo img{display:block;width:100%;height:100%;object-fit:cover}
.campus-story-photo::after{content:'';position:absolute;inset:65% 0 0;background:linear-gradient(transparent,rgb(var(--ink) / .45));pointer-events:none}
.campus-story-photo figcaption{position:absolute;z-index:1;left:32px;bottom:32px;display:flex;align-items:center;gap:14px;color:var(--paper);font-size:11px;letter-spacing:.08em;pointer-events:none}
.campus-story-photo figcaption span{display:grid;place-items:center;width:36px;height:36px;border:1px solid var(--mint);border-radius:50%;font-variant-numeric:tabular-nums}
.campus-story-copy{grid-column:1;grid-row:1;display:flex;flex-direction:column;align-items:start;justify-content:center;min-width:0;padding:40px var(--campus-gutter) 144px}
.campus-story-identity{width:100%}
.campus-story-district{font-size:12px;letter-spacing:.14em;color:var(--green)}
.campus-story-identity h3{font-family:var(--font-head);font-size:clamp(52px,5.2vw,84px);font-weight:700;white-space:nowrap;letter-spacing:.025em;line-height:1.15;margin:18px 0 14px}
.campus-story-english{display:block;font-size:10px;letter-spacing:.16em;color:var(--campus-muted)}
.campus-story-facts{border-top:1px solid var(--campus-rule);width:100%;display:grid;gap:8px;margin:32px 0 0;padding-top:20px}
.campus-story-facts>div{display:grid;grid-template-columns:96px minmax(0,1fr);align-items:center;gap:8px}
.campus-story-facts dt{display:flex;align-items:center;gap:7px;color:var(--green);font-size:12px}
.campus-story-facts dt .icon{height:16px;width:16px;flex-shrink:0}
.campus-story-facts dd{margin:0;min-width:0}
.campus-story-facts a{min-height:44px;display:inline-flex;align-items:center;gap:8px;max-width:100%}
.campus-story-address{font-size:14px;line-height:1.7}
.campus-story-address span{text-decoration:underline;text-underline-offset:5px;text-decoration-color:var(--campus-muted)}
.campus-story-address .icon{width:14px;height:14px;flex-shrink:0}
.campus-story-phone{font-size:23px;font-variant-numeric:tabular-nums;white-space:nowrap}
.campus-story-socials{display:flex;flex-wrap:wrap;gap:24px;margin-top:12px}
.campus-story-socials>*{display:inline-flex;align-items:center;gap:8px;min-height:44px;font-size:12px;color:var(--green)}
.campus-story-socials .icon{width:20px;height:20px}
.campus-story-socials small{font-size:11px}
.campus-story-booking{display:flex;flex-direction:column;align-items:start;gap:16px;margin-top:24px;width:100%}
.campus-discover{display:inline-flex;align-items:center;justify-content:space-between;gap:24px;min-height:52px;width:min(100%,280px);padding:0 22px;border:1px solid var(--green);border-radius:999px;color:var(--deep);font-size:14px;font-weight:600}
.campus-discover .icon{height:20px;width:20px;flex-shrink:0;transition:transform .2s ease}
.campus-discover:hover{background:var(--green);color:var(--paper)}
.campus-discover:hover .icon{transform:translateX(3px)}
.campus-story-booking :deep(.booking-status){margin:0;max-width:30em;border-left:2px solid var(--gold);padding-left:12px;color:var(--campus-muted);font-size:12px;line-height:1.8;text-wrap:pretty}
.campus-story-booking :deep(.button){width:min(100%,280px);min-height:52px;padding:12px 18px;border:0;border-radius:999px;background:var(--gold);color:var(--deep);text-align:center;font-size:13px;line-height:1.65;white-space:normal}
.campus-story-booking :deep(a.button:hover){background:var(--green);color:var(--paper)}
.campus-story-foot{position:absolute;bottom:28px;left:var(--campus-gutter);width:calc(var(--campus-info-width) - var(--campus-gutter)*2);display:grid;gap:14px}
.campus-story-controls{display:flex;align-items:center;gap:12px}
.campus-pagination{display:flex;align-items:center;min-height:52px;padding:4px 6px;border-radius:999px;background:var(--campus-control)}
.campus-page{display:grid;place-items:center;flex:none;width:44px;height:44px;padding:0;border:0;border-radius:999px;background:none;cursor:pointer;transition:width .25s ease}
.campus-page.is-current{width:64px}
.campus-progress-track{display:block;position:relative;width:7px;height:7px;overflow:hidden;border-radius:999px;background:var(--campus-muted);transition:width .25s ease,height .25s ease}
.campus-page.is-current .campus-progress-track{width:48px;height:8px}
.campus-progress-track>span{display:block;width:100%;height:100%;border-radius:inherit;background:var(--deep);transform-origin:left}
.campus-playback{display:grid;place-items:center;flex:none;width:52px;height:52px;padding:0;border:0;border-radius:50%;background:var(--campus-control);color:var(--deep);cursor:pointer}
.campus-playback .icon{width:22px;height:22px}
.campus-playback:hover,.campus-page:hover{background:var(--campus-rule)}
.campus-story-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--campus-muted);font-size:10px;letter-spacing:.06em;font-variant-numeric:tabular-nums}
.campus-stories :is(a,button):focus-visible{outline:3px solid var(--green);outline-offset:4px}
@media(min-width:761px) and (max-width:1100px){
 .campus-stories{--campus-gutter:26px;--campus-info-width:45%}
 .campus-story-facts>div{grid-template-columns:82px minmax(0,1fr);gap:5px}.campus-story-facts dt{font-size:11px}.campus-story-address{font-size:13px}.campus-story-phone{font-size:21px}
 .campus-story-controls{gap:8px}.campus-page.is-current{width:44px}.campus-page.is-current .campus-progress-track{width:34px}.campus-playback{width:44px;height:44px}
}
@media(min-width:761px) and (max-width:900px){
 .campus-stories{grid-template-rows:112px 64px minmax(600px,1fr)}.campus-story-header{align-items:end;padding-bottom:14px}
}
@media(max-width:760px){
 .campus-stories{--campus-gutter:22px;min-height:max(790px,100svh);grid-template-rows:112px 56px 1fr}
 .campus-story-header{align-items:end;padding-bottom:14px}.campus-section-title{gap:10px}.campus-section-title h2{font-size:18px}.campus-section-title>span{font-size:8px}
 .campus-story-tabs{gap:9px;padding-bottom:8px}.campus-story-tab{font-size:12px;min-height:48px;padding-bottom:0}.campus-story-label{letter-spacing:0}
 .campus-story-stage{grid-template-columns:minmax(0,1fr);grid-template-rows:clamp(190px,24svh,290px) 1fr}
 .campus-story-photos{grid-column:1;grid-row:1;min-height:0}.campus-story-photo figcaption{left:22px;bottom:18px;font-size:10px;gap:10px}.campus-story-photo figcaption span{width:28px;height:28px}
 .campus-story-copy{grid-row:2;padding:20px var(--campus-gutter) 116px;justify-content:start}.campus-story-identity{position:relative}.campus-story-district{font-size:10px}.campus-story-identity h3{font-size:46px;margin:10px 0 0}.campus-story-english{position:absolute;right:0;bottom:7px;font-size:8px;letter-spacing:.1em}
 .campus-story-facts{margin-top:16px;padding-top:10px;gap:0}.campus-story-facts>div{grid-template-columns:86px minmax(0,1fr);gap:4px}.campus-story-facts dt{font-size:11px}.campus-story-address{font-size:12px;gap:4px!important}.campus-story-address .icon{width:12px;height:12px}.campus-story-phone{font-size:19px}
 .campus-story-socials{margin-top:4px;gap:22px}.campus-story-socials>*{font-size:11px}.campus-story-booking{margin-top:10px;gap:12px}.campus-discover{min-height:48px;width:100%;font-size:13px;padding-inline:18px}.campus-story-booking :deep(.button){width:100%;min-height:48px;font-size:12px;padding:10px 16px}.campus-story-booking :deep(.booking-status){font-size:11px}
 .campus-story-foot{width:auto;right:var(--campus-gutter);bottom:24px;gap:12px}.campus-story-controls{justify-content:center}.campus-pagination{min-height:48px;padding-block:2px}.campus-playback{width:48px;height:48px}
}
@media(max-width:360px){
 .campus-stories{--campus-gutter:18px}.campus-story-tabs{gap:7px}.campus-story-tab{font-size:11px}.campus-story-identity h3{font-size:42px}.campus-story-english{font-size:7px}.campus-story-facts>div{grid-template-columns:78px minmax(0,1fr)}.campus-story-address{font-size:11px}
 .campus-story-controls{gap:8px}.campus-page.is-current{width:44px}.campus-page.is-current .campus-progress-track{width:34px}.campus-playback{width:44px;height:44px}
}
@media(prefers-reduced-motion:reduce){.campus-story-photo,.campus-page,.campus-progress-track,.campus-discover .icon{transition:none}}
@media(forced-colors:active){.campus-pagination,.campus-playback,.campus-progress-track{border:1px solid CanvasText}.campus-progress-track>span{background:CanvasText}.campus-story-tab[aria-selected=true],.campus-page.is-current{outline:2px solid Highlight;outline-offset:-3px}}
</style>
