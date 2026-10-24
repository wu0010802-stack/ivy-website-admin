<script setup lang="ts">
import { campusFilms } from '~/utils/campusFilms'
import { responsiveTourImage } from '~/utils/tour-image'
import { eventTimeDetail, homeArticles, isSampleNews, NEWS_PATH, newsPath, safeWebUrl, sampleCoverage, taipeiToday, titleClauses, upcomingEvents, type SampleCoverage } from '~/utils/news-content'
import { campusFilterOptions, countdownLabel, dateParts, homeFeed } from '~/utils/news-home'
import type { Campus, NewsArticle, NewsContent, NewsEvent } from '~/types/site-content'

/**
 * 首頁「近期活動／最新消息」（2026-10-17 改版，比稿 design/news-directions-20261017，使用者選桌機方向 1、手機方向 3）。
 * 桌機：下一個活動放大（倒數、加入行事曆），其他活動可展開；沒有活動時左欄不出現、消息改整寬。
 * 消息不輪播：一則大圖＋三列，可依校區篩，篩一校而消息不夠時補其他校區最近的。
 * 手機（640px 以下）：HomeStories，活動、消息、活動影片排成一列直式卡，點開連續看；取代 09-23 的活動影片色帶。
 * 這一區不放參觀入口（使用者裁定），預約交給頁首。
 */
const props = defineProps<{ news: NewsContent; campuses?: Campus[]; today?: string }>()

const dialogEl = ref<HTMLDialogElement | null>(null)
const dialogSupported = ref(false)
// SSR 與 hydrate 用同一個台北日期，只有跨午夜那一刻才可能兩邊不同。後台預覽可以指定日期。
const today = computed(() => props.today ?? taipeiToday())
const campusList = computed(() => props.campuses ?? [])
// 首頁消息：有推薦時只放推薦的（依後台順序），再依顯示筆數截斷（homeArticles）。活動只列今天以後、近到遠。
const articles = computed(() => homeArticles(props.news.articles, props.news.homeCount))
const events = computed(() => upcomingEvents(props.news.events, today.value))
const films = computed(() => (props.news.films?.length ? props.news.films : campusFilms))
const nextEvent = computed(() => events.value[0])
const laterEvents = computed(() => events.value.slice(1))

// 原型示意內容逐則判斷（見 NewsContent.sampleNote）：一區全是示意就在標題標一次，混著真實消息時逐則標。
const isSample = (item: NewsArticle | NewsEvent) => isSampleNews(item, props.news.sampleNote)
const articlesSample = computed(() => sampleCoverage(articles.value, props.news.sampleNote))
const eventsSample = computed(() => sampleCoverage(events.value, props.news.sampleNote))
const anySample = computed(() => Boolean(props.news.sampleNote) && [...articles.value, ...events.value].some(isSample))
const tagged = (item: NewsArticle | NewsEvent, coverage: SampleCoverage) => coverage === 'some' && isSample(item)

// 校區篩選：少於兩校有自己的消息就不出（campusFilterOptions）。
const options = computed(() => campusFilterOptions(articles.value, campusList.value))
const campusKey = ref('all')
const selectedCampus = computed(() => campusList.value.find((c) => c.key === campusKey.value))
const feed = computed(() => homeFeed(articles.value, selectedCampus.value))
const allNewsLink = computed(() => (selectedCampus.value ? { path: NEWS_PATH, query: { campus: selectedCampus.value.key } } : NEWS_PATH))
// 篩選時照片沿著自己的位置縮放移動：每則照片一個固定的 view-transition-name（用首頁清單裡的序號，id 可能有冒號）。
const mediaName = (item: NewsArticle) => `hn-m-${articles.value.indexOf(item)}`

type TransitionDocument = Document & { startViewTransition?: (arg: unknown) => unknown }
function selectCampus(key: string) {
  if (key === campusKey.value) return
  const update = async () => {
    campusKey.value = key
    await nextTick()
  }
  const doc = document as TransitionDocument
  if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    void update()
    return
  }
  // types 讓「只有消息區在動」的規則只套在篩選轉場；不支援 types 的瀏覽器退回只傳 callback。
  try {
    doc.startViewTransition({ update, types: ['news-filter'] })
  } catch {
    doc.startViewTransition(update)
  }
}

