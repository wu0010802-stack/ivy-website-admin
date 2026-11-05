// 系統狀態頁「錯誤回報」區塊的文字與時間顯示（2026-11-05）。資料形狀見 backend/app/operations/error_reports.py。
import { formatDateTime } from '../api/labels'
import type { ErrorGroupOut } from '../api/types'

export type ErrorStatusFilter = 'open' | 'resolved' | 'all'

export const ERROR_SOURCE_LABELS: Record<ErrorGroupOut['source'], string> = { web: '官網', admin: '後台', api: 'API' }

export const ERROR_STATUS_TABS: { key: ErrorStatusFilter; label: string }[] = [
  { key: 'open', label: '未處理' },
  { key: 'resolved', label: '已處理' },
  { key: 'all', label: '全部' },
]

/** 「剛剛」「5 分鐘前」「3 小時前」「2 天前」；超過 30 天直接寫日期時間。時鐘差造成的未來時間當成剛剛。 */
export function formatRelativeTime(value: string | null | undefined, now: number = Date.now()): string {
  if (!value) return '—'
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return value
  const minutes = Math.floor(Math.max(0, now - time) / 60_000)
  if (minutes < 1) return '剛剛'
  if (minutes < 60) return `${minutes} 分鐘前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小時前`
  const days = Math.floor(hours / 24)
  return days <= 30 ? `${days} 天前` : formatDateTime(value)
}

/** 一組錯誤的標題：「TypeError：x is not a function」；沒有訊息就只寫錯誤名稱。 */
export function errorTitle(item: Pick<ErrorGroupOut, 'kind' | 'message'>): string {
  return item.message ? `${item.kind}：${item.message}` : item.kind
}
