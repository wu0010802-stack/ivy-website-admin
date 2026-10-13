import type { components } from '../../../contracts/generated/website-api'

// 場次使用情況的顯示文字與空狀態（2026-10-13 規格 §5）。純函式，畫面元件與測試共用。
export type SlotUsage = components['schemas']['SlotUsageOut']
export type SlotUsageRow = SlotUsage['slots']['rows'][number]

export const BUCKET_LABELS: Record<string, string> = {
  within_1: '明天以前',
  days_2_3: '2–3 天',
  days_4_7: '4–7 天',
  over_7: '超過 7 天',
  none: '沒有場次',
}

export const WEEKDAY_LABELS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'] as const

const hm = (time: string) => time.slice(0, 5)

export function slotLabel(row: Pick<SlotUsageRow, 'weekday' | 'start_time' | 'end_time'>): string {
  return `${WEEKDAY_LABELS[row.weekday] ?? ''} ${hm(row.start_time)}–${hm(row.end_time)}`
}

export function signalText(signal: SlotUsageRow['signal'], minSlots: number): string {
  if (signal === 'often_full') return '常額滿，可以考慮加開'
  if (signal === 'rarely_booked') return '很少人約，可以考慮收掉或縮短'
  if (signal === 'too_few') return `還不到 ${minSlots} 場，還不判斷`
  return '—'
}

const count = (lookups: SlotUsage['lookups'], key: string) => lookups.buckets.find(b => b.key === key)?.count ?? 0

export function lookupSummaryText(campusName: string, lookups: SlotUsage['lookups']): string {
  const none = count(lookups, 'none')
  const beyondWeek = count(lookups, 'over_7') + none
  return `近 4 週家長打開${campusName}預約頁 ${lookups.total} 次，其中 ${beyondWeek} 次 7 天內已經約不到，${none} 次整段沒有場次可選。`
}

export function lookupEmptyText(usage: SlotUsage): string | null {
  const { lookups } = usage
  if (lookups.total > 0) return null
  if (usage.booking_mode !== 'slots') return '目前的預約方式不是自選場次，家長看不到場次。'
  if (lookups.first_recorded_day === null) return '還沒有家長打開預約頁的紀錄。'
  return '近 4 週沒有家長打開預約頁。'
}

export function slotsEmptyText(usage: SlotUsage): string | null {
  return usage.slots.rows.length === 0 ? `近 ${usage.slots.weeks} 週沒有開放的場次。` : null
}

export function usageCsvFilename(campusName: string, weeks: number, today: string): string {
  return `場次使用情況-${campusName}-近${weeks}週-${today.replaceAll('-', '')}.csv`
}
