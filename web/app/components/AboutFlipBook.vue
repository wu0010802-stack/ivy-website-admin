<script setup lang="ts">
// 關於常春藤頁手機版（900px 以下）：上翻畫冊（2026-10-19，比稿 design/about-mobile-directions-20261019/，使用者選 A、第二版）。
// 桌機立體書在手機會被拆成上下兩張紙、卡紙站起來前只剩色條，所以手機換成一本頂端線圈裝訂的直立畫冊：
// 封面 → 目次 → 第一章開頭（五校目錄）→ 一頁一校（照片卡紙站在高雄立體地圖上，地圖一校一校長出來）→ 六圈 → 核心素養
// → 引言 → 蠟筆畫房子 → 家長影片 → 封底書籤。文字與照片和桌機同一份（後台 about_page、分校資料），由 AboutContent 傳進來。
// 沒有 JS、減少動態、forced-colors、或有一頁放不下時，書頁上下排開照常捲（CSS 預設）；放得下才由 utils/about-flipbook.ts 釘住翻頁。
// 桌機（901px 以上）整本隱藏，about-popup 也不碰這裡（它的 root 是 .abk）。
import type { AboutPageContent, Campus } from '~/types/site-content'
import type { Voice } from '~/utils/testimonials'
import type { AboutFlipBook } from '~/utils/about-flipbook'
import { ABOUT_MAP } from '../generated/about-map'
import { aboutHeroAttrs, pickImage } from '~/utils/media-image'
import { pagePhotoAlt, pagePhotoAttrs, pageTitleLines, withPhotoStyle } from '~/utils/page-content'
import { youtubeEmbed } from '~/utils/filmCarousel'
import { HERO_ALT, HERO_BACK_ALT, HOPE_ALT, LITERACIES, SCENE, milestoneLook, sceneStyle, type FlipStop } from '~/utils/about-content'

type Milestone = AboutPageContent['milestones'][number] & { roc: number, campus?: Campus }
type Chapter = { id: string, name: string, label: string, color: string }
const props = defineProps<{
  page: AboutPageContent
  milestones: Milestone[]
  chapters: Chapter[]
  voices: Voice[]
  voiceTitle: string[]
  voiceCampuses: Campus[]
  posterAttrs: (item: Voice) => Record<string, unknown>
}>()

// 頁碼：封面 0、目次 1、第一章開頭 2、一頁一校 3…、之後依序；家長影片沒有就少一頁
const index = computed(() => {
  const ms = 3
  const whole = ms + props.milestones.length
  const voices = props.voices.length ? whole + 4 : -1
  return { ms, whole, lits: whole + 1, hope: whole + 2, hopeArt: whole + 3, voices, back: whole + (props.voices.length ? 5 : 4) }
})
const pageCount = computed(() => index.value.back + 1)
const pid = (i: number) => `about-m-p${i + 1}`
const chapterOf = (id: string) => props.chapters.find((item) => item.id === id)
const tocItems = computed(() => props.chapters.map((chapter) => ({
  ...chapter, page: chapter.id === 'story' ? 2 : chapter.id === 'whole-child' ? index.value.whole : chapter.id === 'hope' ? index.value.hope : index.value.voices
})))

// 一頁一校：卡紙色、地圖座標；卡紙水平位置跟著該校在地圖上的位置（在地圖最上面兩成的校，卡紙改站另一邊，免得蓋住房子）
const stops = computed<FlipStop[]>(() => props.milestones.map((item, i) => {
  const look = milestoneLook(i)
  return { key: item.key, name: item.campus?.name ?? null, district: item.campus?.district ?? null, at: ABOUT_MAP.campuses[item.key] ?? null, color: look.color, map: look.map ?? look.color }
}))
const cardX = (i: number) => {
  const at = stops.value[i]?.at
  if (!at) return '50%'
  const [vx, vy, vw, vh] = ABOUT_MAP.view
  const x = (at[0] - vx) / vw
  return `${Math.round(((at[1] - vy) / vh < 0.2 ? (x > 0.5 ? 0.3 : 0.7) : x) * 100)}%`
}
const TILT = [-1.4, 1.2, -0.8, 1.3, -1]
const medalStops = computed(() => props.milestones.map((item) => ({ name: item.campus?.name ?? '', year: item.year })))
const CAMPUS_SIZES = '(max-width: 900px) 62vw, 300px'

// 封底書籤：長短不一（px，螢幕矮時等比例縮）
const RIBBON_LENGTHS = [300, 342, 288, 328, 296]

