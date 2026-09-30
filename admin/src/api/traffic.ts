// 後台「數據」頁的官網瀏覽量與 Core Web Vitals（GET /admin/analytics/traffic）。
import { campusLabel } from './labels'

// 2026-09-30 起公開內頁也回報瀏覽與速度（名稱同官網頁首；最新消息含內文頁）
const CONTENT_PAGE_LABELS = {
  about: '關於常春藤',
  curriculum: '特色教學',
  environment: '常春藤環境',
  admission: '入學資訊',
  news: '最新消息',
} as const

export interface TrafficPage {
  page: 'home' | 'campus' | 'visit' | keyof typeof CONTENT_PAGE_LABELS
  campus_key: string | null
  views: number
}

export interface TrafficVital {
  metric: 'LCP' | 'INP' | 'CLS'
  device: 'mobile' | 'desktop'
  p75: number
  samples: number
  rating: 'good' | 'needs_improvement' | 'poor'
}

export interface TrafficSummary {
  days: number
  since: string
  until: string
  total_views: number
  daily: { day: string; views: number }[]
  pages: TrafficPage[]
  devices: Record<string, number>
  vitals: TrafficVital[]
}

export function trafficPageLabel(item: Pick<TrafficPage, 'page' | 'campus_key'>): string {
  if (item.page === 'home') return '首頁'
  if (item.page in CONTENT_PAGE_LABELS) return CONTENT_PAGE_LABELS[item.page as keyof typeof CONTENT_PAGE_LABELS]
  const campus = item.campus_key ? `${campusLabel(item.campus_key)}校` : ''
  if (item.page === 'campus') return `${campus}介紹頁`
  return campus ? `${campus}預約頁` : '預約參觀（選校）'
}

// 畫面上只用白話；英文縮寫（園方用不到，給協助的工程師對照）只放在滑鼠提示。
export const VITAL_LABELS: Record<TrafficVital['metric'], { name: string; hint: string; abbr: string }> = {
  LCP: { name: '主畫面出現', hint: '良好：2.5 秒內', abbr: 'LCP' },
  INP: { name: '點擊反應', hint: '良好：200 毫秒內', abbr: 'INP' },
  CLS: { name: '版面跳動', hint: '良好：0.1 以下，越小越穩', abbr: 'CLS' },
}

// 量測次數太少時，一兩位網路慢的訪客就會讓評等變成「不佳」，先不評等。
// 後端的評等只看數值不看次數，這裡另外擋。
export const MIN_VITAL_SAMPLES = 20

export type VitalRating = TrafficVital['rating'] | 'too_few'

export const RATING_LABELS: Record<VitalRating, string> = {
  good: '良好',
  needs_improvement: '需要改善',
  poor: '不佳',
  too_few: '樣本太少',
}

export function vitalRating(vital: Pick<TrafficVital, 'rating' | 'samples'>): VitalRating {
  return vital.samples < MIN_VITAL_SAMPLES ? 'too_few' : vital.rating
}

const VITAL_ORDER: TrafficVital['metric'][] = ['LCP', 'INP', 'CLS']

// 速度表一個指標一列、手機與電腦各一欄：6 列轉成 3 列，手機上也放得下。
export function vitalTable(vitals: readonly TrafficVital[]) {
  return VITAL_ORDER
    .filter((metric) => vitals.some((vital) => vital.metric === metric))
    .map((metric) => ({
      metric,
      ...VITAL_LABELS[metric],
      mobile: vitals.find((vital) => vital.metric === metric && vital.device === 'mobile') ?? null,
      desktop: vitals.find((vital) => vital.metric === metric && vital.device === 'desktop') ?? null,
    }))
}

export function formatVital(metric: TrafficVital['metric'], value: number): string {
  if (metric === 'CLS') return value.toFixed(2)
  if (metric === 'LCP') return `${(value / 1000).toFixed(1)} 秒`
  return `${Math.round(value)} 毫秒`
}
