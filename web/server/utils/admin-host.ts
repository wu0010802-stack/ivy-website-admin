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

// 只屬於後台的頁面（GET 轉址到後台主機）。不分大小寫、連續斜線先收成一個再比對（2026-11-12 QA L4）：
// Nuxt 路由不分大小寫（/Preview 一樣渲染草稿預覽）、靜態處理器連 ///admin/ 都找得到後台入口，
// 區分的話這些寫法會被當成公開頁放行。正式網址另由 plugins/url-canonical.ts 301 成單一寫法，這裡是轉址被繞過時的第二道。
const ADMIN_PAGE = /^\/(?:admin|preview)(?:\/|$)|^\/api\/site-fixture(?:\/|$)/i
// 只屬於後台的 API（官網主機上一律 404）。
const ADMIN_API = /^\/api\/website\/v1\/+(?:admin|auth)(?:\/|$)/i
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

// Host 標頭的合法寫法：主機名（字母數字與 . _ -）或 IPv6 方括號，後面可接 :連接埠（允許空的，RFC 3986）。
// 底線不是合法的網域字元，但 new URL 收、容器內的服務名（web_1）也常見，這裡只擋會讓 SSR 組網址失敗的寫法。
const HOST_PATTERN = /^(?:[a-z0-9._-]+|\[[0-9a-f:.]+\])(?::(\d{0,5}))?$/

/** Host 標頭去掉連接埠、轉小寫；不合法回空字串。只看 Host，不信任可偽造的 X-Forwarded-Host。 */
export function normalizeHost(host: string | undefined): string {
  if (!host) return ''
  const value = host.trim().toLowerCase()
  const match = HOST_PATTERN.exec(value)
  if (!match || (match[1] && Number(match[1]) > 65535)) return ''
  return value.replace(/:\d*$/, '')
}

/**
 * Host 標頭的格式對不對（2026-11-12 QA L5）：連接埠不是數字（127.0.0.1:abc）或超過 65535 時，
 * SSR 組絕對網址會丟例外、回 500；格式錯誤的請求在最前面直接回 400。沒有 Host 標頭（HTTP/1.0）不算錯。
 */
export function isValidHostHeader(host: string | undefined): boolean {
  return host === undefined || normalizeHost(host) !== ''
}

function decoded(pathname: string): string {
  try {
    return decodeURI(pathname)
  } catch {
    return pathname
  }
}

/** 連續斜線收成一個（//admin/ 與 /admin/ 是同一條路徑）。 */
function flat(pathname: string): string {
  return pathname.replace(/\/{2,}/g, '/')
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
  const isAdminPage = ADMIN_PAGE.test(flat(path)) || ADMIN_PAGE.test(flat(rawPath))
  const isAdminApi = ADMIN_API.test(flat(path)) || ADMIN_API.test(flat(rawPath))

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
