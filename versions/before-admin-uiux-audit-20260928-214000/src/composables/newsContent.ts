// 消息與活動（全站 home_news、各校 campus_news）與共用常見問題編輯頁共用的
// 欄位預設值、舊資料換算與檢查。規則與後端 content/schemas.py 相同，前端先
// 提示，真正的驗證仍在後端。
import { CAMPUS_LABELS } from '../api/labels'
import type {
  CampusNewsArticlePayload,
  CampusNewsEventPayload,
  ContentScope,
  NewsArticlePayload,
  NewsBodyBlock,
  NewsEventPayload,
  ScopedEntry,
} from '../api/types'

export const CAMPUS_KEYS = Object.keys(CAMPUS_LABELS)

/** 後端上限（content/schemas.py） */
export const NEWS_LIMITS = {
  homeArticles: 30,
  homeEvents: 12,
  campusArticles: 12,
  campusEvents: 12,
  bodyBlocks: 40,
  displayCount: 30,
} as const

export type NewsMode = 'global' | 'campus'

export function taipeiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export function newId(prefix: string): string {
  // 後端要求同一清單內 id 不重複；同一毫秒連按兩次也不能撞號。
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** 2026-09-25 以前的消息只有手打的校區文字：認得的校名換成那一校，其他當全校（同後端）。 */
export function legacyScope(label: unknown): ScopedEntry {
  const text = typeof label === 'string' ? label.trim() : ''
  const key = CAMPUS_KEYS.find((k) => `${CAMPUS_LABELS[k]}校` === text)
  return key ? { scope: 'campus', campus_keys: [key] } : { scope: 'global', campus_keys: [] }
}

function scopeOf(raw: Record<string, unknown>): ScopedEntry {
  if (raw.scope === 'global' || raw.scope === 'campus') {
    return { scope: raw.scope as ContentScope, campus_keys: Array.isArray(raw.campus_keys) ? [...(raw.campus_keys as string[])] : [] }
  }
  return legacyScope(raw.campus)
}

/** 「全校」或「義華校、仁武校」 */
export function scopeLabel(entry: ScopedEntry): string {
  if (entry.scope !== 'campus' || !entry.campus_keys.length) return '全校'
  return entry.campus_keys.map((key) => `${CAMPUS_LABELS[key] ?? key}校`).join('、')
}

export function scopeInvalid(entry: ScopedEntry): boolean {
  return entry.scope === 'campus' && entry.campus_keys.length === 0
}

function withoutLegacyCampus<T extends Record<string, unknown>>(raw: T): T {
  const { campus: _campus, ...rest } = raw
  return rest as T
}

export function normalizeCampusArticle(raw: Partial<CampusNewsArticlePayload> & Record<string, unknown>): CampusNewsArticlePayload {
  const { scope: _s, campus_keys: _k, featured: _f, ...rest } = withoutLegacyCampus(raw)
  return {
    id: '', date: '', category: '', title: '', description: '', image: '', alt: '',
    ...rest,
    body: Array.isArray(raw.body) ? (raw.body as NewsBodyBlock[]).map(normalizeBlock) : [],
  } as CampusNewsArticlePayload
}

export function normalizeArticle(raw: Partial<NewsArticlePayload> & Record<string, unknown>): NewsArticlePayload {
  const { featured, ...base } = raw
  return { ...normalizeCampusArticle(base), ...scopeOf(raw), featured: Boolean(featured) }
}

export function normalizeCampusEvent(raw: Partial<CampusNewsEventPayload> & Record<string, unknown>): CampusNewsEventPayload {
  const { scope: _s, campus_keys: _k, ...rest } = withoutLegacyCampus(raw)
  return {
    id: '', date: '', title: '', description: '',
    all_day: true, start_time: null, end_time: null, location: '', link_url: '', link_label: '',
    ...rest,
  } as CampusNewsEventPayload
}

export function normalizeEvent(raw: Partial<NewsEventPayload> & Record<string, unknown>): NewsEventPayload {
  return { ...normalizeCampusEvent(raw), ...scopeOf(raw) }
}

export function normalizeBlock(block: NewsBodyBlock): NewsBodyBlock {
  switch (block.type) {
    case 'list':
      return { type: 'list', items: [...(block.items ?? [])], ordered: Boolean(block.ordered) }
    case 'image':
      return { type: 'image', image: block.image ?? '', alt: block.alt ?? '', caption: block.caption ?? '' }
    default:
      return { ...block }
  }
}

export function newCampusArticle(): CampusNewsArticlePayload {
  return { id: newId('news'), date: taipeiToday(), category: '', title: '', description: '', body: [], image: '', alt: '' }
}

export function newArticle(): NewsArticlePayload {
  return { ...newCampusArticle(), scope: 'global', campus_keys: [], featured: false }
}

export function newCampusEvent(): CampusNewsEventPayload {
  return {
    id: newId('event'), date: taipeiToday(), title: '', description: '',
    all_day: true, start_time: null, end_time: null, location: '', link_url: '', link_label: '',
  }
}

export function newEvent(): NewsEventPayload {
  return { ...newCampusEvent(), scope: 'global', campus_keys: [] }
}

export function newBlock(type: NewsBodyBlock['type']): NewsBodyBlock {
  switch (type) {
    case 'list':
      return { type, items: [''], ordered: false }
    case 'image':
      return { type, image: '', alt: '', caption: '' }
    case 'link':
      return { type, label: '', url: '' }
    default:
      return { type, text: '' }
  }
}

export const BLOCK_LABELS: Record<NewsBodyBlock['type'], string> = {
  paragraph: '段落',
  heading: '小標',
  list: '清單',
  image: '圖片',
  link: '連結',
}

/** http／https 的完整網址（空白不算錯，由呼叫端決定要不要必填） */
export function webUrlInvalid(url: string): boolean {
  const value = url.trim()
  return value !== '' && !/^https?:\/\/\S+$/i.test(value)
}

/** 連結欄位的錯誤提示（規則同 webUrlInvalid 與後端 _require_web_url）；沒問題回空字串 */
export function webUrlError(url: string): string {
  if (!webUrlInvalid(url)) return ''
  return /^https?:\/\/\S*\s/i.test(url.trim()) ? '網址中間不能有空白' : '網址要以 https:// 或 http:// 開頭'
}

/** 活動時間：不是全天要有開始時間，結束要晚於開始 */
export function eventTimeError(event: CampusNewsEventPayload): string {
  if (event.all_day) return ''
  if (!event.start_time) return '不是全天的活動要填開始時間'
  if (event.end_time && event.end_time <= event.start_time) return '結束時間要晚於開始時間'
  return ''
}

// 上下架日期與後端 is_scheduled_visible 同一個規則：兩端都含當天。
export function scheduleState(entry: { show_from?: string | null; show_until?: string | null }, today = taipeiToday()): 'upcoming' | 'expired' | '' {
  if (entry.show_from && today < entry.show_from) return 'upcoming'
  if (entry.show_until && today > entry.show_until) return 'expired'
  return ''
}

export function scheduleInvalid(entry: { show_from?: string | null; show_until?: string | null }): boolean {
  return Boolean(entry.show_from && entry.show_until && entry.show_until < entry.show_from)
}

/** 陣列裡的一項往上或往下移一格（超出範圍不動） */
export function moveItem<T>(list: T[], index: number, delta: number): void {
  const target = index + delta
  if (target < 0 || target >= list.length) return
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item!)
}
