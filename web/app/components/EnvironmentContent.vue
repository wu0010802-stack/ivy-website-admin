<script setup lang="ts">
// 常春藤環境頁主體（/environment）。2026-09-28 改成手繪版（使用者選定 mock C：
// design/environment-rough-mockup-20260928/），跟其他分頁刻意不同：點格紙、蠟筆色紙、Rough.js 手繪線、圓體字。
// 內容：幼兒保育、校園環境、幼兒餐點三章沿用 2026-09-25 從舊官網搬來的原文（只修錯字與標點）；
// 2026-10-12 起前三章的文字與照片改讀後台「常春藤環境頁」（environment_page，預設＝fixture 的 environmentPage，
// 一字不差），清單照索引對應下面的常數；便條位置與箭頭落點、太陽弧位置、結尾三張卡、營養餐點書連結與各章目次
// 小字的計數仍寫在這裡。第四章「五所校園」的場景直接讀後台發布的各校校園探索（campuses[].tourScenes）。
// 2026-09-29 使用者裁定：第四章照片上不畫標註點的便條與箭頭（分校頁校園探索的熱點照舊）。
// 2026-09-28 使用者裁定：這一頁不放預約參觀（全站共用的頁首預約鈕除外）。
// 手繪線條由 utils/rough-sketch.ts 在瀏覽器畫上去，純裝飾；沒有 JS 時版面與文字照常。
// 2026-09-28 加 GSAP 動態層（utils/environment-motion.ts；比稿 design/environment-gsap-mockup-20260928/）：
// 小路改成小腳印、曬衣繩起風、太陽帶慣性、換校發牌。GSAP 跟 Rough.js 一樣只在這頁動態載入；載入失敗就照原本的虛線小路。
// 2026-10-19 加蠟筆塗鴉層（utils/environment-doodles.ts；比稿 design/environment-playful-directions-20261019/ 選 A）：
// 孩子在聯絡簿空白處畫的太陽、小鳥、彩虹、風箏、泡泡、兔子、香蕉蘋果、手印，選到的學校把校舍塗上顏色。
// 位置是模板裡空的 [data-doodle]（aria-hidden），手繪層畫完後才動態載入那支來畫；載入失敗就沒有塗鴉，其餘照常。
import type { Campus, EnvironmentPageContent, TourScene } from '~/types/site-content'
import { environmentHeroAttrs } from '~/utils/media-image'
import { responsiveImage } from '~/utils/responsive-image'
import { pageMarkedLines, pagePhotoAlt, pagePhotoAttrs, pagePhotoStyle, pageTitleLines, withPhotoStyle } from '~/utils/page-content'
import { responsiveTourImage } from '~/utils/tour-image'
import { mealBookLink } from '~/utils/meal-book'
import { attachEnvironmentFontStylesheet, ENVIRONMENT_FONT_PRELOAD } from '~/utils/environment-fonts'
import type { SketchHandle } from '~/utils/rough-sketch'
import type { EnvironmentMotion } from '~/utils/environment-motion'
import type { EnvironmentDoodles } from '~/utils/environment-doodles'

const props = defineProps<{ campuses: Campus[]; page: EnvironmentPageContent }>()

// 內建照片與它的位置、說明留在這裡（後台沒換照片時用；換了照片就用後台的圖、焦點與說明，
// 後台沒填說明則用素材庫的說明）。文字（標題、說明、便條）讀 props.page，清單照索引對應。
const HERO_ALT = '兩個孩子在教室裡緊緊抱在一起'
const CARE_PHOTO_ALT = '老師拿著鈴鼓，帶幼幼班孩子一起拍手唱歌'
const FEATURE_ALT = '校園裡色彩繽紛的溜滑梯與遊戲設施'
// 2026-10-30 均衡飲食、衣物保暖、情緒安撫換成義華校 NAS 素材庫的照片（舊照是疫情期間、戴口罩的 1961×934），
// 母檔 1600×1200 與框同為 4:3，不必再靠 pos 對位；健康把關、定時消毒 NAS 沒有對應場景，沒換。
const CARE = [
  { image: 'env-care-health', pos: '32% 50%', alt: '老師幫戴著口罩的孩子確認身體狀況' },
  { image: 'env-care-meal', pos: '50% 50%', alt: '男孩拿著湯匙，從紅色碗裡舀飯吃' },
  { image: 'env-care-clothes', pos: '50% 50%', alt: '穿著淺藍色羽絨外套的女孩站在桌邊' },
  { image: 'env-care-comfort', pos: '50% 50%', alt: '老師坐著把眼眶泛紅的男孩抱在懷裡' },
  { image: 'env-care-clean', pos: '62% 60%', alt: '老師擦拭消毒教室門把' }
]

