<script setup lang="ts">
const { data, error } = await usePublishedSite()
assertPublishedSite(error)
const config = useRuntimeConfig()
const origin = config.public.siteOrigin.replace(/\/$/, '')
const indexable = config.public.indexingEnabled && Boolean(config.public.siteOrigin)

useSeoMeta({
  title: () => data.value?.content.siteMeta.title,
  description: () => data.value?.content.siteMeta.description,
  ogTitle: () => data.value?.content.siteMeta.title,
  ogDescription: () => data.value?.content.siteMeta.description,
  ogUrl: () => (origin ? origin : undefined),
  ogType: 'website',
  robots: indexable ? 'index, follow' : 'noindex, nofollow'
})

useHead(() => ({
  link: indexable ? [{ rel: 'canonical', href: origin }] : [],
  // ?seam=2 接力效果（2026-09-18 定案為預設）；比稿用的 ?seam=0/1 與
  // ?study=1 開關面板都是預覽參數，不搬進正式站，這裡固定用定案版本。
  htmlAttrs: { 'data-seam': '2', class: 'relay-day' }
}))
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <main id="main" tabindex="-1">
      <HeroVideo :hero="data.content.home.hero">
        <ScrollCurtain prefix="belief" relay>
          <AboutSection :about="data.content.home.about" />
          <template #after>
            <ScrollCurtain prefix="day">
              <DayExperience :day="data.content.dayExperience" />
              <template #after>
                <CampusBoard :board="data.content.home.campusBoard" :campuses="data.content.campuses" />
              </template>
            </ScrollCurtain>
          </template>
        </ScrollCurtain>
      </HeroVideo>
      <NewsDialog :news="data.content.news" />
    </main>
    <SiteFooter :content="data.content" />
  </div>
</template>
