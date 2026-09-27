<script setup lang="ts">
// 特色教學頁主體（/curriculum）。
// 2026-09-26 從兩個舊官網搬來：01 四個年段、02 七個課程方向取自機構站 ivykidschool.com「教學特色 Course」；
// 04 五件事取自義華校 ivykids.tw「課程特色」（照片是義華校的）。各項目是舊站原文，只修錯字與標點；
// 未經園方確認的宣傳語（高雄獨家、大推）不搬。
// 2026-09-28 改成水彩版（使用者選 C，mock：design/curriculum-watercolor-mockup-20260928）：
// 不再共用 admission.css 的 adm-*；拿掉預約參觀（使用者要求）；新增 03 兒童美術館（機構站「常春藤兒童美術館」
// 相簿）、螺旋式課程（機構站「關於常春藤」）、結尾的教學理念（義華站「關於常春藤」）。
// 水彩層由 useWatercolor 在瀏覽器端畫（data-wash／data-blot／.cur-frame），伺服器端輸出的是乾淨的紙面與照片。
import { CURRICULUM_HERO_IMAGE, CURRICULUM_HERO_SIZES, responsiveImage } from '~/utils/responsive-image'
import type { Pigment } from '~/utils/watercolor'

// 班別與年齡同入學資訊頁：當年 9 月 1 日前滿幾歲（utils/admission-classes.ts）。
// 顏料團一歲比一歲大（scale），數字也跟著長。
const YEARS = [
  { age: 2, name: '幼幼班', en: 'BABY class', motto: '老師好愛我', text: '全方位的保育環境，給孩子安全感及信賴感，這是寶貝第一個團體生活喔。', pigment: 'mint', scale: 0.6 },
  { age: 3, name: '小班', en: 'K1 class', motto: '我會自己做', text: '會自己吃飯、會自己整理，會跟好朋友玩，也會跟老師分享，更會自己主動唸好好玩的故事書喔。', pigment: 'sky', scale: 0.72 },
  { age: 4, name: '中班', en: 'K2 class', motto: '我喜歡學習', text: '打造扎實的學習基礎，語文、認知、邏輯、創造能力都好厲害喔。', pigment: 'sun', scale: 0.86 },
  { age: 5, name: '大班', en: 'K3 class', motto: '要上小學囉', text: '打好基礎做準備，我長大了，好期待上小學喔！', pigment: 'orange', scale: 1 }
] satisfies { age: number, name: string, en: string, motto: string, text: string, pigment: Pigment, scale: number }[]

// 照片取自機構站的課程照（圓形裁切，這裡裁內接 4:3）；校別不明，不標。品德培養沒有照片，改成印在一片橙色顏料上的引言。
// layout 對應 curriculum.css 的錯落排法；wash 是照片背後那團顏料（格式見 utils/watercolor.ts 的 parseWash）。
const DIRECTION_SIZES = '(max-width: 760px) 80vw, (max-width: 1100px) 50vw, 520px'
const DIRECTIONS = [
  { key: 'cognitive', title: '認知課程', sub: '每日一繪本親子共讀', text: '打好學齡前語文基礎，幼小銜接不擔心。', image: 'cur-cognitive', alt: '孩子們圍在桌邊一起翻看繪本', wash: 'sun,.58,.62,.6,.6' },
  { key: 'integrated', title: '統整課程', sub: '奧福音樂、感覺統合、主題學習', text: '完整豐富的統整課程。', image: 'cur-integrated', alt: '孩子抱著比自己還大的足球', wash: 'mint,.44,.6,.66,.56', position: '40% 50%' },
  { key: 'multicultural', title: '多元文化課程', sub: '沉浸式美語活動', text: '孩子勇敢、自信、快樂表現。', image: 'cur-multicultural', alt: '外籍老師在戶外和孩子們說話', wash: 'sky,.56,.58,.66,.56', position: '38% 50%' },
  { key: 'quote', title: '品德培養', sub: '六歲定八十', text: '好習慣一生受用無窮。' },
  { key: 'autonomy', title: '自主學習', sub: '動手做、做中學', text: '讓孩子主動學習教具操作。', image: 'cur-autonomy', alt: '兩個孩子在桌上操作教具', wash: 'sun,.46,.6,.62,.6' },
  { key: 'activities', title: '課程活動', sub: '主題戶外教學', text: '節慶活動及好玩的親子活動。', image: 'cur-activities', alt: '孩子們在戶外教學時聽解說員說話', wash: 'mint,.56,.6,.66,.56', position: '30% 50%' },
  { key: 'art', title: '藝術共創', sub: '每個孩子都是與生俱來的藝術家', text: '給孩子創造思考、解決問題的能力。', image: 'cur-art', alt: '孩子們一起在大塊布上塗顏色', wash: 'orange,.4,.6,.56,.62,.024,40|sky,.95,.2,.2,.3,.03,26', sizes: '(max-width: 760px) 80vw, (max-width: 1100px) 100vw, 800px' }
]

