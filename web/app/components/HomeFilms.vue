<script setup lang="ts">
import { campusFilms } from '~/utils/campusFilms'
import type { HomeFilm } from '~/types/site-content'
import { mayAutoplay, type ConnectionInfo } from '~/utils/media-policy'
import { clipRestartTime, mod, nearestTurn, ringOffset, settleTarget, youtubeEmbed } from '~/utils/filmCarousel'

/**
 * 2026-09-23 D：手機版把「近期活動」換成活動影片（B 中央聚焦＋參考圖白色圓點）。
 * 位置 position 是連續值，各張依 ringOffset 排在左右，SSR 就是正確的初始排版（不用量寬度）。
 * 檔案影片只有當前那支設 src 靜音循環；YouTube 先放縮圖，點了才插 iframe，換走就拔掉。
 * 桌機由 studio.css 隱藏（display:none，影片 preload="none" 不會下載）。
 * 清單由後台「首頁消息與活動」設定（NewsContent.films）；沒設定時用內建的 campusFilms。
 */
const props = defineProps<{ films?: HomeFilm[] }>()
const films = props.films?.length ? props.films : campusFilms
const count = films.length
const SLIDE_MS = 560
const easeOut = (t: number) => 1 - Math.pow(1 - t, 5)

const position = ref(0)
const target = ref(0)
const index = computed(() => mod(Math.round(target.value), count))
const viewport = ref<HTMLElement | null>(null)
const videoEls: (HTMLVideoElement | null)[] = []
const autoplay = ref(false)
const visible = ref(false)
const pageHidden = ref(false)
const reduced = ref(false)
const liveIndex = ref<number | null>(null)
const announcement = ref('')
let frame = 0
let dispose = () => {}

function setVideo(k: number, el: unknown) {
  videoEls[k] = el instanceof HTMLVideoElement ? el : null
}

function slideStyle(k: number) {
  const d = ringOffset(k, position.value, count)
  const a = Math.min(Math.abs(d), 1)
  return { '--d': d.toFixed(4), '--a': a.toFixed(4), zIndex: String(10 - Math.round(Math.abs(d) * 2)) }
}

