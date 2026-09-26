<script setup lang="ts">
// 最新消息列表（/news，2026-09-26 開放獨立網址）。主體在 components/NewsIndexContent.vue；
// 資料是後台的全站消息與各校消息（沒發布過時沿用內建示意消息）。
const { data, error } = await usePublishedSite()
assertPublishedSite(error)

usePageSeo(computed(() => data.value?.content), undefined, 'news')
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <NewsIndexContent :news="data.content.news" :campuses="data.content.campuses" />
    <SiteFooter :content="data.content" />
  </div>
</template>