// 「所有活動」對話框：活動沒有單篇頁，清單→單則詳情。
const view = ref<{ kind: 'events'; item: NewsEvent } | { kind: 'list' } | null>(null)
onMounted(() => {
  dialogSupported.value = typeof HTMLDialogElement !== 'undefined'
})
function showDialog() {
  if (!dialogEl.value?.open) dialogEl.value?.showModal()
}
function openList() {
  view.value = { kind: 'list' }
  showDialog()
}
function openEvent(item: NewsEvent) {
  view.value = { kind: 'events', item }
  showDialog()
}
function close() {
  dialogEl.value?.close()
}
// 點背景關閉：用座標判斷是否落在外框之外；按下時也要在外框外（從內文拖曳選字、放開在背景上不關）。
let pressedOutside = false
function outsideDialog(event: MouseEvent) {
  const dialog = dialogEl.value
  if (!dialog || event.target !== dialog) return false
  const rect = dialog.getBoundingClientRect()
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom
}
function onDialogPointerDown(event: PointerEvent) {
  pressedOutside = outsideDialog(event)
}
function onDialogClick(event: MouseEvent) {
  if (pressedOutside && outsideDialog(event)) close()
  pressedOutside = false
}

const formatDate = (date: string) => date.replaceAll('-', '.')
const monthDay = (date: string) => {
  const p = dateParts(date)
  return `${p.month} 月 ${p.day} 日`
}
// 活動的時間與地點：時間只在園方填了開始時間時寫（不替園方寫「全天」）。
const eventBrief = (item: NewsEvent) => [eventTimeDetail(item), item.location ?? ''].filter(Boolean).join(' · ')
const imageFor = (item: NewsArticle, sizes: string) => responsiveTourImage(item.image, sizes, false, item.imageMedia)
const imageStyle = (item: NewsArticle) => (item.imageMedia?.position ? { objectPosition: item.imageMedia.position } : undefined)
</script>

