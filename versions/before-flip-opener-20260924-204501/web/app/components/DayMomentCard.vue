<script setup lang="ts">
import { responsiveImage } from '~/utils/responsive-image'
import type { DayMoment } from '~/types/site-content'
import type { PaperHandle } from '~/utils/paperPrints'
import { mayAutoplay, type ConnectionInfo } from '~/utils/media-policy'
import { isScrollIdle, scheduleScrollIdle } from '~/utils/scrollIdle'
import { FLIP_MS, turnTarget } from '~/utils/printFlip'
import { CORNER_REST, PUFF_MS, cornerPose, fadePose, leadPose, puffPose, strongest, subscribeCornerWind, type CornerPose, type WindState } from '~/utils/cornerWind'
import { curlAngle } from '~/utils/cornerCurl'

const props = defineProps<{ moment: DayMoment; index: number; active?: boolean }>()

const isFlipped = ref(false)
// CSS 3D 版的翻面位置（半圈為單位，負值＝右緣掀起往左翻）；WebGL 版自己算連續位置。
const turn = ref(0)
const isTurning = ref(false)
const isRevealed = ref(false)
const isTilting = ref(false)
const isPeeking = ref(false)
const webglReady = ref(false)
const isCornering = ref(false)
const cardEl = ref<HTMLLIElement | null>(null)
const wrapEl = ref<HTMLDivElement | null>(null)
const printEl = ref<HTMLDivElement | null>(null)
const frontCornerEl = ref<HTMLSpanElement | null>(null)
const backCornerEl = ref<HTMLSpanElement | null>(null)
let observer: IntersectionObserver | null = null
let nearObserver: IntersectionObserver | null = null
let paper: PaperHandle | null = null
let paperPending = false
let tiltFrame = 0
let pointerPosition: { x: number; y: number } | null = null
let cueTimer = 0
let cornerFrame = 0
let peekTimer = 0
let deferPaper = false
let isNear = false
let cancelPaper: (() => void) | null = null
let lastFlipAt = Number.NEGATIVE_INFINITY
let turnFrom = 0
let turningTimer = 0
let windObserver: IntersectionObserver | null = null
let stopWind: (() => void) | null = null
// 翻面後這段時間暫停游標傾斜與 WebGL 初始化（WebGL 版另有約 0.2 秒紙張回彈）
const FLIP_SETTLE_MS = FLIP_MS + 150

// 翻面暗示 A 角落捲起（utils/cornerWind.ts）：沒有折角，觀者看到的右下角被掀起。三個來源取最大的那個：
// 捲動的風（共用時鐘）、點下去時翻面起手（角先捲，翻面本身不變）、顯影完成後輕掀一次。
// WebGL 版把角度餵給 paperPrints.ts 彎網格；CSS 版用兩片 3D 三角紙近似（styles.css 的 .print-corner）。
// 首張另在輕掀後向左微翻 12° 回正；減少動態不做、每次工作階段只偷看一次。
const PEEK_KEY = 'ivy-day-peek'
const seed = props.index * 7.31 + 3.7
let windCorner: CornerPose = CORNER_REST
let leadAt = 0
let puffAt = 0
// 翻面起手捲的是點下去那一刻朝向觀者的那一面
let leadSide: 'front' | 'back' = 'front'

function cornerNow(now: number): { pose: CornerPose; side: 'front' | 'back' } {
  const sinceFlip = now - lastFlipAt
  const flying = sinceFlip < FLIP_MS
  // 翻面途中，風的捲曲在前 30% 淡出，讓給起手捲曲
  let pose = fadePose(windCorner, flying ? 1 - sinceFlip / (FLIP_MS * 0.3) : 1)
  if (leadAt) pose = strongest(pose, leadPose(now - leadAt))
  if (puffAt) pose = strongest(pose, puffPose(now - puffAt))
  return { pose, side: flying ? leadSide : isFlipped.value ? 'back' : 'front' }
}