// 家長：大卡紙＋其他幾位的小卡紙（點了大卡紙倒下、換片、站起來）；按播放才插 youtube-nocookie
const shown = ref(0)
const playing = ref(false)
const swinging = ref(false)
const others = computed(() => props.voices.map((item, i) => ({ item, i })).filter(({ i }) => i !== shown.value).slice(0, 3))
watch(() => props.voices, (list) => { if (!list[shown.value]) { shown.value = 0; playing.value = false } })
function pick(i: number) {
  if (i === shown.value || swinging.value) return
  playing.value = false
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { shown.value = i; return }
  swinging.value = true
  window.setTimeout(() => { if (props.voices[i]) shown.value = i; swinging.value = false }, 260)
}

const root = ref<HTMLElement | null>(null)
let book: AboutFlipBook | null = null
let disposed = false
let narrow: MediaQueryList | null = null
async function start() {
  if (book || disposed || !root.value || !narrow?.matches) return
  if (matchMedia('(forced-colors: active)').matches) return
  const loaded = await import('~/utils/about-flipbook').catch(() => null)
  if (!loaded || disposed || book || !root.value || !narrow.matches) return
  book = loaded.createAboutFlipBook(root.value, { reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }, {
    // 翻離家長那一頁就停掉影片
    onPage: (i) => { if (i !== index.value.voices) playing.value = false }
  })
}
// 平板轉向跨過 900px：窄了才建立、寬了就拆掉（桌機立體書由 AboutContent 管）
const onBreakpoint = () => { if (narrow?.matches) start(); else { book?.destroy(); book = null } }
onMounted(() => {
  narrow = matchMedia('(max-width: 900px)')
  narrow.addEventListener('change', onBreakpoint)
  start()
})
onBeforeUnmount(() => { disposed = true; narrow?.removeEventListener('change', onBreakpoint); book?.destroy() })
</script>

