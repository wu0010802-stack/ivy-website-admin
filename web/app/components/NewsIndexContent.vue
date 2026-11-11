<script setup lang="ts">
// 最新消息列表頁主體（/news，2026-09-26）。上面是近期活動（今天以後，近到遠），
// 下面是消息（新到舊），可依校區篩選：`?campus=<key>`，全校消息在每一校都看得到。
// 示意內容照首頁的標法（整區標一次或逐則標），單篇頁另外 noindex。
// 2026-11-10 改版：最新一則放大、其餘排成照片格（手機是縮圖列）；校區篩選只列有自己消息或活動的校區；
// 一次先列 13 則，其餘用「看更早的消息」（`?show=<n>`）展開；結尾接各校粉絲專頁。
import { nextTick, onMounted, ref, watch } from 'vue'
import type { Campus, NewsArticle, NewsContent, NewsEvent } from '~/types/site-content'
import { articlesForCampus, eventTimeDetail, isSampleNews, isTallImage, newsInCampus, newsPath, safeWebUrl, sampleCoverage, sortedArticles, taipeiToday, tidyNewsText, titleClauses, upcomingEvents } from '~/utils/news-content'
import { dateParts, ownedByCampus } from '~/utils/news-home'
import { responsiveTourImage } from '~/utils/tour-image'

// today：判斷「近期活動」的日期。後台預覽（/preview?page=news&date=）傳預覽的那一天，和消息上下架同一天；
// 正式頁不傳，用台北的今天。
const props = defineProps<{ news: NewsContent; campuses: Campus[]; today?: string }>()
const route = useRoute()
// 校區篩選只換 campus，網址其他參數照留：在 /preview 裡顯示時，page=news、date、viewport、embed
// 不能丟，不然一點校區就跳回首頁預覽、日期也回到今天（2026-10-13）。換校區時 show 歸零（從最新的看起）。
function filterQuery(campus?: string) {
  const { campus: _current, show: _show, ...rest } = route.query
  return campus ? { ...rest, campus } : rest
}

const campusKey = computed(() => {
  const value = typeof route.query.campus === 'string' ? route.query.campus : ''
  return props.campuses.some((c) => c.key === value) ? value : undefined
})
const campusName = computed(() => props.campuses.find((c) => c.key === campusKey.value)?.name)
// 沒有消息時列各校粉專；只看一校時只列那一校（2026-10-24）。
const followCampuses = computed(() => (campusKey.value ? props.campuses.filter((c) => c.key === campusKey.value) : props.campuses))
const articles = computed(() => articlesForCampus(props.news.articles, campusKey.value, campusName.value))
const today = computed(() => props.today ?? taipeiToday())
const allEvents = computed(() => upcomingEvents(props.news.events, today.value))
const events = computed(() => allEvents.value.filter((e) => !campusKey.value || newsInCampus(e, campusKey.value, campusName.value)))
const isSample = (item: { sample?: boolean }) => isSampleNews(item, props.news.sampleNote)
const articlesSample = computed(() => sampleCoverage(articles.value, props.news.sampleNote))
const eventsSample = computed(() => sampleCoverage(events.value, props.news.sampleNote))
const anySample = computed(() => Boolean(props.news.sampleNote) && [...articles.value, ...events.value].some(isSample))

// 校區篩選只列有自己的消息或近期活動的校區（同首頁 10-17 的規則）：原本五校全列，沒有消息的校區點了只看到空畫面。
// 少於兩校有內容時等於沒得選，不出篩選；網址已經指定某一校時照樣出（含那一校），才回得去「全部」。
const filterCampuses = computed(() => {
  const owners = props.campuses.filter((c) => props.news.articles.some((a) => ownedByCampus(a, c)) || allEvents.value.some((e) => ownedByCampus(e, c)))
  if (owners.length < 2 && !campusKey.value) return []
  return props.campuses.filter((c) => owners.includes(c) || c.key === campusKey.value)
})

