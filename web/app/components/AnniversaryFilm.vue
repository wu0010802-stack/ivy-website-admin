<script setup lang="ts">
import { ANNI_FILM } from '~/utils/anniversary/film-media'
import { FILM_CUES, FILM_PORTRAIT, FILM_TITLE, creditParts, cueIndexAt, cueSeconds, durationLabel, formatClock, posterSrcset } from '~/utils/anniversary/film'
import { createAmbient } from '~/utils/anniversary/film-ambient'
import { mayAutoplay, type ConnectionInfo } from '~/utils/media-policy'

// 30 週年分頁首屏的放映區：紀念影片《長成自己喜歡的樣子》（2 分 24 秒，有配樂）。
// - 還沒按播放：封面是孩子的照片，條件允許時（沒有偏好減少動態、不是省流量或 2G／3G）疊上一段約 10 秒的無聲預告。
// - 按了播放：從頭播（有聲音），整頁關燈——一層深色蓋住頁面其他部分，影片四周透出畫面的顏色；
//   暫停、播完、按 Esc 或影片捲出畫面就開燈（捲出畫面時順便暫停，不讓看不到的影片繼續出聲）。
// - 直拿的手機播直式那一版（同一條時間軸重新排版的，不是裁切）；播到一半轉向，換檔後接著原本的秒數。
// - 「影片裡的話」：片中的六句，播到哪一句、哪一句亮；點了從那一段播。沒有旁白，這六句就是影片的文字版。
// 沒有 JS 時封面是連到影片檔的連結，瀏覽器自己的播放器會接手。影片檔按了才開始下載（preload="none"）。
const SIZES = `${FILM_PORTRAIT} calc(100vw - 60px), min(1260px, calc(100vw - 116px))`
const posterDesktop = ANNI_FILM.poster.desktop
const posterMobile = ANNI_FILM.poster.mobile
// 句子都很短：只在逗號後換行，不會拆成「長成五所／校園」
const clauses = (text: string) => text.split(/(?<=，)/)
// 出處有兩段（配樂、片中地圖）：放不下時先在兩段之間換行，再不夠才在括號前、「・」後換
const credits = creditParts()

const root = ref<HTMLElement | null>(null)
const frame = ref<HTMLElement | null>(null)
const video = ref<HTMLVideoElement | null>(null)
const teaser = ref<HTMLVideoElement | null>(null)
const glow = ref<HTMLCanvasElement | null>(null)
const cues = ref<HTMLOListElement | null>(null)

const started = ref(false)
const playing = ref(false)
const visible = ref(true)
const teasing = ref(false)
const teaserSrc = ref('')
const now = ref(-1)
const active = computed(() => (started.value ? cueIndexAt(now.value) : -1))
// 關燈：正在播、而且影片大半還在畫面裡
const dark = computed(() => playing.value && visible.value)

let ambient: ReturnType<typeof createAmbient> | null = null
let io: IntersectionObserver | null = null
let aspect: MediaQueryList | null = null
let idleTimer = 0

function stopTeaser() {
  teaser.value?.pause()
  teaserSrc.value = ''
  teasing.value = false
}

/** 從第 at 秒開始播。play() 要在點擊的同一個工作裡呼叫（Safari 才肯放聲音），所以先播、再換畫面。 */
function start(at = 0) {
  const v = video.value
  if (!v) return
  if (at > 0) {
    v.addEventListener('loadedmetadata', () => { if (Math.abs(v.currentTime - at) > 1) v.currentTime = at }, { once: true })
    try { v.currentTime = at } catch { /* 還沒載到 metadata：上面那一行會補 */ }
  }
  // 被瀏覽器擋下來時原生控制列還在，可以自己再按一次
  v.play().catch(() => {})
  if (started.value) return
  started.value = true
  stopTeaser()
  nextTick(() => v.focus({ preventScroll: true }))
}

