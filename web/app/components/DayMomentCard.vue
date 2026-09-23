<script setup lang="ts">
import { responsiveImage } from '~/utils/responsive-image'
import type { DayMoment } from '~/types/site-content'
import type { PaperHandle } from '~/utils/paperPrints'
import { mayAutoplay, type ConnectionInfo } from '~/utils/media-policy'
import { isScrollIdle, scheduleScrollIdle } from '~/utils/scrollIdle'
import { registerMountedPaper, unregisterMountedPaper, type MountedPaper } from '~/utils/paper-budget'
import { FLIP_MS, turnTarget } from '~/utils/printFlip'

const props = defineProps<{ moment: DayMoment; index: number; active?: boolean }>()

const isFlipped = ref(false)
// CSS 3D 版的翻面位置（半圈為單位，負值＝右緣掀起往左翻）；WebGL 版自己算連續位置。
const turn = ref(0)
const isTurning = ref(false)
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
let deferPaper = false
let isNear = false
let cancelPaper: (() => void) | null = null
let lastFlipAt = Number.NEGATIVE_INFINITY
// 觸控裝置的掛載名額（paper-budget.ts）：超額時離視窗最遠的卡會被 detachPaper 卸回 CSS 版。
let mountedEntry: MountedPaper | null = null
function detachPaper() {
  if (mountedEntry) unregisterMountedPaper(mountedEntry)
  mountedEntry = null
  paper?.dispose()
  paper = null
  webglReady.value = false
}
let turnFrom = 0
let turningTimer = 0
// 翻面後這段時間暫停游標傾斜與 WebGL 初始化（WebGL 版另有約 0.2 秒紙張回彈）
const FLIP_SETTLE_MS = FLIP_MS + 150

// A 版淡折角：顯影後只輕掀一次（26→38→32），首張再向左微翻 12° 回正；
// 減少動態不做、翻開中不做、每次工作階段只偷看一次。DOM 的 --ear 與 WebGL 貼圖缺口用同一個時鐘。
const EAR_REST = 32
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
    const px = t < 0.55 ? 26 + (38 - 26) * easeInOut(t / 0.55) : 38 - (38 - EAR_REST) * easeInOut((t - 0.55) / 0.45)
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
  if (performance.now() - lastFlipAt < FLIP_SETTLE_MS) return
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
function readyForPaper() {
  return !deferPaper || (isNear && isScrollIdle() && !cueTimer && !earFrame && !isPeeking.value && performance.now() - lastFlipAt >= FLIP_SETTLE_MS)
}

function queuePaper() {
  if (!isNear || !wrapEl.value?.isConnected || paper || cancelPaper) return
  cancelPaper = scheduleScrollIdle(async () => {
    cancelPaper = null
    await attachPaper()
  })
}

async function attachPaper() {
  if (paper || paperPending || !wrapEl.value) return
  if (!readyForPaper()) { queuePaper(); return }
  paperPending = true
  const module = await import('~/utils/paperPrints').catch(() => null)
  if (!module || !wrapEl.value?.isConnected) { paperPending = false; return }
  const { mountPaper } = module
  const handle = await mountPaper(wrapEl.value, {
    kicker: kicker.value,
    titleLines: titleLines.value,
    time: props.moment.time,
    story: props.moment.story,
    question: props.moment.question,
    answer: props.moment.answer
  }, {
    // 手機先由 CSS 顯影，停下後接手已完成的正反面，不再重播顯影或翻面。
    get developed() { return deferPaper && isRevealed.value },
    get flipped() { return isFlipped.value },
    canMount: readyForPaper
  })
  paperPending = false
  if (!handle) {
    if (!readyForPaper()) queuePaper()
    return
  }
  if (!wrapEl.value?.isConnected) {
    handle.dispose()
    return
  }
  paper = handle
  // 觸控裝置保留 nearObserver：被名額擠掉（detachPaper）後捲回來還要能重排。
  if (!deferPaper) {
    nearObserver?.disconnect()
    nearObserver = null
  }
  webglReady.value = true
  onPointerLeave()
  const currentEar = Number.parseFloat(wrapEl.value.style.getPropertyValue('--ear'))
  if (Number.isFinite(currentEar)) paper.setEar(currentEar)
  paper.setFlipped(isFlipped.value)
  paper.setActive(Boolean(props.active))
  if (isRevealed.value) paper.setRevealed()
  if (deferPaper) {
    mountedEntry = {
      near: () => isNear,
      distance: () => {
        const rect = cardEl.value?.getBoundingClientRect()
        return rect ? Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2) : Number.POSITIVE_INFINITY
      },
      detach: detachPaper
    }
    registerMountedPaper(mountedEntry)
  }
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
  deferPaper = window.matchMedia('(hover: none) and (pointer: coarse)').matches
  if (prefersReducedMotion || typeof IntersectionObserver === 'undefined' || !cardEl.value) {
    isRevealed.value = true
    return
  }
  setEar(26)
  const connection = (navigator as Navigator & { connection?: ConnectionInfo }).connection
  if (mayAutoplay(prefersReducedMotion, connection)) nearObserver = new IntersectionObserver(
    (entries) => {
      isNear = entries.at(-1)?.isIntersecting ?? false
      if (!isNear) {
        cancelPaper?.()
        cancelPaper = null
      } else if (deferPaper) {
        // 原生捲動優先；逐張在停止滑動後初始化，離開附近範圍就取消。
        queuePaper()
      } else {
        nearObserver?.disconnect()
        nearObserver = null
        void attachPaper()
      }
    },
    // 手機只初始化真的進入畫面的卡片，避免停在下一區塊仍替離屏照片建場。
    { rootMargin: deferPaper ? '0px' : '60% 0px' }
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
  cancelPaper?.()
  cancelPaper = null
  cancelAnimationFrame(tiltFrame)
  cancelAnimationFrame(earFrame)
  window.clearTimeout(cueTimer)
  window.clearTimeout(peekTimer)
  window.clearTimeout(turningTimer)
  detachPaper()
})

