import type { AdmissionsJourney } from '../api/types'
import { NO_VALUE } from './statsFormat'

// 預約全程（2026-10-15 規格 §3.3）：篩選的網址編解碼與各表的列。只呈現後端算好的數字與分級，不另外推估。

export type JourneyPeriod = '90' | '180' | '365' | 'custom'
export type JourneySource = 'all' | 'web' | 'assisted'
export interface JourneyFilter {
  period: JourneyPeriod
  /** 只在 period=custom 有意義（YYYY-MM-DD，台北日）。 */
  from: string
  to: string
  source: JourneySource
}

export const DEFAULT_JOURNEY_FILTER: JourneyFilter = { period: '90', from: '', to: '', source: 'all' }
export const JOURNEY_PERIODS: { value: JourneyPeriod; label: string }[] = [
  { value: '90', label: '最近 3 個月' },
  { value: '180', label: '最近 6 個月' },
  { value: '365', label: '最近 1 年' },
  { value: 'custom', label: '自訂區間' },
]
export const JOURNEY_SOURCES: { value: JourneySource; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'web', label: '官網預約' },
  { value: 'assisted', label: '後台補登' },
]
/** 分母不足這個數字標「樣本較少」（既有統計規則 R:110–113）。 */
export const SMALL_SAMPLE = 20

const DAY = /^\d{4}-\d{2}-\d{2}$/
const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** 網址 → 篩選：jp 期間、jf／jt 自訂起訖、js 來源；認不得的值一律退回預設。 */
export function parseJourneyQuery(query: Record<string, unknown>): JourneyFilter {
  const source = text(query.js)
  const filter: JourneyFilter = { ...DEFAULT_JOURNEY_FILTER, source: source === 'web' || source === 'assisted' ? source : 'all' }
  const period = text(query.jp)
  if (period === '180' || period === '365') filter.period = period
  if (period === 'custom') {
    const from = text(query.jf)
    const to = text(query.jt)
    if (DAY.test(from) && DAY.test(to)) return { ...filter, period: 'custom', from, to }
  }
  return filter
}

/** 篩選 → 網址參數：預設值不寫；jf／jt 只在自訂區間寫。 */
export function journeyQuery(filter: JourneyFilter): Record<string, string> {
  const query: Record<string, string> = {}
  if (filter.period !== DEFAULT_JOURNEY_FILTER.period) {
    query.jp = filter.period
    if (filter.period === 'custom') {
      query.jf = filter.from
      query.jt = filter.to
    }
  }
  if (filter.source !== 'all') query.js = filter.source
  return query
}

/** 台北日期往前推 days 天（含今天共 days 天）。 */
function daysBefore(today: string, days: number): string {
  const [y, m, d] = today.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! - (days - 1))).toISOString().slice(0, 10)
}

/** 篩選換成起訖日（台北日，含）；自訂區間沒選好是 null。 */
export function journeyRange(filter: JourneyFilter, today: string): { from: string; to: string } | null {
  if (filter.period === 'custom') return filter.from && filter.to ? { from: filter.from, to: filter.to } : null
  return { from: daysBefore(today, Number(filter.period)), to: today }
}

type Rate = AdmissionsJourney['rates'][number]

/** 「到場率 83.3%（80／96）」；分母 0 寫「—」；分母不足 20 加「・樣本較少」。 */
export function rateText(label: string, rate: Rate): string {
  if (rate.pct === null) return `${label} ${NO_VALUE}`
  const small = rate.denominator < SMALL_SAMPLE ? '・樣本較少' : ''
  return `${label} ${rate.pct.toFixed(1)}%（${rate.numerator}／${rate.denominator}）${small}`
}

const rateOf = (data: AdmissionsJourney, key: Rate['key']): Rate => data.rates.find((rate) => rate.key === key)!

export type FunnelRow = {
  key: string
  stage: string
  count: number
  rate: string
  /** 匯出用：比率拆成指標、百分比、分子、分母，Excel 才能排序加總（畫面仍是 rate 那一句）。 */
  rate_label: string
  rate_pct: number | null
  numerator: number
  denominator: number
}

