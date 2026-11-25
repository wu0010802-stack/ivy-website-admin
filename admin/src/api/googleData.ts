// Google 商家檔案與搜尋需求（2026-11-25，docs/specs/2026-11-25-business-profile-keyword-planner-design.md）。
// 後端：backend/app/insights/google_data_routes.py（只讀資料庫；資料由背景每天／每週向 Google 同步）。
// 權限：admissions.stats（總管理者）。
import { api } from './client'
import type { BusinessProfile, GbpKeyword, GbpLocation, GbpMonth, SearchDemand, SearchKeyword, SearchVolumeCell } from './types'

export function getBusinessProfile(): Promise<BusinessProfile> {
  return api.get<BusinessProfile>('/admin/business-profile')
}

export function getSearchDemand(): Promise<SearchDemand> {
  return api.get<SearchDemand>('/admin/search-demand')
}

export function addSearchKeyword(text: string): Promise<SearchKeyword> {
  return api.post<SearchKeyword>('/admin/search-demand/keywords', { text })
}

export function deleteSearchKeyword(id: string): Promise<void> {
  return api.delete<void>(`/admin/search-demand/keywords/${encodeURIComponent(id)}`)
}

// ---- 共用 ----

/** 同步失敗時，後端只給「哪一步（HTTP n）」；這裡補一句園方能照著做的說明。認不得的回 null（只顯示原文）。 */
export function syncErrorHint(error: string | null | undefined, kind: 'gbp' | 'ads'): string | null {
  if (!error) return null
  const status = /HTTP (\d{3})/.exec(error)?.[1]
  if (error.includes('refresh token')) {
    const env = kind === 'gbp' ? 'WEBSITE_GBP_REFRESH_TOKEN' : 'WEBSITE_GOOGLE_ADS_REFRESH_TOKEN'
    return status === '400'
      ? `授權已失效：refresh token 被撤銷，或 OAuth 同意畫面還在「測試」狀態（7 天就過期）。重新授權後更新 ${env}。`
      : '換不到 Google 權杖：請確認 WEBSITE_GOOGLE_API_CLIENT_ID 與 WEBSITE_GOOGLE_API_CLIENT_SECRET。'
  }
  if (status === '403' || status === '401') {
    return kind === 'gbp'
      ? '沒有存取權：商家檔案 API 還沒核准、Google Cloud 專案沒開 Business Profile Performance API，或授權的帳號不是這個商家檔案的管理員。'
      : '沒有存取權：Google Cloud 專案的 Google Ads API 存取等級要 Basic 以上，授權的帳號也要能讀這個廣告帳戶。'
  }
  if (status === '429') return '超過 Google 的用量上限（API 還沒核准時上限是 0），稍後會自動再試。'
  if (status === '404') {
    return kind === 'gbp' ? '找不到這個地點：請確認 WEBSITE_GBP_LOCATIONS 的地點 ID。' : '找不到廣告帳戶：請確認 WEBSITE_GOOGLE_ADS_CUSTOMER_ID。'
  }
  return null
}

/** 「2026-11-25T02:00:00Z」→ 台北時間「11/25 10:00」。 */
export function syncTime(value: string | null | undefined): string {
  if (!value) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
}

// ---- 商家檔案 ----

export const gbpSearchImpressions = (row: GbpMonth) => row.desktop_search + row.mobile_search
export const gbpMapsImpressions = (row: GbpMonth) => row.desktop_maps + row.mobile_maps

/** 手機占曝光的比例（整數百分比）；沒有曝光是 null。 */
export function gbpMobileShare(row: GbpMonth): number | null {
  const total = gbpSearchImpressions(row) + gbpMapsImpressions(row)
  return total ? Math.round(((row.mobile_search + row.mobile_maps) / total) * 100) : null
}

/** 「2026-11」→「2026 年 11 月」；這個月還沒過完、或最後一天不是月底時加「（到 11/22）」。 */
export function gbpMonthLabel(row: GbpMonth): string {
  const [year = '', month = ''] = row.month.split('-')
  const last = new Date(`${row.last_day}T00:00:00Z`)
  const monthEnd = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
  const label = `${year} 年 ${Number(month)} 月`
  return last.getUTCDate() === monthEnd ? label : `${label}（到 ${Number(month)}/${last.getUTCDate()}）`
}

/** 搜尋字詞的曝光：確切值照寫，Google 只給門檻時寫「少於 15」。 */
export function gbpKeywordValue(row: GbpKeyword): string {
  if (row.impressions !== null && row.impressions !== undefined) return row.impressions.toLocaleString('en-US')
  return row.below !== null && row.below !== undefined ? `少於 ${row.below}` : '—'
}

/** 「2026-10」→「2026 年 10 月」。 */
export function monthText(month: string | null | undefined): string {
  if (!month) return ''
  const [year = '', value = ''] = month.split('-')
  return `${year} 年 ${Number(value)} 月`
}

export function gbpHasData(location: GbpLocation): boolean {
  return location.months.length > 0 || location.keywords_month !== null
}

// ---- 搜尋需求 ----

/** 表頭：月份寫「11 月」，第一欄與跨年的那一欄在上面多一行年份。 */
export function demandMonthHeader(months: string[], index: number): { year: string; month: string } {
  const [year = '', month = ''] = (months[index] ?? '').split('-')
  const previousYear = index > 0 ? (months[index - 1] ?? '').slice(0, 4) : ''
  return { year: index === 0 || year !== previousYear ? year : '', month: `${Number(month)} 月` }
}

export type DemandCellKind = 'value' | 'low' | 'missing'

/** available＝Google 有回這個月；searches 是 null 而 available 是 true＝量太少（不補 0）；沒回＝還沒有這個月的數字。 */
export function demandCell(cell: SearchVolumeCell): { kind: DemandCellKind; text: string } {
  if (!cell.available) return { kind: 'missing', text: '—' }
  if (cell.searches === null || cell.searches === undefined) return { kind: 'low', text: '量太少' }
  return { kind: 'value', text: cell.searches.toLocaleString('en-US') }
}

/** 這個關鍵字在這個地區的 12 格；地區不存在回空陣列。 */
export function demandCells(keyword: SearchKeyword, geo: string): SearchVolumeCell[] {
  return keyword.volumes.find((item) => item.geo === geo)?.cells ?? []
}
