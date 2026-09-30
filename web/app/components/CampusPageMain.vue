<script setup lang="ts">
// 分校頁主體。正式頁（pages/campuses/[key].vue）與私有草稿預覽
// （pages/preview.vue?page=campus）共用，兩邊畫面才不會漂移。
import type { Campus } from '~/types/site-content'
import type { CampusBannerSource } from '~/utils/campus-banner'
import { campusHeroAttrs } from '~/utils/media-image'
import { campusMapUrl } from '~/utils/site-links'

// campuses：「交通與聯絡」右欄列出其他校區（2026-09-29 評析：桌機分校頁原本右半欄空著，換校只能靠頁尾或回首頁）。
// booking：已發布（預覽時是草稿）的預約文案，底部橫幅的三句從這裡讀。
const props = defineProps<{ campus: Campus; campuses?: Campus[]; booking: CampusBannerSource }>()
const otherCampuses = computed(() => (props.campuses ?? []).filter(item => item.key !== props.campus.key))
</script>

<template>
  <main id="main" tabindex="-1" :data-campus-key="campus.key">
    <div class="container breadcrumb">
      <NuxtLink to="/">首頁</NuxtLink> / <a href="/#campuses">五所校園</a> / {{ campus.name }}
    </div>
    <section class="hero campus-hero" data-cta-entry="campus_hero" :style="{ '--campus-photo-position': campus.heroPhotoPos || 'center' }">
      <img class="hero-photo" v-bind="campusHeroAttrs(campus)" :alt="`${campus.name}校園外觀`" loading="eager" fetchpriority="high">
      <div class="hero-shade" />
      <div class="container">
        <span class="eyebrow">常春藤幼兒園 · 高雄{{ campus.district }}</span>
        <h1>{{ campus.name }}</h1>
        <p>{{ campus.intro }}</p>
        <div class="hero-cta">
          <BookingCta :campus-key="campus.key" :label="`預約參觀${campus.name}`" button-class="button yellow" />
        </div>
      </div>
      <div class="hero-bottom"><span class="hero-caption">{{ campus.name }} · 校園圖像</span></div>
    </section>

    <section class="section" id="about">
      <div class="container detail-grid">
        <div>
          <span class="eyebrow">認識{{ campus.name }}</span>
          <h2 class="section-title">{{ campus.intro }}</h2>
          <p class="section-copy">{{ campus.description }}</p>
          <p class="section-copy">不急著做決定，先從一次親自走訪開始。帶著你想了解的事情，看看這裡是否適合孩子。</p>
        </div>
        <div class="contact-panel" data-cta-entry="campus_info">
          <h3>來認識{{ campus.name }}</h3>
          <dl>
            <div><dt>所在地</dt><dd>{{ campus.address }}</dd></div>
            <div><dt>參觀專線</dt><dd><a :href="`tel:${campus.phone}`">{{ campus.phone }}</a></dd></div>
            <div><dt>到園參觀</dt><dd>請事先聯絡園所確認接待時間。</dd></div>
          </dl>
          <a
            class="text-link"
            :href="campusMapUrl(campus)"
            target="_blank"
            rel="noopener noreferrer"
          >
            查看地圖與路線<span aria-hidden="true">↗</span><span class="sr-only">（另開新視窗）</span>
          </a>
        </div>
      </div>
    </section>

    <CampusTour :campus="campus" />

    <CampusTestimonials v-if="campus.testimonials?.length" :campus="campus" :items="campus.testimonials" />

    <!-- 本校題目都停用、也不顯示共用題目時，整段不出現。 -->
    <section v-if="campus.faq.items.length" class="section" id="faq">
      <div class="container faq-grid">
        <div>
          <span class="eyebrow">參觀須知</span>
          <h2 class="section-title">讓第一次參觀，<br>更安心一點。</h2>
          <p class="section-copy">參觀時間、課程與入學安排，<br>請直接向{{ campus.name }}確認。</p>
        </div>
        <CampusFaq :items="campus.faq.items" />
      </div>
    </section>

    <section class="section campuses" id="contact" data-cta-entry="campus_contact">
      <div class="container detail-grid">
        <div class="contact-location">
          <span class="eyebrow">交通與聯絡</span>
          <h2 class="section-title">我們在這裡，等你來。</h2>
          <a class="phone-link" :href="`tel:${campus.phone}`">{{ campus.phone }}</a>
          <p>{{ campus.address }}</p>
          <!-- LINE 只放該校自己的帳號，沒有就不顯示，不借用別校（CLAUDE.md）。 -->
          <div class="contact-links">
            <a class="text-link" :href="campusMapUrl(campus)" target="_blank" rel="noopener noreferrer">查看地圖與路線<span aria-hidden="true">↗</span><span class="sr-only">（另開新視窗）</span></a>
            <a v-if="campus.line" class="text-link" :href="campus.line" target="_blank" rel="noopener noreferrer">LINE 聯絡{{ campus.name }}<span aria-hidden="true">↗</span><span class="sr-only">（另開新視窗）</span></a>
          </div>
          <!-- 手機隱藏：緊接著的預約橫幅已有同一顆按鈕（styles.css 手機去重）。 -->
          <div class="contact-book">
            <!-- 2026-09-29：和 hero、頁首、預約橫幅同一個金黃色（評析：同一個動作原本有 3 種樣式）。 -->
            <BookingCta :campus-key="campus.key" :label="`預約${campus.name}`" button-class="button yellow" />
          </div>
        </div>
        <nav v-if="otherCampuses.length" class="contact-others" aria-labelledby="contact-others-title">
          <h3 id="contact-others-title">其他校區</h3>
          <ul>
            <li v-for="item in otherCampuses" :key="item.key">
              <NuxtLink class="contact-other-name" :to="`/campuses/${item.key}`">{{ item.name }}</NuxtLink>
              <span class="contact-other-address">{{ item.address?.replace(/^高雄市/, '') || item.district }}</span>
              <a v-if="item.phone" class="contact-other-phone" :href="`tel:${item.phone}`" :aria-label="`致電${item.name} ${item.phone}`">{{ item.phone }}</a>
            </li>
          </ul>
        </nav>
      </div>
    </section>

    <CampusVisitBanner :campus="campus" :booking="booking" />
  </main>
</template>

<style scoped>
.contact-others {align-self:end;min-width:0}
.contact-others h3 {margin-bottom:8px;font-size:var(--fs-lg);color:var(--green)}
.contact-others ul {margin:0;padding:0;list-style:none;border-top:1px solid var(--line)}
.contact-others li {display:grid;grid-template-columns:minmax(5.5em,auto) minmax(0,1fr) auto;align-items:center;gap:0 20px;border-bottom:1px solid var(--line)}
.contact-other-name {display:inline-flex;align-items:center;min-height:52px;color:var(--green);font-weight:600;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:5px}
.contact-other-name:hover {text-decoration-thickness:2px}
.contact-other-address {color:var(--muted);font-size:var(--fs-sm);overflow-wrap:anywhere}
.contact-other-phone {display:inline-flex;align-items:center;min-height:44px;font-variant-numeric:tabular-nums}
@media(max-width:520px) {
  .contact-others li {grid-template-columns:minmax(0,1fr) auto;padding-block:6px}
  .contact-other-name {min-height:44px}
  .contact-other-address {grid-row:2;grid-column:1;padding-bottom:6px}
  .contact-other-phone {grid-row:1 / span 2;grid-column:2}
}
</style>