// 作品照片取自機構站「常春藤兒童美術館」相簿（原圖 4608×3456，依 EXIF 轉正後縮到長邊 1600）。
// 沒放的：字母珠球（字母可能拼出孩子名字）、綠色膠帶畫（有手寫字）。替代文字描述作品本身。
const GALLERY = [
  { image: 'cur-gallery-canvas-yellow', label: '畫布上的人', alt: '黃色畫布上，用橘、白、紅色畫的人物和愛心', wash: 'orange,.55,.56,.58,.54' },
  { image: 'cur-gallery-clay-ball', label: '黏土球', alt: '塗成藍紫色、黏滿黏土小裝飾的球', wash: 'sky,.5,.56,.58,.56' },
  { image: 'cur-gallery-tote', label: '帆布袋', alt: '用紅、藍、綠色點畫的帆布袋', wash: 'mint,.5,.56,.58,.54' },
  { image: 'cur-gallery-plane-pink', label: '木頭飛機', alt: '塗成粉紅色的木頭雙翼飛機', wash: 'sun,.5,.6,.58,.56' },
  { image: 'cur-gallery-tee', label: '染色 T 恤', alt: '染上粉紅與黃色的 T 恤', wash: 'mint,.5,.56,.58,.54' },
  { image: 'cur-gallery-canvas-blue', label: '畫布上的人', alt: '藍綠色畫布上，用藍色線條和紅色圈圈畫的人', wash: 'sun,.5,.56,.58,.54' },
  { image: 'cur-gallery-tape', label: '膠帶留白畫', alt: '撕掉膠帶後留下白色線條的粉紅色畫', wash: 'orange,.5,.56,.58,.54' },
  { image: 'cur-gallery-plane-dots', label: '木頭飛機', alt: '點滿藍色與彩色小點的木頭雙翼飛機', wash: 'sky,.5,.6,.58,.56' }
]

// 義華校的五件事，一件配一種顏料。
const DAILY = [
  { title: '靜心', image: 'cur-daily-calm', alt: '孩子們閉上眼睛，雙手合十靜下心來', pigment: 'sky', wash: 'sky,.56,.56,.64,.62', text: '透過靜心活動，引導孩子穩定情緒、學習自我調節，陪伴寶貝在日常中培養尊重、關懷與自我接納，學會愛自己，也溫柔對待他人。' },
  { title: '教具操作', image: 'cur-daily-materials', alt: '女孩笑著把貓頭鷹積木一個個疊高', pigment: 'sun', wash: 'sun,.46,.6,.64,.6', text: '以個別化的自主教具，引導孩子主動探索與學習。堅持動手做、從做中學，老師依孩子的年齡與能力，自行設計合適的教具，讓寶貝在操作中累積知識，一步步建立學習帶來的自信心。' },
  { title: '美術創作', image: 'cur-daily-art', alt: '女孩專心把材料黏到作品上', pigment: 'orange', wash: 'orange,.56,.58,.64,.62', text: '配合孩子的發展，提供主題式的完整學習架構，以孩子為本，引導思考與感受，在學習中培養美學素養，讓寶貝愛上探索美感，逐步發展多元的創作能力。' },
  { title: '閱讀素養', image: 'cur-daily-reading', alt: '兩個女孩靠在一起看繪本', pigment: 'mint', wash: 'mint,.46,.58,.64,.62', text: '以「親子共讀」拉近親子距離，在溫馨的閱讀時光中，培養寶貝愛閱讀的好習慣，穩定情緒、提升認知能力，為學齡前的學習素養奠定更好的基礎。' },
  { title: '大肌肉時間', image: 'cur-daily-motor', alt: '男孩在操場上跳過一排跨欄', pigment: 'leaf', wash: 'leaf,.56,.6,.64,.6', text: '重視寶貝成長中不可或缺的推動力量，透過大量戶外活動與陽光陪伴，讓寶貝盡情與同儕互動、開心放電，在歡笑中學習，在自然中健康成長。' }
] satisfies { title: string, image: string, alt: string, pigment: Pigment, wash: string, text: string }[]

