<script setup lang="ts">
// 關於常春藤頁主體（/about）。2026-09-26 從機構站 ivykidschool.com「關於常春藤 About」搬來：
// - 01 一路走來：沿革原文「民國86年義華路成立……110年仁武校」，五校各一個節點。
//   舊站寫「三十多個春夏秋冬」，1997 到今年未滿三十年，照首頁改成「近三十年」。
//   崇德校同年成立的「ESL 美語部」先不寫（美語補習班要不要露出還沒定案）。
// - 02 全人教育：舊站「全人教育理念」，六大領域與六大核心素養源自幼兒園教保活動課程大綱。
// - 03 我們的期許：舊站首頁「Our Goals」與「幼兒園是孩童第一所學校也是孩童第二個家」。
// 版型沿用特色教學頁與常春藤環境頁，共用 admission.css 的 adm-*；內容寫在元件裡，不進後台。
// 不綁 30 週年（週年版尚未拍板）。校名、照片跟著後台發布的分校資料；年份是固定的沿革。
import type { Campus } from '~/types/site-content'
import { pickImage } from '~/utils/media-image'
import { ABOUT_HERO_IMAGE, pageHeroImage, responsiveImage } from '~/utils/responsive-image'

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

const DOMAINS = ['身體動作與健康', '認知', '語文', '社會', '情緒', '美感']
const LITERACIES = ['覺知辨識', '表達溝通', '關懷合作', '推理賞析', '想像創造', '自主管理']

const chapters = [
  { id: 'story', no: '01', label: '一路走來', hint: '1997 到 2021' },
  { id: 'whole-child', no: '02', label: '全人教育', hint: '六大領域' },
  { id: 'hope', no: '03', label: '我們的期許', hint: '第二個家' }
]
</script>

