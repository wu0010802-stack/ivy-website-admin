<script setup lang="ts">
// 隱私權政策（/privacy）。主體在 components/PrivacyPolicyContent.vue，草稿預覽共用同一份。
// 園方還沒發布（官網內容沒有 privacyPolicy）時回 404。
// 404 的 fatal 只在瀏覽器端帶（2026-11-12）：不帶的話站內換頁、上一頁回到這裡時不會顯示 error.vue、整頁空白；
// 伺服器端本來就顯示錯誤頁，帶了反而讓每個 404 都被 Nitro 印成 [request error] [fatal] 的整段堆疊。
const { data, error } = await usePublishedSite()
assertPublishedSite(error)

const policy = computed(() => data.value?.content.privacyPolicy ?? null)
if (!policy.value) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found', message: '找不到這個頁面', fatal: import.meta.client })
}

usePageSeo(computed(() => data.value?.content), 'privacy')
</script>

<template>
  <div v-if="data && policy">
    <SiteHeader :content="data.content" />
    <PrivacyPolicyContent :policy="policy" />
    <SiteFooter :content="data.content" />
  </div>
</template>
