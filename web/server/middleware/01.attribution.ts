import { defineEventHandler, deleteCookie, getCookie, getRequestHeader, getRequestProtocol, getRequestURL, setCookie } from 'h3'
import { ATTRIBUTION_COOKIE, ATTRIBUTION_MAX_AGE_SECONDS, decodeAttribution, encodeAttribution, isLandingRequest, nextAttribution } from '../../shared/attribution-cookie'
import { publicPage } from '../../shared/telemetry'

// 跨次造訪的網站來源（2026-11-16，docs/specs/2026-11-16-cookie-features-design.md §1，規則在 shared/attribution-cookie.ts）。
// 訪客進站（整頁載入公開頁）時更新第一方 cookie ivy_src；站內 SPA 換頁不會打到這裡。
// 由伺服器發的 HttpOnly cookie：前端 JS 讀不到，也不受 Safari 對 JS 寫的 cookie 7 天上限影響。
// 閘：部署開關（和第一方統計同一個 NUXT_PUBLIC_TELEMETRY_ENABLED）；訪客開了 DNT 或 GPC 就不寫，已有的清掉。
export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  if (!isLandingRequest({
    method: event.method,
    isPublicPage: publicPage(url.pathname) !== null,
    secFetchDest: getRequestHeader(event, 'sec-fetch-dest'),
    accept: getRequestHeader(event, 'accept'),
    purpose: getRequestHeader(event, 'sec-purpose') ?? getRequestHeader(event, 'purpose')
  })) return
  if (!useRuntimeConfig(event).public.telemetryEnabled) return
  const existing = getCookie(event, ATTRIBUTION_COOKIE)
  if (getRequestHeader(event, 'dnt') === '1' || getRequestHeader(event, 'sec-gpc') === '1') {
    if (existing) deleteCookie(event, ATTRIBUTION_COOKIE, { path: '/' })
    return
  }
  // 站內來源（同一個主機）當作沒有來源網址：和瀏覽器端 classifySource 比對 origin 的結果一樣。
  const referer = getRequestHeader(event, 'referer') ?? ''
  let referrer = referer
  try { if (referer && new URL(referer).host === getRequestHeader(event, 'host')) referrer = '' } catch { referrer = '' }
  const next = nextAttribution(decodeAttribution(existing), {
    referrer,
    search: url.search,
    userAgent: getRequestHeader(event, 'user-agent') ?? ''
  }, new Date())
  setCookie(event, ATTRIBUTION_COOKIE, encodeAttribution(next), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: getRequestProtocol(event, { xForwardedProto: true }) === 'https',
    maxAge: ATTRIBUTION_MAX_AGE_SECONDS
  })
})
