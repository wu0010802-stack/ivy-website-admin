import { validateClientError } from '../../shared/client-error'
import { createClientErrorQuota } from '../utils/client-error-quota'

// 官網與後台前端的未處理錯誤（2026-11-05）：作法同 telemetry.post.ts——來源檢查、本文上限、白名單驗證、
// 每來源＋全站配額（見 utils/client-error-quota.ts），再轉給 API 分組存起來。配額只在記憶體保留當前
// 一分鐘，不保存 cookie／訪客識別；訪客 IP 只給 API 做限流，不入庫。
// 錯誤回報壞了不能影響瀏覽：API 不通時照樣回 204。
const quota = createClientErrorQuota()
const MAX_BODY_BYTES = 8192
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const config = useRuntimeConfig()
  if (!config.errorReportsEnabled) { setResponseStatus(event, 204); return }
  if (getHeader(event, 'sec-fetch-site') === 'cross-site') throw createError({ statusCode: 403 })
  const origin = getHeader(event, 'origin')
  if (origin && origin !== config.public.siteOrigin.replace(/\/$/, '') && origin !== getRequestURL(event).origin) throw createError({ statusCode: 403 })
  if (Number(getHeader(event, 'content-length')) > MAX_BODY_BYTES) throw createError({ statusCode: 413 })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw createError({ statusCode: 413 })
    chunks.push(buffer)
  }
  let body: unknown
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw createError({ statusCode: 400 }) }
  const payload = validateClientError(body)
  if (!payload) throw createError({ statusCode: 400 })
  // 配額只計有效回報：先計數再驗證的話，一串無效請求就能把額度在一分鐘內用完。
  const clientIp = trustedClientIp(event)
  if (!quota.admit(clientIp)) throw createError({ statusCode: 429 })
  await $fetch(`${config.websiteApiInternalBase}/api/website/v1/public/client-errors`, {
    method: 'POST',
    body: payload,
    headers: { 'x-website-client-ip': clientIp, 'user-agent': (getHeader(event, 'user-agent') ?? '').slice(0, 300) },
    timeout: 2000
  }).catch((error: unknown) => {
    console.warn(JSON.stringify({ type: 'website_client_error_store_failed', message: error instanceof Error ? error.message : String(error) }))
  })
  setResponseStatus(event, 204)
})
