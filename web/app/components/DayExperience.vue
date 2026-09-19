<script setup lang="ts">
import type { DayExperienceContent } from '~/types/site-content'

const props = defineProps<{ day: DayExperienceContent }>()

const videoEl = ref<HTMLVideoElement | null>(null)
const showVideo = ref(false)
const isPlaying = ref(false)

function toggleFilm() {
  const video = videoEl.value
  if (!video) return
  if (video.paused) video.play().catch(() => {})
  else video.pause()
}

onMounted(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (reduce.matches) return
  const isMobile = window.matchMedia('(max-width: 760px)').matches
  showVideo.value = true
  nextTick(() => {
    const video = videoEl.value
    if (!video) return
    video.src = `/${isMobile ? props.day.filmSrcMobile : props.day.filmSrc}`
    video.play().then(() => (isPlaying.value = true)).catch(() => {})
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
  <section class="section day-experience" :id="day.sectionId" aria-labelledby="day-heading">
    <div class="day-film" aria-hidden="true">
      <img class="day-film-poster" :src="`/assets/${day.filmPoster}.webp`" alt="" decoding="async">
      <video v-if="showVideo" ref="videoEl" class="day-film-video" muted loop playsinline preload="none" @pause="isPlaying = false" />
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
      <header class="day-intro">
        <span class="eyebrow">{{ day.eyebrow }}<span lang="en">{{ day.eyebrowEn }}</span></span>
        <h2 class="day-title" id="day-heading">
          <span class="t-ivy">{{ day.titleParts.ivy }}</span><span class="t-day">{{ day.titleParts.day }}</span>
        </h2>
      </header>
      <ol class="day-prints" :aria-label="`孩子的一天，${day.moments.length} 個日常片刻`">
        <DayMomentCard v-for="(moment, i) in day.moments" :key="moment.key" :moment="moment" :index="i" />
      </ol>
      <p class="day-note">{{ day.note }}</p>
    </div>
  </section>
</template>
