<script setup lang="ts">
// 常春藤環境（/environment）。主體在 components/EnvironmentContent.vue；前三章的文字與照片來自後台「常春藤環境頁」（environment_page），
// 第四章讀各校校園探索。
const { data, error } = await usePublishedSite()
assertPublishedSite(error)

usePageSeo(computed(() => data.value?.content), 'environment')
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <EnvironmentContent :campuses="data.content.campuses" :page="data.content.environmentPage" />
    <SiteFooter :content="data.content" />
  </div>
</template>
