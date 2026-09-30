<script setup lang="ts">
import { HOME_HERO_SIZES } from '~/utils/responsive-image'
import { backgroundVideoSrc, mayAutoplay, type ConnectionInfo } from '~/utils/media-policy'
import { COMPACT_ENTRANCE_MEDIA } from '~/utils/entrance-timeline'
import { heroImageAttrs, mediaImageAttrs } from '~/utils/media-image'
import type { HeroContent } from '~/types/site-content'
import { useHomeReveal } from '~/composables/useHomeReveal'

const props = defineProps<{ hero: HeroContent }>()

const rootEl = ref<HTMLElement | null>(null)
const trackEl = ref<HTMLElement | null>(null)
const sectionEl = ref<HTMLElement | null>(null)
const copyEl = ref<HTMLElement | null>(null)
const imageEl = ref<HTMLElement | null>(null)
const mediaEl = ref<HTMLElement | null>(null)
const actionsEl = ref<HTMLElement | null>(null)
const videoEl = ref<HTMLVideoElement | null>(null)
const showVideo = ref(false)
const isPlaying = ref(false)
const heroImgEl = ref<HTMLImageElement | null>(null)
const videoSrc = ref('')
const isMobileVideo = ref(false)
// 影片載入失敗：後台設了替代圖就換上它，沒設就維持首屏照片（跟以前一樣）。
const videoFailed = ref(false)
const heroImage = computed(() => {
  const fallback = videoFailed.value ? props.hero.heroFallbackMedia : undefined
  return fallback
    ? { attrs: mediaImageAttrs(fallback, HOME_HERO_SIZES), alt: fallback.alt, position: fallback.position }
    : { attrs: heroImageAttrs(props.hero), alt: props.hero.heroImageAlt, position: props.hero.heroImageMedia?.position ?? null }
})
const videoPosition = computed(() => (isMobileVideo.value ? props.hero.heroVideoPositionMobile : props.hero.heroVideoPosition) ?? null)
let disposed = false
let playbackFrame = 0
let removeImageListener: (() => void) | undefined
let entranceWatch: MutationObserver | undefined
let entranceTimer: ReturnType<typeof setTimeout> | undefined
let entranceWaited = false

// 開場布幕還在等資源（pending）時，影片被布幕蓋住卻跟它搶頻寬：一般 4G
// 實測 3.9 MB 從 1.5 秒載到 6.5 秒，布幕因此趕不上 2.8 秒的載入上限。
// 布幕開演（playing）或放棄（屬性移除）就放行；首屏遮罩 5.5 秒會自己撤，
// 這裡用同一個時間保底，避免布幕元件沒掛上時影片永遠不載。
function waitForEntrance(run: () => void) {
  entranceWaited = true
  const release = () => {
    entranceWatch?.disconnect()
    clearTimeout(entranceTimer)
    run()
  }
  entranceWatch = new MutationObserver(() => {
    if (document.documentElement.dataset.ivyEntrance !== 'pending') release()
  })
  entranceWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ivy-entrance'] })
  entranceTimer = setTimeout(release, 5500)
}

useHomeReveal({ root: rootEl, track: trackEl, hero: sectionEl, copy: copyEl, image: imageEl, media: mediaEl, actions: actionsEl })

// 預覽用（2026-09-23 比稿）：?copy=a|b|c|d 換首屏標語與副文案，定案後移除。
// 標語用字已對過 lineseed-bd 子集，全數在內。
type HeroText = Pick<HeroContent, 'titleParts' | 'copyLines'>
const copyDrafts: Record<string, HeroText> = {
  a: {
    titleParts: { before: '每一個為什麼', punctAfterBefore: '，', middle: '都值得', growingWord: '好好回答', punctAfterGrowingWord: '。' },
    copyLines: ['在遊戲、繪本與戶外觀察裡，孩子不停發問；', '老師細心聽、適時引導，陪他們動手找答案。']
  },
  b: {
    titleParts: { before: '在常春藤', punctAfterBefore: '，', middle: '每天都', growingWord: '想來上學', punctAfterGrowingWord: '。' },
    copyLines: ['早晨問候、繪本歌謠、點心和遊戲時間，', '在熟悉的節奏裡，孩子慢慢喜歡上這裡。']
  },
  c: {
    titleParts: { before: '第一次離開家', punctAfterBefore: '，', middle: '有我們', growingWord: '好好陪著', punctAfterGrowingWord: '。' },
    copyLines: ['老師細心觀察，尊重每個孩子不同的步調，', '陪他們學會照顧自己，也懂得關心別人。']
  },
  d: {
    titleParts: { before: '世界那麼大', punctAfterBefore: '，', middle: '先從', growingWord: '這裡玩起', punctAfterGrowingWord: '。' },
    copyLines: ['讀繪本、做藝術、到戶外觀察，', '孩子用自己的方式，一點一點認識世界。']
  }
}
const route = useRoute()
const heroText = computed<HeroText>(() => copyDrafts[String(route.query.copy)] ?? props.hero)
let wantsPlayback = false
let onScreen = true
let reduceQuery: MediaQueryList | null = null
let watcher: IntersectionObserver | null = null

