<script setup lang="ts">
// 關於常春藤頁手機版（900px 以下）：卡紙疊起來（2026-10-25，比稿 design/about-redesign-directions-20261025/，使用者選 A、第二版；
// 取代 10-19 的上翻畫冊：頁高固定時半頁空白、捲動等於翻頁、目次只在第 2 頁）。
// 薄荷桌面（同桌機立體書）上放一疊卡紙，一章一張：封面 → 一路走來（五校＋紀念章）→ 全人教育（六圈＋核心素養）→ 我們的期許（蠟筆畫）
// → 家長怎麼說 → 五所校園（書籤）。照一般網頁往下讀，一張讀到底下一張滑上來疊住它（utils/about-sheets.ts）。
// 五章各佔一個分頁位置：封面底下露出整疊的分頁（＝目次），讀進卡紙疊後頂端是一排資料夾分頁、目前那一章凸出來。
// 文字與照片和桌機同一份（後台 about_page、分校資料），由 AboutContent 傳進來。沒有 JS、減少動態、forced-colors 都是上下排開的卡紙。
// 桌機（901px 以上）整疊隱藏，about-popup 也不碰這裡（它的 root 是 .abk）。
import type { AboutPageContent, Campus } from '~/types/site-content'
import type { Voice } from '~/utils/testimonials'
import type { AboutSheets } from '~/utils/about-sheets'
import { aboutHeroAttrs, pickImage } from '~/utils/media-image'
import { pagePhotoAlt, pagePhotoAttrs, pageTitleLines, withPhotoStyle } from '~/utils/page-content'
import { youtubeEmbed } from '~/utils/filmCarousel'
import { HERO_ALT, HERO_BACK_ALT, HOPE_ALT, LITERACIES, SCENE, milestoneLook, sceneStyle } from '~/utils/about-content'

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

// 卡紙（＝分頁）：各章＋結尾五所校園；顏色同比稿（家長那章用淡的鼠尾草綠，分頁上的深綠字才讀得清楚）
const SHEET_LOOKS: Record<string, string> = {
  story: 'var(--yellow)', 'whole-child': 'var(--studio-blue)', hope: 'var(--studio-orange)', voices: 'var(--studio-sage)', campuses: 'var(--mint)'
}
const sheets = computed(() => [
  ...props.chapters.map((chapter) => ({ id: chapter.id, name: chapter.name })),
  { id: 'campuses', name: props.page.outroTitle }
].map((item, i) => ({ ...item, i, look: SHEET_LOOKS[item.id]! })))
const indexOf = (id: string) => sheets.value.findIndex((item) => item.id === id)
const mid = (id: string) => `about-m-${id}`
const sheetStyle = (id: string) => ({ '--look': SHEET_LOOKS[id], '--i': indexOf(id) })
const tabStyle = (item: { i: number, look: string }) => ({ '--i': item.i, '--look': item.look })

const medalStops = computed(() => props.milestones.map((item) => ({ name: item.campus?.name ?? '', year: item.year })))
const CAMPUS_SIZES = '(max-width: 900px) 50vw, 280px'

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
let controller: AboutSheets | null = null
let disposed = false
let narrow: MediaQueryList | null = null
async function start() {
  if (controller || disposed || !root.value || !narrow?.matches) return
  if (matchMedia('(forced-colors: active)').matches) return
  const loaded = await import('~/utils/about-sheets').catch(() => null)
  if (!loaded || disposed || controller || !root.value || !narrow.matches) return
  controller = loaded.createAboutSheets(root.value, { reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }, {
    // 讀到別章（家長那張被蓋住或還沒到）就停掉影片
    onSheet: (i) => { if (i !== indexOf('voices')) playing.value = false }
  })
}
// 平板轉向跨過 900px：窄了才建立、寬了就拆掉（桌機立體書由 AboutContent 管）
const onBreakpoint = () => { if (narrow?.matches) start(); else { controller?.destroy(); controller = null } }
onMounted(() => {
  narrow = matchMedia('(max-width: 900px)')
  narrow.addEventListener('change', onBreakpoint)
  start()
})
onBeforeUnmount(() => { disposed = true; narrow?.removeEventListener('change', onBreakpoint); controller?.destroy() })
</script>

