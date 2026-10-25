<script setup lang="ts">
import { responsiveTourImage } from '~/utils/tour-image'
import { campusFacebookPages, isSampleNews, NEWS_PATH, titleClauses } from '~/utils/news-content'
import { campusShort, countdownLabel, dateParts, homeStories, storiesForCampus, storyRings, type HomeStory } from '~/utils/news-home'
import type { Campus, HomeFilm, NewsArticle, NewsEvent } from '~/types/site-content'

/**
 * 首頁手機版的「最新消息」（2026-10-17 方向 3）：活動、消息、活動影片排成一列直式卡，點開是可以連續看的動態
 * （HomeStoryViewer）。取代 09-23 D 的活動影片色帶，影片併進同一列；校區圈從那一校的第一則開始看。
 * 桌機由 NewsDialog 的樣式隱藏，圖片 loading="lazy"，隱藏時不會下載。
 */
const props = defineProps<{
  events: NewsEvent[]
  articles: NewsArticle[]
  films: HomeFilm[]
  campuses: Campus[]
  today: string
  sampleNote: string
}>()

const stories = computed(() => homeStories(props.events, props.articles, props.films))
// 沒有任何消息與活動（只剩活動影片）時，「所有最新消息」連到的也是空頁：改成各校粉專，仍是限動的樣子——
// 校區圈與影片後面的直式卡都連到那一校的 Facebook（另開分頁），不另外列清單（2026-10-24）。
const hasNews = computed(() => props.events.length > 0 || props.articles.length > 0)
const follows = computed(() => (hasNews.value ? [] : campusFacebookPages(props.campuses)))
const rings = computed(() => (hasNews.value ? storyRings(stories.value, props.campuses) : stories.value.length ? [{ key: 'all', label: '全部', count: stories.value.length }] : []))
const showRings = computed(() => rings.value.length + follows.value.length > 1)
const seen = ref(new Set<string>())
const shelf = ref<HTMLElement | null>(null)
const viewer = ref<{ open: (list: HomeStory[], index: number, source: HTMLElement | null) => void } | null>(null)

const TINTS = ['var(--ivy-news-swept-gold)', 'var(--ivy-news-swept-sage)', 'var(--ivy-news-swept-mist)']
const isSample = (item: NewsArticle | NewsEvent) => isSampleNews(item, props.sampleNote)
const sequenceFor = (key: string) => storiesForCampus(stories.value, props.campuses.find((c) => c.key === key))
const ringSeen = (key: string) => sequenceFor(key).every((s) => seen.value.has(s.id))
const campusImage = (campus: Campus, sizes: string) => responsiveTourImage(campus.image, sizes, false, campus.imageMedia)
const campusPosition = (campus: Campus) => campus.imageMedia?.position ?? campus.photoPos ?? undefined
const ringImage = (key: string) => {
  const campus = props.campuses.find((c) => c.key === key)
  return campus ? campusImage(campus, '66px') : {}
}
const ringPosition = (key: string) => {
  const campus = props.campuses.find((c) => c.key === key)
  return campus ? campusPosition(campus) : undefined
}
const filmTitle = (film: HomeFilm) => film.title.replace(/^[^：]*校：/, '')

function openFromCard(story: HomeStory, event: MouseEvent) {
  viewer.value?.open(stories.value, stories.value.indexOf(story), event.currentTarget as HTMLElement)
}
function openRing(key: string, event: MouseEvent) {
  const list = sequenceFor(key)
  if (list.length) viewer.value?.open(list, 0, (event.currentTarget as HTMLElement).querySelector('.hs-ring-face'))
}
function cardFor(id: string) {
  return shelf.value?.querySelector<HTMLElement>(`[data-story="${CSS.escape(id)}"]`) ?? null
}
function markSeen(id: string) {
  seen.value = new Set(seen.value).add(id)
}
</script>