<template>
  <section :id="news.sectionId" class="home-news" aria-labelledby="latest-news-heading">
    <div class="container hn-desk">
      <div class="hn-grid" :class="{ 'is-news-only': !nextEvent }">
        <section v-if="nextEvent" class="hn-next" aria-labelledby="upcoming-events-heading">
          <div class="hn-head">
            <h2 id="upcoming-events-heading">近期活動<span v-if="eventsSample === 'all'" class="hn-sample-tag">示意內容</span></h2>
            <button v-if="laterEvents.length" type="button" class="hn-more" aria-haspopup="dialog" @click="openList()">所有活動</button>
          </div>
          <div class="hn-body">
            <article class="hn-event-card" aria-labelledby="hn-next-title">
              <div class="hn-when">
                <!-- 示意活動不露出具體日期，免得家長當成已公告的活動照日期到校（2026-09-27）。 -->
                <p v-if="isSample(nextEvent)" class="hn-when-date is-sample"><b>示意</b><span>日期未定</span></p>
                <time v-else class="hn-when-date" :datetime="nextEvent.date">
                  <b>{{ dateParts(nextEvent.date).day }}</b>
                  <span>{{ dateParts(nextEvent.date).month }} 月</span>
                  <span>星期{{ dateParts(nextEvent.date).weekday }}</span>
                </time>
                <span v-if="!isSample(nextEvent)" class="hn-count" :class="{ 'is-today': countdownLabel(today, nextEvent.date) === '今天' }">{{ countdownLabel(today, nextEvent.date) }}</span>
              </div>
              <h3 id="hn-next-title"><span v-for="(part, k) in titleClauses(nextEvent.title)" :key="k" class="hn-clause">{{ part }}</span></h3>
              <p class="hn-facts">
                <span v-if="eventTimeDetail(nextEvent)"><svg class="icon" aria-hidden="true"><use href="#i-clock" /></svg>{{ eventTimeDetail(nextEvent) }}</span>
                <span v-if="nextEvent.location"><svg class="icon" aria-hidden="true"><use href="#i-map-pin" /></svg>{{ nextEvent.location }}</span>
                <span class="hn-scope">{{ nextEvent.campus }}</span>
                <span v-if="tagged(nextEvent, eventsSample)" class="hn-sample-tag">示意</span>
              </p>
              <p class="hn-desc">{{ nextEvent.description }}</p>
              <div v-if="!isSample(nextEvent) || safeWebUrl(nextEvent.linkUrl)" class="hn-actions">
                <HomeEventCalendar v-if="!isSample(nextEvent)" :event="nextEvent" />
                <a v-if="safeWebUrl(nextEvent.linkUrl)" class="hn-link" :href="safeWebUrl(nextEvent.linkUrl)" target="_blank" rel="noopener noreferrer">{{ nextEvent.linkLabel || '活動詳情' }}<span aria-hidden="true">↗</span><span class="sr-only">（另開分頁）</span></a>
              </div>
            </article>
            <div v-if="laterEvents.length" class="hn-later">
              <details v-for="item in laterEvents" :key="item.id">
                <summary>
                  <span v-if="isSample(item)" class="hn-later-date is-sample">示意</span>
                  <time v-else class="hn-later-date" :datetime="item.date">{{ dateParts(item.date).month }}/{{ dateParts(item.date).day }}<small>週{{ dateParts(item.date).weekday }}</small></time>
                  <span class="hn-later-copy"><strong>{{ item.title }}</strong><small>{{ [eventTimeDetail(item), item.campus].filter(Boolean).join(' · ') }}</small></span>
                  <svg class="icon" aria-hidden="true"><use href="#i-plus" /></svg>
                </summary>
                <div class="hn-later-more">
                  <p v-if="item.location" class="hn-facts"><span><svg class="icon" aria-hidden="true"><use href="#i-map-pin" /></svg>{{ item.location }}</span></p>
                  <p class="hn-desc">{{ item.description }}</p>
                  <div v-if="!isSample(item) || safeWebUrl(item.linkUrl)" class="hn-actions">
                    <HomeEventCalendar v-if="!isSample(item)" :event="item" quiet />
                    <a v-if="safeWebUrl(item.linkUrl)" class="hn-link" :href="safeWebUrl(item.linkUrl)" target="_blank" rel="noopener noreferrer">{{ item.linkLabel || '活動詳情' }}<span aria-hidden="true">↗</span><span class="sr-only">（另開分頁）</span></a>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </section>

        <!-- 不另成 landmark：外層 section 已經用「最新消息」命名（axe landmark-unique）。 -->
        <div class="hn-news">
          <div class="hn-head">
            <h2 id="latest-news-heading">最新消息<span v-if="articlesSample === 'all'" class="hn-sample-tag">示意內容</span></h2>
            <NuxtLink v-if="articles.length" class="hn-more" :to="allNewsLink">所有最新消息</NuxtLink>
          </div>
          <fieldset v-if="options.length" class="hn-filter">
            <legend class="sr-only">依校區看消息</legend>
            <label v-for="o in options" :key="o.key">
              <input type="radio" name="hn-campus" :value="o.key" :checked="o.key === campusKey" @change="selectCampus(o.key)">
              <span>{{ o.label }}<b>{{ o.count }}</b></span>
            </label>
          </fieldset>
          <NewsFollowCampuses v-if="!feed.lead" :campuses="campusList" />
          <div v-else class="hn-feed" :class="{ 'is-single': !feed.rest.length && !feed.others.length }" aria-live="polite">
            <article class="hn-story hn-feature">
              <figure :style="{ viewTransitionName: mediaName(feed.lead) }">
                <img v-bind="imageFor(feed.lead, '(max-width: 1100px) 50vw, 440px')" :style="imageStyle(feed.lead)" :alt="feed.lead.alt" loading="lazy">
              </figure>
              <p class="hn-meta"><b>{{ feed.lead.campus }}</b><span>{{ feed.lead.category }}</span><span v-if="tagged(feed.lead, articlesSample)" class="hn-sample-tag">示意</span><time :datetime="feed.lead.date">{{ monthDay(feed.lead.date) }}</time></p>
              <h3><NuxtLink :to="newsPath(feed.lead.id)"><span v-for="(part, k) in titleClauses(feed.lead.title)" :key="k" class="hn-clause">{{ part }}</span></NuxtLink></h3>
              <p class="hn-desc">{{ feed.lead.description }}</p>
            </article>
            <div v-if="feed.rest.length || feed.others.length" class="hn-side">
              <ol v-if="feed.rest.length" class="hn-rows">
                <li v-for="item in feed.rest" :key="item.id">
                  <article class="hn-story hn-row">
                    <figure :style="{ viewTransitionName: mediaName(item) }">
                      <img v-bind="imageFor(item, '124px')" :style="imageStyle(item)" :alt="item.alt" loading="lazy">
                    </figure>
                    <div>
                      <p class="hn-meta"><b>{{ item.campus }}</b><span>{{ item.category }}</span><span v-if="tagged(item, articlesSample)" class="hn-sample-tag">示意</span><time :datetime="item.date">{{ monthDay(item.date) }}</time></p>
                      <h3><NuxtLink :to="newsPath(item.id)"><span v-for="(part, k) in titleClauses(item.title)" :key="k" class="hn-clause">{{ part }}</span></NuxtLink></h3>
                    </div>
                  </article>
                </li>
              </ol>
              <template v-if="feed.others.length">
                <p class="hn-others">其他校區最近</p>
                <ol class="hn-rows">
                  <li v-for="item in feed.others" :key="item.id">
                    <article class="hn-story hn-row">
                      <figure :style="{ viewTransitionName: mediaName(item) }">
                        <img v-bind="imageFor(item, '124px')" :style="imageStyle(item)" :alt="item.alt" loading="lazy">
                      </figure>
                      <div>
                        <p class="hn-meta"><b>{{ item.campus }}</b><span>{{ item.category }}</span><span v-if="tagged(item, articlesSample)" class="hn-sample-tag">示意</span><time :datetime="item.date">{{ monthDay(item.date) }}</time></p>
                        <h3><NuxtLink :to="newsPath(item.id)"><span v-for="(part, k) in titleClauses(item.title)" :key="k" class="hn-clause">{{ part }}</span></NuxtLink></h3>
                      </div>
                    </article>
                  </li>
                </ol>
              </template>
            </div>
          </div>
        </div>
      </div>
      <p v-if="anySample" class="hn-sample-note">{{ news.sampleNote }}</p>
    </div>

    <HomeStories
      class="hn-stories" :events="events" :articles="articles" :films="films" :campuses="campusList"
      :today="today" :sample-note="news.sampleNote"
    />
  </section>

  <ClientOnly>
    <dialog v-if="dialogSupported" ref="dialogEl" id="home-news-dialog" class="hn-dialog" aria-labelledby="home-news-dialog-title" @pointerdown="onDialogPointerDown" @click="onDialogClick">
      <div class="hn-dialog-top">
        <span>常春藤 · 校園消息</span>
        <button type="button" aria-label="關閉消息" @click="close">關閉 ×</button>
      </div>
      <div class="hn-dialog-body">
        <template v-if="view?.kind === 'list'">
          <h2 id="home-news-dialog-title" tabindex="-1">近期活動</h2>
          <p v-if="eventsSample === 'all'" class="hn-dialog-note">以下為設計示意內容。</p>
          <div class="hn-event-stack">
            <button v-for="item in events" :key="item.id" type="button" class="hn-event" @click="openEvent(item)">
              <span v-if="isSample(item)" class="hn-date is-sample"><b>示意</b><span>日期未定</span></span><time v-else class="hn-date" :datetime="item.date"><b>{{ item.date.slice(-2) }}</b><span lang="en">{{ item.month }}</span></time>
              <span class="hn-event-copy"><small>{{ item.campus }}<span v-if="tagged(item, eventsSample)" class="hn-sample-tag">示意</span></small><strong>{{ item.title }}</strong><small v-if="eventBrief(item)" class="hn-event-brief">{{ eventBrief(item) }}</small></span>
            </button>
          </div>
        </template>
        <template v-else-if="view?.kind === 'events'">
          <span class="hn-kicker">{{ view.item.campus }}{{ isSample(view.item) ? ' · 活動示意' : '' }}</span>
          <h2 id="home-news-dialog-title" tabindex="-1">{{ view.item.title }}</h2>
          <p v-if="isSample(view.item)" class="hn-detail-date">日期未定</p>
          <time v-else class="hn-detail-date" :datetime="view.item.date">{{ formatDate(view.item.date) }}</time>
          <dl v-if="eventTimeDetail(view.item) || view.item.location" class="hn-event-facts">
            <div v-if="eventTimeDetail(view.item)"><dt>時間</dt><dd>{{ eventTimeDetail(view.item) }}</dd></div>
            <div v-if="view.item.location"><dt>地點</dt><dd>{{ view.item.location }}</dd></div>
          </dl>
          <p class="hn-detail-copy">{{ view.item.description }}</p>
          <div v-if="!isSample(view.item) || safeWebUrl(view.item.linkUrl)" class="hn-actions">
            <HomeEventCalendar v-if="!isSample(view.item)" :key="view.item.id" :event="view.item" />
            <a
              v-if="safeWebUrl(view.item.linkUrl)" class="hn-more hn-event-link"
              :href="safeWebUrl(view.item.linkUrl)" target="_blank" rel="noopener noreferrer"
            >{{ view.item.linkLabel || '活動詳情' }}<span aria-hidden="true">↗</span><span class="sr-only">（另開分頁）</span></a>
          </div>
          <p v-if="isSample(view.item)" class="hn-dialog-note">這是示意活動，並非已公告的活動或開放報名。正式內容將由園方提供。</p>
        </template>
      </div>
    </dialog>
  </ClientOnly>
