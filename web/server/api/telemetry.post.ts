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
  if (Number(getHeader(event, 'content-length')) > 2048) throw createError({ statusCode: 413 })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 2048) throw createError({ statusCode: 413 })
    chunks.push(buffer)
  }
  let body: unknown
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw createError({ statusCode: 400 }) }
  const payload = validateTelemetry(body)
  if (!payload) throw createError({ statusCode: 400 })
  // 配額只計有效事件：先計數再驗證的話，一串無效請求就能把額度在一分鐘
  // 內用完。以來源分桶：單一來源灌再多，也擠不掉其他訪客的回報。
  const clientIp = trustedClientIp(event)
  if (!quota.admit(clientIp)) throw createError({ statusCode: 429 })
  console.info(JSON.stringify({ type: 'website_telemetry', at: new Date().toISOString(), ...payload }))
  // 存進 API 的每日瀏覽量／效能樣本（後台「數據」頁）。訪客 IP 只給 API 做限流，
  // 不入庫；API 不通時照樣回 204，觀測資料不影響瀏覽。
  await $fetch(`${config.websiteApiInternalBase}/api/website/v1/public/telemetry`, {
    method: 'POST',
    body: payload,
    headers: { 'x-website-client-ip': clientIp },
    timeout: 2000
  }).catch((error: unknown) => {
    console.warn(JSON.stringify({ type: 'website_telemetry_store_failed', message: error instanceof Error ? error.message : String(error) }))
  })
  setResponseStatus(event, 204)
})
