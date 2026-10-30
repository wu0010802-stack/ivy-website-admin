<script setup lang="ts">
// 常春藤環境頁主體（/environment）。2026-10-30 改成「木頭積木」版（比稿 design/environment-style-directions-20261030/，
// 使用者選 D，再要求校園環境與幼兒餐點照 A 用圓點串起來、照片不放說明或註解＝D2）：北歐木玩／蒙特梭利教具的幾何，
// 照片裝在積木形狀裡，每塊積木有同色深一階的「側面」表現厚度；取代 09-28 起的手繪版（Rough.js 手繪線、GSAP 小腳印、蠟筆塗鴉）。
// 內容：前三章的文字與照片讀後台「常春藤環境頁」（environment_page，預設＝fixture 的 environmentPage），清單照索引對應下面的常數；
// 第四章「五所校園」讀後台發布的各校校園探索（campuses[].tourScenes）。
// 照片不放說明與註解（使用者 10-30）：首屏與保育主照片的圖說、照片上的便條、小路與選校提示、校園探索各景的說明句都不畫；
// 後台欄位照舊保留。戶外廣場照片上的「明華校」是校別標示（後台 campusLabel），照畫。
// 2026-09-28 使用者裁定：這一頁不放預約參觀（全站共用的頁首預約鈕除外）。
// 動態只有兩樣，都在瀏覽器才做、減少動態時不做：積木由上往下落定（只套在一開始不在視窗裡的元素），
// 圓點小路捲到才一顆顆亮（utils/environment-route.ts）。
import type { Campus, EnvironmentPageContent, TourScene } from '~/types/site-content'
import { environmentHeroAttrs } from '~/utils/media-image'
import { responsiveImage } from '~/utils/responsive-image'
import { pageMarkedLines, pagePhotoAlt, pagePhotoAttrs, pagePhotoStyle, pageTitleLines } from '~/utils/page-content'
import { responsiveTourImage } from '~/utils/tour-image'
import { mealBookLink } from '~/utils/meal-book'
import { attachEnvironmentFontStylesheet, ENVIRONMENT_FONT_PRELOAD } from '~/utils/environment-fonts'
import type { EnvironmentRoutes } from '~/utils/environment-route'

const props = defineProps<{ campuses: Campus[]; page: EnvironmentPageContent }>()

// 積木色：c-<名> 在 environment.css 對到正面色與側面色
type Block = 'terra' | 'mustard' | 'sage' | 'mist' | 'pink'
// 照片積木的樣子：形狀、寬高比（寬/高）、正面色、後面錯開墊的積木 [形狀, 色, 寬高比]、照片寬（佔欄寬）、墊塊錯開量、內建照片的位置
interface Look { shape: string; ar?: number; color: Block; back?: [string, Block, number?]; w?: string; bx?: string; by?: string; q?: string; pos?: string }

