<script setup lang="ts">
import { responsiveTourImage } from '~/utils/tour-image'
import { eventTimeText, homeArticles, safeWebUrl, sortedArticles, taipeiToday, upcomingEvents } from '~/utils/news-content'
import type { NewsArticle, NewsContent, NewsEvent } from '~/types/site-content'

const props = defineProps<{ news: NewsContent }>()

const dialogEl = ref<HTMLDialogElement | null>(null)
const dialogSupported = ref(false)
const dialogOpen = ref(false)
const cardsEl = ref<HTMLElement | null>(null)
// 「所有最新消息」一律新到舊；首頁輪播有推薦時只放推薦的（依後台順序），再依顯示筆數截斷。
// 活動只列今天以後、近到遠（過期自動下架）。
// SSR 與 hydrate 用同一個台北日期，只有跨午夜那一刻才可能兩邊不同。
const today = taipeiToday()
const articles = computed(() => sortedArticles(props.news.articles))
const rotation = computed(() => homeArticles(props.news.articles, props.news.homeCount))
const events = computed(() => upcomingEvents(props.news.events, today))
// sampleNote 有值＝原型示意內容（fixture 或後台尚未換成真實消息）。
const isSample = computed(() => Boolean(props.news.sampleNote))
const { slots, page, pages, progress, enabled, playing } = useNewsRotation(() => rotation.value, cardsEl, dialogOpen)
const pad = (value: number) => String(value).padStart(2, '0')
const view = ref<{ kind: 'articles' | 'events'; item: NewsArticle | NewsEvent } | { kind: 'list'; list: 'articles' | 'events' } | null>(null)

onMounted(() => {
  dialogSupported.value = typeof HTMLDialogElement !== 'undefined'
})

function showDialog() {
  if (!dialogEl.value?.open) dialogEl.value?.showModal()
  dialogOpen.value = Boolean(dialogEl.value?.open)
}

function openList(list: 'articles' | 'events') {
  view.value = { kind: 'list', list }
  showDialog()
}

function openArticle(item: NewsArticle) {
  view.value = { kind: 'articles', item }
  showDialog()
}

function openEvent(item: NewsEvent) {
  view.value = { kind: 'events', item }
  showDialog()
}

function close() {
  dialogEl.value?.close()
}

function formatDate(date: string) {
  return date.replaceAll('-', '.')
}

// 活動卡片上的第二行：時間（全天就不寫）與地點。
function eventBrief(item: NewsEvent) {
  return [item.allDay === false ? eventTimeText(item) : '', item.location ?? ''].filter(Boolean).join(' · ')
}

</script>

