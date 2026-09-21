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
  focused.value = target instanceof Element && Boolean(root.value?.contains(target)) && !target.closest('.campus-playback')
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
      <button v-if="orderedCampuses.length > 1" class="campus-playback" type="button" :aria-label="canAuto ? '暫停分校自動播放' : '開始分校自動播放'" @click="togglePlayback">
        <svg class="icon" aria-hidden="true"><use :href="canAuto ? '#i-pause' : '#i-play'" /></svg><span>{{ canAuto ? '暫停' : '播放' }}</span>
      </button>
    </header>
    <div class="campus-story-tabs" role="tablist" aria-label="選擇分校" @pointerenter="hover($event, true)" @pointerleave="hover($event, false)">
      <button v-for="(campus, i) in orderedCampuses" :id="`campus-tab-${campus.key}`" :key="campus.key" :data-campus-tab="i" class="campus-story-tab" type="button" role="tab" :aria-selected="i === index" :tabindex="i === index ? 0 : -1" aria-controls="campus-stage" @click="select(i)" @keydown="onKey($event, i)">
        <span class="campus-story-track" aria-hidden="true"><span :style="{ transform: `scaleX(${i < index ? 1 : i === index ? progress : 0})` }" /></span>
        <span class="campus-story-label">{{ campus.name }}</span>
      </button>
    </div>
    <div id="campus-stage" class="campus-story-stage" role="tabpanel" :aria-labelledby="`campus-tab-${current.key}`" :aria-live="playing ? 'off' : 'polite'">
      <div class="campus-story-photos">
        <figure v-for="(campus, i) in orderedCampuses" :key="campus.key" class="campus-story-photo" :class="{ 'is-current': i === index }" :aria-hidden="i !== index">
          <img v-bind="responsiveImage(campus.image, '(max-width: 760px) 100vw, 61vw')" :fetchpriority="i === index ? 'auto' : 'low'" :alt="i === index ? `${campus.name}校園外觀` : ''" :style="{ objectPosition: campus.panoramaPos || 'center 55%' }" loading="lazy" decoding="async">
          <figcaption><span>{{ String(i + 1).padStart(2, '0') }}</span>{{ campus.name }} · 校園一隅</figcaption>
        </figure>
      </div>
      <div class="campus-story-copy" @pointerenter="hover($event, true)" @pointerleave="hover($event, false)">
        <div class="campus-story-identity"><span class="campus-story-district">高雄 · {{ current.district }}</span><h3>{{ current.name }}</h3><span class="campus-story-english" lang="en">{{ current.key.toUpperCase() }} CAMPUS</span></div>
        <dl class="campus-story-facts">
          <div><dt><svg class="icon" aria-hidden="true"><use href="#i-map-pin" /></svg>校園位置</dt><dd><a class="campus-story-address" :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(current.address)}`" :aria-label="`${current.address}，在 Google 地圖開啟（另開分頁）`" target="_blank" rel="noopener noreferrer"><span>{{ current.address }}</span><svg class="icon" aria-hidden="true"><use href="#i-arrow-up-right" /></svg></a></dd></div>
          <div><dt><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>參觀專線</dt><dd><a class="campus-story-phone" :href="`tel:${current.phone}`">{{ current.phone }}</a></dd></div>
        </dl>
        <div class="campus-story-socials">
          <a v-if="current.line" :href="current.line" target="_blank" rel="noopener noreferrer"><svg class="icon" aria-hidden="true"><use href="#i-line" /></svg>LINE 好友</a>
          <span v-else><svg class="icon" aria-hidden="true"><use href="#i-line" /></svg>LINE <small>待補</small></span>
          <a v-if="current.facebook" :href="current.facebook" target="_blank" rel="noopener noreferrer"><svg class="icon" aria-hidden="true"><use href="#i-facebook" /></svg>Facebook</a>
        </div>
        <div class="campus-story-booking"><NuxtLink class="text-link" :to="`/campuses/${current.key}`">認識{{ current.name }} ↗</NuxtLink><BookingCta :campus-key="current.key" button-class="button primary">預約參觀{{ current.name }}<svg class="icon" aria-hidden="true"><use href="#i-arrow-right" /></svg></BookingCta></div>
      </div>
    </div>
    <div class="campus-story-foot" aria-hidden="true"><span>{{ reading || focused ? '閱讀中，暫停播放' : canAuto ? '每 6 秒，走訪一所校園' : '點選校名，探索校園' }}</span><span>{{ String(index + 1).padStart(2, '0') }} / {{ String(orderedCampuses.length).padStart(2, '0') }}</span></div>
  </section>
</template>

<style scoped>
.campus-stories {
  --campus-paper:#fcfaf3; --campus-rule:#d3dbcf; --campus-muted:#637c6c; --campus-gutter:clamp(24px,4vw,80px);
  position:relative; isolation:isolate; background:var(--campus-paper); color:var(--deep); padding:0;
  min-height:max(760px,100svh); display:grid; grid-template-rows:102px 74px minmax(580px,1fr); scroll-margin-top:0;
}
.campus-story-header{display:flex;align-items:center;justify-content:space-between;padding:0 var(--campus-gutter)}
.campus-section-title{display:flex;align-items:baseline;gap:16px}
.campus-section-title h2{margin:0;font-family:var(--font-head);font-size:24px;font-weight:700;letter-spacing:.06em}
.campus-section-title>span{font-size:10px;letter-spacing:.15em;color:var(--campus-muted)}
.campus-playback{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-width:76px;min-height:44px;margin-right:290px;padding:0 14px;border:1px solid var(--campus-rule);border-radius:999px;background:var(--campus-paper);color:var(--green);font:12px var(--font);cursor:pointer}
.campus-playback .icon{width:15px;height:15px}
.campus-story-tabs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:clamp(10px,2vw,32px);padding:4px var(--campus-gutter) 20px}
.campus-story-tab{display:flex;flex-direction:column;gap:10px;align-items:stretch;justify-content:start;min-width:0;min-height:48px;padding:0;border:0;background:none;font:15px var(--font);color:var(--campus-muted);cursor:pointer}
.campus-story-label{line-height:24px;text-align:left;letter-spacing:.05em}
.campus-story-tab[aria-selected=true]{color:var(--deep);font-weight:700}
.campus-story-track{display:block;height:4px;width:100%;border-radius:999px;overflow:hidden;background:var(--campus-rule)}
.campus-story-track>span{display:block;width:100%;height:100%;background:var(--green);transform-origin:left}
.campus-story-tab[aria-selected=true] .campus-story-track>span{background:var(--gold)}
.campus-story-stage{display:grid;grid-template-columns:39% 61%;min-height:0}
.campus-story-photos{position:relative;grid-column:2;grid-row:1;overflow:hidden;background:var(--deep);min-height:580px}
.campus-story-photo{position:absolute;inset:0;margin:0;opacity:0;transition:opacity .4s ease}
.campus-story-photo.is-current{opacity:1}
.campus-story-photo img{display:block;width:100%;height:100%;object-fit:cover;transform:scale(1.04)}
.campus-story-photo::after{content:'';position:absolute;inset:65% 0 0;background:linear-gradient(transparent,rgb(var(--ink) / .45));pointer-events:none}
.campus-story-photo figcaption{position:absolute;z-index:1;left:32px;bottom:42px;display:flex;align-items:center;gap:14px;color:var(--paper);font-size:11px;letter-spacing:.08em}
.campus-story-photo figcaption span{display:grid;place-items:center;width:36px;height:36px;border:1px solid var(--mint);border-radius:50%;font-variant-numeric:tabular-nums}
.campus-story-copy{grid-column:1;grid-row:1;display:flex;flex-direction:column;align-items:start;justify-content:center;min-width:0;padding:48px var(--campus-gutter) 100px}
.campus-story-district{font-size:12px;letter-spacing:.14em;color:var(--green)}
.campus-story-identity h3{font-family:var(--font-head);font-size:clamp(52px,5.4vw,88px);font-weight:700;white-space:nowrap;letter-spacing:.025em;line-height:1.15;margin:20px 0 18px}
.campus-story-english{display:block;font-size:10px;letter-spacing:.14em}
.campus-story-facts{border-top:1px solid var(--campus-rule);width:100%;display:grid;gap:10px;margin:28px 0 0;padding-top:24px}
.campus-story-facts dt{display:flex;align-items:center;gap:7px;color:var(--green);font-size:12px}
.campus-story-facts dt .icon{height:16px;width:16px}
.campus-story-facts dd{margin:0}
.campus-story-facts a{min-height:44px;display:inline-flex;align-items:center;gap:8px}
.campus-story-address{font-size:15px}
.campus-story-address span{text-decoration:underline;text-underline-offset:5px}
.campus-story-address .icon{width:15px;height:15px;flex-shrink:0}
.campus-story-phone{font-size:21px;font-variant-numeric:tabular-nums}
.campus-story-socials{display:flex;flex-wrap:wrap;gap:20px;margin-top:10px}
.campus-story-socials>*{display:inline-flex;align-items:center;gap:8px;min-height:44px;font-size:12px;color:var(--green)}
.campus-story-socials .icon{width:20px;height:20px}
.campus-story-socials small{font-size:11px}
.campus-story-booking{margin-top:22px;width:100%}
.campus-story-booking :deep(.button){width:100%;min-height:54px;padding:12px 18px;border:0;border-radius:999px;background:var(--gold);color:var(--deep);text-align:center;font-size:13px;line-height:1.65;white-space:normal}
.campus-story-booking :deep(a.button:hover){background:var(--green);color:var(--paper)}
.campus-story-booking :deep(.is-disabled){opacity:1}
.campus-story-foot{position:absolute;bottom:24px;left:var(--campus-gutter);width:calc(39% - var(--campus-gutter)*2);display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--campus-muted);font-size:10px;letter-spacing:.07em}
.campus-stories :is(a,button):focus-visible{outline:3px solid var(--green);outline-offset:5px}
@media(min-width:761px) and (max-width:1100px){.campus-stories{--campus-gutter:26px}.campus-playback{margin-right:255px}}
@media(max-width:760px){
 .campus-stories{--campus-gutter:22px;min-height:max(790px,100svh);grid-template-rows:132px 64px 1fr}
 .campus-story-header{align-items:end;padding-bottom:15px}.campus-section-title{gap:10px}.campus-section-title h2{font-size:18px}.campus-section-title>span{font-size:8px}
 .campus-playback{margin-right:0;min-width:65px;min-height:44px;padding:0 9px;font-size:11px}
 .campus-story-tabs{gap:9px;padding-top:2px;padding-bottom:18px}.campus-story-tab{font-size:12px;gap:8px;min-height:44px}.campus-story-label{text-align:center;letter-spacing:0}.campus-story-track{height:3px}
 .campus-story-stage{grid-template-columns:minmax(0,1fr);grid-template-rows:clamp(205px,26svh,310px) 1fr}
 .campus-story-photos{grid-column:1;grid-row:1;min-height:0}.campus-story-photo figcaption{left:22px;bottom:18px;font-size:10px;gap:10px}.campus-story-photo figcaption span{width:28px;height:28px}
 .campus-story-copy{grid-row:2;padding:22px var(--campus-gutter) 76px;justify-content:start}.campus-story-identity{position:relative;width:100%}.campus-story-district{font-size:10px}.campus-story-identity h3{font-size:46px;margin:10px 0 0}.campus-story-english{position:absolute;right:0;bottom:7px;font-size:8px;letter-spacing:.1em}
 .campus-story-facts{margin-top:18px;padding-top:10px;gap:0}.campus-story-facts>div{display:grid;grid-template-columns:90px 1fr;align-items:center}.campus-story-facts dt{font-size:11px}.campus-story-facts a{min-height:44px}.campus-story-address{font-size:12px;gap:4px!important}.campus-story-address .icon{width:12px;height:12px}.campus-story-phone{font-size:19px}
 .campus-story-socials{margin-top:3px;gap:22px}.campus-story-socials>*{font-size:11px}.campus-story-booking{margin-top:6px}.campus-story-booking :deep(.button){min-height:46px;font-size:12px;padding:10px 16px}
 .campus-story-foot{width:auto;right:var(--campus-gutter);bottom:20px}
}
@media(max-width:360px){.campus-stories{--campus-gutter:18px}.campus-story-tabs{gap:7px}.campus-story-tab{font-size:11px}.campus-story-identity h3{font-size:42px}.campus-story-english{font-size:7px}.campus-story-facts>div{grid-template-columns:78px 1fr}.campus-story-address{font-size:11px}}
@media(prefers-reduced-motion:reduce){.campus-story-photo{transition:none}}
@media(forced-colors:active){.campus-story-track{border:1px solid CanvasText}.campus-story-track>span{background:CanvasText}.campus-story-tab[aria-selected=true]{outline:2px solid Highlight;outline-offset:3px}}
</style>