function go(next: number, user = false) {
  target.value = next
  const from = position.value
  const start = performance.now()
  const duration = reduced.value ? 0 : SLIDE_MS
  cancelAnimationFrame(frame)
  const tick = (now: number) => {
    const t = duration ? Math.min(1, (now - start) / duration) : 1
    position.value = from + (next - from) * easeOut(t)
    if (t < 1) frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  if (user) announcement.value = `第 ${mod(next, count) + 1} 支影片，共 ${count} 支：${films[mod(next, count)]!.title}`
}

function sync() {
  const run = autoplay.value && visible.value && !pageHidden.value
  films.forEach((film, k) => {
    const video = videoEls[k]
    if (!video || film.type !== 'file') return
    if (k === index.value && run) {
      if (!video.getAttribute('src')) video.src = `${film.src}#t=${film.start}`
      void video.play().catch(() => {})
    } else if (!video.paused) video.pause()
  })
}

// 剪段循環：播到片段尾就跳回片段頭
function loopClip(k: number) {
  const film = films[k]
  const video = videoEls[k]
  if (film?.type !== 'file' || !video) return
  // 播到結束秒數就跳回開始；沒設結束、或結束秒數超過影片長度時，loop 會回到 0 秒，再跳回開始秒數。
  const next = clipRestartTime(video.currentTime, video.duration, film.start, film.end)
  if (next != null) video.currentTime = next
}

watch(index, k => {
  liveIndex.value = null
  const film = films[k]
  const video = videoEls[k]
  if (film?.type === 'file' && video?.getAttribute('src')) video.currentTime = film.start
})
watch([index, autoplay, visible, pageHidden], sync, { flush: 'post' })

// ── 手勢：水平意圖才接手，垂直留給頁面捲動 ──
let drag: { id: number; x: number; y: number; moved: boolean; start: number; step: number; samples: [number, number][] } | null = null
let dragged = false

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || !viewport.value) return
  // 相鄰兩張中心距＝80% 寬 × (1/2 + 0.9/2) + 14px
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, start: position.value, step: viewport.value.clientWidth * 0.76 + 14, samples: [] }
}
function onPointerMove(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id) return
  const dx = event.clientX - drag.x
  const dy = event.clientY - drag.y
  if (!drag.moved) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return }
    if (Math.abs(dx) < 6) return
    drag.moved = true
    drag.x = event.clientX
    drag.start = position.value
    cancelAnimationFrame(frame)
    viewport.value?.setPointerCapture(event.pointerId)
  }
  drag.samples.push([performance.now(), event.clientX])
  if (drag.samples.length > 6) drag.samples.shift()
  position.value = drag.start - (event.clientX - drag.x) / drag.step
}
function onPointerUp(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id) return
  const done = drag
  drag = null
  if (!done.moved) return
  dragged = true
  setTimeout(() => { dragged = false }, 80)
  const [first, last] = [done.samples[0], done.samples.at(-1)]
  const velocity = first && last && last !== first ? (last[1] - first[1]) / Math.max(1, last[0] - first[0]) : 0
  go(settleTarget(position.value, done.start, velocity), true)
}
function onClickCapture(event: MouseEvent) {
  if (!dragged) return
  event.preventDefault()
  event.stopPropagation()
  dragged = false
}
// 兩側露出的影片是 inert，點擊會落在軌道上：往那一側翻一張。
// 用 composedPath 不用 target.closest：點 YouTube 播放鍵時，按鈕在冒泡到這裡之前就被換成 iframe、
// target 已脫離 DOM，closest 找不到當前這張，會被當成點兩側翻走（iframe 隨即被拔掉）。
function onViewportClick(event: MouseEvent) {
  const onCurrent = event.composedPath().some(el => el instanceof Element && el.matches('.film-slide:not([inert])'))
  if (event.defaultPrevented || !viewport.value || onCurrent) return
  const rect = viewport.value.getBoundingClientRect()
  go(Math.round(target.value) + (event.clientX < rect.left + rect.width / 2 ? -1 : 1), true)
}
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  go(Math.round(target.value) + (event.key === 'ArrowLeft' ? -1 : 1), true)
}

onMounted(() => {
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  const connection = (navigator as Navigator & { connection?: ConnectionInfo }).connection
  reduced.value = motion.matches
  autoplay.value = mayAutoplay(reduced.value, connection)
  const onMotion = () => {
    reduced.value = motion.matches
    if (reduced.value) autoplay.value = false
  }
  const onVisibility = () => { pageHidden.value = document.hidden }
  onVisibility()
  const observer = new IntersectionObserver(entries => {
    const entry = entries[entries.length - 1]
    visible.value = Boolean(entry && entry.isIntersecting && entry.intersectionRatio >= 0.6)
  }, { threshold: [0, 0.6, 1] })
  if (viewport.value) observer.observe(viewport.value)
  motion.addEventListener('change', onMotion)
  document.addEventListener('visibilitychange', onVisibility)
  dispose = () => {
    observer.disconnect()
    motion.removeEventListener('change', onMotion)
    document.removeEventListener('visibilitychange', onVisibility)
  }
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  dispose()
  videoEls.forEach(video => video?.pause())
})
</script>

