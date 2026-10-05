<script setup lang="ts">
import type { Campus } from '~/types/site-content'
import { ANNI_MEDIA } from '~/utils/anniversary/media'
import { ANNI_MILESTONES, ANNI_YEARS, anniversaryYearMeta, campusCountAt, milestoneOf } from '~/utils/anniversary/timeline'
import { campusMapUrl } from '~/utils/site-links'
import { ANNI_ARTWORKS } from '~/utils/anniversary/gallery'
import { responsiveImage } from '~/utils/responsive-image'
import type { CrayonPad } from '~/utils/anniversary/crayonPad'

// 30 週年分頁：開場影片 → 首屏海報 → 1997–2027 時間軸（旁邊的高雄地圖跟著長）→ 線畫成 30、校徽印進 0
// → 30 支蠟筆蠟燭 → 作品拼成的 30 → 換你畫一個 30。
// 伺服器端先輸出完整可讀的內容；蠟筆線、紙偶、立體卡片、地圖動畫、蠟燭、拼圖、畫板都在 onMounted 之後才載入。
const props = defineProps<{ campuses: Campus[] }>()

const campusOf = (key: string) => props.campuses.find((c) => c.key === key)
const rows = computed(() => ANNI_YEARS.map((year) => {
  const m = milestoneOf(year)
  return { year, milestone: m, campus: m ? campusOf(m.key) : undefined }
}))
const campusNames = computed(() => ANNI_MILESTONES.map((m) => campusOf(m.key)?.name.replace('校', '') ?? '').filter(Boolean).join('、'))
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`
const photoOf = (c: Campus | undefined) => (c ? responsiveImage(c.image, '(max-width: 760px) 92vw, 520px') : undefined)
const artThumbs = ANNI_ARTWORKS.map((a) => ({ ...a, img: responsiveImage(a.image, '(max-width: 760px) 22vw, 120px') }))

// ── 計數器：時間軸告訴我們現在走到哪一年 ──
const year = ref(ANNI_YEARS[0]!)
const yearDigits = computed(() => String(year.value).split(''))
const yearMeta = computed(() => anniversaryYearMeta(year.value))
const campusCount = computed(() => campusCountAt(year.value))

// ── 卡片翻面看校舍照片 ──
const flipped = ref<Record<string, boolean>>({})
const toggleFlip = (key: string) => { flipped.value = { ...flipped.value, [key]: !flipped.value[key] } }

// ── 作品拼圖與燈箱 ──
const artActive = ref(-1)
const lightbox = ref<HTMLDialogElement | null>(null)
const lightboxIndex = ref(0)
const openArt = (i: number) => {
  lightboxIndex.value = i
  lightbox.value?.showModal()
}

// ── 畫板 ──
const PAD_COLORS = [
  { key: 'green', label: '深綠', css: 'var(--green)' },
  { key: 'leaf', label: '草綠', css: 'rgb(var(--ivy-paint-leaf-rgb))' },
  { key: 'sun', label: '暖黃', css: 'rgb(var(--ivy-paint-sun-rgb))' },
  { key: 'orange', label: '橘色', css: 'rgb(var(--ivy-paint-orange-rgb))' },
  { key: 'sky', label: '天藍', css: 'rgb(var(--ivy-paint-sky-rgb))' },
  { key: 'mint', label: '薄荷', css: 'rgb(var(--ivy-paint-mint-rgb))' }
] as const
const padColor = ref<string>(PAD_COLORS[0].key)
const padGuide = ref(true)
const padReady = ref(false)
const padSaved = ref('')
const padStrokes = ref(0)
const padReplaying = ref(false)
const padShare = ref<File | null>(null)

// ── 元素 ──
const root = ref<HTMLElement | null>(null)
const printImg = ref<HTMLImageElement | null>(null)
const intro = ref<{ replay: () => void } | null>(null)
const heroTitle = ref<HTMLElement | null>(null)
const track = ref<HTMLElement | null>(null)
const mapCard = ref<{ setYear: (y: number) => void } | null>(null)
const mosaicCanvas = ref<HTMLCanvasElement | null>(null)
const padCanvas = ref<HTMLCanvasElement | null>(null)

let cleanups: Array<() => void> = []
let pad: CrayonPad | null = null

const selectColor = (key: string) => {
  padColor.value = key
  const c = PAD_COLORS.find((p) => p.key === key)
  if (c && pad) pad.setColor(c.css)
}
const toggleGuide = () => { padGuide.value = !padGuide.value; pad?.setGuide(padGuide.value) }
const clearPad = () => { pad?.clear(); padSaved.value = ''; padShare.value = null }
const undoPad = () => { if (pad?.undo()) { padSaved.value = ''; padShare.value = null } }
const replayPad = async () => {
  if (!pad || padReplaying.value) return
  padReplaying.value = true
  await pad.replay()
  padReplaying.value = false
}
const PAD_FILE = '常春藤30週年-我畫的30.png'
const savePad = async () => {
  if (!pad) return
  padSaved.value = ''
  padShare.value = null
  padSaved.value = await pad.save()
  // 手機上可以直接分享到 LINE 之類的 App（系統分享面板）；不支援就只給下載連結
  const blob = await pad.saveBlob()
  if (blob && typeof File !== 'undefined') {
    const file = new File([blob], PAD_FILE, { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) padShare.value = file
  }
}
const sharePad = async () => {
  if (!padShare.value) return
  try { await navigator.share({ files: [padShare.value], title: '常春藤 30 週年', text: '我畫的 30' }) } catch { /* 使用者取消分享 */ }
}
const onPadKey = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undoPad() }
}
const replayIntro = () => intro.value?.replay()
const introDone = () => heroTitle.value?.focus({ preventScroll: true })

onMounted(async () => {
  if (!root.value) return
  root.value.classList.add('is-live')
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  // 時間軸：進到視窗附近才載入（紙偶、蠟筆線、立體卡片、校徽）
  const lazy = (el: HTMLElement | null, load: () => Promise<() => void>) => {
    if (!el) return
    const io = new IntersectionObserver(async (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      try { cleanups.push(await load()) } catch (e) { console.error(e) }
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    cleanups.push(() => io.disconnect())
  }
  lazy(track.value, async () => {
    const { mountTrack } = await import('~/utils/anniversary/track')
    return mountTrack(track.value!, { reduce, onYear: (y) => { year.value = y }, onProgress: (y) => mapCard.value?.setYear(y) })
  })
  lazy(mosaicCanvas.value, async () => {
    const { mountMosaic } = await import('~/utils/anniversary/mosaic')
    return mountMosaic(mosaicCanvas.value!, { reduce, onHover: (i) => { artActive.value = i }, onPick: openArt, active: () => artActive.value })
  })
  lazy(padCanvas.value, async () => {
    const { mountCrayonPad } = await import('~/utils/anniversary/crayonPad')
    const p = await mountCrayonPad(padCanvas.value!, { color: PAD_COLORS[0].css, guide: padGuide.value, onStrokes: (n) => { padStrokes.value = n } })
    if (!p) return () => {}
    pad = p
    padReady.value = true
    return () => { p.destroy(); pad = null }
  })
})
onBeforeUnmount(() => { cleanups.forEach((fn) => fn()); cleanups = [] })
</script>

<template>
  <main id="main" ref="root" tabindex="-1" class="anni" data-cta-entry="anniversary" :style="{ '--anni-paper-tile': `url(${ANNI_MEDIA.paper})` }">
    <AnniversaryIntro ref="intro" :target="() => printImg" @done="introDone" />

    <!-- 首屏：開場影片最後一格變成右邊這張海報 -->
    <section class="anni-hero" aria-labelledby="anni-title">
      <div class="container anni-hero-grid">
        <div class="anni-hero-copy">
          <h1 id="anni-title" ref="heroTitle" tabindex="-1">常春藤 30 週年</h1>
          <p class="anni-hero-years"><span>1997</span><span class="anni-hero-dash" aria-hidden="true" /><span>2027</span></p>
          <p class="anni-hero-lead">1997 年，第一間常春藤在高雄三民區義華路成立，到 2027 年滿 30 年。現在高雄有五所常春藤：{{ campusNames }}。</p>
          <div class="anni-hero-actions">
            <button type="button" class="button primary" @click="replayIntro">重看開場影片</button>
            <NuxtLink class="button outline" to="/visit">預約參觀</NuxtLink>
          </div>
        </div>
        <figure class="anni-print">
          <span class="anni-tape" aria-hidden="true" />
          <picture>
            <source media="(max-aspect-ratio: 4/5)" :srcset="ANNI_MEDIA.posterMobile" width="900" height="1600">
            <img
              ref="printImg"
              :src="ANNI_MEDIA.posterDesktop"
              width="1600"
              height="900"
              alt="紙上用綠色蠟筆畫出的大大的 30，旁邊貼著五所校園的水彩卡片，0 的中間印著 30 週年校徽"
              fetchpriority="high"
            >
          </picture>
        </figure>
      </div>
    </section>

    <!-- 時間軸：往下捲，蠟筆線跟著畫，五校在成立那一年立起來，旁邊的地圖跟著長 -->
    <section id="anni-line" class="anni-line" aria-labelledby="anni-line-title">
      <div class="container anni-line-head">
        <h2 id="anni-line-title">1997 到 2027</h2>
      </div>
      <!-- 地圖的靜態線條（約 18KB 路徑）掛上之後才輸出：地圖都在首屏以下，HTML 不必帶著它 -->
      <ClientOnly><AnniversaryMapSprite /></ClientOnly>
      <div class="container anni-overview">
        <AnniversaryMap :campuses="campuses" variant="overview" />
      </div>
      <div ref="track" class="container anni-track">
        <div class="anni-rail" aria-hidden="true">
          <canvas class="anni-ink" />
          <canvas class="anni-kids" />
        </div>
        <div class="anni-mapcard" role="group" aria-label="時間軸走到的年份與高雄地圖">
          <div class="anni-counter" aria-hidden="true">
            <div class="anni-flap">
              <span v-for="(d, i) in yearDigits" :key="`${i}-${d}`" class="anni-flap-digit">{{ d }}</span>
            </div>
            <p class="anni-counter-meta"><span>{{ yearMeta.prefix }} <b>{{ yearMeta.n }}</b> 年</span><span><b>{{ campusCount }}</b> 所校園</span></p>
          </div>
          <AnniversaryMap ref="mapCard" :campuses="campuses" variant="card" />
        </div>
        <ol class="anni-years">
          <li v-for="row in rows" :key="row.year" :class="{ 'is-campus': row.milestone }" :data-year="row.year">
            <span class="anni-year">{{ row.year }}</span>
            <article v-if="row.milestone && row.campus" :id="`anni-campus-${row.milestone.key}`" class="anni-campus" :data-campus="row.milestone.key">
              <div class="anni-campus-in">
                <div class="anni-card" data-state="flat" :class="{ 'is-flipped': flipped[row.milestone.key] }">
                  <div class="anni-card-turn">
                    <div class="anni-card-face">
                      <img
                        class="anni-card-still"
                        :src="`/assets/campus-line-art-${row.milestone.key}-colour.webp`"
                        width="768"
                        height="512"
                        alt=""
                        loading="lazy"
                      >
                      <canvas class="anni-card-canvas" />
                    </div>
                    <div class="anni-card-back">
                      <img
                        :src="photoOf(row.campus)!.src"
                        :srcset="photoOf(row.campus)!.srcset"
                        :sizes="photoOf(row.campus)!.sizes"
                        :alt="`${row.campus.name}校舍外觀`"
                        loading="lazy"
                      >
                    </div>
                  </div>
                  <span class="anni-card-shadow" aria-hidden="true" />
                </div>
                <div class="anni-campus-text">
                  <p class="anni-campus-year">{{ row.year }}<span>民國 {{ row.milestone.roc }} 年</span></p>
                  <h3>{{ row.campus.name }}</h3>
                  <p class="anni-campus-history">{{ row.milestone.history }}</p>
                  <dl class="anni-campus-info">
                    <dt>地址</dt>
                    <dd>
                      {{ row.campus.address }}
                      <a class="anni-maplink" :href="campusMapUrl(row.campus)" target="_blank" rel="noopener noreferrer">地圖 ↗<span class="sr-only">（{{ row.campus.name }}，另開新視窗）</span></a>
                    </dd>
                    <dt>電話</dt><dd><a :href="telHref(row.campus.phone)">{{ row.campus.phone }}</a></dd>
                  </dl>
                  <div class="anni-campus-actions">
                    <button type="button" class="text-link" :aria-pressed="Boolean(flipped[row.milestone.key])" @click="toggleFlip(row.milestone.key)">
                      {{ flipped[row.milestone.key] ? '看水彩畫' : '看校舍照片' }}
                    </button>
                    <BookingCta :campus-key="row.milestone.key" button-class="button primary anni-book" />
                  </div>
                </div>
              </div>
            </article>
          </li>
        </ol>
      </div>
      <!-- 結尾：線接進來畫出 30，孩子跳進 0 的中間，校徽印上去（呼應開場影片的最後一格） -->
      <div class="anni-finale" role="group" aria-label="2027 年，滿 30 年">
        <div class="anni-finale-stage">
          <div class="container anni-finale-box">
            <canvas class="anni-finale-ink" aria-hidden="true" />
            <div class="anni-crest-art">
              <img src="/assets/ivy-30th-anniversary-projection.webp" width="1254" height="1254" alt="常春藤 30 週年校徽：皇冠、星星、月桂、手牽手的兩個孩子與 30th Anniversary 緞帶" loading="lazy">
              <canvas class="anni-crest-canvas" aria-hidden="true" />
            </div>
            <canvas class="anni-finale-kids" aria-hidden="true" />
            <p class="anni-crest-caption"><b>2027 年，滿 30 年。</b>從義華的第一間，到現在高雄的五所校園。</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 幫常春藤吹蠟燭：30 支蠟筆蠟燭 -->
    <AnniversaryCake :colors="PAD_COLORS.map((c) => c.css)" />

    <!-- 作品拼成的 30 -->
    <section class="anni-art" aria-labelledby="anni-art-title">
      <div class="container anni-art-grid">
        <div class="anni-art-copy">
          <h2 id="anni-art-title">孩子的作品拼成的 30</h2>
          <ul class="anni-art-list">
            <li v-for="(a, i) in artThumbs" :key="a.image">
              <button
                type="button"
                :class="{ 'is-active': artActive === i }"
                :aria-label="`看作品：${a.label}，${a.alt}`"
                @pointerenter="artActive = i"
                @pointerleave="artActive = -1"
                @focus="artActive = i"
                @blur="artActive = -1"
                @click="openArt(i)"
              >
                <img :src="a.img.src" :srcset="a.img.srcset" :sizes="a.img.sizes" alt="" loading="lazy">
                <span>{{ a.label }}</span>
              </button>
            </li>
          </ul>
        </div>
        <div class="anni-mosaic">
          <canvas ref="mosaicCanvas" aria-hidden="true" />
        </div>
      </div>
      <dialog ref="lightbox" class="anni-lightbox" :aria-label="artThumbs[lightboxIndex]?.label">
        <form method="dialog">
          <img
            :src="responsiveImage(artThumbs[lightboxIndex]!.image).src"
            :srcset="responsiveImage(artThumbs[lightboxIndex]!.image).srcset"
            sizes="(max-width: 760px) 92vw, 70vh"
            :alt="artThumbs[lightboxIndex]!.alt"
          >
          <p><b>{{ artThumbs[lightboxIndex]!.label }}</b>{{ artThumbs[lightboxIndex]!.alt }}</p>
          <button class="button outline" type="submit">關閉</button>
        </form>
      </dialog>
    </section>

    <!-- 換你畫一個 30 -->
    <section class="anni-draw" aria-labelledby="anni-draw-title" @keydown="onPadKey">
      <div class="container anni-draw-grid">
        <div class="anni-draw-copy">
          <h2 id="anni-draw-title">換你畫一個 30</h2>
          <div class="anni-crayons" role="radiogroup" aria-label="蠟筆顏色">
            <button
              v-for="c in PAD_COLORS"
              :key="c.key"
              type="button"
              role="radio"
              class="anni-crayon"
              :aria-checked="padColor === c.key"
              :aria-label="c.label"
              :style="{ '--crayon': c.css }"
              :disabled="!padReady"
              @click="selectColor(c.key)"
            >
              <span class="anni-crayon-tip" aria-hidden="true" /><span class="anni-crayon-body" aria-hidden="true" />
            </button>
          </div>
          <div class="anni-draw-tools">
            <button type="button" class="button outline" :disabled="!padReady || !padStrokes || padReplaying" aria-keyshortcuts="Control+Z Meta+Z" @click="undoPad">
              <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-u-up-left" /></svg>復原
            </button>
            <button type="button" class="button outline" :disabled="!padReady || !padStrokes || padReplaying" @click="replayPad">
              <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-play" /></svg>{{ padReplaying ? '重播中' : '重播' }}
            </button>
            <button type="button" class="button outline" :aria-pressed="padGuide" :disabled="!padReady" @click="toggleGuide">照虛線描</button>
            <button type="button" class="button outline" :disabled="!padReady || padReplaying" @click="clearPad">擦掉重畫</button>
          </div>
          <div class="anni-draw-tools">
            <button type="button" class="button primary" :disabled="!padReady || padReplaying" @click="savePad">存成圖片</button>
            <AnniversarySoundToggle />
          </div>
          <p class="anni-draw-note" aria-live="polite">
            <template v-if="padSaved">
              <a :href="padSaved" :download="PAD_FILE">圖片好了，點這裡下載</a>
              <button v-if="padShare" type="button" class="anni-draw-share" @click="sharePad">分享給家人</button>
            </template>
          </p>
        </div>
        <div class="anni-pad">
          <canvas ref="padCanvas" class="anni-pad-canvas" role="img" aria-label="畫紙：用滑鼠或手指拖曳就能畫" />
        </div>
      </div>
    </section>

    <section class="anni-visit" aria-labelledby="anni-visit-title">
      <div class="container anni-visit-inner">
        <h2 id="anni-visit-title">帶孩子來學校看看</h2>
        <p>想看看孩子每天在哪裡上學，可以預約到校參觀。</p>
        <NuxtLink class="button yellow" to="/visit">預約參觀</NuxtLink>
      </div>
    </section>
  </main>
</template>

<style scoped src="../assets/css/anniversary.css"></style>
