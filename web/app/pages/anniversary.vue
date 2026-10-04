<script setup lang="ts">
// 常春藤 30 週年（/anniversary）。主體在 components/AnniversaryContent.vue，內容寫在元件裡、不進後台。
// 2026-10-04 起是正式分頁：主選單、頁尾、sitemap、llms.txt 都有；收錄照全站設定（usePageSeo）。
const { data, error } = await usePublishedSite()
assertPublishedSite(error)

usePageSeo(computed(() => data.value?.content), 'anniversary')
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <AnniversaryContent :campuses="data.content.campuses" />
    <SiteFooter :content="data.content" />
  </div>
</template>
