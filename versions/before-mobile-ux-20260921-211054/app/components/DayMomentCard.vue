<script setup lang="ts">
import { responsiveImage } from '~/utils/responsive-image'
import type { DayMoment } from '~/types/site-content'
import type { PaperHandle } from '~/utils/paperPrints'
import { mayAutoplay, type ConnectionInfo } from '~/utils/media-policy'

const props = defineProps<{ moment: DayMoment; index: number; active?: boolean }>()

const isFlipped = ref(false)
const isRevealed = ref(false)
const isTilting = ref(false)
const webglReady = ref(false)
const cardEl = ref<HTMLLIElement | null>(null)
const wrapEl = ref<HTMLDivElement | null>(null)
const printEl = ref<HTMLDivElement | null>(null)
let observer: IntersectionObserver | null = null
let nearObserver: IntersectionObserver | null = null
let paper: PaperHandle | null = null
let paperPending = false
let tiltFrame = 0
let pointerPosition: { x: number; y: number } | null = null

function applyTilt() {
  tiltFrame = 0
  const wrap = wrapEl.value
  const card = printEl.value
  if (!wrap || !card || !pointerPosition) return
  const box = wrap.getBoundingClientRect()
  const x = (pointerPosition.x - box.left) / box.width
  const y = (pointerPosition.y - box.top) / box.height
  card.style.setProperty('--ry', `${((x - 0.5) * 14).toFixed(2)}deg`)
  card.style.setProperty('--rx', `${((0.5 - y) * 10).toFixed(2)}deg`)
  card.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`)
  card.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`)
  card.style.setProperty('--glare', '1')
}

function onPointerMove(event: PointerEvent) {
  if (paper) {
    paper.pointerMove(event.clientX, event.clientY)
    return
  }
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!fine || reduce) return
  pointerPosition = { x: event.clientX, y: event.clientY }
  isTilting.value = true
  if (!tiltFrame) tiltFrame = requestAnimationFrame(applyTilt)
}

function onPointerLeave() {
  if (paper) {
    paper.pointerLeave()
    return
  }
  pointerPosition = null
  cancelAnimationFrame(tiltFrame)
  tiltFrame = 0
  isTilting.value = false
  const card = printEl.value
  if (card) {
    card.style.removeProperty('--rx')
    card.style.removeProperty('--ry')
    card.style.removeProperty('--glare')
  }
}

// WebGL 紙張版（比稿 R）：快接近視窗才載 three，成功就把 DOM 卡片的
// 翻面／傾斜／顯影交給它；失敗或減少動態就維持 CSS 3D 版。
async function attachPaper() {
  if (paper || paperPending || !wrapEl.value) return
  paperPending = true
  const module = await import('~/utils/paperPrints').catch(() => null)
  if (!module || !wrapEl.value?.isConnected) { paperPending = false; return }
  const { mountPaper } = module
  const handle = await mountPaper(wrapEl.value, {
    kicker: kicker.value,
    titleLines: titleLines.value,
    caption: props.moment.caption,
    time: props.moment.time,
    story: props.moment.story,
    question: props.moment.question,
    answer: props.moment.answer
  })
  paperPending = false
  if (!handle) return
  if (!wrapEl.value?.isConnected) {
    handle.dispose()
    return
  }
  paper = handle
  webglReady.value = true
  onPointerLeave()
  paper.setFlipped(isFlipped.value)
  paper.setActive(Boolean(props.active))
  if (isRevealed.value) paper.setRevealed()
}

watch(isFlipped, (value) => paper?.setFlipped(value))
watch(isRevealed, (value) => {
  if (value) paper?.setRevealed()
})
watch(
  () => props.active,
  (value) => paper?.setActive(Boolean(value))
)

onMounted(() => {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (prefersReducedMotion || typeof IntersectionObserver === 'undefined' || !cardEl.value) {
    isRevealed.value = true
    return
  }
  const connection = (navigator as Navigator & { connection?: ConnectionInfo }).connection
  if (mayAutoplay(prefersReducedMotion, connection)) nearObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        nearObserver?.disconnect()
        nearObserver = null
        void attachPaper()
      }
    },
    { rootMargin: '60% 0px' }
  )
  nearObserver?.observe(cardEl.value)
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
  nearObserver?.disconnect()
  nearObserver = null
  cancelAnimationFrame(tiltFrame)
  paper?.dispose()
  paper = null
  webglReady.value = false
})

function toggleFlip() {
  isFlipped.value = !isFlipped.value
}

// 整張相片都能點來翻面，但相片裡本來就有的連結/按鈕維持原本行為。
function onWrapClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a,button')) return
  toggleFlip()
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
    :class="[`tint-${moment.tint}`, { 'is-revealed': isRevealed, 'is-active': active }]"
    :id="`day-${moment.key}`"
  >
    <div class="print-card">
      <span class="print-tape" aria-hidden="true" />
      <div
        ref="wrapEl"
        class="print-wrap"
        :class="{ 'is-flipped': isFlipped, 'is-tilting': isTilting, 'webgl-ready': webglReady }"
        @pointermove="onPointerMove"
        @pointerleave="onPointerLeave"
        @click="onWrapClick"
      >
        <div ref="printEl" class="print">
          <div class="print-face print-front" :inert="isFlipped">
            <figure class="print-figure">
              <img class="print-photo" v-bind="responsiveImage(moment.photo, '(max-width: 760px) 85vw, 420px')" :alt="moment.alt" loading="lazy" decoding="async">
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
          :aria-controls="`day-story-${moment.key}`"
          @click="toggleFlip"
          @keydown="onKeydown"
        >
          <span class="print-flip-badge" aria-hidden="true">
            <svg class="icon" focusable="false"><use href="#i-arrow-counter-clockwise" /></svg>
          </span>
          <span class="print-flip-label">{{ isFlipped ? '翻回正面' : '翻到背面' }}</span>
        </button>
      </div>
    </div>
  </li>
</template>
