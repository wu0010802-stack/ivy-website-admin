<script setup lang="ts">
// 關於常春藤頁主體（/about）。2026-09-26 從機構站 ivykidschool.com「關於常春藤 About」搬來：
// - 01 一路走來：沿革原文「民國86年義華路成立……110年仁武校」，五校各一個節點。
//   舊站寫「三十多個春夏秋冬」，1997 到今年未滿三十年，照首頁改成「近三十年」。
//   崇德校同年成立的「ESL 美語部」先不寫（美語補習班要不要露出還沒定案）。
// - 02 全人教育：舊站「全人教育理念」，六大領域與六大核心素養源自幼兒園教保活動課程大綱。
// - 03 我們的期許：舊站首頁「Our Goals」與「幼兒園是孩童第一所學校也是孩童第二個家」。
// 內容寫在元件裡，不進後台。不綁 30 週年（週年版尚未拍板）。校名、照片跟著後台發布的分校資料；年份是固定的沿革。
// 2026-09-29 改成「立體書」（使用者選定 J：design/about-style-directions-20260929/j-popup.*）：每段是一個跨頁，
// 左頁文字、右頁照片卡紙；捲到時右頁翻開、卡紙站起來；一路走來拉紙條、全人教育轉紙轉盤、期許是折起來的紙房子。
// 使用者要求不特別強調 2005 → 2020 相隔十五年：紙條上五站等距。頁面內容不放預約參觀（同常春藤環境、特色教學；
// 頁首全站共用的預約鈕照舊）。動態由 utils/about-popup.ts 做，Motion 只在這頁動態載入；沒有 JS 時書攤開、卡紙站好。
import type { Campus } from '~/types/site-content'
import { pickImage } from '~/utils/media-image'
import { ABOUT_HERO_IMAGE, ABOUT_HERO_SIZES, responsiveImage } from '~/utils/responsive-image'
import type { AboutPopup } from '~/utils/about-popup'

const props = defineProps<{ campuses: Campus[] }>()

const MILESTONES = [
  { key: 'yihua', year: 1997, roc: 86, text: '第一間常春藤，在三民區義華路成立。' },
  { key: 'minghua', year: 2001, roc: 90, text: '走進左營區，有了第二所校園。' },
  { key: 'chongde', year: 2005, roc: 94, text: '左營區的第二所校園。' },
  { key: 'international', year: 2020, roc: 109, text: '在鳥松區球場路成立。' },
  { key: 'renwu', year: 2021, roc: 110, text: '第五所校園，在仁武區成立。' }
]

// 分校停用或下架時，那一年仍留在沿革裡，只是不放照片與連結。
const milestones = computed(() => MILESTONES.map((item) => ({ ...item, campus: props.campuses.find((c) => c.key === item.key) })))

// 右頁卡紙的位置（相對右頁舞台，百分比）：後排三張、前排兩張；卡紙底色輪流用品牌色
const STAGE = [
  { x: 0, y: 62, w: 34, color: 'var(--yellow)' },
  { x: 34, y: 68, w: 30, color: 'var(--studio-blue)' },
  { x: 66, y: 62, w: 34, color: 'var(--studio-sage)' },
  { x: 4, y: 22, w: 42, color: 'var(--mint)' },
  { x: 52, y: 20, w: 44, color: 'var(--studio-orange)' }
]
const cardStyle = (i: number) => {
  const s = STAGE[i]!
  return { '--x': `${s.x}%`, '--y': `${s.y}%`, '--w': `${s.w}%`, '--c': s.color, '--z': i >= 3 ? 3 : 1 }
}

const DOMAINS = ['身體動作與健康', '認知', '語文', '社會', '情緒', '美感']
const LITERACIES = ['覺知辨識', '表達溝通', '關懷合作', '推理賞析', '想像創造', '自主管理']
// 紙轉盤上的標籤：長的名稱折成兩行
const SECTOR_LABELS = ['身體動作\n與健康', '認知', '語文', '社會', '情緒', '美感']
const BOOKMARKS = ['var(--yellow)', 'var(--studio-blue)', 'var(--studio-sage)', 'var(--mint)', 'var(--studio-orange)']

