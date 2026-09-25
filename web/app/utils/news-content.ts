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
