import type { Campus, NewsArticle, NewsContent, NewsEvent } from '../types/site-content'

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** 活動日期牌上的英文月份，由 YYYY-MM-DD 推出；後台只存日期，不另存月份。 */
export function newsMonth(date: string): string {
  return MONTHS[Number(date.slice(5, 7)) - 1] ?? ''
}

/** 台北時區的今天（YYYY-MM-DD）。伺服器在 UTC，不能直接用 toISOString。 */
export function taipeiToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/**
 * 首頁輪播的消息（2026-09-25 業主裁定）：有任何推薦的消息時，只輪播推薦的，
 * 依後台清單順序；完全沒有推薦時照舊依日期新到舊。再依後台設定的顯示筆數截斷。
 */
export function homeArticles(articles: readonly NewsArticle[], count?: number | null): NewsArticle[] {
  const featured = articles.filter((item) => item.featured)
  const list = featured.length ? featured : sortedArticles(articles)
  return count && count > 0 ? list.slice(0, count) : list
}

/** 活動時間的顯示文字：全天、09:30–11:00，或只有開始時間的「09:30 開始」。 */
export function eventTimeText(event: Pick<NewsEvent, 'allDay' | 'startTime' | 'endTime'>): string {
  if (event.allDay !== false || !event.startTime) return '全天'
  return event.endTime ? `${event.startTime}–${event.endTime}` : `${event.startTime} 開始`
}

/**
 * 活動卡片與詳細頁要寫出來的時間：只有園方填了開始時間才寫，其餘回空字串。
 * 「全天」是後台勾選框的預設值，舊活動也一律當全天，不能據此替園方寫「全天」。
 */
export function eventTimeDetail(event: Pick<NewsEvent, 'allDay' | 'startTime' | 'endTime'>): string {
  return event.allDay === false && event.startTime ? eventTimeText(event) : ''
}

/**
 * 這一則是不是原型示意內容：疊上後台內容時每則都有 sample（各校消息一律不是）；
 * 純 fixture 沒有逐則標記，沿用整份的示意說明（sampleNote 有值＝全部示意）。
 */
export function isSampleNews(item: Pick<NewsArticle, 'sample'>, sampleNote: string): boolean {
  return item.sample ?? Boolean(sampleNote)
}

/**
 * 拿掉內建的示意消息與活動（2026-10-24 質感審查，使用者裁定）：後台還沒發布全站消息時，正式站原本沿用
 * fixture 的示意內容並標「示意內容」，首頁就停在「設計示意｜…均為範例」這行接頁尾，家長會懷疑整個網站。
 * 只留真實的（各校自己發布的消息一律不是示意）；全部拿掉時示意說明一併清空，首頁與 /news 改顯示各校粉專。
 */
export function withoutSampleNews(news: NewsContent): NewsContent {
  return {
    ...news,
    sampleNote: '',
    articles: news.articles.filter((item) => !isSampleNews(item, news.sampleNote)),
    events: news.events.filter((item) => !isSampleNews(item, news.sampleNote))
  }
}

/** 一份清單裡示意內容的多寡：all＝整區在標題標一次；some＝混著真實消息，逐則標。 */
export type SampleCoverage = 'all' | 'some' | 'none'

export function sampleCoverage(list: readonly Pick<NewsArticle, 'sample'>[], sampleNote: string): SampleCoverage {
  const count = list.filter((item) => isSampleNews(item, sampleNote)).length
  return count === 0 ? 'none' : count === list.length ? 'all' : 'some'
}

/** 消息列表頁（2026-09-26 開放獨立網址）。 */
export const NEWS_PATH = '/news'

/**
 * 單篇消息的網址。各校消息的 id 已加上校區前綴（`yihua:open-day`），和全站消息不會撞號；
 * 後台 id 可以是任何文字，一律 encodeURIComponent。
 */
export function newsPath(id: string): string {
  return `${NEWS_PATH}/${encodeURIComponent(id)}`
}

