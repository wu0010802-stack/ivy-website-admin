<script setup lang="ts">
import { HOME_HERO_SIZES, responsiveImage } from '~/utils/responsive-image'
import { backgroundVideoSrc, mayAutoplay, type ConnectionInfo } from '~/utils/media-policy'
import type { HeroContent } from '~/types/site-content'
import { useHomeReveal } from '~/composables/useHomeReveal'

const props = defineProps<{ hero: HeroContent }>()

const rootEl = ref<HTMLElement | null>(null)
const trackEl = ref<HTMLElement | null>(null)
const sectionEl = ref<HTMLElement | null>(null)
const copyEl = ref<HTMLElement | null>(null)
const imageEl = ref<HTMLElement | null>(null)
const mediaEl = ref<HTMLElement | null>(null)
const actionsEl = ref<HTMLElement | null>(null)
const videoEl = ref<HTMLVideoElement | null>(null)
const showVideo = ref(false)
const isPlaying = ref(false)
const heroImgEl = ref<HTMLImageElement | null>(null)
const videoSrc = ref('')
let disposed = false
let playbackFrame = 0
let removeImageListener: (() => void) | undefined

useHomeReveal({ root: rootEl, track: trackEl, hero: sectionEl, copy: copyEl, image: imageEl, media: mediaEl, actions: actionsEl })

let wantsPlayback = false
let onScreen = true
let reduceQuery: MediaQueryList | null = null
let watcher: IntersectionObserver | null = null

// isPlaying 直接由這裡的決策設定，不能只靠 video 的 @playing／@pause
// 事件同步——IntersectionObserver 在快速捲動時會連續觸發
// applyPlayback()，多個 play()/pause() 疊在一起時，事件觸發的先後順
// 序不保證跟真正的播放狀態一致（DayExperience.vue 的背景影片實測過
// 「畫面顯示暫停鍵、但影片其實已經真的停格」的假活著狀態，這裡是同一
// 個播放/暫停按鈕，用同一套防呆）。
function applyPlayback() {
  const video = videoEl.value
  if (!video) return
  if (document.hidden || !onScreen || !wantsPlayback) {
    video.pause()
    isPlaying.value = false
    return
  }
  video
    .play()
    .then(() => {
      const stillWanted = wantsPlayback && onScreen && !document.hidden
      if (!stillWanted) video.pause()
      isPlaying.value = stillWanted
    })
    .catch(() => {
      isPlaying.value = false
    })
}

function togglePlay() {
  const video = videoEl.value
  if (!video) return
  wantsPlayback = video.paused
  applyPlayback()
}

function onVideoError() {
  wantsPlayback = false
  showVideo.value = false
}

// 分頁切到背景時暫停，切回來若使用者原本要看就恢復播放——不是單純
// pause 完就不管，避免使用者切回分頁時影片停在暫停畫面卻沒發現。
function onVisibilityChange() {
  applyPlayback()
}

// 使用者中途在系統設定切換「減少動態」，要立刻反映，不是只在掛載當下
// 判斷一次就定生死。
function onReduceMotionChange() {
  if (!reduceQuery?.matches) return
  wantsPlayback = false
  applyPlayback()
}

