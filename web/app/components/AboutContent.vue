<script setup lang="ts">
// 關於常春藤頁主體（/about）。
// 2026-11-11 整頁重做「紅磚上的常春藤」（使用者：「全新方向重做」，不滿意的是質感不夠專業、內容說服力不夠、
// 動效與互動沒有記憶點）。顏色取自五校的紅磚校舍與手繪線稿：米白紙底、常春藤深綠、磚紅、暖黃。
// - 首屏：特大標題在上、介紹在右下，底下一張寬幅照片；再一排章節索引（章名只出現在這裡）。
// - 一路走來：左邊一組特大的年份像里程表一樣滾（1997 → … → 今年），一路跟著捲動；右邊一校一站，
//   手繪線稿（捲到才畫出來、上色）＋年份校名＋沿革＋地址電話；
//   整章收在今年：特大的今年年份（從最後一校那年滾過來）、紀念章、五張線稿排滿一整排。
//   1000 以下年份里程表是貼在頁首底下的一條。
//   2026-11-12 使用者看過後：每一站不放校園場景照（「只要學校就好 不用校園特色」）、結尾兩個連結
//   （看五校的校園環境、看常春藤 30 週年）先拿掉；左邊改成只有年份跟著捲動（原本整個章頭一起釘住，
//   視窗矮的時候釘不住、左邊整片空白）。
// - 全人教育：六張實拍排成一排，選到的那張展開、底下換那一段說明；760 以下是左右滑的六張卡片。
// - 我們的期許：整塊深綠，創辦人照片放大，引言隨捲動一句一句亮起來。
// - 家長怎麼說：第一位家長放大（影片在左、那句話放大在右），其餘排一列；點了原地播。
//   2026-11-12 使用者：「不要特別寫義華校」——只有一校有影片時，介紹、連結、每一位底下都不寫校名；
//   之後兩校以上有影片才標校名（分得出是哪一校的家長、哪一校的頻道）。
// - 結尾：其他頁面一列一頁，配一張照片。
// 不變的：四章順序與 id、文字照片欄位（後台「關於常春藤頁」about_page，預設＝fixture 的 aboutPage）、分校資料與各校
// 家長影片、頁面內容不放預約參觀（09-28 裁定）、沒有 JS／減少動態時所有內容直接看得到。
// 拿掉的：六圈（AboutWholePerson）、蠟筆屋（AboutCrayon）、章節編號 01–04 與每章上方的眉標。
// 例外：家長章標題寫在這裡（使用者 10-30 指定，取自函函奶奶那支影片的話），不取第一位家長的原話。
// 沿革源自機構站「關於常春藤」：舊站「三十多個春夏秋冬」不對（1997 到今年未滿三十年）；首屏介紹與第一章標題的年數
// 2026-10-31 起由今年算（utils/about-content.ts 的 aboutHeroLede、storyYearTitle），沿革最後接 30 週年頁（後台開關打開時）。
// 崇德同年的 ESL 美語部不寫；義華創校年份 1997（業主 2026-10-03 裁定）。第三章內建照片裡的長輩是創辦人（姓名未提供，不寫名字）。
// 分校停用或下架時，那一年仍留在沿革裡，只是不放線稿、校名與聯絡方式。
import type { AboutPageContent, Campus, CampusTestimonial } from '~/types/site-content'
import { aboutHeroAttrs, lineArtBlends, lineArtInkImage, mediaImageAttrs } from '~/utils/media-image'
import { pagePhotoAlt, pagePhotoAttrs, pageTitleLines, rocYear, withPhotoStyle } from '~/utils/page-content'
import { responsiveImage } from '~/utils/responsive-image'
import { youtubeEmbed } from '~/utils/filmCarousel'
import { pickVoices } from '~/utils/testimonials'
import { foundingYear } from '~/utils/seo'
import { taipeiIsoDate } from '~/utils/taipei-date'
import {
  DOMAINS, HERO_ALT, HOPE_ALT, HOPE_CAPTION, LITERACIES, STORY_TITLE_ORIGINAL,
  aboutHeroLede, quotePhrases, storyYearTitle, yearsRunning
} from '~/utils/about-content'