function seek(index: number) {
  const cue = FILM_CUES[index]
  if (!cue) return
  const at = cueSeconds(cue)
  const v = video.value
  if (!started.value || !v) { start(at); return }
  v.currentTime = at
  v.play().catch(() => {})
}

function onPlay() {
  playing.value = true
  const v = video.value, c = glow.value
  if (v && c) { ambient ??= createAmbient(v, c); ambient.start() }
  if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `《${FILM_TITLE}》`, artist: '常春藤教育機構', album: '常春藤 30 週年',
      artwork: [{ src: posterDesktop[0].src, sizes: '960x540', type: 'image/webp' }]
    })
  }
}
function onPause() { playing.value = false; ambient?.stop() }
function onTime() { now.value = video.value?.currentTime ?? -1 }
// 暫停時拖時間軸：四周的光補一張新畫面
function onSeeked() { ambient?.snap() }

// 手機：亮著的那一句捲進「影片裡的話」這一排的畫面裡（只捲這一排，不動整頁）
watch(active, (i) => {
  const list = cues.value, item = list?.children[i] as HTMLElement | undefined
  if (!list || !item || list.scrollWidth <= list.clientWidth + 1) return
  const left = item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2
  list.scrollTo({ left, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
})

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && dark.value && !document.fullscreenElement) video.value?.pause()
}

/** 轉向：預告換檔；正片已經開始的話換成另一版、接著原本的秒數 */
function onAspect() {
  const portrait = Boolean(aspect?.matches)
  if (teaserSrc.value) teaserSrc.value = portrait ? ANNI_FILM.teaser.mobile : ANNI_FILM.teaser.desktop
  const v = video.value
  if (!v || !started.value) return
  const want = portrait ? ANNI_FILM.film.mobile : ANNI_FILM.film.desktop
  if (v.currentSrc.endsWith(want) || document.fullscreenElement) return
  const at = v.currentTime, wasPlaying = !v.paused && !v.ended
  v.addEventListener('loadedmetadata', () => { v.currentTime = at; if (wasPlaying) v.play().catch(() => {}) }, { once: true })
  v.load()
}

onMounted(() => {
  aspect = matchMedia(FILM_PORTRAIT)
  aspect.addEventListener('change', onAspect)
  // 用 capture：焦點在原生控制列裡時，按鍵事件不一定會冒泡出來
  addEventListener('keydown', onKey, true)
  if (frame.value && 'IntersectionObserver' in window) {
    io = new IntersectionObserver(([entry]) => {
      if (!entry) return
      visible.value = entry.intersectionRatio >= 0.35
      // 捲走了：正片暫停（不讓看不到的影片繼續出聲）、預告也停下來省電
      if (!visible.value && playing.value) video.value?.pause()
      const t = teaser.value
      if (t) { if (entry.isIntersecting) t.play().catch(() => {}); else t.pause() }
    }, { threshold: [0, 0.35, 0.6] })
    io.observe(frame.value)
  }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const connection = (navigator as Navigator & { connection?: ConnectionInfo }).connection
  if (!mayAutoplay(reduce, connection)) return
  // 預告等整頁載完、閒下來才開始抓，不跟首屏的封面與字型搶頻寬
  const go = () => { idleTimer = window.setTimeout(() => { if (!started.value) teaserSrc.value = aspect?.matches ? ANNI_FILM.teaser.mobile : ANNI_FILM.teaser.desktop }, 600) }
  if (document.readyState === 'complete') go()
  else addEventListener('load', go, { once: true })
})
// 預告的 <video> 是掛上之後才出現的：muted 要在 play() 之前就是 true（行動裝置才肯自動播）
watch(teaser, (t) => { if (t) { t.muted = true; t.play().catch(() => {}) } })
onBeforeUnmount(() => {
  aspect?.removeEventListener('change', onAspect)
  removeEventListener('keydown', onKey, true)
  io?.disconnect()
  ambient?.stop()
  clearTimeout(idleTimer)
})

defineExpose({ start })
</script>

