<script setup lang="ts">
import { entranceBootstrap, entranceCoverStyles } from '~/utils/entrance-policy'
import { anniversaryEnabled, newsEnabled } from '~/utils/seo'
const { data, error } = await usePublishedSite()
assertPublishedSite(error)
usePageSeo(computed(() => data.value?.content))
// 進站布幕（30 週年投影）跟著後台「全站設定」的 30 週年開關：關閉時連 bootstrap 都不放，
// html 不會標 data-ivy-entrance，entrance-engine plugin 也就不下載引擎。
const curtain = computed(() => anniversaryEnabled(data.value?.content.siteMeta))
useHead({
  htmlAttrs: { 'data-seam': '2', class: 'relay-day' },
  script: () => (curtain.value ? [{ key: 'entrance-curtain', tagPriority: 'critical' as const, innerHTML: entranceBootstrap }] : []),
  style: () => (curtain.value ? [{ key: 'entrance-cover', innerHTML: entranceCoverStyles }] : [])
})
// 後台「全站設定」的最新消息開關（2026-11-11）：關閉時首頁不放最新消息那一章，五校區塊後面直接接頁尾。
const showNews = computed(() => newsEnabled(data.value?.content.siteMeta))
const root = ref<HTMLElement | null>(null)
const footer = ref<HTMLElement | null>(null)
useHomeFooterFade(root, footer)
// 首頁章節錨點。錨點會落在簾幕擦除前的章節設 after（前一道簾幕的 track）。
const chapters = computed(() => {
  const content = data.value?.content
  if (!content) return []
  return [
    { id: content.home.about.anchorId },
    { id: content.dayExperience.sectionId, after: '.belief-reveal-track' },
    // 五校區塊包在最新消息簾幕的 sticky 裡，照錨點捲會量到釘住後的位置、捲過頭（2026-10-12）。
    // 最新消息關閉時沒有那道簾幕，五校區塊不釘住。
    { id: 'campuses', after: '.day-reveal-track', pinned: showNews.value },
    ...(showNews.value ? [{ id: content.news.sectionId }] : [])
  ]
})
// 頁尾「孩子的一天」等連到首頁章節的連結，捲到簾幕擦完的位置。
useChapterAnchors(chapters)
</script>

<template>
  <div v-if="data" ref="root" class="home-page">
    <SiteHeader :content="data.content" hero />
    <main id="main" tabindex="-1">
      <HeroVideo :hero="data.content.home.hero">
        <AboutSection :about="data.content.home.about">
          <DayExperience :day="data.content.dayExperience">
            <HomeNewsTransition v-if="showNews" :news="data.content.news" :campuses="data.content.campuses">
              <CampusBoard :board="data.content.home.campusBoard" :campuses="data.content.campuses" />
            </HomeNewsTransition>
            <CampusBoard v-else :board="data.content.home.campusBoard" :campuses="data.content.campuses" />
          </DayExperience>
        </AboutSection>
      </HeroVideo>
    </main>
    <div ref="footer" class="home-footer"><SiteFooter :content="data.content" /></div>
    <EntranceCurtain v-if="curtain" />
  </div>
</template>

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