</template>

<style>
/* 2026-10-17 首頁消息桌機（方向 1）。不放 scoped：view transition 的偽元素要全域名稱。 */
.home-news .hn-desk { padding-block: clamp(8px, 2vw, 32px) clamp(24px, 4vw, 56px); }
.home-news .hn-grid { display: grid; grid-template-columns: minmax(300px, 5fr) 11fr; grid-template-rows: auto auto auto; column-gap: clamp(44px, 5.5vw, 96px); align-items: start; }
/* 兩欄用 subgrid 共用列高：左欄活動卡的頂端對齊右欄照片頂端（右欄多一列校區篩選）。 */
.home-news .hn-next, .home-news .hn-news { grid-row: 1 / span 3; display: grid; grid-template-rows: subgrid; align-content: start; min-width: 0; }
.home-news .hn-next > .hn-body { grid-row: 3; }
.home-news .hn-grid.is-news-only { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; }
.home-news .hn-grid.is-news-only .hn-news { grid-row: auto; display: block; }
.home-news .hn-head { display: flex; align-items: end; justify-content: space-between; gap: 16px; min-height: 52px; margin-bottom: 22px; }
.home-news .hn-head h2 { color: var(--ivy-news-green); line-height: 1.25; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
.home-news .hn-head .hn-sample-tag { margin-left: 0; }
.home-news .hn-head .hn-more { font-size: var(--fs-sm); }

/* 下一個活動 */
.hn-event-card { border-radius: 22px; background: var(--ivy-news-swept-gold); padding: 26px 28px 28px; color: var(--ivy-news-green); }
.hn-when { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 18px; }
.hn-when-date { display: grid; grid-template-columns: auto auto; column-gap: 12px; align-items: center; margin: 0; }
.hn-when-date b { grid-row: 1 / 3; font: 400 clamp(4.25rem, 5.4vw, 5.25rem)/.82 var(--font-date); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.hn-when-date span { font-size: var(--fs-sm); line-height: 1.5; }
.hn-when-date span:first-of-type { align-self: end; font-size: var(--fs-md); font-weight: 600; }
.hn-when-date.is-sample { display: grid; grid-template-columns: none; gap: 2px; }
.hn-when-date.is-sample b { grid-row: auto; font: 600 var(--fs-2xl)/1.2 var(--font-information); letter-spacing: .04em; }
.hn-count { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 12px; border-radius: 999px; background: color-mix(in oklch, var(--ivy-news-green) 11%, transparent); font-size: var(--fs-sm); font-weight: 600; white-space: nowrap; }
.hn-count.is-today::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--ivy-news-green); }
.hn-event-card h3 { font-size: var(--fs-2xl); line-height: 1.4; margin-bottom: 10px; }
.home-news .hn-clause { display: inline-block; }
.home-news .hn-facts { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; margin: 0; font-size: var(--fs-sm); line-height: 1.7; }
.home-news .hn-facts > span { display: inline-flex; align-items: center; gap: 6px; }
.home-news .hn-facts .icon { width: 1.1em; height: 1.1em; }
.home-news .hn-scope { min-height: 24px; padding: 0 9px; border-radius: 999px; box-shadow: inset 0 0 0 1px color-mix(in oklch, currentColor 35%, transparent); font-size: var(--fs-xs); font-weight: 600; }
.home-news .hn-desc { margin: 10px 0 0; font-size: var(--fs-sm); line-height: 1.8; max-width: 36em; }
.home-news .hn-actions, .hn-dialog .hn-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; margin-top: 20px; }
.home-news .hn-link { color: inherit; font-size: var(--fs-sm); font-weight: var(--weight-action); text-decoration: underline; text-underline-offset: 4px; display: inline-flex; gap: 6px; min-height: 44px; align-items: center; }