export function funnelRows(data: AdmissionsJourney): FunnelRow[] {
  const { cases, visit_outcomes: outcomes, admissions } = data
  const row = (key: string, stage: string, count: number, label: string, rateKey: Rate['key']): FunnelRow => {
    const rate = rateOf(data, rateKey)
    return {
      key, stage, count, rate: rateText(label, rate),
      rate_label: label, rate_pct: rate.pct, numerator: rate.numerator, denominator: rate.denominator,
    }
  }
  return [
    row('cases', '預約案件', cases.total, '取消率', 'cancel'),
    row('completed', '已到場', outcomes.completed, '到場率', 'attendance'),
    row('with_visit', '有招生訪視', admissions.with_visit, '有訪視比例', 'with_visit'),
    row('deposited', '預繳過', admissions.deposited, '預繳率', 'deposit'),
    row('enrolled', '註冊過', admissions.enrolled, '註冊率', 'enrolled'),
    row('withdrawn', '預繳後退出', admissions.withdrawn.total, '退出比例', 'withdrawn'),
  ]
}

export type ExitRow = {
  key: string
  kind: string
  count: number
  timing: string
}

const CANCEL_NOTE = '距參觀日見下表'
/** 取消時點整張表沒有資料、但有取消缺取消時間時，取消列不能再指向它。 */
const CANCEL_NOTE_EMPTY = '沒有取消時間可比對'
const WITHDRAW_NOTE = '天數見「各段要花多久」'

/** 沒走到「預繳過」的家庭恰好分成前九類；預繳後退出是預繳過的子集，另外兩列。 */
export function exitRows(data: AdmissionsJourney): ExitRow[] {
  const { cancelled, no_show: noShow, unmarked } = data.visit_outcomes
  const { completed_without_visit: noVisit, not_deposited: waiting, withdrawn } = data.admissions
  const { n: cancelTimed, excluded: cancelUntimed } = data.timing.cancel_before_visit
  // 有取消時點 → 指向下表；取消都缺取消時間 → 寫明比對不了；根本沒有取消 → 「—」。
  const cancelTiming = cancelTimed > 0 ? CANCEL_NOTE : cancelUntimed > 0 ? CANCEL_NOTE_EMPTY : NO_VALUE
  return [
    { key: 'cancel_parent', kind: '已取消・家長', count: cancelled.parent, timing: cancelTiming },
    { key: 'cancel_staff', kind: '已取消・園方', count: cancelled.staff, timing: cancelTiming },
    { key: 'cancel_other', kind: '已取消・其他或沒記', count: cancelled.other, timing: cancelTiming },
    { key: 'no_show', kind: '沒來', count: noShow, timing: '參觀當天，人工標記' },
    { key: 'unmarked', kind: '時間已過未標記', count: unmarked, timing: '場次已過、還沒標記到場或沒來' },
    { key: 'no_visit', kind: '已到場但沒有招生訪視', count: noVisit, timing: '沒有連到招生紀錄' },
    { key: 'observing', kind: '參觀後未預繳・觀察中', count: waiting.observing, timing: '參觀後 0–13 天' },
    { key: 'overdue', kind: '參觀後未預繳・逾期', count: waiting.overdue, timing: '參觀後 14–89 天' },
    { key: 'cold', kind: '參觀後未預繳・冷名單', count: waiting.cold, timing: '參觀後 90 天以上' },
    { key: 'withdrawn_deposit', kind: '預繳後退出・退預繳', count: withdrawn.from_deposit, timing: WITHDRAW_NOTE },
    { key: 'withdrawn_enrolled', kind: '預繳後退出・退註冊', count: withdrawn.from_enrolled, timing: WITHDRAW_NOTE },
  ]
}

const BUCKET_LABELS = [
  ['after_visit', '參觀日之後才取消'],
  ['same_day', '當天'],
  ['day_1', '1 天前'],
  ['days_2_3', '2–3 天前'],
  ['days_4_7', '4–7 天前'],
  ['days_8_plus', '8 天以上'],
] as const

export type CancelRow = {
  key: string
  bucket: string
  parent: number
  staff: number
  other: number
}

