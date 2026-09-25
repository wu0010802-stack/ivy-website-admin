<script setup lang="ts">
// 常春藤環境頁主體（/environment）。2026-09-25 從舊官網「一日常春藤 Environment」搬來：幼兒保育、
// 校園環境、幼兒餐點三章（舊站的一日流程不搬，首頁已有「孩子的一天」）。版型沿用入學資訊頁，
// 共用 admission.css 的 adm-*（mock：design/environment-mockup-20260925/）。
// 各項目文案是舊站原文，只修錯字與標點；區塊大標與引言是新寫的，標題字型是子集（見 CLAUDE.md「字型子集」）。
// 菜單不抄進網站：按鈕依台北日期開到營養餐點書當月那一頁（meal-book.ts）。
import { ENVIRONMENT_HERO_IMAGE, pageHeroImage, responsiveImage } from '~/utils/responsive-image'
import { mealBookLink } from '~/utils/meal-book'
import type { Campus } from '~/types/site-content'

defineProps<{ campuses: Campus[] }>()

const CARE = [
  { image: 'env-care-health', alt: '老師幫戴著口罩的孩子確認身體狀況', title: '健康把關紀錄', text: '隨時注意孩子身體狀況，每日定時測量體溫。' },
  { image: 'env-care-meal', alt: '孩子們坐在桌邊用碗吃飯', title: '均衡飲食', text: '每日兩蔬果，增進免疫、提升孩子的健康。' },
  { image: 'env-care-clothes', alt: '老師幫孩子整理衣服', title: '衣物保暖', text: '隨時注意孩子服裝的保暖與整齊。' },
  { image: 'env-care-comfort', alt: '老師蹲下來抱著笑開的孩子', title: '情緒安撫', text: '穩定、安定孩子的情緒。' },
  { image: 'env-care-clean', alt: '老師擦拭消毒教室門把', title: '定時消毒', text: '每日定時教室消毒。' }
]

// 只有戶外廣場確定是明華校的照片（舊站檔名「明華戶外廣場」），其餘校別不明，不標。
const SPACES = [
  { image: 'env-space-classroom', alt: '陽光照進木地板教室，牆邊是矮櫃與小桌椅', title: '乾淨溫馨的教室', text: '課程統整，全方位主題教學，帶領孩子走出戶外，接觸大自然。' },
  { image: 'env-space-materials', alt: '教室矮櫃上擺滿各式操作教具', title: '多樣操作教具', text: '多樣性教具提升寶貝邏輯思維；多元玩法搭配豐富內容，讓寶貝養成自主學習的好習慣。' },
  { image: 'env-space-plaza', alt: '明華校寬敞的戶外廣場', title: '戶外廣場', text: '寬敞明亮的大廣場，給予寶貝充足的空間伸展肢體、跑跑跳跳，讓寶貝贏在人生的起跑點！', campus: '明華校' },
  { image: 'env-space-corner', alt: '教室角落貼著厚軟墊，地上鋪著巧拼', title: '安全角落設計', text: '厚軟墊防撞設計，加強角落安全性，寶貝唱唱跳跳好開心。' },
  { image: 'env-space-restroom', alt: '孩子高度的洗手台，掛著一排小毛巾', title: '套房式衛廁', text: '連接教室的套房式衛廁，時刻注意寶貝的安全及如廁狀況；安心環境幫助幼幼寶貝快速戒除尿布好放心！' },
  { image: 'env-space-animals', alt: '孩子蹲在圍欄邊，拿紅蘿蔔餵裡面的小兔子', title: '可愛動物區', text: '可愛動物區激發寶貝主動探索大自然生態的熱情與動力，培養責任心與好奇心。' }
]

// 時間與說明取自舊站一日流程的早餐、蔬果、午餐、點心各段。
const MEAL_TIMES = [
  { amount: '08:30', unit: '早餐', note: '早餐美語', text: '營養好吃的早餐，讓孩子有精神、有活力。' },
  { amount: '2 份', unit: '每日蔬果', note: '10 點香蕉、12 點蘋果', text: '每日兩蔬果，增進免疫、提升孩子的健康。' },
  { amount: '11:40', unit: '午餐', note: '廚房每天現煮', text: '最新鮮、最營養的午餐，健健康康長大。' },
  { amount: '15:30', unit: '點心', note: '西米露、玉米粥', text: '即便是點心，也是豐盛的正餐。' }
]