<template>
  <section class="home-films" aria-labelledby="campus-films-heading" aria-roledescription="輪播" @keydown="onKeydown">
    <div class="hn-head">
      <span class="hn-kicker" lang="en">CAMPUS FILMS</span>
      <h2 id="campus-films-heading">活動影片</h2>
    </div>
    <div
      ref="viewport" class="film-viewport"
      @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp"
      @click.capture="onClickCapture" @click="onViewportClick"
    >
      <div class="film-track">
        <div
          v-for="(film, k) in films" :key="film.id"
          class="film-slide" role="group" aria-roledescription="影片" :aria-label="`${k + 1} / ${count}：${film.title}`"
          :style="slideStyle(k)" :inert="k !== index || undefined"
        >
          <!-- 海報用 CSS 背景：桌機 display:none 時不會下載（<video poster> 會）。 -->
          <div class="film-frame" :style="film.type === 'file' ? { '--poster': `url(${film.poster})` } : undefined">
            <template v-if="film.type === 'file'">
              <video
                :ref="el => setVideo(k, el)" muted playsinline loop preload="none" aria-hidden="true"
                disablepictureinpicture @timeupdate="loopClip(k)"
              />
              <button type="button" class="film-toggle" :aria-label="autoplay ? '暫停影片' : '播放影片'" @click="autoplay = !autoplay">
                <svg class="icon" aria-hidden="true"><use :href="autoplay ? '#i-pause' : '#i-play'" /></svg>
              </button>
            </template>
            <template v-else>
              <iframe
                v-if="liveIndex === k" :src="youtubeEmbed(film.youtubeId)" :title="film.title"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"
              />
              <button v-else type="button" class="film-play" :aria-label="`在 YouTube 播放「${film.title}」`" @click="liveIndex = k">
                <img :src="film.poster" alt="" loading="lazy" draggable="false">
                <span class="film-play-mark" aria-hidden="true"><svg class="icon"><use href="#i-play" /></svg></span>
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>
    <div class="film-dots" role="group" aria-label="選擇影片">
      <button
        v-for="(film, k) in films" :key="film.id" type="button" class="film-dot"
        :aria-label="`第 ${k + 1} 支：${film.title}`" :aria-current="k === index || undefined"
        @click="go(nearestTurn(target, k, count), true)"
      />
    </div>
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </section>
</template>

<style scoped>
/* 參考圖：鼠尾草綠底、同尺寸白點，當前實心、其他約 20% */
.home-films {
  --film-band: var(--ivy-film-band);
  --film-dot: var(--ivy-film-dot);
  --film-dot-idle: color-mix(in oklch, var(--film-dot) 22%, transparent);
  --film-control: var(--ivy-film-control);
  --film-mark: var(--ivy-film-mark);
  --film-frame: var(--ivy-film-frame);
  background: var(--film-band);
}
.home-films .hn-kicker { color: inherit; }
.film-viewport {
  position: relative;
  margin-inline: calc(50% - 50vw);
  padding-block: 2px;
  overflow: hidden;
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
}
.film-track { display: grid; }
.film-slide {
  grid-area: 1 / 1;
  justify-self: center;
  width: 80%;
  transform: translateX(calc(var(--d, 0) * (95% + 14px))) scale(calc(1 - .1 * var(--a, 0)));
  opacity: calc(1 - .3 * var(--a, 0));
  will-change: transform;
}
.film-frame {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 18px;
  overflow: hidden;
  background: var(--poster, none) center / cover no-repeat, var(--film-frame);
}
.film-frame :is(video, iframe, img) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border: 0;
  -webkit-user-drag: none;
}
.film-toggle,
.film-play-mark {
  position: absolute;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  transition: opacity .3s;
}
.film-toggle {
  right: 10px;
  bottom: 10px;
  width: 44px;
  height: 44px;
  padding: 0;
  background: var(--film-control);
  color: var(--film-dot);
  cursor: pointer;
}
.film-toggle .icon { width: 16px; height: 16px; }
.film-play {
  position: absolute;
  inset: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
.film-play-mark {
  inset: 0;
  margin: auto;
  width: 60px;
  height: 60px;
  background: var(--film-mark);
  color: var(--deep);
}
.film-play-mark .icon { width: 22px; height: 22px; margin-left: 3px; }
.film-slide[inert] :is(.film-toggle, .film-play-mark) { opacity: 0; }
.film-dots { display: flex; justify-content: center; margin-top: 14px; }
.film-dot {
  display: grid;
  place-items: center;
  width: 36px;
  height: 44px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
.film-dot::before {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--film-dot-idle);
  transition: background-color .3s;
}
.film-dot[aria-current]::before { background: var(--film-dot); }
.home-films :is(.film-dot, .film-toggle, .film-play):focus-visible { outline: 2px solid currentColor; outline-offset: -4px; border-radius: 12px; }
@media (prefers-reduced-motion: reduce) {
  .film-dot::before, .film-toggle, .film-play-mark { transition: none; }
}
@media (forced-colors: active) {
  .film-dot::before { background: GrayText; }
  .film-dot[aria-current]::before { background: CanvasText; }
}
</style>
