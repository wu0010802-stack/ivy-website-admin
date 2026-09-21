<script setup lang="ts">
import { responsiveImage } from '~/utils/responsive-image'
import type { DayMoment } from '~/types/site-content'
import type { PaperHandle } from '~/utils/paperPrints'
import { mayAutoplay, type ConnectionInfo } from '~/utils/media-policy'

const props = defineProps<{ moment: DayMoment; index: number; active?: boolean }>()

const isFlipped = ref(false)
const isRevealed = ref(false)
const isTilting = ref(false)
const isPeeking = ref(false)
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
let cueTimer = 0
let earFrame = 0
let peekTimer = 0

// 折角與偷看：顯影完成後折角自己掀一次（30→52→44），首張再向左微翻 12° 回正；
// 減少動態不做、翻開中不做、每次工作階段只偷看一次。DOM 的 --ear 與 WebGL 貼圖缺口用同一個時鐘。
const EAR_REST = 44
const EAR_PEEL_MS = 1100
const PEEK_KEY = 'ivy-day-peek'
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

function setEar(px: number) {
  wrapEl.value?.style.setProperty('--ear', `${px.toFixed(1)}px`)
  paper?.setEar(px)
}

function runPeel(done: () => void) {
  const start = performance.now()
  const step = () => {
    earFrame = 0
    if (!wrapEl.value?.isConnected) return
    const t = Math.min(1, (performance.now() - start) / EAR_PEEL_MS)
    // 30 → 52 → 44：先掀大再放回
    const px = t < 0.55 ? 30 + (52 - 30) * easeInOut(t / 0.55) : 52 - (52 - EAR_REST) * easeInOut((t - 0.55) / 0.45)
    setEar(px)
    if (t < 1) earFrame = requestAnimationFrame(step)
    else {
      setEar(EAR_REST)
      done()
    }
  }
  earFrame = requestAnimationFrame(step)
}

function peekedThisSession(): boolean {
  try {
    return sessionStorage.getItem(PEEK_KEY) === '1'
  } catch {
    return false
  }
}

function markPeeked() {
  try {
    sessionStorage.setItem(PEEK_KEY, '1')
  } catch {
    /* 無 sessionStorage 就每次都偷看一次 */
  }
}

function runPeek() {
  if (isFlipped.value || !wrapEl.value?.isConnected || peekedThisSession()) return
  markPeeked()
  if (paper) {
    paper.peek()
    return
  }
  isPeeking.value = true
  peekTimer = window.setTimeout(() => {
    isPeeking.value = false
  }, 1000)
}

function scheduleCues() {
  const mobile = window.matchMedia('(max-width: 760px)').matches
  // 顯影：桌機 3.2 秒、手機 0.9 秒（paperPrints.ts／styles.css 同參數），完成後再掀角
  const delay = mobile ? 1100 : 3400
  cueTimer = window.setTimeout(() => {
    cueTimer = 0
    runPeel(() => {
      if (props.index !== 0) return
      peekTimer = window.setTimeout(runPeek, 300)
    })
  }, delay)
}

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
  const currentEar = Number.parseFloat(wrapEl.value.style.getPropertyValue('--ear'))
  if (Number.isFinite(currentEar)) paper.setEar(currentEar)
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
  // 掀角從 30 開始，等顯影完成才放到 44
  setEar(30)
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
          scheduleCues()
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
  cancelAnimationFrame(earFrame)
  window.clearTimeout(cueTimer)
  window.clearTimeout(peekTimer)
  paper?.dispose()
  paper = null
  webglReady.value = false
})

function toggleFlip() {
  isFlipped.value = !isFlipped.value
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
        :class="{ 'is-flipped': isFlipped, 'is-tilting': isTilting, 'is-peeking': isPeeking, 'webgl-ready': webglReady }"
        @pointermove="onPointerMove"
        @pointerleave="onPointerLeave"
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
          class="print-turn"
          type="button"
          :aria-label="`${moment.label}：${isFlipped ? '再點一下，回到照片' : '點照片，看看背面'}`"
          :aria-expanded="isFlipped"
          :aria-controls="`day-story-${moment.key}`"
          @click="toggleFlip"
        >
          <span class="print-turn-hint" aria-hidden="true">
            <span>{{ isFlipped ? '再點一下，回到照片' : '點照片，看看背面' }}</span>
            <svg class="icon" focusable="false"><use :href="isFlipped ? '#i-arrow-u-up-left' : '#i-arrows-left-right'" /></svg>
          </span>
        </button>
        <span class="print-ear" aria-hidden="true" />
      </div>
    </div>
  </li>
</template>