// 一次先列最新一則＋12 則，其餘按「看更早的消息」每次多 12 則。用網址參數而不是元件狀態：
// 不開 JavaScript 也能用、重新整理與上一頁都停在同一個長度。
const PAGE_SIZE = 12
const shownPages = computed(() => {
  const value = Number(typeof route.query.show === 'string' ? route.query.show : 1)
  return Number.isInteger(value) && value > 1 ? value : 1
})
const lead = computed(() => articles.value[0])
const rest = computed(() => articles.value.slice(1, 1 + PAGE_SIZE * shownPages.value))
const hasMore = computed(() => articles.value.length > 1 + rest.value.length)
const moreQuery = computed(() => ({ ...route.query, show: String(shownPages.value + 1) }))
// 只看一校而那一校沒有消息：粉專下面補其他校區最近的三則，不讓頁面停在一行連結。
const others = computed(() => (campusKey.value && !articles.value.length
  ? sortedArticles(props.news.articles).filter((a) => !newsInCampus(a, campusKey.value!, campusName.value)).slice(0, 3)
  : []))
// 「所有消息」緊接在大標「最新消息」下面時是重複的字，只留給讀屏；上面有近期活動、只看一校、或整區是示意內容時才顯示。
const showArticlesTitle = computed(() => Boolean(events.value.length || campusName.value || articlesSample.value === 'all'))

const formatDate = (date: string) => date.replaceAll('-', '.')
const eventFacts = (item: NewsEvent) => [eventTimeDetail(item), item.location ?? ''].filter(Boolean).join(' · ')
// 日期牌已經寫了幾月幾日，meta 改寫星期幾（家長要知道是不是假日），再接時間與地點；示意活動不露日期，星期也不寫。
const eventMeta = (item: NewsEvent) => [isSample(item) ? '' : `星期${dateParts(item.date).weekday}`, eventFacts(item)].filter(Boolean).join(' · ')

// 手機的篩選是一列橫滑：選中的校區排在後面時（例如從首頁帶 ?campus= 進來）先捲到看得到的位置。
// 直接設 scrollLeft，不用 scrollIntoView——後者在返回上一頁時會連整頁一起捲回頁首。
const filterRef = ref<HTMLElement | null>(null)
function revealActiveFilter() {
  const nav = filterRef.value
  const active = nav?.querySelector<HTMLElement>('[aria-current]')
  if (nav && active) nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2
}
onMounted(revealActiveFilter)
watch(campusKey, () => nextTick(revealActiveFilter))

const LEAD_SIZES = '(max-width: 700px) 100vw, 560px'
const CARD_SIZES = '(max-width: 599px) 104px, (max-width: 899px) 46vw, 340px'
const imageOf = (item: NewsArticle, sizes: string) => responsiveTourImage(item.image, sizes, false, item.imageMedia)
const imageStyle = (item: NewsArticle) => (item.imageMedia?.position ? { objectPosition: item.imageMedia.position } : undefined)
</script>

