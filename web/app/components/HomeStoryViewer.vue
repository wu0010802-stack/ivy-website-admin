<script setup lang="ts">
import { responsiveTourImage } from '~/utils/tour-image'
import { eventTimeDetail, isSampleNews, newsPath, safeWebUrl, titleClauses } from '~/utils/news-content'
import { countdownLabel, dateParts, type HomeStory } from '~/utils/news-home'
import { mayAutoplay, type ConnectionInfo } from '~/utils/media-policy'
import { youtubeEmbed } from '~/utils/filmCarousel'
import type { Campus, HomeFilm } from '~/types/site-content'

/**
 * 手機動態的檢視（2026-10-17 方向 3）：卡片直接長成全螢幕（view transition），上方進度條自動換則。
 * 點左三分之一回上一則、其他地方下一則；按住暫停；左右滑換則；往下拖關閉；方向鍵、空白鍵、Esc。
 * 有看得到的暫停鈕（WCAG 2.2.2）；減少動態時不自動換則、不做轉場。看完最後一則直接關閉（不放參觀頁，使用者裁定）。
 * 檔案影片靜音播 start～end；省流量或減少動態時不自動播。YouTube 先放封面，點了才插 iframe，同時停住進度。
 */
const props = defineProps<{ campuses: Campus[]; today: string; sampleNote: string; cardFor: (id: string) => HTMLElement | null }>()
const emit = defineEmits<{ seen: [id: string] }>()

const PHOTO_MS = 6500
const EVENT_MS = 8000
const TINTS = ['var(--ivy-news-swept-gold)', 'var(--ivy-news-swept-sage)', 'var(--ivy-news-swept-mist)']

const dialogEl = ref<HTMLDialogElement | null>(null)
const frameEl = ref<HTMLElement | null>(null)
const barsEl = ref<HTMLElement | null>(null)
const videoEl = ref<HTMLVideoElement | null>(null)
const seq = shallowRef<HomeStory[]>([])
const idx = ref(0)
const userPaused = ref(false)
const holding = ref(false)
const pageHidden = ref(false)
const youtubeLive = ref(false)
const muted = ref(true)
const reduced = ref(false)
const autoplayOk = ref(true)
const announcement = ref('')
const story = computed(() => seq.value[idx.value])
// 加入行事曆的選單開著時也停住，免得選到一半換到下一則。
const menuOpen = ref(false)
const paused = computed(() => userPaused.value || holding.value || pageHidden.value || youtubeLive.value || menuOpen.value)
let anim: Animation | null = null
let frame = 0
// 觸控點最後一則關閉後，瀏覽器補發的 click 會落到底下的卡片又把檢視打開；這段時間內的 click 一律吞掉。
let swallowUntil = 0

type Transition = { finished: Promise<void> }
type TransitionDocument = Document & { startViewTransition?: (update: () => Promise<void> | void) => Transition }

const isSample = (item: { sample?: boolean }) => isSampleNews(item, props.sampleNote)
// 頭像：只屬於一校的用那一校的校舍照，全校或多校用校徽。內建示意消息沒有 campusKeys，比對校名。
const campusFor = (item: { campus: string; campusKeys?: string[] }) => (item.campusKeys
  ? (item.campusKeys.length === 1 ? props.campuses.find((c) => c.key === item.campusKeys![0]) : undefined)
  : props.campuses.find((c) => c.name === item.campus))
const storyCampus = computed(() => {
  const s = story.value
  if (s?.kind === 'event') return campusFor(s.event)
  if (s?.kind === 'news') return campusFor(s.article)
  return undefined
})
const who = computed(() => {
  const s = story.value
  if (!s) return { name: '', note: '' }
  if (s.kind === 'event') return { name: s.event.campus, note: '活動' }
  if (s.kind === 'news') return { name: s.article.campus, note: s.article.category }
  return { name: '常春藤', note: '活動影片' }
})
const filmTitle = (film: HomeFilm) => film.title.replace(/^[^：]*校：/, '')
const isFileFilm = computed(() => story.value?.kind === 'film' && story.value.film.type === 'file')
const monthDay = (date: string) => `${dateParts(date).month} 月 ${dateParts(date).day} 日`
const backdrop = computed(() => {
  const s = story.value
  const src = s?.kind === 'news' ? responsiveTourImage(s.article.image, '100vw', false, s.article.imageMedia).src
    : s?.kind === 'film' ? s.film.poster : ''
  return src ? { backgroundImage: `url("${src}")` } : undefined
})

