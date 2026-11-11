import { normalizeSiteOrigin } from '../../app/utils/seo'
import { parseRedirectHosts, resolveSiteRedirect } from '../utils/site-redirects'

// 舊 Wix 網址 301 與主網域轉址（規則與開關見 server/utils/site-redirects.ts）。
// 檔名 00. 開頭：Nitro 依檔名排序執行 middleware，轉址要在其他標頭處理之前。
let cachedKey = ''
let cachedHosts: ReadonlySet<string> = new Set()

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const siteOrigin = normalizeSiteOrigin(config.public.siteOrigin)
  const rawHosts = String(config.redirectHosts ?? '')
  const key = `${siteOrigin}|${rawHosts}`
  if (key !== cachedKey) {
    cachedHosts = parseRedirectHosts(rawHosts, siteOrigin)
    cachedKey = key
  }
  const location = resolveSiteRedirect({
    method: event.method,
    // 只看 Host（Railway edge 會保留訪客打的網域），不信任可被偽造的 X-Forwarded-Host。
    host: getRequestHeader(event, 'host'),
    url: event.path,
    siteOrigin,
    redirectHosts: cachedHosts
  })
  if (!location) return
  // 301 可被瀏覽器長期快取；短一點的 max-age 讓設錯時能較快修回來。
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
  return sendRedirect(event, location, 301)
})
