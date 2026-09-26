<script setup lang="ts">
// 關於常春藤（/about）。主體在 components/AboutContent.vue；內容寫在元件裡，不進後台。
const { data, error } = await usePublishedSite()
assertPublishedSite(error)

usePageSeo(computed(() => data.value?.content), undefined, 'about')
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <AboutContent :campuses="data.content.campuses" />
    <SiteFooter :content="data.content" />
  </div>
</template>