function stopClock() {
  anim?.cancel()
  anim = null
  cancelAnimationFrame(frame)
}

function applyPause() {
  if (anim) paused.value ? anim.pause() : anim.play()
  const video = videoEl.value
  if (video && autoplayOk.value) paused.value ? video.pause() : void video.play().catch(() => {})
}
watch(paused, applyPause)

// 進度條：照片與活動用 Web Animations 計時；檔案影片照影片播放位置走，播到片段尾換下一則。
async function startClock() {
  stopClock()
  await nextTick()
  const s = story.value
  const fill = barsEl.value?.children[idx.value]?.firstElementChild as HTMLElement | null | undefined
  if (!s || !fill) return
  if (s.kind === 'film' && s.film.type === 'file') {
    const film = s.film
    const video = videoEl.value
    if (!video) return
    video.muted = muted.value
    const begin = () => {
      video.currentTime = film.start
      if (autoplayOk.value && !paused.value) void video.play().catch(() => {})
    }
    if (video.readyState >= 1) begin()
    else video.addEventListener('loadedmetadata', begin, { once: true })
    const tick = () => {
      const end = film.end ?? (Number.isFinite(video.duration) ? video.duration : film.start + 10)
      const done = Math.min(1, Math.max(0, (video.currentTime - film.start) / Math.max(0.1, end - film.start)))
      fill.style.transform = `scaleX(${done})`
      if ((done >= 1 || video.ended) && autoplayOk.value) {
        go(1)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return
  }
  if (reduced.value) {
    fill.style.transform = 'scaleX(1)'
    return
  }
  anim = fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: s.kind === 'event' ? EVENT_MS : PHOTO_MS, easing: 'linear', fill: 'forwards' })
  anim.onfinish = () => go(1)
  applyPause()
}

function render(i: number) {
  idx.value = i
  youtubeLive.value = false
  menuOpen.value = false
  const s = seq.value[i]
  if (!s) return
  emit('seen', s.id)
  const title = s.kind === 'event' ? s.event.title : s.kind === 'news' ? s.article.title : filmTitle(s.film)
  announcement.value = `第 ${i + 1} 則，共 ${seq.value.length} 則：${title}`
  // 預先載入下一則的照片
  const next = seq.value[i + 1]
  if (next?.kind === 'news') new Image().src = responsiveTourImage(next.article.image, '100vw', false, next.article.imageMedia).src ?? ''
  else if (next?.kind === 'film') new Image().src = next.film.poster
}

function go(dir: number) {
  const to = idx.value + dir
  if (to >= seq.value.length) {
    close()
    return
  }
  render(Math.max(0, to))
  void startClock()
}

function open(list: HomeStory[], index: number, source: HTMLElement | null) {
  if (!list.length || dialogEl.value?.open) return
  seq.value = list
  userPaused.value = false
  muted.value = true
  const run = () => {
    dialogEl.value?.showModal()
    render(Math.max(0, index))
  }
  const doc = document as TransitionDocument
  if (!reduced.value && doc.startViewTransition && source) {
    source.style.viewTransitionName = 'hs-card'
    const transition = doc.startViewTransition(async () => {
      source.style.viewTransitionName = ''
      run()
      await nextTick()
      if (frameEl.value) frameEl.value.style.viewTransitionName = 'hs-card'
    })
    transition.finished.finally(() => {
      if (frameEl.value) frameEl.value.style.viewTransitionName = ''
      void startClock()
    })
  } else {
    run()
    void startClock()
  }
}

function close() {
  const dialog = dialogEl.value
  if (!dialog?.open) return
  stopClock()
  videoEl.value?.pause()
  const s = story.value
  const card = s ? props.cardFor(s.id) : null
  const rect = card?.getBoundingClientRect()
  const visible = rect && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight
  const doc = document as TransitionDocument
  if (!reduced.value && doc.startViewTransition && card && visible && frameEl.value) {
    const frameNode = frameEl.value
    frameNode.style.viewTransitionName = 'hs-card'
    const transition = doc.startViewTransition(() => {
      frameNode.style.viewTransitionName = ''
      dialog.close()
      card.style.viewTransitionName = 'hs-card'
    })
    transition.finished.finally(() => { card.style.viewTransitionName = '' })
  } else dialog.close()
}

