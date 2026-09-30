<script setup lang="ts">
// 常春藤環境頁主體（/environment）。2026-09-28 改成手繪版（使用者選定 mock C：
// design/environment-rough-mockup-20260928/），跟其他分頁刻意不同：點格紙、蠟筆色紙、Rough.js 手繪線、圓體字。
// 內容：幼兒保育、校園環境、幼兒餐點三章沿用 2026-09-25 從舊官網搬來的原文（只修錯字與標點）；
// 第四章「五所校園」直接讀後台發布的各校校園探索（campuses[].tourScenes），文字不在這裡寫死。
// 2026-09-29 使用者裁定：第四章照片上不畫標註點的便條與箭頭（分校頁校園探索的熱點照舊）。
// 2026-09-28 使用者裁定：這一頁不放預約參觀（全站共用的頁首預約鈕除外）。
// 手繪線條由 utils/rough-sketch.ts 在瀏覽器畫上去，純裝飾；沒有 JS 時版面與文字照常。
// 2026-09-28 加 GSAP 動態層（utils/environment-motion.ts；比稿 design/environment-gsap-mockup-20260928/）：
// 小路改成小腳印、曬衣繩起風、太陽帶慣性、換校發牌。GSAP 跟 Rough.js 一樣只在這頁動態載入；載入失敗就照原本的虛線小路。
import { isGeneratedTourScenes, type Campus, type TourScene } from '~/types/site-content'
import { environmentHeroImage, responsiveImage } from '~/utils/responsive-image'
import { responsiveTourImage } from '~/utils/tour-image'
import { mealBookLink } from '~/utils/meal-book'
import { attachEnvironmentFontStylesheet, ENVIRONMENT_FONT_PRELOAD } from '~/utils/environment-fonts'
import type { SketchHandle } from '~/utils/rough-sketch'
import type { EnvironmentMotion } from '~/utils/environment-motion'

const props = defineProps<{ campuses: Campus[] }>()

const CARE = [
  { image: 'env-care-health', pos: '32% 50%', alt: '老師幫戴著口罩的孩子確認身體狀況', title: '健康把關紀錄', text: '隨時注意孩子身體狀況，每日定時測量體溫。' },
  { image: 'env-care-meal', pos: '40% 50%', alt: '孩子們坐在桌邊用碗吃飯', title: '均衡飲食', text: '每日兩蔬果，增進免疫、提升孩子的健康。' },
  { image: 'env-care-clothes', pos: '56% 50%', alt: '老師幫孩子整理衣服', title: '衣物保暖', text: '隨時注意孩子服裝的保暖與整齊。' },
  { image: 'env-care-comfort', pos: '66% 40%', alt: '老師蹲下來抱著笑開的孩子', title: '情緒安撫', text: '穩定、安定孩子的情緒。' },
  { image: 'env-care-clean', pos: '62% 60%', alt: '老師擦拭消毒教室門把', title: '定時消毒', text: '每日定時教室消毒。' }
]
const HEARTS = ['愛心', '細心', '耐心', '貼心', '同理心']

// 便條（note）只標照片 alt 已經寫到的細節；to 是箭頭指到照片寬高的比例位置（照片不裁切）。
// 只有戶外廣場確定是明華校的照片（舊站檔名「明華戶外廣場」），其餘校別不明，不標。
const SPACES = [
  { image: 'env-space-classroom', alt: '陽光照進木地板教室，牆邊是矮櫃與小桌椅', title: '乾淨溫馨的教室', text: '課程統整，全方位主題教學，帶領孩子走出戶外，接觸大自然。', note: '陽光照進來', noteAt: 'is-n1', to: '0.42,0.74' },
  { image: 'env-space-materials', alt: '教室矮櫃上擺滿各式操作教具', title: '多樣操作教具', text: '多樣性教具提升寶貝邏輯思維；多元玩法搭配豐富內容，讓寶貝養成自主學習的好習慣。', note: '各式操作教具', noteAt: 'is-n2', to: '0.36,0.52' },
  { image: 'env-space-plaza', alt: '明華校寬敞的戶外廣場', title: '戶外廣場', text: '寬敞明亮的大廣場，給予寶貝充足的空間伸展肢體、跑跑跳跳，讓寶貝贏在人生的起跑點！', campus: '明華校', note: '跑跑跳跳的大廣場', noteAt: 'is-n3', to: '0.58,0.76' },
  { image: 'env-space-corner', alt: '教室角落貼著厚軟墊，地上鋪著巧拼', title: '安全角落設計', text: '厚軟墊防撞設計，加強角落安全性，寶貝唱唱跳跳好開心。', note: '厚軟墊防撞', noteAt: 'is-n4', to: '0.62,0.58' },
  { image: 'env-space-restroom', alt: '孩子高度的洗手台，掛著一排小毛巾', title: '套房式衛廁', text: '連接教室的套房式衛廁，時刻注意寶貝的安全及如廁狀況；安心環境幫助幼幼寶貝快速戒除尿布好放心！', note: '孩子高度的洗手台', noteAt: 'is-n5', to: '0.52,0.44' },
  { image: 'env-space-animals', alt: '孩子蹲在圍欄邊，拿紅蘿蔔餵裡面的小兔子', title: '可愛動物區', text: '可愛動物區激發寶貝主動探索大自然生態的熱情與動力，培養責任心與好奇心。', note: '餵小兔子吃紅蘿蔔', noteAt: 'is-n6', to: '0.40,0.66' }
]

