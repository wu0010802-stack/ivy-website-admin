// 後台可編輯的主選單、頁尾連結與分校地圖網址。後端（content/schemas.py）存檔
// 時已驗證過；官網再照同一條規則過濾一次，舊資料或手動改壞的值不會變成連結。
import type { Campus } from '../types/site-content'

export interface SiteLink {
  href: string
  /** https 外部連結：官網標 ↗、另開分頁 */
  external: boolean
}

const SITE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~/#?=&%]*$/

/** 站內路徑（/ 開頭）或 https 外部網址；其他一律不當連結。 */
export function siteLink(href: string | null | undefined): SiteLink | null {
  const value = (href ?? '').trim()
  if (SITE_PATH.test(value)) return { href: value, external: false }
  if (!/^https:\/\//i.test(value) || /[\s\\]/.test(value)) return null
  try {
    const url = new URL(value)
    if (url.username || url.password || !url.hostname.includes('.')) return null
  } catch {
    return null
  }
  return { href: value, external: true }
}

const MAP_PATH_HOSTS = new Set(['www.google.com', 'google.com', 'www.google.com.tw', 'google.com.tw'])
const MAP_HOSTS = new Set(['maps.google.com', 'maps.google.com.tw'])

/** 只認 Google 地圖的 https 網址（含 maps.app.goo.gl 短網址），規則同後端 is_map_url。 */
export function isMapUrl(value: string | null | undefined): boolean {
  const text = (value ?? '').trim()
  if (!/^https:\/\//i.test(text) || /[\s\\]/.test(text)) return false
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return false
  }
  if (url.port || url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  const path = url.pathname
  if (MAP_PATH_HOSTS.has(host)) return path === '/maps' || path.startsWith('/maps/')
  if (MAP_HOSTS.has(host)) return true
  if (host === 'maps.app.goo.gl') return path.length > 1
  if (host === 'goo.gl') return path.startsWith('/maps/') && path.length > '/maps/'.length
  return false
}

/** 分校的地圖連結：後台填了驗證過的地圖網址就用它，否則用地址組成 Google 地圖搜尋。 */
export function campusMapUrl(campus: Pick<Campus, 'address' | 'mapUrl'>): string {
  if (campus.mapUrl && isMapUrl(campus.mapUrl)) return campus.mapUrl.trim()
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(campus.address)}`
}
