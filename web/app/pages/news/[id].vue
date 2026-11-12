<script setup lang="ts">
// 單篇消息（/news/<id>）。找不到回 404；示意消息照常顯示但 noindex（usePageSeo）。
// 2026-11-11 起後台「全站設定」可關掉最新消息，關閉時不論有沒有這一則都導回首頁。
import { findArticle } from '~/utils/news-content'
import { newsEnabled } from '~/utils/seo'

definePageMeta({ key: route => route.path })
const route = useRoute()
const { data, error } = await usePublishedSite()
assertPublishedSite(error)
const hidden = !newsEnabled(data.value?.content.siteMeta)

const article = computed(() => data.value && !hidden ? findArticle(data.value.content.news.articles, String(route.params.id)) : undefined)
if (hidden) {
  await navigateTo('/', { redirectCode: 302, replace: true })
} else if (!article.value) {
  throw pageNotFound('找不到這則消息')
}

usePageSeo(computed(() => data.value?.content), 'news', article)
</script>

<template>
  <div v-if="data && article">
    <SiteHeader :content="data.content" />
    <NewsArticleContent :article="article" :news="data.content.news" :campuses="data.content.campuses" />
    <SiteFooter :content="data.content" />
  </div>
</template>
