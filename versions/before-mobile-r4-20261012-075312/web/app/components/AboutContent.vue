<script setup lang="ts">
// 關於常春藤頁主體（/about）。2026-09-26 從機構站 ivykidschool.com「關於常春藤 About」搬來：
// - 01 一路走來：沿革原文「民國86年義華路成立……110年仁武校」，五校各一個節點。
//   舊站寫「三十多個春夏秋冬」，1997 到今年未滿三十年，照首頁改成「近三十年」。
//   崇德校同年成立的「ESL 美語部」先不寫（美語補習班要不要露出還沒定案）。
// - 02 全人教育：舊站「全人教育理念」，六大領域與六大核心素養源自幼兒園教保活動課程大綱。
// - 03 我們的期許：舊站首頁「Our Goals」與「幼兒園是孩童第一所學校也是孩童第二個家」。
// 2026-10 起文字與照片改讀後台「關於常春藤頁」（about_page，預設＝fixture 的 aboutPage，一字不差）；六大領域、卡紙位置與顏色仍寫在這裡。
// 不綁 30 週年（週年版尚未拍板）。沿革的校名、照片跟著後台發布的分校資料；沿革五站固定，年份與說明在後台可改。
// 2026-09-29 改成「立體書」（使用者選定 J：design/about-style-directions-20260929/j-popup.*）：每段是一個跨頁，
// 左頁文字、右頁照片卡紙；捲到時右頁翻開、卡紙站起來；一路走來的五校、全人教育六圈聚合、期許是折起來的紙房子。
// 使用者要求不特別強調 2005 → 2020 相隔十五年：五站等距（紀念章每站捲動距離一樣）。頁面內容不放預約參觀（同常春藤環境、特色教學；
// 頁首全站共用的預約鈕照舊）。立體書由 utils/about-popup.ts 管理，Motion 只在這頁動態載入。
// 2026-10-01 只將右頁轉盤換成 AboutWholePerson 的 A2 六圈；沒有 JS 時書攤開、六圈顯示完成圖。
// 2026-10-02 精修（design/about-refine-mockup-20261002/，使用者「先這樣實作」）：首屏放目次與第二張卡紙、章名改中文、
// 右頁背面是章節封面、頁緣厚度跟著讀到哪裡變、紙條改成有站名的紙槽、紙房子加常春藤、結尾改成書底垂下的緞帶，
// 並新增「家長怎麼說」：讀各校後台的 testimonials（目前只有義華），沒有資料時整章不出現。
// 首屏照片裡的長輩是創辦人（使用者 2026-10-02 確認；姓名未提供，頁面不寫名字）。
// 2026-10-03 一路走來拿掉拉紙條，改成章名旁的紀念章（AboutMedal，比稿 design/about-medal-directions-20261003/，
// 使用者選「章名旁＋連續轉」）：跨頁釘住，往下捲紀念章一年一年翻、那一校的卡紙站起來。手機章名和卡紙不在同一個畫面，
// 紀念章改到右頁上緣接縫。義華創校年份 1997（業主 2026-10-03 裁定）。
import type { AboutPageContent, Campus, CampusTestimonial } from '~/types/site-content'
import { aboutHeroAttrs, pickImage } from '~/utils/media-image'
import { pagePhotoAlt, pagePhotoAttrs, pageTitleLines, rocYear, withPhotoStyle } from '~/utils/page-content'
import { youtubeEmbed } from '~/utils/filmCarousel'
import type { AboutPopup } from '~/utils/about-popup'

const props = defineProps<{ campuses: Campus[]; page: AboutPageContent }>()

// 沿革五站來自後台（年份可改，民國年＝西元 − 1911）；分校停用或下架時，那一年仍留在沿革裡，只是不放照片與連結。
const milestones = computed(() => props.page.milestones.map((item) => ({ ...item, roc: rocYear(item.year), campus: props.campuses.find((c) => c.key === item.key) })))
// 紀念章背面：校名／年份（沒有 JS 時第二面先印第一所）
const medalStops = computed(() => milestones.value.map((item) => ({ name: item.campus?.name ?? '', year: item.year })))