onMounted(() => {
  reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  const connection = (navigator as Navigator & { connection?: ConnectionInfo }).connection
  if (!mayAutoplay(reduceQuery.matches, connection)) return
  wantsPlayback = true
  const startVideo = () => {
    if (disposed) return
    videoSrc.value = backgroundVideoSrc(props.hero.heroVideoSrc, window.matchMedia('(max-width: 760px)').matches)
    showVideo.value = true
    nextTick(() => {
      if (disposed) return
      playbackFrame = requestAnimationFrame(applyPlayback)
    })
  }
  // 封面完成後再啟動影片，避免首屏圖片與 mp4 搶頻寬。手機再多等整頁
  // load 與一段閒置：4G 實測 mp4 會在 LCP 前就開始下載，跟 hydration
  // chunk 與下方 lazy 圖搶頻寬（見 perf-auditor 2026-09-22 盤點）。
  const beginVideo = () => {
    if (disposed) return
    if (!window.matchMedia('(max-width: 760px)').matches) return startVideo()
    const idle = () => {
      if (disposed) return
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(startVideo, { timeout: 2500 })
      else window.setTimeout(startVideo, 1200)
    }
    if (document.readyState === 'complete') idle()
    else window.addEventListener('load', idle, { once: true })
  }
  if (heroImgEl.value?.complete) beginVideo()
  else if (heroImgEl.value) {
    const image = heroImgEl.value
    image.addEventListener('load', beginVideo, { once: true })
    image.addEventListener('error', beginVideo, { once: true })
    removeImageListener = () => {
      image.removeEventListener('load', beginVideo)
      image.removeEventListener('error', beginVideo)
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  reduceQuery.addEventListener('change', onReduceMotionChange)

  // 首屏轉場（見 useHomeReveal）捲走或黏住時，影片可能已經不在畫面
  // 上，此時暫停；同一支 IntersectionObserver 也涵蓋一般往下捲離開
  // 首屏的情況，不用另外接 useHomeReveal 的 callback。
  if (sectionEl.value) {
    watcher = new IntersectionObserver(
      (entries) => {
        onScreen = entries[0]?.isIntersecting ?? true
        applyPlayback()
      },
      { threshold: 0 }
    )
    watcher.observe(sectionEl.value)
  }
})

onUnmounted(() => {
  disposed = true
  cancelAnimationFrame(playbackFrame)
  removeImageListener?.()
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
  <div ref="rootEl" class="home-reveal">
    <div ref="trackEl" class="home-reveal-track">
      <section ref="sectionEl" class="studio-hero" aria-labelledby="home-title">
        <div class="container studio-hero-grid">
          <div ref="copyEl" class="studio-hero-copy">
            <span class="eyebrow">{{ hero.eyebrow }}</span>
            <h1 id="home-title">
              {{ hero.titleParts.before }}<span class="punct">{{ hero.titleParts.punctAfterBefore }}</span><br>
              {{ hero.titleParts.middle }}<span class="hero-title-ending">
                <span class="growing-word">{{ hero.titleParts.growingWord }}
                  <span class="hero-underline" aria-hidden="true"><svg viewBox="0 0 180 14"><path d="M3 9Q48 2 92 7T177 6" /></svg></span>
                </span><span class="punct">{{ hero.titleParts.punctAfterGrowingWord }}</span>
              </span>
            </h1>
            <p>
              <span v-for="line in hero.copyLines" :key="line" class="hero-copy-line">{{ line }}</span>
            </p>
            <div ref="actionsEl" class="studio-actions">
              <a class="hero-campus-link" href="#campuses">找校區<svg class="icon" aria-hidden="true"><use href="#i-arrow-right" /></svg></a>
            </div>
          </div>
          <figure ref="imageEl" class="studio-hero-image">
            <img
              ref="heroImgEl"
              v-bind="responsiveImage(hero.heroImage, HOME_HERO_SIZES)"
              :alt="hero.heroImageAlt"
              loading="eager"
              fetchpriority="high"
            >
            <video
              v-if="showVideo"
              id="hero-video"
              ref="videoEl"
              :src="videoSrc"
              muted
              loop
              playsinline
              preload="none"
              aria-hidden="true"
              @error="onVideoError"
            />
          </figure>
        </div>
        <div ref="mediaEl" class="container studio-media">
          <div id="video-controls" :hidden="!showVideo">
            <button type="button" id="video-play" aria-controls="hero-video" @click="togglePlay">
              <svg class="icon" aria-hidden="true"><use :href="isPlaying ? '#i-pause' : '#i-play'" /></svg>
              <span class="sr-only">{{ isPlaying ? '暫停影片' : '播放影片' }}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
    <slot />
  </div>
</template>

<style scoped>
/* 2026-09-23 拿掉「看看孩子的一天」按鈕後，這一列只剩手機版的「找校區」。 */
.studio-actions{display:none}
@media(max-width:760px){
  .studio-actions{display:flex}
  .hero-campus-link{display:inline-flex;align-items:center;gap:8px;min-height:44px;color:inherit;font-size:var(--fs-md);text-decoration:underline;text-underline-offset:5px}
}
</style>