<template>
  <main id="main" tabindex="-1" class="adm abt" data-cta-entry="about">
    <section class="adm-hero photo-hero" aria-labelledby="about-page-title">
      <img class="adm-hero-photo abt-hero-photo" v-bind="pageHeroImage(ABOUT_HERO_IMAGE)" alt="孩子們笑著圍在戴眼鏡的長輩身邊，大家擠在一起" loading="eager" fetchpriority="high">
      <div class="adm-hero-shade" aria-hidden="true" />
      <div class="adm-wrap adm-hero-body">
        <div class="adm-hero-copy">
          <span class="adm-eyebrow">常春藤教育機構 · 關於常春藤</span>
          <h1 id="about-page-title">從一間幼兒園，<br>長成<span class="adm-grow">五所校園<span class="adm-underline" aria-hidden="true"><svg viewBox="0 0 180 14" preserveAspectRatio="none"><path d="M3 9Q48 2 92 7T177 6" /></svg></span></span>。</h1>
          <p class="adm-lede">1997 年，第一間常春藤在高雄義華路成立。近三十年來，我們守著同一份教育理念與專業保育，陪孩子過一段獨一無二的童年。</p>
          <div class="adm-hero-actions">
            <NuxtLink class="adm-pill-button" to="/visit">預約參觀<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
            <a class="adm-text-link" href="#story">看我們一路走來<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-down" /></svg></a>
          </div>
        </div>
        <ol class="adm-chapters" aria-label="本頁章節">
          <li v-for="chapter in chapters" :key="chapter.id">
            <a :href="`#${chapter.id}`"><span class="adm-num" lang="en">{{ chapter.no }}</span><b>{{ chapter.label }}</b><span>{{ chapter.hint }}</span></a>
          </li>
        </ol>
      </div>
    </section>

    <!-- 01 一路走來：薄荷色帶，五校沿革 -->
    <section id="story" class="adm-process abt-story" aria-labelledby="story-title">
      <div class="adm-watermark" aria-hidden="true">一路走來</div>
      <div class="adm-wrap">
        <div class="adm-process-layout">
          <div>
            <p class="adm-kicker"><span lang="en"><b>01</b>Our story</span></p>
            <h2 id="story-title" class="adm-title">近三十年，<br>長出五所校園。</h2>
            <p class="adm-process-text">我們秉持不變的教育理念，堅持專業的保育，也不斷精進、嘗試新的教學方式，努力為孩子營造安心的環境，讓每個孩子都擁有獨一無二的童年。</p>
          </div>
          <figure class="adm-photo">
            <img v-bind="responsiveImage('about-together', '(max-width: 900px) 100vw, 45vw')" alt="孩子們笑著圍在戴眼鏡的長輩身邊，大家開心地擠在一起" loading="lazy">
            <figcaption>把每個孩子，放在心上。</figcaption>
          </figure>
        </div>
        <ol class="abt-timeline">
          <li v-for="item in milestones" :key="item.key" class="abt-milestone">
            <p class="abt-year"><span lang="en">{{ item.year }}</span><small>民國 {{ item.roc }} 年</small></p>
            <NuxtLink v-if="item.campus" class="abt-campus" :to="`/campuses/${item.campus.key}`">
              <img v-bind="pickImage(item.campus.image, item.campus.imageMedia, '(max-width: 760px) 30vw, (max-width: 1100px) 45vw, 240px')" alt="" loading="lazy">
              <h3>{{ item.campus.name }}<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></h3>
              <p>{{ item.text }}</p>
            </NuxtLink>
          </li>
        </ol>
      </div>
    </section>

    <!-- 02 全人教育：淡米底、置中標題；六大領域 → 六大核心素養 -->
    <section id="whole-child" class="adm-classes abt-whole" aria-labelledby="whole-title">
      <div class="adm-wrap">
        <div class="adm-center-head">
          <p class="adm-kicker"><span lang="en"><b>02</b>Whole child</span></p>
          <h2 id="whole-title" class="adm-title">六大領域，<br>陪孩子完整長大。</h2>
          <p>秉持全人教育的精神，從「幼兒的發展」與「社會文化的期待」出發，以螺旋式的方式加深、加廣課程。</p>
        </div>
        <div class="abt-whole-board">
          <div class="abt-whole-col">
            <h3><small>學習的面向</small>六大領域</h3>
            <ul class="abt-chips">
              <li v-for="(name, i) in DOMAINS" :key="name"><span lang="en">{{ String(i + 1).padStart(2, '0') }}</span>{{ name }}</li>
            </ul>
          </div>
          <div class="abt-whole-arrow" aria-hidden="true"><svg class="icon"><use href="#i-arrow-right" /></svg></div>
          <div class="abt-whole-col is-goal">
            <h3><small>帶得走的能力</small>六大核心素養</h3>
            <ul class="abt-chips">
              <li v-for="(name, i) in LITERACIES" :key="name"><span lang="en">{{ String(i + 1).padStart(2, '0') }}</span>{{ name }}</li>
            </ul>
          </div>
        </div>
        <p class="abt-whole-note">六大領域彼此關聯、環環相扣，課程在跨領域的統整下同時進行，讓孩子在參與生活與活動的過程中全面發展。<small>源自幼兒園教保活動課程大綱</small></p>
        <p class="abt-whole-more">
          <NuxtLink class="adm-text-link" to="/curriculum">看特色教學怎麼安排<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
        </p>
      </div>
    </section>

    <!-- 03 我們的期許：深綠舞台上的一段話 -->
    <section id="hope" class="adm-newcomer abt-hope" aria-labelledby="hope-title">
      <div class="adm-watermark" aria-hidden="true">常春藤</div>
      <div class="adm-wrap">
        <p class="adm-kicker"><span lang="en"><b>03</b>Our hope</span></p>
        <h2 id="hope-title" class="adm-title">孩子的第一所學校，<br>也是第二個家。</h2>
        <blockquote class="abt-quote">
          <p>常春藤的孩子，沒有美艷的花朵，沒有引人的清香，卻擁有優美高雅的氣質。</p>
          <p>我們期許，常春藤的孩子，未來在名為全世界的舞台，展現自我、發光發熱。</p>
        </blockquote>
      </div>
    </section>

    <!-- 結尾：預約卡的紙從深綠舞台升起 -->
    <section class="adm-sheet abt-visit-sheet" aria-labelledby="about-visit-title">
      <div class="adm-sheet-wrap">
        <div class="adm-visit">
          <img v-bind="responsiveImage('about-curious', '(max-width: 900px) 100vw, 45vw')" alt="孩子們笑著指向前方" loading="lazy">
          <div class="adm-visit-copy">
            <p class="adm-kicker"><span lang="en">Book a visit</span></p>
            <h2 id="about-visit-title" class="adm-title">五所校園，<br>歡迎你來走走。</h2>
            <p>參觀時可以看看教室與戶外空間，也可以直接問老師孩子的一天怎麼過。</p>
            <NuxtLink class="adm-pill-button" to="/visit">預約校園參觀<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped src="../assets/css/admission.css"></style>
<style scoped src="../assets/css/about.css"></style>
