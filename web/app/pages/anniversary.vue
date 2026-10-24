<script setup lang="ts">
// 常春藤 30 週年（/anniversary）。主體在 components/AnniversaryContent.vue，內容寫在元件裡、不進後台。
// 2026-10-04 起是正式分頁：主選單、頁尾、sitemap、llms.txt 都有；收錄照全站設定（usePageSeo）。
// 2026-10-24 起後台「全站設定」可關掉 30 週年，關閉時這頁回 404。
import { anniversaryEnabled } from '~/utils/seo'

const { data, error } = await usePublishedSite()
assertPublishedSite(error)
if (!anniversaryEnabled(data.value?.content.siteMeta)) {
  throw createError({ statusCode: 404, message: '找不到這個頁面' })
}

usePageSeo(computed(() => data.value?.content), 'anniversary')
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <AnniversaryContent :campuses="data.content.campuses" />
    <SiteFooter :content="data.content" />
  </div>
</template>