// 內建照片與它的 alt 留在這裡（後台沒換照片時用；換了照片就用後台的圖、焦點與說明，後台沒填說明則用素材庫的說明）。
const HERO_ALT = '兩個孩子在教室裡緊緊抱在一起'
const CARE_PHOTO_ALT = '老師拿著鈴鼓，帶幼幼班孩子一起拍手唱歌'
const FEATURE_ALT = '孩子們在遊戲區跑跳，有人從黃色溜滑梯滑下來'
const CARE = [
  { image: 'env-care-health', alt: '老師幫戴著口罩的孩子確認身體狀況' },
  { image: 'env-care-meal', alt: '男孩拿著湯匙，從紅色碗裡舀飯吃' },
  { image: 'env-care-clothes', alt: '穿著淺藍色羽絨外套的女孩站在桌邊' },
  { image: 'env-care-comfort', alt: '老師坐著把眼眶泛紅的男孩抱在懷裡' },
  { image: 'env-care-clean', alt: '老師擦拭消毒教室門把' }
]
// 五件照顧的小事：五種形狀高低錯落排一排；第五張半圓底下墊一塊平板
const CARE_LOOKS: (Look & { ped?: Block })[] = [
  { shape: 's-arch', ar: 0.78, color: 'terra', pos: '33% 50%' },
  { shape: 's-circle', color: 'mustard', pos: '58% 30%' },
  { shape: 's-qtr', ar: 0.92, color: 'sage', q: '64%', pos: '50% 16%' },
  { shape: 's-u', ar: 0.82, color: 'mist', pos: '52% 30%' },
  { shape: 's-semi', color: 'pink', pos: '55% 62%', ped: 'mustard' }
]
// 六個空間：照片形狀各不相同、後面錯開墊一塊別色（多半也別種形狀）的積木。戶外廣場只能用明華校的照片（後台標「明華校」）。
const SPACES = [
  { image: 'env-space-classroom', alt: '陽光照進木地板教室，牆邊是矮櫃與小桌椅' },
  { image: 'env-space-materials', alt: '女孩坐在桌前，專心組著各式彩色操作教具' },
  { image: 'env-space-plaza', alt: '明華校的戶外廣場上，女孩笑著往前跑，旁邊的孩子坐著看' },
  { image: 'env-space-corner', alt: '幼兒坐在球池裡大笑，身後的牆貼著彩色厚軟墊' },
  { image: 'env-space-restroom', alt: '孩子高度的洗手台，掛著一排小毛巾' },
  { image: 'env-space-animals', alt: '孩子蹲在圍欄邊，拿紅蘿蔔餵裡面的小兔子' }
]
const SPACE_LOOKS: Look[] = [
  { shape: 's-qtl', ar: 1.3, color: 'mist', back: ['s-qtl', 'mustard', 1.3], w: '96%', bx: '-22px', by: '22px', q: '58%' },
  { shape: 's-circle', color: 'pink', back: ['s-sq', 'sage'], w: '74%', bx: '24px', by: '24px', pos: '50% 35%' },
  { shape: 's-arch', ar: 0.82, color: 'terra', back: ['s-arch', 'mist', 0.82], w: '66%', bx: '-24px', by: '24px', pos: '80% 40%' },
  { shape: 's-u', ar: 0.9, color: 'sage', back: ['s-circle', 'pink'], w: '72%', bx: '26px', by: '-26px', pos: '50% 38%' },
  { shape: 's-semi', color: 'mustard', back: ['s-semi', 'terra'], w: '100%', bx: '0px', by: '-30px', pos: '50% 78%' },
  { shape: 's-sq', ar: 1.08, color: 'mist', back: ['s-circle', 'mustard'], w: '78%', bx: '26px', by: '-26px', pos: '68% 50%' }
]
// 一天五餐的小圖示（30×30，平塗＋同色深一階的側面往下錯開，跟頁面上的積木同一招）；依序對到五餐，後台改了餐名也照順序
const MEAL_ICONS = [
  '<path d="M7 14a6 6 0 0 1 3.4-9.2h9.2A6 6 0 0 1 23 14v10.5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Z" fill="var(--renv-mustard-side)" transform="translate(0 2.5)"/><path d="M7 14a6 6 0 0 1 3.4-9.2h9.2A6 6 0 0 1 23 14v10.5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Z" fill="var(--renv-mustard)"/><rect x="10.5" y="12" width="9" height="10.5" rx="2.2" fill="var(--renv-paper)"/>',
  '<path d="M6 8 Q7.5 24 25 23.5" fill="none" stroke="var(--renv-mustard-side)" stroke-width="8" stroke-linecap="round" transform="translate(0 2.5)"/><path d="M6 8 Q7.5 24 25 23.5" fill="none" stroke="var(--renv-mustard)" stroke-width="8" stroke-linecap="round"/><path d="M5 5.5 6.2 9" stroke="var(--renv-forest)" stroke-width="3" stroke-linecap="round"/>',
  '<path d="M3.5 14h23a11.5 11.5 0 0 1-23 0Z" fill="var(--renv-sage-side)" transform="translate(0 2.5)"/><path d="M8.5 14a6.5 5 0 0 1 13 0Z" fill="var(--renv-cream-side)"/><path d="M3.5 14h23a11.5 11.5 0 0 1-23 0Z" fill="var(--renv-sage)"/>',
  '<circle cx="15" cy="19.5" r="10.5" fill="var(--renv-terra-side)"/><circle cx="15" cy="17" r="10.5" fill="var(--renv-terra)"/><path d="M15 3.5v6" stroke="var(--renv-forest)" stroke-width="3" stroke-linecap="round"/><ellipse cx="21" cy="5.5" rx="5.2" ry="2.8" transform="rotate(-28 21 5.5)" fill="var(--renv-sage)"/>',
  '<path d="M21 12h2.5a4 4 0 0 1 0 8H21" fill="none" stroke="var(--renv-mist-side)" stroke-width="3.2" stroke-linecap="round"/><path d="M6 9h15v13a4 4 0 0 1-4 4h-7a4 4 0 0 1-4-4Z" fill="var(--renv-mist-side)" transform="translate(0 2.5)"/><path d="M6 9h15v13a4 4 0 0 1-4 4h-7a4 4 0 0 1-4-4Z" fill="var(--renv-mist)"/>'
]
// 五顆心：兩個圓＋一個轉 45° 的方塊拼成的幾何愛心
const HEART = 'M0 30 L-30 0 A21.21 21.21 0 0 1 0 -30 A21.21 21.21 0 0 1 30 0 Z'
const HEART_COLORS: Block[] = ['terra', 'mustard', 'sage', 'mist', 'pink']
// 目次四塊積木的形狀與顏色
const INDEX_LOOKS: [string, Block][] = [['s-circle', 'mustard'], ['s-arch', 'sage'], ['s-sq', 'pink'], ['s-semi', 'mist']]
const TOUR_COLORS: Block[] = ['mustard', 'sage', 'mist', 'pink', 'terra']

