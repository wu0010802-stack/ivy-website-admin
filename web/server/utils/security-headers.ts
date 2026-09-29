// 全站共用的資安標頭（前台、/admin、同源 /api 代理、靜態資源）。由
// server/plugins/security-headers.ts 在 nitro 的 request hook 套用：那一步
// 早於所有 handler，包括被 nitro 排在最前面的靜態資源處理器——後台入口
// /admin/（Dockerfile 複製進 public/admin/index.html）以前就是這樣繞過
// server/middleware 的標頭（稽核 static-admin-entry-no-security-headers）。
// 個別路徑（例如 /visit/manage 的 Referrer-Policy: no-referrer）在
// server/middleware/preview-headers.ts 覆寫。
//
// 公開頁的 CSP 只收 frame-ancestors／base-uri／object-src 這三條不影響既有
// 腳本的規則；script-src／style-src 要等把 Nuxt payload、布幕 bootstrap、
// JSON-LD、YouTube 嵌入、預約表單的 Turnstile 等 inline 與外部來源盤點完、
// 實機驗證後再收緊（刻意延後，見稽核 shared-origin-no-script-csp）。
// Permissions-Policy 不關 fullscreen／autoplay／picture-in-picture／
// encrypted-media：HomeFilms.vue 的 YouTube iframe 需要它們。
// 不送 Cross-Origin-Opener-Policy：後台 Google 登入若走彈出視窗會被它切斷。
const PUBLIC_CSP = "frame-ancestors 'self'; base-uri 'self'; object-src 'none'"

// 後台 SPA（Vite 建置）沒有 inline script、不用 eval，也只連同源 API：
// index.html 只有一支 type=module 的 /admin/assets/*.js；Element Plus 會寫
// inline style，所以 style-src 保留 'unsafe-inline'；素材上傳前的預覽用
// blob:。這條 script-src 是後台頁面本身的縱深防禦（後台頁面不能被注入腳本），
// 不是稽核 admin-same-origin-as-public-site 的修正：後台與公開站同源、session
// cookie 是 Path=/，公開頁（含 /preview）只要出現一個 XSS，就能直接同源
// fetch('/api/website/v1/auth/me') 拿到 CSRF token 呼叫後台 API，或用 iframe
// 載入 /admin/ 操作，這條 CSP 管不到。那一項仍未關閉（部分緩解、延後）：真正
// 的修法是後台與 API cookie 移到獨立 origin（admin 子網域、__Host- cookie），
// 或公開站導入 nonce 型 script-src，併入上面延後的 CSP 收緊工作。
export const ADMIN_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'"
].join('; ')

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': PUBLIC_CSP,
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()'
}

const ADMIN_PATH = /^\/admin(?:\/|$)/
// 後台入口 HTML（靜態 index.html）；深層路由由 routes/admin/[...path].get.ts
// 自己設 no-store。/admin/assets/* 有內容雜湊，照常快取。
const ADMIN_ENTRY = /^\/admin(?:\/(?:index\.html)?)?$/

/** path 可含 query；websiteEnv 取執行期設定（NUXT_WEBSITE_ENV）。 */
export function securityHeadersFor(path: string, websiteEnv: string): Record<string, string> {
  const pathname = path.split('?')[0] ?? '/'
  const headers: Record<string, string> = { ...BASE_HEADERS }
  if (ADMIN_PATH.test(pathname)) {
    headers['Content-Security-Policy'] = ADMIN_CSP
    headers['X-Robots-Tag'] = 'noindex, nofollow'
    if (ADMIN_ENTRY.test(pathname)) headers['Cache-Control'] = 'private, no-store'
  }
  // HSTS 只在正式環境送；本機是 http，瀏覽器本來就會忽略，但測試環境
  // 用自簽 https 時送了會讓 localhost 被鎖一年。不加 includeSubDomains：
  // 目前網域是 railway.app 的子網域，正式網域定案後再評估 preload。
  if (websiteEnv === 'production') headers['Strict-Transport-Security'] = 'max-age=31536000'
  return headers
}