// CSS 版受光：光從左上前方來，角落往觀者掀起時先迎光、過 90° 換另一面
const LIGHT = [-0.35, -0.45, 1]
const LIGHT_LEN = Math.hypot(LIGHT[0]!, LIGHT[1]!, LIGHT[2]!)
function faceShade(angle: number): [number, number] {
  const tilt = Math.sin(angle) / Math.SQRT2
  const lit = (-tilt * LIGHT[0]! - tilt * LIGHT[1]! + Math.cos(angle) * LIGHT[2]!) / LIGHT_LEN
  const rest = LIGHT[2]! / LIGHT_LEN
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
  return [clamp01(1 - lit / rest) * 0.45, clamp01(1 + lit / rest) * 0.45]
}

const CORNER_VARS = ['--corner-a', '--corner-t', '--corner-lift', '--corner-shade-a', '--corner-shade-b', '--corner-tip-shade-a', '--corner-tip-shade-b']

function writeCssCorner(pose: CornerPose, side: 'front' | 'back') {
  const on = pose.hinge > 0.002
  // 已經收平就不再每幀清變數（風收尾那幾秒）
  if (!on && !isCornering.value) return
  if (isCornering.value !== on) isCornering.value = on
  const active = side === 'front' ? frontCornerEl.value : backCornerEl.value
  const idle = side === 'front' ? backCornerEl.value : frontCornerEl.value
  for (const name of CORNER_VARS) idle?.style.removeProperty(name)
  if (!active) return
  if (!on) {
    for (const name of CORNER_VARS) active.style.removeProperty(name)
    return
  }
  // 兩片三角紙近似同一條彎曲：靠折線那片取 u=0.25 的角度，角尖那片再多轉到 u=0.75
  const base = curlAngle(pose.hinge, pose.tip, 0.25)
  const tip = curlAngle(pose.hinge, pose.tip, 0.75)
  const [a, b] = faceShade(base)
  const [ta, tb] = faceShade(tip)
  const style = active.style
  style.setProperty('--corner-a', `${((base * 180) / Math.PI).toFixed(2)}deg`)
  style.setProperty('--corner-t', `${(((tip - base) * 180) / Math.PI).toFixed(2)}deg`)
  style.setProperty('--corner-lift', Math.sin(Math.min(tip, Math.PI / 2)).toFixed(3))
  style.setProperty('--corner-shade-a', a.toFixed(3))
  style.setProperty('--corner-shade-b', b.toFixed(3))
  style.setProperty('--corner-tip-shade-a', ta.toFixed(3))
  style.setProperty('--corner-tip-shade-b', tb.toFixed(3))
}

function renderCorner(now = performance.now()) {
  const { pose, side } = cornerNow(now)
  if (paper) paper.setCorner(pose)
  else writeCssCorner(pose, side)
}

function applyWind(wind: Readonly<WindState>, t: number) {
  windCorner = cornerPose(wind, t, seed)
  renderCorner()
  cardEl.value?.style.setProperty('--sway', `${wind.sway.toFixed(3)}deg`)
}

// 只有畫面附近的卡片訂閱；離開就收回靜止，不替看不到的卡片重畫。
function listenWind(on: boolean) {
  if (on === Boolean(stopWind)) return
  if (on) {
    stopWind = subscribeCornerWind(applyWind)
    return
  }
  stopWind?.()
  stopWind = null
  windCorner = CORNER_REST
  renderCorner()
  cardEl.value?.style.setProperty('--sway', '0deg')
}