/** 取消日距預定參觀日的分布；沒有取消就沒有這張表（回空陣列）。 */
export function cancelRows(data: AdmissionsJourney): CancelRow[] {
  const timing = data.timing.cancel_before_visit
  if (timing.n === 0) return []
  return BUCKET_LABELS.map(([key, bucket]) => ({
    key, bucket, parent: timing.parent[key], staff: timing.staff[key], other: timing.other[key],
  }))
}

/** 取消時點表沒納入的筆數（缺取消時間；負值落在「參觀日之後才取消」，不會被排除）；沒有就是空字串。 */
export function cancelNote(data: AdmissionsJourney): string {
  const { excluded } = data.timing.cancel_before_visit
  return excluded > 0 ? `另有 ${excluded} 筆沒有取消時間，不納入` : ''
}

export type TimingRow = {
  key: string
  metric: string
  median: string
  /** 匯出用：中位數天數（沒有值是 null）；畫面寫 median 的「5 天」。 */
  median_days: number | null
  n: number
  /** 「樣本較少」（筆數 1–19）與「另有 N 筆…不納入」，用「；」接起來。 */
  note: string
}

/** 中位數：整數不寫小數（「5 天」「6.5 天」）；沒有值寫「—」。 */
export function daysText(median: number | null): string {
  if (median === null) return NO_VALUE
  return `${Number.isInteger(median) ? median : median.toFixed(1)} 天`
}

export function timingRows(data: AdmissionsJourney): TimingRow[] {
  const { timing } = data
  const row = (key: string, metric: string, days: { median: number | null; n: number; excluded: number }, excludedWhy: string): TimingRow => ({
    key, metric, median: daysText(days.median), median_days: days.median, n: days.n,
    note: [
      days.n > 0 && days.n < SMALL_SAMPLE ? '樣本較少' : '',
      days.excluded ? `另有 ${days.excluded} 筆${excludedWhy}，不納入` : '',
    ].filter(Boolean).join('；'),
  })
  return [
    row('lead_days', '預約提前量（預約送出到預定參觀日）', timing.lead_days, '日期倒置'),
    row('visit_to_deposit', '參觀到預繳', timing.visit_to_deposit, '沒有預繳日或日期倒置'),
    row('deposit_to_enrolled', '預繳到註冊', timing.deposit_to_enrolled, '退註冊（註冊日已清除）、缺預繳日或日期倒置'),
    row('deposit_to_withdrawn', '預繳到退出', timing.deposit_to_withdrawn, '缺預繳日，或日期倒置'),
  ]
}

const slashed = (day: string): string => day.replaceAll('-', '/')

/** 摘要句（只描述）：期間、預約案件、各結局；有到場的再接招生紀錄、預繳、註冊、預繳後退出。
 *  來源不是全部時寫出只看哪一種（取回應的 filters，和匯出檔名同一個依據）。 */
export function journeySummary(data: AdmissionsJourney, campusName: string): string {
  const range = `${slashed(data.filters.date_from)}–${slashed(data.filters.date_to)}`
  const source = JOURNEY_SOURCES.find((option) => option.value === data.filters.source)
  const only = source && source.value !== 'all' ? `（只看${source.label}）` : ''
  if (data.cases.total === 0) return `${range}，${campusName}這段期間沒有預約案件${only}。`
  const { completed, no_show: noShow, cancelled, unmarked } = data.visit_outcomes
  const attendance = rateOf(data, 'attendance').pct
  const head =
    `${range}，${campusName}預定參觀的預約 ${data.cases.total} 筆${only}：到場 ${completed}` +
    `（到場率 ${attendance === null ? NO_VALUE : `${attendance.toFixed(1)}%`}）、取消 ${cancelled.total}、沒來 ${noShow}、時間已過未標記 ${unmarked}。`
  if (completed === 0) return head
  const { admissions } = data
  return `${head}到場的 ${completed} 筆中 ${admissions.with_visit} 筆有招生紀錄，預繳 ${admissions.deposited}、註冊 ${admissions.enrolled}、預繳後退出 ${admissions.withdrawn.total}。`
}