function onClosed() {
  stopClock()
  youtubeLive.value = false
  menuOpen.value = false
  holding.value = false
}

function onMenuToggle(event: Event) {
  if ((event.target as Element).matches('[popover]')) menuOpen.value = (event as ToggleEvent).newState === 'open'
}

function toggleMute() {
  muted.value = !muted.value
  if (videoEl.value) videoEl.value.muted = muted.value
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowRight') { event.preventDefault(); go(1) }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1) }
  else if (event.key === ' ' && !(event.target as Element).closest('button, a')) {
    event.preventDefault()
    userPaused.value = !userPaused.value
  }
}
function onDialogClick(event: MouseEvent) {
  if (event.target === dialogEl.value) close()
}

// 手勢：點左三分之一回上一則、其他地方下一則；按住暫停；左右滑換則；往下拖關閉。
let drag: { x: number; y: number; dx: number; dy: number } | null = null
let holdTimer: ReturnType<typeof setTimeout> | undefined
function onPointerDown(event: PointerEvent) {
  if ((event.target as Element).closest('a, button, iframe, video[controls]') || event.button > 0) return
  drag = { x: event.clientX, y: event.clientY, dx: 0, dy: 0 }
  frameEl.value?.setPointerCapture(event.pointerId)
  holdTimer = setTimeout(() => { holding.value = true }, 220)
}
function onPointerMove(event: PointerEvent) {
  if (!drag || !frameEl.value) return
  drag.dx = event.clientX - drag.x
  drag.dy = event.clientY - drag.y
  if (Math.abs(drag.dx) > 8 || Math.abs(drag.dy) > 8) clearTimeout(holdTimer)
  if (drag.dy > 0 && Math.abs(drag.dy) > Math.abs(drag.dx)) {
    frameEl.value.classList.add('is-dragging')
    frameEl.value.style.translate = `0 ${drag.dy}px`
    frameEl.value.style.scale = String(1 - Math.min(drag.dy / 2400, 0.12))
  }
}
function onPointerUp(event: PointerEvent) {
  if (!drag || !frameEl.value) return
  clearTimeout(holdTimer)
  const { dx, dy } = drag
  drag = null
  frameEl.value.classList.remove('is-dragging')
  frameEl.value.style.translate = ''
  frameEl.value.style.scale = ''
  if (holding.value) {
    holding.value = false
    return
  }
  if (event.type === 'pointercancel') return
  if (dy > 110 && dy > Math.abs(dx)) {
    swallowUntil = performance.now() + 500
    close()
    return
  }
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
    go(dx < 0 ? 1 : -1)
    return
  }
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
    const rect = frameEl.value.getBoundingClientRect()
    const dir = event.clientX - rect.left < rect.width * 0.3 ? -1 : 1
    if (dir > 0 && idx.value === seq.value.length - 1) swallowUntil = performance.now() + 500
    go(dir)
  }
}

function swallowGhostClick(event: MouseEvent) {
  if (performance.now() < swallowUntil) {
    event.preventDefault()
    event.stopPropagation()
  }
}
function onVisibility() {
  pageHidden.value = document.hidden
}

onMounted(() => {
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  reduced.value = motion.matches
  autoplayOk.value = mayAutoplay(reduced.value, (navigator as Navigator & { connection?: ConnectionInfo }).connection)
  document.addEventListener('click', swallowGhostClick, true)
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  stopClock()
  document.removeEventListener('click', swallowGhostClick, true)
  document.removeEventListener('visibilitychange', onVisibility)
})

defineExpose({ open })
</script>

