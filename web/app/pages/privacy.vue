<script setup lang="ts">
// 隱私權政策（/privacy）。主體在 components/PrivacyPolicyContent.vue，草稿預覽共用同一份。
// 園方還沒發布（官網內容沒有 privacyPolicy）時回 404。
const { data, error } = await usePublishedSite()
assertPublishedSite(error)

const policy = computed(() => data.value?.content.privacyPolicy ?? null)
if (!policy.value) {
  throw createError({ statusCode: 404, message: '找不到這個頁面' })
}

usePageSeo(computed(() => data.value?.content), undefined, 'privacy')
</script>

<template>
  <div v-if="data && policy">
    <SiteHeader :content="data.content" />
    <PrivacyPolicyContent :policy="policy" />
    <SiteFooter :content="data.content" />
  </div>
</template>