const heroLines = computed(() => pageMarkedLines(props.page.heroTitle, props.page.heroHighlight))
const careItems = computed(() => props.page.careItems.map((item, i) => ({ ...CARE[i]!, ...item, look: CARE_LOOKS[i]! })))
const spaces = computed(() => props.page.spaces.map((space, i) => ({ ...SPACES[i]!, ...space, look: SPACE_LOOKS[i]! })))
const meals = computed(() => props.page.meals.map((item, i) => ({ ...item, icon: MEAL_ICONS[i] ?? MEAL_ICONS[2]! })))

// 照片積木的 CSS 變數（形狀比例、墊塊錯開量）
const frameStyle = (look: Look) => ({ ...(look.ar ? { '--ar': String(look.ar) } : {}), ...(look.q ? { '--q': look.q } : {}) })
const phStyle = (look: Look) => ({ ...(look.w ? { width: look.w } : {}), ...(look.bx ? { '--bx': look.bx } : {}), ...(look.by ? { '--by': look.by } : {}) })
const backStyle = (look: Look) => (look.back?.[2] ? { '--ar': String(look.back[2]) } : undefined)

// 結尾不放預約，改成往站內其他分頁走；提示字取自各頁的章節名
const NEXT = [
  { href: '/#life', title: '孩子的一天', hint: '六個日常片刻', look: ['s-arch', 'sage'] },
  { href: '/curriculum', title: '特色教學', hint: '四個年段與課程方向', look: ['s-circle', 'mustard'] },
  { href: '/admission', title: '入學資訊', hint: '入學流程、分班對照', look: ['s-sq', 'mist'] }
]

const meal = mealBookLink()

// 第四章：只收有場景的校
const tours = computed(() => props.campuses
  .map((campus) => ({ campus, scenes: campus.tourScenes }))
  .filter((tour): tour is { campus: Campus; scenes: TourScene[] } => tour.scenes.length > 0))
const sceneCount = computed(() => tours.value.reduce((sum, tour) => sum + tour.scenes.length, 0))
const active = ref('')
const activeKey = computed(() => (tours.value.some((tour) => tour.campus.key === active.value) ? active.value : tours.value[0]?.campus.key))
// 第一張拱形（約 1.28:1）、其餘圓形；照片多半比框寬，cover 裁切後要畫的寬度約框寬 × 1.6
const sceneImage = (scene: TourScene, lead: boolean) => responsiveTourImage(scene.image, lead ? '(max-width: 900px) calc((100vw - 32px) * 1.6), 820px' : '(max-width: 900px) 200px, 320px', false, scene.imageMedia)

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
  if (focus) tabRefs.value.find((button) => button.dataset.key === key)?.focus()
  // 真的換了校，新分頁的照片積木落下來
  const panel = root.value?.querySelector<HTMLElement>(`#tour-${key}`)
  if (changed && panel) drop?.replay(panel)
}
function onTabKey(event: KeyboardEvent, index: number) {
  const target = ({ ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tours.value.length - 1 } as Record<string, number>)[event.key]
  if (target === undefined) return
  event.preventDefault()
  const count = tours.value.length
  void selectTab(tours.value[(target + count) % count]!.campus.key, true)
}

