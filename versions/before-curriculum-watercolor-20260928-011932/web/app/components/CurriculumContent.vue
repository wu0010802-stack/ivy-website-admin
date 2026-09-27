<script setup lang="ts">
// 特色教學頁主體（/curriculum）。2026-09-26 從兩個舊官網搬來：
// - 01 四個年段、02 七個課程方向：機構站 ivykidschool.com「教學特色 Course」（四年八階段、課程支柱）。
// - 03 五件事：義華校 ivykids.tw「課程特色」（靜心、教具操作、美術創作、閱讀素養、大肌肉時間），照片是義華校的。
// 版型沿用入學資訊頁與常春藤環境頁，共用 admission.css 的 adm-*。各項目是舊站原文，只修錯字與標點；
// 「《常春藤幼兒園》高雄獨家課程」「大推」等宣傳語拿掉（未經園方確認的說法）。區塊大標與引言是新寫的。
// 標題字型是子集（見 CLAUDE.md「字型子集」）：大標只用子集裡有的字；課程名稱有缺字，卡片標題改用內文字型。
import { CURRICULUM_HERO_IMAGE, pageHeroImage, responsiveImage } from '~/utils/responsive-image'

// 班別與年齡同入學資訊頁：當年 9 月 1 日前滿幾歲（utils/admission-classes.ts）。
const YEARS = [
  { age: 2, name: '幼幼班', en: 'BABY class', motto: '老師好愛我', text: '全方位的保育環境，給孩子安全感及信賴感，這是寶貝第一個團體生活喔。' },
  { age: 3, name: '小班', en: 'K1 class', motto: '我會自己做', text: '會自己吃飯、會自己整理，會跟好朋友玩，也會跟老師分享，更會自己主動唸好好玩的故事書喔。' },
  { age: 4, name: '中班', en: 'K2 class', motto: '我喜歡學習', text: '打造扎實的學習基礎，語文、認知、邏輯、創造能力都好厲害喔。' },
  { age: 5, name: '大班', en: 'K3 class', motto: '要上小學囉', text: '打好基礎做準備，我長大了，好期待上小學喔！' }
]

// 照片取自機構站的課程照（圓形裁切，這裡裁內接 4:3）；校別不明，不標。品德培養沒有對應照片。
const DIRECTIONS = [
  { title: '認知課程', sub: '每日一繪本親子共讀', text: '打好學齡前語文基礎，幼小銜接不擔心。', image: 'cur-cognitive', alt: '孩子們圍在桌邊一起翻看繪本' },
  { title: '統整課程', sub: '奧福音樂、感覺統合、主題學習', text: '完整豐富的統整課程。', image: 'cur-integrated', alt: '孩子抱著比自己還大的足球' },
  { title: '多元文化課程', sub: '沉浸式美語活動', text: '孩子勇敢、自信、快樂表現。', image: 'cur-multicultural', alt: '外籍老師在戶外和孩子們說話' },
  { title: '品德培養', sub: '六歲定八十', text: '好習慣一生受用無窮。' },
  { title: '自主學習', sub: '動手做、做中學', text: '讓孩子主動學習教具操作。', image: 'cur-autonomy', alt: '兩個孩子在桌上操作教具' },
  { title: '課程活動', sub: '主題戶外教學', text: '節慶活動及好玩的親子活動。', image: 'cur-activities', alt: '孩子們在戶外教學時聽解說員說話' },
  { title: '藝術共創', sub: '每個孩子都是與生俱來的藝術家', text: '給孩子創造思考、解決問題的能力。', image: 'cur-art', alt: '孩子們一起在大塊布上塗顏色' }
]