/* 之後的活動：details 展開（interpolate-size，不支援就直接開合） */
.hn-later { margin-top: 6px; }
.hn-later details { border-top: 1px solid var(--hn-rule); interpolate-size: allow-keywords; color: var(--ivy-news-green); }
.hn-later details:last-child { border-bottom: 1px solid var(--hn-rule); }
.hn-later summary { list-style: none; display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; align-items: center; gap: 14px; min-height: 68px; padding: 10px 0; cursor: pointer; }
.hn-later summary::-webkit-details-marker { display: none; }
.hn-later summary:focus-visible { outline: 2px solid var(--hn-green); outline-offset: 3px; }
.hn-later-date { font: 400 1.375rem/1 var(--font-date); font-variant-numeric: tabular-nums; }
.hn-later-date small { display: block; margin-top: 4px; font: 500 var(--fs-xs)/1 var(--font-information); color: var(--hn-muted); }
.hn-later-date.is-sample { font: 600 var(--fs-sm)/1 var(--font-information); }
.hn-later-copy strong { display: block; font-size: var(--fs-md); font-weight: 600; line-height: 1.5; }
.hn-later-copy small { display: block; font-size: var(--fs-xs); color: var(--hn-muted); }
.hn-later summary .icon { width: 18px; height: 18px; color: var(--hn-muted); }
.hn-later details[open] summary .icon { rotate: 45deg; }
.hn-later-more { padding: 0 0 18px 78px; }
.hn-later-more .hn-desc { margin-top: 4px; color: var(--hn-muted); }
.hn-later-more .hn-actions { margin-top: 8px; }
@media (prefers-reduced-motion: no-preference) {
  .hn-later details::details-content { block-size: 0; overflow: hidden; transition: block-size .45s cubic-bezier(.23, 1, .32, 1), content-visibility .45s allow-discrete; }
  .hn-later details[open]::details-content { block-size: auto; }
  .hn-later summary .icon { transition: rotate .35s ease-out; }
}

