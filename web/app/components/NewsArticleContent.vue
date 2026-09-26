<script setup lang="ts">
// 單篇消息頁主體（/news/<id>，2026-09-26）。內文沿用 NewsBody；示意消息在標題下註明。
// 結尾依消息的校區帶預約入口：只屬於一校就帶那一校，全校消息走一般預約。
import type { Campus, NewsArticle, NewsContent } from '~/types/site-content'
import { isSampleNews, NEWS_PATH } from '~/utils/news-content'
import { responsiveTourImage } from '~/utils/tour-image'

const props = defineProps<{ article: NewsArticle; news: NewsContent; campuses: Campus[] }>()
const sample = computed(() => isSampleNews(props.article, props.news.sampleNote))
const campus = computed(() => props.article.campusKeys?.length === 1 ? props.campuses.find((c) => c.key === props.article.campusKeys![0]) : undefined)
const listLink = computed(() => campus.value ? { path: NEWS_PATH, query: { campus: campus.value.key } } : NEWS_PATH)
const formatDate = (date: string) => date.replaceAll('-', '.')
</script>

<template>
  <main id="main" tabindex="-1" class="np np-article-page" data-cta-entry="news">
    <div class="np-wrap np-narrow">
      <nav class="np-crumb" aria-label="麵包屑"><NuxtLink to="/">首頁</NuxtLink><span aria-hidden="true">/</span><NuxtLink :to="NEWS_PATH">最新消息</NuxtLink></nav>
      <article class="np-article" aria-labelledby="np-article-title">
        <p class="np-meta"><span>{{ article.campus }} · {{ article.category }}<span v-if="sample" class="hn-sample-tag">示意</span></span><time :datetime="article.date">{{ formatDate(article.date) }}</time></p>
        <h1 id="np-article-title">{{ article.title }}</h1>
        <p v-if="sample" class="np-sample-note">此為閱讀互動示範，標題、日期與內容皆為範例；圖片使用既有校園素材。</p>
        <img class="np-cover" v-bind="responsiveTourImage(article.image, '(max-width: 760px) 100vw, 760px', false, article.imageMedia)" :style="article.imageMedia?.position ? { objectPosition: article.imageMedia.position } : undefined" :alt="article.alt" fetchpriority="high">
        <NewsBody v-if="article.body?.length" :summary="article.description" :blocks="article.body" />
        <p v-else class="np-article-copy">{{ article.description }}</p>
      </article>
      <div class="np-article-foot">
        <NuxtLink class="np-back" :to="listLink"><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-left" /></svg>{{ campus ? `回${campus.name}的消息` : '回消息列表' }}</NuxtLink>
        <NuxtLink class="np-book" :to="campus ? `/visit/${campus.key}` : '/visit'">預約{{ campus ? campus.name : '校園' }}參觀<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
      </div>
    </div>
  </main>
</template>

<style scoped src="../assets/css/news-page.css"></style>