const DAILY = [
  { title: '靜心', image: 'cur-daily-calm', alt: '孩子們閉上眼睛，雙手合十靜下心來', text: '透過靜心活動，引導孩子穩定情緒、學習自我調節，陪伴寶貝在日常中培養尊重、關懷與自我接納，學會愛自己，也溫柔對待他人。' },
  { title: '教具操作', image: 'cur-daily-materials', alt: '女孩笑著把貓頭鷹積木一個個疊高', text: '以個別化的自主教具，引導孩子主動探索與學習。堅持動手做、從做中學，老師依孩子的年齡與能力，自行設計合適的教具，讓寶貝在操作中累積知識，一步步建立學習帶來的自信心。' },
  { title: '美術創作', image: 'cur-daily-art', alt: '女孩專心把材料黏到作品上', text: '配合孩子的發展，提供主題式的完整學習架構，以孩子為本，引導思考與感受，在學習中培養美學素養，讓寶貝愛上探索美感，逐步發展多元的創作能力。' },
  { title: '閱讀素養', image: 'cur-daily-reading', alt: '兩個女孩靠在一起看繪本', text: '以「親子共讀」拉近親子距離，在溫馨的閱讀時光中，培養寶貝愛閱讀的好習慣，穩定情緒、提升認知能力，為學齡前的學習素養奠定更好的基礎。' },
  { title: '大肌肉時間', image: 'cur-daily-motor', alt: '男孩在操場上跳過一排跨欄', text: '重視寶貝成長中不可或缺的推動力量，透過大量戶外活動與陽光陪伴，讓寶貝盡情與同儕互動、開心放電，在歡笑中學習，在自然中健康成長。' }
]

const chapters = [
  { id: 'years', no: '01', label: '四個年段', hint: '幼幼班到大班' },
  { id: 'directions', no: '02', label: '課程方向', hint: `${DIRECTIONS.length} 個方向` },
  { id: 'daily', no: '03', label: '五件事', hint: '靜心到大肌肉' }
]
</script>