/* 校區篩選 */
.hn-filter { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: -6px 0 22px; padding: 0; border: 0; min-width: 0; }
.hn-filter label { position: relative; display: inline-flex; align-items: center; min-height: 44px; cursor: pointer; }
.hn-filter input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
.hn-filter span { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 0 14px; border-radius: 999px; color: var(--ivy-news-green); font-size: var(--fs-sm); font-weight: var(--weight-action); box-shadow: inset 0 0 0 1px rgb(var(--ink) / .14); }
.hn-filter span b { font: 400 var(--fs-sm)/1 var(--font-date); color: var(--hn-muted); }
.hn-filter label:hover span { box-shadow: inset 0 0 0 1px rgb(var(--ink) / .32); }
.hn-filter input:checked + span { background: var(--ivy-news-green); color: var(--paper); box-shadow: none; }
.hn-filter input:checked + span b { color: var(--mint); }
.hn-filter input:focus-visible + span { outline: 2px solid var(--hn-green); outline-offset: 3px; }
@media (prefers-reduced-motion: no-preference) {
  .hn-filter span, .hn-filter span b { transition: background-color .25s ease-out, color .25s ease-out, box-shadow .25s ease-out; }
}

/* 消息：一則大圖＋三列 */
.hn-feed { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(0, 1fr); gap: clamp(28px, 3vw, 44px); align-items: start; view-transition-name: hn-feed; }
.hn-feed.is-single { grid-template-columns: minmax(0, 1fr); max-width: 560px; }
.is-news-only .hn-feed { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: clamp(32px, 4vw, 64px); }
.hn-story { position: relative; color: var(--ivy-news-green); }
.hn-story figure { margin: 0; overflow: hidden; border-radius: 18px; aspect-ratio: 4 / 3; background: var(--ivy-news-note); view-transition-class: hn-media; }
.is-news-only .hn-feature figure { aspect-ratio: 16 / 10; }
.hn-story img { width: 100%; height: 100%; object-fit: cover; }
.hn-story .hn-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; margin: 0; font-size: var(--fs-xs); color: var(--hn-muted); line-height: 1.6; }
.hn-story .hn-meta b { color: var(--ivy-news-green); font-weight: 600; }
.hn-story .hn-meta time { font: 400 var(--fs-sm)/1.6 var(--font-date); font-variant-numeric: tabular-nums; }
.hn-story .hn-meta .hn-sample-tag { margin-left: 0; }
.hn-story h3 { line-height: 1.5; word-break: keep-all; overflow-wrap: anywhere; text-wrap: balance; }
.hn-story h3 a { color: inherit; text-decoration: none; }
.hn-story h3 a::after { content: ''; position: absolute; inset: 0; z-index: 1; }
.hn-story h3 a:focus-visible { outline: 0; }
.hn-story:focus-within { outline: 2px solid var(--hn-green); outline-offset: 6px; border-radius: 18px; }
.hn-story:hover h3 { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 5px; }
.hn-feature .hn-meta { margin: 18px 0 8px; }
.hn-feature .hn-meta time { margin-left: auto; }
.hn-feature h3 { font-size: var(--fs-2xl); }
.hn-feature .hn-desc { color: var(--hn-muted); }
.hn-rows { list-style: none; margin: 0; padding: 0; }
.hn-rows li + li { border-top: 1px solid var(--hn-rule); }
.hn-row { display: grid; grid-template-columns: 124px minmax(0, 1fr); gap: 18px; align-items: center; padding: 16px 0; }
.hn-rows li:first-child .hn-row { padding-top: 0; }
.hn-row figure { border-radius: 12px; }
.hn-row h3 { font-size: 1.0625rem; margin-top: 4px; }
.hn-row .hn-meta time::before { content: '·'; margin-right: 10px; color: var(--hn-rule); }
.hn-row:focus-within { border-radius: 12px; outline-offset: 4px; }
.hn-others { margin: 16px 0 10px; padding-top: 16px; border-top: 1px solid var(--hn-rule); font-size: var(--fs-xs); color: var(--hn-muted); }
.hn-side > .hn-others:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
.hn-others + .hn-rows li:first-child .hn-row { padding-top: 0; }
@media (prefers-reduced-motion: no-preference) {
  .hn-story img { transition: scale 1.2s cubic-bezier(.22, 1, .36, 1); }
  .hn-story:hover img { scale: 1.035; }
}

