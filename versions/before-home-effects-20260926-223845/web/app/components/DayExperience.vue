<script setup lang="ts">
import { pickImage } from '~/utils/media-image'
import { noscriptImage } from '~/utils/noscript-image'
import { backgroundVideoSrc, mayAutoplay, type ConnectionInfo } from '~/utils/media-policy'
import type { DayExperienceContent } from '~/types/site-content'
import { useCurtain } from '~/composables/useCurtain'
import { readMotionViewport } from '~/utils/motionViewport'

const props = defineProps<{ day: DayExperienceContent }>()

const rootEl = ref<HTMLElement | null>(null)
const trackEl = ref<HTMLElement | null>(null)
const sectionEl = ref<HTMLElement | null>(null)
const videoEl = ref<HTMLVideoElement | null>(null)
const introEl = ref<HTMLElement | null>(null)
const printsEl = ref<HTMLOListElement | null>(null)
const activeIndex = ref(-1)
const posterReady = ref(false)
const posterImage = computed(() => pickImage(props.day.filmPoster, props.day.filmPosterMedia))
const filmPosition = ref<string | null>(null)

// panel 綁在這個元件的根元素本身（.day-experience），理由跟
// AboutSection.vue 的 useCurtain 呼叫一樣：clip-path／疊層要套在同一
// 個元素上才會跟 vanilla 的疊層判斷一致。
useCurtain(rootEl, trackEl, sectionEl, 'day')
const showVideo = ref(false)
const isPlaying = ref(false)
// 首次播放後才淡入；暫停時仍保留影片畫面，不退回封面。
const isVideoReady = ref(false)
const hasFailed = ref(false)

let wantsPlayback = true
let onScreen = false
let reduceQuery: MediaQueryList | null = null
let watcher: IntersectionObserver | null = null
let fadeFrame = 0
let printsObserver: ResizeObserver | null = null
let printOffsets: number[] = []
let readingHeight = 1
let hasScrolled = false

// 對齊 app.js 的 fadeBehindContent()＋markActive()：大標先留在畫面上，
// 拍立得列表靠近時淡成底紋（最低留 .16），並標出讀者停在哪一段，讓那
// 張相片的時間戳再亮一階。
const QUIET = 0.16
function paintFade() {
  fadeFrame = 0
  const intro = introEl.value
  const list = printsEl.value
  if (!intro || !list || !onScreen) return
  const top = list.getBoundingClientRect().top
  const from = readingHeight * 0.62
  const to = readingHeight * 0.25
  const progress = Math.min(1, Math.max(0, (from - top) / (from - to)))
  const line = readingHeight * 0.55 - top
  let active = -1
  printOffsets.forEach((offset, i) => {
    if (offset <= line) active = i
  })
  const fade = (1 - progress * (1 - QUIET)).toFixed(3)
  if (intro.style.getPropertyValue('--word-fade') !== fade) intro.style.setProperty('--word-fade', fade)
  activeIndex.value = active
}

function scheduleFade() {
  const scrolled = window.scrollY > 0
  if (scrolled !== hasScrolled) {
    hasScrolled = scrolled
    applyFilm()
  }
  if (onScreen && !fadeFrame) fadeFrame = requestAnimationFrame(paintFade)
}

function measurePrints() {
  if (!sectionEl.value || !printsEl.value) return
  readingHeight = readMotionViewport(sectionEl.value).height
  // 相片在列表內的相對位置只在版面改變時量測；捲動每幀只讀一次列表。
  printOffsets = Array.from(printsEl.value.querySelectorAll<HTMLElement>('.day-print'), print => print.offsetTop)
  scheduleFade()
}

// 對齊 app.js 的 applyFilm()：進畫面才載入、播放請求送出時讀者可能已
// 經捲離或切走頁籤，所以 play() resolve 後還要再檢查一次才決定要不要
// 立刻 pause 回去。isPlaying 直接由這裡的決策設定，不能只靠 video 的
// @playing／@pause 事件同步——IntersectionObserver 在快速捲動時會連續
// 觸發 applyFilm()，多個 play()/pause() 疊在一起時，事件觸發的先後順
// 序不保證跟真正的播放狀態一致，曾經實測出「畫面顯示暫停鍵、但影片其
// 實已經真的停格」的假活著狀態。
function applyFilm() {
  // 簾幕下層在初始幾何已接近首屏；封面也要等讀者捲到內容才下載。
  // 與自動播放偏好分開，減少動態或影片失敗時仍能看到靜態封面。
  if (onScreen && window.scrollY > 0) posterReady.value = true
  const video = videoEl.value
  if (!video || hasFailed.value) return
  // 首頁簾幕的下層幾何可能已碰到 viewport，但尚未真的捲入內容。
  if (!onScreen || !wantsPlayback || document.hidden || window.scrollY === 0) {
    video.pause()
    isPlaying.value = false
    return
  }
  if (!video.getAttribute('src')) {
    const isMobile = window.matchMedia('(max-width: 760px)').matches
    video.src = backgroundVideoSrc(isMobile ? props.day.filmSrcMobile : props.day.filmSrc, isMobile)
    filmPosition.value = (isMobile ? props.day.filmPositionMobile : props.day.filmPosition) ?? null
  }
  if (!video.paused) { isPlaying.value = true; return }
  video
    .play()
    .then(() => {
      const stillWanted = wantsPlayback && onScreen && !document.hidden && window.scrollY > 0
      if (!stillWanted) video.pause()
      isPlaying.value = stillWanted
    })
    .catch(() => {
      isPlaying.value = false
    })
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
  const connection = (navigator as Navigator & { connection?: ConnectionInfo }).connection
  wantsPlayback = mayAutoplay(reduceQuery.matches, connection)
  showVideo.value = true

  nextTick(() => {
    if (!sectionEl.value) return
    watcher = new IntersectionObserver(
      (entries) => {
        onScreen = entries.at(-1)?.isIntersecting ?? false
        applyFilm()
        scheduleFade()
      },
      // 簾幕會把下層內容疊在首屏底下；不要因底部露出的幾何範圍
      // 就下載影片，等區塊進入視窗主要閱讀區域再載入。
      { threshold: 0, rootMargin: '0px 0px -25% 0px' }
    )
    watcher.observe(sectionEl.value)
  })

  document.addEventListener('visibilitychange', onVisibilityChange)
  reduceQuery.addEventListener('change', onReduceMotionChange)
  window.addEventListener('scroll', scheduleFade, { passive: true })
  window.addEventListener('resize', measurePrints, { passive: true })
  if (printsEl.value) {
    printsObserver = new ResizeObserver(measurePrints)
    printsObserver.observe(printsEl.value)
  }
  measurePrints()
})

onUnmounted(() => {
  window.removeEventListener('scroll', scheduleFade)
  window.removeEventListener('resize', measurePrints)
  printsObserver?.disconnect()
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
          <img class="day-film-poster" v-bind="posterImage" :style="day.filmPosterMedia?.position ? { objectPosition: day.filmPosterMedia.position } : undefined" loading="lazy" fetchpriority="low" alt="" decoding="async">
          <video
            v-if="showVideo"
            ref="videoEl"
            class="day-film-video"
            :class="{ 'is-ready': isVideoReady }"
            :style="filmPosition ? { objectPosition: filmPosition } : undefined"
            muted
            loop
            playsinline
            preload="none"
            @playing="isVideoReady = true"
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
