<script setup lang="ts">
import { ANNI_MEDIA } from '~/utils/anniversary/media'
import { ANNI_INTRO_SESSION_KEY } from '~/utils/anniversary/timeline'

// 30 週年分頁的開場：30 秒影片《手牽手，走到 30》。
// 第一次進來自動靜音播放（可開聲音、可略過）；播到海報那一格（29.0 秒，之後影片淡出成黑）
// 就把整個畫面飛進首屏右邊的海報相框裡，看起來是影片自己變成頁面上的一張印刷品。
// 同一個工作階段只自動播一次；偏好減少動態、網址帶 #錨點時不自動播，首屏有「重看開場影片」。
const props = defineProps<{ target: () => HTMLElement | null }>()
const emit = defineEmits<{ done: [] }>()

const LEAVE_AT = 29.0
const PORTRAIT = '(max-aspect-ratio: 4/5)'
const state = ref<'off' | 'play' | 'leave' | 'enter'>('off')
const muted = ref(true)
const blocked = ref(false)
const progress = ref(0)
const portrait = ref(false)
const video = ref<HTMLVideoElement | null>(null)
const frame = ref<HTMLElement | null>(null)
const finalImg = ref<HTMLImageElement | null>(null)
const backdrop = ref<HTMLElement | null>(null)
const skipBtn = ref<HTMLButtonElement | null>(null)
const poster = computed(() => (portrait.value ? ANNI_MEDIA.posterMobile : ANNI_MEDIA.posterDesktop))
const first = computed(() => (portrait.value ? ANNI_MEDIA.firstMobile : ANNI_MEDIA.firstDesktop))
const film = computed(() => (portrait.value ? ANNI_MEDIA.filmMobile : ANNI_MEDIA.filmDesktop))

// 第一次繪製前就決定要不要播：要播就先蓋一層深色，避免頁面先閃一下再被影片蓋住
useHead({
  script: [{
    key: 'anni-intro-gate',
    tagPosition: 'head',
    innerHTML: `(function(){try{var d=document.documentElement;if(location.hash||matchMedia('(prefers-reduced-motion: reduce)').matches||sessionStorage.getItem('${ANNI_INTRO_SESSION_KEY}'))return;d.dataset.anniIntro='pending'}catch(e){}})()`
  }]
})

const html = () => document.documentElement
let raf = 0
let lastFocus: HTMLElement | null = null

function tick() {
  const v = video.value
  if (v && v.duration) {
    progress.value = v.currentTime / v.duration
    if (state.value === 'play' && v.currentTime >= LEAVE_AT) leave(false)
  }
  raf = requestAnimationFrame(tick)
}

function useSource() {
  portrait.value = matchMedia(PORTRAIT).matches
  const v = video.value
  if (v && v.getAttribute('src') !== film.value) { v.src = film.value; v.load() }
}

async function start() {
  useSource()
  state.value = 'play'
  muted.value = true
  await nextTick()
  const v = video.value!
  v.muted = true
  v.currentTime = 0
  v.play().then(() => { blocked.value = false }).catch(() => { blocked.value = true })
  // 影片層畫出來之後再拿掉預蓋的深色（兩個 frame：確定已經繪製）
  requestAnimationFrame(() => requestAnimationFrame(() => { html().dataset.anniIntro = 'play' }))
  lastFocus = document.activeElement as HTMLElement | null
  skipBtn.value?.focus({ preventScroll: true })
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(tick)
}

/** 海報相框在畫面上的位置（不含旋轉的外框）＋旋轉角度 */
function targetBox() {
  const el = props.target()
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.bottom < 0 || r.top > innerHeight) return null
  const w = el.offsetWidth, h = el.offsetHeight
  const fig = el.closest('figure')
  const tilt = fig ? getComputedStyle(fig).getPropertyValue('--anni-print-tilt').trim() || '0deg' : '0deg'
  return { left: r.left + r.width / 2 - w / 2, top: r.top + r.height / 2 - h / 2, width: w, height: h, tilt }
}

