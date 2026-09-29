import { securityHeadersFor } from '../utils/security-headers'

// nitro 的 request hook 在 h3 的 onRequest 裡執行，早於所有 handler（含
// 排在最前面的靜態資源處理器），所以靜態檔與後台入口也拿得到標頭。
// 放在 server/middleware 的話，/admin/ 這類靜態檔會直接略過。
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const headers = securityHeadersFor(event.path, useRuntimeConfig(event).websiteEnv)
    for (const [name, value] of Object.entries(headers)) setResponseHeader(event, name, value)
  })
})
