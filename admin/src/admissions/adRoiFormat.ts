import { AD_PLATFORM_LABELS } from '../api/labels'
import type { AdRoiPending, AdRoiRow } from '../api/types'
import { NO_VALUE } from './statsFormat'

// 廣告成效（2026-11-16）的顯示規則。
export const AD_ROW_LABELS: Record<AdRoiRow['key'], string> = {
  google: AD_PLATFORM_LABELS.google!,
  openai: AD_PLATFORM_LABELS.openai!,
  meta: AD_PLATFORM_LABELS.meta!,
  line: AD_PLATFORM_LABELS.line!,
  other: AD_PLATFORM_LABELS.other!,
  unknown: '廣告（平台不明）',
  offline: '離線花費',
  organic: '非廣告來源',
  unrecorded: '沒有來源紀錄',
}

/** 手填花費的平台（Google 由 GA4 讀，不能手填）。 */
export const AD_SPEND_PLATFORMS = ['openai', 'meta', 'line', 'other', 'offline'] as const

/** 資料從這個月開始才有（官網預約帶廣告標記的起點）。 */
export const AD_ROI_FIRST_MONTH = '2026-11'

const money = (value: number) => Math.round(value).toLocaleString('en-US')

export function costText(value: number | null): string {
  return value === null ? NO_VALUE : money(value)
}

/** 成本格：沒有值是破折號；只算了有填花費月份的列（cost_partial）在數字後加「＊」。 */
export function costCellText(value: number | null, partial: boolean): string {
  return value === null ? NO_VALUE : `${money(value)}${partial ? PARTIAL_MARK : ''}`
}

export const PARTIAL_MARK = '＊'
export const PARTIAL_NOTE = '＊ 只算有填花費的月份。'

/** Google 花費依 GA4 資源的時區切月份；不是台北時才提醒（null 不提）。 */
export function googleZoneNote(timeZone: string | null): string {
  return timeZone && timeZone !== 'Asia/Taipei' ? `Google 花費依 ${timeZone} 切月份。` : ''
}

/** 各校格：預約 / 到場 / 預繳。 */
export function campusCellText(cell: { cases: number; completed: number; deposited: number } | undefined): string {
  return cell ? `${cell.cases} / ${cell.completed} / ${cell.deposited}` : NO_VALUE
}

export function spendText(row: AdRoiRow, currency: string | null): string {
  switch (row.spend_state) {
    case 'not_configured': return '未設定'
    case 'error': return '讀取失敗'
    case 'unset': return '未填'
    case 'none': return NO_VALUE
  }
  if (row.spend === null) return NO_VALUE
  let text = money(row.spend)
  if (row.missing_months > 0) text += `（缺 ${row.missing_months} 個月）`
  if (row.key === 'google' && currency && currency !== 'TWD') text += `（${currency}）`
  return text
}

export function pendingText(pending: AdRoiPending): string {
  const parts: string[] = []
  if (pending.upcoming) parts.push(`${pending.upcoming} 筆還沒到參觀日`)
  if (pending.awaiting_attendance) parts.push(`${pending.awaiting_attendance} 筆還沒標記到場`)
  if (pending.considering) parts.push(`${pending.considering} 筆到場後還在考慮`)
  return parts.length ? `廣告帶來的預約中，另有 ${parts.join('、')}。` : ''
}

function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number) as [number, number]
  const index = year * 12 + (mon - 1) + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** 預設區間：本月往前 11 個月，但不早於資料起點 2026-11。today 是台北日期 YYYY-MM-DD。 */
export function defaultMonthRange(today: string): { from: string; to: string } {
  const to = today.slice(0, 7)
  const back = shiftMonth(to, -11)
  return { from: back > AD_ROI_FIRST_MONTH ? back : AD_ROI_FIRST_MONTH, to }
}
