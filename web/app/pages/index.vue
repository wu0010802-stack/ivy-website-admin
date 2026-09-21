<script setup lang="ts">
const { data } = await usePublishedSite()
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
  link: indexable ? [{ rel: 'canonical', href: origin }] : []
}))
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <main id="main" tabindex="-1">
      <HeroVideo :hero="data.content.home.hero" />
      <AboutSection :about="data.content.home.about" />
      <DayExperience :day="data.content.dayExperience" />
      <CampusBoard :board="data.content.home.campusBoard" :campuses="data.content.campuses" />
      <NewsDialog :news="data.content.news" />
    </main>
    <SiteFooter :content="data.content" />
  </div>
</template>
