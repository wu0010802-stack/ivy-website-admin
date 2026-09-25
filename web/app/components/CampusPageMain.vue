<script setup lang="ts">
// 分校頁主體。正式頁（pages/campuses/[key].vue）與私有草稿預覽
// （pages/preview.vue?page=campus）共用，兩邊畫面才不會漂移。
import type { Campus } from '~/types/site-content'
import { campusHeroAttrs } from '~/utils/media-image'
import { campusMapUrl } from '~/utils/site-links'

defineProps<{ campus: Campus }>()
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
            查看地圖與路線
          </a>
        </div>
      </div>
    </section>

    <CampusTour :campus="campus" />

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
          <div>
            <BookingCta :campus-key="campus.key" :label="`預約${campus.name}`" button-class="button primary" />
          </div>
        </div>
      </div>
    </section>

    <section class="visit-banner" data-cta-entry="campus_banner">
      <div class="container">
        <div>
          <span class="eyebrow">預約參觀</span>
          <h2 class="section-title">親自走一趟，感受{{ campus.name }}的日常。</h2>
          <p>帶著孩子，也帶著你想了解的事。我們期待與你相遇。</p>
        </div>
        <BookingCta :campus-key="campus.key" label="預約校園參觀" button-class="button yellow" />
      </div>
    </section>
  </main>
</template>
