import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { createError, getRequestHeader, type H3Event } from 'h3'

// 後台區域分析的里界 GeoJSON（約 600 KB，gzip 後約 130 KB）。h3 的 proxyRequest
// 不把 accept-encoding 轉給上游、回應時也丟掉 content-encoding／content-length，
// 所以上游壓不壓都到不了瀏覽器，只能在這一層壓。
//
// 只用在 `onResponse` 這個鉤子：請求照原本代理送出（cookie、CSRF、If-None-Match、
// 訪客 IP 標頭都沿用 proxyRequest 的處理），回應的標頭也先照原本代理設好，
// 這裡只在「上游 200、客戶端收 gzip」時改送壓縮後的本文。其他狀況（304、
// 錯誤、客戶端不收 gzip）什麼都不改，交回 proxyRequest 照常送。

const BOUNDARIES_PATH = '/admin/admissions/area/boundaries'
const gzipAsync = promisify(gzip)

export type Compress = (input: Buffer) => Promise<Buffer>

// 內容只會隨 ETag 變，壓一次就好，所以用最高壓縮率。
const defaultCompress: Compress = input => gzipAsync(input, { level: 9 })

/** 只有 `GET /admin/admissions/area/boundaries`（apiPath 是去掉 /api/website/v1 前綴的路徑）。 */
export function isBoundariesRequest(method: string, apiPath: string): boolean {
  return method === 'GET' && apiPath === BOUNDARIES_PATH
}

/** Accept-Encoding 是否接受 gzip（含 x-gzip、`*`；q=0 代表不接受，明寫的 gzip 優先於 `*`）。 */
export function acceptsGzip(header: string | undefined): boolean {
  if (!header) return false
  let gzipQ: number | undefined
  let anyQ: number | undefined
  for (const part of header.toLowerCase().split(',')) {
    const [coding = '', ...params] = part.split(';')
    let q = 1
    for (const param of params) {
      const match = /^\s*q\s*=\s*(.+?)\s*$/.exec(param)
      if (match) q = Number.isFinite(Number(match[1])) ? Number(match[1]) : 0
    }
    const name = coding.trim()
    if (name === 'gzip' || name === 'x-gzip') gzipQ = Math.max(gzipQ ?? 0, q)
    else if (name === '*') anyQ = q
  }
  return (gzipQ ?? anyQ ?? 0) > 0
}

function addVaryAcceptEncoding(event: H3Event): void {
  const res = event.node.res
  const existing = res.getHeader('vary')
  const current = (Array.isArray(existing) ? existing.join(', ') : String(existing ?? '')).trim()
  const tokens = current.split(',').map(token => token.trim().toLowerCase())
  if (tokens.includes('*') || tokens.includes('accept-encoding')) return
  res.setHeader('vary', current ? `${current}, Accept-Encoding` : 'Accept-Encoding')
}

// proxyRequest 會把上游的 transfer-encoding 一併複製過來；本文改由這裡一次送出，
// 要先拿掉，否則和 Content-Length 並存，Node 的 HTTP 解析會拒絕這個回應。
function sendBody(res: H3Event['node']['res'], body: Buffer): void {
  res.removeHeader('transfer-encoding')
  res.setHeader('content-length', body.length)
  res.end(body)
}

interface CacheEntry {
  etag: string
  rawLength: number
  bytes: Promise<Buffer>
}

/**
 * 給 proxyRequest 的 `onResponse`。壓縮結果依上游 ETag 在記憶體留一筆（ETag 與原始
 * 長度都相同才重用；ETag 不同就換掉）。同時進來的相同 ETag 共用同一次壓縮。
 */
export function createBoundariesGzip(compress: Compress = defaultCompress) {
  let cached: CacheEntry | null = null

  return async function onResponse(event: H3Event, response: Response): Promise<void> {
    if (response.status !== 200 && response.status !== 304) return
    // 200 與 304 是同一份資源的兩種回應，Vary 要一致（RFC 9110 15.4.5）。
    addVaryAcceptEncoding(event)
    if (response.status !== 200 || !acceptsGzip(getRequestHeader(event, 'accept-encoding'))) return

    const res = event.node.res
    let raw: Buffer
    try {
      raw = Buffer.from(await response.arrayBuffer())
    } catch (error) {
      throw createError({ statusCode: 502, statusMessage: 'Bad Gateway', cause: error })
    }

    const etag = response.headers.get('etag')
    let entry: CacheEntry | null = etag && cached?.etag === etag && cached.rawLength === raw.length ? cached : null
    if (!entry) {
      entry = { etag: etag ?? '', rawLength: raw.length, bytes: compress(raw) }
      if (etag) cached = entry
    }
    let bytes: Buffer
    try {
      bytes = await entry.bytes
    } catch {
      // 壓縮失敗不該讓後台打不開地圖：失敗的結果不留，這次原樣送出。
      if (cached === entry) cached = null
      sendBody(res, raw)
      return
    }
    res.setHeader('content-encoding', 'gzip')
    sendBody(res, bytes)
  }
}

export const boundariesGzip = createBoundariesGzip()