// 翻面起手與進場輕掀的時鐘：跑完就收掉
function runCorner() {
  if (cornerFrame) return
  const step = (now: number) => {
    cornerFrame = 0
    if (!wrapEl.value?.isConnected) return
    if (leadAt && now - leadAt >= FLIP_MS) leadAt = 0
    if (puffAt && now - puffAt >= PUFF_MS) puffAt = 0
    renderCorner(now)
    if (leadAt || puffAt) cornerFrame = requestAnimationFrame(step)
  }
  cornerFrame = requestAnimationFrame(step)
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
  // 顯影：桌機 3.2 秒、手機 0.9 秒（paperPrints.ts／styles.css 同參數），完成後角落輕掀一次
  const delay = mobile ? 1100 : 3400
  cueTimer = window.setTimeout(() => {
    cueTimer = 0
    if (isFlipped.value) return
    puffAt = performance.now()
    runCorner()
    if (props.index === 0) peekTimer = window.setTimeout(runPeek, PUFF_MS + 300)
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
  return !deferPaper || (isNear && isScrollIdle() && !cueTimer && !cornerFrame && !isPeeking.value && performance.now() - lastFlipAt >= FLIP_SETTLE_MS)
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
  nearObserver?.disconnect()
  nearObserver = null
  webglReady.value = true
  onPointerLeave()
  isCornering.value = false
  renderCorner()
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
  deferPaper = window.matchMedia('(hover: none) and (pointer: coarse)').matches
  if (prefersReducedMotion || typeof IntersectionObserver === 'undefined' || !cardEl.value) {
    isRevealed.value = true
    return
  }
  windObserver = new IntersectionObserver((entries) => listenWind(entries.at(-1)?.isIntersecting ?? false), { rootMargin: '10% 0px' })
  windObserver.observe(cardEl.value)
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
  windObserver?.disconnect()
  windObserver = null
  stopWind?.()
  stopWind = null
  cancelPaper?.()
  cancelPaper = null
  cancelAnimationFrame(tiltFrame)
  cancelAnimationFrame(cornerFrame)
  window.clearTimeout(cueTimer)
  window.clearTimeout(peekTimer)
  window.clearTimeout(turningTimer)
  paper?.dispose()
  paper = null
  webglReady.value = false
})

function toggleFlip(event: MouseEvent) {
  // 滑鼠／觸控點完就放掉焦點：否則之後按方向鍵或空白鍵捲頁，Chrome 會把這顆按鈕判成
  // :focus-visible，冒出不跟紙傾斜的平面綠框，空白鍵還會再翻一次。鍵盤 Enter／Space 的 click detail 為 0，保留焦點框。
  if (event.detail > 0) (event.currentTarget as HTMLButtonElement | null)?.blur()
  // 點擊接管提示動畫：進場輕掀／偷看不在翻頁途中繼續拉動紙張。
  window.clearTimeout(cueTimer)
  window.clearTimeout(peekTimer)
  cueTimer = peekTimer = 0
  puffAt = 0
  isPeeking.value = false
  onPointerLeave()
  const now = performance.now()
  // 靜止時往左翻一格；翻到一半再點就原路翻回（CSS 版讀不到連續角度，用「是否仍在翻」判斷）
  const inFlight = now - lastFlipAt < FLIP_MS
  if (!inFlight) {
    turnFrom = turn.value
    // 翻面起手：觀者看到的右下角先捲起；翻到一半再點是原路翻回，不再起手
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      leadAt = now
      leadSide = isFlipped.value ? 'back' : 'front'
      runCorner()
    }
  }
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
        :class="{ 'is-flipped': isFlipped, 'is-turning': isTurning, 'is-tilting': isTilting, 'is-peeking': isPeeking, 'is-cornering': isCornering, 'webgl-ready': webglReady }"
        :style="{ '--flip': `${turn * 180}deg` }"
        @pointermove="onPointerMove"
        @pointerleave="onPointerLeave"
      >
        <div ref="printEl" class="print">
          <!-- 紙膠帶黏在相紙上，跟著紙一起翻；背面只露出超出紙緣的那一截 -->
          <span class="print-tape" aria-hidden="true" />
          <div class="print-face print-front" :inert="isFlipped">
            <figure class="print-figure">
              <!-- 橫向原圖以 cover 裁成正方形，選圖寬度須含裁掉的兩側，避免高 DPI 放大。 -->
              <img class="print-photo" v-bind="responsiveImage(moment.photo, '(max-width: 760px) 100vw, 540px')" :alt="moment.alt" loading="lazy" decoding="async">
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
          <!-- A 角落捲起的 CSS 版：正反面各一片，貼在各自朝向觀者時的右下角；起風或翻面起手時才切開紙角換上它（.is-cornering）。WebGL 版不用。 -->
          <span ref="frontCornerEl" class="print-corner is-front" aria-hidden="true">
            <span class="print-corner-shadow" />
            <span class="print-corner-flap"><i class="print-corner-a" /><i class="print-corner-b" /><span class="print-corner-tip"><i class="print-corner-a" /><i class="print-corner-b" /></span></span>
          </span>
          <span ref="backCornerEl" class="print-corner is-back" aria-hidden="true">
            <span class="print-corner-shadow" />
            <span class="print-corner-flap"><i class="print-corner-a" /><i class="print-corner-b" /><span class="print-corner-tip"><i class="print-corner-a" /><i class="print-corner-b" /></span></span>
          </span>
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
