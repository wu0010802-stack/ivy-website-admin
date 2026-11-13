import { createError, getRequestHeaders, getRequestWebStream, readRawBody, removeResponseHeader, sendProxy, setResponseHeader, type H3Event } from 'h3'
import { abortOnClientClose } from './stream-proxy'

// 一般 API 代理（素材 GET／HEAD 走 stream-proxy.ts）。2026-11-12 起不再用 h3 的 proxyRequest：
// 它會把訪客送來的請求標頭幾乎原樣轉給 API（X-Forwarded-*、Forwarded、X-Real-IP、
// Authorization 都會過去），日後後端只要開了 proxy-headers 或改讀其中一個，訪客就能偽造
// IP／Host。這裡改成白名單：只轉後端真的會讀的標頭（2026-11-12 盤點 backend/app）。
// 新增後端會讀的標頭時要加進來，否則正式站收不到（tests/api-proxy.spec.ts 有清單測試）。
export const API_FORWARD_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  'content-type',
  'content-length',
  // 後台 session／家長連結 session／OAuth 握手。
  'cookie',
  // 操作紀錄的裝置、OAuth 與重設密碼的來源檢查。
  'user-agent',
  'origin',
  'sec-fetch-site',
  // 條件式請求與分段下載。
  'if-none-match',
  'if-modified-since',
  'range',
  'if-range',
  // 寫入的冪等鍵與後台 CSRF token。
  'idempotency-key',
  'x-csrf-token',
  // 沿用上游的 request id（後端會驗格式，不合格就自己產生）。
  'x-request-id'
])
// 自家標頭（X-Ivy-Parent、X-Ivy-Search…）與 LINE webhook 的簽章標頭。
const API_FORWARD_REQUEST_PREFIXES = ['x-ivy-', 'x-line-'] as const

// 上游一直不回應（DB 卡鎖、API 當掉）時，最多等這麼久就回 504，不讓連線無限期掛著。
// 只算「送出請求到收到回應標頭」：本文在這之前已經讀完（串流上傳除外，見下），
// 回應本文（例如很大的 CSV）也不受限。
export const DEFAULT_API_PROXY_TIMEOUT_SECONDS = 120

/** 轉給 API 的請求標頭：只留白名單，再套上 overrides（例如代理自己算的訪客 IP）。 */
export function apiForwardHeaders(event: H3Event, overrides: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(getRequestHeaders(event))) {
    if (value === undefined) continue
    const lower = name.toLowerCase()
    if (API_FORWARD_REQUEST_HEADERS.has(lower) || API_FORWARD_REQUEST_PREFIXES.some(prefix => lower.startsWith(prefix))) headers[lower] = value
  }
  return Object.assign(headers, overrides)
}

// 同源 API 入口接受的請求方法（2026-11-12）。後端只有這幾種路由（沒有 CORS，同源不會有預檢），
// HEAD 給素材探活。TRACE／PROPFIND 之類 fetch 不收的方法以前直接送進 sendProxy，被當成上游故障回 502。
export const API_PROXY_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/** 方法不在白名單就回 405＋Allow，不往上游送。 */
export function assertApiProxyMethod(event: H3Event): void {
  if ((API_PROXY_METHODS as readonly string[]).includes(event.method.toUpperCase())) return
  setResponseHeader(event, 'Allow', API_PROXY_METHODS.join(', '))
  throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
}

export interface ApiProxyOptions {
  /** 本文邊收邊送（素材上傳）。這種請求不設回應逾時：上傳本身可能就要好幾分鐘，訪客斷線時照樣中止上游。 */
  streamRequest: boolean
  /** 蓋過轉送的請求標頭（訪客 IP）。 */
  overrides: Record<string, string>
  /** 收到上游回應標頭之後、開始送本文之前（gzip 用）。 */
  onResponse?: (event: H3Event, response: Response) => void | Promise<void>
  timeoutSeconds?: number
}

const PAYLOAD_METHODS = new Set(['PATCH', 'POST', 'PUT', 'DELETE'])

export async function proxyApiRequest(event: H3Event, target: string, options: ApiProxyOptions): Promise<unknown> {
  let body: BodyInit | undefined
  let duplex: 'half' | undefined
  if (PAYLOAD_METHODS.has(event.method)) {
    if (options.streamRequest) {
      body = getRequestWebStream(event) as unknown as BodyInit
      duplex = 'half'
    } else {
      body = await readRawBody(event, false).catch(() => undefined) as BodyInit | undefined
    }
  }

  // 客戶端斷線就中止上游（含串流上傳），不讓 API 為沒人等的請求做完整份工作。
  const controller = abortOnClientClose(event)
  const seconds = Number(options.timeoutSeconds)
  const timeoutMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_API_PROXY_TIMEOUT_SECONDS) * 1000
  let timedOut = false
  const timer = options.streamRequest
    ? undefined
    : setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

  try {
    return await sendProxy(event, target, {
      fetchOptions: {
        method: event.method,
        body,
        duplex,
        headers: apiForwardHeaders(event, options.overrides),
        // OAuth 302/303 必須交給瀏覽器，否則伺服器會跟到 Google／LINE 並遺失握手 cookie。
        redirect: 'manual',
        signal: controller.signal
      } as RequestInit,
      onResponse: async (proxyEvent, response) => {
        clearTimeout(timer)
        // 不透露後端框架（uvicorn 固定送 server: uvicorn）。
        removeResponseHeader(proxyEvent, 'server')
        await options.onResponse?.(proxyEvent, response)
      }
    })
  } catch (error) {
    if (timedOut) throw createError({ statusCode: 504, statusMessage: 'Gateway Timeout' })
    // 客戶端已經離開：沒有人等這個回應，不算伺服器錯誤。
    if (controller.signal.aborted) return
    throw error
  } finally {
    clearTimeout(timer)
  }
}
