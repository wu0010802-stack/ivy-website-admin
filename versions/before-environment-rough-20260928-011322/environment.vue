<script setup lang="ts">
// 常春藤環境（/environment）。主體在 components/EnvironmentContent.vue；內容寫在元件裡，不進後台。
const { data, error } = await usePublishedSite()
assertPublishedSite(error)

usePageSeo(computed(() => data.value?.content), undefined, 'environment')
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <EnvironmentContent :campuses="data.content.campuses" />
    <SiteFooter :content="data.content" />
  </div>
</template>
