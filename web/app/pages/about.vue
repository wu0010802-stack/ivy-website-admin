<script setup lang="ts">
// 關於常春藤（/about）。主體在 components/AboutContent.vue；文字與照片來自後台「關於常春藤頁」（沒發布過就用 fixture 的內建內容）。
const { data, error } = await usePublishedSite()
assertPublishedSite(error)

usePageSeo(computed(() => data.value?.content), 'about')
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <AboutContent :campuses="data.content.campuses" :page="data.content.aboutPage" />
    <SiteFooter :content="data.content" />
  </div>
</template>
