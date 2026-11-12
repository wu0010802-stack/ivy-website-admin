import { analyticsIdsFromConfig } from '../../shared/third-party-analytics'
import { inlineScriptHashes } from '../utils/script-csp'
import { ADMIN_CSP, publicCsp, securityHeadersFor } from '../utils/security-headers'

// nitro 的 request hook 在 h3 的 onRequest 裡執行，早於所有 handler（含
// 排在最前面的靜態資源處理器），所以靜態檔與後台入口也拿得到標頭。
// 放在 server/middleware 的話，/admin/ 這類靜態檔會直接略過。
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const config = useRuntimeConfig(event)
    const headers = securityHeadersFor(event.path, config.websiteEnv, { scriptPolicy: !import.meta.dev, analytics: analyticsIdsFromConfig(config) })
    for (const [name, value] of Object.entries(headers)) setResponseHeader(event, name, value)
  })

  // Nuxt 渲染的頁面：CSP 換成含這一頁 inline script 雜湊的版本（2026-11-04，見 utils/script-csp.ts）。
  // 雜湊照最後送出的 HTML 算，所以 importmap、window.__NUXT__ 設定這類每次建置都會變的內容也對得上。
  // 錯誤頁是 Nuxt 用內部請求 /__nuxt_error 渲染再照抄標頭，同樣經過這裡。
  // GA4／Meta Pixel（2026-11-12）：兩個 ID 是執行期設定（runtimeConfig.public），每個請求都重新讀，
  // 有設才多放行那一家的來源，所以改變數、重啟即生效，不必重建映像；沒設時 CSP 和以前一字不差。
  // 頁面沒有 SWR／ISR 快取（routeRules 只快取靜態資源）；日後若加快取，快取的 HTML 與標頭仍是
  // 同一份內容算出來的雜湊，不會對不上（這也是選雜湊、不選 nonce 的原因）。
  //
  // 只算 head 與 bodyAppend（2026-11-12）：這兩段是 head 管理器（useHead）與 Nuxt 自己放的 script
  // （importmap、window.__NUXT__ 設定）。body 是 app 本體的 HTML、bodyPrepend 含 <Teleport to="body">
  // 的元件內容，這兩段的 script 若也照算，日後任何欄位在 SSR 漏出 <script>，伺服器會替它算雜湊、
  // 自己放行，CSP 就擋不住伺服器端的儲存型 XSS。元件裡要用的 inline script 一律登記在
  // app/utils/inline-scripts.ts（CLIENT_INLINE_SCRIPTS，每頁都帶它們的雜湊），不靠這裡現算。
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    if (import.meta.dev) return
    if (getResponseHeader(event, 'content-security-policy') === ADMIN_CSP) return
    const markup = [...html.head, ...html.bodyAppend].join('')
    setResponseHeader(event, 'Content-Security-Policy', publicCsp(inlineScriptHashes(markup), analyticsIdsFromConfig(useRuntimeConfig(event))))
  })

  // 不透露框架（Nuxt 的 renderer 固定送 x-powered-by: Nuxt）。renderer 先把它寫進回應，
  // nitro 再把 render:response 的 headers 套回去，所以兩邊都要拿掉。
  nitroApp.hooks.hook('render:response', (response, { event }) => {
    if (response.headers) delete response.headers['x-powered-by']
    removeResponseHeader(event, 'x-powered-by')
  })
})
