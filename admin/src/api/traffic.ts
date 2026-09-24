// 後台「數據」頁的官網瀏覽量與 Core Web Vitals（GET /admin/analytics/traffic）。
import { campusLabel } from './labels'

export interface TrafficPage {
  page: 'home' | 'campus' | 'visit'
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
  const campus = item.campus_key ? `${campusLabel(item.campus_key)}校` : ''
  if (item.page === 'campus') return `${campus}介紹頁`
  return campus ? `${campus}預約頁` : '預約參觀（選校）'
}

export const VITAL_LABELS: Record<TrafficVital['metric'], { name: string; hint: string }> = {
  LCP: { name: '主畫面出現', hint: 'LCP，良好 ≤ 2.5 秒' },
  INP: { name: '點擊反應', hint: 'INP，良好 ≤ 200 毫秒' },
  CLS: { name: '版面跳動', hint: 'CLS，良好 ≤ 0.1' },
}

export const RATING_LABELS: Record<TrafficVital['rating'], string> = {
  good: '良好',
  needs_improvement: '需要改善',
  poor: '不佳',
}

export function formatVital(metric: TrafficVital['metric'], value: number): string {
  if (metric === 'CLS') return value.toFixed(2)
  if (metric === 'LCP') return `${(value / 1000).toFixed(1)} 秒`
  return `${Math.round(value)} 毫秒`
}
