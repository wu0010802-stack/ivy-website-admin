<script setup lang="ts">
// 入學資訊（/admission）。主體在 components/AdmissionContent.vue，草稿預覽共用同一份。
// 2026-11-11 起後台「網站標題與電話」可先隱藏這個分頁，隱藏時這頁回 404（草稿預覽照常看得到）。
// 404 的 fatal 只在瀏覽器端帶（2026-11-12）：不帶的話站內換頁、上一頁回到這裡時不會顯示 error.vue、整頁空白；
// 伺服器端本來就顯示錯誤頁，帶了反而讓每個 404 都被 Nitro 印成 [request error] [fatal] 的整段堆疊。
import { admissionEnabled } from '~/utils/seo'

const { data, error } = await usePublishedSite()
assertPublishedSite(error)
if (!admissionEnabled(data.value?.content.siteMeta)) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found', message: '找不到這個頁面', fatal: import.meta.client })
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
