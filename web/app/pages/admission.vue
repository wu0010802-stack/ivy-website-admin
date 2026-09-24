<script setup lang="ts">
// 入學資訊（/admission）。主體在 components/AdmissionContent.vue，草稿預覽共用同一份。
const { data, error } = await usePublishedSite()
assertPublishedSite(error)

usePageSeo(computed(() => data.value?.content), undefined, 'admission')
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <AdmissionContent :admission="data.content.admission" />
    <SiteFooter :content="data.content" />
  </div>
</template>
