<script setup lang="ts">
// 入學資訊（/admission）。主體在 components/AdmissionContent.vue，草稿預覽共用同一份。
// 2026-11-11 起後台「網站標題與電話」可先隱藏這個分頁，隱藏時這頁回 404（草稿預覽照常看得到）。
import { admissionEnabled } from '~/utils/seo'

const { data, error } = await usePublishedSite()
assertPublishedSite(error)
if (!admissionEnabled(data.value?.content.siteMeta)) {
  throw pageNotFound('找不到這個頁面')
}

usePageSeo(computed(() => data.value?.content), 'admission')
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <AdmissionContent :admission="data.content.admission" :campuses="data.content.campuses" />
    <SiteFooter :content="data.content" />
  </div>
</template>
