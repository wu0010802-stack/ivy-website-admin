<script setup lang="ts">
const { data } = await usePublishedSite()

useHead(() => ({
  title: data.value?.content.siteMeta.title,
  meta: [{ name: 'description', content: data.value?.content.siteMeta.description }]
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