function toggleFlip() {
  // 點擊接管提示動畫，避免掀角／偷看在翻頁途中繼續拉動紙張。
  cancelAnimationFrame(earFrame)
  window.clearTimeout(cueTimer)
  window.clearTimeout(peekTimer)
  earFrame = cueTimer = peekTimer = 0
  isPeeking.value = false
  setEar(EAR_REST)
  onPointerLeave()
  const now = performance.now()
  // 靜止時往左翻一格；翻到一半再點就原路翻回（CSS 版讀不到連續角度，用「是否仍在翻」判斷）
  const inFlight = now - lastFlipAt < FLIP_MS
  if (!inFlight) turnFrom = turn.value
  lastFlipAt = now
  isFlipped.value = !isFlipped.value
  turn.value = turnTarget(inFlight ? (turn.value + turnFrom) / 2 : turn.value, isFlipped.value)
  liftCssPrint(inFlight)
  // 紙在動時先藏起鍵盤焦點框：它是平的矩形，不跟著紙翻轉與抬升
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    isTurning.value = true
    window.clearTimeout(turningTimer)
    turningTimer = window.setTimeout(() => {
      isTurning.value = false
    }, FLIP_MS + 100)
  }
}

// CSS 3D 版沒有 z 軸抬升：翻面時整張微微放大再放下，立起那一刻最高（約 1/3 時間，與 WebGL 版同節奏）。
function liftCssPrint(inFlight: boolean) {
  const wrap = wrapEl.value
  if (paper || !wrap || typeof wrap.animate !== 'function') return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const current = getComputedStyle(wrap).scale
  const from = current && current !== 'none' ? current : '1'
  wrap.getAnimations().forEach((animation) => animation.cancel())
  wrap.animate(
    [{ scale: from }, { scale: '1.035', offset: inFlight ? 0.2 : 0.34 }, { scale: '1' }],
    { duration: inFlight ? FLIP_MS * 0.6 : FLIP_MS, easing: 'ease-in-out' }
  )
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
      <div
        ref="wrapEl"
        class="print-wrap"
        :class="{ 'is-flipped': isFlipped, 'is-turning': isTurning, 'is-tilting': isTilting, 'is-peeking': isPeeking, 'webgl-ready': webglReady }"
        :style="{ '--flip': `${turn * 180}deg` }"
        @pointermove="onPointerMove"
        @pointerleave="onPointerLeave"
      >
        <div ref="printEl" class="print">
          <!-- 紙膠帶黏在相紙上，跟著紙一起翻；背面只露出超出紙緣的那一截 -->
          <span class="print-tape" aria-hidden="true" />
          <div class="print-face print-front" :inert="isFlipped">
            <figure class="print-figure">
              <img class="print-photo" v-bind="responsiveImage(moment.photo, '(max-width: 760px) 100vw, 540px')" :alt="moment.alt" loading="lazy" fetchpriority="low" decoding="async">
              <time class="print-stamp" :datetime="moment.time">{{ moment.time }}</time>
            </figure>
            <div class="print-foot">
              <p class="print-kicker">{{ kicker }}</p>
              <h3><template v-for="(line, i) in titleLines" :key="i">{{ line }}<br v-if="i < titleLines.length - 1"></template></h3>
            </div>
            <span class="print-ear" aria-hidden="true"><svg viewBox="0 0 100 100" focusable="false"><path class="print-ear-paper" d="M0 0Q48 7 100 0L0 100Q7 48 0 0Z"/><path class="print-ear-lines" d="M2 21H79M3 42H58M3 63H37M2 84H16"/></svg></span>
          </div>
          <div class="print-face print-back" :id="`day-story-${moment.key}`" :inert="!isFlipped">
            <p class="print-kicker">{{ kicker }}</p>
            <p class="print-story">{{ moment.story }}</p>
            <div class="print-ask">
              <p class="print-question">{{ moment.question }}</p>
              <p class="print-answer">{{ moment.answer }}</p>
            </div>
            <span class="print-ear" aria-hidden="true"><svg viewBox="0 0 100 100" focusable="false"><path class="print-ear-paper" d="M0 0Q48 7 100 0L0 100Q7 48 0 0Z"/></svg></span>
          </div>
        </div>
        <button
          class="print-turn"
          type="button"
          :aria-label="`${moment.label}：${isFlipped ? '再點一下，回到照片' : '點照片，看看背面'}`"
          :aria-expanded="isFlipped"
          :aria-controls="`day-story-${moment.key}`"
          @click="toggleFlip"
        />
      </div>
    </div>
  </li>
</template>
