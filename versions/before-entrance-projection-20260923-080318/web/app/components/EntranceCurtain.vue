<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { EntranceCurtainRenderer } from '~/utils/entranceCurtain'

const active = ref(false)
const ready = ref(false)
const progress = ref(0)
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
  watchdog = setTimeout(() => finish(), Math.max(0, 5500 - elapsed))
  loadTimeout = setTimeout(() => finish(), Math.max(0, 1800 - elapsed))
  active.value = true
  await nextTick()
  if (finished || disposed || !dialog.value || !canvas.value) return
  oldOverflow = document.documentElement.style.overflow
  document.documentElement.style.overflow = 'hidden'
  scrollLocked = true
  dialog.value.showModal()
  try {
    const { createEntranceCurtain, ENTRANCE_DURATION } = await import('~/utils/entranceCurtain')
    if (finished || disposed || !canvas.value?.isConnected || !dialog.value) return
    engine = createEntranceCurtain(canvas.value, dialog.value)
    clearTimeout(loadTimeout)
    const remaining = 5300 - (Date.now() - Number(document.documentElement.dataset.ivyEntranceStarted))
    if (remaining < 600) { finish(); return }
    const duration = Math.min(ENTRANCE_DURATION, remaining)
    ready.value = true
    document.documentElement.dataset.ivyEntrance = 'playing'
    const started = performance.now()
    const tick = (now: number) => {
      if (finished || disposed) return
      progress.value = Math.min(1, (now - started) / duration)
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
      aria-label="常春藤開場動畫" :data-progress="progress.toFixed(3)"
      @cancel.prevent="finish(true)"
    >
      <canvas ref="canvas" aria-hidden="true" @webglcontextlost="onContextLost" />
      <div class="entrance-copy" aria-hidden="true" :style="{ opacity: Math.max(0, 1 - progress / 0.23) }">
        <span class="entrance-rule" />
        <p lang="en">IVY EDUCATIONAL INSTITUTION</p>
        <span class="entrance-message">每一天，都是精彩的開始。</span>
        <span class="entrance-rule" />
      </div>
      <button type="button" class="entrance-skip" autofocus @click="finish(true)">略過動畫</button>
    </dialog>
  </Teleport>
</template>

<style scoped>
.entrance-curtain {
  --entrance-gold: #f1dbad;
  --entrance-button: #410c1ee6;
  --entrance-focus: #fff3cc;
  position: fixed; inset: 0; margin: 0; padding: 0; border: 0;
  width: 100%; height: 100dvh; max-width: none; max-height: none;
  overflow: hidden; color: var(--entrance-gold);
  background: repeating-linear-gradient(90deg,var(--entrance-shade) 0,var(--entrance-red) 2.2%,var(--entrance-highlight) 3.5%,var(--entrance-red) 5.3%,var(--entrance-shade) 7%);
}
.entrance-curtain::backdrop { background: transparent; }
.entrance-curtain.is-ready { background: transparent; }
.entrance-curtain canvas { display: block; width: 100%; height: 100%; }
.entrance-copy { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; pointer-events: none; }
.entrance-copy p { color: inherit; margin: 0; font-family: var(--font-en, Georgia, serif); font-size: 11px; letter-spacing: .26em; }
.entrance-message { font-family: 'Songti TC', 'Noto Serif TC', serif; font-size: clamp(20px, 2.25vw, 34px); letter-spacing: .13em; font-weight: 500; }
.entrance-rule { display: block; width: 38px; height: 1px; background: currentColor; opacity: .65; }
.entrance-skip { position: absolute; right: max(24px, env(safe-area-inset-right)); top: max(22px, env(safe-area-inset-top)); min-height: 44px; padding: 0 18px; border-radius: 28px; border: 1px solid var(--entrance-gold); background: var(--entrance-button); color: var(--entrance-gold); font: 500 13px/1.2 var(--font-body, sans-serif); cursor: pointer; }
.entrance-skip:focus-visible { outline: 2px solid var(--entrance-focus); outline-offset: 4px; }
@media (max-width: 640px) { .entrance-copy { gap: 18px; } .entrance-copy p { font-size: 8px; letter-spacing: .16em; } .entrance-message { font-size: 20px; letter-spacing: .055em; } .entrance-skip { right: 16px; top: max(16px, env(safe-area-inset-top)); font-size: 12px; } }
</style>
