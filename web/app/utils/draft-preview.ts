// 私有草稿預覽（/preview）的網址參數與消息上下架判斷。
//
// - page：home｜admission｜campus｜visit（預約頁的同意文字與個資說明）
// - viewport=mobile：在頁面中間放一個手機寬度的 iframe 載入同一個預覽
//   （iframe 內帶 embed=1，不再顯示工具列），看得到真正的手機斷行與裁切
// - date=YYYY-MM-DD：用哪一天判斷消息與活動的上架／下架日期，預設台北今天

export type PreviewPage = 'home' | 'admission' | 'campus' | 'visit'
export type PreviewViewport = 'desktop' | 'mobile'

type Query = Record<string, unknown>

/** 手機預覽的寬高（iPhone 14／15 的 CSS 像素）。 */
export const PREVIEW_MOBILE_WIDTH = 390
export const PREVIEW_MOBILE_HEIGHT = 844

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function previewPage(query: Query): PreviewPage {
  const page = text(query.page)
  return page === 'admission' || page === 'campus' || page === 'visit' ? page : 'home'
}

export function previewViewport(query: Query): PreviewViewport {
  return text(query.viewport) === 'mobile' ? 'mobile' : 'desktop'
}

export function isPreviewEmbed(query: Query): boolean {
  return text(query.embed) === '1'
}

/** 合法的 YYYY-MM-DD 才採用，其餘退回今天。 */
export function previewDate(query: Query, today: string): string {
  const value = text(query.date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return today
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? today : value
}

/** 手機 iframe 的網址：同一個預覽（頁面、校區、日期），加 embed=1、拿掉 viewport。 */
export function previewFrameSrc(query: Query): string {
  const params = new URLSearchParams()
  for (const key of ['page', 'campus', 'date']) {
    const value = text(query[key])
    if (value) params.set(key, value)
  }
  params.set('embed', '1')
  return `/preview?${params.toString()}`
}

interface ScheduledEntry {
  title?: unknown
  show_from?: unknown
  show_until?: unknown
  [key: string]: unknown
}

export interface HiddenNewsEntry {
  type: 'article' | 'event'
  title: string
  reason: string
}

/** 與後端 content/schemas.py 的 is_scheduled_visible 相同：日期含當天。 */
export function scheduledVisible(entry: ScheduledEntry, date: string): boolean {
  const from = text(entry.show_from)
  const until = text(entry.show_until)
  if (from && date < from) return false
  if (until && date > until) return false
  return true
}

function hiddenReason(entry: ScheduledEntry, date: string): string {
  const from = text(entry.show_from)
  return from && date < from ? `${from} 才上架` : `${text(entry.show_until)} 已下架`
}

function splitEntries(entries: unknown, type: HiddenNewsEntry['type'], date: string, hidden: HiddenNewsEntry[]): ScheduledEntry[] {
  if (!Array.isArray(entries)) return []
  const visible: ScheduledEntry[] = []
  for (const raw of entries as ScheduledEntry[]) {
    if (scheduledVisible(raw, date)) {
      // 官網公開內容不帶上下架日期，預覽也一樣拿掉。
      const { show_from: _from, show_until: _until, ...rest } = raw
      visible.push(rest)
    } else {
      hidden.push({ type, title: text(raw.title) || '（未命名）', reason: hiddenReason(raw, date) })
    }
  }
  return visible
}

/**
 * 草稿的最新消息依預覽日期過濾，和官網公開時一樣：還沒到上架日、或已過
 * 下架日的消息與活動不顯示，另外回傳被藏起來的清單給預覽工具列標示。
 */
export function scheduleNewsDraft<T extends Record<string, unknown>>(payload: T, date: string): { payload: T; hidden: HiddenNewsEntry[] } {
  const hidden: HiddenNewsEntry[] = []
  const articles = splitEntries(payload.articles, 'article', date, hidden)
  const events = splitEntries(payload.events, 'event', date, hidden)
  return { payload: { ...payload, articles, events }, hidden }
}
