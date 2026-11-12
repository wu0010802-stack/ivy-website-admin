import { publicScriptSources } from './script-csp'

// 全站共用的資安標頭（前台、/admin、同源 /api 代理、靜態資源）。由
// server/plugins/security-headers.ts 在 nitro 的 request hook 套用：那一步
// 早於所有 handler，包括被 nitro 排在最前面的靜態資源處理器——後台入口
// /admin/（Dockerfile 複製進 public/admin/index.html）以前就是這樣繞過
// server/middleware 的標頭（稽核 static-admin-entry-no-security-headers）。
// 個別路徑（例如 /visit/manage 的 Referrer-Policy: no-referrer）在
// server/middleware/preview-headers.ts 覆寫。
//
// 公開頁的 CSP（2026-11-04 起）：script-src 'self' 加逐支 inline script 的 sha256、
// script-src-attr 'none'、form-action 'self'，外加原本的 frame-ancestors／base-uri／object-src。
// 規則與理由見 script-csp.ts。這裡給的是預設值（靜態檔、API 代理、非 HTML 回應都用它，只含
// 事先登記的雜湊）；Nuxt 渲染的頁面由 server/plugins/security-headers.ts 在 render:html 換成
// 含這一頁雜湊的版本。nuxt dev（import.meta.dev）不收 script-src：Vite 與 devtools 會插入
// 其他 inline script。style-src 不收（見 script-csp.ts）。
// Permissions-Policy 不關 fullscreen／autoplay／picture-in-picture／
// encrypted-media：HomeFilms.vue 的 YouTube iframe 需要它們。
// 麥克風只在 /anniversary 這個文件開給同源（microphone=(self)）：「幫常春藤吹蠟燭」
// 讓使用者按了按鈕後對著麥克風吹氣（只在瀏覽器裡算頻譜，不錄音、不上傳）；
// 瀏覽器照樣會先問使用者，iframe 一樣拿不到。其他頁維持 microphone=()。
// 不送 Cross-Origin-Opener-Policy：後台 Google 登入若走彈出視窗會被它切斷。
//
// 2026-11-12 起公開頁再收三條「資源從哪裡來」（不收 default-src：字型、樣式、影片維持原樣）。
// 萬一出現 HTML 注入，注入的 <img>／fetch／iframe 不能把頁面上的資料帶到外站：
// - img-src：同源素材、data:／blob:，加 i.ytimg.com（YouTube 影片沒有自訂封面時的預設縮圖，
//   app/utils/filmCarousel.ts 的 youtubeThumb）。
// - connect-src：同源 API、telemetry；Turnstile（公開預約的機器人驗證）。
// - frame-src：同源（/preview 的手機寬度預覽）、youtube-nocookie（影片按了才插）、Turnstile。
// 新增外部嵌入或圖片來源時要一起改，tests/stack/public-csp.spec.ts 會抓到違規。
export const PUBLIC_RESOURCE_CSP = [
  "img-src 'self' data: blob: https://i.ytimg.com",
  "connect-src 'self' https://challenges.cloudflare.com",
  "frame-src 'self' https://www.youtube-nocookie.com https://challenges.cloudflare.com"
].join('; ')
const PUBLIC_CSP_BASE = "frame-ancestors 'self'; base-uri 'self'; object-src 'none'"

/** 公開頁的完整 CSP；pageHashes 是這一頁 SSR inline script 的 hash-source（見 script-csp.ts）。 */
export function publicCsp(pageHashes: Iterable<string> = []): string {
  return `script-src ${publicScriptSources(pageHashes)}; script-src-attr 'none'; form-action 'self'; ${PUBLIC_RESOURCE_CSP}; ${PUBLIC_CSP_BASE}`
}

const PUBLIC_CSP = publicCsp()