/** 依網址參數找消息（Nuxt 的路由參數已解碼）；找不到回 undefined，頁面回 404。 */
export function findArticle(articles: readonly NewsArticle[], id: string): NewsArticle | undefined {
  return articles.find((item) => item.id === id)
}

/** 可以給搜尋引擎的消息：示意內容不收錄（2026-09-26 使用者裁定）。 */
export function indexableArticles(articles: readonly NewsArticle[], sampleNote: string): NewsArticle[] {
  return sortedArticles(articles).filter((item) => !isSampleNews(item, sampleNote))
}

/**
 * 這一則（消息或活動）適不適用某一校。後台內容一定帶 campusKeys（空陣列＝全校，舊版手打的校區文字也是空陣列），
 * 照舊：全校在每一校都看得到。內建示意消息沒有 campusKeys、只有顯示用的校名（「義華校」「全校」）：
 * 原本一律當全校，/news?campus=yihua 標題寫「義華校的消息」卻列出另外四校的示意消息（2026-10-13），
 * 沒有 campusKeys 時改比對校名——「全校」、空白或校名清單裡有這一校才算；沒給校名時照舊都算。
 */
export function newsInCampus(item: Pick<NewsArticle, 'campus' | 'campusKeys'>, campusKey: string, campusName?: string): boolean {
  if (item.campusKeys) return !item.campusKeys.length || item.campusKeys.includes(campusKey)
  const names = item.campus.split('、').map((name) => name.trim()).filter(Boolean)
  return !campusName || !names.length || names.includes('全校') || names.includes(campusName)
}

/** 列表頁的校區篩選：全校消息（campusKeys 空）在每一校都看得到；沒有 campusKeys 的內建消息比對校名（見 newsInCampus）。 */
export function articlesForCampus(articles: readonly NewsArticle[], campusKey: string | undefined, campusName?: string): NewsArticle[] {
  const list = sortedArticles(articles)
  if (!campusKey) return list
  return list.filter((item) => newsInCampus(item, campusKey, campusName))
}

/**
 * 標題依句中的「，、；！？」切成幾段（標點留在前一段尾），畫面上每段包成 inline-block：
 * 手機寬度放得下一段時就在標點後換行，不會斷成「小小園丁，把好／奇心種進生活裡。」（2026-10-13，390／320 實測）。
 * 一段比一行長時 inline-block 內部照常折行（沿用 h1–h3 的 balance）；沒有句中標點時回傳整句一段。
 */
export function titleClauses(title: string): string[] {
  const parts = title.match(/[^，、；！？]*[，、；！？]+|[^，、；！？]+$/g)
  return parts && parts.join('') === title ? parts : [title]
}

/** 只放行 http／https 的完整網址（後端已驗證，這裡再擋一次才綁進 href）。 */
export function safeWebUrl(url: string | undefined | null): string {
  const value = (url ?? '').trim()
  return /^https?:\/\/\S+$/i.test(value) ? value : ''
}

/** 有 Facebook 粉專的校區（網址不是 http(s) 的略過）：沒有消息時的空狀態用，桌機列表、手機動態卡都讀這份。 */
export function campusFacebookPages(campuses: readonly Campus[]) {
  return campuses.flatMap((campus) => {
    const href = safeWebUrl(campus.facebook)
    return href ? [{ campus, key: campus.key, name: campus.name, district: campus.district, href }] : []
  })
}

/** 消息依日期新到舊；同一天保留後台排列順序。 */
export function sortedArticles(articles: readonly NewsArticle[]): NewsArticle[] {
  return articles.map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.date.localeCompare(a.item.date) || a.index - b.index)
    .map(({ item }) => item)
}

/** 「近期活動」只列今天（含）以後的活動，依日期近到遠；過期活動自動下架，不用等人手動刪。 */
export function upcomingEvents(events: readonly NewsEvent[], today: string): NewsEvent[] {
  return events.map((item, index) => ({ item, index }))
    .filter(({ item }) => item.date >= today)
    .sort((a, b) => a.item.date.localeCompare(b.item.date) || a.index - b.index)
    .map(({ item }) => item)
}
