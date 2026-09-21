<script setup lang="ts">
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

useHomeReveal({ root: rootEl, track: trackEl, hero: sectionEl, copy: copyEl, image: imageEl, media: mediaEl, actions: actionsEl })

let wantsPlayback = false
let onScreen = true
let reduceQuery: MediaQueryList | null = null
let watcher: IntersectionObserver | null = null

function applyPlayback() {
  const video = videoEl.value
  if (!video) return
  if (document.hidden || !onScreen || !wantsPlayback) video.pause()
  else video.play().catch(() => {})
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
                  <svg aria-hidden="true" viewBox="0 0 180 14"><path pathLength="1" d="M3 9Q48 2 92 7T177 6" /></svg>
                </span><span class="punct">{{ hero.titleParts.punctAfterGrowingWord }}</span>
              </span>
            </h1>
            <p>
              <span v-for="line in hero.copyLines" :key="line" class="hero-copy-line">{{ line }}</span>
            </p>
            <div ref="actionsEl" class="studio-actions">
              <a class="button ghost" :href="hero.ctaHref">{{ hero.ctaLabel }}</a>
            </div>
          </div>
          <figure ref="imageEl" class="studio-hero-image">
            <img
              :src="`/assets/${hero.heroImage}.webp`"
              :alt="hero.heroImageAlt"
              loading="eager"
              fetchpriority="high"
            >
            <video
              v-if="showVideo"
              id="hero-video"
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
