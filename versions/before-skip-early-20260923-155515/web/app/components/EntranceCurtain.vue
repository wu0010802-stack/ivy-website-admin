<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { EntranceCurtainRenderer } from '~/utils/entranceCurtain'
import { entranceTimeline, ENTRANCE_DURATION } from '~/utils/entrance-timeline'

const active = ref(false)
const ready = ref(false)
const progress = ref(0)
const phase = ref('logo')
const countdown = ref(0)
const opening = ref(0)
const dialog = ref<HTMLDialogElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
let engine: EntranceCurtainRenderer | undefined
let frame = 0
let watchdog: ReturnType<typeof setTimeout> | undefined
let loadTimeout: ReturnType<typeof setTimeout> | undefined
let disposed = false
let finished = false
let motionQuery: MediaQueryList | undefined
let colorsQuery: MediaQueryList | undefined
let oldOverflow = ''
let scrollLocked = false

function finish(userSkipped = false) {
  if (finished) return
  finished = true
  cancelAnimationFrame(frame)
  clearTimeout(watchdog)
  clearTimeout(loadTimeout)
  engine?.dispose()
  engine = undefined
  dialog.value?.close()
  active.value = false
  delete document.documentElement.dataset.ivyEntrance
  delete document.documentElement.dataset.ivyEntranceStarted
  if (scrollLocked) {
    document.documentElement.style.overflow = oldOverflow
    scrollLocked = false
  }
  if (userSkipped) document.getElementById('main')?.focus({ preventScroll: true })
}

function onPreferenceChange() {
  if (motionQuery?.matches || colorsQuery?.matches) finish()
}
function onVisibilityChange() {
  if (document.hidden) finish()
}
function onContextLost(event: Event) {
  event.preventDefault()
  finish()
}

onMounted(async () => {
  if (document.documentElement.dataset.ivyEntrance !== 'pending') return
  const elapsed = Date.now() - Number(document.documentElement.dataset.ivyEntranceStarted || 0)
  // Late hydration should not place a new animation over an already visible page.
  if (elapsed > 1800 || window.scrollY > 8 || location.hash || document.hidden) { finish(); return }
  motionQuery = matchMedia('(prefers-reduced-motion: reduce)')
  colorsQuery = matchMedia('(forced-colors: active)')
  if (motionQuery.matches || colorsQuery.matches || typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) { finish(); return }
  motionQuery.addEventListener('change', onPreferenceChange)
  colorsQuery.addEventListener('change', onPreferenceChange)
  document.addEventListener('visibilitychange', onVisibilityChange)
  watchdog = setTimeout(() => finish(), Math.max(0, ENTRANCE_DURATION + 3600 - elapsed))
  loadTimeout = setTimeout(() => finish(), Math.max(0, 2800 - elapsed))
  active.value = true
  await nextTick()
  if (finished || disposed || !dialog.value || !canvas.value) return
  oldOverflow = document.documentElement.style.overflow
  document.documentElement.style.overflow = 'hidden'
  scrollLocked = true
  dialog.value.showModal()
  try {
    const { createEntranceCurtain } = await import('~/utils/entranceCurtain')
    if (finished || disposed || !canvas.value?.isConnected || !dialog.value) return
    engine = createEntranceCurtain(canvas.value, dialog.value)
    await engine.ready
    if (finished || disposed) return
    clearTimeout(loadTimeout)
    const remaining = ENTRANCE_DURATION + 3400 - (Date.now() - Number(document.documentElement.dataset.ivyEntranceStarted))
    // Never speed up or truncate the three numbers to recover loading time.
    if (remaining < ENTRANCE_DURATION) { finish(); return }
    ready.value = true
    document.documentElement.dataset.ivyEntrance = 'playing'
    const started = performance.now()
    const tick = (now: number) => {
      if (finished || disposed) return
      progress.value = Math.min(1, (now - started) / ENTRANCE_DURATION)
      const state = entranceTimeline(now - started)
      phase.value = state.phase
      countdown.value = state.countdown
      opening.value = state.opening
      if (progress.value >= 1) { finish(); return }
      try { engine?.draw(progress.value) } catch { finish(); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
  } catch { finish() }
})

onUnmounted(() => {
  disposed = true
  finish()
  motionQuery?.removeEventListener('change', onPreferenceChange)
  colorsQuery?.removeEventListener('change', onPreferenceChange)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <Teleport to="body">
    <dialog
      v-if="active" ref="dialog" class="entrance-curtain" :class="{ 'is-ready': ready }"
      aria-label="常春藤 30 週年開場動畫" :data-progress="progress.toFixed(3)"
      :data-phase="phase" :data-countdown="countdown" :data-opening="opening.toFixed(3)"
      @cancel.prevent="finish(true)"
    >
      <canvas ref="canvas" aria-hidden="true" @webglcontextlost="onContextLost" />
      <p class="entrance-status" role="status" aria-live="polite" aria-atomic="true">{{ ready ? (phase === 'logo' ? '常春藤 30 週年' : countdown ? `30 週年開幕倒數 ${countdown}` : '布幕開啟中') : '正在準備開幕' }}</p>
      <button type="button" class="entrance-skip" autofocus @click="finish(true)">略過動畫</button>
    </dialog>
  </Teleport>
</template>

<style scoped>
.entrance-curtain {
  --entrance-gold: #ebd9b7;
  --entrance-button: #310f1dcc;
  --entrance-border: #a38362;
  --entrance-focus: #f2dfb9;
  position: fixed; inset: 0; margin: 0; padding: 0; border: 0;
  width: 100%; height: 100dvh; max-width: none; max-height: none;
  overflow: hidden; color: var(--entrance-gold);
  background: repeating-linear-gradient(90deg,var(--entrance-shade) 0,var(--entrance-red) 2.2%,var(--entrance-highlight) 3.5%,var(--entrance-red) 5.3%,var(--entrance-shade) 7%);
}
.entrance-curtain::backdrop { background: transparent; }
.entrance-curtain.is-ready { background: transparent; }
.entrance-curtain canvas { display: block; width: 100%; height: 100%; }
.entrance-status { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.entrance-skip { position: absolute; right: max(24px, env(safe-area-inset-right)); top: max(22px, env(safe-area-inset-top)); min-height: 44px; padding: 0 18px; border-radius: 28px; border: 1px solid var(--entrance-border); background: var(--entrance-button); color: var(--entrance-gold); font: 500 13px/1.2 var(--font-body, sans-serif); cursor: pointer; transition: border-color 180ms ease-out, color 180ms ease-out; }
.entrance-skip:hover { border-color: var(--entrance-gold); color: var(--entrance-focus); }
.entrance-skip:focus-visible { outline: 2px solid var(--entrance-focus); outline-offset: 4px; }
@media (max-width: 640px) { .entrance-skip { right: 16px; top: max(16px, env(safe-area-inset-top)); font-size: 12px; } }
</style>
