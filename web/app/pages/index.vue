<script setup lang="ts">
import { entranceBootstrap, entranceCoverStyles } from '~/utils/entrance-policy'
const { data, error } = await usePublishedSite()
assertPublishedSite(error)
usePageSeo(computed(() => data.value?.content))
useHead({
  htmlAttrs: { 'data-seam': '2', class: 'relay-day' },
  script: [{ key: 'entrance-curtain', tagPriority: 'critical', innerHTML: entranceBootstrap }],
  style: [{ key: 'entrance-cover', innerHTML: entranceCoverStyles }]
})
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
    <EntranceCurtain />
  </div>
</template>

<style>
@property --home-footer-progress { syntax: '<number>'; inherits: true; initial-value: 0; }
@keyframes home-footer-entry { from { --home-footer-progress: 0; } to { --home-footer-progress: 1; } }
</style>

<style scoped>
.home-page { --home-footer-progress: 0; }
@supports (animation-timeline: view()) and (animation-range: entry 0% entry 100%) and (timeline-scope: --home-footer) {
  .home-page[data-footer-motion="native"] {
    timeline-scope: --home-footer;
    animation: home-footer-entry 1s linear both;
    animation-timeline: --home-footer;
    animation-range: entry 0% entry 100%;
  }
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
