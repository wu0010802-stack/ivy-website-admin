import { GRADES } from './constants'

// 統計分頁的顯示格式。後端比率已算到小數一位，分母 0 回 null（規格 9.2，刻意與園務回 0 不同）：
// 畫面一律寫「—」，不寫 0，避免把「沒有資料」看成「轉換率零」。
export const NO_VALUE = '—'

export type StatsTarget = 'records' | 'nodeposit' | 'source'

export interface StatsColumn {
  key: string
  label: string
  /** text：原文；count：整數；rate：百分比（null 寫「—」）；bar：整數＋CSS 長條。 */
  kind?: 'text' | 'count' | 'rate' | 'bar'
  /** 手機橫捲時固定在左側的欄。 */
  sticky?: boolean
}

export function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined ? NO_VALUE : `${value.toFixed(1)}%`
}

/** 前端自己算的比率（接待人員 × 年級的格子），同後端：一位小數、分母 0 為 null。 */
export function ratio(num: number, den: number): number | null {
  return den ? Math.round((num / den) * 1000) / 10 : null
}

/** 月比的百分點（園務「+3.2pt」寫法）。 */
export function formatPoints(value: number | null | undefined): string {
  if (value === null || value === undefined) return NO_VALUE
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}pt`
}

export type Trend = 'up' | 'down' | 'flat' | 'none'
export const TREND_MARK: Record<Trend, string> = { up: '▲', down: '▼', flat: '–', none: '–' }

export function trendOf(value: number | null | undefined): Trend {
  if (value === null || value === undefined) return 'none'
  if (value > 0) return 'up'
  return value < 0 ? 'down' : 'flat'
}

export type RateLevel = 'high' | 'mid' | 'low' | 'none'

/** 園務 RecruitmentDecisionSummary 的上色門檻。 */
export function rateLevel(value: number | null | undefined): RateLevel {
  if (value === null || value === undefined) return 'none'
  if (value >= 60) return 'high'
  return value >= 30 ? 'mid' : 'low'
}

/** CSS 長條寬度：該欄最大值為 100%。 */
export function barWidth(value: number, max: number): string {
  if (!max || value <= 0) return '0%'
  return `${Math.min(100, Math.round((value / max) * 100))}%`
}

const ALERT_LEVEL_LABELS: Record<string, string> = { danger: '高', warning: '中', info: '低' }
export function alertLevelLabel(level: string): string {
  return ALERT_LEVEL_LABELS[level] ?? '提示'
}

const PRIORITY_LABELS: Record<string, string> = { high: '高', medium: '中', low: '低' }
export function priorityLabel(priority: string | null | undefined): string {
  return (priority && PRIORITY_LABELS[priority]) || NO_VALUE
}

/** 年級欄：四個年級固定順序在前，後端回來的其他標籤（「未填寫」）有出現才加；「合計」另外處理。 */
export function gradeColumns(labels: Iterable<string>): string[] {
  const fixed: readonly string[] = GRADES
  const extra = [...new Set(labels)].filter((label) => !fixed.includes(label) && label !== '合計').sort()
  return [...fixed, ...extra]
}
