import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { createError, getRequestHeader, type H3Event } from 'h3'

// 素材（影片可達 150 MB）要邊讀邊送。h3 的 proxyRequest 用 for-await 把上游
// 每一塊直接 res.write，不看回傳值也不等 drain：客戶端讀得慢（或故意不讀），
// web 程序就把整支檔案堆在記憶體裡（稽核 web-proxy-no-backpressure-oom）；
// 客戶端斷線後也照樣把上游讀完（proxy-no-upstream-abort）。這裡改用
// stream.pipeline：客戶端讀不動，上游 fetch 就跟著停；客戶端斷線就中止上游。
const FORWARD_REQUEST_HEADERS = [
  'cookie',
  'range',
  // Range 的前提條件；少了它，上游換檔後瀏覽器可能拼出前後不一致的片段。
  'if-range',
  'if-none-match',
  'if-modified-since',
  'accept'
] as const

// 只轉這些回應標頭：素材回應用不到 Set-Cookie，後端內部標頭也不外流。
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
  'cache-control',
  'x-content-type-options',
  'content-disposition',
  'vary'
] as const

/**
 * 客戶端連線一關就中止的 AbortController。回應正常送完後也會觸發 close，
 * 那時上游早已讀完，abort 不會有任何作用。
 */
export function abortOnClientClose(event: H3Event): AbortController {
  const controller = new AbortController()
  const res = event.node.res
  if (res.destroyed) controller.abort()
  else res.once('close', () => controller.abort())
  return controller
}

/** GET／HEAD 素材的串流代理；overrides 蓋過轉送的請求標頭（例如訪客 IP）。 */
export async function streamProxy(event: H3Event, target: string, overrides: Record<string, string>): Promise<void> {
  const res = event.node.res
  const controller = abortOnClientClose(event)
  // 要求上游不要壓縮：fetch 會自動解壓，轉出去的 Content-Length 就對不上。
  const headers: Record<string, string> = { 'accept-encoding': 'identity' }
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = getRequestHeader(event, name)
    if (value) headers[name] = value
  }
  Object.assign(headers, overrides)

  let upstream: Response
  try {
    upstream = await fetch(target, { method: event.method, headers, redirect: 'manual', signal: controller.signal })
  } catch (error) {
    // 客戶端已經離開：沒有人等這個回應，不算伺服器錯誤。
    if (controller.signal.aborted) return
    throw createError({ statusCode: 502, statusMessage: 'Bad Gateway', cause: error })
  }

  res.statusCode = upstream.status
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value !== null) res.setHeader(name, value)
  }
  if (upstream.headers.has('content-encoding')) res.removeHeader('content-length')

  if (!upstream.body || event.method === 'HEAD' || upstream.status === 204 || upstream.status === 304) {
    await upstream.body?.cancel().catch(() => undefined)
    res.end()
    return
  }
  try {
    await pipeline(Readable.fromWeb(upstream.body as NodeReadableStream<Uint8Array>), res)
  } catch (error) {
    // 客戶端中途斷線或上游中斷：pipeline 已銷毀兩端（含上游連線）。
    // 標頭送出之後無法再改成錯誤頁，只能直接關掉連線。
    if (controller.signal.aborted || res.headersSent) {
      res.destroy()
      return
    }
    for (const name of FORWARD_RESPONSE_HEADERS) res.removeHeader(name)
    throw createError({ statusCode: 502, statusMessage: 'Bad Gateway', cause: error })
  }
}