<template>
  <dialog ref="dialogEl" class="hsv" aria-label="最新消息" @cancel.prevent="close" @close="onClosed" @keydown="onKeydown" @click="onDialogClick">
    <div class="hsv-bg" :style="backdrop" aria-hidden="true" />
    <div
      ref="frameEl" class="hsv-frame" :class="{ 'is-paper': story?.kind === 'event' }"
      @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp"
      @toggle.capture="onMenuToggle"
    >
      <div ref="barsEl" class="hsv-bars" aria-hidden="true">
        <i v-for="(s, j) in seq" :key="s.id" :class="{ 'is-done': j < idx }"><b /></i>
      </div>
      <div class="hsv-top">
        <span class="hsv-avatar">
          <img v-if="storyCampus" v-bind="responsiveTourImage(storyCampus.image, '34px', false, storyCampus.imageMedia)" alt="">
          <svg v-else viewBox="30 26 124 132" aria-hidden="true" focusable="false"><image href="/assets/logo.webp" width="552" height="192" /></svg>
        </span>
        <p class="hsv-who">{{ who.name }}<small>{{ who.note }}</small></p>
        <button v-if="isFileFilm" type="button" class="hsv-icon" :aria-label="muted ? '開啟聲音' : '關閉聲音'" @click="toggleMute">
          <svg class="icon" aria-hidden="true"><use :href="muted ? '#i-speaker-slash' : '#i-speaker-high'" /></svg>
        </button>
        <button type="button" class="hsv-icon" :aria-label="userPaused ? '繼續播放' : '暫停'" @click="userPaused = !userPaused">
          <svg class="icon" aria-hidden="true"><use :href="userPaused ? '#i-play' : '#i-pause'" /></svg>
        </button>
        <button type="button" class="hsv-icon" aria-label="關閉" autofocus @click="close">
          <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
        </button>
      </div>

      <template v-if="story?.kind === 'event'">
        <div class="hsv-stage is-paper" :style="{ '--tint': TINTS[story.tint] }">
          <div class="hsv-paper">
            <template v-if="isSample(story.event)">
              <span class="hsv-count">示意活動</span>
              <div class="hsv-date is-sample"><b>日期未定</b></div>
            </template>
            <template v-else>
              <span class="hsv-count">{{ countdownLabel(today, story.event.date) }}</span>
              <div class="hsv-date"><b>{{ dateParts(story.event.date).day }}</b><span>{{ dateParts(story.event.date).year }} 年 {{ dateParts(story.event.date).month }} 月・星期{{ dateParts(story.event.date).weekday }}</span></div>
            </template>
            <h3><span v-for="(part, k) in titleClauses(story.event.title)" :key="k" class="hs-clause">{{ part }}</span></h3>
            <div v-if="eventTimeDetail(story.event) || story.event.location" class="hsv-facts">
              <span v-if="eventTimeDetail(story.event)"><svg class="icon" aria-hidden="true"><use href="#i-clock" /></svg>{{ eventTimeDetail(story.event) }}</span>
              <span v-if="story.event.location"><svg class="icon" aria-hidden="true"><use href="#i-map-pin" /></svg>{{ story.event.location }}</span>
            </div>
            <p>{{ story.event.description }}</p>
            <div v-if="!isSample(story.event) || safeWebUrl(story.event.linkUrl)" class="hsv-actions">
              <HomeEventCalendar v-if="!isSample(story.event)" :key="story.id" :event="story.event" />
              <a v-if="safeWebUrl(story.event.linkUrl)" class="hsv-link" :href="safeWebUrl(story.event.linkUrl)" target="_blank" rel="noopener noreferrer">{{ story.event.linkLabel || '活動詳情' }} ↗<span class="sr-only">（另開分頁）</span></a>
            </div>
          </div>
        </div>
      </template>
      <template v-else-if="story?.kind === 'news'">
        <div class="hsv-stage is-media">
          <img v-bind="responsiveTourImage(story.article.image, '100vw', false, story.article.imageMedia)" :style="story.article.imageMedia?.position ? { objectPosition: story.article.imageMedia.position } : undefined" :alt="story.article.alt">
        </div>
        <div class="hsv-caption">
          <small>{{ story.article.category }}・{{ monthDay(story.article.date) }}<template v-if="isSample(story.article)">・示意</template></small>
          <h3><span v-for="(part, k) in titleClauses(story.article.title)" :key="k" class="hs-clause">{{ part }}</span></h3>
          <p>{{ story.article.description }}</p>
          <div class="hsv-actions"><NuxtLink class="hsv-btn" :to="newsPath(story.article.id)">看完整消息</NuxtLink></div>
        </div>
      </template>
      <template v-else-if="story?.kind === 'film'">
        <div class="hsv-stage is-media">
          <video
            v-if="story.film.type === 'file'" :key="story.id" ref="videoEl" :src="`${story.film.src}#t=${story.film.start}`" :poster="story.film.poster"
            muted playsinline preload="auto" disablepictureinpicture :controls="!autoplayOk || undefined" aria-hidden="true"
          />
          <template v-else>
            <iframe
              v-if="youtubeLive" :src="youtubeEmbed(story.film.youtubeId)" :title="story.film.title"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"
            />
            <template v-else>
              <img :src="story.film.poster" alt="">
              <button type="button" class="hsv-ytplay" :aria-label="`在 YouTube 播放「${story.film.title}」`" @click="youtubeLive = true">
                <svg class="icon" aria-hidden="true"><use href="#i-play" /></svg>
              </button>
            </template>
          </template>
        </div>
        <div v-if="!youtubeLive" class="hsv-caption">
          <small>活動影片</small>
          <h3>{{ filmTitle(story.film) }}</h3>
        </div>
      </template>
    </div>
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </dialog>
</template>