/* 篩選的 view transition：只有消息區在動（root 不交叉淡化），照片沿自己的位置縮放移動。 */
html:active-view-transition-type(news-filter)::view-transition-old(root),
html:active-view-transition-type(news-filter)::view-transition-new(root) { animation: none; }
::view-transition-old(hn-feed) { animation: hn-fade-out .2s ease-out both; }
::view-transition-new(hn-feed) { animation: hn-fade-in .4s .1s ease-out both; }
::view-transition-group(hn-feed) { animation-duration: .5s; animation-timing-function: cubic-bezier(.23, 1, .32, 1); }
::view-transition-group(.hn-media) { animation-duration: .62s; animation-timing-function: cubic-bezier(.23, 1, .32, 1); }
::view-transition-old(.hn-media), ::view-transition-new(.hn-media) { width: 100%; height: 100%; object-fit: cover; }
::view-transition-new(.hn-media):only-child { animation: hn-media-in .5s cubic-bezier(.23, 1, .32, 1) both; }
::view-transition-old(.hn-media):only-child { animation: hn-media-out .28s ease-out both; }
@keyframes hn-fade-out { to { opacity: 0; } }
@keyframes hn-fade-in { from { opacity: 0; } }
@keyframes hn-media-in { from { opacity: 0; scale: .94; } }
@keyframes hn-media-out { to { opacity: 0; scale: .96; } }

