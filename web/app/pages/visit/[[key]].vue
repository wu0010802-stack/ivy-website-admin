<script setup lang="ts">
import { visitSeo } from '~/utils/seo'

// 預約頁：/visit 選校、/visit/<校> 參觀方式與表單（2026-10-29 合成一個頁面元件，原本是 index.vue＋[key].vue）。
// 換步驟只換網址、VisitForm 不重掛：上一頁回到選校、重新整理留在同一步，已選的校與填到一半的資料都還在。
// 網址帶校區直接進第二步的入口（首頁五校卡、404、消息頁、舊 #/visit/<校>）照舊。
definePageMeta({
  key: 'visit',
  // 同一頁內換步驟由 VisitForm 自己聚焦與捲動；從別頁進來照常捲到頁首。
  scrollToTop: (to, from) => to.name !== from.name
})

const route = useRoute()
const campusKey = computed(() => typeof route.params.key === 'string' ? route.params.key : '')

const { data, error } = await usePublishedSite()
assertPublishedSite(error)

const campus = computed(() => campusKey.value ? data.value?.content.campuses.find((c) => c.key === campusKey.value) : undefined)
const NOT_FOUND = { statusCode: 404, message: '找不到這個校區' }
if (campusKey.value && !campus.value) throw createError(NOT_FOUND)
// 頁面元件不重掛，setup 只跑一次：在頁內換到不存在的校區（手動改網址）也要回 404。
watch(campusKey, (key) => { if (key && !campus.value) showError(NOT_FOUND) })

const config = useRuntimeConfig()
const seo = computed(() => data.value ? visitSeo(data.value.content, config.public.siteOrigin, campus.value) : undefined)
useSeoMeta({
  title: () => seo.value?.title,
  description: () => seo.value?.description,
  ogTitle: () => seo.value?.title,
  ogDescription: () => seo.value?.description,
  ogUrl: () => seo.value?.canonical,
  ogImage: () => seo.value?.image,
  ogImageAlt: () => seo.value?.imageAlt,
  ogType: 'website', ogLocale: 'zh_TW',
  twitterCard: 'summary_large_image',
  twitterTitle: () => seo.value?.title,
  twitterDescription: () => seo.value?.description,
  twitterImage: () => seo.value?.image,
  // 預約頁不收錄（10-12 裁定，伺服器另送 X-Robots-Tag）。
  robots: 'noindex, nofollow'
})
useHead(() => ({ link: seo.value?.canonical ? [{ rel: 'canonical', href: seo.value.canonical }] : [] }))
</script>

<template>
  <div v-if="data">
    <SiteHeader :content="data.content" />
    <main id="main" tabindex="-1">
      <div class="container breadcrumb"><NuxtLink to="/">首頁</NuxtLink> / 預約校園參觀</div>
      <VisitForm :booking="data.content.booking" :campuses="data.content.campuses" :route-campus="campus?.key ?? ''" :policy-path="data.content.privacyPolicy ? '/privacy' : null" />
    </main>
    <SiteFooter :content="data.content" />
  </div>
</template>
