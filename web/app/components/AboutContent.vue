<script setup lang="ts">
// 關於常春藤頁主體（/about）。
// 2026-10-30 換版（比稿 design/about-new-directions-20261030/h-blend.html「H 原版風格×四季結構」第三版；使用者選 H 後要求
// 「盡量跟其他分頁類似」「五所校園拿掉」「家長章標題改成『孩子的進步，家長看得見。』」，再說「先這樣實作」）：
// - 桌機與手機同一套排法，取代 09-29 起的桌機立體書（utils/about-popup.ts）與 10-25 的手機卡紙疊（AboutSheets），
//   不翻頁、不釘住、不再載 motion。
// - 跟其他分頁對齊：米白底、全人教育放薄荷色帶（同首頁關於區）；首屏左大標右卡紙照片，下面一排章節索引（同特色教學、
//   環境、入學頁）；章節上方只標編號。
// - 保留 about 自己的：章色書籤、卡紙相框、章名旁的紀念章（捲到時轉一圈）、沿革中軸線左右交錯且卡紙捲到時站起來
//   （四季藝術「歷史與沿革」的排法）、六圈（AboutWholePerson）、孩子的蠟筆畫（AboutCrayon）、家長影片卡紙。
// 文字與照片讀後台「關於常春藤頁」（about_page，預設＝fixture 的 aboutPage）、分校資料與各校家長影片；欄位不變。
// 例外：家長章標題寫在這裡（使用者 10-30 指定，取自函函奶奶那支影片的話），不再取第一位家長的原話。
// 沿革源自機構站「關於常春藤」：舊站「三十多個春夏秋冬」不對（1997 到今年未滿三十年），一律寫「近三十年」；
// 崇德同年的 ESL 美語部不寫；義華創校年份 1997（業主 2026-10-03 裁定）。首屏照片裡的長輩是創辦人（姓名未提供，不寫名字）。
// 分校停用或下架時，那一年仍留在沿革裡，只是卡紙留白、不放校名。
import type { AboutPageContent, Campus, CampusTestimonial } from '~/types/site-content'
import { aboutHeroAttrs, mediaImageAttrs, pickImage } from '~/utils/media-image'
import { pagePhotoAlt, pagePhotoAttrs, pageTitleLines, rocYear, withPhotoStyle } from '~/utils/page-content'
import { youtubeEmbed } from '~/utils/filmCarousel'
import { pickVoices } from '~/utils/testimonials'
import { HERO_ALT, HERO_BACK_ALT, HOPE_ALT, LITERACIES, SCENE, WAX_FILTER, milestoneLook, sceneStyle } from '~/utils/about-content'

const props = defineProps<{ campuses: Campus[]; page: AboutPageContent }>()

// 沿革五站來自後台（年份可改，民國年＝西元 − 1911）；卡紙底色依成立順序輪流用品牌色（milestoneLook），微斜角度固定
const TILT = [-1.5, 1.2, -1, 1.6, -0.8]
const milestones = computed(() => props.page.milestones.map((item, i) => ({
  ...item, roc: rocYear(item.year), campus: props.campuses.find((c) => c.key === item.key), color: milestoneLook(i).color, tilt: TILT[i % TILT.length]!
})))
const CAMPUS_SIZES = '(max-width: 900px) 80vw, 300px'

// 六大領域的圓點與六圈同色（順序同 AboutWholePerson）；滑過某個領域，六圈播完後那一圈亮
const DOMAINS = [
  { name: '身體動作與健康', color: 'var(--ivy-whole-body)' },
  { name: '認知', color: 'var(--ivy-whole-cognition)' },
  { name: '語文', color: 'var(--ivy-whole-language)' },
  { name: '社會', color: 'var(--ivy-whole-social)' },
  { name: '情緒', color: 'var(--ivy-whole-emotion)' },
  { name: '美感', color: 'var(--ivy-whole-aesthetic)' }
]
const focusDomain = ref<number | null>(null)