// anniversary：後台「全站設定」的 30 週年開關。沿革結尾原本有「看常春藤 30 週年」跟著它（關掉時不連過去），
// 2026-11-12 使用者說先拿掉；這個 prop 留著（兩個頁面照舊傳），連結加回來時直接用。
// admission：同一頁的入學資訊分頁開關（隱藏時 /admission 回 404，結尾不放入學資訊）
const props = withDefaults(defineProps<{ campuses: Campus[]; page: AboutPageContent; anniversary?: boolean; admission?: boolean }>(), { anniversary: false, admission: true })

// 年數由今年（台北）算：SSR 與瀏覽器各算一次，只有跨年那一刻才可能不同
const thisYear = Number.parseInt(taipeiIsoDate(), 10)
const founded = computed(() => foundingYear({ aboutPage: props.page }))
const heroLede = computed(() => aboutHeroLede(props.page.heroLede, thisYear))
const storyTitle = computed(() => props.page.storyTitle === STORY_TITLE_ORIGINAL
  ? storyYearTitle(founded.value, thisYear)
  : pageTitleLines(props.page.storyTitle))

// 沿革：一校一站（年份可在後台改，民國年＝西元 − 1911）。線稿是首頁五校用的那一套：透明底墨線 `-ink` 墊一張淡彩
// `-wash`；後台換過線稿的校（lineArtMedia）沒有透明底的版本，照首頁的做法用 filter＋multiply 融掉紙底（is-blend）。
// 線稿：601 以上約佔右欄的六成（最寬約 430px）；600 以下佔六成寬
const SKETCH_SIZES = '(max-width: 600px) 58vw, (max-width: 1000px) 56vw, 430px'
const SKY_SIZES = '(max-width: 700px) 32vw, (max-width: 1400px) 19vw, 256px'
const milestones = computed(() => props.page.milestones.map((item, i) => {
  const campus = props.campuses.find((c) => c.key === item.key)
  const blend = !!campus && lineArtBlends(campus)
  return {
    ...item, roc: rocYear(item.year), nth: i + 1, campus, blend,
    ink: campus ? lineArtInkImage(campus, SKETCH_SIZES) : null,
    wash: campus && !blend ? responsiveImage(`campus-line-art-${item.key}-wash`, SKETCH_SIZES) : null,
    sky: campus ? lineArtInkImage(campus, SKY_SIZES) : null,
    skyWash: campus && !blend ? responsiveImage(`campus-line-art-${item.key}-wash`, SKY_SIZES) : null
  }
}))
const CAMPUS_COUNT = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const campusTotal = computed(() => milestones.value.filter((item) => item.campus).length)
const todayTitle = computed(() => `${CAMPUS_COUNT[campusTotal.value] ?? campusTotal.value}所校園`)

// 年份里程表：哪一站走過基準線就滾到那一年。
// 1001 以上是左邊跟著捲動的特大年份（.abh-meter，停在視窗中間），基準線在視窗六成高的地方
// （旁邊那一站的上緣走到數字旁邊就換）；1000 以下是貼在頁首底下的一條（.abh-strip），基準線就在那一條的下緣
// （同一般釘在頂端的小標：條上寫的就是緊接在它底下的那一校）。沒有 JS 時都不出現（每一站自己有寫年份）。
const active = ref(0)
const meter = computed(() => {
  const item = milestones.value[Math.min(active.value, milestones.value.length - 1)]
  return item ? { year: item.year, roc: item.roc, note: `第 ${item.nth} 所校園`, lit: item.nth } : { year: thisYear, roc: rocYear(thisYear), note: '', lit: 0 }
})
// 整章的結尾：今年。特大年份先停在最後一校那一年，捲進畫面時滾到今年（沒有 JS、減少動態時直接是今年）。
const finaleYear = ref(thisYear)
const lastYear = computed(() => milestones.value.at(-1)?.year ?? thisYear)

