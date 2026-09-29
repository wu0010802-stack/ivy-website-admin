<script setup lang="ts">
// 最新消息列表頁主體（/news，2026-09-26）。上面是近期活動（今天以後，近到遠），
// 下面是消息（新到舊），可依校區篩選：`?campus=<key>`，全校消息在每一校都看得到。
// 示意內容照首頁的標法（整區標一次或逐則標），單篇頁另外 noindex。
import type { Campus, NewsContent, NewsEvent } from '~/types/site-content'
import { articlesForCampus, eventTimeDetail, isSampleNews, newsPath, safeWebUrl, sampleCoverage, taipeiToday, upcomingEvents } from '~/utils/news-content'
import { responsiveTourImage } from '~/utils/tour-image'

const props = defineProps<{ news: NewsContent; campuses: Campus[] }>()
const route = useRoute()

const campusKey = computed(() => {
  const value = typeof route.query.campus === 'string' ? route.query.campus : ''
  return props.campuses.some((c) => c.key === value) ? value : undefined
})
const campusName = computed(() => props.campuses.find((c) => c.key === campusKey.value)?.name)
const articles = computed(() => articlesForCampus(props.news.articles, campusKey.value))
const today = taipeiToday()
const events = computed(() => upcomingEvents(props.news.events, today)
  .filter((e) => !campusKey.value || !e.campusKeys?.length || e.campusKeys.includes(campusKey.value)))
const isSample = (item: { sample?: boolean }) => isSampleNews(item, props.news.sampleNote)
const articlesSample = computed(() => sampleCoverage(articles.value, props.news.sampleNote))
const eventsSample = computed(() => sampleCoverage(events.value, props.news.sampleNote))
const anySample = computed(() => Boolean(props.news.sampleNote) && [...articles.value, ...events.value].some(isSample))

const formatDate = (date: string) => date.replaceAll('-', '.')
const eventFacts = (item: NewsEvent) => [eventTimeDetail(item), item.location ?? ''].filter(Boolean).join(' · ')
</script>

<template>
  <main id="main" tabindex="-1" class="np" data-cta-entry="news">
    <div class="np-wrap">
      <nav class="np-crumb" aria-label="麵包屑"><NuxtLink to="/">首頁</NuxtLink><span aria-hidden="true">/</span><span aria-current="page">最新消息</span></nav>
      <header class="np-head">
        <p class="np-kicker" lang="en">Latest news</p>
        <h1>最新消息</h1>
        <p class="np-lede">五所校園的消息與近期活動。</p>
      </header>

      <nav class="np-filter" aria-label="依校區篩選">
        <NuxtLink :to="{ query: {} }" :aria-current="!campusKey ? 'page' : undefined">全部</NuxtLink>
        <NuxtLink v-for="c in campuses" :key="c.key" :to="{ query: { campus: c.key } }" :aria-current="campusKey === c.key ? 'page' : undefined">{{ c.name }}</NuxtLink>
      </nav>

      <section v-if="events.length" class="np-events" aria-labelledby="np-events-title">
        <h2 id="np-events-title">近期活動<span v-if="eventsSample === 'all'" class="hn-sample-tag">示意內容</span></h2>
        <ul class="np-event-list">
          <li v-for="item in events" :key="item.id" class="np-event">
            <time class="np-event-date" :datetime="item.date"><b>{{ item.date.slice(-2) }}</b><span lang="en">{{ item.month }}</span></time>
            <div class="np-event-copy">
              <p class="np-meta"><span>{{ item.campus }}<span v-if="eventsSample === 'some' && isSample(item)" class="hn-sample-tag">示意</span></span><span>{{ formatDate(item.date) }}<template v-if="eventFacts(item)"> · {{ eventFacts(item) }}</template></span></p>
              <h3>{{ item.title }}</h3>
              <p>{{ item.description }}</p>
              <a v-if="safeWebUrl(item.linkUrl)" class="np-event-link" :href="safeWebUrl(item.linkUrl)" target="_blank" rel="noopener noreferrer">{{ item.linkLabel || '活動詳情' }}<span aria-hidden="true"> ↗</span><span class="sr-only">（另開分頁）</span></a>
            </div>
          </li>
        </ul>
      </section>

      <section class="np-articles" aria-labelledby="np-articles-title">
        <h2 id="np-articles-title">{{ campusName ? `${campusName}的消息` : '所有消息' }}<span v-if="articlesSample === 'all'" class="hn-sample-tag">示意內容</span></h2>
        <p v-if="!articles.length" class="np-empty">目前沒有新的消息。</p>
        <ul v-else class="np-list">
          <li v-for="item in articles" :key="item.id" class="np-row">
            <img v-bind="responsiveTourImage(item.image, '(max-width: 760px) 30vw, 280px', false, item.imageMedia)" :style="item.imageMedia?.position ? { objectPosition: item.imageMedia.position } : undefined" :alt="item.alt" loading="lazy">
            <div class="np-row-copy">
              <p class="np-meta"><span>{{ item.campus }}<span v-if="articlesSample === 'some' && isSample(item)" class="hn-sample-tag">示意</span></span><time :datetime="item.date">{{ formatDate(item.date) }}</time></p>
              <h3><NuxtLink :to="newsPath(item.id)">{{ item.title }}</NuxtLink></h3>
              <p class="np-row-desc">{{ item.description }}</p>
              <p class="np-category">{{ item.category }}</p>
            </div>
          </li>
        </ul>
      </section>

      <p v-if="anySample" class="np-sample-note">{{ news.sampleNote }}</p>
    </div>
  </main>
</template>

<style scoped src="../assets/css/news-page.css"></style>