<template>
  <main id="main" tabindex="-1" class="np" data-cta-entry="news">
    <div class="np-wrap">
      <nav class="np-crumb" aria-label="麵包屑"><NuxtLink to="/">首頁</NuxtLink><span aria-hidden="true">/</span><span aria-current="page">最新消息</span></nav>
      <header class="np-head">
        <h1>最新消息</h1>
        <nav v-if="filterCampuses.length" ref="filterRef" class="np-filter" aria-label="依校區篩選">
          <NuxtLink :to="{ query: filterQuery() }" :aria-current="!campusKey ? 'page' : undefined">全部</NuxtLink>
          <NuxtLink v-for="c in filterCampuses" :key="c.key" :to="{ query: filterQuery(c.key) }" :aria-current="campusKey === c.key ? 'page' : undefined">{{ c.name }}</NuxtLink>
        </nav>
      </header>

      <section v-if="events.length" class="np-events" data-track-section="events" aria-labelledby="np-events-title">
        <h2 id="np-events-title">近期活動<span v-if="eventsSample === 'all'" class="hn-sample-tag">示意內容</span></h2>
        <ul class="np-event-list">
          <li v-for="item in events" :key="item.id" class="np-event">
            <!-- 示意活動不露出具體日期（同首頁對話框，2026-09-27），排序仍依原日期。 -->
            <span v-if="isSample(item)" class="np-event-date is-sample"><b>示意</b><span>日期未定</span></span>
            <time v-else class="np-event-date" :datetime="item.date"><b>{{ item.date.slice(-2) }}</b><span lang="en">{{ item.month }}</span></time>
            <div class="np-event-copy">
              <p class="np-meta"><span>{{ item.campus }}<span v-if="eventsSample === 'some' && isSample(item)" class="hn-sample-tag">示意</span></span><span v-if="eventMeta(item)">{{ eventMeta(item) }}</span></p>
              <h3><span v-for="(part, i) in titleClauses(item.title)" :key="i" class="np-clause">{{ part }}</span></h3>
              <p v-if="item.description">{{ tidyNewsText(item.description) }}</p>
              <a v-if="safeWebUrl(item.linkUrl)" class="np-event-link" :href="safeWebUrl(item.linkUrl)" target="_blank" rel="noopener noreferrer">{{ item.linkLabel || '活動詳情' }}<span aria-hidden="true"> ↗</span><span class="sr-only">（另開分頁）</span></a>
            </div>
          </li>
        </ul>
      </section>

      <section class="np-articles" data-track-section="articles" aria-labelledby="np-articles-title">
        <h2 id="np-articles-title" :class="{ 'sr-only': !showArticlesTitle }">{{ campusName ? `${campusName}的消息` : '所有消息' }}<span v-if="articlesSample === 'all'" class="hn-sample-tag">示意內容</span></h2>
        <NewsFollowCampuses v-if="!lead" class="np-empty" :campuses="followCampuses" />
        <template v-else>
          <article class="np-lead" :class="{ 'is-tall': isTallImage(imageOf(lead, LEAD_SIZES)) }">
            <span class="np-photo"><ResponsivePicture v-bind="imageOf(lead, LEAD_SIZES)" :style="imageStyle(lead)" :alt="lead.alt" :fetchpriority="events.length ? undefined : 'high'" /></span>
            <div class="np-lead-copy">
              <p class="np-meta"><span>{{ lead.campus }}<span v-if="articlesSample === 'some' && isSample(lead)" class="hn-sample-tag">示意</span></span><time :datetime="lead.date">{{ formatDate(lead.date) }}</time><span v-if="lead.category">{{ lead.category }}</span></p>
              <h3><NuxtLink :to="newsPath(lead.id)"><span v-for="(part, i) in titleClauses(lead.title)" :key="i" class="np-clause">{{ part }}</span></NuxtLink></h3>
              <p v-if="lead.description" class="np-lead-desc">{{ tidyNewsText(lead.description) }}</p>
            </div>
          </article>
          <ul v-if="rest.length" class="np-grid">
            <li v-for="item in rest" :key="item.id" class="np-card">
              <span class="np-photo"><ResponsivePicture v-bind="imageOf(item, CARD_SIZES)" :style="imageStyle(item)" :alt="item.alt" loading="lazy" /></span>
              <div class="np-card-copy">
                <p class="np-meta"><span>{{ item.campus }}<span v-if="articlesSample === 'some' && isSample(item)" class="hn-sample-tag">示意</span></span><time :datetime="item.date">{{ formatDate(item.date) }}</time><span v-if="item.category">{{ item.category }}</span></p>
                <h3><NuxtLink :to="newsPath(item.id)"><span v-for="(part, i) in titleClauses(item.title)" :key="i" class="np-clause">{{ part }}</span></NuxtLink></h3>
              </div>
            </li>
          </ul>
          <p v-if="hasMore" class="np-more"><NuxtLink :to="{ query: moreQuery }" replace>看更早的消息</NuxtLink></p>
        </template>
      </section>

      <section v-if="others.length" class="np-others" aria-labelledby="np-others-title">
        <h2 id="np-others-title">其他校區最近</h2>
        <ul class="np-grid">
          <li v-for="item in others" :key="item.id" class="np-card">
            <span class="np-photo"><ResponsivePicture v-bind="imageOf(item, CARD_SIZES)" :style="imageStyle(item)" :alt="item.alt" loading="lazy" /></span>
            <div class="np-card-copy">
              <p class="np-meta"><span>{{ item.campus }}</span><time :datetime="item.date">{{ formatDate(item.date) }}</time><span v-if="item.category">{{ item.category }}</span></p>
              <h3><NuxtLink :to="newsPath(item.id)"><span v-for="(part, i) in titleClauses(item.title)" :key="i" class="np-clause">{{ part }}</span></NuxtLink></h3>
            </div>
          </li>
        </ul>
      </section>

      <p v-if="anySample" class="np-sample-note">{{ news.sampleNote }}</p>
      <!-- 有消息時也在結尾列各校粉專：官網的消息是挑過的，孩子每天的照片在粉專。沒有消息時粉專已經在上面，不重複。 -->
      <NewsFollowCampuses v-if="lead" class="np-follow" :campuses="followCampuses" />
    </div>
  </main>
</template>

<style scoped src="../assets/css/news-page.css"></style>