// 便條（note）只標照片 alt 已經寫到的細節；to 是箭頭指到照片寬高的比例位置（照片不裁切），noteAt 是便條的位置，
// 兩個都依格子序號固定（後台換照片後箭頭可能沒指準）。只有戶外廣場確定是明華校的照片（舊站檔名「明華戶外廣場」），
// 其餘校別不明，不標（後台 campusLabel）。doodle 是坐在那張照片上緣的蠟筆塗鴉（戶外廣場的風箏、洗手台的泡泡、
// 可愛動物區抱紅蘿蔔的兔子），一樣依格子序號固定。
const SPACES = [
  { image: 'env-space-classroom', alt: '陽光照進木地板教室，牆邊是矮櫃與小桌椅', noteAt: 'is-n1', to: '0.42,0.74' },
  { image: 'env-space-materials', alt: '教室矮櫃上擺滿各式操作教具', noteAt: 'is-n2', to: '0.36,0.52' },
  { image: 'env-space-plaza', alt: '明華校寬敞的戶外廣場', noteAt: 'is-n3', to: '0.58,0.76', doodle: 'kite' },
  { image: 'env-space-corner', alt: '教室角落貼著厚軟墊，地上鋪著巧拼', noteAt: 'is-n4', to: '0.62,0.58' },
  { image: 'env-space-restroom', alt: '孩子高度的洗手台，掛著一排小毛巾', noteAt: 'is-n5', to: '0.52,0.44', doodle: 'bubbles' },
  { image: 'env-space-animals', alt: '孩子蹲在圍欄邊，拿紅蘿蔔餵裡面的小兔子', noteAt: 'is-n6', to: '0.40,0.66', doodle: 'bunny' }
]

// 時間與說明取自舊站一日流程的早餐、蔬果、午餐、點心各段；t 是在太陽弧上的位置（0 早、1 晚），照序號固定，
// 所以後台的餐點時間要由早到晚。
const MEAL_T = [0, 0.25, 0.5, 0.75, 1]
// 「每日兩蔬果」之一、之二旁邊畫的香蕉與蘋果（蠟筆塗鴉）
const MEAL_DOODLES = ['', 'banana', '', 'apple', '']

const heroLines = computed(() => pageMarkedLines(props.page.heroTitle, props.page.heroHighlight))
const careItems = computed(() => props.page.careItems.map((item, i) => ({ ...CARE[i]!, ...item })))
const spaces = computed(() => props.page.spaces.map((space, i) => ({ ...SPACES[i]!, ...space })))
const meals = computed(() => props.page.meals.map((item, i) => ({ ...item, t: MEAL_T[i]!, doodle: MEAL_DOODLES[i] })))

// 結尾不放預約，改成往站內其他分頁走；提示字取自各頁的章節名
const NEXT = [
  { href: '/#life', title: '孩子的一天', hint: '六個日常片刻' },
  { href: '/curriculum', title: '特色教學', hint: '四個年段與課程方向' },
  { href: '/admission', title: '入學資訊', hint: '入學流程、分班對照' }
]

const meal = mealBookLink()

// 第四章：只收有場景的校
const tours = computed(() => props.campuses
  .map((campus) => ({ campus, scenes: campus.tourScenes }))
  .filter((tour): tour is { campus: Campus; scenes: TourScene[] } => tour.scenes.length > 0))
