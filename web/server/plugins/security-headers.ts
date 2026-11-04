import { inlineScriptHashes } from '../utils/script-csp'
import { ADMIN_CSP, publicCsp, securityHeadersFor } from '../utils/security-headers'

// nitro 的 request hook 在 h3 的 onRequest 裡執行，早於所有 handler（含
// 排在最前面的靜態資源處理器），所以靜態檔與後台入口也拿得到標頭。
// 放在 server/middleware 的話，/admin/ 這類靜態檔會直接略過。
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const headers = securityHeadersFor(event.path, useRuntimeConfig(event).websiteEnv, { scriptPolicy: !import.meta.dev })
    for (const [name, value] of Object.entries(headers)) setResponseHeader(event, name, value)
  })

  // Nuxt 渲染的頁面：CSP 換成含這一頁 inline script 雜湊的版本（2026-11-04，見 utils/script-csp.ts）。
  // 雜湊照最後送出的 HTML 算，所以 importmap、window.__NUXT__ 設定這類每次建置都會變的內容也對得上。
  // 錯誤頁是 Nuxt 用內部請求 /__nuxt_error 渲染再照抄標頭，同樣經過這裡。
  // 頁面沒有 SWR／ISR 快取（routeRules 只快取靜態資源）；日後若加快取，快取的 HTML 與標頭仍是
  // 同一份內容算出來的雜湊，不會對不上（這也是選雜湊、不選 nonce 的原因）。
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    if (import.meta.dev) return
    if (getResponseHeader(event, 'content-security-policy') === ADMIN_CSP) return
    const markup = [...html.head, ...html.bodyPrepend, ...html.body, ...html.bodyAppend].join('')
    setResponseHeader(event, 'Content-Security-Policy', publicCsp(inlineScriptHashes(markup)))
  })

  // 不透露框架（Nuxt 的 renderer 固定送 x-powered-by: Nuxt）。renderer 先把它寫進回應，
  // nitro 再把 render:response 的 headers 套回去，所以兩邊都要拿掉。
  nitroApp.hooks.hook('render:response', (response, { event }) => {
    if (response.headers) delete response.headers['x-powered-by']
    removeResponseHeader(event, 'x-powered-by')
  })
})
