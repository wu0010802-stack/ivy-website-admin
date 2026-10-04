<script setup lang="ts">
// 特色教學（/curriculum）。主體在 components/CurriculumContent.vue；文字與照片來自後台「特色教學頁」（沒發布過就用 fixture 的內建內容）。
const { data, error } = await usePublishedSite()
assertPublishedSite(error)

usePageSeo(computed(() => data.value?.content), 'curriculum')
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <CurriculumContent :page="data.content.curriculumPage" />
    <SiteFooter :content="data.content" />
  </div>
</template>
