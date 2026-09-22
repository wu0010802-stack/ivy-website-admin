<script setup lang="ts">
const { data, error } = await usePublishedSite()
assertPublishedSite(error)
usePageSeo(computed(() => data.value?.content))
useHead({ htmlAttrs: { 'data-seam': '2', class: 'relay-day' } })
const root = ref<HTMLElement | null>(null)
const footer = ref<HTMLElement | null>(null)
useHomeFooterFade(root, footer)
</script>

<template>
  <div v-if="data" ref="root" class="home-page">
    <SiteHeader :content="data.content" />
    <main id="main" tabindex="-1">
      <HeroVideo :hero="data.content.home.hero">
        <AboutSection :about="data.content.home.about">
          <DayExperience :day="data.content.dayExperience">
            <HomeNewsTransition :news="data.content.news">
              <CampusBoard :board="data.content.home.campusBoard" :campuses="data.content.campuses" />
            </HomeNewsTransition>
          </DayExperience>
        </AboutSection>
      </HeroVideo>
    </main>
    <div ref="footer" class="home-footer"><SiteFooter :content="data.content" /></div>
  </div>
</template>

<style>
/* 頁尾進場進度：只有 JS 備援（data-footer-motion="fallback"）會寫這個變數；
   原生 view timeline 時不再對整頁的 inherited 自訂屬性做動畫（每幀整頁 style recalc），
   而是由 HomeNewsTransition.vue 直接對消息紙的陰影與底色做 --home-footer 時間軸動畫，
   這裡只宣告 timeline-scope 與時間軸。變數用全域名稱，scoped 會加 hash。 */
@property --home-footer-progress { syntax: '<number>'; inherits: true; initial-value: 0; }
</style>

<style scoped>
.home-page { --home-footer-progress: 0; }
@supports (animation-timeline: view()) and (animation-range: entry 0% entry 100%) and (timeline-scope: --home-footer) {
  .home-page[data-footer-motion="native"] { timeline-scope: --home-footer; }
  .home-page[data-footer-motion="native"] .home-footer {
    view-timeline: --home-footer block;
    view-timeline-inset: 0px calc(100% - var(--home-footer-screen, 100svh));
  }
}
.home-page[data-footer-motion="off"] { --home-footer-progress: 1; }
@media (prefers-reduced-motion: reduce), (forced-colors: active) {
  .home-page { animation: none !important; --home-footer-progress: 1 !important; }
}
</style>