<template>
  <section :id="news.sectionId" class="home-news" aria-labelledby="latest-news-heading">
    <div class="container">
      <div class="hn-layout">
        <!-- 640px 以下以活動影片取代近期活動（2026-09-23 D），桌機隱藏。 -->
        <HomeFilms class="hn-films" />
        <aside class="hn-events" aria-labelledby="upcoming-events-heading">
          <div class="hn-head">
            <span class="hn-kicker"><span lang="en">UPCOMING EVENTS</span><span v-if="isSample" class="hn-sample-tag">示意內容</span></span>
            <h2 id="upcoming-events-heading">近期活動</h2>
          </div>
          <div v-if="events.length" class="hn-event-stack">
            <button
              v-for="item in events"
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
                <small v-if="eventBrief(item)" class="hn-event-brief">{{ eventBrief(item) }}</small>
              </span>
            </button>
          </div>
          <p v-else class="hn-empty">目前沒有近期活動。</p>
          <button v-if="events.length" type="button" class="hn-more" aria-haspopup="dialog" @click="openList('events')">
            所有活動
          </button>
        </aside>
        <div class="hn-news">
          <div class="hn-head hn-news-head">
            <div>
              <span class="hn-kicker"><span lang="en">LATEST NEWS</span><span v-if="isSample" class="hn-sample-tag">示意內容</span></span>
              <h2 id="latest-news-heading">最新消息</h2>
            </div>
            <div class="hn-head-end">
              <!-- 被動倒數，不是控制項；只在會輪播時顯示。 -->
              <span
                v-if="pages > 1" class="hn-progress" aria-hidden="true"
                :data-active="enabled || undefined" :data-paused="!playing || undefined" :style="{ '--hn-progress': progress }"
              >
                <span>{{ pad(page + 1) }} / {{ pad(pages) }}</span><i><b /></i>
              </span>
              <button v-if="articles.length" type="button" class="hn-more" aria-haspopup="dialog" @click="openList('articles')">
                所有最新消息
              </button>
            </div>
          </div>
          <p v-if="!articles.length" class="hn-empty">目前沒有新的消息。</p>
          <div ref="cardsEl" class="hn-cards">
            <!-- 換組時每格暫時有新舊兩層（見 useNewsRotation），平常只有一層。 -->
            <article v-for="(layers, slot) in slots" :key="slot" class="hn-card">
              <div class="hn-media">
                <img
                  v-for="(item, layer) in layers" :key="item.id"
                  v-bind="responsiveTourImage(item.image, '(max-width: 640px) 84vw, (max-width: 900px) 30vw, 420px')"
                  :alt="item.alt" :loading="layer ? 'eager' : 'lazy'" :class="{ 'is-incoming': layer > 0 }"
                >
              </div>
              <div class="hn-copy-stack">
                <div v-for="(item, layer) in layers" :key="item.id" class="hn-card-copy" :inert="(layers.length > 1 && layer === 0) || undefined">
                  <span class="hn-meta"><span>{{ item.campus }}</span><time :datetime="item.date">{{ formatDate(item.date) }}</time></span>
                  <h3><button type="button" aria-haspopup="dialog" @click="openArticle(item)">{{ item.title }}</button></h3>
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>
      <p v-if="isSample" class="hn-sample-note">{{ news.sampleNote }}</p>
    </div>
  </section>

  <ClientOnly>
    <dialog v-if="dialogSupported" ref="dialogEl" id="home-news-dialog" class="hn-dialog" aria-labelledby="home-news-dialog-title" @close="dialogOpen = false">
      <div class="hn-dialog-top">
        <span>常春藤 · 校園消息</span>
        <button type="button" aria-label="關閉消息" @click="close">關閉 ×</button>
      </div>
      <div class="hn-dialog-body">
        <template v-if="view?.kind === 'list'">
          <h2 id="home-news-dialog-title" tabindex="-1">{{ view.list === 'events' ? '近期活動' : '所有最新消息' }}</h2>
          <p v-if="isSample" class="hn-dialog-note">以下為設計示意內容。</p>
          <div v-if="view.list === 'events'" class="hn-event-stack">
            <button v-for="item in events" :key="item.id" type="button" class="hn-event" @click="openEvent(item)">
              <time class="hn-date" :datetime="item.date"><b>{{ item.date.slice(-2) }}</b><span lang="en">{{ item.month }}</span></time>
              <span class="hn-event-copy"><small>{{ item.campus }}</small><strong>{{ item.title }}</strong><small v-if="eventBrief(item)" class="hn-event-brief">{{ eventBrief(item) }}</small></span>
              <span class="hn-arrow" aria-hidden="true">↗</span>
            </button>
          </div>
          <div v-else class="hn-list">
            <button v-for="item in articles" :key="item.id" type="button" class="hn-list-row" @click="openArticle(item)">
              <img v-bind="responsiveTourImage(item.image, '(max-width: 760px) 90vw, 420px')" :alt="item.alt" loading="lazy">
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
          <img v-bind="responsiveTourImage((view.item as NewsArticle).image, '(max-width: 760px) 90vw, 800px')" :alt="(view.item as NewsArticle).alt" loading="lazy">
          <NewsBody v-if="(view.item as NewsArticle).body?.length" :summary="view.item.description" :blocks="(view.item as NewsArticle).body!" />
          <p v-else class="hn-detail-copy">{{ view.item.description }}</p>
          <p v-if="isSample" class="hn-dialog-note">此為閱讀互動示範，標題、日期與內容皆為範例；圖片使用既有校園素材。</p>
        </template>
        <template v-else-if="view?.kind === 'events'">
          <span class="hn-kicker">{{ view.item.campus }}{{ isSample ? ' · 活動示意' : '' }}</span>
          <h2 id="home-news-dialog-title" tabindex="-1">{{ view.item.title }}</h2>
          <time class="hn-detail-date" :datetime="view.item.date">{{ formatDate(view.item.date) }}</time>
          <dl class="hn-event-facts">
            <div><dt>時間</dt><dd>{{ eventTimeText(view.item as NewsEvent) }}</dd></div>
            <div v-if="(view.item as NewsEvent).location"><dt>地點</dt><dd>{{ (view.item as NewsEvent).location }}</dd></div>
          </dl>
          <p class="hn-detail-copy">{{ view.item.description }}</p>
          <a
            v-if="safeWebUrl((view.item as NewsEvent).linkUrl)" class="hn-more hn-event-link"
            :href="safeWebUrl((view.item as NewsEvent).linkUrl)" target="_blank" rel="noopener noreferrer"
          >{{ (view.item as NewsEvent).linkLabel || '活動詳情' }}<span aria-hidden="true">↗</span><span class="sr-only">（另開分頁）</span></a>
          <p v-if="isSample" class="hn-dialog-note">這是示意活動，並非已公告的活動或開放報名。正式內容將由園方提供。</p>
        </template>
      </div>
    </dialog>
  </ClientOnly>
</template>

<style scoped>
/* 活動卡片的第二行（時間、地點）與詳細頁的時間地點、相關連結（2026-09-25）。 */
.hn-event-copy .hn-event-brief { margin: 4px 0 0; color: var(--hn-muted, var(--ivy-news-muted)); }
.hn-event-facts { display: grid; gap: 4px; margin: -4px 0 16px; font-size: var(--fs-sm); }
.hn-event-facts div { display: flex; gap: 12px; }
.hn-event-facts dt { flex-shrink: 0; color: var(--hn-muted); }
.hn-event-facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.hn-dialog .hn-event-link { margin-top: 20px; gap: 12px; white-space: normal; }
</style>