const root = ref<HTMLElement | null>(null)
let popup: AboutPopup | null = null
let disposed = false
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
  <main id="main" ref="root" tabindex="-1" class="abk" data-cta-entry="about">
    <!-- 首屏：第一個跨頁（不翻，一進來就攤開） -->
    <section class="abk-spread abk-hero" data-spread="static" aria-labelledby="about-page-title">
      <div class="abk-page is-left">
        <span class="abk-ribbon" aria-hidden="true" />
        <p class="abk-kicker">常春藤教育機構 · 關於常春藤</p>
        <h1 id="about-page-title">從一間幼兒園，<br>長成五所校園。</h1>
        <p class="abk-lede">1997 年，第一間常春藤在高雄義華路成立。近三十年來，我們守著同一份教育理念與專業保育，陪孩子過一段獨一無二的童年。</p>
        <a class="abk-hint" href="#story">往下捲，翻開下一頁<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-down" /></svg></a>
        <span class="abk-no" lang="en" aria-hidden="true">1</span>
      </div>
      <div class="abk-page is-right">
        <div class="abk-stage">
          <figure class="abk-pop is-hero" :style="{ '--x': '6%', '--y': '12%', '--w': '88%', '--c': 'var(--yellow)', '--z': 2 }">
            <div class="abk-card">
              <img v-bind="responsiveImage(ABOUT_HERO_IMAGE, ABOUT_HERO_SIZES)" alt="孩子們笑著圍在戴眼鏡的長輩身邊，大家擠在一起" loading="eager" fetchpriority="high">
              <figcaption>把每個孩子，放在心上。</figcaption>
            </div>
            <span class="abk-fold" aria-hidden="true" />
          </figure>
        </div>
        <span class="abk-no" lang="en" aria-hidden="true">2</span>
      </div>
    </section>

    <!-- 01 一路走來：左頁沿革，右頁拉紙條、五校卡紙一校一校站起來 -->
    <section id="story" class="abk-spread abk-story" data-spread aria-labelledby="story-title">
      <div class="abk-page is-left">
        <p class="abk-kicker"><span lang="en"><b>01</b>Our story</span></p>
        <h2 id="story-title" class="abk-title">近三十年，<br>長出五所校園。</h2>
        <p class="abk-text">我們秉持不變的教育理念，堅持專業的保育，也不斷精進、嘗試新的教學方式，努力為孩子營造安心的環境，讓每個孩子都擁有獨一無二的童年。</p>
        <ol class="abk-list">
          <li v-for="item in milestones" :key="item.key">
            <p class="abk-year"><span lang="en">{{ item.year }}</span><small>民國 {{ item.roc }} 年</small></p>
            <div>
              <NuxtLink v-if="item.campus" class="abk-campus" :to="`/campuses/${item.campus.key}`">{{ item.campus.name }}<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
              <p>{{ item.text }}</p>
            </div>
          </li>
        </ol>
        <span class="abk-no" lang="en" aria-hidden="true">3</span>
      </div>
      <div class="abk-page is-right">
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
        <div class="abk-pull" data-pull>
          <div class="abk-track" aria-hidden="true">
            <span v-for="(item, i) in milestones" :key="item.key" class="abk-tick" :style="{ '--t': i / (milestones.length - 1) }">{{ item.year }}</span>
          </div>
          <button class="abk-tab" type="button" role="slider" aria-label="拉紙條，五所校園一校一校站起來" aria-valuemin="1" :aria-valuemax="milestones.length" aria-valuenow="1">拉拉看 <b lang="en" data-pull-year>{{ milestones[0]!.year }}</b></button>
        </div>
        <span class="abk-no" lang="en" aria-hidden="true">4</span>
      </div>
    </section>

    <!-- 02 全人教育：左頁兩份清單，右頁紙轉盤 -->
    <section id="whole-child" class="abk-spread" data-spread aria-labelledby="whole-title">
      <div class="abk-page is-left">
        <p class="abk-kicker"><span lang="en"><b>02</b>Whole child</span></p>
        <h2 id="whole-title" class="abk-title">六大領域，<br>陪孩子完整長大。</h2>
        <p class="abk-text">秉持全人教育的精神，從「幼兒的發展」與「社會文化的期待」出發，以螺旋式的方式加深、加廣課程。</p>
        <div class="abk-lists">
          <div>
            <h3>學習的面向 · 六大領域</h3>
            <ol><li v-for="name in DOMAINS" :key="name">{{ name }}</li></ol>
          </div>
          <div>
            <h3>帶得走的能力 · 六大核心素養</h3>
            <ol><li v-for="name in LITERACIES" :key="name">{{ name }}</li></ol>
          </div>
        </div>
        <p class="abk-fine">六大領域彼此關聯、環環相扣，課程在跨領域的統整下同時進行，讓孩子在參與生活與活動的過程中全面發展。<small>源自幼兒園教保活動課程大綱</small></p>
        <NuxtLink class="abk-link" to="/curriculum">看特色教學怎麼安排<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
        <span class="abk-no" lang="en" aria-hidden="true">5</span>
      </div>
      <div class="abk-page is-right">
        <div class="abk-wheel-wrap">
          <div class="abk-wheel" data-wheel aria-hidden="true">
            <div class="abk-disc">
              <span v-for="(label, i) in SECTOR_LABELS" :key="label" :data-sector="DOMAINS[i]" :style="{ '--i': i }"><b>{{ label }}</b></span>
            </div>
            <div class="abk-cover"><b>全人</b><small>拖著轉轉看</small></div>
          </div>
          <p class="abk-wheel-out" data-wheel-out aria-live="polite" />
          <button class="abk-turn" type="button" data-turn>轉一格<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-counter-clockwise" /></svg></button>
        </div>
        <span class="abk-no" lang="en" aria-hidden="true">6</span>
      </div>
    </section>

    <!-- 03 我們的期許：左頁一段話，右頁折起來的紙房子 -->
    <section id="hope" class="abk-spread abk-hope" data-spread aria-labelledby="hope-title">
      <div class="abk-page is-left">
        <p class="abk-kicker"><span lang="en"><b>03</b>Our hope</span></p>
        <h2 id="hope-title" class="abk-title">孩子的第一所學校，<br>也是第二個家。</h2>
        <blockquote class="abk-quote">
          <p>常春藤的孩子，沒有美艷的花朵，沒有引人的清香，卻擁有優美高雅的氣質。</p>
          <p>我們期許，常春藤的孩子，未來在名為全世界的舞台，展現自我、發光發熱。</p>
        </blockquote>
        <span class="abk-no" lang="en" aria-hidden="true">7</span>
      </div>
      <div class="abk-page is-right">
        <div class="abk-stage">
          <div class="abk-pop abk-tree" data-pop aria-hidden="true" :style="{ '--x': '0%', '--y': '18%', '--w': '22%', '--c': 'var(--leaf)', '--z': 1 }"><div class="abk-card"><i /></div></div>
          <div class="abk-pop abk-tree" data-pop aria-hidden="true" :style="{ '--x': '80%', '--y': '22%', '--w': '20%', '--c': 'var(--trail)', '--z': 1 }"><div class="abk-card"><i /></div></div>
          <figure class="abk-pop abk-house" data-pop :style="{ '--x': '14%', '--y': '10%', '--w': '72%', '--z': 2 }">
            <div class="abk-card">
              <div class="abk-roof" aria-hidden="true" />
              <div class="abk-wall">
                <img v-bind="responsiveImage('about-together', '(max-width: 900px) 56vw, 330px')" alt="孩子們笑著圍在戴眼鏡的長輩身邊，大家開心地擠在一起" loading="lazy">
                <span class="abk-door" aria-hidden="true" />
              </div>
            </div>
          </figure>
        </div>
        <span class="abk-no" lang="en" aria-hidden="true">8</span>
      </div>
    </section>

    <!-- 結尾：五所校園書籤 -->
    <section class="abk-outro" aria-labelledby="about-campuses-title">
      <h2 id="about-campuses-title">五所校園</h2>
      <ul class="abk-marks">
        <template v-for="(item, i) in milestones" :key="item.key">
          <li v-if="item.campus"><NuxtLink :to="`/campuses/${item.campus.key}`" :style="{ '--c': BOOKMARKS[i] }">{{ item.campus.name }}</NuxtLink></li>
        </template>
      </ul>
    </section>
  </main>
</template>

<style scoped src="../assets/css/about.css"></style>