.home-news .hn-stories { display: none; }
/* 沒有任何消息、只列各校粉專時（2026-10-24）：紙頁仍是一整屏高（轉場要蓋滿視窗），內容改垂直置中，
   不在上方擠成一條、下面留半屏空白。手機是 HomeStories 的影片與粉專動態卡，不動。 */
@media (min-width: 641px) {
  .home-news:has(.hn-desk .nf) { display: flex; flex-direction: column; justify-content: center; }
}
@media (max-width: 1100px) {
  .home-news .hn-grid { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; row-gap: 64px; }
  .home-news .hn-next, .home-news .hn-news { grid-row: auto; display: block; }
  .hn-event-card { max-width: 720px; }
}
@media (max-width: 760px) {
  .hn-feed, .is-news-only .hn-feed { grid-template-columns: minmax(0, 1fr); gap: 26px; }
  .hn-feature figure { aspect-ratio: 3 / 2; }
}
/* 640px 以下換成手機動態（HomeStories）。 */
@media (max-width: 640px) {
  .home-news .hn-desk { display: none; }
  .home-news .hn-stories { display: block; }
}
@media (forced-colors: active) {
  .hn-event-card { border: 1px solid CanvasText; }
  .hn-filter input:checked + span { forced-color-adjust: none; background: Highlight; color: HighlightText; }
}

/* 對話框的活動卡：時間地點與相關連結（2026-09-25）、示意活動日期格（2026-09-27）。 */
.hn-event-copy .hn-event-brief { margin: 4px 0 0; color: var(--hn-muted, var(--ivy-news-muted)); }
.hn-event-facts { display: grid; gap: 4px; margin: -4px 0 16px; font-size: var(--fs-sm); }
.hn-event-facts div { display: flex; gap: 12px; }
.hn-event-facts dt { flex-shrink: 0; color: var(--hn-muted); }
.hn-event-facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.hn-dialog .hn-event-link { gap: 12px; white-space: normal; }
.hn-date.is-sample { display: grid; place-content: center; gap: 2px; }
.hn-date.is-sample b { font: 600 var(--fs-md)/1.2 var(--font); letter-spacing: .04em; }
.hn-date.is-sample > span { font: 400 var(--fs-xs)/1.3 var(--font); letter-spacing: 0; white-space: nowrap; }
</style>
