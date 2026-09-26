import type { NewsArticle, NewsEvent } from '../types/site-content'

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

/** 列表頁的校區篩選：全校消息（campusKeys 空）在每一校都看得到。 */
export function articlesForCampus(articles: readonly NewsArticle[], campusKey: string | undefined): NewsArticle[] {
  const list = sortedArticles(articles)
  if (!campusKey) return list
  return list.filter((item) => !item.campusKeys?.length || item.campusKeys.includes(campusKey))
}

/** 只放行 http／https 的完整網址（後端已驗證，這裡再擋一次才綁進 href）。 */
export function safeWebUrl(url: string | undefined | null): string {
  const value = (url ?? '').trim()
  return /^https?:\/\/\S+$/i.test(value) ? value : ''
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
