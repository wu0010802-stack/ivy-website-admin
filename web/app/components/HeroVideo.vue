<script setup lang="ts">
import type { HeroContent } from '~/types/site-content'

const props = defineProps<{ hero: HeroContent }>()

const videoEl = ref<HTMLVideoElement | null>(null)
const showVideo = ref(false)
const isPlaying = ref(false)

function togglePlay() {
  const video = videoEl.value
  if (!video) return
  if (video.paused) video.play().catch(() => {})
  else video.pause()
}

onMounted(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (reduce.matches) return
  showVideo.value = true
  requestAnimationFrame(() => {
    videoEl.value?.play().catch(() => {})
  })
})

onUnmounted(() => {
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
