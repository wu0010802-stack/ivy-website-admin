import { eventHandler, getRequestHeader, sendRedirect, setResponseHeader, setResponseStatus } from 'h3'
import { decideUrlCanonical } from '../utils/url-canonical'
import { installFirst } from '../utils/static-video'

// Host 標頭驗證與頁面網址正規化（規則見 utils/url-canonical.ts）。檔名排在 static-video 之後：
// Nitro 依檔名順序載入 plugin，installFirst 後裝的排在最前面，所以這一層是整串 handler 的第一個，
// 比 nitro 靜態資源處理器（/admin/ 入口）、admin-host 分流、server/middleware 都早。
export default defineNitroPlugin((nitroApp) => {
  installFirst(nitroApp.h3App, eventHandler((event) => {
    const decision = decideUrlCanonical({ host: getRequestHeader(event, 'host'), method: event.method, url: event.path })
    if (decision.action === 'pass') return
    if (decision.action === 'bad-host') {
      // 純文字短訊息：Nuxt 的錯誤頁也要組絕對網址，會跟著壞，所以不丟 createError。
      setResponseStatus(event, 400, 'Bad Request')
      setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
      setResponseHeader(event, 'Cache-Control', 'no-store')
      return 'Bad Request'
    }
    // 301 可被瀏覽器長期快取；短一點的 max-age 讓設錯時能較快修回來（比照主網域轉址與 admin-host）。
    setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
    return sendRedirect(event, decision.location, 301)
  }))
})