// 六大領域：一組原生 radio（預設第一項，鍵盤左右鍵換、沒有 JS 也能選），六段說明都在 HTML 裡，沒選到的由 about.css 收起。
// 滑鼠停在哪一張上面就選哪一張（停 120 毫秒才換，路過不算）；觸控是點。
const pickedDomain = ref(0)
// 展開的那張約佔一排的一半，其餘五張各約一成；760 以下是 78vw 的卡片
const DOMAIN_SIZES = '(max-width: 760px) 78vw, (max-width: 1300px) 50vw, 640px'
let hoverTimer = 0
function hoverDomain(index: number, event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  clearTimeout(hoverTimer)
  hoverTimer = window.setTimeout(() => { pickedDomain.value = index }, 120)
}
const leaveDomain = () => clearTimeout(hoverTimer)

// 家長怎麼說：各校的 testimonials（後台自訂，沒自訂的校用內建）五校輪流取，最多四位；沒有影片時整章不出現。
// 第一位放大（.is-lead），其餘排一列。
const voices = computed(() => pickVoices(props.campuses))
const voiceCampuses = computed(() => [...new Map(voices.value.map((v) => [v.campus.key, v.campus])).values()])
// 兩校以上有影片才標校名（只有一校時不特別寫是哪一校，2026-11-12）
const nameCampus = computed(() => voiceCampuses.value.length > 1)
const VOICES_TITLE = ['孩子的進步', '家長看得見']
// 封面：後台選的素材用它的 srcset 與焦點；內建靜態圖與 YouTube 縮圖只有網址（16:9 裁切）
const POSTER_SIZES = '(max-width: 760px) calc(100vw - 40px), 720px'
function posterAttrs(item: CampusTestimonial) {
  const image = item.posterMedia
  if (!image) return { src: item.poster, width: 800, height: 450 }
  return { ...mediaImageAttrs(image, POSTER_SIZES), width: 800, height: 450, ...(image.position ? { style: { objectPosition: image.position } } : {}) }
}
// 一次只播一支：按了哪一張就在那一張原地換成 youtube-nocookie，再按別張，前一張回到封面。
// 後台即時預覽（/preview）會在看著的時候刪影片：正在播的那支不在清單裡了就停。正式頁的 campuses 不會變。
const playingId = ref<string | null>(null)
watch(voices, (list) => {
  if (playingId.value && !list.some((item) => item.youtubeId === playingId.value)) playingId.value = null
})

// 首屏的章節索引（章名在後台）。小字由現有資料算（年份範圍、領域數、影片數）。
const CHAPTER_IDS = ['story', 'whole-child', 'hope', 'voices']
const chapters = computed(() => {
  const years = milestones.value.map((item) => item.year)
  const notes: Record<string, string> = {
    story: years.length ? `${Math.min(...years)} 到 ${thisYear}` : '',
    'whole-child': `${DOMAINS.length} 大領域`,
    hope: '第二個家',
    voices: `${voices.value.length} 位家長`
  }
  return CHAPTER_IDS
    .map((id, i) => ({ id, name: props.page.chapterNames[i]!, note: notes[id]! }))
    .filter((item) => item.id !== 'voices' || voices.value.length > 0)
})

// 結尾：接下來可以看（不放預約，預約入口只有頁首金色鈕）。11-12 使用者要求不放照片，只留頁名、一行說明與箭頭。
const NEXT = [
  { href: '/environment', title: '常春藤環境', hint: '照顧、餐點與五校空間' },
  { href: '/curriculum', title: '特色教學', hint: '四個年段與課程方向' },
  { href: '/admission', title: '入學資訊', hint: '入學流程、分班對照' }
]
const nextPages = computed(() => NEXT.filter((item) => props.admission || item.href !== '/admission'))

