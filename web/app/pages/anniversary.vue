<script setup lang="ts">
// 常春藤 30 週年（/anniversary）。主體在 components/AnniversaryContent.vue，內容寫在元件裡、不進後台。
// 2026-10-04 起是正式分頁：主選單、頁尾、sitemap、llms.txt 都有；收錄照全站設定（usePageSeo）。
// 2026-10-24 起後台「全站設定」可關掉 30 週年，關閉時這頁回 404。
// 404 的 fatal 只在瀏覽器端帶（2026-11-12）：不帶的話站內換頁、上一頁回到這裡時不會顯示 error.vue、整頁空白；
// 伺服器端本來就顯示錯誤頁，帶了反而讓每個 404 都被 Nitro 印成 [request error] [fatal] 的整段堆疊。
import { anniversaryEnabled } from '~/utils/seo'

const { data, error } = await usePublishedSite()
assertPublishedSite(error)
if (!anniversaryEnabled(data.value?.content.siteMeta)) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found', message: '找不到這個頁面', fatal: import.meta.client })
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