useHead({ link: ENVIRONMENT_FONT_PRELOAD.map((href) => ({ rel: 'preload', as: 'font', type: 'font/woff2', href, crossorigin: '' })) })

// ---------- 積木落下：一開始就在視窗裡的不動（首屏與 LCP 照片不能先藏起來），往下捲到才落定 ----------
interface Drop { replay: (scope: HTMLElement) => void; destroy: () => void }
function createDrop(scope: HTMLElement): Drop {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      e.target.classList.add('is-in')
      io.unobserve(e.target)
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 })
  const fold = innerHeight
  const waiting = [...scope.querySelectorAll<HTMLElement>('[data-drop]')].filter((el) => !el.closest('[hidden]') && el.getBoundingClientRect().top >= fold)
  for (const el of waiting) {
    el.classList.add('is-waiting')
    io.observe(el)
  }
  return {
    replay(panel) {
      for (const el of panel.querySelectorAll<HTMLElement>('[data-drop]')) {
        el.classList.remove('is-in')
        el.classList.add('is-waiting')
        io.observe(el)
      }
    },
    destroy: () => io.disconnect()
  }
}

const root = ref<HTMLElement | null>(null)
let drop: Drop | null = null
let routes: EnvironmentRoutes | null = null
let disposed = false
onMounted(async () => {
  attachEnvironmentFontStylesheet(document)
  if (!root.value) return
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reducedMotion && 'IntersectionObserver' in window) drop = createDrop(root.value)
  // 圓點小路是裝飾，動態載入；載入失敗就沒有圓點，其餘照常
  const loaded = await import('~/utils/environment-route').catch(() => null)
  if (disposed || !root.value || !loaded) return
  routes = loaded.createEnvironmentRoutes(root.value, { reducedMotion })
})
onBeforeUnmount(() => { disposed = true; drop?.destroy(); routes?.destroy() })
// 後台即時預覽（pages/preview.vue）會一直換 page／campuses：文字變長變短、照片換掉後版面高度跟著變，圓點小路要依新版面重算。
// flush: 'post' 等畫面更新完再量，同一個 tick 內改好幾處只算一次。正式頁的 props 不會再變；小路還沒建好時略過。
watch([() => props.page, () => props.campuses], () => routes?.refresh(), { deep: true, flush: 'post' })
</script>

