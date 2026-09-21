<script setup lang="ts">
const { data } = await usePublishedSite()

useHead(() => ({
  title: '預約校園參觀｜常春藤幼兒園',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }]
}))
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <main id="main" tabindex="-1">
      <div class="container breadcrumb"><NuxtLink to="/">首頁</NuxtLink> / 預約校園參觀</div>
      <VisitForm :booking="data.content.booking" :campuses="data.content.campuses" />
    </main>
    <SiteFooter :content="data.content" />
  </div>
</template>