const meal = mealBookLink()
const chapters = [
  { id: 'care', no: '01', label: '幼兒保育', hint: '五顆心的照顧' },
  { id: 'spaces', no: '02', label: '校園環境', hint: `${SPACES.length + 1} 個孩子的空間` },
  { id: 'meals', no: '03', label: '幼兒餐點', hint: `${meal.month} 月菜單` }
]
</script>

<template>
  <main id="main" tabindex="-1" class="adm env">
    <section class="adm-hero photo-hero" aria-labelledby="environment-title">
      <img class="adm-hero-photo env-hero-photo" v-bind="pageHeroImage(ENVIRONMENT_HERO_IMAGE)" alt="兩個孩子在教室裡緊緊抱在一起" loading="eager" fetchpriority="high">
      <div class="adm-hero-shade" aria-hidden="true" />
      <div class="adm-wrap adm-hero-body">
        <div class="adm-hero-copy">
          <span class="adm-eyebrow">常春藤幼兒園 · 常春藤環境</span>
          <h1 id="environment-title">孩子的每一天，<br>都在這裡<span class="adm-grow">安心<span class="adm-underline" aria-hidden="true"><svg viewBox="0 0 180 14" preserveAspectRatio="none"><path d="M3 9Q48 2 92 7T177 6" /></svg></span></span>長大。</h1>
          <p class="adm-lede">保育照顧、校園環境與幼兒餐點，整理在同一頁。</p>
          <div class="adm-hero-actions">
            <NuxtLink class="adm-pill-button" to="/visit">預約參觀<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
            <a class="adm-text-link" href="#spaces">先看校園環境<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-down" /></svg></a>
          </div>
          <p class="adm-notice">照片取自各校日常，空間配置各校略有不同。</p>
        </div>
        <ol class="adm-chapters" aria-label="本頁章節">
          <li v-for="chapter in chapters" :key="chapter.id">
            <a :href="`#${chapter.id}`"><span class="adm-num" lang="en">{{ chapter.no }}</span><b>{{ chapter.label }}</b><span>{{ chapter.hint }}</span></a>
          </li>
        </ol>
      </div>
    </section>

    <!-- 01 幼兒保育：首頁「關於常春藤」的薄荷色帶 -->
    <section id="care" class="adm-process env-care" aria-labelledby="care-title">
      <div class="adm-watermark" aria-hidden="true">幼兒保育</div>
      <div class="adm-wrap">
        <div class="adm-process-layout">
          <div>
            <p class="adm-kicker"><span lang="en"><b>01</b>Child care</span></p>
            <h2 id="care-title" class="adm-title">五顆心，<br>照顧每一天。</h2>
            <p class="adm-process-text">專業保育照顧，靠的是五顆心：</p>
            <p class="env-hearts">愛心・細心・耐心・貼心・同理心</p>
            <p class="adm-process-text env-care-text">從量體溫、吃蔬果到換衣服、安撫情緒，老師把孩子在學校的每一件小事都放在心上。</p>
          </div>
          <figure class="adm-photo env-care-photo">
            <img v-bind="responsiveImage('env-care-teacher', '(max-width: 900px) 100vw, 45vw')" alt="老師拿著鈴鼓，帶幼幼班孩子一起拍手唱歌" loading="lazy">
            <figcaption>老師帶著幼幼班的孩子，一起拍手唱歌。</figcaption>
          </figure>
        </div>
        <ol class="env-care-list">
          <li v-for="(item, i) in CARE" :key="item.image" class="env-care-card">
            <img v-bind="responsiveImage(item.image, '(max-width: 760px) 112px, (max-width: 900px) 50vw, (max-width: 1100px) 33vw, 240px')" :alt="item.alt" loading="lazy">
            <div>
              <span class="env-care-no" lang="en">{{ String(i + 1).padStart(2, '0') }}</span>
              <h3>{{ item.title }}</h3>
              <p>{{ item.text }}</p>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <!-- 02 校園環境：首頁五校區塊的淡米底、置中標題 -->
    <section id="spaces" class="adm-classes env-spaces" aria-labelledby="spaces-title">
      <div class="adm-wrap">
        <div class="adm-center-head">
          <p class="adm-kicker"><span lang="en"><b>02</b>Our spaces</span></p>
          <h2 id="spaces-title" class="adm-title">把安全與好奇，<br>放進每個角落。</h2>
          <p>從教室、教具、衛廁到戶外廣場，每個空間都以孩子的安全與探索為出發點。</p>
        </div>
        <article class="adm-class-board env-feature">
          <div class="adm-finder env-feature-copy">
            <span class="env-feature-label">安全歡樂遊樂區</span>
            <h3>在遊戲裡，<br>慢慢長大。</h3>
            <p>遊戲幫助寶貝成長發育，發展精細動作、激發想像力、提升手眼協調力，讓寶貝開心、健康、快樂地成長。</p>
          </div>
          <img class="env-feature-photo" v-bind="responsiveImage('env-space-playground', '(max-width: 1100px) 100vw, 740px')" alt="校園裡色彩繽紛的溜滑梯與遊戲設施" loading="lazy">
        </article>
        <ul class="env-space-grid">
          <li v-for="space in SPACES" :key="space.image" class="env-space">
            <div class="env-space-photo">
              <img v-bind="responsiveImage(space.image, '(max-width: 760px) 100vw, (max-width: 1100px) 50vw, 400px')" :alt="space.alt" loading="lazy">
              <span v-if="space.campus" class="env-space-campus">{{ space.campus }}</span>
            </div>
            <h3>{{ space.title }}</h3>
            <p>{{ space.text }}</p>
          </li>
        </ul>
        <nav v-if="campuses.length" class="env-campus-art" aria-labelledby="campus-art-title">
          <p id="campus-art-title">五校空間各有不同，到分校頁看實景</p>
          <ul>
            <li v-for="campus in campuses" :key="campus.key">
              <NuxtLink :to="`/campuses/${campus.key}#environment`">
                <img v-bind="responsiveImage(`campus-line-art-${campus.key}`, '(max-width: 760px) 31vw, 190px')" alt="" loading="lazy" decoding="async">
                <span>{{ campus.name }}</span>
              </NuxtLink>
            </li>
          </ul>
        </nav>
      </div>
    </section>

    <!-- 03 幼兒餐點：孩子的一天的深綠舞台 -->
    <section id="meals" class="adm-newcomer env-meals" aria-labelledby="meals-title">
      <div class="adm-watermark" aria-hidden="true">幼兒餐點</div>
      <div class="adm-wrap">
        <div class="adm-split-head">
          <div>
            <p class="adm-kicker"><span lang="en"><b>03</b>Meals</span></p>
            <h2 id="meals-title" class="adm-title">多一點天然，<br>少一點加工。</h2>
          </div>
          <p>每日餐點符合營養標準，廚房每天現煮，讓孩子吃到食物最原始的味道。每個月的菜單，都收在常春藤營養餐點書裡。</p>
        </div>
        <div class="env-meal-layout">
          <div class="env-book">
            <a class="env-book-cover" :href="meal.href" target="_blank" rel="noopener" :aria-label="`打開營養餐點書的 ${meal.month} 月菜單（另開新視窗）`">
              <img v-bind="responsiveImage('env-meal-book', '(max-width: 760px) 112px, (max-width: 900px) 200px, (max-width: 1100px) 240px, 300px')" alt="" loading="lazy">
            </a>
            <a class="adm-pill-button env-book-button" :href="meal.href" target="_blank" rel="noopener">{{ meal.label }}<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-up-right" /></svg><span class="sr-only">（另開新視窗）</span></a>
            <p class="env-book-note">每天的早餐、午餐、點心，<br>都在營養餐點書的<span>{{ meal.month }} 月</span>那一頁。</p>
          </div>
          <div class="adm-subsidies env-meal-times">
            <div v-for="item in MEAL_TIMES" :key="item.unit" class="adm-subsidy">
              <span class="adm-subsidy-amt"><b>{{ item.amount }}</b><span>{{ item.unit }}</span></span>
              <span class="adm-subsidy-copy"><small>{{ item.note }}</small><strong>{{ item.text }}</strong></span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 結尾：預約卡的紙從深綠舞台升起 -->
    <section class="adm-sheet env-visit-sheet" aria-labelledby="environment-visit-title">
      <div class="adm-sheet-wrap">
        <div class="adm-visit">
          <img v-bind="responsiveImage('env-space-classroom', '(max-width: 900px) 100vw, 45vw')" alt="陽光照進木地板教室" loading="lazy">
          <div class="adm-visit-copy">
            <p class="adm-kicker"><span lang="en">Book a visit</span></p>
            <h2 id="environment-visit-title" class="adm-title">環境好不好，<br>來看一次最清楚。</h2>
            <p>教室、遊戲區、午睡和用餐的地方，參觀時都可以走一圈。</p>
            <NuxtLink class="adm-pill-button" to="/visit">預約校園參觀<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped src="../assets/css/admission.css"></style>
<style scoped src="../assets/css/environment.css"></style>
