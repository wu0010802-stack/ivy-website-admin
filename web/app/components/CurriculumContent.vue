<script setup lang="ts">
// 特色教學頁主體（/curriculum）。
// 2026-09-26 從兩個舊官網搬來：01 四個年段、02 七個課程方向取自機構站 ivykidschool.com「教學特色 Course」；
// 04 五件事取自義華校 ivykids.tw「課程特色」（照片是義華校的）。各項目是舊站原文，只修錯字與標點；
// 未經園方確認的宣傳語（高雄獨家、大推）不搬。
// 2026-09-28 改成水彩版（使用者選 C，mock：design/curriculum-watercolor-mockup-20260928）：
// 不再共用 admission.css 的 adm-*；拿掉預約參觀（使用者要求）；新增 03 兒童美術館（機構站「常春藤兒童美術館」
// 相簿）、螺旋式課程（機構站「關於常春藤」）、結尾的教學理念（義華站「關於常春藤」）。
// 水彩層由 useWatercolor 在瀏覽器端畫（data-wash／data-blot／.cur-frame），伺服器端輸出的是乾淨的紙面與照片。
// 2026-10 起文字與照片改讀後台「特色教學頁」（curriculum_page，預設＝fixture 的 curriculumPage，
// 一字不差）。章節數量、英文小字、年段名稱與年齡、顏料、版面位置與內建照片仍寫在這裡，
// 清單照索引和後台的固定項目一一對應。
import { curriculumHeroAttrs } from '~/utils/media-image'
import { pageMarkedLines, pagePhotoAlt, pagePhotoAttrs, pagePhotoStyle, pageTitleLines, withPhotoStyle } from '~/utils/page-content'
import type { CurriculumPageContent } from '~/types/site-content'
import type { Pigment } from '~/utils/watercolor'

const props = defineProps<{ page: CurriculumPageContent }>()

// 班別與年齡同入學資訊頁：當年 9 月 1 日前滿幾歲（utils/admission-classes.ts）。
// 顏料團一歲比一歲大（scale），數字也跟著長。標語與說明在後台。
const YEARS = [
  { age: 2, name: '幼幼班', en: 'BABY class', pigment: 'mint', scale: 0.6 },
  { age: 3, name: '小班', en: 'K1 class', pigment: 'sky', scale: 0.72 },
  { age: 4, name: '中班', en: 'K2 class', pigment: 'sun', scale: 0.86 },
  { age: 5, name: '大班', en: 'K3 class', pigment: 'orange', scale: 1 }
] satisfies { age: number, name: string, en: string, pigment: Pigment, scale: number }[]

// 照片取自機構站的課程照（圓形裁切，這裡裁內接 4:3）；校別不明，不標。品德培養沒有照片，改成印在一片橙色顏料上的引言。
// layout 對應 curriculum.css 的錯落排法；wash 是照片背後那團顏料（格式見 utils/watercolor.ts 的 parseWash）。
// alt 是內建照片的說明；後台換了照片就用後台的說明。
const DIRECTION_SIZES = '(max-width: 760px) 80vw, (max-width: 1100px) 50vw, 520px'
const DIRECTIONS = [
  { key: 'cognitive', image: 'cur-cognitive', alt: '孩子們圍在桌邊一起翻看繪本', wash: 'sun,.58,.62,.6,.6' },
  { key: 'integrated', image: 'cur-integrated', alt: '孩子抱著比自己還大的足球', wash: 'mint,.44,.6,.66,.56', position: '40% 50%' },
  { key: 'multicultural', image: 'cur-multicultural', alt: '外籍老師在戶外和孩子們說話', wash: 'sky,.56,.58,.66,.56', position: '38% 50%' },
  { key: 'quote' },
  { key: 'autonomy', image: 'cur-autonomy', alt: '兩個孩子在桌上操作教具', wash: 'sun,.46,.6,.62,.6' },
  { key: 'activities', image: 'cur-activities', alt: '孩子們在戶外教學時聽解說員說話', wash: 'mint,.56,.6,.66,.56', position: '30% 50%' },
  { key: 'art', image: 'cur-art', alt: '孩子們一起在大塊布上塗顏色', wash: 'orange,.4,.6,.56,.62,.024,40|sky,.95,.2,.2,.3,.03,26', sizes: '(max-width: 760px) 80vw, (max-width: 1100px) 100vw, 800px' }
] satisfies { key: string, image?: string, alt?: string, wash?: string, position?: string, sizes?: string }[]

