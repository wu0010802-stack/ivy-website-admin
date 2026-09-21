<script setup lang="ts">
const { data, error } = await usePublishedSite()
assertPublishedSite(error)
usePageSeo(computed(() => data.value?.content))
useHead({ htmlAttrs: { 'data-seam': '2', class: 'relay-day' } })
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <main id="main" tabindex="-1">
      <HeroVideo :hero="data.content.home.hero">
        <AboutSection :about="data.content.home.about">
          <DayExperience :day="data.content.dayExperience">
            <CampusBoard :board="data.content.home.campusBoard" :campuses="data.content.campuses" />
          </DayExperience>
        </AboutSection>
      </HeroVideo>
      <NewsDialog :news="data.content.news" />
    </main>
    <SiteFooter :content="data.content" />
  </div>
</template>