<template>
  <!-- 不另成 landmark：外層 NewsDialog 的 section 已經用「最新消息」命名（axe landmark-unique）。 -->
  <div class="hs">
    <div class="container hs-head">
      <h2 id="home-stories-heading">最新消息</h2>
      <NuxtLink v-if="hasNews" class="hn-more" :to="NEWS_PATH">所有最新消息</NuxtLink>
    </div>
    <ul v-if="showRings" class="hs-rings" aria-label="依校區看">
      <li v-for="ring in rings" :key="ring.key">
        <button type="button" class="hs-ring" :class="{ 'is-seen': ringSeen(ring.key), 'is-all': ring.key === 'all' }" :aria-label="`從${ring.label === '全部' ? '全部' : `${ring.label}校`}開始看，${ring.count} 則`" @click="openRing(ring.key, $event)">
          <span class="hs-ring-face">
            <!-- 「全部」用校徽：和頁首一樣從 logo.webp 裁出徽章那一塊。 -->
            <svg v-if="ring.key === 'all'" viewBox="30 26 124 132" aria-hidden="true" focusable="false"><image href="/assets/logo.webp" width="552" height="192" /></svg>
            <img v-else v-bind="ringImage(ring.key)" :style="ringPosition(ring.key) ? { objectPosition: ringPosition(ring.key) } : undefined" alt="" loading="lazy">
          </span>
          <span>{{ ring.label }}</span>
          <small>{{ ring.count }} 則</small>
        </button>
      </li>
      <li v-for="page in follows" :key="page.key">
        <a class="hs-ring" :href="page.href" target="_blank" rel="noopener noreferrer" :aria-label="`${page.name} Facebook 粉絲專頁（另開分頁）`">
          <span class="hs-ring-face">
            <img v-bind="campusImage(page.campus, '66px')" :style="campusPosition(page.campus) ? { objectPosition: campusPosition(page.campus) } : undefined" alt="" loading="lazy">
          </span>
          <span>{{ campusShort(page.name) }}</span>
          <small>粉專 ↗</small>
        </a>
      </li>
    </ul>
    <ul ref="shelf" class="hs-shelf" aria-label="最新消息、活動與活動影片">
      <li v-for="story in stories" :key="story.id">
        <button
          v-if="story.kind === 'event'" type="button" class="hs-card is-event" :class="{ 'is-seen': seen.has(story.id) }"
          :data-story="story.id" :style="{ '--tint': TINTS[story.tint] }" @click="openFromCard(story, $event)"
        >
          <span class="hs-card-top"><span class="hs-pill">{{ story.event.campus }}</span></span>
          <span v-if="isSample(story.event)" class="hs-event-date is-sample"><b>示意</b><span>日期未定</span></span>
          <span v-else class="hs-event-date"><b>{{ dateParts(story.event.date).day }}</b><span>{{ dateParts(story.event.date).month }} 月・星期{{ dateParts(story.event.date).weekday }}</span></span>
          <span class="hs-card-copy"><small>{{ isSample(story.event) ? '示意活動' : `${countdownLabel(today, story.event.date)}・活動` }}</small><strong><span v-for="(part, k) in titleClauses(story.event.title)" :key="k" class="hs-clause">{{ part }}</span></strong></span>
        </button>
        <button
          v-else-if="story.kind === 'news'" type="button" class="hs-card" :class="{ 'is-seen': seen.has(story.id) }"
          :data-story="story.id" @click="openFromCard(story, $event)"
        >
          <img v-bind="responsiveTourImage(story.article.image, '(max-width: 640px) 60vw, 240px', false, story.article.imageMedia)" :style="story.article.imageMedia?.position ? { objectPosition: story.article.imageMedia.position } : undefined" :alt="story.article.alt" loading="lazy">
          <span class="hs-card-top"><span class="hs-pill">{{ story.article.campus }}</span><span v-if="isSample(story.article)" class="hs-pill">示意</span></span>
          <span class="hs-card-copy"><small>{{ story.article.category }}</small><strong><span v-for="(part, k) in titleClauses(story.article.title)" :key="k" class="hs-clause">{{ part }}</span></strong></span>
        </button>
        <button
          v-else type="button" class="hs-card" :class="{ 'is-seen': seen.has(story.id) }"
          :data-story="story.id" @click="openFromCard(story, $event)"
        >
          <img :src="story.film.poster" alt="" loading="lazy" draggable="false">
          <span class="hs-card-top"><span class="hs-pill">影片</span><span class="hs-play" aria-hidden="true"><svg class="icon"><use href="#i-play" /></svg></span></span>
          <span class="hs-card-copy"><strong>{{ filmTitle(story.film) }}</strong></span>
        </button>
      </li>
      <li v-for="page in follows" :key="page.key">
        <a class="hs-card is-follow" :href="page.href" target="_blank" rel="noopener noreferrer" :aria-label="`${page.name}（${page.district}）Facebook 粉絲專頁（另開分頁）`">
          <img v-bind="campusImage(page.campus, '(max-width: 640px) 60vw, 240px')" :style="campusPosition(page.campus) ? { objectPosition: campusPosition(page.campus) } : undefined" alt="" loading="lazy">
          <span class="hs-card-top"><span class="hs-pill">粉絲專頁</span><span class="hs-play" aria-hidden="true"><svg class="icon"><use href="#i-facebook" /></svg></span></span>
          <span class="hs-card-copy"><small>{{ page.district }}・活動與日常 ↗</small><strong>{{ page.name }}</strong></span>
        </a>
      </li>
      <li v-if="hasNews"><NuxtLink class="hs-card is-more" :to="NEWS_PATH"><svg class="icon" aria-hidden="true"><use href="#i-arrow-right" /></svg>所有最新消息</NuxtLink></li>
    </ul>
    <ClientOnly>
      <HomeStoryViewer ref="viewer" :campuses="campuses" :today="today" :sample-note="sampleNote" :card-for="cardFor" @seen="markSeen" />
    </ClientOnly>
  </div>
</template>