// 內建照片的說明（不開放編輯；後台換了照片就用後台的說明，沒填用素材庫的說明）
const HERO_ALT = '孩子們笑著圍在創辦人身邊，大家擠在一起'
const HERO_BACK_ALT = '孩子在教室裡開心地指向自己的發現'
const HOPE_ALT = '孩子們笑著圍在戴眼鏡的長輩身邊，大家開心地擠在一起'

// 右頁卡紙的位置（相對右頁舞台，百分比）：後排三張、前排兩張；卡紙底色輪流用品牌色，左頁沿革同一列用同色小方塊
// 五張一樣大（2026-10-03 使用者要求；原本前排兩張 42% 比後排大），前排對齊後排的兩道縫
const STAGE = [
  { x: 0, y: 46, w: 31, r: -1.5, color: 'var(--yellow)' },
  { x: 34.5, y: 52, w: 31, r: 0.8, color: 'var(--studio-blue)' },
  { x: 69, y: 46, w: 31, r: 1.6, color: 'var(--studio-sage)' },
  { x: 17.25, y: 4, w: 31, r: -1, color: 'var(--mint)' },
  { x: 51.75, y: 4, w: 31, r: 1.2, color: 'var(--studio-orange)' }
]
const cardStyle = (i: number) => {
  const s = STAGE[i]!
  return { '--x': `${s.x}%`, '--y': `${s.y}%`, '--w': `${s.w}%`, '--r': `${s.r}deg`, '--c': s.color, '--z': i >= 3 ? 3 : 1 }
}

// 六大領域的圓點與右頁六圈同色（順序同 AboutWholePerson）
const DOMAINS = [
  { name: '身體動作與健康', color: 'var(--ivy-whole-body)' },
  { name: '認知', color: 'var(--ivy-whole-cognition)' },
  { name: '語文', color: 'var(--ivy-whole-language)' },
  { name: '社會', color: 'var(--ivy-whole-social)' },
  { name: '情緒', color: 'var(--ivy-whole-emotion)' },
  { name: '美感', color: 'var(--ivy-whole-aesthetic)' }
]
const LITERACIES = ['覺知辨識', '表達溝通', '關懷合作', '推理賞析', '想像創造', '自主管理']

// 紙房子牆角的常春藤：一根藤＋七片三裂葉，房子站好後才長出來
const IVY_LEAF = 'M0 -11 C 3 -8, 8 -10, 11 -5 C 8 -2, 10 3, 6 7 C 3 5, 2 8, 0 11 C -2 8, -3 5, -6 7 C -10 3, -8 -2, -11 -5 C -8 -10, -3 -8, 0 -11 Z'
const IVY = [
  { x: 30, y: 198, a: -30 }, { x: 52, y: 170, a: 25 }, { x: 24, y: 138, a: -40 }, { x: 50, y: 104, a: 30 },
  { x: 28, y: 74, a: -25 }, { x: 56, y: 46, a: 35 }, { x: 40, y: 16, a: -10 }
]

// 結尾緞帶：顏色同卡紙色序，長短不一
const RIBBONS = [
  { color: 'var(--yellow)', length: 176 },
  { color: 'var(--studio-blue)', length: 196 },
  { color: 'var(--studio-sage)', length: 168 },
  { color: 'var(--mint)', length: 188 },
  { color: 'var(--studio-orange)', length: 172 }
]

// 家長怎麼說：各校後台的 testimonials，最多四位（右頁一張大卡紙＋後排三張）
const voices = computed(() => props.campuses
  .flatMap((campus) => (campus.testimonials ?? []).map((item: CampusTestimonial) => ({ ...item, campus })))
  .slice(0, 4))
const voiceCampuses = computed(() => [...new Map(voices.value.map((v) => [v.campus.key, v.campus])).values()])
// 標題用第一位家長的原話，在第一個逗號後換行
const voiceTitle = computed(() => {
  const quote = voices.value[0]?.quote ?? ''
  const cut = quote.indexOf('，')
  return cut > 0 && cut < quote.length - 1 ? [quote.slice(0, cut + 1), quote.slice(cut + 1)] : [quote]
})