// 作品照片取自機構站「常春藤兒童美術館」相簿（原圖 4608×3456，依 EXIF 轉正後縮到長邊 1600）。
// 沒放的：字母珠球（字母可能拼出孩子名字）、綠色膠帶畫（有手寫字）。替代文字描述作品本身。
const GALLERY = [
  { image: 'cur-gallery-canvas-yellow', alt: '黃色畫布上，用橘、白、紅色畫的人物和愛心', wash: 'orange,.55,.56,.58,.54' },
  { image: 'cur-gallery-clay-ball', alt: '塗成藍紫色、黏滿黏土小裝飾的球', wash: 'sky,.5,.56,.58,.56' },
  { image: 'cur-gallery-tote', alt: '用紅、藍、綠色點畫的帆布袋', wash: 'mint,.5,.56,.58,.54' },
  { image: 'cur-gallery-plane-pink', alt: '塗成粉紅色的木頭雙翼飛機', wash: 'sun,.5,.6,.58,.56' },
  { image: 'cur-gallery-tee', alt: '染上粉紅與黃色的 T 恤', wash: 'mint,.5,.56,.58,.54' },
  { image: 'cur-gallery-canvas-blue', alt: '藍綠色畫布上，用藍色線條和紅色圈圈畫的人', wash: 'sun,.5,.56,.58,.54' },
  { image: 'cur-gallery-tape', alt: '撕掉膠帶後留下白色線條的粉紅色畫', wash: 'orange,.5,.56,.58,.54' },
  { image: 'cur-gallery-plane-dots', alt: '點滿藍色與彩色小點的木頭雙翼飛機', wash: 'sky,.5,.6,.58,.56' }
] satisfies { image: string, alt: string, wash: string }[]

// 義華校的五件事，一件配一種顏料。
const DAILY = [
  { image: 'cur-daily-calm', alt: '孩子們閉上眼睛，雙手合十靜下心來', pigment: 'sky', wash: 'sky,.56,.56,.64,.62' },
  { image: 'cur-daily-materials', alt: '女孩笑著把貓頭鷹積木一個個疊高', pigment: 'sun', wash: 'sun,.46,.6,.64,.6' },
  { image: 'cur-daily-art', alt: '女孩專心把材料黏到作品上', pigment: 'orange', wash: 'orange,.56,.58,.64,.62' },
  { image: 'cur-daily-reading', alt: '兩個女孩靠在一起看繪本', pigment: 'mint', wash: 'mint,.46,.58,.64,.62' },
  { image: 'cur-daily-motor', alt: '男孩在操場上跳過一排跨欄', pigment: 'leaf', wash: 'leaf,.56,.6,.64,.6' }
] satisfies { image: string, alt: string, pigment: Pigment, wash: string }[]

// 教學理念五項各配一種顏料（文字在後台）。
const BELIEF_PIGMENTS = ['orange', 'sky', 'sun', 'mint', 'leaf'] satisfies Pigment[]

// 章節索引＝一排顏料盤，顏色跟各段主色一致；名稱與小字在後台。
const CHAPTERS = [
  { id: 'years', no: '01', pigment: 'mint', tilt: -8 },
  { id: 'directions', no: '02', pigment: 'sun', tilt: 10 },
  { id: 'gallery', no: '03', pigment: 'orange', tilt: -4 },
  { id: 'daily', no: '04', pigment: 'sky', tilt: 14 }
] satisfies { id: string, no: string, pigment: Pigment, tilt: number }[]

const HERO_ALT = '孩子閉上眼睛，雙手合十靜下心來'
const YEARS_ALT = '老師張開雙手，和孩子們笑成一團'

