<script setup lang="ts">
import { CAKE_H, CAKE_W, CANDLE_COUNT } from '~/utils/anniversary/candles'
import type { CakeController } from '~/utils/anniversary/cake'
import { birthdaySong, stopSong } from '~/utils/anniversary/sound'

// 30 週年分頁「幫常春藤吹蠟燭」：蛋糕與 30 支蠟筆蠟燭（utils/anniversary/cake.ts），進到視窗附近才載入。
// 鍵盤可以按住「按住吹氣」；麥克風要使用者按了才請求權限，全部吹熄或離開頁面就關掉。
const props = defineProps<{ colors: readonly string[] }>()

const stage = ref<HTMLElement | null>(null)
const ready = ref(false)
const lit = ref(0)
const allOut = ref(false)
/** 開始吹了沒：點燃時支數往上加不算，有一支被吹熄才算；30 支重新點著就歸零 */
const blowing = ref(false)
const mic = ref<'off' | 'on' | 'denied' | 'unsupported'>('off')
const holding = ref(false)
const announce = ref('')
const micReloaded = ref(false)
const MIC_FLAG = 'ivy-anni-mic-reload'
let ctl: CakeController | null = null
let announceTimer = 0

// 只在吹到一半時顯示還剩幾支；點蠟燭中、全部點著、全部吹熄都不另外寫字（吹熄後蛋糕上方有「生日快樂！」）
const counter = computed(() => (blowing.value && !allOut.value && lit.value > 0 ? `還有 ${lit.value} 支` : ''))
const micLabel = computed(() => (mic.value === 'on' ? '關掉麥克風' : '用麥克風吹'))
// 只在需要使用者做點什麼時才出現（重新載入後、沒打開、不支援）
const micNote = computed(() => ({
  off: micReloaded.value ? '再按一次「用麥克風吹」。' : '',
  on: '',
  denied: '麥克風沒有打開，可以改用按鈕，或用手指、滑鼠從火焰上劃過去。',
  unsupported: '這個瀏覽器不能用麥克風，可以改用按鈕，或用手指、滑鼠從火焰上劃過去。'
}[mic.value]))

// 念給螢幕閱讀器的狀態：停下來 0.7 秒才念，避免每熄一支就念一次
function say(text: string) {
  clearTimeout(announceTimer)
  announceTimer = window.setTimeout(() => { announce.value = text }, 700)
}

const setHold = (on: boolean) => { holding.value = on; ctl?.setHold(on) }
const onKey = (e: KeyboardEvent, on: boolean) => {
  if (e.key !== ' ' && e.key !== 'Enter') return
  e.preventDefault()
  if (on && e.repeat) return
  setHold(on)
}
/** 這個文件准不准用麥克風：站上只有 /anniversary 的回應標頭開了 microphone=(self)，標頭跟著「這個文件最初載入的網址」。
 *  從別頁點選單進來（Nuxt 站內換頁）時沿用的是那一頁的標頭（document.featurePolicy 這時也不可靠），要重新載入這一頁才會生效。 */
function micAllowedHere(): boolean {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  const landed = nav ? new URL(nav.name).pathname.replace(/\/$/, '') : location.pathname
  return landed === '/anniversary'
}
async function toggleMic() {
  if (!ctl) return
  if (mic.value === 'on') { ctl.stopMic(); mic.value = 'off'; return }
  if (!micAllowedHere()) {
    try { sessionStorage.setItem(MIC_FLAG, '1') } catch { /* 無痕模式寫不進去也照樣重新載入 */ }
    history.replaceState(history.state, '', '/anniversary#anni-cake')
    location.reload()
    return
  }
  micReloaded.value = false
  mic.value = await ctl.startMic()
}
function relightAll() {
  allOut.value = false
  blowing.value = false
  stopSong()
  ctl?.relightAll()
}

onMounted(() => {
  try {
    if (sessionStorage.getItem(MIC_FLAG)) { sessionStorage.removeItem(MIC_FLAG); micReloaded.value = true }
  } catch { /* 讀不到就當作沒有 */ }
  const el = stage.value
  if (!el) return
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const io = new IntersectionObserver(async (es) => {
    if (!es.some((e) => e.isIntersecting)) return
    io.disconnect()
    try {
      const { mountCake } = await import('~/utils/anniversary/cake')
      ctl = await mountCake(el, {
        reduce,
        colors: props.colors,
        onChange: (n) => {
          if (n < lit.value) blowing.value = true
          if (n === CANDLE_COUNT) blowing.value = false
          lit.value = n
          if (n === CANDLE_COUNT) say(`${CANDLE_COUNT} 支蠟燭都點著了`)
          else if (n > 0 && !allOut.value) say(`還有 ${n} 支蠟燭亮著`)
        },
        onAllOut: () => {
          allOut.value = true
          if (mic.value === 'on') mic.value = 'off'
          say('30 支蠟燭全部吹熄了，生日快樂！')
          birthdaySong()
        }
      })
      ready.value = true
    } catch (e) { console.error(e) }
  }, { rootMargin: '400px 0px' })
  io.observe(el)
  onBeforeUnmount(() => io.disconnect())
})
onBeforeUnmount(() => { clearTimeout(announceTimer); stopSong(); ctl?.destroy(); ctl = null })
</script>

