import type { NavLinkPayload, SiteLinkPayload } from '../api/types'

// 主選單、頁尾連結與分校地圖網址的前端檢查。規則和後端 content/schemas.py
// （_require_site_link、is_map_url）、官網 web/app/utils/site-links.ts 相同；
// 後端存檔時才是最後把關，這裡讓園方邊打邊看到哪裡不對。

export const PRIMARY_NAV_MAX = 8
export const FOOTER_LINKS_MAX = 12

// 官網內建的主選單與頁尾連結（web/server/data/site-fixture.json）。還沒在後台
// 設定過的版本沒有這兩個欄位，編輯頁先帶入這份，存檔後官網才改用後台的。
// __tests__/siteStructure.test.ts 會比對兩邊一致。
export const DEFAULT_PRIMARY_NAV: NavLinkPayload[] = [
  { label: '關於常春藤', label_en: 'About Ivy', href: '/#about' },
  { label: '孩子的一天', label_en: 'A Day at Ivy', href: '/#life' },
  { label: '五所校園', label_en: 'Our Campuses', href: '/#campuses' },
  { label: '最新消息', label_en: 'Latest News', href: '/#latest-news' },
  { label: '入學資訊', label_en: 'Admission', href: '/admission' },
]

export const DEFAULT_FOOTER_LINKS: SiteLinkPayload[] = [
  { label: '關於常春藤', href: '/#about' },
  { label: '五所校園', href: '/#campuses' },
  { label: '孩子的一天', href: '/#life' },
  { label: '預約參觀', href: '/visit' },
  { label: '最新消息', href: '/#latest-news' },
  { label: '入學資訊', href: '/admission' },
]

const SITE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~/#?=&%]*$/

export function isExternalLink(href: string): boolean {
  return /^https:\/\//i.test(href.trim())
}

/** 連結有問題時回傳說明；沒問題回 null。 */
export function siteLinkError(href: string): string | null {
  const value = href.trim()
  if (!value) return '請填寫連結'
  if (SITE_PATH.test(value)) return null
  if (/^https:\/\//i.test(value) && !/[\s\\]/.test(value)) {
    try {
      const url = new URL(value)
      if (!url.username && !url.password && url.hostname.includes('.')) return null
    } catch {
      // 落到下面的說明
    }
  }
  return '連結要是站內路徑（/ 開頭，例如 /admission、/#about）或 https:// 開頭的外部網址'
}

export function labelEnError(value: string): string | null {
  return /^[\x20-\x7e]*$/.test(value) ? null : '英文小字只能用英文字母、數字與基本標點'
}

const MAP_PATH_HOSTS = new Set(['www.google.com', 'google.com', 'www.google.com.tw', 'google.com.tw'])
const MAP_HOSTS = new Set(['maps.google.com', 'maps.google.com.tw'])

export function isMapUrl(value: string): boolean {
  const text = value.trim()
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

/** 地圖網址有問題時回傳說明；空白（用地址搜尋）與合格網址回 null。 */
export function mapUrlError(value: string): string | null {
  if (!value.trim() || isMapUrl(value)) return null
  return '只接受 Google 地圖的 https 網址（例如 https://maps.app.goo.gl/…），不接受內嵌程式碼或其他網站'
}

/** 沒填地圖網址時官網用的地址搜尋連結（給「測試開啟」用）。 */
export function addressSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}