// 章節：目次、章名、頁碼、章色、頁緣厚度（--n 第幾個跨頁，首屏是 0）都從這裡算；章名在後台
const NUMERALS = ['一', '二', '三', '四']
const CHAPTER_LOOKS = [
  { id: 'story', color: 'var(--yellow)' },
  { id: 'whole-child', color: 'var(--studio-blue)' },
  { id: 'hope', color: 'var(--studio-orange)' },
  { id: 'voices', color: 'var(--trail)' }
]
const chapters = computed(() => CHAPTER_LOOKS
  .map((look, i) => ({ ...look, name: props.page.chapterNames[i]! }))
  .filter((item) => item.id !== 'voices' || voices.value.length > 0)
  .map((item, i) => ({ ...item, label: `第${NUMERALS[i]}章`, page: 3 + i * 2, style: { '--n': i + 1, '--chap': item.color } })))
const chapterOf = (id: string) => chapters.value.find((item) => item.id === id)!

const root = ref<HTMLElement | null>(null)
const focusDomain = ref<number | null>(null)
const pickedVoice = ref(0) // 左頁清單馬上反應
const shownVoice = ref(0) // 右頁大卡紙倒下、換片、站起來時才換
const playing = ref(false)
const tv = ref<HTMLElement | null>(null)
const backVoices = computed(() => voices.value.map((item, index) => ({ item, index })).filter(({ index }) => index !== shownVoice.value).slice(0, 3))
const BACK = [
  { x: 0, y: 58, r: -2.5, color: 'var(--studio-sage)' },
  { x: 34.5, y: 63, r: 1, color: 'var(--cream)' },
  { x: 69, y: 58, r: 2.5, color: 'var(--mint)' }
]
const backStyle = (k: number) => {
  const s = BACK[k]!
  return { '--x': `${s.x}%`, '--y': `${s.y}%`, '--w': '31%', '--r': `${s.r}deg`, '--c': s.color, '--z': 1 }
}

let popup: AboutPopup | null = null
let disposed = false
function pickVoice(index: number) {
  if (index === pickedVoice.value) return
  pickedVoice.value = index
  const card = tv.value
  const apply = () => { shownVoice.value = index; playing.value = false }
  if (!card) { apply(); return }
  // 手機：清單和影片上下分開，選了就把影片捲進畫面
  const rect = card.getBoundingClientRect()
  if (rect.top < 0 || rect.bottom > innerHeight) card.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  const pops = [card, ...card.parentElement!.querySelectorAll<HTMLElement>('[data-back]')]
  if (popup) popup.swap(pops, apply)
  else apply()
}

onMounted(async () => {
  if (matchMedia('(forced-colors: active)').matches) return
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const loaded = await Promise.all([import('motion'), import('~/utils/about-popup')]).catch(() => null)
  if (!loaded || disposed || !root.value) return
  const [{ animate, scroll, inView }, { createAboutPopup }] = loaded
  popup = createAboutPopup(root.value, { animate, scroll, inView }, { reducedMotion })
})
onBeforeUnmount(() => { disposed = true; popup?.destroy() })
</script>