<template>
  <div ref="root" class="ams" :style="{ '--tabs': sheets.length }">
    <!-- 頂端分頁列：讀進卡紙疊後才出現，目前那一章凸出來。鍵盤與報讀器用卡紙疊上方的目次（同一組連結） -->
    <div class="ams-band" data-ams-band aria-hidden="true">
      <div class="ams-band-tabs">
        <a v-for="item in sheets" :key="item.id" class="ams-tab" :href="`#${mid(item.id)}`" tabindex="-1" :data-ams-go="item.i" :style="tabStyle(item)">{{ item.name }}</a>
      </div>
    </div>

    <!-- 封面：標題、說明、兩張照片卡紙（同桌機首屏） -->
    <section class="ams-cover" aria-labelledby="about-m-title">
      <h1 id="about-m-title" class="ams-hero-title"><template v-for="(line, i) in pageTitleLines(page.heroTitle)" :key="i"><br v-if="i">{{ line }}</template></h1>
      <p class="ams-lede">{{ page.heroLede }}</p>
      <div class="ams-photos">
        <figure class="ams-photo is-hero">
          <img v-bind="withPhotoStyle(aboutHeroAttrs(page), page.heroPhoto)" :alt="pagePhotoAlt(HERO_ALT, page.heroPhoto, page.heroPhotoAlt)" loading="eager" fetchpriority="high">
          <figcaption v-if="page.heroCaption">{{ page.heroCaption }}</figcaption>
        </figure>
        <figure class="ams-photo is-back">
          <img v-bind="withPhotoStyle(pagePhotoAttrs('about-curious', page.heroBackPhoto, '(max-width: 900px) 34vw, 200px'), page.heroBackPhoto)" :alt="pagePhotoAlt(HERO_BACK_ALT, page.heroBackPhoto, page.heroBackPhotoAlt)" loading="lazy">
        </figure>
      </div>
    </section>

    <div class="ams-stack" data-ams-stack>
      <!-- 目次：整疊卡紙露出來的分頁，一章一個位置（後面幾張的上緣一張高 5px） -->
      <nav class="ams-deck" aria-label="目次">
        <ol>
          <li v-for="item in sheets" :key="item.id"><a class="ams-tab" :href="`#${mid(item.id)}`" :data-ams-go="item.i" :style="tabStyle(item)">{{ item.name }}</a></li>
        </ol>
      </nav>

      <!-- 一路走來：五校一列一校、照片左右交錯；紀念章在章名旁，往下讀時停在分頁列下方，讀到哪一校翻到哪一年 -->
      <section :id="mid('story')" class="ams-sheet ams-story" data-ams-sheet data-anchor="story" :style="sheetStyle('story')" aria-labelledby="about-m-story-title">
        <div class="ams-dock" aria-hidden="true"><AboutMedal class="ams-medal" :stops="medalStops" /></div>
        <h2 id="about-m-story-title" class="ams-title"><template v-for="(line, i) in pageTitleLines(page.storyTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
        <p class="ams-text">{{ page.storyText }}</p>
        <ol class="ams-camps">
          <li
            v-for="(item, i) in milestones" :key="item.key" class="ams-camp" data-ams-row :data-name="item.campus?.name ?? ''" :data-year="item.year"
            :style="{ '--c': milestoneLook(i).color, '--tint': `${milestoneLook(i).tint}%` }"
          >
            <div class="ams-card" aria-hidden="true">
              <img v-if="item.campus" v-bind="pickImage(item.campus.image, item.campus.imageMedia, CAMPUS_SIZES)" alt="" loading="lazy">
              <span v-else class="ams-blank" />
              <i>{{ item.campus?.name ?? '&nbsp;' }}</i>
            </div>
            <div class="ams-camp-text">
              <p class="ams-year"><span lang="en">{{ item.year }}</span><small>民國 {{ item.roc }} 年</small></p>
              <h3>{{ item.campus?.name ?? `${item.year} 年` }}<span v-if="item.campus">{{ item.campus.district }}</span></h3>
              <p>{{ item.text }}</p>
              <p v-if="item.campus?.address" class="ams-addr">{{ item.campus.address }}</p>
            </div>
          </li>
        </ol>
      </section>

      <!-- 全人教育：六圈（AboutWholePerson 收到 abk-open、看得見才播）＋核心素養 -->
      <section :id="mid('whole-child')" class="ams-sheet" data-ams-sheet data-anchor="whole-child" data-spread :style="sheetStyle('whole-child')" aria-labelledby="about-m-whole-title">
        <span class="ams-tab is-own" aria-hidden="true">{{ sheets[indexOf('whole-child')]?.name }}</span>
        <h2 id="about-m-whole-title" class="ams-title"><template v-for="(line, i) in pageTitleLines(page.wholeTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
        <p class="ams-text">{{ page.wholeText }}</p>
        <div class="ams-six"><AboutWholePerson /></div>
        <h3 class="ams-lits-h">帶得走的能力 · 六大核心素養</h3>
        <ol class="ams-lits"><li v-for="name in LITERACIES" :key="name">{{ name }}</li></ol>
        <p class="ams-fine">{{ page.wholeFine }}<small v-if="page.wholeFineSource">{{ page.wholeFineSource }}</small></p>
        <NuxtLink class="ams-link" to="/curriculum">看特色教學怎麼安排<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
      </section>

      <!-- 我們的期許：孩子的蠟筆畫（同桌機 AboutCrayon），畫到卡紙下緣 -->
      <section :id="mid('hope')" class="ams-sheet ams-hope" data-ams-sheet data-anchor="hope" data-hope :style="sheetStyle('hope')" aria-labelledby="about-m-hope-title">
        <span class="ams-tab is-own" aria-hidden="true">{{ sheets[indexOf('hope')]?.name }}</span>
        <h2 id="about-m-hope-title" class="ams-title"><template v-for="(line, i) in pageTitleLines(page.hopeTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
        <blockquote class="ams-quote"><p v-for="(quote, i) in page.hopeQuotes" :key="i">{{ quote }}</p></blockquote>
        <div class="ams-art">
          <div class="ams-print" aria-hidden="true">
            <AboutCrayon class="is-top" name="sky" view-box="0 0 1240 260" align="xMidYMin slice" />
            <AboutCrayon class="is-bottom" name="grass" view-box="0 0 1240 300" align="xMidYMax slice" />
          </div>
          <div class="ams-scene">
            <div class="ams-cut" aria-hidden="true" :style="sceneStyle(SCENE.treeL)"><AboutCrayon name="treeL" view-box="0 0 140 210" /></div>
            <div class="ams-cut" aria-hidden="true" :style="sceneStyle(SCENE.treeR)"><AboutCrayon name="treeR" view-box="0 0 116 220" /></div>
            <AboutCrayon class="ams-smoke" name="smoke" view-box="0 0 120 180" :style="sceneStyle(SCENE.smoke)" />
            <figure class="ams-cut" :style="sceneStyle(SCENE.house, 2)">
              <AboutCrayon name="house" view-box="0 0 300 340" />
              <span class="ams-window">
                <img v-bind="withPhotoStyle(pagePhotoAttrs('about-together', page.hopePhoto, '(max-width: 900px) 40vw, 200px'), page.hopePhoto)" :alt="pagePhotoAlt(HOPE_ALT, page.hopePhoto, page.hopePhotoAlt)" loading="lazy">
                <i class="ams-tape is-l" aria-hidden="true" /><i class="ams-tape is-r" aria-hidden="true" />
              </span>
              <AboutCrayon class="ams-vine" name="ivy" view-box="0 0 300 340" />
            </figure>
          </div>
        </div>
      </section>

      <!-- 家長怎麼說：大卡紙＋其他家長的小卡紙；沒有影片時整張不出現 -->
      <section v-if="voices.length" :id="mid('voices')" class="ams-sheet ams-voices" data-ams-sheet data-anchor="voices" :style="sheetStyle('voices')" aria-labelledby="about-m-voices-title">
        <span class="ams-tab is-own" aria-hidden="true">{{ sheets[indexOf('voices')]?.name }}</span>
        <h2 id="about-m-voices-title" class="ams-title is-quote"><template v-for="(line, i) in voiceTitle" :key="i"><br v-if="i">{{ line }}</template></h2>
        <p class="ams-cite">{{ voices[0]!.campus.name }}　{{ voices[0]!.speaker }}</p>
        <figure class="ams-tv">
          <div class="ams-tv-face" :class="{ 'is-swinging': swinging }">
            <div class="ams-video">
              <iframe
                v-if="playing" :src="youtubeEmbed(voices[shown]!.youtubeId)" :title="`${voices[shown]!.speaker}的分享影片`"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"
              />
              <a v-else class="ams-play" :href="`https://www.youtube.com/watch?v=${voices[shown]!.youtubeId}`" target="_blank" rel="noopener noreferrer" :aria-label="`播放${voices[shown]!.speaker}的分享影片（YouTube）`" @click.prevent="playing = true">
                <img v-bind="posterAttrs(voices[shown]!)" :alt="voices[shown]!.posterAlt ?? ''" loading="lazy" decoding="async">
                <span class="ams-play-mark" aria-hidden="true"><svg class="icon" focusable="false"><use href="#i-play" /></svg></span>
              </a>
            </div>
            <!-- 第一位的話已經是標題：大卡紙只寫是誰，換成別位才寫他的話 -->
            <figcaption aria-live="polite"><q v-if="shown">{{ voices[shown]!.quote }}</q><small>{{ voices[shown]!.speaker }} · {{ voices[shown]!.campus.name }}家長</small></figcaption>
          </div>
        </figure>
        <ol v-if="others.length" class="ams-thumbs">
          <li v-for="{ item, i } in others" :key="`${item.campus.key}-${i}`">
            <button type="button" :aria-label="`換成${item.speaker}：「${item.quote}」`" @click="pick(i)"><img v-bind="posterAttrs(item)" alt="" loading="lazy" decoding="async"><i>{{ item.speaker }}</i></button>
          </li>
        </ol>
        <!-- 「分享 ↗」不拆行：分與享之間 word joiner、箭頭前不斷行空格（同桌機） -->
        <template v-for="campus in voiceCampuses" :key="campus.key">
          <a v-if="campus.youtube" class="ams-yt" :href="campus.youtube" target="_blank" rel="noopener noreferrer">到{{ campus.name }} YouTube 看更多分&#8288;享&nbsp;↗<span class="sr-only">（另開新視窗）</span></a>
        </template>
      </section>

      <!-- 五所校園：五條書籤（同桌機結尾），點了到首頁那一校；分校停用時不放那一條 -->
      <section :id="mid('campuses')" class="ams-sheet ams-outro" data-ams-sheet data-anchor="campuses" :style="sheetStyle('campuses')" aria-labelledby="about-m-campuses-title">
        <span class="ams-tab is-own" aria-hidden="true">{{ page.outroTitle }}</span>
        <h2 id="about-m-campuses-title" class="ams-title">{{ page.outroTitle }}</h2>
        <p v-if="page.outroText" class="ams-text">{{ page.outroText }}</p>
        <ul class="ams-ribbons">
          <template v-for="(item, i) in milestones" :key="item.key">
            <li v-if="item.campus">
              <NuxtLink :to="{ path: '/', query: { campus: item.campus.key }, hash: '#campuses' }" :style="{ '--c': milestoneLook(i).color }"><b>{{ item.campus.name }}</b><small>{{ item.campus.district }}</small></NuxtLink>
            </li>
          </template>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped src="../assets/css/about-sheets.css"></style>