// 時間與說明取自舊站一日流程的早餐、蔬果、午餐、點心各段；t 是在太陽弧上的位置（0 早、1 晚）。
const MEALS = [
  { t: 0, time: '08:30', name: '早餐', note: '早餐美語', text: '營養好吃的早餐，讓孩子有精神、有活力。' },
  { t: 0.25, time: '10:00', name: '香蕉', note: '每日兩蔬果之一', text: '每日兩蔬果，增進免疫。' },
  { t: 0.5, time: '11:40', name: '午餐', note: '廚房每天現煮', text: '最新鮮、最營養的午餐，健健康康長大。' },
  { t: 0.75, time: '12:00', name: '蘋果', note: '每日兩蔬果之二', text: '提升孩子的健康。' },
  { t: 1, time: '15:30', name: '點心', note: '西米露、玉米粥', text: '即便是點心，也是豐盛的正餐。' }
]

// 結尾不放預約，改成往站內其他分頁走；提示字取自各頁的章節名
const NEXT = [
  { href: '/#life', title: '孩子的一天', hint: '六個日常片刻' },
  { href: '/curriculum', title: '特色教學', hint: '四個年段與課程方向' },
  { href: '/admission', title: '入學資訊', hint: '入學流程、分班對照' }
]

const meal = mealBookLink()
const hero = environmentHeroImage()

// 第四章：只收有真正場景的校（佔位樣板不算）
const tours = computed(() => props.campuses
  .map((campus) => ({ campus, scenes: isGeneratedTourScenes(campus.tourScenes) ? [] : campus.tourScenes }))
  .filter((tour): tour is { campus: Campus; scenes: TourScene[] } => tour.scenes.length > 0))
const sceneCount = computed(() => tours.value.reduce((sum, tour) => sum + tour.scenes.length, 0))
const active = ref('')
const activeKey = computed(() => (tours.value.some((tour) => tour.campus.key === active.value) ? active.value : tours.value[0]?.campus.key))
const sceneImage = (scene: TourScene, lead: boolean) => responsiveTourImage(scene.image, lead ? '(max-width: 900px) 92vw, 700px' : '(max-width: 900px) 92vw, 560px', false, scene.imageMedia)

const chapters = computed(() => [
  { id: 'care', label: '幼兒保育', hint: '五顆心的照顧' },
  { id: 'spaces', label: '校園環境', hint: `${SPACES.length + 1} 個孩子的空間` },
  { id: 'meals', label: '幼兒餐點', hint: `${meal.month} 月菜單` },
  ...(tours.value.length ? [{ id: 'campuses', label: '五所校園', hint: `${sceneCount.value} 個校園角落` }] : [])
].map((chapter, i) => ({ ...chapter, no: String(i + 1).padStart(2, '0') })))
const chapterNo = (id: string) => chapters.value.find((chapter) => chapter.id === id)?.no
const COUNT_WORDS = ['一', '二', '三', '四']

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
let disposed = false
// GSAP 三支與動態層一起載入；任何一支失敗就不用動態層（回傳 null），手繪線照常
const loadMotion = (reducedMotion: boolean) => Promise.all([import('gsap'), import('gsap/ScrollTrigger'), import('gsap/MotionPathPlugin'), import('~/utils/environment-motion')])
  .then(([{ gsap }, { ScrollTrigger }, { MotionPathPlugin }, { createEnvironmentMotion }]) => createEnvironmentMotion({ gsap, ScrollTrigger, MotionPathPlugin }, { reducedMotion }))
  .catch(() => null)