<template>
  <section id="anni-cake" class="anni-cake" aria-labelledby="anni-cake-title">
    <div class="container anni-cake-grid">
      <div class="anni-cake-copy">
        <h2 id="anni-cake-title">幫常春藤吹蠟燭</h2>
        <div class="anni-cake-tools">
          <button
            type="button"
            class="button primary anni-blow"
            :class="{ 'is-holding': holding }"
            :aria-pressed="holding"
            :disabled="!ready || allOut"
            @pointerdown.prevent="setHold(true)"
            @pointerup="setHold(false)"
            @pointercancel="setHold(false)"
            @pointerleave="setHold(false)"
            @keydown="onKey($event, true)"
            @keyup="onKey($event, false)"
            @blur="setHold(false)"
            @contextmenu.prevent
          >
            按住吹氣
          </button>
          <button type="button" class="button outline" :aria-pressed="mic === 'on'" :disabled="!ready || allOut" @click="toggleMic">{{ micLabel }}</button>
          <AnniversarySoundToggle />
        </div>
        <p v-if="micNote" class="anni-cake-note">{{ micNote }}</p>
        <p v-if="counter" class="anni-cake-count" aria-hidden="true"><b>{{ counter }}</b></p>
        <p class="sr-only" aria-live="polite">{{ announce }}</p>
        <button v-if="allOut" type="button" class="button outline anni-relight" @click="relightAll">再點一次蠟燭</button>
      </div>
      <div ref="stage" class="anni-cake-stage" :class="{ 'is-done': allOut }" aria-hidden="true">
        <svg class="anni-cake-art" :viewBox="`0 0 ${CAKE_W} ${CAKE_H}`" focusable="false" />
        <canvas class="anni-cake-fx" />
        <p class="anni-cake-wish">生日快樂！</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.anni-cake { padding-block: clamp(72px, 8vw, 128px); scroll-margin-top: 40px; }
.anni-cake-grid { display: grid; grid-template-columns: minmax(0, 4fr) minmax(0, 6fr); gap: clamp(28px, 4vw, 64px); align-items: center; }
.anni-cake-copy { display: grid; gap: 18px; justify-items: start; min-width: 0; }
.anni-cake-copy h2 { font-size: clamp(var(--fs-4xl), 3.4vw, var(--fs-6xl)); color: var(--green); }
.anni-cake-copy > p { font-size: var(--fs-lg); }
.anni-cake-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.anni-cake-tools .button { min-height: 46px; padding: 10px 20px; }
.anni-blow { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: none; transition: transform .15s, background-color .2s; }
.anni-blow.is-holding { transform: scale(.96); background: var(--deep); }
.anni-cake-note { font-size: var(--fs-sm); color: var(--muted); }
.anni-cake-count { margin: 0; font: 700 var(--fs-xl)/1.3 var(--font-head); color: var(--green); font-variant-numeric: tabular-nums; }
.anni-cake-stage { position: relative; aspect-ratio: 600 / 560; touch-action: pan-y; cursor: crosshair; }
.anni-cake-art, .anni-cake-fx { position: absolute; inset: 0; width: 100%; height: 100%; }
.anni-cake-art { overflow: visible; mask: var(--anni-paper-tile) 0 0 / 150px luminance; opacity: 0; transition: opacity .5s; }
.anni-cake-art.is-drawn { opacity: 1; }
.anni-cake-art :deep(path) { stroke-linecap: round; stroke-linejoin: round; }
.anni-cake-wish { position: absolute; left: 0; right: 0; top: 2%; margin: 0; max-width: none; text-align: center; font: 800 clamp(var(--fs-3xl), 4vw, var(--fs-5xl))/1.2 var(--font-head); color: var(--green);
  opacity: 0; transform: translateY(12px) scale(.94); transition: opacity .5s .5s, transform .6s cubic-bezier(.3, 1.4, .5, 1) .5s; pointer-events: none; }
.anni-cake-stage.is-done .anni-cake-wish { opacity: 1; transform: none; }
@media (max-width: 900px) {
  .anni-cake-grid { grid-template-columns: 1fr; }
  .anni-cake-stage { order: -1; width: min(100%, 560px); justify-self: center; }
}
@media (prefers-reduced-motion: reduce) {
  .anni-cake-art, .anni-cake-wish, .anni-blow { transition: none; }
}
</style>
