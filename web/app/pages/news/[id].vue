<script setup lang="ts">
// 單篇消息（/news/<id>）。找不到回 404；示意消息照常顯示但 noindex（usePageSeo）。
import { findArticle } from '~/utils/news-content'

definePageMeta({ key: route => route.path })
const route = useRoute()
const { data, error } = await usePublishedSite()
assertPublishedSite(error)

const article = computed(() => data.value ? findArticle(data.value.content.news.articles, String(route.params.id)) : undefined)
if (!article.value) {
  throw createError({ statusCode: 404, message: '找不到這則消息' })
}

usePageSeo(computed(() => data.value?.content), undefined, 'news', article)
</script>

<template>
  <div v-if="data && article">
    <SiteHeader :content="data.content" />
    <NewsArticleContent :article="article" :news="data.content.news" :campuses="data.content.campuses" />
    <SiteFooter :content="data.content" />
  </div>
</template>
