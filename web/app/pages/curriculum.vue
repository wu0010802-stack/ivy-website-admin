<script setup lang="ts">
// 特色教學（/curriculum）。主體在 components/CurriculumContent.vue；內容寫在元件裡，不進後台。
const { data, error } = await usePublishedSite()
assertPublishedSite(error)

usePageSeo(computed(() => data.value?.content), undefined, 'curriculum')
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <CurriculumContent />
    <SiteFooter :content="data.content" />
  </div>
</template>
