import type { H3Event } from 'h3'
import { admissionEnabled, normalizeSiteOrigin } from '../../app/utils/seo'
import { loadPublishedSite } from '../utils/published-site'
import { admissionHiddenLocation, isLegacyAdmissionPath, parseRedirectHosts, resolveSiteRedirect } from '../utils/site-redirects'

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
  // 舊站的入學網址要先看後台有沒有把入學資訊分頁隱藏（只有這幾條要讀已發布內容，其他請求照舊同步回應）。
  if (isLegacyAdmissionPath(event.path)) return redirectLegacyAdmission(event, location, config)
  return permanentRedirect(event, location)
})

function permanentRedirect(event: H3Event, location: string) {
  // 301 可被瀏覽器長期快取；短一點的 max-age 讓設錯時能較快修回來。
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
  return sendRedirect(event, location, 301)
}

// 入學資訊分頁隱藏期間（/admission 回 404）：舊站入學網址改用 302 帶到首頁、不給快取，
// 分頁重新顯示後馬上回到原本的 301。讀不到已發布內容時照原本的 301。
async function redirectLegacyAdmission(event: H3Event, location: string, config: Parameters<typeof loadPublishedSite>[0]) {
  let hidden = false
  try {
    hidden = !admissionEnabled((await loadPublishedSite(config)).content.siteMeta)
  } catch { /* 內容服務暫時無法使用：照原本的 301 */ }
  if (!hidden) return permanentRedirect(event, location)
  setResponseHeader(event, 'Cache-Control', 'no-cache, max-age=0')
  return sendRedirect(event, admissionHiddenLocation(location), 302)
}
