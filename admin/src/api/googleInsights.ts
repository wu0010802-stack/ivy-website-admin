// 成效統計的兩個外部數據（2026-11-12，docs/specs/2026-11-12-external-integrations-design.md §3、§4）：
// Google 搜尋（Search Console，GET /admin/search-insights）與 Chrome 真實使用者（CrUX，GET /admin/crux）。
// 後端：backend/app/insights/。沒設定回 {configured:false}，Google 失敗回 {configured:true, error}。
import type { components } from '../../../contracts/generated/website-api'
import { taipeiToday } from '../admissions/academic'
import { campusLabel } from './labels'
import { type TrafficVital } from './traffic'

type Schemas = components['schemas']
export type SearchInsights = Schemas['SearchInsightsOut']
export type SearchQueryRow = Schemas['SearchQueryRowOut']
export type SearchPageRow = Schemas['SearchPageRowOut']
export type SearchDeviceRow = Schemas['SearchDeviceRowOut']
export type CruxHistory = Schemas['CruxOut']
export type CruxDevice = Schemas['CruxDeviceOut']
export type CruxWeek = Schemas['CruxWeekOut']
export type CruxValue = Schemas['CruxValueOut']

// ---- Google 搜尋 ----

/** 整頁共用的「近 N 天」換成 Search Console 的起訖（台北日期，含今天）。 */
export function searchPeriod(days: number, today: string = taipeiToday()): { start: string; end: string } {
  const [year = 0, month = 1, day = 1] = today.split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1, day - (days - 1)))
  return { start: start.toISOString().slice(0, 10), end: today }
}

/** 點閱率是 0～1 的小數；沒有曝光時是 null。 */
export function formatCtr(ctr: number | null | undefined): string {
  return ctr === null || ctr === undefined ? '—' : `${(ctr * 100).toFixed(1)}%`
}

/** 平均排名（1 起算，越小越前面）。 */
export function formatPosition(position: number | null | undefined): string {
  return position === null || position === undefined ? '—' : position.toFixed(1)
}

export const SEARCH_DEVICE_LABELS: Record<SearchDeviceRow['device'], string> = {
  mobile: '手機',
  desktop: '電腦',
  tablet: '平板',
}

// 官網頁面（web/app/pages）路徑 → 名稱；認不得的路徑照原樣顯示。
const SEARCH_PAGE_LABELS: Record<string, string> = {
  '/': '首頁',
  '/about': '關於常春藤',
  '/curriculum': '特色教學',
  '/environment': '常春藤環境',
  '/admission': '入學資訊',
  '/news': '最新消息',
  '/anniversary': '30 週年',
  '/visit': '預約參觀（選校）',
  '/privacy': '隱私權政策',
}

/** 搜尋結果裡的頁面路徑 → 園方看得懂的名稱；沒有對應回 null（畫面只寫路徑）。 */
export function searchPageLabel(path: string): string | null {
  const known = SEARCH_PAGE_LABELS[path] ?? SEARCH_PAGE_LABELS[path.replace(/\/$/, '')]
  if (known) return known
  const visit = /^\/visit\/([a-z]+)\/?$/.exec(path)
  if (visit?.[1] && visit[1] !== 'manage') {
    const campus = campusLabel(visit[1])
    return campus === visit[1] ? null : `${campus}校預約頁`
  }
  return null
}

// ---- Chrome 真實使用者 ----

export type CruxMetric = 'lcp' | 'inp' | 'cls'
export const CRUX_METRICS: readonly { key: CruxMetric; vital: TrafficVital['metric'] }[] = [
  { key: 'lcp', vital: 'LCP' },
  { key: 'inp', vital: 'INP' },
  { key: 'cls', vital: 'CLS' },
]
export const CRUX_DEVICE_LABELS: Record<CruxDevice['form_factor'], string> = { phone: '手機', desktop: '電腦' }

export type CruxRating = 'good' | 'needs_improvement' | 'poor'

// Google 的 Core Web Vitals 門檻（p75 要落在「良好」以內才算通過）：LCP 2.5／4 秒、INP 200／500 毫秒、CLS 0.1／0.25。
const CRUX_THRESHOLDS: Record<CruxMetric, readonly [number, number]> = {
  lcp: [2500, 4000],
  inp: [200, 500],
  cls: [0.1, 0.25],
}

export function cruxRating(metric: CruxMetric, p75: number | null | undefined): CruxRating | null {
  if (p75 === null || p75 === undefined) return null
  const [good, poor] = CRUX_THRESHOLDS[metric]
  return p75 <= good ? 'good' : p75 <= poor ? 'needs_improvement' : 'poor'
}

/** 這個視窗有沒有任何指標的 p75（最舊幾週常常是空的）。 */
export function hasCruxData(week: CruxWeek): boolean {
  return CRUX_METRICS.some(({ key }) => week[key].p75 !== null)
}

/** 最近一個有資料的視窗；整段都沒有資料回 null。 */
export function latestCruxWeek(device: CruxDevice): CruxWeek | null {
  return [...device.weeks].reverse().find(hasCruxData) ?? null
}

/** 走勢表：有資料的視窗，由新到舊。 */
export function cruxTrend(device: CruxDevice): CruxWeek[] {
  return device.weeks.filter(hasCruxData).reverse()
}

/** 兩個裝置都沒有「資料量不足」以外的內容。 */
export function cruxAllInsufficient(data: CruxHistory): boolean {
  const devices = data.devices ?? []
  return devices.length > 0 && devices.every((device) => device.status === 'insufficient')
}

/** 比例（0～1）寫成整數百分比；null 回破折號。 */
export function formatRatio(ratio: number | null | undefined): string {
  return ratio === null || ratio === undefined ? '—' : `${Math.round(ratio * 100)}%`
}