<style>
html:has(.hsv[open]) { overflow: hidden; }
.hsv { width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; overflow: hidden; background: rgb(var(--ivy-news-backdrop-rgb) / .94); color: rgb(var(--on-dark)); }
.hsv[open] { display: grid; place-items: center; }
.hsv::backdrop { background: transparent; }
.hsv-bg { position: absolute; inset: -12%; background: center / cover no-repeat; filter: blur(56px) saturate(1.15); opacity: .38; pointer-events: none; }
.hsv-frame { position: relative; width: min(100vw, calc(100dvh * 9 / 16)); height: 100dvh; overflow: hidden; background: var(--deep); touch-action: none; user-select: none; -webkit-user-select: none; }
@media (min-width: 641px) { .hsv-frame { height: min(86dvh, 820px); width: auto; aspect-ratio: 9 / 16; border-radius: 20px; } }
@media (prefers-reduced-motion: no-preference) { .hsv-frame { transition: translate .35s ease-out, scale .35s ease-out; } }
.hsv-frame.is-dragging { transition: none; }
.hsv-bars { position: absolute; z-index: 4; top: calc(10px + env(safe-area-inset-top)); left: 10px; right: 10px; display: flex; gap: 4px; }
.hsv-bars i { flex: 1; height: 3px; border-radius: 3px; background: rgb(var(--on-dark) / .32); overflow: hidden; }
.hsv-bars b { display: block; height: 100%; background: rgb(var(--on-dark)); transform-origin: left; transform: scaleX(0); }
.hsv-bars i.is-done b { transform: scaleX(1); }
.hsv-top { position: absolute; z-index: 4; top: calc(22px + env(safe-area-inset-top)); left: 12px; right: 6px; display: flex; align-items: center; gap: 8px; }
.hsv-avatar { flex: none; display: block; width: 34px; height: 34px; border-radius: 50%; overflow: hidden; background: var(--white); box-shadow: 0 0 0 1.5px rgb(var(--on-dark) / .8); }
.hsv-avatar img { width: 100%; height: 100%; object-fit: cover; }
.hsv-avatar svg { display: block; width: 100%; height: 100%; padding: 4px; }
.hsv-who { flex: 1; min-width: 0; margin: 0; font: 600 var(--fs-sm)/1.3 var(--font-information); text-shadow: 0 1px 6px rgb(var(--ivy-news-backdrop-rgb) / .5); }
.hsv-who small { display: block; font-size: var(--fs-xs); font-weight: 400; }
.hsv-icon { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: none; color: inherit; cursor: pointer; }
.hsv-icon .icon { width: 22px; height: 22px; filter: drop-shadow(0 1px 4px rgb(var(--ivy-news-backdrop-rgb) / .5)); }
.hsv-icon:focus-visible { outline: 2px solid var(--gold); outline-offset: -2px; }
.hsv-stage { position: absolute; inset: 0; display: grid; }
.hsv-stage > img, .hsv-stage > video, .hsv-stage > iframe { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border: 0; }
.hsv-stage > iframe { top: 50%; bottom: auto; height: auto; aspect-ratio: 16 / 9; translate: 0 -50%; }
.hsv-stage.is-media::after { content: ''; position: absolute; inset: 0; background: linear-gradient(to top, rgb(var(--ivy-news-backdrop-rgb) / .88) 0%, rgb(var(--ivy-news-backdrop-rgb) / .5) 30%, transparent 55%), linear-gradient(to bottom, rgb(var(--ivy-news-backdrop-rgb) / .45), transparent 22%); pointer-events: none; }
.hsv-stage:has(iframe)::after { display: none; }
.hsv-caption { position: absolute; z-index: 3; left: 0; right: 0; bottom: 0; display: grid; gap: 8px; padding: 22px 22px calc(26px + env(safe-area-inset-bottom)); }
.hsv-caption small { font-size: var(--fs-xs); }
.hsv-caption h3 { font: 600 var(--fs-2xl)/1.45 var(--font-information); word-break: keep-all; overflow-wrap: anywhere; }
.hsv-caption p { margin: 0; font-size: var(--fs-sm); line-height: 1.8; }
.hsv-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-top: 8px; }
.hsv-btn { display: inline-flex; align-items: center; min-height: 44px; padding: 0 18px; border-radius: 999px; background: var(--white); color: var(--ivy-news-green); font: 600 var(--fs-sm)/1 var(--font-information); text-decoration: none; }
.hsv-ytplay { position: absolute; z-index: 3; left: 50%; top: 46%; translate: -50% -50%; display: grid; place-items: center; width: 76px; height: 76px; padding: 0; border: 0; border-radius: 50%; background: var(--white); color: var(--ivy-news-green); cursor: pointer; box-shadow: 0 10px 30px rgb(var(--ivy-news-backdrop-rgb) / .35); }
.hsv-ytplay .icon { width: 28px; height: 28px; margin-left: 4px; }
/* 活動頁：活動三色底、深綠字，上方列跟著換深色。 */
.hsv-stage.is-paper { background: var(--tint); color: var(--ivy-news-green); }
.hsv-frame.is-paper .hsv-top { color: var(--ivy-news-green); }
.hsv-frame.is-paper .hsv-who { text-shadow: none; }
.hsv-frame.is-paper .hsv-icon .icon { filter: none; }
.hsv-frame.is-paper .hsv-bars i { background: rgb(var(--ink) / .14); }
.hsv-frame.is-paper .hsv-bars b { background: var(--ivy-news-green); }
.hsv-paper { align-self: center; display: grid; gap: 10px; padding: 88px 24px 28px; }
.hsv-count { justify-self: start; display: inline-flex; align-items: center; min-height: 28px; padding: 0 12px; border-radius: 999px; background: color-mix(in oklch, var(--ivy-news-green) 12%, transparent); font: 600 var(--fs-sm)/1 var(--font-information); }
.hsv-date b { display: block; font: 400 clamp(6.5rem, 17dvh, 9rem)/.8 var(--font-date); letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.hsv-date span { display: block; margin-top: 12px; font: 600 var(--fs-md)/1.4 var(--font-information); }
.hsv-date.is-sample b { font: 600 var(--fs-4xl)/1.2 var(--font-information); letter-spacing: .04em; }
.hsv-paper h3 { margin-top: 14px; font: 600 var(--fs-3xl)/1.4 var(--font-information); word-break: keep-all; overflow-wrap: anywhere; }
.hsv-facts { display: grid; gap: 4px; font-size: var(--fs-sm); }
.hsv-facts span { display: inline-flex; align-items: center; gap: 8px; }
.hsv-facts .icon { width: 1.1em; height: 1.1em; }
.hsv-paper p { margin: 0; font-size: var(--fs-sm); line-height: 1.8; }
.hsv-link { color: inherit; font-size: var(--fs-sm); font-weight: 600; text-decoration: underline; text-underline-offset: 4px; min-height: 44px; display: inline-flex; align-items: center; }
/* 開合：卡片直接長成這一頁（view transition），不支援就淡入。 */
@media (prefers-reduced-motion: no-preference) {
  .hsv[open] { opacity: 1; transition: opacity .25s ease-out, display .25s allow-discrete, overlay .25s allow-discrete; }
  @starting-style { .hsv[open] { opacity: 0; } }
}
::view-transition-group(hs-card) { animation-duration: .5s; animation-timing-function: cubic-bezier(.23, 1, .32, 1); }
::view-transition-old(hs-card), ::view-transition-new(hs-card) { width: 100%; height: 100%; object-fit: cover; }
@media (forced-colors: active) {
  .hsv-frame { border: 1px solid CanvasText; }
}
</style>
