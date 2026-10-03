// 成效統計補強（2026-09-30 招生分析報告階段 1）的 API 與顯示規則。
// 後端：backend/app/operations/booking_outcomes_service.py、analytics_service.get_event_trend。
import { api } from './client'
import type { AdmissionsRate, BookingOutcomesOut, ClassDistributionOut, EventTrendOut } from './types'
import { NO_VALUE, formatRate } from '../admissions/statsFormat'

export interface DateRange {
  from: string
  to: string
}

// 2026-10-01 起家長自選場次：官網送出即預約成功，同時記「已送出需求」與「已確認預約」。
export const SELF_BOOKING_SINCE = '2026-10-01'
// 分母少於這個數時提示「樣本較少」（報告 3.3：只是介面提示門檻，不代表統計顯著）。
export const SMALL_SAMPLE = 20

/** 期間的比較鍵：父層每次重算 range 物件，用字串判斷是不是真的換了期間。 */
export function rangeKey(range: DateRange | null): string {
  return range ? `${range.from}~${range.to}` : 'all'
}

function withQuery(path: string, params: Record<string, string>, range: DateRange | null): string {
  const query = new URLSearchParams(params)
  if (range) {
    query.set('from', range.from)
    query.set('to', range.to)
  }
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

export function getBookingOutcomes(range: DateRange | null): Promise<BookingOutcomesOut> {
  return api.get<BookingOutcomesOut>(withQuery('/admin/analytics/booking-outcomes', {}, range))
}

export function getEventTrend(campusKey: string, range: DateRange | null): Promise<EventTrendOut> {
  return api.get<EventTrendOut>(withQuery('/admin/analytics/event-trend', { campus_key: campusKey }, range))
}

export function getClassDistribution(campusKey: string, schoolYear: number, range: DateRange | null): Promise<ClassDistributionOut> {
  return api.get<ClassDistributionOut>(
    withQuery('/admin/analytics/class-distribution', { campus_key: campusKey, school_year: String(schoolYear) }, range),
  )
}

/** 「66.7%（2/3）」；分母 0 寫「—」（報告 3.3「—／無可計算資料」）。格式同招生入學統計。 */
export function rateText(rate: AdmissionsRate): string {
  return rate.denominator ? `${formatRate(rate.value)}（${rate.numerator}/${rate.denominator}）` : NO_VALUE
}

export function isSmallSample(rate: AdmissionsRate): boolean {
  return rate.denominator > 0 && rate.denominator < SMALL_SAMPLE
}

// 待處理三種（backend/app/booking/pending_kinds.py）。順序同總覽「下一筆」：待標記到場 → 到期追蹤 → 舊資料。
export type PendingKind = 'legacy_pending' | 'awaiting_attendance' | 'follow_up_due'
export const PENDING_KINDS: readonly PendingKind[] = ['awaiting_attendance', 'follow_up_due', 'legacy_pending']
export const PENDING_KIND_LABELS: Record<PendingKind, string> = {
  awaiting_attendance: '參觀時間過了，還沒標記到場',
  follow_up_due: '到期待追蹤',
  legacy_pending: '舊資料的待處理',
}

/** 點進案件列表、已套好篩選；參數和總覽（DashboardView）同一組，列表會保留子篩選。 */
export function pendingLink(kind: PendingKind, campusKey: string): string {
  const query = new URLSearchParams({ campus: campusKey })
  if (kind === 'awaiting_attendance') {
    query.set('group', 'past')
    query.set('status', 'confirmed')
  } else if (kind === 'follow_up_due') {
    query.set('due', '1')
  } else {
    query.set('group', 'pending')
  }
  return `/visit-requests?${query}`
}