// 家長怎麼說：各校的 testimonials（後台自訂，沒自訂的校用內建）五校輪流取，最多四位；沒有影片時整章不出現
const voices = computed(() => pickVoices(props.campuses))
const voiceCampuses = computed(() => [...new Map(voices.value.map((v) => [v.campus.key, v.campus])).values()])
const VOICES_TITLE = ['孩子的進步，', '家長看得見。']
// 封面：後台選的素材用它的 srcset 與焦點；內建靜態圖與 YouTube 縮圖只有網址（卡紙裡 16:9 裁切）
const POSTER_SIZES = '(min-width: 901px) 600px, 90vw'
function posterAttrs(item: CampusTestimonial) {
  const image = item.posterMedia
  if (!image) return { src: item.poster, width: 800, height: 450 }
  return { ...mediaImageAttrs(image, POSTER_SIZES), width: 800, height: 450, ...(image.position ? { style: { objectPosition: image.position } } : {}) }
}
const shownVoice = ref(0)
const playing = ref(false)
const tv = ref<HTMLElement | null>(null)
// 後台即時預覽（/preview）會在看著的時候刪影片、換順序：那個位置變成別支影片或超出範圍時回到第 1 支並停止播放；
// 只是改了說詞、封面這類（同一個位置還是同一支影片）不重設。正式頁的 campuses 不會變。
watch(voices, (list, before) => {
  if (list[shownVoice.value] !== undefined && list[shownVoice.value]!.youtubeId === before[shownVoice.value]?.youtubeId) return
  shownVoice.value = 0
  playing.value = false
})
function pickVoice(index: number) {
  if (index === shownVoice.value || !voices.value[index]) return
  shownVoice.value = index
  playing.value = false
  // 手機：清單在影片下面，選了就把影片捲進畫面
  const card = tv.value
  if (!card) return
  const rect = card.getBoundingClientRect()
  if (rect.top < 0 || rect.bottom > innerHeight) card.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

// 章節：首屏索引、編號、章色都從這裡算；章名在後台。索引的小字由現有資料算（年份範圍、領域數、影片數）。
const CHAPTER_LOOKS = [
  { id: 'story', color: 'var(--yellow)' },
  { id: 'whole-child', color: 'var(--studio-blue)' },
  { id: 'hope', color: 'var(--studio-orange)' },
  { id: 'voices', color: 'var(--trail)' }
]
const chapters = computed(() => {
  const years = milestones.value.map((item) => item.year)
  const notes: Record<string, string> = {
    story: years.length ? `${Math.min(...years)} 到 ${Math.max(...years)}` : '',
    'whole-child': `${DOMAINS.length} 大領域`,
    hope: '第二個家',
    voices: `${voices.value.length} 位家長`
  }
  return CHAPTER_LOOKS
    .map((look, i) => ({ ...look, name: props.page.chapterNames[i]!, note: notes[look.id]! }))
    .filter((item) => item.id !== 'voices' || voices.value.length > 0)
    .map((item, i) => ({ ...item, no: String(i + 1).padStart(2, '0'), style: { '--chap': item.color } }))
})
const chapterOf = (id: string) => chapters.value.find((item) => item.id === id)!
// 結尾：接下來可以看（同環境頁的「還可以看看這幾頁」；不放預約，預約入口只有頁首金色鈕）
const NEXT = [
  { href: '/environment', title: '常春藤環境', hint: '照顧、餐點與五校空間', color: 'var(--mint)' },
  { href: '/curriculum', title: '特色教學', hint: '四個年段與課程方向', color: 'var(--yellow)' },
  { href: '/admission', title: '入學資訊', hint: '入學流程、分班對照', color: 'var(--studio-blue)' }
]

// 動態：沿革卡紙站起來、紀念章轉一圈都是 about.css 的捲動驅動動畫（不支援的瀏覽器直接是完成狀態）。
// 這裡只管兩件事：六圈（AboutWholePerson 等章節發 abk-open 才開始播，自己看得見才真的播），
// 蠟筆畫（第三章捲進畫面才塗上 is-opened、1.4 秒後長藤與煙 is-grown）。沒有 JS、減少動態、強制色彩時都是完成圖。
const root = ref<HTMLElement | null>(null)
const hope = ref<HTMLElement | null>(null)
const live = ref(false)
const hopeOpened = ref(false)
const hopeGrown = ref(false)
let observer: IntersectionObserver | null = null
let growTimer = 0
onMounted(() => {
  root.value?.querySelector('#whole-child')?.dispatchEvent(new Event('abk-open'))
  const quiet = matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('(forced-colors: active)').matches
  if (quiet || !('IntersectionObserver' in window) || !hope.value) return
  live.value = true
  observer = new IntersectionObserver(([entry]) => {
    if (!entry?.isIntersecting) return
    hopeOpened.value = true
    growTimer = window.setTimeout(() => { hopeGrown.value = true }, 1400)
    observer?.disconnect()
  }, { rootMargin: '0px 0px -20% 0px' })
  observer.observe(hope.value)
})
onBeforeUnmount(() => { observer?.disconnect(); clearTimeout(growTimer) })
</script>

<template>
  <main id="main" ref="root" tabindex="-1" data-cta-entry="about" class="abh" :class="{ 'is-live': live }">
    <!-- 蠟筆濾鏡（第三章的蠟筆畫共用） -->
    <svg class="abh-wax" aria-hidden="true" focusable="false" v-html="WAX_FILTER" />

    <!-- 首屏：左大標、右兩張卡紙照片；下面一排章節索引 -->
    <section class="abh-wrap abh-hero" aria-labelledby="about-title">
      <div class="abh-hero-text">
        <h1 id="about-title"><template v-for="(line, i) in pageTitleLines(page.heroTitle)" :key="i"><br v-if="i">{{ line }}</template></h1>
        <p class="abh-lede">{{ page.heroLede }}</p>
      </div>
      <div class="abh-hero-art">
        <figure class="abh-card is-back">
          <img v-bind="withPhotoStyle(pagePhotoAttrs('about-curious', page.heroBackPhoto, '(max-width: 900px) 34vw, 220px'), page.heroBackPhoto)" :alt="pagePhotoAlt(HERO_BACK_ALT, page.heroBackPhoto, page.heroBackPhotoAlt)" loading="lazy">
        </figure>
        <figure class="abh-card is-main">
          <img v-bind="withPhotoStyle(aboutHeroAttrs(page), page.heroPhoto)" :alt="pagePhotoAlt(HERO_ALT, page.heroPhoto, page.heroPhotoAlt)" loading="eager" fetchpriority="high">
          <figcaption v-if="page.heroCaption">{{ page.heroCaption }}</figcaption>
        </figure>
      </div>
      <nav class="abh-index" aria-label="這一頁的章節">
        <a v-for="item in chapters" :key="item.id" :href="`#${item.id}`" :style="item.style">
          <span class="abh-mk" lang="en">{{ item.no }}</span>
          <span><b>{{ item.name }}</b><small v-if="item.note">{{ item.note }}</small></span>
        </a>
      </nav>
    </section>

    <!-- 一路走來：章名旁紀念章；沿革中軸線左右交錯，一邊卡紙一邊字（由舊到新） -->
    <section id="story" class="abh-wrap abh-sec" :style="chapterOf('story').style" aria-labelledby="story-title">
      <p class="abh-no" lang="en">{{ chapterOf('story').no }}</p>
      <div class="abh-title-row">
        <h2 id="story-title"><template v-for="(line, i) in pageTitleLines(page.storyTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
        <span class="abh-medal" aria-hidden="true" />
      </div>
      <p class="abh-text">{{ page.storyText }}</p>
      <ol class="abh-tl">
        <li v-for="item in milestones" :key="item.key" :style="{ '--c': item.color }">
          <!-- 卡紙只放照片：年份、校名都在旁邊的字裡（10-30 前卡紙另貼年份貼紙、底下寫校名，手機上下疊時同一行字連出現兩次） -->
          <figure class="abh-card" :style="{ '--c': item.color, '--r': `${item.tilt}deg` }" aria-hidden="true">
            <img v-if="item.campus" v-bind="pickImage(item.campus.image, item.campus.imageMedia, CAMPUS_SIZES)" alt="" loading="lazy">
            <span v-else class="abh-blank" />
          </figure>
          <div class="abh-tl-text">
            <p class="abh-year"><span lang="en">{{ item.year }}</span><small>民國 {{ item.roc }} 年</small></p>
            <h3 v-if="item.campus">{{ item.campus.name }}<span>{{ item.campus.district }}</span></h3>
            <p>{{ item.text }}</p>
          </div>
        </li>
      </ol>
    </section>

    <!-- 全人教育：薄荷色帶，左邊兩份清單、右邊六圈 -->
    <section id="whole-child" class="abh-band" data-spread :style="chapterOf('whole-child').style" aria-labelledby="whole-title">
      <div class="abh-wrap abh-split">
        <div class="abh-whole-text">
          <p class="abh-no" lang="en">{{ chapterOf('whole-child').no }}</p>
          <h2 id="whole-title"><template v-for="(line, i) in pageTitleLines(page.wholeTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
          <p class="abh-text">{{ page.wholeText }}</p>
          <div class="abh-lists">
            <div>
              <h3>六大領域</h3>
              <ol class="abh-domains">
                <li v-for="(item, i) in DOMAINS" :key="item.name" :style="{ '--c': item.color }" @pointerenter="focusDomain = i" @pointerleave="focusDomain = null">{{ item.name }}</li>
              </ol>
            </div>
            <div>
              <h3>六大核心素養</h3>
              <ol class="abh-literacies"><li v-for="name in LITERACIES" :key="name">{{ name }}</li></ol>
            </div>
          </div>
          <p class="abh-fine">{{ page.wholeFine }}<small v-if="page.wholeFineSource">{{ page.wholeFineSource }}</small></p>
          <NuxtLink class="abh-link" to="/curriculum">看特色教學怎麼安排<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
        </div>
        <AboutWholePerson :focus="focusDomain" />
      </div>
    </section>

    <!-- 我們的期許：引言（蠟筆「」）＋孩子的蠟筆畫（照片貼在房子窗戶上） -->
    <section id="hope" ref="hope" class="abh-wrap abh-sec abh-hope" :class="{ 'is-opened': hopeOpened, 'is-grown': hopeGrown }" :style="chapterOf('hope').style" aria-labelledby="hope-title">
      <div class="abh-split">
        <div>
          <p class="abh-no" lang="en">{{ chapterOf('hope').no }}</p>
          <h2 id="hope-title"><template v-for="(line, i) in pageTitleLines(page.hopeTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
          <blockquote class="abh-quote">
            <p v-for="(quote, i) in page.hopeQuotes" :key="i">{{ quote }}</p>
          </blockquote>
        </div>
        <div class="abh-art-box">
          <div class="abh-art">
            <div class="abh-print" aria-hidden="true">
              <AboutCrayon class="is-top" name="sky" view-box="0 0 1240 260" align="xMidYMin slice" />
              <AboutCrayon class="is-bottom" name="grass" view-box="0 0 1240 300" align="xMidYMax slice" />
            </div>
            <div class="abh-scene">
              <div class="abh-cut" aria-hidden="true" :style="sceneStyle(SCENE.treeL)"><AboutCrayon name="treeL" view-box="0 0 140 210" /></div>
              <div class="abh-cut" aria-hidden="true" :style="sceneStyle(SCENE.treeR)"><AboutCrayon name="treeR" view-box="0 0 116 220" /></div>
              <AboutCrayon class="abh-smoke" name="smoke" view-box="0 0 120 180" :style="sceneStyle(SCENE.smoke)" />
              <figure class="abh-cut" :style="sceneStyle(SCENE.house, 2)">
                <AboutCrayon name="house" view-box="0 0 300 340" />
                <span class="abh-window">
                  <img v-bind="withPhotoStyle(pagePhotoAttrs('about-together', page.hopePhoto, '(max-width: 900px) 40vw, 220px'), page.hopePhoto)" :alt="pagePhotoAlt(HOPE_ALT, page.hopePhoto, page.hopePhotoAlt)" loading="lazy">
                  <i class="abh-tape is-l" aria-hidden="true" /><i class="abh-tape is-r" aria-hidden="true" />
                </span>
                <AboutCrayon class="abh-vine" name="ivy" view-box="0 0 300 340" />
              </figure>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 家長怎麼說：左邊一句一位家長，右邊大卡紙；按播放才插 youtube-nocookie，沒有 JS 時是連到 YouTube -->
    <section v-if="voices.length" id="voices" class="abh-wrap abh-sec" :style="chapterOf('voices').style" aria-labelledby="voices-title">
      <div class="abh-split is-voices">
        <div class="abh-voices-text">
          <p class="abh-no" lang="en">{{ chapterOf('voices').no }}</p>
          <h2 id="voices-title"><template v-for="(line, i) in VOICES_TITLE" :key="i"><br v-if="i">{{ line }}</template></h2>
          <p class="abh-text is-small">{{ voiceCampuses.map((c) => c.name).join('、') }}家長在學校 YouTube 頻道上的分享。</p>
          <ol class="abh-picks">
            <li v-for="(item, i) in voices" :key="`${item.campus.key}-${i}`">
              <button type="button" :aria-pressed="i === shownVoice" @click="pickVoice(i)"><q>{{ item.quote }}</q><small>{{ item.speaker }}<template v-if="voiceCampuses.length > 1"> · {{ item.campus.name }}</template></small></button>
            </li>
          </ol>
          <!-- 「分享 ↗」不拆行：分與享之間 word joiner（&#8288;）、箭頭前不斷行空格（2026-10-13：320 寬箭頭自己掉到下一行） -->
          <template v-for="campus in voiceCampuses" :key="campus.key">
            <a v-if="campus.youtube" class="abh-link is-yt" :href="campus.youtube" target="_blank" rel="noopener noreferrer">到{{ campus.name }} YouTube 看更多分&#8288;享&nbsp;↗<span class="sr-only">（另開新視窗）</span></a>
          </template>
        </div>
        <figure ref="tv" class="abh-card abh-tv">
          <div class="abh-video">
            <iframe
              v-if="playing" :src="youtubeEmbed(voices[shownVoice]!.youtubeId)" :title="`${voices[shownVoice]!.speaker}的分享影片`"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"
            />
            <a v-else class="abh-play" :href="`https://www.youtube.com/watch?v=${voices[shownVoice]!.youtubeId}`" target="_blank" rel="noopener noreferrer" :aria-label="`播放${voices[shownVoice]!.speaker}的分享影片（YouTube）`" @click.prevent="playing = true">
              <img v-bind="posterAttrs(voices[shownVoice]!)" :alt="voices[shownVoice]!.posterAlt ?? ''" loading="lazy" decoding="async">
              <span class="abh-play-mark" aria-hidden="true"><svg class="icon" focusable="false"><use href="#i-play" /></svg></span>
            </a>
          </div>
          <figcaption aria-live="polite">{{ voices[shownVoice]!.speaker }} · {{ voices[shownVoice]!.campus.name }}家長</figcaption>
        </figure>
      </div>
    </section>

    <!-- 結尾：接下來可以看這幾頁（不放預約） -->
    <section class="abh-wrap abh-sec abh-next" aria-labelledby="next-title">
      <h2 id="next-title">還可以看看這幾頁</h2>
      <nav class="abh-index is-next" aria-label="其他頁面">
        <NuxtLink v-for="item in NEXT" :key="item.href" :to="item.href" :style="{ '--chap': item.color }">
          <span class="abh-mk" aria-hidden="true"><svg class="icon" focusable="false"><use href="#i-arrow-right" /></svg></span>
          <span><b>{{ item.title }}</b><small>{{ item.hint }}</small></span>
        </NuxtLink>
      </nav>
    </section>
    <div class="abh-end" />
  </main>
</template>

<style scoped src="../assets/css/about.css"></style>
