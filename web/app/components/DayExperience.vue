<script setup lang="ts">
import type { DayExperienceContent } from '~/types/site-content'
import { useCurtain } from '~/composables/useCurtain'

const props = defineProps<{ day: DayExperienceContent }>()

const rootEl = ref<HTMLElement | null>(null)
const trackEl = ref<HTMLElement | null>(null)
const sectionEl = ref<HTMLElement | null>(null)
const videoEl = ref<HTMLVideoElement | null>(null)
const introEl = ref<HTMLElement | null>(null)
const printsEl = ref<HTMLOListElement | null>(null)
const activeIndex = ref(-1)

// panel 綁在這個元件的根元素本身（.day-experience），理由跟
// AboutSection.vue 的 useCurtain 呼叫一樣：clip-path／疊層要套在同一
// 個元素上才會跟 vanilla 的疊層判斷一致。
useCurtain(rootEl, trackEl, sectionEl, 'day')
const showVideo = ref(false)
const isPlaying = ref(false)
const hasFailed = ref(false)

let wantsPlayback = true
let onScreen = false
let reduceQuery: MediaQueryList | null = null
let watcher: IntersectionObserver | null = null
let fadeFrame = 0

// 對齊 app.js 的 fadeBehindContent()＋markActive()：大標先留在畫面上，
// 拍立得列表靠近時淡成底紋（最低留 .16），並標出讀者停在哪一段，讓那
// 張相片的時間戳再亮一階。
const QUIET = 0.16
function paintFade() {
  fadeFrame = 0
  const intro = introEl.value
  const list = printsEl.value
  if (!intro || !list) return
  const top = list.getBoundingClientRect().top
  const from = window.innerHeight * 0.62
  const to = window.innerHeight * 0.25
  const progress = Math.min(1, Math.max(0, (from - top) / (from - to)))
  intro.style.setProperty('--word-fade', (1 - progress * (1 - QUIET)).toFixed(3))
  const line = window.innerHeight * 0.55
  let active = -1
  list.querySelectorAll<HTMLElement>('.day-print').forEach((print, i) => {
    if (print.getBoundingClientRect().top <= line) active = i
  })
  activeIndex.value = active
}

function scheduleFade() {
  if (!fadeFrame) fadeFrame = requestAnimationFrame(paintFade)
}

// 對齊 app.js 的 applyFilm()：進畫面才載入、播放請求送出時讀者可能已
// 經捲離或切走頁籤，所以 play() resolve 後還要再檢查一次才決定要不要
// 立刻 pause 回去。
function applyFilm() {
  const video = videoEl.value
  if (!video || hasFailed.value) return
  if (!onScreen || !wantsPlayback || document.hidden) {
    video.pause()
    return
  }
  if (!video.getAttribute('src')) {
    const isMobile = window.matchMedia('(max-width: 760px)').matches
    video.src = `/${isMobile ? props.day.filmSrcMobile : props.day.filmSrc}`
  }
  video
    .play()
    .then(() => {
      if (!wantsPlayback || !onScreen || document.hidden) video.pause()
    })
    .catch(() => {})
}

function toggleFilm() {
  const video = videoEl.value
  if (!video) return
  wantsPlayback = video.paused
  applyFilm()
}

function onVideoError() {
  hasFailed.value = true
  showVideo.value = false
}

function onVisibilityChange() {
  applyFilm()
}

function onReduceMotionChange() {
  if (!reduceQuery?.matches) return
  wantsPlayback = false
  applyFilm()
}

onMounted(() => {
  reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  wantsPlayback = !reduceQuery.matches
  showVideo.value = true

  nextTick(() => {
    if (!sectionEl.value) return
    watcher = new IntersectionObserver(
      (entries) => {
        onScreen = entries[0]?.isIntersecting ?? false
        applyFilm()
      },
      { threshold: 0 }
    )
    watcher.observe(sectionEl.value)
  })

  document.addEventListener('visibilitychange', onVisibilityChange)
  reduceQuery.addEventListener('change', onReduceMotionChange)
  window.addEventListener('scroll', scheduleFade, { passive: true })
  window.addEventListener('resize', scheduleFade, { passive: true })
  paintFade()
})

onUnmounted(() => {
  window.removeEventListener('scroll', scheduleFade)
  window.removeEventListener('resize', scheduleFade)
  cancelAnimationFrame(fadeFrame)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  reduceQuery?.removeEventListener('change', onReduceMotionChange)
  watcher?.disconnect()
  const video = videoEl.value
  if (video) {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
})
</script>

<template>
  <div ref="rootEl" class="day-reveal">
    <div ref="trackEl" class="day-reveal-track">
      <section ref="sectionEl" class="section day-experience" :id="day.sectionId" aria-labelledby="day-heading">
        <div class="day-film" aria-hidden="true">
          <img class="day-film-poster" :src="`/assets/${day.filmPoster}.webp`" alt="" decoding="async">
          <video
            v-if="showVideo"
            ref="videoEl"
            class="day-film-video"
            muted
            loop
            playsinline
            preload="none"
            @playing="isPlaying = true"
            @pause="isPlaying = false"
            @error="onVideoError"
          />
          <span class="day-film-shade" />
        </div>
        <div class="day-film-ui">
          <p class="day-film-caption">
            <span>{{ day.filmCaption.zh }}</span>
            <span lang="en">{{ day.filmCaption.en }}</span>
          </p>
          <button v-if="showVideo" class="day-film-toggle" type="button" :aria-pressed="isPlaying" @click="toggleFilm">
            <span class="day-film-mark" aria-hidden="true">{{ isPlaying ? '❙❙' : '▶' }}</span>
            <span class="day-film-state">{{ isPlaying ? '暫停背景' : '播放背景' }}</span>
          </button>
        </div>
        <div class="day-stage">
          <header ref="introEl" class="day-intro">
            <span class="eyebrow">{{ day.eyebrow }}<span lang="en">{{ day.eyebrowEn }}</span></span>
            <h2 class="day-title" id="day-heading">
              <span class="t-ivy">{{ day.titleParts.ivy }}</span><span class="t-day">{{ day.titleParts.day }}</span>
            </h2>
          </header>
          <ol ref="printsEl" class="day-prints" :aria-label="`孩子的一天，${day.moments.length} 個日常片刻`">
            <DayMomentCard v-for="(moment, i) in day.moments" :key="moment.key" :moment="moment" :index="i" :active="i === activeIndex" />
          </ol>
          <p class="day-note">{{ day.note }}</p>
        </div>
      </section>
    </div>
    <slot />
  </div>
</template>