<style>
.hs { --hs-gutter: 20px; padding-bottom: 8px; }
@media (max-width: 400px) { .hs { --hs-gutter: 16px; } }
.hs-head { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.hs-head h2 { color: var(--ivy-news-green); font-size: var(--fs-3xl); line-height: 1.3; }
.home-news .hs-head .hn-more { font-size: var(--fs-sm); }
.hs-rings { display: flex; gap: 16px; margin: 20px 0 22px; padding: 6px var(--hs-gutter, 20px); list-style: none; overflow-x: auto; scrollbar-width: none; }
.hs-rings::-webkit-scrollbar { display: none; }
.hs-rings > li { flex: none; }
.hs-ring { display: grid; text-decoration: none; justify-items: center; gap: 6px; width: 72px; padding: 0; border: 0; background: none; color: var(--ivy-news-green); font: 600 var(--fs-sm)/1.2 var(--font-information); cursor: pointer; }
.hs-ring-face { display: block; width: 62px; height: 62px; padding: 3px; border-radius: 50%; background: var(--ivy-news-paper-blue); box-shadow: 0 0 0 2.5px var(--gold); }
.hs-ring.is-seen .hs-ring-face { box-shadow: 0 0 0 2px var(--ivy-news-rule); }
.hs-ring img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.hs-ring.is-all svg { display: block; width: 100%; height: 100%; padding: 7px; border-radius: 50%; background: var(--white); }
.hs-ring small { font: 400 var(--fs-xs)/1.2 var(--font-information); color: var(--ivy-news-muted); }
.hs-ring:focus-visible { outline: 2px solid var(--ivy-news-green); outline-offset: 4px; border-radius: 12px; }

/* 直式卡列：左邊對齊內容欄，右邊出血到螢幕邊。 */
.hs-shelf { display: flex; gap: 14px; margin: 0; padding: 4px var(--hs-gutter) 20px; list-style: none; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding-inline: var(--hs-gutter); scrollbar-width: none; overscroll-behavior-x: contain; }
.hs-shelf::-webkit-scrollbar { display: none; }
.hs-shelf > li { flex: none; scroll-snap-align: start; }
.hs-card { position: relative; display: grid; width: min(58vw, 236px); aspect-ratio: 5 / 7; padding: 0; border: 0; overflow: hidden; border-radius: 18px; background: var(--ivy-news-note); color: rgb(var(--on-dark)); text-align: start; text-decoration: none; cursor: pointer; isolation: isolate; font: inherit; }
.hs-card > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -2; }
.hs-card:not(.is-event, .is-more)::after { content: ''; position: absolute; inset: 0; z-index: -1; background: linear-gradient(to top, rgb(var(--ivy-news-backdrop-rgb) / .88) 0%, rgb(var(--ivy-news-backdrop-rgb) / .62) 30%, transparent 62%), linear-gradient(to bottom, rgb(var(--ivy-news-backdrop-rgb) / .3), transparent 26%); }
.hs-card:focus-visible { outline: 3px solid var(--ivy-news-green); outline-offset: 3px; }
.hs-card-top { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.hs-pill { display: inline-flex; align-items: center; min-height: 24px; padding: 0 9px; border-radius: 999px; background: var(--ivy-news-swept-gold); color: var(--ivy-news-green); font: 600 var(--fs-xs)/1 var(--font-information); }
.hs-play { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--white); color: var(--ivy-news-green); }
.hs-play .icon { width: 13px; height: 13px; margin-left: 2px; }
.hs-card.is-follow .hs-play .icon { width: 18px; height: 18px; margin-left: 0; }
.hs-card-copy { align-self: end; display: grid; gap: 5px; padding: 14px 14px 16px; }
.hs-card-copy small { font-size: var(--fs-xs); }
.hs-card-copy strong { font: 600 var(--fs-md)/1.5 var(--font-information); word-break: keep-all; overflow-wrap: anywhere; }
.hs-clause { display: inline-block; }
.hs-card.is-event { background: var(--tint); color: var(--ivy-news-green); }
.hs-card.is-event .hs-pill { background: color-mix(in oklch, var(--ivy-news-green) 12%, transparent); }
.hs-event-date { align-self: center; display: grid; gap: 4px; padding: 34px 16px 0; }
.hs-event-date b { font: 400 5.5rem/.8 var(--font-date); letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.hs-event-date span { font: 600 var(--fs-sm)/1.4 var(--font-information); }
.hs-event-date.is-sample b { font: 600 var(--fs-3xl)/1.2 var(--font-information); letter-spacing: .04em; }
.hs-card.is-event .hs-card-copy small { font-weight: 600; }
.hs-card.is-more { place-content: center; justify-items: center; gap: 10px; background: transparent; color: var(--ivy-news-green); box-shadow: inset 0 0 0 1px rgb(var(--ink) / .16); font: 600 var(--fs-sm)/1.4 var(--font-information); }
.hs-card.is-more .icon { width: 28px; height: 28px; }
@media (forced-colors: active) {
  .hs-card { border: 1px solid CanvasText; }
}
</style>
