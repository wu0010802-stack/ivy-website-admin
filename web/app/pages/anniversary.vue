<script setup lang="ts">
// 常春藤 30 週年（/anniversary）。主體在 components/AnniversaryContent.vue，內容寫在元件裡、不進後台。
// 週年版尚未拍板：不進主選單與 sitemap，也先不給搜尋引擎收錄。
const { data, error } = await usePublishedSite()
assertPublishedSite(error)

const brand = computed(() => data.value?.content.siteMeta.brandName ?? '常春藤教育機構')
useSeoMeta({
  title: () => `常春藤 30 週年｜1997—2027｜${brand.value}`,
  description: '1997 年，第一間常春藤在高雄三民區義華路成立，到 2027 年滿 30 年。看義華、明華、崇德、國際、仁武五所校園一年一年長出來，也換你用蠟筆畫一個 30。',
  robots: 'noindex, nofollow'
})
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <AnniversaryContent :campuses="data.content.campuses" />
    <SiteFooter :content="data.content" />
  </div>
</template>
