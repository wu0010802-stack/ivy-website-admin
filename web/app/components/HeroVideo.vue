<script setup lang="ts">
import type { HeroContent } from '~/types/site-content'

const props = defineProps<{ hero: HeroContent }>()

const videoEl = ref<HTMLVideoElement | null>(null)
const showVideo = ref(false)
const isPlaying = ref(false)

let wantsPlayback = false
let reduceQuery: MediaQueryList | null = null

function togglePlay() {
  const video = videoEl.value
  if (!video) return
  if (video.paused) {
    wantsPlayback = true
    video.play().catch(() => {})
  } else {
    wantsPlayback = false
    video.pause()
  }
}

function onVideoError() {
  wantsPlayback = false
  showVideo.value = false
}

// 分頁切到背景時暫停，切回來若使用者原本要看就恢復播放——不是單純
// pause 完就不管，避免使用者切回分頁時影片停在暫停畫面卻沒發現。
function onVisibilityChange() {
  const video = videoEl.value
  if (!video) return
  if (document.hidden) video.pause()
  else if (wantsPlayback) video.play().catch(() => {})
}

// 使用者中途在系統設定切換「減少動態」，要立刻反映，不能只在掛載當下
// 判斷一次就定生死。
function onReduceMotionChange() {
  if (!reduceQuery?.matches) return
  wantsPlayback = false
  videoEl.value?.pause()
}

onMounted(() => {
  reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  const connection = (navigator as any).connection
  const frugal = Boolean(connection?.saveData) || /^(slow-2g|2g|3g)$/.test(connection?.effectiveType ?? '')

  if (reduceQuery.matches || frugal) return
  showVideo.value = true
  wantsPlayback = true
  nextTick(() => {
    requestAnimationFrame(() => {
      videoEl.value?.play().catch(() => {})
    })
  })

  document.addEventListener('visibilitychange', onVisibilityChange)
  reduceQuery.addEventListener('change', onReduceMotionChange)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  reduceQuery?.removeEventListener('change', onReduceMotionChange)
  const video = videoEl.value
  if (video) {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
})
</script>

<template>
  <section class="studio-hero" aria-labelledby="home-title">
    <div class="container studio-hero-grid">
      <div class="studio-hero-copy">
        <span class="eyebrow">{{ hero.eyebrow }}</span>
        <h1 id="home-title">
          {{ hero.titleParts.before }}<span class="punct">{{ hero.titleParts.punctAfterBefore }}</span><br>
          {{ hero.titleParts.middle }}<span class="hero-title-ending">
            <span class="growing-word">{{ hero.titleParts.growingWord }}
              <svg aria-hidden="true" viewBox="0 0 180 14"><path pathLength="1" d="M3 9Q48 2 92 7T177 6" /></svg>
            </span><span class="punct">{{ hero.titleParts.punctAfterGrowingWord }}</span>
          </span>
        </h1>
        <p>
          <span v-for="line in hero.copyLines" :key="line" class="hero-copy-line">{{ line }}</span>
        </p>
        <div class="studio-actions">
          <a class="button ghost" :href="hero.ctaHref">{{ hero.ctaLabel }}</a>
        </div>
      </div>
      <figure class="studio-hero-image">
        <img
          :src="`/assets/${hero.heroImage}.webp`"
          :alt="hero.heroImageAlt"
          loading="eager"
          fetchpriority="high"
        >
        <video
          v-if="showVideo"
          ref="videoEl"
          :src="`/${hero.heroVideoSrc}`"
          muted
          loop
          playsinline
          preload="none"
          :poster="`/${hero.heroVideoPoster}`"
          aria-hidden="true"
          @playing="isPlaying = true"
          @pause="isPlaying = false"
          @error="onVideoError"
        />
      </figure>
    </div>
    <div class="container studio-media">
      <div id="video-controls" :hidden="!showVideo">
        <button type="button" id="video-play" aria-controls="hero-video" @click="togglePlay">
          <span class="sr-only">{{ isPlaying ? '暫停影片' : '播放影片' }}</span>
        </button>
      </div>
    </div>
  </section>
</template>