onMounted(async () => {
  attachEnvironmentFontStylesheet(document)
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const [{ default: rough }, { createRoughSketch }, loaded] = await Promise.all([import('roughjs'), import('~/utils/rough-sketch'), loadMotion(reducedMotion)])
  if (disposed || !root.value) { loaded?.destroy(); return }
  motion = loaded
  sketch = createRoughSketch(root.value, rough, { reducedMotion, motion: motion ?? undefined })
  // 手繪線首屏以外分批畫（見 rough-sketch 的 drawFirst）；小路與上面的便條、箭頭都畫好了，動態層才收起便條、接上捲動
  await sketch.ready
  if (!disposed && root.value) motion?.start(root.value)
})
onBeforeUnmount(() => { disposed = true; sketch?.destroy(); motion?.destroy() })
</script>

<template>
  <main id="main" ref="root" tabindex="-1" class="renv" data-cta-entry="environment">
    <!-- 首屏：一頁攤開的聯絡簿 -->
    <section class="renv-hero" aria-labelledby="environment-title">
      <div class="renv-wrap renv-hero-grid">
        <div>
          <p class="renv-eyebrow">常春藤幼兒園 · 常春藤環境</p>
          <h1 id="environment-title">孩子的每一天，<br>都在這裡<span class="renv-mark" data-rough="highlight" data-seed="11">安心</span>長大。</h1>
          <p class="renv-lede">保育照顧、校園環境與幼兒餐點，整理在同一頁。</p>
          <p class="renv-notice">照片取自各校日常，空間配置各校略有不同。</p>
        </div>
        <figure class="renv-hero-photo renv-snap" data-rough="frame" data-seed="31">
          <img v-bind="hero" alt="兩個孩子在教室裡緊緊抱在一起" loading="eager" fetchpriority="high">
          <span class="renv-tape is-tl" data-rough="tape" data-seed="32" />
          <span class="renv-tape is-br" data-rough="tape" data-seed="33" />
          <figcaption class="renv-hand">兩個孩子，在教室裡抱得緊緊的。</figcaption>
        </figure>
      </div>
      <nav class="renv-wrap renv-index" aria-labelledby="renv-index-title">
        <p id="renv-index-title" class="renv-hand renv-index-title">這一頁有{{ COUNT_WORDS[chapters.length - 1] }}件事，看完打個勾</p>
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
            <p class="renv-kicker"><span class="renv-box" data-rough="check" data-seed="51" data-chapter-check="care" aria-hidden="true" /><span lang="en">{{ chapterNo('care') }}</span>幼兒保育</p>
            <h2 id="care-title" class="renv-title">五顆心，<br>照顧每一天。</h2>
            <p class="renv-text">專業保育照顧，靠的是五顆心：</p>
            <ul class="renv-hearts">
              <li v-for="(heart, i) in HEARTS" :key="heart"><span class="renv-heart" data-rough="heart" :data-seed="61 + i" aria-hidden="true" /><b>{{ heart }}</b></li>
            </ul>
            <p class="renv-text">從量體溫、吃蔬果到換衣服、安撫情緒，老師把孩子在學校的每一件小事都放在心上。</p>
          </div>
          <figure class="renv-care-photo renv-snap" data-rough="frame" data-seed="70">
            <img v-bind="responsiveImage('env-care-teacher', '(max-width: 900px) 138vw, 880px')" alt="老師拿著鈴鼓，帶幼幼班孩子一起拍手唱歌" loading="lazy">
            <span class="renv-tape is-tr" data-rough="tape" data-seed="71" />
            <span class="renv-note is-care" aria-hidden="true" data-rough="note" data-seed="72" data-to="0.13,0.22">鈴鼓</span>
            <figcaption class="renv-hand">老師帶著幼幼班的孩子，一起拍手唱歌。</figcaption>
          </figure>
        </div>
        <div class="renv-hang" tabindex="0" role="region" aria-label="五件照顧的小事">
          <ol class="renv-hang-track" data-rough="clothesline" data-seed="80">
            <li v-for="(item, i) in CARE" :key="item.image" class="renv-hang-item">
              <figure class="renv-hang-photo" data-rough="frame" :data-seed="81 + i">
                <img v-bind="responsiveImage(item.image, '(max-width: 900px) 410px, 345px')" :alt="item.alt" :style="{ objectPosition: item.pos }" loading="lazy">
              </figure>
              <h3><span class="renv-count" data-rough="circle" :data-seed="86 + i" lang="en">{{ i + 1 }}</span>{{ item.title }}</h3>
              <p>{{ item.text }}</p>
            </li>
          </ol>
        </div>
      </div>
    </section>

    <!-- 02 校園環境：跟著小腳印走一圈 -->
    <section id="spaces" class="renv-section renv-spaces" aria-labelledby="spaces-title">
      <div class="renv-wrap">
        <div class="renv-split-head">
          <p class="renv-kicker"><span class="renv-box" data-rough="check" data-seed="101" data-chapter-check="spaces" aria-hidden="true" /><span lang="en">{{ chapterNo('spaces') }}</span>校園環境</p>
          <h2 id="spaces-title" class="renv-title">把安全與好奇，<br>放進每個角落。</h2>
          <p class="renv-text">從教室、教具、衛廁到戶外廣場，每個空間都以孩子的安全與探索為出發點。</p>
        </div>
        <article class="renv-feature">
          <figure class="renv-feature-photo renv-snap" data-rough="frame" data-seed="110">
            <img v-bind="responsiveImage('env-space-playground', '(max-width: 900px) 92vw, 680px')" alt="校園裡色彩繽紛的溜滑梯與遊戲設施" loading="lazy">
            <span class="renv-tape is-tl" data-rough="tape" data-seed="111" />
            <span class="renv-tape is-tr" data-rough="tape" data-seed="112" />
            <span class="renv-note is-slide" aria-hidden="true" data-rough="note" data-seed="113" data-to="0.12,0.66">溜滑梯</span>
          </figure>
          <div class="renv-feature-copy">
            <p class="renv-tag" data-rough="tagfill" data-seed="114">安全歡樂遊樂區</p>
            <h3>在遊戲裡，<br>慢慢長大。</h3>
            <p>遊戲幫助寶貝成長發育，發展精細動作、激發想像力、提升手眼協調力，讓寶貝開心、健康、快樂地成長。</p>
          </div>
        </article>
        <p class="renv-hand renv-trail-hint" aria-hidden="true">跟著小腳印，走一圈看看</p>
        <ol class="renv-trail" data-rough="trail" data-seed="120">
          <li v-for="(space, i) in SPACES" :key="space.image" class="renv-stop">
            <figure class="renv-stop-photo renv-snap" data-rough="frame" :data-seed="121 + i">
              <img v-bind="responsiveImage(space.image, '(max-width: 760px) calc(100vw - 96px), (max-width: 1100px) 45vw, 530px')" :alt="space.alt" loading="lazy">
              <span v-if="space.campus" class="renv-campus" data-rough="tagfill" data-seed="150">{{ space.campus }}</span>
              <span class="renv-note" :class="space.noteAt" aria-hidden="true" data-rough="note" :data-seed="131 + i" :data-to="space.to">{{ space.note }}</span>
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
            <p class="renv-kicker"><span class="renv-box" data-rough="check" data-seed="201" data-chapter-check="meals" aria-hidden="true" /><span lang="en">{{ chapterNo('meals') }}</span>幼兒餐點</p>
            <h2 id="meals-title" class="renv-title">多一點天然，<br>少一點加工。</h2>
            <p class="renv-text">每日餐點符合營養標準，廚房每天現煮，讓孩子吃到食物最原始的味道。每個月的菜單，都收在常春藤營養餐點書裡。</p>
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
          <p class="renv-hand renv-day-title">孩子在學校，一天吃這些</p>
          <ol class="renv-day-list">
            <li v-for="item in MEALS" :key="item.time" class="renv-meal" :data-t="item.t">
              <time lang="en">{{ item.time }}</time><b>{{ item.name }}</b><small>{{ item.note }}</small>
              <p>{{ item.text }}</p>
            </li>
          </ol>
        </div>
      </div>
    </section>

    <!-- 04 五所校園：各分校頁校園探索的實景（後台 campus_tour 發布的內容） -->
    <section v-if="tours.length" id="campuses" class="renv-section renv-tour" aria-labelledby="tour-title">
      <div class="renv-wrap">
        <div class="renv-split-head">
          <p class="renv-kicker"><span class="renv-box" data-rough="check" data-seed="401" data-chapter-check="campuses" aria-hidden="true" /><span lang="en">{{ chapterNo('campuses') }}</span>五所校園</p>
          <h2 id="tour-title" class="renv-title">每一所校園，<br>都有自己的角落。</h2>
          <p class="renv-text">空間配置各校不同。下面的照片取自各分校頁的校園探索，挑一所學校看看。</p>
        </div>
        <p class="renv-hand renv-tour-hint" aria-hidden="true">挑一所學校，翻開來看</p>
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
            <img v-bind="responsiveImage(`campus-line-art-${tour.campus.key}`, '(max-width: 900px) 124px, 170px')" alt="" loading="lazy" decoding="async">
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
          <NuxtLink class="renv-link" :to="`/campuses/${tour.campus.key}#environment`">到{{ tour.campus.name }}頁，看完整的校園探索</NuxtLink>
        </div>
      </div>
    </section>

    <!-- 結尾：接下來可以看（不放預約） -->
    <section class="renv-section renv-next" aria-labelledby="next-title">
      <div class="renv-wrap">
        <h2 id="next-title" class="renv-hand renv-next-title">環境看完了，還可以看看這幾頁</h2>
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