// 動態。跟著捲動位置走的（首屏照片、深綠裡的照片與引言）是 about.css 的捲動驅動動畫；這裡管兩件要 JS 的事：
// 1. 年份里程表：每一站走過基準線就換 active。觀察的範圍是「基準線以上的全部」（上緣往上延伸十萬 px），
//    所以一站只要上緣過了線就算在裡面，用錨點或鍵盤一次跳過好幾站，狀態也一定會變、一定會收到通知；
//    收到就整排重算（最後一個上緣已經過線的站）。視窗大小變了重設基準線。
//    減少動態時照樣換，只是數字不滾（AboutYear 自己處理）。
// 2. 進場：標了 data-rise／data-draw 的區塊捲進畫面時播一次（浮上來；線稿由左畫到右再上色）。播一次就停，
//    不跟著捲動位置走，不會停在半透明或畫一半。掛載時已經在畫面裡或上面的不動；只把還在畫面下面的先收起來
//    （屬性值改成 wait，進畫面改成 in），所以沒有 JS、減少動態時什麼都不會被藏起來。
const root = ref<HTMLElement | null>(null)
const live = ref(false)
let stopObserver: IntersectionObserver | null = null
let riseObserver: IntersectionObserver | null = null
let resizeTimer = 0
function watchStops() {
  stopObserver?.disconnect()
  if (!root.value) return
  const stops = [...root.value.querySelectorAll<HTMLElement>('.abh-tl > li')]
  const wide = matchMedia('(min-width: 1001px)').matches
  const line = wide ? Math.round(window.innerHeight * 0.6) : 150
  const update = () => {
    let at = 0
    stops.forEach((stop, i) => { if (stop.getBoundingClientRect().top < line) at = i })
    active.value = at
  }
  stopObserver = new IntersectionObserver(update, { rootMargin: `100000px 0px -${Math.max(0, window.innerHeight - line)}px 0px` })
  for (const stop of stops) stopObserver.observe(stop)
  update()
}
function onResize() {
  clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(watchStops, 200)
}
onMounted(() => {
  if (!('IntersectionObserver' in window) || !root.value) return
  live.value = true
  watchStops()
  window.addEventListener('resize', onResize)
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  riseObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const el = entry.target as HTMLElement
      if (el.dataset.rise === 'wait') el.dataset.rise = 'in'
      if (el.dataset.draw === 'wait') el.dataset.draw = 'in'
      if (el.classList.contains('abh-finale-year')) finaleYear.value = thisYear
      riseObserver?.unobserve(el)
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' })
  for (const el of root.value.querySelectorAll<HTMLElement>('[data-rise],[data-draw]')) {
    // 已經在畫面裡或上面的不動；在左右滑的一排裡、還在畫面右邊外面的也不動（不滑就永遠不會進畫面）
    const box = el.getBoundingClientRect()
    if (box.top < window.innerHeight || box.left >= window.innerWidth) continue
    if ('rise' in el.dataset) el.dataset.rise = 'wait'
    if ('draw' in el.dataset) el.dataset.draw = 'wait'
    if (el.classList.contains('abh-finale-year')) finaleYear.value = lastYear.value
    riseObserver.observe(el)
  }
})
onBeforeUnmount(() => {
  stopObserver?.disconnect()
  riseObserver?.disconnect()
  clearTimeout(hoverTimer)
  clearTimeout(resizeTimer)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <main id="main" ref="root" tabindex="-1" data-cta-entry="about" class="abh" :class="{ 'is-live': live }">
    <!-- 首屏：特大標題＋介紹，一張寬幅照片，一排章節索引 -->
    <section class="abh-hero" data-track-section="hero" aria-labelledby="about-title">
      <div class="abh-wrap abh-hero-top">
        <h1 id="about-title"><span v-for="(line, i) in pageTitleLines(page.heroTitle)" :key="i" class="abh-line" :style="{ '--i': i }"><span>{{ line }}</span></span></h1>
        <p class="abh-lede">{{ heroLede }}</p>
      </div>
      <figure class="abh-wrap abh-hero-photo">
        <div class="abh-hero-frame">
          <ResponsivePicture v-bind="withPhotoStyle(aboutHeroAttrs(page), page.heroPhoto)" :alt="pagePhotoAlt(HERO_ALT, page.heroPhoto, page.heroPhotoAlt)" loading="eager" fetchpriority="high" />
        </div>
        <figcaption v-if="page.heroCaption">{{ page.heroCaption }}</figcaption>
      </figure>
      <nav class="abh-wrap abh-index" aria-label="這一頁的章節">
        <a v-for="item in chapters" :key="item.id" :href="`#${item.id}`">
          <b>{{ item.name }}</b>
          <small v-if="item.note">{{ item.note }}</small>
          <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-down" /></svg>
        </a>
      </nav>
    </section>

    <!-- 一路走來：左邊章頭與年份里程表跟著捲動，右邊一校一站；整章收在今年 -->
    <section id="story" data-track-section="story" class="abh-story" aria-labelledby="story-title">
      <div class="abh-wrap abh-story-grid">
        <div class="abh-story-side">
          <h2 id="story-title"><template v-for="(line, i) in storyTitle" :key="i"><br v-if="i">{{ line }}</template></h2>
          <p class="abh-text">{{ page.storyText }}</p>
          <div class="abh-meter" aria-hidden="true">
            <AboutYear class="abh-meter-year" :value="meter.year" />
            <p class="abh-meter-note"><span>民國 {{ meter.roc }} 年</span><b>{{ meter.note }}</b></p>
            <p class="abh-meter-dots"><i v-for="item in milestones" :key="item.key" :class="{ 'is-on': item.nth <= meter.lit }" /></p>
          </div>
        </div>
        <div class="abh-story-main">
          <!-- 1000 以下的年份條：上面那塊空白擋住頁首膠囊後面捲過去的內容 -->
          <div class="abh-strip-mask" aria-hidden="true" />
          <div class="abh-strip" aria-hidden="true">
            <AboutYear class="abh-strip-year" :value="meter.year" />
            <b>{{ meter.note }}</b>
            <span class="abh-meter-dots"><i v-for="item in milestones" :key="item.key" :class="{ 'is-on': item.nth <= meter.lit }" /></span>
          </div>
          <ol class="abh-tl">
            <li v-for="item in milestones" :key="item.key" class="abh-stop">
              <figure v-if="item.campus && item.ink" class="abh-sketch" :class="{ 'is-blend': item.blend }" data-draw>
                <ResponsivePicture v-if="item.wash" class="abh-sketch-wash" v-bind="item.wash" alt="" loading="lazy" decoding="async" />
                <ResponsivePicture class="abh-sketch-ink" v-bind="item.ink" :alt="`${item.campus.name}校舍的手繪圖`" loading="lazy" decoding="async" />
              </figure>
              <div class="abh-stop-text">
                <p class="abh-year"><span lang="en">{{ item.year }}</span><small>民國 {{ item.roc }} 年</small></p>
                <h3 v-if="item.campus">{{ item.campus.name }}<span>{{ item.campus.district }}</span></h3>
                <p class="abh-stop-line">{{ item.text }}</p>
                <p v-if="item.campus" class="abh-contact">
                  <span><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-map-pin" /></svg>{{ item.campus.address }}</span>
                  <a :href="`tel:${item.campus.phone.replace(/[^0-9+]/g, '')}`"><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-phone" /></svg>{{ item.campus.phone }}</a>
                </p>
              </div>
            </li>
          </ol>
        </div>
      </div>
      <!-- 整章的結尾：今年。特大年份、紀念章、五張線稿排滿一整排 -->
      <div class="abh-wrap abh-finale">
        <div class="abh-finale-head">
          <div class="abh-finale-year" data-rise>
            <AboutYear class="abh-meter-year" :value="finaleYear" />
            <p class="abh-meter-note"><span>民國 {{ rocYear(thisYear) }} 年</span><b>{{ yearsRunning(founded, thisYear) }}</b></p>
          </div>
          <div class="abh-finale-text" data-rise>
            <span class="abh-medal" aria-hidden="true" />
            <h3>{{ todayTitle }}</h3>
          </div>
        </div>
        <ul class="abh-skyline" aria-hidden="true">
          <li v-for="item in milestones.filter((m) => m.campus && m.sky)" :key="item.key" :class="{ 'is-blend': item.blend }" data-rise>
            <span class="abh-sky-art">
              <ResponsivePicture v-if="item.skyWash" v-bind="item.skyWash" alt="" loading="lazy" decoding="async" />
              <ResponsivePicture v-bind="item.sky!" alt="" loading="lazy" decoding="async" />
            </span>
            <b>{{ item.campus!.name }}</b>
            <small>{{ item.year }} · {{ item.campus!.district }}</small>
          </li>
        </ul>
      </div>
    </section>

    <!-- 全人教育：六張實拍一排，選到的展開，底下是那一段說明 -->
    <section id="whole-child" data-track-section="whole-child" class="abh-whole" aria-labelledby="whole-title">
      <div class="abh-wrap">
        <div class="abh-head" data-rise>
          <h2 id="whole-title"><template v-for="(line, i) in pageTitleLines(page.wholeTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
          <p class="abh-text">{{ page.wholeText }}</p>
        </div>
        <fieldset class="abh-pick" data-rise>
          <legend class="sr-only">六大領域</legend>
          <div class="abh-slats">
            <div v-for="(item, i) in DOMAINS" :key="item.name" class="abh-slat" :style="{ '--focus': item.focus, '--zoom': item.zoom }">
              <label @pointerenter="hoverDomain(i, $event)" @pointerleave="leaveDomain">
                <input v-model="pickedDomain" class="sr-only" type="radio" name="abh-domain" :value="i">
                <ResponsivePicture v-bind="pagePhotoAttrs(item.photo, undefined, DOMAIN_SIZES)" :alt="item.alt" loading="lazy" decoding="async" />
                <span class="abh-slat-name">{{ item.name }}</span>
              </label>
              <div class="abh-panel">
                <p class="abh-panel-no" aria-hidden="true"><b>{{ i + 1 }}</b> / {{ DOMAINS.length }}</p>
                <h3>{{ item.name }}</h3>
                <p class="abh-panel-text">{{ item.detail }}</p>
              </div>
            </div>
          </div>
        </fieldset>
        <div class="abh-fine" data-rise>
          <p class="abh-fine-lead">{{ page.wholeFine }}</p>
          <div class="abh-fine-side">
            <p class="abh-lits"><b>六大核心素養</b><span v-for="name in LITERACIES" :key="name">{{ name }}</span></p>
            <p v-if="page.wholeFineSource" class="abh-fine-source">{{ page.wholeFineSource }}</p>
            <NuxtLink class="abh-link" to="/curriculum">看特色教學怎麼安排<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
          </div>
        </div>
      </div>
    </section>

    <!-- 我們的期許：整塊深綠，創辦人照片放大，引言一句一句亮起來 -->
    <section id="hope" data-track-section="hope" class="abh-hope" aria-labelledby="hope-title">
      <div class="abh-wrap abh-hope-grid">
        <figure class="abh-hope-photo" data-rise>
          <div class="abh-hope-frame">
            <ResponsivePicture v-bind="withPhotoStyle(pagePhotoAttrs('about-together', page.hopePhoto, '(max-width: 900px) calc(100vw - 40px), 700px'), page.hopePhoto)" :alt="pagePhotoAlt(HOPE_ALT, page.hopePhoto, page.hopePhotoAlt)" loading="lazy" decoding="async" />
          </div>
          <figcaption v-if="!page.hopePhoto">{{ HOPE_CAPTION }}</figcaption>
        </figure>
        <div class="abh-hope-text">
          <h2 id="hope-title" data-rise><template v-for="(line, i) in pageTitleLines(page.hopeTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
          <blockquote class="abh-quote">
            <p v-for="(quote, i) in page.hopeQuotes" :key="i"><span v-for="(phrase, j) in quotePhrases(quote)" :key="j" class="abh-lit">{{ phrase }}</span></p>
          </blockquote>
        </div>
      </div>
    </section>

    <!-- 家長怎麼說：第一位放大，其餘排一列；按播放才插 youtube-nocookie，沒有 JS 時是連到 YouTube -->
    <section v-if="voices.length" id="voices" data-track-section="voices" class="abh-voices" aria-labelledby="voices-title">
      <div class="abh-wrap">
        <div class="abh-voices-head" data-rise>
          <h2 id="voices-title"><template v-for="(line, i) in VOICES_TITLE" :key="i"><br v-if="i">{{ line }}</template></h2>
          <div class="abh-voices-note">
            <p class="abh-text"><template v-if="nameCampus">{{ voiceCampuses.map((c) => c.name).join('、') }}</template>家長在學校 YouTube 頻道上的分享。</p>
            <!-- 「分享 ↗」不拆行：分與享之間 word joiner（&#8288;）、箭頭前不斷行空格（2026-10-13：320 寬箭頭自己掉到下一行） -->
            <template v-for="campus in voiceCampuses" :key="campus.key">
              <a v-if="campus.youtube" class="abh-link is-yt" :href="campus.youtube" target="_blank" rel="noopener noreferrer">到<template v-if="nameCampus">{{ campus.name }}</template> YouTube 看更多分&#8288;享&nbsp;↗<span class="sr-only">（另開新視窗）</span></a>
            </template>
          </div>
        </div>
        <ol class="abh-voice-grid">
          <li v-for="(item, i) in voices" :key="`${item.campus.key}-${item.youtubeId}`" :class="{ 'is-lead': i === 0 }" data-rise>
            <figure class="abh-voice">
              <div class="abh-video">
                <iframe
                  v-if="playingId === item.youtubeId" :src="youtubeEmbed(item.youtubeId)" :title="`${item.speaker}的分享影片`"
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"
                />
                <a v-else class="abh-play" :href="`https://www.youtube.com/watch?v=${item.youtubeId}`" target="_blank" rel="noopener noreferrer" :aria-label="`播放${item.speaker}的分享影片（YouTube）`" @click.prevent="playingId = item.youtubeId">
                  <ResponsivePicture v-bind="posterAttrs(item)" :alt="item.posterAlt ?? ''" loading="lazy" decoding="async" />
                  <span class="abh-play-mark" aria-hidden="true"><svg class="icon" focusable="false"><use href="#i-play" /></svg></span>
                </a>
              </div>
              <figcaption>
                <q><span v-for="(phrase, j) in quotePhrases(item.quote)" :key="j" class="abh-ph">{{ phrase }}</span></q>
                <small>{{ item.speaker }}<template v-if="nameCampus"> · {{ item.campus.name }}家長</template></small>
              </figcaption>
            </figure>
          </li>
        </ol>
      </div>
    </section>

    <!-- 結尾：接下來可以看這幾頁（不放預約） -->
    <section class="abh-wrap abh-next" aria-labelledby="next-title">
      <h2 id="next-title">還可以看看這幾頁</h2>
      <nav class="abh-next-list" aria-label="其他頁面">
        <NuxtLink v-for="item in nextPages" :key="item.href" :to="item.href" data-rise>
          <b>{{ item.title }}</b>
          <small>{{ item.hint }}</small>
          <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg>
        </NuxtLink>
      </nav>
    </section>
  </main>
</template>

<style scoped src="../assets/css/about.css"></style>