const fullBox = () => ({ left: 0, top: 0, width: innerWidth, height: innerHeight, tilt: '0deg' })
const kf = (b: ReturnType<typeof fullBox>, radius: string) => ({ left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`, borderRadius: radius, transform: `rotate(${b.tilt})` })

function finish() {
  state.value = 'off'
  delete html().dataset.anniIntro
  try { sessionStorage.setItem(ANNI_INTRO_SESSION_KEY, '1') } catch { /* 無痕模式寫不進去也沒關係 */ }
  frame.value?.getAnimations().forEach((a) => a.cancel())
  backdrop.value?.getAnimations().forEach((a) => a.cancel())
  if (finalImg.value) finalImg.value.style.opacity = '0'
  cancelAnimationFrame(raf)
  emit('done')
  if (lastFocus && lastFocus !== document.body) lastFocus.focus({ preventScroll: true })
}

function leave(skipped: boolean) {
  if (state.value !== 'play') return
  state.value = 'leave'
  const v = video.value
  const img = finalImg.value!
  // 中途略過：影片畫面和海報不同格，先把海報疊上來再飛
  img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: skipped ? 320 : 60, fill: 'forwards' })
  const to = targetBox()
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!to || reduce) {
    backdrop.value!.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' })
    frame.value!.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' }).finished.then(() => { v?.pause(); finish() })
    return
  }
  const fly = frame.value!.animate([kf(fullBox(), '0px'), kf(to, '2px')], { duration: 1150, delay: skipped ? 200 : 0, easing: 'cubic-bezier(.62,.02,.18,1)', fill: 'forwards' })
  backdrop.value!.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, delay: skipped ? 380 : 200, easing: 'ease-out', fill: 'forwards' })
  fly.finished.then(() => {
    // 開著聲音就讓配樂的尾巴播完；畫面已經是海報，不再動
    if (v && !v.muted && !v.ended) {
      const stop = () => { v.removeEventListener('ended', stop); finish() }
      v.addEventListener('ended', stop)
      setTimeout(stop, 1600)
    } else { v?.pause(); finish() }
  }).catch(() => {})
}

/** 首屏「重看開場影片」：從海報相框展開回全螢幕，這次直接開聲音（使用者點了按鈕） */
function replay() {
  if (state.value !== 'off') return
  useSource()
  const v = video.value
  if (!v) return
  v.muted = false
  muted.value = false
  v.currentTime = 0
  const playing = v.play()
  playing.catch(() => { v.muted = true; muted.value = true; v.play().catch(() => { blocked.value = true }) })
  state.value = 'enter'
  html().dataset.anniIntro = 'play'
  lastFocus = document.activeElement as HTMLElement | null
  const img = finalImg.value!
  img.style.opacity = '1'
  const from = targetBox() ?? fullBox()
  nextTick(() => {
    frame.value!.animate([kf(from, '2px'), kf(fullBox(), '0px')], { duration: 750, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' }).finished.then(() => {
      img.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, fill: 'forwards' })
      state.value = 'play'
      skipBtn.value?.focus({ preventScroll: true })
    }).catch(() => {})
    backdrop.value!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, fill: 'forwards' })
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(tick)
  })
}

function toggleSound() {
  const v = video.value
  if (!v) return
  v.muted = !v.muted
  muted.value = v.muted
  if (v.paused) v.play().catch(() => {})
}
function playBlocked() {
  const v = video.value
  if (!v) return
  v.muted = false
  muted.value = false
  v.play().then(() => { blocked.value = false }).catch(() => { v.muted = true; muted.value = true; v.play().catch(() => {}) })
}
function onKey(e: KeyboardEvent) {
  if (state.value === 'play' && e.key === 'Escape') { e.preventDefault(); leave(true) }
}

onMounted(() => {
  addEventListener('keydown', onKey)
  if (html().dataset.anniIntro === 'pending') start()
})
onBeforeUnmount(() => {
  removeEventListener('keydown', onKey)
  cancelAnimationFrame(raf)
  if (html().dataset.anniIntro) delete html().dataset.anniIntro
})

defineExpose({ replay })
</script>

<template>
  <div
    class="anni-intro"
    :hidden="state === 'off'"
    role="dialog"
    aria-modal="true"
    aria-label="常春藤 30 週年開場影片"
  >
    <div ref="backdrop" class="anni-intro-backdrop" />
    <div ref="frame" class="anni-intro-frame">
      <video
        ref="video"
        class="anni-intro-video"
        playsinline
        preload="none"
        :poster="first"
        aria-label="30 秒開場影片：校徽上的兩個孩子用蠟筆一路畫下去，五所校園在成立那一年立起來，最後畫出一個 30"
        @ended="leave(false)"
        @error="state === 'play' && leave(true)"
      />
      <img ref="finalImg" class="anni-intro-final" :src="poster" alt="" decoding="async">
    </div>
    <div class="anni-intro-bar" :class="{ 'is-leaving': state === 'leave' || state === 'enter' }">
      <button v-if="blocked" type="button" class="anni-intro-btn is-big" @click="playBlocked">播放開場影片</button>
      <button type="button" class="anni-intro-btn" :aria-pressed="!muted" @click="toggleSound">{{ muted ? '開聲音' : '關聲音' }}</button>
      <button ref="skipBtn" type="button" class="anni-intro-btn" @click="leave(true)">略過開場</button>
    </div>
    <span class="anni-intro-progress" aria-hidden="true" :style="{ transform: `scaleX(${progress})` }" />
  </div>
</template>

<style>
/* 開場閘門：html 上的屬性，不能用 scoped */
html[data-anni-intro] { overflow: hidden; }
html[data-anni-intro="pending"]::before { content: ""; position: fixed; inset: 0; z-index: 10002; background: rgb(var(--ink)); }
</style>

<style scoped>
.anni-intro { position: fixed; inset: 0; z-index: 10001; }
.anni-intro-backdrop { position: absolute; inset: 0; background: rgb(var(--ink)); }
.anni-intro-frame { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; height: 100dvh; overflow: hidden; transform-origin: 50% 50%; }
.anni-intro-video, .anni-intro-final { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.anni-intro-final { opacity: 0; pointer-events: none; }
.anni-intro-bar {
  position: absolute; right: max(16px, env(safe-area-inset-right)); bottom: calc(max(16px, env(safe-area-inset-bottom)) + 10px);
  display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; transition: opacity .3s;
}
.anni-intro-bar.is-leaving { opacity: 0; pointer-events: none; }
.anni-intro-btn {
  min-height: 44px; padding: 10px 18px; border: 1px solid rgb(var(--on-dark) / .5); border-radius: 999px;
  background: rgb(var(--ink) / .45); color: var(--paper); font: 600 var(--fs-sm)/1.2 var(--font); backdrop-filter: blur(6px);
}
.anni-intro-btn:hover { background: rgb(var(--ink) / .7); }
.anni-intro-btn:focus-visible { outline: 3px solid var(--gold); outline-offset: 3px; }
.anni-intro-btn.is-big { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); min-height: 56px; padding: 14px 28px; font-size: var(--fs-lg); background: var(--gold); color: var(--deep); border-color: transparent; }
.anni-intro-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--gold); transform-origin: 0 50%; transform: scaleX(0); }
</style>