// isPlaying 直接由這裡的決策設定，不能只靠 video 的 @playing／@pause
// 事件同步——IntersectionObserver 在快速捲動時會連續觸發
// applyPlayback()，多個 play()/pause() 疊在一起時，事件觸發的先後順
// 序不保證跟真正的播放狀態一致（DayExperience.vue 的背景影片實測過
// 「畫面顯示暫停鍵、但影片其實已經真的停格」的假活著狀態，這裡是同一
// 個播放/暫停按鈕，用同一套防呆）。
function applyPlayback() {
  const video = videoEl.value
  if (!video) return
  if (document.hidden || !onScreen || !wantsPlayback) {
    video.pause()
    isPlaying.value = false
    return
  }
  video
    .play()
    .then(() => {
      const stillWanted = wantsPlayback && onScreen && !document.hidden
      if (!stillWanted) video.pause()
      isPlaying.value = stillWanted
    })
    .catch(() => {
      isPlaying.value = false
    })
}

function togglePlay() {
  const video = videoEl.value
  if (!video) return
  wantsPlayback = video.paused
  applyPlayback()
}

function onVideoError() {
  wantsPlayback = false
  showVideo.value = false
  videoFailed.value = true
}

// 分頁切到背景時暫停，切回來若使用者原本要看就恢復播放——不是單純
// pause 完就不管，避免使用者切回分頁時影片停在暫停畫面卻沒發現。
function onVisibilityChange() {
  applyPlayback()
}

// 使用者中途在系統設定切換「減少動態」，要立刻反映，不是只在掛載當下
// 判斷一次就定生死。
function onReduceMotionChange() {
  if (!reduceQuery?.matches) return
  wantsPlayback = false
  applyPlayback()
}