// 義華站「關於常春藤」的教學理念。「二十七年的教育口碑」已過期、「歐式城堡建築」只屬於義華，都不搬。
const BELIEFS = [
  { text: '重視愛與關懷', pigment: 'orange' },
  { text: '注重閱讀素養', pigment: 'sky' },
  { text: '培養生活自理能力', pigment: 'sun' },
  { text: '養成終生學習的好習慣', pigment: 'mint' },
  { text: '尊重個別差異，鼓勵自信探索', pigment: 'leaf' }
] satisfies { text: string, pigment: Pigment }[]

// 章節索引＝一排顏料盤，顏色跟各段主色一致。
const chapters = [
  { id: 'years', no: '01', label: '四個年段', hint: '幼幼班到大班', pigment: 'mint', tilt: -8 },
  { id: 'directions', no: '02', label: '課程方向', hint: `${DIRECTIONS.length} 個方向`, pigment: 'sun', tilt: 10 },
  { id: 'gallery', no: '03', label: '兒童美術館', hint: '孩子的作品', pigment: 'orange', tilt: -4 },
  { id: 'daily', no: '04', label: '五件事', hint: '靜心到大肌肉', pigment: 'sky', tilt: 14 }
] satisfies { id: string, no: string, label: string, hint: string, pigment: Pigment, tilt: number }[]

const root = ref<HTMLElement | null>(null)
useWatercolor(root)
</script>

