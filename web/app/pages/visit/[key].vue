<script setup lang="ts">
const route = useRoute()
const key = route.params.key as string

const { data } = await usePublishedSite()

const campus = computed(() => data.value?.content.campuses.find((c) => c.key === key))

if (!campus.value) {
  throw createError({ statusCode: 404, message: '找不到這個校區' })
}

useHead(() => ({ title: '預約校園參觀｜常春藤幼兒園' }))
</script>

<template>
  <div v-if="data && campus">
    <SiteHeader :content="data.content" />
    <main id="main" tabindex="-1">
      <div class="container breadcrumb"><NuxtLink to="/">首頁</NuxtLink> / 預約校園參觀</div>
      <VisitForm :booking="data.content.booking" :campuses="data.content.campuses" :initial-campus="campus.key" />
    </main>
    <SiteFooter :content="data.content" />
  </div>
</template>