onMounted(() => {
  reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  const connection = (navigator as Navigator & { connection?: ConnectionInfo }).connection
  if (!mayAutoplay(reduceQuery.matches, connection)) return
  wantsPlayback = true
  const startVideo = () => {
    if (disposed) return
    if (!entranceWaited && document.documentElement.dataset.ivyEntrance === 'pending') return waitForEntrance(startVideo)
    // 素材與裁切位置依寬度（後台的手機影片可能是直式）；編碼版本依布幕同一個手機定義，
    // 橫拿手機（高度 ≤500）也拿手機檔，不下載桌機母帶。
    const narrow = window.matchMedia('(max-width: 760px)').matches
    const compact = window.matchMedia(COMPACT_ENTRANCE_MEDIA).matches
    isMobileVideo.value = narrow
    videoSrc.value = backgroundVideoSrc(narrow && props.hero.heroVideoSrcMobile ? props.hero.heroVideoSrcMobile : props.hero.heroVideoSrc, compact)
    showVideo.value = true
    nextTick(() => {
      if (disposed) return
      playbackFrame = requestAnimationFrame(applyPlayback)
    })
  }
  // 封面完成後再啟動影片，避免首屏圖片與 mp4 搶頻寬。手機再多等整頁
  // load 與一段閒置：4G 實測 mp4 會在 LCP 前就開始下載，跟 hydration
  // chunk 與下方 lazy 圖搶頻寬（見 perf-auditor 2026-09-22 盤點）。
  const beginVideo = () => {
    if (disposed) return
    if (!window.matchMedia(COMPACT_ENTRANCE_MEDIA).matches) return startVideo()
    const idle = () => {
      if (disposed) return
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(startVideo, { timeout: 2500 })
      else window.setTimeout(startVideo, 1200)
    }
    if (document.readyState === 'complete') idle()
    else window.addEventListener('load', idle, { once: true })
  }
  if (heroImgEl.value?.complete) beginVideo()
  else if (heroImgEl.value) {
    const image = heroImgEl.value
    image.addEventListener('load', beginVideo, { once: true })
    image.addEventListener('error', beginVideo, { once: true })
    removeImageListener = () => {
      image.removeEventListener('load', beginVideo)
      image.removeEventListener('error', beginVideo)
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  reduceQuery.addEventListener('change', onReduceMotionChange)

  // 首屏轉場（見 useHomeReveal）捲走或黏住時，影片可能已經不在畫面
  // 上，此時暫停；同一支 IntersectionObserver 也涵蓋一般往下捲離開
  // 首屏的情況，不用另外接 useHomeReveal 的 callback。
  if (sectionEl.value) {
    watcher = new IntersectionObserver(
      (entries) => {
        onScreen = entries[0]?.isIntersecting ?? true
        applyPlayback()
      },
      { threshold: 0 }
    )
    watcher.observe(sectionEl.value)
  }
})

onUnmounted(() => {
  disposed = true
  cancelAnimationFrame(playbackFrame)
  removeImageListener?.()
  entranceWatch?.disconnect()
  clearTimeout(entranceTimer)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  reduceQuery?.removeEventListener('change', onReduceMotionChange)
  watcher?.disconnect()
  const video = videoEl.value
  if (video) {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
})
</script>

<template>
  <div ref="rootEl" class="home-reveal">
    <div ref="trackEl" class="home-reveal-track">
      <section ref="sectionEl" class="studio-hero" aria-labelledby="home-title">
        <div class="container studio-hero-grid">
          <!-- 2026-09-30 首屏改版（design/hero-brush-mockup-20260930）：拿掉小標與「找校區」，
               重點詞的黃色底線換成金色乾刷色塊（字與色塊一起歪 -2°）。 -->
          <div ref="copyEl" class="studio-hero-copy">
            <h1 id="home-title">
              {{ heroText.titleParts.before }}<span v-if="heroText.titleParts.punctAfterBefore" class="punct">{{ heroText.titleParts.punctAfterBefore }}</span><br>
              {{ heroText.titleParts.middle }}<span class="hero-title-ending">
                <span class="hero-key">
                  <svg class="hero-swatch" viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
                    <defs>
                      <filter id="hero-brush" x="-6%" y="-24%" width="112%" height="148%">
                        <feTurbulence type="fractalNoise" baseFrequency="0.02 0.45" numOctaves="3" seed="11" result="n" />
                        <feDisplacementMap in="SourceGraphic" in2="n" scale="10" xChannelSelector="R" yChannelSelector="G" />
                      </filter>
                    </defs>
                    <g filter="url(#hero-brush)">
                      <path d="M8 26C42 16 94 14 150 13C198 12 240 9 282 12C286 34 287 62 283 88C242 92 196 90 150 91C100 92 54 95 12 91C4 72 3 48 8 26Z" />
                      <path d="M270 13L297 16L296 25L272 25Z" />
                      <path d="M274 31L300 33L299 42L276 41Z" />
                      <path d="M276 49L294 50L293 58L277 58Z" />
                      <path d="M272 64L299 66L298 75L274 74Z" />
                      <path d="M268 80L290 81L289 89L270 90Z" />
                    </g>
                  </svg>
                  <span class="hero-key-text">{{ heroText.titleParts.growingWord }}</span>
                </span><span v-if="heroText.titleParts.punctAfterGrowingWord" class="punct">{{ heroText.titleParts.punctAfterGrowingWord }}</span>
              </span>
            </h1>
            <p>
              <span v-for="line in heroText.copyLines" :key="line" class="hero-copy-line">{{ line }}</span>
            </p>
            <!-- useHomeReveal 需要這個容器（揭幕時設 inert）；「找校區」2026-09-30 拿掉後留空。 -->
            <div ref="actionsEl" class="studio-actions" />
          </div>
          <figure ref="imageEl" class="studio-hero-image">
            <img
              ref="heroImgEl"
              v-bind="heroImage.attrs"
              :alt="heroImage.alt"
              :style="heroImage.position ? { objectPosition: heroImage.position } : undefined"
              loading="eager"
              fetchpriority="high"
            >
            <video
              v-if="showVideo"
              id="hero-video"
              ref="videoEl"
              :src="videoSrc"
              :style="videoPosition ? { objectPosition: videoPosition } : undefined"
              muted
              loop
              playsinline
              preload="none"
              aria-hidden="true"
              @error="onVideoError"
            />
          </figure>
        </div>
        <div ref="mediaEl" class="container studio-media">
          <div id="video-controls" :hidden="!showVideo">
            <button type="button" id="video-play" aria-controls="hero-video" @click="togglePlay">
              <svg class="icon" aria-hidden="true"><use :href="isPlaying ? '#i-pause' : '#i-play'" /></svg>
              <span class="sr-only">{{ isPlaying ? '暫停影片' : '播放影片' }}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
    <slot />
  </div>
</template>

<style scoped>
/* 「找校區」2026-09-30 拿掉，.studio-actions 只剩空容器（useHomeReveal 依賴它），不佔高度。 */
.studio-actions{display:none}
</style>