<template>
  <main id="main" ref="root" tabindex="-1" class="cur" data-cta-entry="curriculum">
    <div class="cur-grain" aria-hidden="true" />

    <section class="cur-hero" aria-labelledby="curriculum-title">
      <canvas class="cur-wash" aria-hidden="true" />
      <div class="cur-wrap cur-hero-grid">
        <div class="cur-hero-copy" data-wash="sun,.3,.44,.6,.5,.024,42|orange,.04,.96,.12,.1,.03,26">
          <p class="cur-eyebrow">常春藤幼兒園 · 特色教學</p>
          <h1 id="curriculum-title">從<span class="cur-swash"><span class="cur-blot cur-swash-paint" data-blot="orange" aria-hidden="true" />動手做</span>開始，<br>愛上學習。</h1>
          <p class="cur-lede">幼幼班到大班的四個年段、七個課程方向、孩子的作品，還有每天常做的五件事。</p>
          <p class="cur-notice">照片取自各校日常，實際課程安排以各校說明為準。</p>
        </div>
        <figure class="cur-hero-photo cur-frame" data-wash="mint,.6,.58,.6,.54,.03,40|sky,.98,.04,.26,.2,.034,30">
          <img v-bind="responsiveImage(CURRICULUM_HERO_IMAGE, CURRICULUM_HERO_SIZES)" alt="孩子閉上眼睛，雙手合十靜下心來" loading="eager" fetchpriority="high">
        </figure>
      </div>
      <nav class="cur-wrap cur-index" aria-label="本頁章節">
        <a v-for="chapter in chapters" :key="chapter.id" :href="`#${chapter.id}`" :style="{ '--tilt': `${chapter.tilt}deg` }">
          <span class="cur-pan" aria-hidden="true"><span class="cur-blot" :data-blot="chapter.pigment" /><span class="cur-num" lang="en">{{ chapter.no }}</span></span>
          <span class="cur-index-copy"><b>{{ chapter.label }}</b><span>{{ chapter.hint }}</span></span>
        </a>
      </nav>
    </section>

    <!-- 01 四個年段：四團顏料一歲比一歲大 -->
    <section id="years" class="cur-sec cur-years" aria-labelledby="years-title">
      <canvas class="cur-wash" aria-hidden="true" />
      <div class="cur-wrap">
        <div class="cur-years-head" data-reveal>
          <div>
            <p class="cur-kicker"><span class="cur-num" lang="en">01</span><span lang="en">Four years</span></p>
            <h2 id="years-title" class="cur-title">從幼幼班到大班，<br>一年一個樣子。</h2>
            <p class="cur-text">給孩子樂於學習、創造思考、勇敢表現、帶著走的核心素養。</p>
            <p class="cur-spiral"><span class="cur-blot" data-blot="sky" aria-hidden="true" /><b>螺旋式課程</b>以螺旋式的方法加深、加廣課程，延伸孩子各項能力。</p>
            <div class="cur-links">
              <NuxtLink class="cur-link" to="/admission#classes">用生日查孩子讀哪一班<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
              <NuxtLink class="cur-link" to="/about#whole-child">課綱六大領域與核心素養<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
            </div>
          </div>
          <figure class="cur-years-photo">
            <div class="cur-frame" data-wash="sky,.6,.58,.58,.56,.026,36"><img v-bind="responsiveImage('cur-years', '(max-width: 900px) 100vw, 45vw')" alt="老師張開雙手，和孩子們笑成一團" loading="lazy"></div>
            <figcaption>老師和孩子們一起笑成一團。</figcaption>
          </figure>
        </div>
        <ol class="cur-year-list" data-reveal>
          <li v-for="(year, i) in YEARS" :key="year.name" class="cur-year" :style="{ '--i': i, '--s': year.scale }">
            <span class="cur-year-age" aria-hidden="true"><span class="cur-blot" :data-blot="year.pigment" /><b>{{ year.age }}</b><sup>歲</sup></span>
            <p class="cur-year-name"><b>{{ year.name }}</b><span lang="en">{{ year.en }}</span></p>
            <h3>「{{ year.motto }}」</h3>
            <p>{{ year.text }}</p>
            <small>當年 9 月 1 日前滿 {{ year.age }} 歲</small>
          </li>
        </ol>
      </div>
    </section>

    <!-- 02 課程方向：大小錯落，品德培養印在一片顏料上 -->
    <section id="directions" class="cur-sec cur-directions" aria-labelledby="directions-title">
      <canvas class="cur-wash" aria-hidden="true" />
      <div class="cur-wrap">
        <div class="cur-dir-head" data-reveal>
          <p class="cur-kicker"><span class="cur-num" lang="en">02</span><span lang="en">Curriculum</span></p>
          <h2 id="directions-title" class="cur-title">每一種學習，<br>都從好奇開始。</h2>
          <p class="cur-text">從每天的繪本共讀，到音樂、美語、戶外教學與藝術創作。</p>
        </div>
        <ul class="cur-dir-grid" aria-label="七個課程方向" data-reveal-group data-wash-mobile="mint,.45,.36,.72,.36,.022,34">
          <li v-for="item in DIRECTIONS" :key="item.key" class="cur-dir" :class="`cur-dir--${item.key}`" data-reveal>
            <span v-if="!item.image" class="cur-blot" data-blot="orange" aria-hidden="true" />
            <div v-if="item.image" class="cur-frame" :data-wash="item.wash">
              <img v-bind="responsiveImage(item.image, item.sizes ?? DIRECTION_SIZES)" :alt="item.alt" :style="item.position ? { objectPosition: item.position } : undefined" loading="lazy">
            </div>
            <div class="cur-dir-copy">
              <h3>{{ item.title }}</h3>
              <p class="cur-dir-sub">{{ item.sub }}</p>
              <p>{{ item.text }}</p>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <!-- 03 兒童美術館：作品保留原本比例，沙龍式掛成一面牆 -->
    <section id="gallery" class="cur-sec cur-gallery" aria-labelledby="gallery-title">
      <canvas class="cur-wash" aria-hidden="true" />
      <div class="cur-wrap">
        <div class="cur-split-head" data-reveal>
          <div>
            <p class="cur-kicker"><span class="cur-num" lang="en">03</span><span lang="en">Art gallery</span></p>
            <h2 id="gallery-title" class="cur-title">每一件作品，<br>都從動手做開始。</h2>
          </div>
          <p class="cur-text">帆布袋、畫布、黏土到木頭飛機，這裡是孩子們的作品。<small class="cur-source">作品照片取自機構網站「常春藤兒童美術館」。</small></p>
        </div>
        <ul class="cur-art-wall" aria-label="孩子的作品" data-reveal-group data-wash-mobile="sun,.45,.4,.72,.36,.022,34">
          <li v-for="art in GALLERY" :key="art.image" class="cur-art" data-reveal>
            <div class="cur-frame" :data-wash="art.wash"><img v-bind="responsiveImage(art.image, '(max-width: 760px) 62vw, (max-width: 1100px) 33vw, 300px')" :alt="art.alt" loading="lazy"></div>
            <span>{{ art.label }}</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- 04 五件事：紙上的五幅畫，各配一種顏料 -->
    <section id="daily" class="cur-sec cur-daily" aria-labelledby="daily-title">
      <canvas class="cur-wash" aria-hidden="true" />
      <div class="cur-wrap">
        <div class="cur-split-head" data-reveal>
          <div>
            <p class="cur-kicker"><span class="cur-num" lang="en">04</span><span lang="en">Five things</span></p>
            <h2 id="daily-title" class="cur-title">五件事，<br>陪孩子慢慢練習。</h2>
          </div>
          <p class="cur-text">安靜下來、動手操作、創作、閱讀，再到戶外盡情跑跳。<small class="cur-source">照片與介紹取自義華校。</small></p>
        </div>
        <ol class="cur-daily-list" aria-label="五件事" data-reveal-group data-wash-mobile="sky,.45,.3,.72,.3,.022,34">
          <li v-for="(item, i) in DAILY" :key="item.title" class="cur-thing" data-reveal>
            <div class="cur-frame" :data-wash="item.wash"><img v-bind="responsiveImage(item.image, '(max-width: 760px) 80vw, (max-width: 1100px) 50vw, 400px')" :alt="item.alt" loading="lazy"></div>
            <p class="cur-thing-no" lang="en"><span class="cur-blot" :data-blot="item.pigment" aria-hidden="true" />{{ String(i + 1).padStart(2, '0') }}</p>
            <h3>{{ item.title }}</h3>
            <p>{{ item.text }}</p>
          </li>
        </ol>
      </div>
    </section>

    <!-- 結尾：教學理念（2026-09-28 取代原本的結尾卡片，使用者要求） -->
    <section id="belief" class="cur-sec cur-belief" aria-labelledby="belief-title">
      <canvas class="cur-wash" aria-hidden="true" />
      <div class="cur-wrap cur-belief-body" data-reveal data-wash="sun,.5,.34,.42,.4,.016,44|mint,.14,.66,.18,.3,.02,34|sky,.86,.24,.16,.26,.02,34">
        <p class="cur-kicker"><span lang="en">Our belief</span></p>
        <h2 id="belief-title" class="cur-belief-title">我們相信，教育是<br>「生命影響生命」的使命。</h2>
        <ul class="cur-belief-list">
          <li v-for="belief in BELIEFS" :key="belief.text"><span class="cur-blot" :data-blot="belief.pigment" aria-hidden="true" />{{ belief.text }}</li>
        </ul>
        <p class="cur-belief-close">期許幼兒在成長階段，擁有快樂、健康的環境。<small class="cur-source">取自義華校教學理念。</small></p>
      </div>
    </section>
  </main>
</template>

<style scoped src="../assets/css/curriculum.css"></style>