<template>
  <section id="film" ref="root" class="anni-film" :class="{ 'is-started': started, 'is-dark': dark, 'is-teasing': teasing }" aria-labelledby="anni-film-title">
    <div class="anni-film-dim" aria-hidden="true" />
    <figure class="anni-film-stage">
      <div class="anni-film-mat">
        <span class="anni-film-tape" aria-hidden="true" />
        <canvas ref="glow" class="anni-film-glow" width="32" height="18" aria-hidden="true" />
        <div ref="frame" class="anni-film-frame">
          <video
            ref="video" class="anni-film-video" playsinline preload="none" :controls="started" :tabindex="started ? 0 : -1"
            :aria-label="`常春藤 30 週年紀念影片《${FILM_TITLE}》，${durationLabel()}，只有配樂、沒有旁白；片中的句子列在影片下面`"
            @play="onPlay" @pause="onPause" @ended="onPause" @timeupdate="onTime" @seeked="onSeeked"
          >
            <source :src="ANNI_FILM.film.mobile" :media="FILM_PORTRAIT" type="video/mp4">
            <source :src="ANNI_FILM.film.desktop" type="video/mp4">
          </video>
          <a v-if="!started" class="anni-film-cover" :href="ANNI_FILM.film.desktop" :aria-label="`播放紀念影片《${FILM_TITLE}》，${durationLabel()}，有配樂`" @click.prevent="start(0)">
            <picture>
              <source :media="FILM_PORTRAIT" :srcset="posterSrcset(posterMobile)" :sizes="SIZES" width="1296" height="2304">
              <img :src="posterDesktop[1].src" :srcset="posterSrcset(posterDesktop)" :sizes="SIZES" width="2304" height="1296" alt="" fetchpriority="high" decoding="async">
            </picture>
            <video
              v-if="teaserSrc" ref="teaser" class="anni-film-teaser" :src="teaserSrc" muted loop autoplay playsinline preload="auto"
              tabindex="-1" aria-hidden="true" disablepictureinpicture disableremoteplayback @playing="teasing = true"
            />
            <span class="anni-film-shade" aria-hidden="true" />
            <span class="anni-film-card" aria-hidden="true">
              <span class="anni-film-play"><svg class="icon" focusable="false"><use href="#i-play" /></svg></span>
              <span class="anni-film-label"><small>紀念影片</small><b>{{ FILM_TITLE }}</b><span>{{ durationLabel() }}</span></span>
            </span>
          </a>
        </div>
      </div>
      <figcaption class="anni-film-caption">
        <h2 id="anni-film-title"><span class="anni-film-nobr">紀念影片</span><span class="anni-film-nobr">《{{ FILM_TITLE }}》</span></h2>
        <p><span v-for="(credit, i) in credits" :key="i" class="anni-film-part"><span v-for="(bit, k) in credit" :key="k" class="anni-film-part">{{ bit }}</span></span></p>
      </figcaption>
    </figure>

    <!-- 影片裡的話：桌機排在影片右邊（像曲目表），平板在影片下面排三欄，手機是橫向滑動的一排 -->
    <div class="anni-film-side">
      <h3 id="anni-film-cues-title">影片裡的話</h3>
      <ol ref="cues" class="anni-film-cues" aria-labelledby="anni-film-cues-title">
        <li v-for="(cue, i) in FILM_CUES" :key="cue.frame">
          <button type="button" :aria-current="active === i ? 'true' : undefined" @click="seek(i)">
            <span class="anni-film-thumb"><img :src="ANNI_FILM.cues[i]" width="480" height="300" alt="" loading="lazy" decoding="async"></span>
            <span class="anni-film-line">
              <span class="anni-film-at"><span class="sr-only">從 </span>{{ formatClock(cueSeconds(cue)) }}<span class="sr-only"> 開始播：</span></span>
              <span class="anni-film-say"><span v-for="(part, k) in clauses(cue.text)" :key="k" class="anni-film-nobr">{{ part }}</span></span>
            </span>
          </button>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped src="../assets/css/anniversary-film.css"></style>
