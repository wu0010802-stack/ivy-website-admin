// 參觀案件列表的網址與 API 條件（2026-10-06 方向 B）。網址的鍵沿用 group（舊連結：總覽、成效統計、
// 招生看板、書籤），值改成接待頁籤；API 用 view（後端 status_groups.view_condition）。
// 規則：完全沒有參數＝接下來；有其他參數卻沒有（或不認得的）group＝改版前的連結，當時沒有 group
// 就是「全部」，舊的 ?status= 照狀態對到頁籤。寫回網址時只有「接下來＋沒有其他條件」省略 group。
import type { LocationQuery } from 'vue-router'
import { VISIT_SOURCE_LABELS, VISIT_VIEWS, VISIT_VIEW_LABELS, legacyStatusView, type VisitView } from './labels'

export type ListTab = VisitView | 'all'
export const LIST_TABS: readonly ListTab[] = [...VISIT_VIEWS, 'all']
export const LIST_TAB_LABELS: Record<ListTab, string> = { ...VISIT_VIEW_LABELS, all: '全部' }
export const DEFAULT_TAB: ListTab = 'upcoming'

/** visit＝依頁籤的參觀時間（預設，網址不寫）；newest／oldest＝送出時間（舊的排序，網址寫 order=）。 */
export type ListOrder = 'visit' | 'newest' | 'oldest'
export type ApiOrder = 'newest' | 'oldest' | 'visit_asc' | 'visit_desc'

export interface ListState {
  tab: ListTab
  /** 時間已過裡還沒標記到場的（網址 group=past&status=confirmed，總覽與統計的連結） */
  attendanceOnly: boolean
  q: string
  campus: string
  open: boolean
  source: string
  created: [string, string] | null
  due: boolean
  attention: boolean
  order: ListOrder
  page: number
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export function tabFromQuery(query: LocationQuery): ListTab {
  const group = text(query.group)
  if ((LIST_TABS as readonly string[]).includes(group)) return group as ListTab
  if (!group && Object.keys(query).length === 0) return DEFAULT_TAB
  return legacyStatusView(text(query.status)) || 'all'
}

export function parseListQuery(query: LocationQuery, scope: { campusKeys: readonly string[]; multiCampus: boolean }): ListState {
  const tab = tabFromQuery(query)
  const campus = text(query.campus)
  const source = text(query.source)
  const from = text(query.created_from)
  const to = text(query.created_to)
  const order = text(query.order)
  const page = Number(text(query.page))
  return {
    tab,
    attendanceOnly: tab === 'past' && query.status === 'confirmed',
    q: text(query.q),
    // 只負責一校的帳號沒有校區篩選（看得到的就是那一校）。
    campus: scope.multiCampus && scope.campusKeys.includes(campus) ? campus : '',
    open: query.open === '1',
    source: VISIT_SOURCE_LABELS[source] ? source : '',
    created: DATE_RE.test(from) && DATE_RE.test(to) ? [from, to] : null,
    due: query.due === '1',
    attention: query.attention === '1',
    order: order === 'newest' || order === 'oldest' ? order : 'visit',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  }
}

export function listStateQuery(s: ListState): Record<string, string> {
  const query: Record<string, string> = {}
  if (s.attendanceOnly) query.status = 'confirmed'
  if (s.q.trim()) query.q = s.q.trim()
  if (s.campus) query.campus = s.campus
  if (s.open) query.open = '1'
  if (s.source) query.source = s.source
  if (s.created) {
    query.created_from = s.created[0]
    query.created_to = s.created[1]
  }
  if (s.due) query.due = '1'
  if (s.attention) query.attention = '1'
  if (s.order !== 'visit') query.order = s.order
  if (s.page > 1) query.page = String(s.page)
  if (s.tab !== DEFAULT_TAB || Object.keys(query).length > 0) query.group = s.tab
  return query
}

// 家長報的電話常帶空格、連字號或國碼（0912-345-678、+886 912 345 678），資料庫存的是
// 10 碼純數字；搜尋字看起來像電話就先去掉符號再查，匯出也一樣。
// 還在打國碼或前幾碼（+886、+88、09-）時照原字查：只剩「0」「88」會查出幾乎每一筆。
export function searchTerm(raw: string): string {
  const value = raw.trim()
  if (!/^[\d\s()+-]+$/.test(value)) return value
  const digits = value.replace(/\D/g, '')
  // 國碼可能帶「+」或沒帶（886912345678）；沒帶的要夠長才算，免得把號碼片段當國碼。
  if (value.startsWith('+886') || (digits.startsWith('886') && digits.length >= 11)) {
    const local = digits.slice(3).replace(/^0/, '')
    return local.length >= 3 ? `0${local}` : value
  }
  return digits.length >= 4 ? digits : value
}

/** 清單、匯出與件數送同一組篩選：畫面上篩好什麼，匯出的就是那一批。counts：頁籤上的數字，不帶頁籤與狀態。 */
export function listApiParams(s: ListState, options: { counts?: boolean } = {}): URLSearchParams {
  const params = new URLSearchParams()
  if (s.campus) params.set('campus_key', s.campus)
  if (!options.counts) {
    if (s.tab !== 'all') params.set('view', s.tab)
    if (s.attendanceOnly) params.set('status', 'confirmed')
  }
  const term = searchTerm(s.q)
  if (term) params.set('q', term)
  if (s.due) params.set('follow_up_due', 'true')
  if (s.open) params.set('open', 'true')
  if (s.source) params.set('source', s.source)
  if (s.created) {
    params.set('created_from', s.created[0])
    params.set('created_to', s.created[1])
  }
  if (s.attention) params.set('needs_attention', 'true')
  return params
}

/** 行程清單依參觀時間：接下來由近到遠，其他頁籤由近往回；選了送出時間就照送出時間。 */
export function listApiOrder(s: Pick<ListState, 'tab' | 'order'>): ApiOrder {
  if (s.order !== 'visit') return s.order
  return s.tab === 'upcoming' ? 'visit_asc' : 'visit_desc'
}

/** 依參觀時間排序時才分日期組；照送出時間排就是一條平鋪的清單。 */
export const groupsByDay = (s: Pick<ListState, 'order'>): boolean => s.order === 'visit'