<template>
  <main id="main" ref="root" tabindex="-1" class="renv" data-cta-entry="environment">
    <!-- 首屏：大標、彩虹疊疊樂裡的照片、四塊積木目次 -->
    <section class="renv-hero" aria-labelledby="environment-title">
      <div class="renv-wrap renv-hero-grid">
        <div class="renv-hero-txt">
          <h1 id="environment-title"><span v-for="(line, i) in heroLines" :key="i">{{ line.before }}<mark v-if="line.mark" class="renv-mark">{{ line.mark }}</mark>{{ line.after }}</span></h1>
          <p v-if="page.heroLede" class="renv-text renv-lede">{{ page.heroLede }}</p>
          <p v-if="page.heroNotice" class="renv-notice">{{ page.heroNotice }}</p>
        </div>
        <div class="renv-hero-fig">
          <!-- 五道同心拱由外而內：赤陶、芥末、鼠尾草、霧藍、淡粉，照片在最內圈 -->
          <div class="renv-rainbow">
            <div class="renv-rb c-terra"><div class="renv-rb-gap">
              <div class="renv-rb c-mustard"><div class="renv-rb-gap">
                <div class="renv-rb c-sage"><div class="renv-rb-gap">
                  <div class="renv-rb c-mist"><div class="renv-rb-gap">
                    <div class="renv-rb c-pink"><div class="renv-rb-gap">
                      <img class="renv-rainbow-photo" v-bind="environmentHeroAttrs(page)" :style="pagePhotoStyle('70% 38%', page.heroPhoto)" :alt="pagePhotoAlt(HERO_ALT, page.heroPhoto, page.heroPhotoAlt)" loading="eager" fetchpriority="high">
                    </div></div>
                  </div></div>
                </div></div>
              </div></div>
            </div></div>
          </div>
        </div>
        <nav class="renv-index" aria-label="本頁章節">
          <ul>
            <li v-for="(chapter, i) in chapters" :key="chapter.id">
              <a :class="[INDEX_LOOKS[i]![0], `c-${INDEX_LOOKS[i]![1]}`]" :href="`#${chapter.id}`">
                <b class="renv-index-no" lang="en">{{ chapter.no }}</b><span class="renv-index-name">{{ chapter.label }}</span><span class="renv-index-hint">{{ chapter.hint }}</span>
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </section>

    <!-- 01 幼兒保育：幾何愛心、主照片、五件照顧的小事 -->
    <section id="care" class="renv-section renv-care" aria-labelledby="care-title">
      <div class="renv-wrap">
        <div class="renv-care-head">
          <div>
            <p class="renv-kicker"><span class="renv-dot c-terra" lang="en">{{ chapterNo('care') }}</span>{{ page.chapterNames[0] }}</p>
            <h2 id="care-title" class="renv-title"><span v-for="(line, i) in pageTitleLines(page.careTitle)" :key="i">{{ line }}</span></h2>
          </div>
          <div class="renv-hearts-box">
            <p v-if="page.careLead" class="renv-text">{{ page.careLead }}</p>
            <ul class="renv-hearts">
              <li v-for="(heart, i) in page.hearts" :key="i" :class="`c-${HEART_COLORS[i % 5]}`" data-drop :style="{ '--i': i }">
                <svg class="renv-heart" viewBox="-37 -38 74 76" aria-hidden="true" focusable="false"><path class="is-side" :d="HEART" transform="translate(0 6)" /><path class="is-face" :d="HEART" /></svg>
                <b>{{ heart }}</b>
              </li>
            </ul>
            <p v-if="page.careText" class="renv-text">{{ page.careText }}</p>
          </div>
        </div>
        <div class="renv-care-main">
          <div class="renv-ph" data-drop>
            <div class="renv-ph-back renv-blk s-d c-sage" aria-hidden="true" />
            <div class="renv-frame s-d c-terra">
              <img v-bind="pagePhotoAttrs('env-care-teacher', page.carePhoto, '(max-width: 900px) calc((100vw - 32px) * 1.36), 1320px')" :style="pagePhotoStyle('0% 30%', page.carePhoto)" :alt="pagePhotoAlt(CARE_PHOTO_ALT, page.carePhoto, page.carePhotoAlt)" loading="lazy">
            </div>
          </div>
        </div>
        <ol class="renv-cares">
          <li v-for="(item, i) in careItems" :key="item.image">
            <div class="renv-care-ph">
              <div class="renv-ph" data-drop :style="{ '--i': i }">
                <div class="renv-frame" :class="[item.look.shape, `c-${item.look.color}`]" :style="frameStyle(item.look)">
                  <img v-bind="pagePhotoAttrs(item.image, item.photo, '(max-width: 900px) 75vw, 380px')" :style="pagePhotoStyle(item.look.pos, item.photo)" :alt="pagePhotoAlt(item.alt, item.photo, item.photoAlt)" loading="lazy">
                </div>
              </div>
              <div v-if="item.look.ped" class="renv-care-ped renv-blk" :class="`c-${item.look.ped}`" data-drop aria-hidden="true" />
            </div>
            <div class="renv-care-txt">
              <h3><span class="renv-dot" :class="`c-${item.look.color}`" lang="en">{{ i + 1 }}</span>{{ item.title }}</h3>
              <p>{{ item.text }}</p>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <!-- 02 校園環境：遊樂區主打，六個空間左右交錯、圓點小路從一張照片接到下一張 -->
    <section id="spaces" class="renv-section renv-spaces" aria-labelledby="spaces-title">
      <div class="renv-wrap">
        <p class="renv-kicker"><span class="renv-dot c-sage" lang="en">{{ chapterNo('spaces') }}</span>{{ page.chapterNames[1] }}</p>
        <h2 id="spaces-title" class="renv-title"><span v-for="(line, i) in pageTitleLines(page.spacesTitle)" :key="i">{{ line }}</span></h2>
        <p v-if="page.spacesText" class="renv-text">{{ page.spacesText }}</p>
        <div class="renv-feature">
          <div class="renv-ph" data-drop>
            <div class="renv-ph-back renv-blk s-qbl c-mustard" aria-hidden="true" />
            <div class="renv-frame s-qbl c-sage">
              <img v-bind="pagePhotoAttrs('env-space-playground', page.feature.photo, '(max-width: 900px) calc(100vw - 32px), 680px')" :style="pagePhotoStyle(undefined, page.feature.photo)" :alt="pagePhotoAlt(FEATURE_ALT, page.feature.photo, page.feature.photoAlt)" loading="lazy">
            </div>
          </div>
          <div class="renv-feature-copy">
            <p class="renv-tag renv-blk c-sage">{{ page.feature.tag }}</p>
            <h3><span v-for="(line, i) in pageTitleLines(page.feature.title)" :key="i">{{ line }}</span></h3>
            <p class="renv-text">{{ page.feature.text }}</p>
          </div>
        </div>
        <div class="renv-stops">
          <svg class="renv-route" data-route="map" aria-hidden="true" focusable="false" />
          <ol class="renv-stop-list">
            <li v-for="(space, i) in spaces" :key="space.image" class="renv-stop" :data-route-color="`var(--renv-${space.look.color}-side)`">
              <div class="renv-stop-ph">
                <div class="renv-ph" data-drop :style="phStyle(space.look)">
                  <div class="renv-ph-back renv-blk" :class="[space.look.back![0], `c-${space.look.back![1]}`]" :style="backStyle(space.look)" aria-hidden="true" />
                  <div class="renv-frame" :class="[space.look.shape, `c-${space.look.color}`]" :style="frameStyle(space.look)">
                    <img v-bind="pagePhotoAttrs(space.image, space.photo, '(max-width: 900px) calc((100vw - 82px) * 1.6), 660px')" :style="pagePhotoStyle(space.look.pos, space.photo)" :alt="pagePhotoAlt(space.alt, space.photo, space.photoAlt)" loading="lazy">
                  </div>
                  <span v-if="space.campusLabel" class="renv-campus renv-blk c-mustard">{{ space.campusLabel }}</span>
                  <span class="renv-dot renv-stop-no" :class="`c-${space.look.color}`" lang="en" aria-hidden="true">{{ i + 1 }}</span>
                </div>
              </div>
              <div class="renv-stop-copy" data-drop :style="{ '--i': 1 }">
                <h3>{{ space.title }}</h3>
                <p>{{ space.text }}</p>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </section>

    <!-- 03 幼兒餐點：營養餐點書、一天五餐的時間軸 -->
    <section id="meals" class="renv-section renv-meals" aria-labelledby="meals-title">
      <div class="renv-wrap renv-meals-top">
        <div>
          <p class="renv-kicker"><span class="renv-dot c-mustard" lang="en">{{ chapterNo('meals') }}</span>{{ page.chapterNames[2] }}</p>
          <h2 id="meals-title" class="renv-title"><span v-for="(line, i) in pageTitleLines(page.mealsTitle)" :key="i">{{ line }}</span></h2>
          <p class="renv-text">{{ page.mealsText }}</p>
          <a class="renv-btn c-forest" :href="meal.href" target="_blank" rel="noopener">{{ meal.label }}<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-up-right" /></svg><span class="sr-only">（另開新視窗）</span></a>
        </div>
        <a class="renv-book" :href="meal.href" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">
          <span class="renv-book-arch renv-blk s-arch c-terra" data-drop />
          <img class="renv-book-cover" v-bind="responsiveImage('env-meal-book', '(max-width: 900px) 162px, 224px')" alt="" loading="lazy" data-drop :style="{ '--i': 1 }">
          <span class="renv-book-semi renv-blk s-semi c-sage" data-drop :style="{ '--i': 2 }" />
        </a>
      </div>
      <div class="renv-wrap renv-day">
        <h3 class="renv-day-title">{{ page.mealsDayTitle }}</h3>
        <div class="renv-day-track">
          <svg class="renv-route" data-route="day" aria-hidden="true" focusable="false" />
          <ol class="renv-day-list">
            <li v-for="(item, i) in meals" :key="i" data-drop :style="{ '--i': i }">
              <time lang="en">{{ item.time }}</time>
              <!-- eslint-disable-next-line vue/no-v-html -- 本檔固定的小圖示常數，不含後台或使用者內容 -->
              <span class="renv-stn renv-blk c-cream"><svg viewBox="0 0 30 30" aria-hidden="true" focusable="false" v-html="item.icon" /></span>
              <b>{{ item.name }}</b><small>{{ item.note }}</small>
              <p v-if="item.text">{{ item.text }}</p>
            </li>
          </ol>
        </div>
      </div>
    </section>

    <!-- 04 五所校園：各校校園探索的實景（後台 campus_tour 發布的內容） -->
    <section v-if="tours.length" id="campuses" class="renv-section renv-tour" aria-labelledby="tour-title">
      <div class="renv-wrap">
        <div class="renv-tour-head">
          <div>
            <p class="renv-kicker"><span class="renv-dot c-mist" lang="en">{{ chapterNo('campuses') }}</span>{{ page.chapterNames[3] }}</p>
            <h2 id="tour-title" class="renv-title"><span v-for="(line, i) in pageTitleLines(page.tourTitle)" :key="i">{{ line }}</span></h2>
          </div>
          <p v-if="page.tourText" class="renv-text">{{ page.tourText }}</p>
        </div>
        <div class="renv-tour-tabs" role="tablist" aria-label="選一所校園">
          <button
            v-for="(tour, i) in tours"
            :id="`tour-tab-${tour.campus.key}`"
            :key="tour.campus.key"
            ref="tabRefs"
            type="button"
            role="tab"
            class="renv-tour-tab"
            :class="`c-${TOUR_COLORS[i % 5]}`"
            :data-key="tour.campus.key"
            :aria-controls="`tour-${tour.campus.key}`"
            :aria-selected="tour.campus.key === activeKey"
            :tabindex="tour.campus.key === activeKey ? 0 : -1"
            @click="selectTab(tour.campus.key)"
            @keydown="onTabKey($event, i)"
          >
            <span class="renv-tour-art"><img v-bind="responsiveImage(`campus-line-art-${tour.campus.key}-ink`, '(max-width: 900px) 124px, 200px')" alt="" loading="lazy" decoding="async"></span>
            <b>{{ tour.campus.name }}</b>
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
          <div class="renv-tour-panel-head"><h3>{{ tour.campus.name }}</h3><p>{{ tour.campus.district }}・{{ tour.scenes.length }} 個角落</p></div>
          <div class="renv-scenes">
            <div class="renv-scene renv-scene-lead">
              <div class="renv-ph" data-drop>
                <div class="renv-ph-back renv-blk s-arch" :class="`c-${TOUR_COLORS[(t + 2) % 5]}`" aria-hidden="true" />
                <div class="renv-frame s-arch" :class="`c-${TOUR_COLORS[t % 5]}`">
                  <img v-bind="sceneImage(tour.scenes[0]!, true)" :style="pagePhotoStyle(undefined, tour.scenes[0]!.imageMedia)" :alt="`${tour.campus.name}的${tour.scenes[0]!.name}`" loading="lazy" decoding="async">
                </div>
              </div>
              <h4>{{ tour.scenes[0]!.name }}</h4>
            </div>
            <ul v-if="tour.scenes.length > 1" class="renv-scene-list">
              <li v-for="(scene, s) in tour.scenes.slice(1)" :key="scene.key" class="renv-scene">
                <div class="renv-ph" data-drop :style="{ '--i': s + 1 }">
                  <div class="renv-ph-back renv-blk s-circle" :class="`c-${TOUR_COLORS[(t + 3 + s) % 5]}`" aria-hidden="true" />
                  <div class="renv-frame s-circle" :class="`c-${TOUR_COLORS[t % 5]}`">
                    <img v-bind="sceneImage(scene, false)" :style="pagePhotoStyle(undefined, scene.imageMedia)" :alt="`${tour.campus.name}的${scene.name}`" loading="lazy" decoding="async">
                  </div>
                </div>
                <h4>{{ scene.name }}</h4>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- 結尾：接下來可以看（不放預約） -->
    <section class="renv-section renv-next" aria-labelledby="next-title">
      <div class="renv-wrap">
        <h2 id="next-title" class="renv-next-title">還可以看看這幾頁</h2>
        <ul class="renv-next-list">
          <li v-for="(item, i) in NEXT" :key="item.href" data-drop :style="{ '--i': i }">
            <NuxtLink class="renv-next-link" :class="[item.look[0], `c-${item.look[1]}`]" :to="item.href"><b>{{ item.title }}</b><small>{{ item.hint }}</small></NuxtLink>
          </li>
        </ul>
      </div>
    </section>
  </main>
</template>

<style src="../assets/css/environment-fonts.css"></style>
<style src="../assets/css/environment.css"></style>