const sceneCount = computed(() => tours.value.reduce((sum, tour) => sum + tour.scenes.length, 0))
const active = ref('')
const activeKey = computed(() => (tours.value.some((tour) => tour.campus.key === active.value) ? active.value : tours.value[0]?.campus.key))
const sceneImage = (scene: TourScene, lead: boolean) => responsiveTourImage(scene.image, lead ? '(max-width: 900px) 92vw, 700px' : '(max-width: 900px) 92vw, 560px', false, scene.imageMedia)

const chapters = computed(() => [
  { id: 'care', label: props.page.chapterNames[0], hint: '五顆心的照顧' },
  { id: 'spaces', label: props.page.chapterNames[1], hint: `${SPACES.length + 1} 個孩子的空間` },
  { id: 'meals', label: props.page.chapterNames[2], hint: `${meal.month} 月菜單` },
  ...(tours.value.length ? [{ id: 'campuses', label: props.page.chapterNames[3], hint: `${sceneCount.value} 個校園角落` }] : [])
].map((chapter, i) => ({ ...chapter, no: String(i + 1).padStart(2, '0') })))
const chapterNo = (id: string) => chapters.value.find((chapter) => chapter.id === id)?.no

// ---------- 分頁（WAI-ARIA tabs：左右鍵、Home、End） ----------
const tabRefs = ref<HTMLButtonElement[]>([])
async function selectTab(key: string, focus = false) {
  const changed = key !== activeKey.value
  active.value = key
  await nextTick()
  const tab = tabRefs.value.find((button) => button.dataset.key === key)
  if (focus) tab?.focus()
  sketch?.refresh(root.value?.querySelector('#campuses') ?? undefined)
  // 真的換了校，新分頁的照片從校名那格發到桌上（動態層在減少動態時不做）
  const panel = root.value?.querySelector<HTMLElement>(`#tour-${key}`)
  if (changed && panel && tab) motion?.deal(panel, tab)
}
function onTabKey(event: KeyboardEvent, index: number) {
  const target = ({ ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tours.value.length - 1 } as Record<string, number>)[event.key]
  if (target === undefined) return
  event.preventDefault()
  const count = tours.value.length
  void selectTab(tours.value[(target + count) % count]!.campus.key, true)
}

useHead({ link: ENVIRONMENT_FONT_PRELOAD.map((href) => ({ rel: 'preload', as: 'font', type: 'font/woff2', href, crossorigin: '' })) })

const root = ref<HTMLElement | null>(null)
let sketch: SketchHandle | null = null
let motion: EnvironmentMotion | null = null
let doodles: EnvironmentDoodles | null = null
let disposed = false
// GSAP 三支與動態層一起載入；任何一支失敗就不用動態層（回傳 null），手繪線照常
const loadMotion = (reducedMotion: boolean) => Promise.all([import('gsap'), import('gsap/ScrollTrigger'), import('gsap/MotionPathPlugin'), import('~/utils/environment-motion')])
  .then(([{ gsap }, { ScrollTrigger }, { MotionPathPlugin }, { createEnvironmentMotion }]) => createEnvironmentMotion({ gsap, ScrollTrigger, MotionPathPlugin }, { reducedMotion }))
  .catch(() => null)
