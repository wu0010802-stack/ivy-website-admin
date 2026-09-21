import { validateTelemetry } from '../../shared/telemetry'

// 每程序固定上限，不保存 IP／cookie／訪客識別；僅限制非關鍵觀測日誌量。
let windowStart = 0
let accepted = 0
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const config = useRuntimeConfig()
  if (!config.public.telemetryEnabled) { setResponseStatus(event, 204); return }
  if (getHeader(event, 'sec-fetch-site') === 'cross-site') throw createError({ statusCode: 403 })
  const origin = getHeader(event, 'origin')
  if (origin && origin !== config.public.siteOrigin.replace(/\/$/, '') && origin !== getRequestURL(event).origin) throw createError({ statusCode: 403 })
  const now = Date.now()
  if (now - windowStart >= 60_000) { windowStart = now; accepted = 0 }
  if (++accepted > 600) throw createError({ statusCode: 429 })
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
  console.info(JSON.stringify({ type: 'website_telemetry', at: new Date().toISOString(), ...payload }))
  setResponseStatus(event, 204)
})