const heroLines = computed(() => pageMarkedLines(props.page.heroTitle, props.page.heroHighlight))
const chapters = computed(() => CHAPTERS.map((look, i) => ({ ...look, ...props.page.chapters[i]! })))
const years = computed(() => YEARS.map((look, i) => ({ ...look, ...props.page.years[i]! })))
const directions = computed(() => DIRECTIONS.map((look, i) => ({ ...look, ...props.page.directions[i]! })))
const gallery = computed(() => GALLERY.map((look, i) => ({ ...look, ...props.page.gallery[i]! })))
const daily = computed(() => DAILY.map((look, i) => ({ ...look, ...props.page.daily[i]! })))

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
          <p class="cur-eyebrow">{{ page.heroEyebrow }}</p>
          <h1 id="curriculum-title"><template v-for="(line, i) in heroLines" :key="i"><br v-if="i">{{ line.before }}<span v-if="line.mark" class="cur-swash"><span class="cur-blot cur-swash-paint" data-blot="orange" aria-hidden="true" />{{ line.mark }}</span>{{ line.after }}</template></h1>
          <p class="cur-lede">{{ page.heroLede }}</p>
          <p v-if="page.heroNotice" class="cur-notice">{{ page.heroNotice }}</p>
        </div>
        <figure class="cur-hero-photo cur-frame" data-wash="mint,.6,.58,.6,.54,.03,40|sky,.98,.04,.26,.2,.034,30">
          <img v-bind="withPhotoStyle(curriculumHeroAttrs(page), page.heroPhoto)" :alt="pagePhotoAlt(HERO_ALT, page.heroPhoto, page.heroPhotoAlt)" loading="eager" fetchpriority="high">
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
            <h2 id="years-title" class="cur-title"><template v-for="(line, i) in pageTitleLines(page.yearsTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
            <p class="cur-text">{{ page.yearsText }}</p>
            <p class="cur-spiral"><span class="cur-blot" data-blot="sky" aria-hidden="true" /><b>{{ page.spiralLabel }}</b>{{ page.spiralText }}</p>
            <div class="cur-links">
              <NuxtLink class="cur-link" to="/admission#classes">用生日查孩子讀哪一班<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
              <NuxtLink class="cur-link" to="/about#whole-child">課綱六大領域與核心素養<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
            </div>
          </div>
          <figure class="cur-years-photo">
            <div class="cur-frame" data-wash="sky,.6,.58,.58,.56,.026,36"><img v-bind="withPhotoStyle(pagePhotoAttrs('cur-years', page.yearsPhoto, '(max-width: 900px) 100vw, 45vw'), page.yearsPhoto)" :alt="pagePhotoAlt(YEARS_ALT, page.yearsPhoto, page.yearsPhotoAlt)" loading="lazy"></div>
            <figcaption v-if="page.yearsCaption">{{ page.yearsCaption }}</figcaption>
          </figure>
        </div>
        <ol class="cur-year-list" data-reveal>
          <li v-for="(year, i) in years" :key="year.name" class="cur-year" :style="{ '--i': i, '--s': year.scale }">
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
          <h2 id="directions-title" class="cur-title"><template v-for="(line, i) in pageTitleLines(page.directionsTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
          <p class="cur-text">{{ page.directionsText }}</p>
        </div>
        <ul class="cur-dir-grid" aria-label="七個課程方向" data-reveal-group data-wash-mobile="mint,.45,.36,.72,.36,.022,34">
          <li v-for="item in directions" :key="item.key" class="cur-dir" :class="`cur-dir--${item.key}`" data-reveal>
            <span v-if="!item.image" class="cur-blot" data-blot="orange" aria-hidden="true" />
            <div v-if="item.image" class="cur-frame" :data-wash="item.wash">
              <img v-bind="pagePhotoAttrs(item.image, item.photo, item.sizes ?? DIRECTION_SIZES)" :alt="pagePhotoAlt(item.alt ?? '', item.photo, item.photoAlt)" :style="pagePhotoStyle(item.position, item.photo)" loading="lazy">
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
            <h2 id="gallery-title" class="cur-title"><template v-for="(line, i) in pageTitleLines(page.galleryTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
          </div>
          <p class="cur-text">{{ page.galleryText }}<small v-if="page.gallerySource" class="cur-source">{{ page.gallerySource }}</small></p>
        </div>
        <ul class="cur-art-wall" aria-label="孩子的作品" data-reveal-group data-wash-mobile="sun,.45,.4,.72,.36,.022,34">
          <li v-for="art in gallery" :key="art.image" class="cur-art" data-reveal>
            <div class="cur-frame" :data-wash="art.wash"><img v-bind="withPhotoStyle(pagePhotoAttrs(art.image, art.photo, '(max-width: 760px) 62vw, (max-width: 1100px) 33vw, 300px'), art.photo)" :alt="pagePhotoAlt(art.alt, art.photo, art.photoAlt)" loading="lazy"></div>
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
            <h2 id="daily-title" class="cur-title"><template v-for="(line, i) in pageTitleLines(page.dailyTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
          </div>
          <p class="cur-text">{{ page.dailyText }}<small v-if="page.dailySource" class="cur-source">{{ page.dailySource }}</small></p>
        </div>
        <ol class="cur-daily-list" aria-label="五件事" data-reveal-group data-wash-mobile="sky,.45,.3,.72,.3,.022,34">
          <li v-for="(item, i) in daily" :key="item.image" class="cur-thing" data-reveal>
            <div class="cur-frame" :data-wash="item.wash"><img v-bind="withPhotoStyle(pagePhotoAttrs(item.image, item.photo, '(max-width: 760px) 80vw, (max-width: 1100px) 50vw, 400px'), item.photo)" :alt="pagePhotoAlt(item.alt, item.photo, item.photoAlt)" loading="lazy"></div>
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
        <h2 id="belief-title" class="cur-belief-title"><template v-for="(line, i) in pageTitleLines(page.beliefTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
        <ul class="cur-belief-list">
          <li v-for="(belief, i) in page.beliefs" :key="i"><span class="cur-blot" :data-blot="BELIEF_PIGMENTS[i]" aria-hidden="true" />{{ belief }}</li>
        </ul>
        <p class="cur-belief-close">{{ page.beliefClose }}<small v-if="page.beliefSource" class="cur-source">{{ page.beliefSource }}</small></p>
      </div>
    </section>
  </main>
</template>

<style scoped src="../assets/css/curriculum.css"></style>