// 後台 SPA（Vite 建置）沒有 inline script、不用 eval，也只連同源 API：
// index.html 只有一支 type=module 的 /admin/assets/*.js；Element Plus 會寫
// inline style，所以 style-src 保留 'unsafe-inline'；素材上傳前的預覽用
// blob:。這條 script-src 是後台頁面本身的縱深防禦（後台頁面不能被注入腳本），
// 不是稽核 admin-same-origin-as-public-site 的修正：後台與公開站同源、session
// cookie 是 Path=/，公開頁（含 /preview）只要出現一個 XSS，就能直接同源
// fetch('/api/website/v1/auth/me') 拿到 CSRF token 呼叫後台 API，或用 iframe
// 載入 /admin/ 操作，這條 CSP 管不到。2026-11-04 起公開頁也有 script-src（雜湊型，
// 見 script-csp.ts），注入的 inline script 與外站腳本都會被擋，這一項從「部分緩解」
// 變成「大致緩解」；真正的修法仍是後台與 API cookie 移到獨立 origin（admin 子網域、
// __Host- cookie），要等正式網域定案。
// frame-src 'self'：內容編輯右側嵌同源的 /preview 即時預覽（2026-10-06 方向 D）；原本靠
// default-src 退回，改成明寫，不允許嵌其他網站。
// worker-src／manifest-src 明寫 'self'（2026-11-05）：後台是 PWA，/admin/sw.js 是只處理手機推播的 Service worker、
// /admin/manifest.webmanifest 是加到主畫面用的 manifest；原本靠 default-src 退回，改成明寫，
// 不允許從其他來源載入 worker 或 manifest。
// img-src 加 https://wmts.nlsc.gov.tw：招生「區域分析」地圖的底圖是國土測繪中心的電子地圖圖磚
// （2026-10-08）。圖磚請求只帶視野範圍（z/x/y），不帶任何家長資料；其他外部圖片仍不放行。
export const ADMIN_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://wmts.nlsc.gov.tw",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'"
].join('; ')

const PERMISSIONS = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()'
const MIC_PAGE = /^\/anniversary\/?$/

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': PUBLIC_CSP,
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': PERMISSIONS
}

const ADMIN_PATH = /^\/admin(?:\/|$)/
// 後台入口 HTML（靜態 index.html）；深層路由由 routes/admin/[...path].get.ts
// 自己設 no-store。/admin/assets/* 有內容雜湊，照常快取。
const ADMIN_ENTRY = /^\/admin(?:\/(?:index\.html)?)?$/
// Service worker 與 manifest 的檔名固定（沒有內容雜湊）：no-cache＝可以存、但每次都向伺服器確認有沒有新版，
// 後台發版後手機上的 worker 與 manifest 才會跟著更新（瀏覽器本來就不讓 worker 腳本吃 HTTP 快取超過 24 小時）。
const ADMIN_REVALIDATE = /^\/admin\/(?:sw\.js|manifest\.webmanifest)$/

// nitro 的靜態資源處理器先 decodePath 再找檔，/%61dmin/ 一樣拿到後台入口；
// 判斷是不是後台要用解碼後的路徑，否則會只帶公開頁的寬鬆 CSP（2026-10-22 資安稽核）。
// decodeURI 和 decodePath 一樣不解 %2F；解不開（不合法的 %）就用原字串。
function decodedPathname(pathname: string): string {
  try {
    return decodeURI(pathname)
  } catch {
    return pathname
  }
}

/**
 * path 可含 query；websiteEnv 取執行期設定（NUXT_WEBSITE_ENV）。
 * scriptPolicy：公開頁 CSP 要不要帶 script-src；只有 nuxt dev 傳 false（見檔頭）。
 */
export function securityHeadersFor(
  path: string,
  websiteEnv: string,
  { scriptPolicy = true }: { scriptPolicy?: boolean } = {}
): Record<string, string> {
  const pathname = path.split('?')[0] ?? '/'
  const decoded = decodedPathname(pathname)
  const headers: Record<string, string> = { ...BASE_HEADERS }
  if (!scriptPolicy) headers['Content-Security-Policy'] = PUBLIC_CSP_BASE
  if (MIC_PAGE.test(pathname)) headers['Permissions-Policy'] = PERMISSIONS.replace('microphone=()', 'microphone=(self)')
  if (ADMIN_PATH.test(pathname) || ADMIN_PATH.test(decoded)) {
    headers['Content-Security-Policy'] = ADMIN_CSP
    headers['X-Robots-Tag'] = 'noindex, nofollow'
    if (ADMIN_ENTRY.test(pathname) || ADMIN_ENTRY.test(decoded)) headers['Cache-Control'] = 'private, no-store'
    else if (ADMIN_REVALIDATE.test(pathname) || ADMIN_REVALIDATE.test(decoded)) headers['Cache-Control'] = 'no-cache'
  }
  // HSTS 只在正式環境送；本機是 http，瀏覽器本來就會忽略，但測試環境
  // 用自簽 https 時送了會讓 localhost 被鎖一年。includeSubDomains（2026-11-12，正式網域
  // www.ivykidschool.com 已定案）：只涵蓋 *.www.ivykidschool.com，沒有任何服務在用；整個
  // ivykidschool.com 要在 Cloudflare 的 apex 開 HSTS 才算（見 deploy/README.md「資安強化 2026-11-12」）。
  // 不加 preload：送進瀏覽器內建清單幾乎撤不回來，要業主決定。
  if (websiteEnv === 'production') headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
  return headers
}
