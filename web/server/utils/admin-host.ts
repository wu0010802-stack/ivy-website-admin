// 後台獨立子網域（2026-11-12 資安強化；預設關閉）。
//
// 現況：後台（/admin/、/preview、後台 API）和公開官網同一個 origin，公開頁只要出現一個 XSS，
// 就能同源呼叫後台 API（稽核 admin-same-origin-as-public-site）。設了 NUXT_ADMIN_HOST
// （例如 admin.ivykidschool.com）之後，同一個 web 服務依 Host 分流：
//
// - 後台主機：只服務後台頁、草稿預覽與 API；首頁轉 /admin/，其他公開頁 301 回官網。
// - 其他主機（www）：後台頁與預覽 301 到後台主機；後台與登入 API 一律 404。
//   後台 session cookie 是 __Host- 前綴、只屬於後台主機（backend/app/auth/deps.py），
//   官網頁面上的腳本就算被注入，也拿不到、送不出後台的登入狀態。
//
// 兩邊共用：建置產物與靜態檔、公開 API（預約、家長改期連結、素材）、LINE webhook、健康檢查、
// 前端錯誤回報。後台 SPA 與 /preview 也會載入官網的元件與素材，所以這些不擋。
//
// 啟用前要先做完 deploy/README.md「後台獨立子網域」的步驟（DNS、Railway 網域、
// WEBSITE_ADMIN_ORIGIN／WEBSITE_PUBLIC_ORIGIN、Google／LINE 後台的回呼網址），否則後台會進不去。

export type AdminHostDecision =
  | { action: 'pass' }
  | { action: 'redirect'; location: string; status: 301 | 302 }
  | { action: 'not-found' }

// 只屬於後台的頁面（GET 轉址到後台主機）。
const ADMIN_PAGE = /^\/(?:admin|preview)(?:\/|$)|^\/api\/site-fixture(?:\/|$)/
// 只屬於後台的 API（官網主機上一律 404）。
const ADMIN_API = /^\/api\/website\/v1\/+(?:admin|auth)(?:\/|$)/
// 後台主機上照常服務的共用路徑。
const SHARED = new RegExp([
  '^/_nuxt/',
  '^/assets/',
  '^/favicon',
  '^/apple-touch-icon',
  '^/release\\.json$',
  '^/api/website/v1/+(?:public|line|health)(?:/|$)',
  '^/api/(?:published-site|client-errors|telemetry)(?:/|$)'
].join('|'))

/** Host 標頭去掉連接埠、轉小寫；不合法回空字串。只看 Host，不信任可偽造的 X-Forwarded-Host。 */
export function normalizeHost(host: string | undefined): string {
  if (!host) return ''
  const value = host.trim().toLowerCase()
  if (!/^[a-z0-9.-]+(?::\d+)?$/.test(value)) return ''
  return value.replace(/:\d+$/, '')
}

function decoded(pathname: string): string {
  try {
    return decodeURI(pathname)
  } catch {
    return pathname
  }
}

/**
 * url 是 path＋query（event.path）。adminHost 空白＝功能關閉。siteOrigin 是官網 origin
 * （https://www.ivykidschool.com），後台主機上的公開頁轉回這裡；沒設時改成 404。
 */
export function decideAdminHost(input: { adminHost: string; host: string | undefined; method: string; url: string; siteOrigin: string }): AdminHostDecision {
  const adminHost = normalizeHost(input.adminHost)
  if (!adminHost) return { action: 'pass' }
  const host = normalizeHost(input.host)
  const queryAt = input.url.indexOf('?')
  const rawPath = queryAt === -1 ? input.url : input.url.slice(0, queryAt)
  const path = decoded(rawPath)
  const readOnly = input.method === 'GET' || input.method === 'HEAD'
  const isAdminPage = ADMIN_PAGE.test(path) || ADMIN_PAGE.test(rawPath)
  const isAdminApi = ADMIN_API.test(path) || ADMIN_API.test(rawPath)

  if (host === adminHost) {
    if (isAdminPage || isAdminApi || SHARED.test(path)) return { action: 'pass' }
    if (path === '/' && readOnly) return { action: 'redirect', location: '/admin/', status: 302 }
    if (readOnly && input.siteOrigin) return { action: 'redirect', location: `${input.siteOrigin}${input.url}`, status: 301 }
    return { action: 'not-found' }
  }

  if (isAdminApi) return { action: 'not-found' }
  if (isAdminPage) {
    return readOnly ? { action: 'redirect', location: `https://${adminHost}${input.url}`, status: 301 } : { action: 'not-found' }
  }
  return { action: 'pass' }
}