onMounted(async () => {
  attachEnvironmentFontStylesheet(document)
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  // 塗鴉層跟著一起下載，等手繪層畫完才畫（不跟首屏的手繪線搶主執行緒）；載入失敗就沒有塗鴉
  const loadDoodles = import('~/utils/environment-doodles').then(({ createEnvironmentDoodles }) => createEnvironmentDoodles).catch(() => null)
  const [{ default: rough }, { createRoughSketch }, loaded] = await Promise.all([import('roughjs'), import('~/utils/rough-sketch'), loadMotion(reducedMotion)])
  if (disposed || !root.value) { loaded?.destroy(); return }
  motion = loaded
  sketch = createRoughSketch(root.value, rough, { reducedMotion, motion: motion ?? undefined })
  // 手繪線首屏以外分批畫（見 rough-sketch 的 drawFirst）；小路與上面的便條、箭頭都畫好了，動態層才收起便條、接上捲動
  await sketch.ready
  if (!disposed && root.value) motion?.start(root.value)
  const createDoodles = await loadDoodles
  if (!disposed && root.value && createDoodles) doodles = createDoodles(root.value, { reducedMotion })
})
onBeforeUnmount(() => { disposed = true; sketch?.destroy(); motion?.destroy(); doodles?.destroy() })
// 後台即時預覽（pages/preview.vue）會一直換 page／campuses：文字變長變短、照片換掉後版面高度跟著變，
// 手繪的框、章節底紙、便條箭頭要依新版面重畫（rough-sketch 只在掛載與視窗改寬時自己重畫；
// 文字被換掉時 Vue 也會順手清掉宿主裡的手繪層）。flush: 'post' 等畫面更新完再量，同一個 tick 內改好幾處只畫一次。
// 正式頁的 props 不會再變，這裡不會觸發；手繪層還沒建好時略過，第一次渲染本來就量最新版面。
// 塗鴉跟著手繪層之後：小鳥踩回重畫過的曬衣繩，重建的校園分頁補上塗色。
watch([() => props.page, () => props.campuses], () => { if (root.value) { sketch?.refresh(root.value); doodles?.refresh() } }, { deep: true, flush: 'post' })
</script>

