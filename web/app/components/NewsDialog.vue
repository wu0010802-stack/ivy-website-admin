<script setup lang="ts">
import type { NewsArticle, NewsContent, NewsEvent } from '~/types/site-content'

const props = defineProps<{ news: NewsContent }>()

const dialogEl = ref<HTMLDialogElement | null>(null)
const dialogSupported = ref(false)
const view = ref<{ kind: 'articles' | 'events'; item: NewsArticle | NewsEvent } | { kind: 'list'; list: 'articles' | 'events' } | null>(null)

onMounted(() => {
  dialogSupported.value = typeof HTMLDialogElement !== 'undefined'
})

function openList(list: 'articles' | 'events') {
  view.value = { kind: 'list', list }
  dialogEl.value?.showModal()
}

function openArticle(item: NewsArticle) {
  view.value = { kind: 'articles', item }
  dialogEl.value?.showModal()
}

function openEvent(item: NewsEvent) {
  view.value = { kind: 'events', item }
  dialogEl.value?.showModal()
}

function close() {
  dialogEl.value?.close()
}

function formatDate(date: string) {
  return date.replaceAll('-', '.')
}
</script>

<template>
  <section :id="news.sectionId" class="home-news" aria-labelledby="latest-news-heading">
    <div class="container">
      <div class="hn-layout">
        <aside class="hn-events" aria-labelledby="upcoming-events-heading">
          <div class="hn-head">
            <span class="hn-kicker" lang="en">UPCOMING EVENTS</span>
            <h2 id="upcoming-events-heading">近期活動</h2>
          </div>
          <div class="hn-event-stack">
            <button
              v-for="item in news.events"
              :key="item.id"
              type="button"
              class="hn-event"
              aria-haspopup="dialog"
              @click="openEvent(item)"
            >
              <time class="hn-date" :datetime="item.date" :aria-label="item.date">
                <b>{{ item.date.slice(-2) }}</b><span lang="en">{{ item.month }}</span>
              </time>
              <span class="hn-event-copy">
                <small>{{ item.campus }}</small>
                <strong>{{ item.title }}</strong>
              </span>
              <span class="hn-arrow" aria-hidden="true">↗</span>
            </button>
          </div>
          <button type="button" class="hn-more" aria-haspopup="dialog" @click="openList('events')">
            所有活動<span class="hn-arrow" aria-hidden="true">↗</span>
          </button>
        </aside>
        <div class="hn-news">
          <div class="hn-head hn-news-head">
            <div>
              <span class="hn-kicker" lang="en">LATEST NEWS</span>
              <h2 id="latest-news-heading">最新消息</h2>
            </div>
            <button type="button" class="hn-more" aria-haspopup="dialog" @click="openList('articles')">
              所有最新消息<span class="hn-arrow" aria-hidden="true">↗</span>
            </button>
          </div>
          <div class="hn-cards">
            <article v-for="item in news.articles.slice(0, 3)" :key="item.id" class="hn-card">
              <img :src="`/assets/${item.image}.webp`" width="720" height="465" :alt="item.alt" loading="lazy">
              <div class="hn-card-copy">
                <span class="hn-meta"><span>{{ item.campus }}</span><time :datetime="item.date">{{ formatDate(item.date) }}</time></span>
                <h3><button type="button" aria-haspopup="dialog" @click="openArticle(item)">{{ item.title }}</button></h3>
              </div>
            </article>
          </div>
        </div>
      </div>
      <p class="hn-sample-note">{{ news.sampleNote }}</p>
    </div>
  </section>

  <ClientOnly>
    <dialog v-if="dialogSupported" ref="dialogEl" id="home-news-dialog" class="hn-dialog" aria-labelledby="home-news-dialog-title">
      <div class="hn-dialog-top">
        <span>常春藤 · 校園消息</span>
        <button type="button" aria-label="關閉消息" @click="close">關閉 ×</button>
      </div>
      <div class="hn-dialog-body">
        <template v-if="view?.kind === 'list'">
          <h2 id="home-news-dialog-title" tabindex="-1">{{ view.list === 'events' ? '近期活動' : '所有最新消息' }}</h2>
          <p class="hn-dialog-note">以下為設計示意內容。</p>
          <div v-if="view.list === 'events'" class="hn-event-stack">
            <button v-for="item in news.events" :key="item.id" type="button" class="hn-event" @click="openEvent(item)">
              <time class="hn-date" :datetime="item.date"><b>{{ item.date.slice(-2) }}</b><span lang="en">{{ item.month }}</span></time>
              <span class="hn-event-copy"><small>{{ item.campus }}</small><strong>{{ item.title }}</strong></span>
              <span class="hn-arrow" aria-hidden="true">↗</span>
            </button>
          </div>
          <div v-else class="hn-list">
            <button v-for="item in news.articles" :key="item.id" type="button" class="hn-list-row" @click="openArticle(item)">
              <img :src="`/assets/${item.image}.webp`" width="720" height="465" :alt="item.alt" loading="lazy">
              <span class="hn-list-copy">
                <span class="hn-meta"><span>{{ item.campus }}</span><time :datetime="item.date">{{ formatDate(item.date) }}</time></span>
                <strong>{{ item.title }}</strong>
                <span class="hn-category">{{ item.category }}</span>
              </span>
              <span class="hn-arrow" aria-hidden="true">↗</span>
            </button>
          </div>
        </template>
        <template v-else-if="view?.kind === 'articles'">
          <span class="hn-kicker">{{ view.item.campus }} · {{ (view.item as NewsArticle).category }}</span>
          <h2 id="home-news-dialog-title" tabindex="-1">{{ view.item.title }}</h2>
          <span class="hn-meta"><span>{{ view.item.campus }}</span><time :datetime="view.item.date">{{ formatDate(view.item.date) }}</time></span>
          <img :src="`/assets/${(view.item as NewsArticle).image}.webp`" width="720" height="465" :alt="(view.item as NewsArticle).alt" loading="lazy">
          <p class="hn-detail-copy">{{ view.item.description }}</p>
          <p class="hn-dialog-note">此為閱讀互動示範，標題、日期與內容皆為範例；圖片使用既有校園素材。</p>
        </template>
        <template v-else-if="view?.kind === 'events'">
          <span class="hn-kicker">{{ view.item.campus }} · 活動示意</span>
          <h2 id="home-news-dialog-title" tabindex="-1">{{ view.item.title }}</h2>
          <time class="hn-detail-date" :datetime="view.item.date">{{ formatDate(view.item.date) }}</time>
          <p class="hn-detail-copy">{{ view.item.description }}</p>
          <p class="hn-dialog-note">這是示意活動，並非已公告的活動或開放報名。正式內容將由園方提供。</p>
        </template>
      </div>
    </dialog>
  </ClientOnly>
</template>
