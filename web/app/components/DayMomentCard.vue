<script setup lang="ts">
import type { DayMoment } from '~/types/site-content'

const props = defineProps<{ moment: DayMoment; index: number }>()

const isFlipped = ref(false)
const isRevealed = ref(false)
const cardEl = ref<HTMLLIElement | null>(null)
let observer: IntersectionObserver | null = null

onMounted(() => {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (prefersReducedMotion || typeof IntersectionObserver === 'undefined' || !cardEl.value) {
    isRevealed.value = true
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          isRevealed.value = true
          observer?.disconnect()
        }
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.2 }
  )
  observer.observe(cardEl.value)
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null
})

function toggleFlip() {
  isFlipped.value = !isFlipped.value
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    toggleFlip()
  }
}

const kicker = computed(() => `${String(props.index + 1).padStart(2, '0')} / ${props.moment.label}`)
const titleLines = computed(() => props.moment.title.split('\n'))
</script>

<template>
  <li
    ref="cardEl"
    class="day-print"
    :class="[`tint-${moment.tint}`, { 'is-revealed': isRevealed }]"
    :id="`day-${moment.key}`"
  >
    <div class="print-card">
      <span class="print-tape" aria-hidden="true" />
      <div class="print-wrap" :class="{ 'is-flipped': isFlipped }">
        <div class="print">
          <div class="print-face print-front" :inert="isFlipped">
            <figure class="print-figure">
              <img class="print-photo" :src="`/assets/${moment.photo}.webp`" :alt="moment.alt" loading="lazy" decoding="async">
              <figcaption>{{ moment.caption }}</figcaption>
              <time class="print-stamp" :datetime="moment.time">{{ moment.time }}</time>
            </figure>
            <div class="print-foot">
              <p class="print-kicker">{{ kicker }}</p>
              <h3><template v-for="(line, i) in titleLines" :key="i">{{ line }}<br v-if="i < titleLines.length - 1"></template></h3>
            </div>
          </div>
          <div class="print-face print-back" :id="`day-story-${moment.key}`" :inert="!isFlipped">
            <p class="print-kicker">{{ kicker }}</p>
            <p class="print-story">{{ moment.story }}</p>
            <div class="print-ask">
              <p class="print-question">{{ moment.question }}</p>
              <p class="print-answer">{{ moment.answer }}</p>
            </div>
          </div>
        </div>
        <button
          class="print-flip"
          type="button"
          :aria-expanded="isFlipped"
          :aria-pressed="isFlipped"
          :aria-controls="`day-story-${moment.key}`"
          @click="toggleFlip"
          @keydown="onKeydown"
        >
          <span class="print-flip-label">{{ isFlipped ? '翻回正面' : '翻到背面' }}</span>
          <span class="print-flip-mark" aria-hidden="true">↻</span>
        </button>
      </div>
    </div>
  </li>
</template>