<template>
  <div ref="root" class="afb" :style="{ '--n': pageCount }">
    <!-- 地圖的區界、湖、河：只輸出一次，五頁地圖用 <use> 引用 -->
    <svg class="afb-sprite" hidden aria-hidden="true" focusable="false">
      <defs>
        <path v-for="(district, i) in ABOUT_MAP.districts" :id="`afb-d-${i}`" :key="district.name" :d="district.d" />
        <path v-for="(lake, i) in ABOUT_MAP.lakes" :id="`afb-lake-${i}`" :key="lake.name" :d="lake.d" />
        <path id="afb-river" :d="ABOUT_MAP.river" />
      </defs>
    </svg>
    <div class="afb-track" data-afb-track>
      <span v-for="i in pageCount" :key="i" class="afb-snap" data-afb-snap :style="{ top: `calc(${i - 1} * var(--afb-seg))` }" />
      <div class="afb-book">
        <span class="afb-rings" aria-hidden="true" />
        <AboutMedal class="afb-medal" :stops="medalStops" />

        <!-- 封面 -->
        <section :id="pid(0)" class="afb-page is-cover" data-afb-page="cover" aria-labelledby="about-m-title">
          <span class="afb-ribbon" aria-hidden="true" />
          <h1 id="about-m-title" class="afb-hero-title"><template v-for="(line, i) in pageTitleLines(page.heroTitle)" :key="i"><br v-if="i">{{ line }}</template></h1>
          <p class="afb-lede">{{ page.heroLede }}</p>
          <div class="afb-stage">
            <figure class="afb-pop is-hero" data-pop style="--c:var(--yellow);--r:1.2deg">
              <div class="afb-card">
                <img v-bind="withPhotoStyle(aboutHeroAttrs(page), page.heroPhoto)" :alt="pagePhotoAlt(HERO_ALT, page.heroPhoto, page.heroPhotoAlt)" loading="eager" fetchpriority="high">
                <figcaption>{{ page.heroCaption }}</figcaption>
              </div>
              <span class="afb-fold" aria-hidden="true" />
            </figure>
          </div>
          <span class="afb-no" lang="en" aria-hidden="true">1</span>
        </section>

        <!-- 目次：點一列翻到那一頁 -->
        <section :id="pid(1)" class="afb-page is-toc" data-afb-page="toc" aria-labelledby="about-m-toc">
          <h2 id="about-m-toc" class="afb-toc-h">目次</h2>
          <ol class="afb-toc">
            <li v-for="item in tocItems" :key="item.id"><a :href="`#${pid(item.page)}`" :data-afb-go="item.page" :style="{ '--c': item.color }"><span>{{ item.name }}</span><i aria-hidden="true" /><b lang="en">{{ item.page + 1 }}</b></a></li>
            <li><a :href="`#${pid(index.back)}`" :data-afb-go="index.back" style="--c:var(--leaf)"><span>{{ page.outroTitle }}</span><i aria-hidden="true" /><b>書籤</b></a></li>
          </ol>
          <div class="afb-stage">
            <figure class="afb-pop is-curious" data-pop style="--c:var(--studio-blue);--r:-3deg">
              <div class="afb-card"><img v-bind="withPhotoStyle(pagePhotoAttrs('about-curious', page.heroBackPhoto, '(max-width: 900px) 52vw, 240px'), page.heroBackPhoto)" :alt="pagePhotoAlt(HERO_BACK_ALT, page.heroBackPhoto, page.heroBackPhotoAlt)" loading="lazy"></div>
              <span class="afb-fold" aria-hidden="true" />
            </figure>
          </div>
          <span class="afb-no" lang="en" aria-hidden="true">2</span>
        </section>

        <!-- 第一章開頭：章名、說明、五校目錄（點一列翻到那一校） -->
        <section :id="pid(2)" class="afb-page is-opener" data-afb-page="story" data-anchor="story" :style="{ '--chap': chapterOf('story')?.color }" aria-labelledby="about-m-story">
          <p class="afb-chap">{{ chapterOf('story')?.label }}<span>{{ chapterOf('story')?.name }}</span></p>
          <h2 id="about-m-story" class="afb-title"><template v-for="(line, i) in pageTitleLines(page.storyTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
          <p class="afb-text">{{ page.storyText }}</p>
          <ol class="afb-index">
            <li v-for="(item, i) in milestones" :key="item.key">
              <a :href="`#${pid(index.ms + i)}`" :data-afb-go="index.ms + i" :style="{ '--c': milestoneLook(i).color }">
                <span lang="en">{{ item.year }}</span>
                <img v-if="item.campus" v-bind="pickImage(item.campus.image, item.campus.imageMedia, '60px')" alt="" loading="lazy"><i v-else aria-hidden="true" />
                <b>{{ item.campus?.name ?? item.text }}</b>
                <small>{{ item.campus?.district }}</small>
                <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg>
              </a>
            </li>
          </ol>
          <span class="afb-no" lang="en" aria-hidden="true">3</span>
        </section>

        <!-- 一頁一校：年份 → 校名＋區 → 沿革一句話 → 照片卡紙站在地圖上方 → 地址 -->
        <section
          v-for="(item, i) in milestones" :id="pid(index.ms + i)" :key="`ms-${item.key}`" class="afb-page is-ms" data-afb-page="ms"
          :data-name="item.campus?.name ?? ''" :data-year="item.year" :style="{ '--c': milestoneLook(i).color, '--tint': `${milestoneLook(i).tint}%` }" :aria-labelledby="`about-m-ms-${i}`"
        >
          <p class="afb-chap" :style="{ '--chap': chapterOf('story')?.color }">{{ chapterOf('story')?.label }}<span>{{ chapterOf('story')?.name }}</span></p>
          <p class="afb-when"><b lang="en">{{ item.year }}</b>　民國 {{ item.roc }} 年</p>
          <div class="afb-name"><h3 :id="`about-m-ms-${i}`">{{ item.campus?.name ?? `${item.year} 年` }}</h3><span v-if="item.campus">{{ item.campus.district }}</span></div>
          <p class="afb-ms-text">{{ item.text }}</p>
          <div class="afb-vis">
            <div v-if="item.campus" class="afb-vis-card">
              <figure class="afb-pop" data-pop :style="{ '--c': milestoneLook(i).color, '--r': `${TILT[i % TILT.length]}deg`, '--cx': cardX(i) }">
                <div class="afb-card"><img v-bind="pickImage(item.campus.image, item.campus.imageMedia, CAMPUS_SIZES)" alt="" loading="lazy"><i>{{ item.campus.name }}</i></div>
                <span class="afb-fold" aria-hidden="true" />
              </figure>
            </div>
            <div class="afb-map">
              <AboutFlipMap :k="i" :stops="stops" />
              <small class="afb-map-source">© OpenStreetMap 貢獻者・內政部國土測繪中心</small>
            </div>
          </div>
          <p v-if="item.campus?.address" class="afb-addr"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></svg>{{ item.campus.address }}</p>
          <span class="afb-no" lang="en" aria-hidden="true">{{ index.ms + i + 1 }}</span>
        </section>

        <!-- 第二章 全人教育：六圈（AboutWholePerson 收到 abk-open 才播） -->
        <section :id="pid(index.whole)" class="afb-page is-whole" data-afb-page="whole" data-anchor="whole-child" data-spread :style="{ '--chap': chapterOf('whole-child')?.color }" aria-labelledby="about-m-whole">
          <p class="afb-chap">{{ chapterOf('whole-child')?.label }}<span>{{ chapterOf('whole-child')?.name }}</span></p>
          <h2 id="about-m-whole" class="afb-title"><template v-for="(line, i) in pageTitleLines(page.wholeTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
          <p class="afb-text">{{ page.wholeText }}</p>
          <div class="afb-art"><AboutWholePerson /></div>
          <span class="afb-no" lang="en" aria-hidden="true">{{ index.whole + 1 }}</span>
        </section>
        <section :id="pid(index.lits)" class="afb-page is-lits" data-afb-page="lits" :style="{ '--chap': chapterOf('whole-child')?.color }" aria-labelledby="about-m-lits">
          <p class="afb-chap">{{ chapterOf('whole-child')?.label }}<span>{{ chapterOf('whole-child')?.name }}</span></p>
          <h3 id="about-m-lits" class="afb-lits-h">帶得走的能力 · 六大核心素養</h3>
          <ol class="afb-lits"><li v-for="name in LITERACIES" :key="name">{{ name }}</li></ol>
          <p class="afb-fine">{{ page.wholeFine }}<small v-if="page.wholeFineSource">{{ page.wholeFineSource }}</small></p>
          <NuxtLink class="afb-link" to="/curriculum">看特色教學怎麼安排<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
          <span class="afb-no" lang="en" aria-hidden="true">{{ index.lits + 1 }}</span>
        </section>

        <!-- 第三章 我們的期許：引言一頁、孩子的蠟筆畫一頁（同桌機 AboutCrayon） -->
        <section :id="pid(index.hope)" class="afb-page is-quote" data-afb-page="hope" data-anchor="hope" :style="{ '--chap': chapterOf('hope')?.color }" aria-labelledby="about-m-hope">
          <p class="afb-chap">{{ chapterOf('hope')?.label }}<span>{{ chapterOf('hope')?.name }}</span></p>
          <h2 id="about-m-hope" class="afb-title"><template v-for="(line, i) in pageTitleLines(page.hopeTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
          <blockquote class="afb-quote"><p v-for="(quote, i) in page.hopeQuotes" :key="i">{{ quote }}</p></blockquote>
          <span class="afb-no" lang="en" aria-hidden="true">{{ index.hope + 1 }}</span>
        </section>
        <section :id="pid(index.hopeArt)" class="afb-page is-house afb-hope" data-afb-page="hope-art">
          <div class="afb-print" aria-hidden="true">
            <AboutCrayon class="is-top" name="sky" view-box="0 0 1240 260" align="xMidYMin slice" />
            <AboutCrayon class="is-bottom" name="grass" view-box="0 0 1240 300" align="xMidYMax slice" />
          </div>
          <div class="afb-scene">
            <div class="afb-pop is-crayon" data-pop data-d="1" aria-hidden="true" :style="sceneStyle(SCENE.treeL)"><div class="afb-card"><AboutCrayon name="treeL" view-box="0 0 140 210" /></div></div>
            <div class="afb-pop is-crayon" data-pop data-d="2" aria-hidden="true" :style="sceneStyle(SCENE.treeR)"><div class="afb-card"><AboutCrayon name="treeR" view-box="0 0 116 220" /></div></div>
            <AboutCrayon class="afb-smoke" name="smoke" view-box="0 0 120 180" :style="sceneStyle(SCENE.smoke)" />
            <figure class="afb-pop is-crayon" data-pop :style="sceneStyle(SCENE.house, 2)">
              <div class="afb-card">
                <AboutCrayon name="house" view-box="0 0 300 340" />
                <span class="afb-window">
                  <img v-bind="withPhotoStyle(pagePhotoAttrs('about-together', page.hopePhoto, '(max-width: 900px) 40vw, 200px'), page.hopePhoto)" :alt="pagePhotoAlt(HOPE_ALT, page.hopePhoto, page.hopePhotoAlt)" loading="lazy">
                  <i class="afb-tape is-l" aria-hidden="true" /><i class="afb-tape is-r" aria-hidden="true" />
                </span>
                <AboutCrayon class="afb-vine" name="ivy" view-box="0 0 300 340" />
              </div>
            </figure>
          </div>
          <span class="afb-no" lang="en" aria-hidden="true">{{ index.hopeArt + 1 }}</span>
        </section>

        <!-- 第四章 家長怎麼說：大卡紙＋其他家長的小卡紙 -->
        <section v-if="voices.length" :id="pid(index.voices)" class="afb-page is-voices" data-afb-page="voices" data-anchor="voices" :style="{ '--chap': chapterOf('voices')?.color }" aria-labelledby="about-m-voices">
          <p class="afb-chap">{{ chapterOf('voices')?.label }}<span>{{ chapterOf('voices')?.name }}</span></p>
          <h2 id="about-m-voices" class="afb-title"><template v-for="(line, i) in voiceTitle" :key="i"><br v-if="i">{{ line }}</template></h2>
          <p class="afb-cite">{{ voices[0]!.campus.name }}　{{ voices[0]!.speaker }}</p>
          <div class="afb-tv-box">
            <figure class="afb-pop is-tv" data-pop style="--c:var(--trail);--r:-.6deg">
              <div class="afb-card">
                <div class="afb-tv-face" :class="{ 'is-swinging': swinging }">
                  <div class="afb-video">
                    <iframe
                      v-if="playing" :src="youtubeEmbed(voices[shown]!.youtubeId)" :title="`${voices[shown]!.speaker}的分享影片`"
                      allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"
                    />
                    <a v-else class="afb-play" :href="`https://www.youtube.com/watch?v=${voices[shown]!.youtubeId}`" target="_blank" rel="noopener noreferrer" :aria-label="`播放${voices[shown]!.speaker}的分享影片（YouTube）`" @click.prevent="playing = true">
                      <img v-bind="posterAttrs(voices[shown]!)" :alt="voices[shown]!.posterAlt ?? ''" loading="lazy" decoding="async">
                      <span class="afb-play-mark" aria-hidden="true"><svg class="icon" focusable="false"><use href="#i-play" /></svg></span>
                    </a>
                  </div>
                  <!-- 第一位的話已經是本頁標題：大卡紙只寫是誰，換成別位才寫他的話 -->
                  <figcaption aria-live="polite"><q v-if="shown">{{ voices[shown]!.quote }}</q><small>{{ voices[shown]!.speaker }} · {{ voices[shown]!.campus.name }}家長</small></figcaption>
                </div>
              </div>
              <span class="afb-fold" aria-hidden="true" />
            </figure>
          </div>
          <ol v-if="others.length" class="afb-thumbs">
            <li v-for="{ item, i } in others" :key="`${item.campus.key}-${i}`">
              <button type="button" :aria-label="`換成${item.speaker}：「${item.quote}」`" @click="pick(i)"><img v-bind="posterAttrs(item)" alt="" loading="lazy" decoding="async"><i>{{ item.speaker }}</i></button>
            </li>
          </ol>
          <!-- 「分享 ↗」不拆行：分與享之間 word joiner、箭頭前不斷行空格（同桌機） -->
          <template v-for="campus in voiceCampuses" :key="campus.key">
            <a v-if="campus.youtube" class="afb-yt" :href="campus.youtube" target="_blank" rel="noopener noreferrer">到{{ campus.name }} YouTube 看更多分&#8288;享&nbsp;↗<span class="sr-only">（另開新視窗）</span></a>
          </template>
          <span class="afb-no" lang="en" aria-hidden="true">{{ index.voices + 1 }}</span>
        </section>

        <!-- 封底：五條書籤從線圈垂下來，一條是一所校園 -->
        <section :id="pid(index.back)" class="afb-page is-backcover" data-afb-page="back" data-anchor="campuses" aria-labelledby="about-m-campuses">
          <ul class="afb-ribbons">
            <template v-for="(item, i) in milestones" :key="item.key">
              <li v-if="item.campus">
                <NuxtLink :to="{ path: '/', query: { campus: item.campus.key }, hash: '#campuses' }" :style="{ '--c': milestoneLook(i).color, '--l': RIBBON_LENGTHS[i % RIBBON_LENGTHS.length] }">
                  <img v-bind="pickImage(item.campus.image, item.campus.imageMedia, '44px')" alt="" loading="lazy"><b>{{ item.campus.name }}</b><small>{{ item.campus.district }}</small>
                </NuxtLink>
              </li>
            </template>
          </ul>
          <div class="afb-back-copy">
            <h2 id="about-m-campuses">{{ page.outroTitle }}</h2>
            <p>{{ page.outroText }}</p>
          </div>
        </section>
        <span class="afb-edge" data-afb-edge aria-hidden="true" />
      </div>
    </div>
  </div>
</template>

<style scoped src="../assets/css/about-flipbook.css"></style>
