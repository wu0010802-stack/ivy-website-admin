import { createError, eventHandler, getRequestHeader, sendRedirect, setResponseHeader } from 'h3'
import { normalizeSiteOrigin } from '../../app/utils/seo'
import { decideAdminHost } from '../utils/admin-host'
import { installFirst } from '../utils/static-video'

// 後台獨立子網域的 Host 分流（規則見 utils/admin-host.ts；NUXT_ADMIN_HOST 空白＝不做事）。
// 要排在 nitro 靜態資源處理器之前：/admin/ 入口是 public/admin/index.html，middleware 管不到。
export default defineNitroPlugin((nitroApp) => {
  installFirst(nitroApp.h3App, eventHandler((event) => {
    const config = useRuntimeConfig(event)
    const adminHost = String(config.adminHost ?? '')
    if (!adminHost) return
    const decision = decideAdminHost({
      adminHost,
      host: getRequestHeader(event, 'host'),
      method: event.method,
      url: event.path,
      siteOrigin: normalizeSiteOrigin(config.public.siteOrigin)
    })
    if (decision.action === 'pass') return
    if (decision.action === 'not-found') throw createError({ statusCode: 404 })
    // 301 可能被瀏覽器長期快取；短一點的 max-age 讓設錯時能較快修回來（比照主網域轉址）。
    setResponseHeader(event, 'Cache-Control', decision.status === 301 ? 'public, max-age=3600' : 'no-store')
    return sendRedirect(event, decision.location, decision.status)
  }))
})