<template>
  <main id="main" tabindex="-1" class="adm cur" data-cta-entry="curriculum">
    <section class="adm-hero photo-hero" aria-labelledby="curriculum-title">
      <img class="adm-hero-photo cur-hero-photo" v-bind="pageHeroImage(CURRICULUM_HERO_IMAGE)" alt="孩子閉上眼睛，雙手合十靜下心來" loading="eager" fetchpriority="high">
      <div class="adm-hero-shade" aria-hidden="true" />
      <div class="adm-wrap adm-hero-body">
        <div class="adm-hero-copy">
          <span class="adm-eyebrow">常春藤幼兒園 · 特色教學</span>
          <h1 id="curriculum-title">從<span class="adm-grow">動手做<span class="adm-underline" aria-hidden="true"><svg viewBox="0 0 180 14" preserveAspectRatio="none"><path d="M3 9Q48 2 92 7T177 6" /></svg></span></span>開始，<br>愛上學習。</h1>
          <p class="adm-lede">幼幼班到大班的四個年段、七個課程方向，加上孩子常做的五件事。</p>
          <div class="adm-hero-actions">
            <NuxtLink class="adm-pill-button" to="/visit">預約參觀<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
            <a class="adm-text-link" href="#daily">先看孩子做什麼<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-down" /></svg></a>
          </div>
          <p class="adm-notice">照片取自各校日常，實際課程安排以各校說明為準。</p>
        </div>
        <ol class="adm-chapters" aria-label="本頁章節">
          <li v-for="chapter in chapters" :key="chapter.id">
            <a :href="`#${chapter.id}`"><span class="adm-num" lang="en">{{ chapter.no }}</span><b>{{ chapter.label }}</b><span>{{ chapter.hint }}</span></a>
          </li>
        </ol>
      </div>
    </section>

    <!-- 01 四個年段：首頁「關於常春藤」的薄荷色帶 -->
    <section id="years" class="adm-process cur-years" aria-labelledby="years-title">
      <div class="adm-watermark" aria-hidden="true">特色教學</div>
      <div class="adm-wrap">
        <div class="adm-process-layout">
          <div>
            <p class="adm-kicker"><span lang="en"><b>01</b>Four years</span></p>
            <h2 id="years-title" class="adm-title">從幼幼班到大班，<br>一年一個樣子。</h2>
            <p class="adm-process-text">給孩子樂於學習、創造思考、勇敢表現、帶著走的核心素養。</p>
            <NuxtLink class="adm-text-link cur-years-link" to="/admission#classes">用生日查孩子讀哪一班<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
          </div>
          <figure class="adm-photo">
            <img v-bind="responsiveImage('cur-years', '(max-width: 900px) 100vw, 45vw')" alt="老師張開雙手，和孩子們笑成一團" loading="lazy">
            <figcaption>老師和孩子們一起笑成一團。</figcaption>
          </figure>
        </div>
        <ol class="cur-year-list">
          <li v-for="year in YEARS" :key="year.name" class="cur-year">
            <span class="cur-year-age" aria-hidden="true">{{ year.age }}<sup>歲</sup></span>
            <p class="cur-year-name"><b>{{ year.name }}</b><span lang="en">{{ year.en }}</span></p>
            <h3>「{{ year.motto }}」</h3>
            <p>{{ year.text }}</p>
            <small>當年 9 月 1 日前滿 {{ year.age }} 歲</small>
          </li>
        </ol>
      </div>
    </section>

    <!-- 02 課程方向：首頁五校區塊的淡米底、置中標題 -->
    <section id="directions" class="adm-classes cur-directions" aria-labelledby="directions-title">
      <div class="adm-wrap">
        <div class="adm-center-head">
          <p class="adm-kicker"><span lang="en"><b>02</b>Curriculum</span></p>
          <h2 id="directions-title" class="adm-title">每一種學習，<br>都從好奇開始。</h2>
          <p>從每天的繪本共讀，到音樂、美語、戶外教學與藝術創作。</p>
        </div>
        <ul class="cur-direction-grid">
          <li v-for="item in DIRECTIONS" :key="item.title" class="cur-direction" :class="{ 'is-quote': !item.image }">
            <img v-if="item.image" v-bind="responsiveImage(item.image, '(max-width: 760px) 100vw, (max-width: 1100px) 50vw, 400px')" :alt="item.alt" loading="lazy">
            <div class="cur-direction-copy">
              <h3>{{ item.title }}</h3>
              <p class="cur-direction-sub">{{ item.sub }}</p>
              <p>{{ item.text }}</p>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <!-- 03 五件事：孩子的一天的深綠舞台、貼膠帶的拍立得 -->
    <section id="daily" class="adm-newcomer cur-daily" aria-labelledby="daily-title">
      <div class="adm-watermark" aria-hidden="true">動手做</div>
      <div class="adm-wrap">
        <div class="adm-split-head">
          <div>
            <p class="adm-kicker"><span lang="en"><b>03</b>Five things</span></p>
            <h2 id="daily-title" class="adm-title">五件事，<br>陪孩子慢慢練習。</h2>
          </div>
          <p>安靜下來、動手操作、創作、閱讀，再到戶外盡情跑跳。<small class="cur-daily-source">照片與介紹取自義華校。</small></p>
        </div>
        <ol class="cur-print-list">
          <li v-for="(item, i) in DAILY" :key="item.title" class="cur-print">
            <div class="adm-face cur-print-face">
              <span class="adm-tape" aria-hidden="true" />
              <img v-bind="responsiveImage(item.image, '(max-width: 760px) 90vw, (max-width: 1100px) 45vw, 360px')" :alt="item.alt" loading="lazy">
              <p class="cur-print-no" lang="en">{{ String(i + 1).padStart(2, '0') }}</p>
              <h3>{{ item.title }}</h3>
              <p>{{ item.text }}</p>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <!-- 結尾：預約卡的紙從深綠舞台升起 -->
    <section class="adm-sheet cur-visit-sheet" aria-labelledby="curriculum-visit-title">
      <div class="adm-sheet-wrap">
        <div class="adm-visit">
          <img v-bind="responsiveImage('cur-visit', '(max-width: 900px) 100vw, 45vw')" alt="戴聖誕帽的孩子拿小木槌敲教具" loading="lazy">
          <div class="adm-visit-copy">
            <p class="adm-kicker"><span lang="en">Book a visit</span></p>
            <h2 id="curriculum-visit-title" class="adm-title">想看孩子怎麼學，<br>就來教室走一趟。</h2>
            <p>參觀時可以走進教室，看看教具與學習角，也可以直接問老師課程怎麼安排。</p>
            <NuxtLink class="adm-pill-button" to="/visit">預約校園參觀<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped src="../assets/css/admission.css"></style>
<style scoped src="../assets/css/curriculum.css"></style>
