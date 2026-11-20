import { ATTRIBUTION_COOKIE, decodeAttribution } from '../../shared/attribution-cookie'
import { validateEngagement } from '../../shared/engagement'
import { validateNotFound } from '../../shared/not-found'
import { validateTelemetry } from '../../shared/telemetry'
import { createTelemetryQuota, TELEMETRY_QUOTA } from '../utils/telemetry-quota'

// 每來源＋全站兩層配額（見 utils/telemetry-quota.ts）。來源計數只在記憶體
// 保留當前一分鐘，不保存 cookie／訪客識別；僅限制非關鍵觀測日誌量。
const quota = createTelemetryQuota(TELEMETRY_QUOTA)
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const config = useRuntimeConfig()
  if (!config.public.telemetryEnabled) { setResponseStatus(event, 204); return }
  if (getHeader(event, 'sec-fetch-site') === 'cross-site') throw createError({ statusCode: 403 })
  const origin = getHeader(event, 'origin')
  if (origin && origin !== config.public.siteOrigin.replace(/\/$/, '') && origin !== getRequestURL(event).origin) throw createError({ statusCode: 403 })
  if (Number(getHeader(event, 'content-length')) > 4096) throw createError({ statusCode: 413 })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 4096) throw createError({ statusCode: 413 })
    chunks.push(buffer)
  }
  let body: unknown
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw createError({ statusCode: 400 }) }
  // 瀏覽／速度事件與內容興趣統計（停留、區塊、互動）共用這個入口與配額，各自轉到 API 的端點。
  // 找不到的網址（2026-11-20）也走這裡：同一道 Origin 檢查與配額，轉到 API 的 /public/not-found。
  const engagement = validateEngagement(body)
  const notFound = engagement ? null : validateNotFound(body)
  const payload = engagement ?? notFound ?? validateTelemetry(body)
  if (!payload) throw createError({ statusCode: 400 })
  // 配額只計有效事件：先計數再驗證的話，一串無效請求就能把額度在一分鐘
  // 內用完。以來源分桶：單一來源灌再多，也擠不掉其他訪客的回報。
  const clientIp = trustedClientIp(event)
  if (!quota.admit(clientIp)) throw createError({ statusCode: 429 })
  // 內容興趣統計不寫進日誌（同一次瀏覽會回報多次，量大而且已經存進 API）。
  if (!engagement && !notFound) console.info(JSON.stringify({ type: 'website_telemetry', at: new Date().toISOString(), ...payload }))
  // 同一瀏覽器的匿名代號（2026-11-19，docs/specs/2026-11-19-cookie-stats-design.md §4～6）：只有內容興趣統計帶，
  // 從 HttpOnly 的 ivy_src 讀，瀏覽器端碰不到也送不進來（validateEngagement 不收 browser 這一欄）。
  // 訪客開了 DNT／GPC 就不帶（瀏覽器端本來就不送，這裡再擋一次）。
  const optedOut = getHeader(event, 'dnt') === '1' || getHeader(event, 'sec-gpc') === '1'
  const browser = engagement && !optedOut ? decodeAttribution(getCookie(event, ATTRIBUTION_COOKIE))?.i : undefined
  // 存進 API 的每日瀏覽量／效能樣本（後台「數據」頁）。訪客 IP 只給 API 做限流，
  // 不入庫；API 不通時照樣回 204，觀測資料不影響瀏覽。
  const endpoint = engagement ? 'engagement' : notFound ? 'not-found' : 'telemetry'
  await $fetch(`${config.websiteApiInternalBase}/api/website/v1/public/${endpoint}`, {
    method: 'POST',
    body: browser ? { ...payload, browser } : payload,
    headers: { 'x-website-client-ip': clientIp },
    timeout: 2000
  }).catch((error: unknown) => {
    console.warn(JSON.stringify({ type: 'website_telemetry_store_failed', message: error instanceof Error ? error.message : String(error) }))
  })
  setResponseStatus(event, 204)
})