<template>
  <main id="main" ref="root" tabindex="-1" class="renv" data-cta-entry="environment">
    <!-- 首屏：一頁攤開的聯絡簿 -->
    <section class="renv-hero" aria-labelledby="environment-title">
      <span class="renv-doodle is-sun" data-doodle="sun" aria-hidden="true" />
      <div class="renv-wrap renv-hero-grid">
        <div>
          <h1 id="environment-title"><template v-for="(line, i) in heroLines" :key="i"><br v-if="i">{{ line.before }}<span v-if="line.mark" class="renv-mark" data-rough="highlight" data-seed="11">{{ line.mark }}</span>{{ line.after }}</template></h1>
          <p v-if="page.heroLede" class="renv-lede">{{ page.heroLede }}</p>
          <p v-if="page.heroNotice" class="renv-notice">{{ page.heroNotice }}</p>
        </div>
        <figure class="renv-hero-photo renv-snap" data-rough="frame" data-seed="31">
          <img v-bind="withPhotoStyle(environmentHeroAttrs(page), page.heroPhoto)" :alt="pagePhotoAlt(HERO_ALT, page.heroPhoto, page.heroPhotoAlt)" loading="eager" fetchpriority="high">
          <span class="renv-tape is-tl" data-rough="tape" data-seed="32" />
          <span class="renv-tape is-br" data-rough="tape" data-seed="33" />
          <figcaption class="renv-hand">{{ page.heroCaption }}</figcaption>
        </figure>
      </div>
      <nav class="renv-wrap renv-index" aria-label="本頁章節">
        <ol>
          <li v-for="(chapter, i) in chapters" :key="chapter.id">
            <a :href="`#${chapter.id}`" :data-chapter="chapter.id">
              <span class="renv-box" data-rough="check" :data-seed="41 + i" aria-hidden="true" />
              <span class="renv-num" lang="en">{{ chapter.no }}</span><b>{{ chapter.label }}</b><span class="renv-hint">{{ chapter.hint }}</span>
            </a>
          </li>
        </ol>
      </nav>
    </section>

    <!-- 01 幼兒保育：五顆心＋曬衣繩 -->
    <section id="care" class="renv-section renv-care" aria-labelledby="care-title">
      <div class="renv-sheet" data-rough="sheet" data-sheet="care" data-seed="50" aria-hidden="true" />
      <div class="renv-wrap">
        <div class="renv-care-top">
          <div>
            <p class="renv-kicker"><span class="renv-box" data-rough="check" data-seed="51" data-chapter-check="care" aria-hidden="true" /><span lang="en">{{ chapterNo('care') }}</span>{{ page.chapterNames[0] }}</p>
            <h2 id="care-title" class="renv-title"><template v-for="(line, i) in pageTitleLines(page.careTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
            <p class="renv-text">{{ page.careLead }}</p>
            <ul class="renv-hearts">
              <li v-for="(heart, i) in page.hearts" :key="i"><span class="renv-heart" data-rough="heart" :data-seed="61 + i" aria-hidden="true" /><b>{{ heart }}</b></li>
            </ul>
            <p v-if="page.careText" class="renv-text">{{ page.careText }}</p>
          </div>
          <figure class="renv-care-photo renv-snap" data-rough="frame" data-seed="70">
            <img v-bind="withPhotoStyle(pagePhotoAttrs('env-care-teacher', page.carePhoto, '(max-width: 900px) 138vw, 880px'), page.carePhoto)" :alt="pagePhotoAlt(CARE_PHOTO_ALT, page.carePhoto, page.carePhotoAlt)" loading="lazy">
            <span class="renv-tape is-tr" data-rough="tape" data-seed="71" />
            <span class="renv-note is-care" aria-hidden="true" data-rough="note" data-seed="72" data-to="0.13,0.22">{{ page.carePhotoNote }}</span>
            <figcaption class="renv-hand">{{ page.careCaption }}</figcaption>
          </figure>
        </div>
        <div class="renv-hang" tabindex="0" role="region" aria-label="五件照顧的小事">
          <ol class="renv-hang-track" data-rough="clothesline" data-seed="80">
            <li v-for="(item, i) in careItems" :key="item.image" class="renv-hang-item">
              <figure class="renv-hang-photo" data-rough="frame" :data-seed="81 + i">
                <img v-bind="pagePhotoAttrs(item.image, item.photo, '(max-width: 900px) 410px, 345px')" :alt="pagePhotoAlt(item.alt, item.photo, item.photoAlt)" :style="pagePhotoStyle(item.pos, item.photo)" loading="lazy">
              </figure>
              <h3><span class="renv-count" data-rough="circle" :data-seed="86 + i" lang="en">{{ i + 1 }}</span>{{ item.title }}</h3>
              <p>{{ item.text }}</p>
            </li>
          </ol>
          <span class="renv-doodle is-bird" data-doodle="bird" aria-hidden="true" />
        </div>
      </div>
    </section>

    <!-- 02 校園環境：跟著小腳印走一圈 -->
    <section id="spaces" class="renv-section renv-spaces" aria-labelledby="spaces-title">
      <div class="renv-wrap">
        <div class="renv-split-head">
          <p class="renv-kicker"><span class="renv-box" data-rough="check" data-seed="101" data-chapter-check="spaces" aria-hidden="true" /><span lang="en">{{ chapterNo('spaces') }}</span>{{ page.chapterNames[1] }}</p>
          <h2 id="spaces-title" class="renv-title"><template v-for="(line, i) in pageTitleLines(page.spacesTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
          <p v-if="page.spacesText" class="renv-text">{{ page.spacesText }}</p>
        </div>
        <article class="renv-feature">
          <figure class="renv-feature-photo renv-snap" data-rough="frame" data-seed="110">
            <img v-bind="withPhotoStyle(pagePhotoAttrs('env-space-playground', page.feature.photo, '(max-width: 900px) 92vw, 680px'), page.feature.photo)" :alt="pagePhotoAlt(FEATURE_ALT, page.feature.photo, page.feature.photoAlt)" loading="lazy">
            <span class="renv-tape is-tl" data-rough="tape" data-seed="111" />
            <span class="renv-tape is-tr" data-rough="tape" data-seed="112" />
            <span class="renv-note is-slide" aria-hidden="true" data-rough="note" data-seed="113" data-to="0.12,0.66">{{ page.feature.note }}</span>
          </figure>
          <div class="renv-feature-copy">
            <span class="renv-doodle is-rainbow" data-doodle="rainbow" aria-hidden="true" />
            <p class="renv-tag" data-rough="tagfill" data-seed="114">{{ page.feature.tag }}</p>
            <h3><template v-for="(line, i) in pageTitleLines(page.feature.title)" :key="i"><br v-if="i">{{ line }}</template></h3>
            <p>{{ page.feature.text }}</p>
          </div>
        </article>
        <p v-if="page.trailHint" class="renv-hand renv-trail-hint" aria-hidden="true">{{ page.trailHint }}</p>
        <ol class="renv-trail" data-rough="trail" data-seed="120">
          <li v-for="(space, i) in spaces" :key="space.image" class="renv-stop">
            <figure class="renv-stop-photo renv-snap" data-rough="frame" :data-seed="121 + i">
              <img v-bind="withPhotoStyle(pagePhotoAttrs(space.image, space.photo, '(max-width: 760px) calc(100vw - 96px), (max-width: 1100px) 45vw, 530px'), space.photo)" :alt="pagePhotoAlt(space.alt, space.photo, space.photoAlt)" loading="lazy">
              <span v-if="space.campusLabel" class="renv-campus" data-rough="tagfill" data-seed="150">{{ space.campusLabel }}</span>
              <span class="renv-note" :class="space.noteAt" aria-hidden="true" data-rough="note" :data-seed="131 + i" :data-to="space.to">{{ space.note }}</span>
              <span v-if="space.doodle" class="renv-doodle" :class="`is-${space.doodle}`" :data-doodle="space.doodle" aria-hidden="true" />
            </figure>
            <div class="renv-stop-copy">
              <span class="renv-stop-no" data-rough="stop" :data-seed="141 + i" lang="en">{{ i + 1 }}</span>
              <h3>{{ space.title }}</h3>
              <p>{{ space.text }}</p>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <!-- 03 幼兒餐點：太陽走過的一天 -->
    <section id="meals" class="renv-section renv-meals" aria-labelledby="meals-title">
      <div class="renv-sheet" data-rough="sheet" data-sheet="meals" data-seed="200" aria-hidden="true" />
      <div class="renv-wrap">
        <div class="renv-meals-top">
          <div>
            <p class="renv-kicker"><span class="renv-box" data-rough="check" data-seed="201" data-chapter-check="meals" aria-hidden="true" /><span lang="en">{{ chapterNo('meals') }}</span>{{ page.chapterNames[2] }}</p>
            <h2 id="meals-title" class="renv-title"><template v-for="(line, i) in pageTitleLines(page.mealsTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
            <p class="renv-text">{{ page.mealsText }}</p>
            <a class="renv-btn" :href="meal.href" target="_blank" rel="noopener" data-rough="button" data-seed="202">{{ meal.label }}<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-up-right" /></svg><span class="sr-only">（另開新視窗）</span></a>
          </div>
          <div class="renv-book">
            <a class="renv-book-cover" :href="meal.href" target="_blank" rel="noopener" :aria-label="`打開營養餐點書的 ${meal.month} 月菜單（另開新視窗）`" data-rough="frame" data-seed="210">
              <img v-bind="responsiveImage('env-meal-book', '(max-width: 900px) 220px, 300px')" alt="" loading="lazy">
              <span class="renv-tape is-top" data-rough="tape" data-seed="211" />
            </a>
            <p class="renv-hand renv-book-note" aria-hidden="true" data-rough="bookarrow" data-seed="212"><span>{{ meal.month }} 月</span>的菜單，<br>翻到這一頁</p>
          </div>
        </div>
        <div class="renv-day" data-rough="sunpath" data-seed="220">
          <p class="renv-hand renv-day-title">{{ page.mealsDayTitle }}</p>
          <ol class="renv-day-list">
            <li v-for="(item, i) in meals" :key="i" class="renv-meal" :data-t="item.t">
              <time lang="en">{{ item.time }}</time><b><span class="renv-meal-name">{{ item.name }}<span v-if="item.doodle" class="renv-doodle" :class="`is-${item.doodle}`" :data-doodle="item.doodle" aria-hidden="true" /></span></b><small>{{ item.note }}</small>
              <p v-if="item.text">{{ item.text }}</p>
            </li>
          </ol>
        </div>
      </div>
    </section>

    <!-- 04 五所校園：各校校園探索的實景（後台 campus_tour 發布的內容） -->
    <section v-if="tours.length" id="campuses" class="renv-section renv-tour" aria-labelledby="tour-title">
      <div class="renv-wrap">
        <div class="renv-split-head">
          <p class="renv-kicker"><span class="renv-box" data-rough="check" data-seed="401" data-chapter-check="campuses" aria-hidden="true" /><span lang="en">{{ chapterNo('campuses') }}</span>{{ page.chapterNames[3] }}</p>
          <h2 id="tour-title" class="renv-title"><template v-for="(line, i) in pageTitleLines(page.tourTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
          <p v-if="page.tourText" class="renv-text">{{ page.tourText }}</p>
        </div>
        <p v-if="page.tourHint" class="renv-hand renv-tour-hint" aria-hidden="true">{{ page.tourHint }}</p>
        <div class="renv-tour-tabs" role="tablist" aria-label="選一所校園">
          <button
            v-for="(tour, i) in tours"
            :id="`tour-tab-${tour.campus.key}`"
            :key="tour.campus.key"
            ref="tabRefs"
            type="button"
            role="tab"
            class="renv-tour-tab"
            :data-key="tour.campus.key"
            :aria-controls="`tour-${tour.campus.key}`"
            :aria-selected="tour.campus.key === activeKey"
            :tabindex="tour.campus.key === activeKey ? 0 : -1"
            data-rough="tab"
            :data-seed="500 + i"
            @click="selectTab(tour.campus.key)"
            @keydown="onTabKey($event, i)"
          >
            <span class="renv-tour-art">
              <span class="renv-tour-paint" data-tour-paint :data-campus="tour.campus.key" aria-hidden="true" />
              <img v-bind="responsiveImage(`campus-line-art-${tour.campus.key}-ink`, '(max-width: 900px) 124px, 170px')" alt="" loading="lazy" decoding="async">
            </span>
            <b>{{ tour.campus.name }}</b><small>{{ tour.campus.district }}・{{ tour.scenes.length }} 個角落</small>
          </button>
        </div>
        <div
          v-for="(tour, t) in tours"
          :id="`tour-${tour.campus.key}`"
          :key="tour.campus.key"
          class="renv-tour-panel"
          role="tabpanel"
          :aria-labelledby="`tour-tab-${tour.campus.key}`"
          tabindex="0"
          :hidden="tour.campus.key !== activeKey"
        >
          <ul class="renv-scenes" :class="`is-${Math.min(tour.scenes.length, 3)}`">
            <li v-for="(scene, s) in tour.scenes" :key="scene.key" class="renv-scene">
              <figure class="renv-scene-photo renv-snap" data-rough="frame" :data-seed="600 + t * 60 + s * 21">
                <img v-bind="sceneImage(scene, s === 0 && tour.scenes.length !== 2)" :alt="`${tour.campus.name}的${scene.name}`" loading="lazy" decoding="async">
                <span class="renv-tape" :class="s % 2 ? 'is-tr' : 'is-tl'" data-rough="tape" :data-seed="601 + t * 60 + s * 21" />
              </figure>
              <div class="renv-scene-copy">
                <h3 class="renv-scene-name" data-rough="tagfill" :data-seed="602 + t * 60 + s * 21">{{ scene.name }}</h3>
                <p>{{ scene.intro }}</p>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- 結尾：接下來可以看（不放預約） -->
    <section class="renv-section renv-next" aria-labelledby="next-title">
      <div class="renv-wrap">
        <h2 id="next-title" class="renv-hand renv-next-title">還可以看看這幾頁</h2>
        <span class="renv-doodle is-hand" data-doodle="hand" aria-hidden="true" />
        <ul class="renv-next-list">
          <li v-for="(item, i) in NEXT" :key="item.href">
            <NuxtLink class="renv-next-link" :to="item.href" data-rough="card" :data-seed="451 + i"><b>{{ item.title }}</b><small>{{ item.hint }}</small></NuxtLink>
          </li>
        </ul>
      </div>
    </section>
  </main>
</template>

<style src="../assets/css/environment-fonts.css"></style>
<style src="../assets/css/environment.css"></style>
