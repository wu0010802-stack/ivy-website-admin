// 參觀後追蹤的顯示與時間（docs/specs/2026-10-04-admissions-follow-up-design.md 第 6、7 節）。
// 「今天」「逾 N 天」一律用台北日期；快捷時間一律是台北 10:00（同預約明細「下次聯絡」的快捷鍵）。
import { CONTACT_CHANNEL_LABELS, formatWeekday } from '../api/labels'
import { taipeiToday } from './academic'

export const FOLLOW_UP_SCOPES = ['due', 'upcoming', 'unscheduled'] as const
export type FollowUpScope = (typeof FOLLOW_UP_SCOPES)[number]

export function isFollowUpScope(value: unknown): value is FollowUpScope {
  return typeof value === 'string' && (FOLLOW_UP_SCOPES as readonly string[]).includes(value)
}

// 後端 constants.UPCOMING_WINDOW_DAYS。
export const UPCOMING_WINDOW_DAYS = 7

export const FOLLOW_UP_SCOPE_LABELS: Record<FollowUpScope, string> = {
  due: '已到期',
  upcoming: `${UPCOMING_WINDOW_DAYS} 天內`,
  unscheduled: '未排定',
}

export const FOLLOW_UP_EMPTY_TEXT: Record<FollowUpScope, string> = {
  due: '沒有到期要聯絡的家長。',
  upcoming: `接下來 ${UPCOMING_WINDOW_DAYS} 天沒有排定的聯絡。`,
  unscheduled: '還在追的訪視都排好下次聯絡了。',
}

// 「未排定」不算待辦（F-Q1：不是每位家長都會聯絡），清單上方寫明。
export const UNSCHEDULED_HINT = '參觀後還沒排聯絡的家長。不是每位都要聯絡，這裡不算待辦；要追的按「排下次聯絡」。'

// 已註冊、已退出的訪視只能「不用再追」（後端 FOLLOW_UP_NOT_ALLOWED）。
export const CLOSED_STAGE_HINT = '已註冊或已退出的訪視不需要排下次聯絡'

export function isOpenStage(stage: string | null | undefined): boolean {
  return stage === 'visited' || stage === 'deposited'
}

export function channelLabel(code: string | null | undefined): string {
  if (!code) return '—'
  return CONTACT_CHANNEL_LABELS[code] ?? code
}

const TAIPEI_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })

function dayDiff(later: string, earlier: string): number {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000)
}

function shortDay(iso: string): string {
  const [, month = '', day = ''] = iso.split('-')
  return `${month}/${day}`
}

export function isDue(at: string | null | undefined, now: Date = new Date()): boolean {
  if (!at) return false
  const time = Date.parse(at)
  return !Number.isNaN(time) && time <= now.getTime()
}

/**
 * 下次聯絡的簡短寫法：
 * - 已過：昨天以前「逾 N 天」，今天「今天 10:00」。
 * - 還沒到：「今天 15:00」「明天 10:00」「10/08（週三）10:00」。
 * - 沒排：「未排定」。
 */
export function followUpText(at: string | null | undefined, now: Date = new Date()): string {
  if (!at) return '未排定'
  const when = new Date(at)
  if (Number.isNaN(when.getTime())) return at
  const day = taipeiToday(when)
  const diff = dayDiff(day, taipeiToday(now))
  const time = TAIPEI_TIME.format(when)
  if (diff < 0) return `逾 ${-diff} 天`
  if (diff === 0) return `今天 ${time}`
  if (diff === 1) return `明天 ${time}`
  return `${shortDay(day)}（${formatWeekday(day)}）${time}`
}

/** 最近一次聯絡：「10/05・電話・沒聯絡到」；沒有寫「還沒聯絡過」。 */
export function lastContactText(
  at: string | null | undefined,
  channel?: string | null,
  reached?: boolean | null,
): string {
  if (!at) return '還沒聯絡過'
  const parts = [shortDay(taipeiToday(new Date(at)))]
  if (channel) parts.push(channelLabel(channel))
  if (reached !== null && reached !== undefined) parts.push(reached ? '聯絡到了' : '沒聯絡到')
  return parts.join('・')
}

/** 台北日期 N 天後的 10:00（回 ISO 字串，送 API 用）。 */
export function daysLaterAtTen(days: number, now: Date = new Date()): string {
  const [year = 0, month = 1, day = 1] = taipeiToday(now).split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1, day + days))
  const iso = target.toISOString().slice(0, 10)
  return new Date(`${iso}T10:00:00+08:00`).toISOString()
}

function taipeiWeekday(now: Date): number {
  return new Date(`${taipeiToday(now)}T12:00:00Z`).getUTCDay()
}

export type FollowUpShortcut = { key: string; label: string; at: (now?: Date) => string }

export const FOLLOW_UP_SHORTCUTS: FollowUpShortcut[] = [
  { key: 'tomorrow', label: '明天 10:00', at: (now) => daysLaterAtTen(1, now) },
  { key: 'three_days', label: '3 天後', at: (now) => daysLaterAtTen(3, now) },
  { key: 'one_week', label: '1 週後', at: (now) => daysLaterAtTen(7, now) },
  // 週日按「下週一」是明天；週一按是七天後（同預約明細）。
  { key: 'next_monday', label: '下週一', at: (now = new Date()) => daysLaterAtTen((8 - taipeiWeekday(now)) % 7 || 7, now) },
]

/** 負責人顯示：帳號清單（GET /staff）對得到用顯示名稱或 Email；對不到（停用或刪除）寫「（已停用）」。 */
export function ownerLabel(
  ownerId: string | null | undefined,
  staff: { id: string; display_name?: string | null; email: string }[],
  fallbackName?: string | null,
  active?: boolean | null,
): string {
  if (!ownerId) return '未指派'
  const person = staff.find((item) => item.id === ownerId)
  if (person) return person.display_name || person.email
  if (fallbackName) return active === false ? `${fallbackName}（已停用）` : fallbackName
  return '（已停用）'
}

/** 「下次聯絡」選擇：''＝還沒選、快捷鍵的 key、custom＝自選時間、none＝不用再追。 */
export type NextFollowUpChoice = '' | 'custom' | 'none' | (typeof FOLLOW_UP_SHORTCUTS)[number]['key']

/** 選擇 → 送 API 的值：undefined＝還沒選（不能送出）、null＝不用再追、字串＝時間。 */
export function resolveNextFollowUp(choice: NextFollowUpChoice, custom: string | null, now: Date = new Date()): string | null | undefined {
  if (choice === 'none') return null
  if (choice === 'custom') return custom ? new Date(custom).toISOString() : undefined
  const shortcut = FOLLOW_UP_SHORTCUTS.find((item) => item.key === choice)
  return shortcut ? shortcut.at(now) : undefined
}