<template>
  <main id="main" ref="root" tabindex="-1" class="abk" data-cta-entry="about" :style="{ '--last': chapters.length }">
    <!-- 首屏：一整張攤開的跨頁（不翻）。左頁標題＋目次，右頁兩張照片卡紙前後站 -->
    <section class="abk-spread abk-hero" data-spread="static" style="--n:0" aria-labelledby="about-page-title">
      <div class="abk-hero-text">
        <span class="abk-ribbon" aria-hidden="true" />
        <h1 id="about-page-title"><template v-for="(line, i) in pageTitleLines(page.heroTitle)" :key="i"><br v-if="i">{{ line }}</template></h1>
        <p class="abk-lede">{{ page.heroLede }}</p>
      </div>
      <div class="abk-hero-art">
        <div class="abk-stage">
          <figure class="abk-pop is-back" :style="{ '--x': '0%', '--y': '44%', '--w': '36%', '--c': 'var(--studio-blue)', '--r': '-4deg', '--z': 1 }">
            <div class="abk-card"><img v-bind="withPhotoStyle(pagePhotoAttrs('about-curious', page.heroBackPhoto, '(max-width: 900px) 34vw, 200px'), page.heroBackPhoto)" :alt="pagePhotoAlt(HERO_BACK_ALT, page.heroBackPhoto, page.heroBackPhotoAlt)" loading="lazy"></div>
            <span class="abk-fold" aria-hidden="true" />
          </figure>
          <figure class="abk-pop is-hero" :style="{ '--x': '20%', '--y': '12%', '--w': '80%', '--c': 'var(--yellow)', '--r': '1.2deg', '--z': 2 }">
            <div class="abk-card">
              <img v-bind="withPhotoStyle(aboutHeroAttrs(page), page.heroPhoto)" :alt="pagePhotoAlt(HERO_ALT, page.heroPhoto, page.heroPhotoAlt)" loading="eager" fetchpriority="high">
              <figcaption>{{ page.heroCaption }}</figcaption>
            </div>
            <span class="abk-fold" aria-hidden="true" />
          </figure>
        </div>
      </div>
      <nav class="abk-toc" aria-labelledby="about-toc-title">
        <h2 id="about-toc-title">目次</h2>
        <ol>
          <li v-for="item in chapters" :key="item.id"><a :href="`#${item.id}`" :style="{ '--c': item.color }"><span>{{ item.name }}</span><i aria-hidden="true" /><b lang="en">{{ item.page }}</b></a></li>
          <li><a href="#campuses" style="--c:var(--leaf)"><span>{{ page.outroTitle }}</span><i aria-hidden="true" /><b>書籤</b></a></li>
        </ol>
      </nav>
      <span class="abk-edge is-l" aria-hidden="true" /><span class="abk-edge is-r" aria-hidden="true" />
      <span class="abk-no is-l" lang="en" aria-hidden="true">1</span><span class="abk-no is-r" lang="en" aria-hidden="true">2</span>
    </section>

    <!-- 第一章 一路走來：左頁沿革，章名旁是紀念章；跨頁釘住時往下捲，紀念章一年一年翻、五校卡紙一校一校站起來。
         外層軌道給釘住用（about-popup.ts 放得下才加 is-pinned，多一列撐出捲動距離）。 -->
    <div class="abk-track" data-medal-track>
    <section id="story" class="abk-spread abk-story" data-spread :style="chapterOf('story').style" aria-labelledby="story-title">
      <div class="abk-page is-left">
        <p class="abk-chap">{{ chapterOf('story').label }}<span>{{ chapterOf('story').name }}</span></p>
        <h2 id="story-title" class="abk-title"><template v-for="(line, i) in pageTitleLines(page.storyTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
        <AboutMedal class="is-title" :stops="medalStops" />
        <p class="abk-text">{{ page.storyText }}</p>
        <ol class="abk-list">
          <li v-for="(item, i) in milestones" :key="item.key" :style="{ '--c': STAGE[i]!.color }">
            <p class="abk-year"><span lang="en">{{ item.year }}</span><small>民國 {{ item.roc }} 年</small></p>
            <div>
              <span v-if="item.campus" class="abk-campus">{{ item.campus.name }}</span>
              <p>{{ item.text }}</p>
            </div>
          </li>
        </ol>
        <span class="abk-cast" aria-hidden="true" />
        <span class="abk-edge" aria-hidden="true" />
        <span class="abk-no" lang="en" aria-hidden="true">{{ chapterOf('story').page }}</span>
      </div>
      <div class="abk-page is-right">
        <div class="abk-face">
          <AboutMedal class="is-seam" :stops="medalStops" />
          <div class="abk-stage" aria-hidden="true">
            <div v-for="(item, i) in milestones" :key="item.key" class="abk-pop" :data-stop="item.campus?.name ?? ''" :data-year="item.year" :style="cardStyle(i)">
              <div class="abk-card">
                <b lang="en">{{ item.year }}</b>
                <img v-if="item.campus" v-bind="pickImage(item.campus.image, item.campus.imageMedia, '(max-width: 900px) 42vw, 250px')" alt="" loading="lazy">
                <span v-else class="abk-blank" />
                <i>{{ item.campus?.name ?? '&nbsp;' }}</i>
              </div>
              <span class="abk-fold" />
            </div>
          </div>
          <span class="abk-shade" aria-hidden="true" />
          <span class="abk-edge" aria-hidden="true" />
          <span class="abk-no" lang="en" aria-hidden="true">{{ chapterOf('story').page + 1 }}</span>
        </div>
        <div class="abk-cover" aria-hidden="true"><p>{{ chapterOf('story').label }}</p><b>{{ chapterOf('story').name }}</b><span class="abk-shade" /></div>
      </div>
    </section>
    </div>

    <!-- 第二章 全人教育：左頁兩份清單（領域圓點與右頁六圈同色），右頁 A2 透色六圈 -->
    <section id="whole-child" class="abk-spread" data-spread :style="chapterOf('whole-child').style" aria-labelledby="whole-title">
      <div class="abk-page is-left">
        <p class="abk-chap">{{ chapterOf('whole-child').label }}<span>{{ chapterOf('whole-child').name }}</span></p>
        <h2 id="whole-title" class="abk-title"><template v-for="(line, i) in pageTitleLines(page.wholeTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
        <p class="abk-text">{{ page.wholeText }}</p>
        <div class="abk-lists">
          <div>
            <h3>學習的面向 · 六大領域</h3>
            <ol class="abk-domains">
              <li v-for="(item, i) in DOMAINS" :key="item.name" :style="{ '--c': item.color }" @pointerenter="focusDomain = i" @pointerleave="focusDomain = null">{{ item.name }}</li>
            </ol>
          </div>
          <div>
            <h3>帶得走的能力 · 六大核心素養</h3>
            <ol class="abk-literacies"><li v-for="name in LITERACIES" :key="name">{{ name }}</li></ol>
          </div>
        </div>
        <p class="abk-fine">{{ page.wholeFine }}<small v-if="page.wholeFineSource">{{ page.wholeFineSource }}</small></p>
        <NuxtLink class="abk-link" to="/curriculum">看特色教學怎麼安排<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
        <span class="abk-cast" aria-hidden="true" />
        <span class="abk-edge" aria-hidden="true" />
        <span class="abk-no" lang="en" aria-hidden="true">{{ chapterOf('whole-child').page }}</span>
      </div>
      <div class="abk-page is-right">
        <div class="abk-face">
          <AboutWholePerson :focus="focusDomain" />
          <span class="abk-shade" aria-hidden="true" />
          <span class="abk-edge" aria-hidden="true" />
          <span class="abk-no" lang="en" aria-hidden="true">{{ chapterOf('whole-child').page + 1 }}</span>
        </div>
        <div class="abk-cover" aria-hidden="true"><p>{{ chapterOf('whole-child').label }}</p><b>{{ chapterOf('whole-child').name }}</b><span class="abk-shade" /></div>
      </div>
    </section>

    <!-- 第三章 我們的期許：左頁引言（括號取代左側色條），右頁紙房子，常春藤沿牆爬上屋簷 -->
    <section id="hope" class="abk-spread abk-hope" data-spread :style="chapterOf('hope').style" aria-labelledby="hope-title">
      <div class="abk-page is-left">
        <p class="abk-chap">{{ chapterOf('hope').label }}<span>{{ chapterOf('hope').name }}</span></p>
        <h2 id="hope-title" class="abk-title"><template v-for="(line, i) in pageTitleLines(page.hopeTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
        <blockquote class="abk-quote">
          <p v-for="(quote, i) in page.hopeQuotes" :key="i">{{ quote }}</p>
        </blockquote>
        <span class="abk-cast" aria-hidden="true" />
        <span class="abk-edge" aria-hidden="true" />
        <span class="abk-no" lang="en" aria-hidden="true">{{ chapterOf('hope').page }}</span>
      </div>
      <div class="abk-page is-right">
        <div class="abk-face">
          <div class="abk-stage abk-scene">
            <div class="abk-pop abk-ground" data-pop aria-hidden="true" :style="{ '--x': '-2%', '--y': '6%', '--w': '104%', '--z': 1 }"><div class="abk-card"><i /></div></div>
            <div class="abk-pop abk-tree is-l" data-pop aria-hidden="true" :style="{ '--x': '1%', '--y': '14%', '--w': '21%', '--z': 2 }">
              <div class="abk-card"><svg viewBox="0 0 100 160"><rect class="abk-trunk" x="46" y="96" width="8" height="64" rx="2" /><ellipse class="abk-crown" cx="50" cy="62" rx="40" ry="54" /><path class="abk-crown-shade" d="M50 8 A40 54 0 0 1 50 116 A26 54 0 0 0 50 8 Z" /></svg></div>
            </div>
            <div class="abk-pop abk-tree is-r" data-pop aria-hidden="true" :style="{ '--x': '80%', '--y': '14%', '--w': '18%', '--z': 2 }">
              <div class="abk-card"><svg viewBox="0 0 100 160"><rect class="abk-trunk" x="46" y="100" width="8" height="60" rx="2" /><ellipse class="abk-crown" cx="50" cy="60" rx="32" ry="58" /><path class="abk-crown-shade" d="M50 2 A32 58 0 0 1 50 118 A20 58 0 0 0 50 2 Z" /></svg></div>
            </div>
            <figure class="abk-pop abk-house" data-pop :style="{ '--x': '21%', '--y': '14%', '--w': '58%', '--z': 3 }">
              <div class="abk-card">
                <div class="abk-roof" aria-hidden="true"><span class="abk-chimney" /></div>
                <div class="abk-wall">
                  <span class="abk-window"><img v-bind="withPhotoStyle(pagePhotoAttrs('about-together', page.hopePhoto, '(max-width: 900px) 40vw, 200px'), page.hopePhoto)" :alt="pagePhotoAlt(HOPE_ALT, page.hopePhoto, page.hopePhotoAlt)" loading="lazy"></span>
                  <span class="abk-door" aria-hidden="true" />
                </div>
                <svg class="abk-ivy" viewBox="0 0 80 220" aria-hidden="true">
                  <path class="abk-ivy-stem" pathLength="1" d="M40 220 C 22 190, 52 168, 34 140 S 18 92, 40 70 S 58 26, 44 4" />
                  <g v-for="(leaf, i) in IVY" :key="i" :transform="`translate(${leaf.x} ${leaf.y}) rotate(${leaf.a})`"><path class="abk-ivy-leaf" :class="{ 'is-b': i % 2 }" :style="{ '--d': i }" :d="IVY_LEAF" /></g>
                </svg>
              </div>
            </figure>
          </div>
          <span class="abk-shade" aria-hidden="true" />
          <span class="abk-edge" aria-hidden="true" />
          <span class="abk-no" lang="en" aria-hidden="true">{{ chapterOf('hope').page + 1 }}</span>
        </div>
        <div class="abk-cover" aria-hidden="true"><p>{{ chapterOf('hope').label }}</p><b>{{ chapterOf('hope').name }}</b><span class="abk-shade" /></div>
      </div>
    </section>

    <!-- 第四章 家長怎麼說：左頁一句一位家長，點了右頁大卡紙倒下、換成那位家長再站起來；按播放才插 youtube-nocookie -->
    <section v-if="voices.length" id="voices" class="abk-spread abk-voices" data-spread :style="chapterOf('voices').style" aria-labelledby="voices-title">
      <div class="abk-page is-left">
        <p class="abk-chap">{{ chapterOf('voices').label }}<span>{{ chapterOf('voices').name }}</span></p>
        <h2 id="voices-title" class="abk-title"><template v-for="(line, i) in voiceTitle" :key="i"><br v-if="i">{{ line }}</template></h2>
        <p class="abk-cite">{{ voices[0]!.campus.name }}　{{ voices[0]!.speaker }}</p>
        <p class="abk-text">{{ voiceCampuses.map((c) => c.name).join('、') }}家長在學校 YouTube 頻道上的分享。點一句話，右頁就換成那位家長的影片。</p>
        <ol class="abk-voice-list">
          <li v-for="(item, i) in voices" :key="item.youtubeId">
            <button type="button" :aria-pressed="i === pickedVoice" @click="pickVoice(i)"><q>{{ item.quote }}</q><small>{{ item.speaker }}<template v-if="voiceCampuses.length > 1"> · {{ item.campus.name }}</template></small></button>
          </li>
        </ol>
        <template v-for="campus in voiceCampuses" :key="campus.key">
          <a v-if="campus.youtube" class="abk-link" :href="campus.youtube" target="_blank" rel="noopener noreferrer">到{{ campus.name }} YouTube 看更多分享 ↗<span class="sr-only">（另開新視窗）</span></a>
        </template>
        <span class="abk-cast" aria-hidden="true" />
        <span class="abk-edge" aria-hidden="true" />
        <span class="abk-no" lang="en" aria-hidden="true">{{ chapterOf('voices').page }}</span>
      </div>
      <div class="abk-page is-right">
        <div class="abk-face">
          <div class="abk-stage abk-theater">
            <div v-for="(back, k) in backVoices" :key="k" class="abk-pop is-thumb" data-pop data-back aria-hidden="true" :style="backStyle(k)" @click="pickVoice(back.index)">
              <div class="abk-card"><img :src="back.item.poster" alt="" width="800" height="450" loading="lazy" decoding="async"><i>{{ back.item.speaker }}</i></div>
              <span class="abk-fold" />
            </div>
            <figure ref="tv" class="abk-pop is-tv" data-pop :style="{ '--x': '5%', '--y': '4%', '--w': '90%', '--c': 'var(--trail)', '--r': '-.6deg', '--z': 3 }">
              <div class="abk-card">
                <div class="abk-video">
                  <iframe
                    v-if="playing" :src="youtubeEmbed(voices[shownVoice]!.youtubeId)" :title="`${voices[shownVoice]!.speaker}的分享影片`"
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"
                  />
                  <a v-else class="abk-play" :href="`https://www.youtube.com/watch?v=${voices[shownVoice]!.youtubeId}`" target="_blank" rel="noopener noreferrer" :aria-label="`播放${voices[shownVoice]!.speaker}的分享影片（YouTube）`" @click.prevent="playing = true">
                    <img :src="voices[shownVoice]!.poster" alt="" width="800" height="450" loading="lazy" decoding="async">
                    <span class="abk-play-mark" aria-hidden="true"><svg class="icon" focusable="false"><use href="#i-play" /></svg></span>
                  </a>
                </div>
                <figcaption aria-live="polite"><q>{{ voices[shownVoice]!.quote }}</q><small>{{ voices[shownVoice]!.speaker }} · {{ voices[shownVoice]!.campus.name }}家長</small></figcaption>
              </div>
              <span class="abk-fold" aria-hidden="true" />
            </figure>
          </div>
          <span class="abk-shade" aria-hidden="true" />
          <span class="abk-edge" aria-hidden="true" />
          <span class="abk-no" lang="en" aria-hidden="true">{{ chapterOf('voices').page + 1 }}</span>
        </div>
        <div class="abk-cover" aria-hidden="true"><p>{{ chapterOf('voices').label }}</p><b>{{ chapterOf('voices').name }}</b><span class="abk-shade" /></div>
      </div>
    </section>

    <!-- 結尾：五條緞帶書籤從書底垂下來，一條是一所校園 -->
    <section id="campuses" class="abk-outro" aria-labelledby="about-campuses-title">
      <div class="abk-outro-copy">
        <h2 id="about-campuses-title">{{ page.outroTitle }}</h2>
        <p>{{ page.outroText }}</p>
      </div>
      <ul class="abk-ribbons">
        <template v-for="(item, i) in milestones" :key="item.key">
          <li v-if="item.campus"><NuxtLink to="/#campuses" :style="{ '--c': RIBBONS[i]!.color, '--len': `${RIBBONS[i]!.length}px` }"><b>{{ item.campus.name }}</b><small>{{ item.campus.district }}</small></NuxtLink></li>
        </template>
      </ul>
    </section>
  </main>
</template>

<style scoped src="../assets/css/about.css"></style>
