<script setup lang="ts">
// 單篇消息頁主體（/news/<id>，2026-09-26）。內文沿用 NewsBody；示意消息在標題下註明。
// 結尾依消息的校區帶預約入口：只屬於一校就帶那一校，全校消息走一般預約。
// 2026-11-10：直式封面（粉專 Reels 是 9:16）不再裁成橫條，桌機放在內文右邊整張看得到；
// 沒有分類時不留「校名 ·」的尾巴；結尾接其他消息。
// 2026-11-10：內文第一塊是影片（粉專影片貼文轉來的）時，影片放在封面的位置、內文從第二塊開始——
// 這種消息的封面就是影片的某一格，兩個都放等於同一個畫面出現兩次。封面照舊用在列表、卡片與分享圖。
import type { Campus, NewsArticle, NewsContent } from '~/types/site-content'
import { loadCampusBooking } from '~/composables/useCampusBooking'
import { campusVisitCta, resolveBookingAction, type BookingAction } from '~/utils/booking-action'
import { isSampleNews, isTallImage, NEWS_PATH, newsPath, relatedArticles, tidyNewsText, titleClauses } from '~/utils/news-content'
import { responsiveTourImage } from '~/utils/tour-image'

const props = defineProps<{ article: NewsArticle; news: NewsContent; campuses: Campus[] }>()
const sample = computed(() => isSampleNews(props.article, props.news.sampleNote))
const campus = computed(() => props.article.campusKeys?.length === 1 ? props.campuses.find((c) => c.key === props.article.campusKeys![0]) : undefined)
const listLink = computed(() => campus.value ? { path: NEWS_PATH, query: { campus: campus.value.key } } : NEWS_PATH)
const formatDate = (date: string) => date.replaceAll('-', '.')

// 單校消息結尾的參觀入口跟著那一校的預約方式（2026-11-12）：原本一律寫「預約○○校參觀」，暫停線上預約、
// 只能來電的校區在首頁五校卡寫的是「致電○○校預約參觀」。和五校卡同一個判斷（campusVisitCta）：只在瀏覽器讀，
// 讀到之前與讀不到時照舊連預約頁；讀到的設定放進同一個快取，點進預約頁不再重抓。
const nuxtApp = useNuxtApp()
const bookingAction = ref<BookingAction | null>(null)
const visitCta = computed(() => (campus.value ? campusVisitCta(campus.value, bookingAction.value) : null))
onMounted(async () => {
  const key = campus.value?.key
  if (!key) return
  try {
    bookingAction.value = resolveBookingAction(key, await loadCampusBooking(nuxtApp, key))
  } catch {
    // 讀不到就維持預約頁的連結。
  }
})

const imageOf = (item: NewsArticle, sizes: string) => responsiveTourImage(item.image, sizes, false, item.imageMedia)
const imageStyle = (item: NewsArticle) => (item.imageMedia?.position ? { objectPosition: item.imageMedia.position } : undefined)
const leadVideo = computed(() => {
  const first = props.article.body?.[0]
  return first?.type === 'video' && first.videoSrc ? first : undefined
})
const blocks = computed(() => (leadVideo.value ? props.article.body!.slice(1) : props.article.body ?? []))
const tall = computed(() => isTallImage(leadVideo.value ?? imageOf(props.article, '100vw')))
const cover = computed(() => imageOf(props.article, tall.value ? '(max-width: 899px) 100vw, 360px' : '(max-width: 760px) 100vw, 760px'))
const related = computed(() => relatedArticles(props.news.articles, props.article))
const CARD_SIZES = '(max-width: 599px) 104px, (max-width: 899px) 46vw, 340px'
</script>

<template>
  <main id="main" tabindex="-1" class="np np-article-page" data-cta-entry="news">
    <div class="np-wrap" :class="{ 'np-narrow': !tall }">
      <nav class="np-crumb" aria-label="麵包屑"><NuxtLink to="/">首頁</NuxtLink><span aria-hidden="true">/</span><NuxtLink :to="NEWS_PATH">最新消息</NuxtLink></nav>
      <article class="np-article" :class="{ 'is-tall': tall }" data-track-section="article" aria-labelledby="np-article-title">
        <header class="np-article-head">
          <p class="np-meta"><span>{{ article.campus }}<template v-if="article.category"> · {{ article.category }}</template><span v-if="sample" class="hn-sample-tag">示意</span></span><time :datetime="article.date">{{ formatDate(article.date) }}</time></p>
          <h1 id="np-article-title"><span v-for="(part, i) in titleClauses(article.title)" :key="i" class="np-clause">{{ part }}</span></h1>
          <p v-if="sample" class="np-sample-note">此為閱讀互動示範，標題、日期與內容皆為範例；圖片使用既有校園素材。</p>
        </header>
        <NewsBodyVideo v-if="leadVideo" class="np-cover-video" :block="leadVideo" />
        <ResponsivePicture v-else class="np-cover" v-bind="cover" :style="imageStyle(article)" :alt="article.alt" fetchpriority="high" />
        <div class="np-article-main" data-track-read>
          <NewsBody v-if="blocks.length" :summary="article.description" :blocks="blocks" />
          <p v-else class="np-article-copy">{{ tidyNewsText(article.description) }}</p>
        </div>
      </article>
      <div class="np-article-foot">
        <NuxtLink class="np-back" :to="listLink"><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-left" /></svg>{{ campus ? `回${campus.name}的消息` : '回消息列表' }}</NuxtLink>
        <NuxtLink v-if="!visitCta || visitCta.kind === 'visit'" class="np-book" :to="campus ? `/visit/${campus.key}` : '/visit'">預約{{ campus ? campus.name : '校園' }}參觀<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
        <a v-else-if="visitCta.kind === 'phone'" class="np-book" :href="visitCta.href">{{ visitCta.label }}<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-phone" /></svg></a>
        <a v-else class="np-book" :href="visitCta.href" target="_blank" rel="noopener noreferrer">{{ visitCta.label }}<span class="sr-only">（另開分頁）</span><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-up-right" /></svg></a>
      </div>
      <section v-if="related.length" class="np-related" data-track-section="related" aria-labelledby="np-related-title">
        <h2 id="np-related-title">其他消息</h2>
        <ul class="np-grid">
          <li v-for="item in related" :key="item.id" class="np-card">
            <span class="np-photo"><ResponsivePicture v-bind="imageOf(item, CARD_SIZES)" :style="imageStyle(item)" :alt="item.alt" loading="lazy" /></span>
            <div class="np-card-copy">
              <p class="np-meta"><span>{{ item.campus }}</span><time :datetime="item.date">{{ formatDate(item.date) }}</time><span v-if="item.category">{{ item.category }}</span></p>
              <h3><NuxtLink :to="newsPath(item.id)"><span v-for="(part, i) in titleClauses(item.title)" :key="i" class="np-clause">{{ part }}</span></NuxtLink></h3>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </main>
</template>

<style scoped src="../assets/css/news-page.css"></style>
