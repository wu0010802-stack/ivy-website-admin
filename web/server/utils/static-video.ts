import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { eventHandler, getRequestHeader, type App, type EventHandler, type H3Event } from 'h3'

// web/public 的影片（首頁 hero、孩子的一天，單支最大約 9 MB）。nitro 內建的
// 靜態資源處理器每個請求都 readFile 整支檔案再 res.end，也不支援 Range：
// 慢讀的連線會一直抓住整個 Buffer（稽核 v-nitro-static-video-full-buffer），
// iOS Safari 的 Range 探測也會讓伺服器整檔送出。這裡改成 createReadStream
// 加 pipeline：支援 Range／206，有背壓，每條連線只佔串流緩衝的量。
const VIDEO_PATH = /^\/assets\/(?:[\w-]+\/)*[\w.-]+\.mp4$/

export type ByteRange = { start: number; end: number }

/**
 * 解析單段 Range。回 null 表示不處理（沒帶、格式不認得、多段或
 * first > last，RFC 9110 允許忽略）→ 整檔 200；'unsatisfiable' → 416。
 */
export function parseRange(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null
  if (!match) return null
  const [, startText = '', endText = ''] = match
  if (startText === '' && endText === '') return null
  if (startText === '') {
    const suffix = Number(endText)
    if (suffix === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(startText)
  if (endText !== '' && Number(endText) < start) return null
  if (!Number.isSafeInteger(start) || start >= size) return 'unsatisfiable'
  const end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1)
  return { start, end }
}

function notModified(event: H3Event, etag: string, mtime: Date): boolean {
  const ifNoneMatch = getRequestHeader(event, 'if-none-match')
  if (ifNoneMatch) {
    return ifNoneMatch.split(',').some((tag) => {
      const value = tag.trim()
      return value === '*' || value.replace(/^W\//, '') === etag
    })
  }
  const since = Date.parse(getRequestHeader(event, 'if-modified-since') ?? '')
  return Number.isFinite(since) && Math.floor(mtime.getTime() / 1000) * 1000 <= since
}

/**
 * publicDir 底下 /assets/**.mp4 的串流 handler；不是影片、找不到檔案或
 * 不是 GET／HEAD 就回 undefined，交給後面的 nitro 靜態資源處理器。
 * routeHeaders 回傳該路徑 routeRules 的標頭（快取設定），照原樣套用。
 */
export function createStaticVideoHandler(
  publicDir: string | (() => string),
  routeHeaders: (event: H3Event) => Record<string, string> | undefined
): EventHandler {
  // 可以傳函式延後到第一個請求才解析（見 plugins/static-video.ts）。
  let root: string | null = null
  return eventHandler(async (event) => {
    if (event.method !== 'GET' && event.method !== 'HEAD') return
    const pathname = event.path.split('?')[0] ?? ''
    if (!VIDEO_PATH.test(pathname)) return
    root ??= resolve(typeof publicDir === 'function' ? publicDir() : publicDir)
    const file = resolve(root, `.${pathname}`)
    if (!file.startsWith(root + sep)) return
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) return

    const res = event.node.res
    const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`
    const lastModified = info.mtime.toUTCString()
    for (const [name, value] of Object.entries(routeHeaders(event) ?? {})) res.setHeader(name, value)
    res.setHeader('Content-Type', 'video/mp4')
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('ETag', etag)
    res.setHeader('Last-Modified', lastModified)

    if (notModified(event, etag, info.mtime)) {
      res.statusCode = 304
      res.end()
      return
    }
    // If-Range 對不上（檔案換過）就忽略 Range，整檔重送。
    const ifRange = getRequestHeader(event, 'if-range')
    const range = !ifRange || ifRange === etag || ifRange === lastModified
      ? parseRange(getRequestHeader(event, 'range'), info.size)
      : null
    if (range === 'unsatisfiable') {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${info.size}`)
      res.end()
      return
    }
    const start = range?.start ?? 0
    const end = range?.end ?? info.size - 1
    res.statusCode = range ? 206 : 200
    if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`)
    res.setHeader('Content-Length', info.size === 0 ? 0 : end - start + 1)
    if (event.method === 'HEAD' || info.size === 0) {
      res.end()
      return
    }
    try {
      await pipeline(createReadStream(file, { start, end }), res)
    } catch {
      // 客戶端中途離開：pipeline 已關掉檔案與連線，不是伺服器錯誤。
      res.destroy()
    }
  })
}

/**
 * 把 handler 放到 h3 app 的最前面。nitro 把靜態資源處理器 unshift 在所有
 * handler 之前（nitropack 2.13.4 dist/rollup/index.mjs），server/middleware
 * 攔不到；plugin 執行時 stack 已建好，這裡再往前插一層。
 */
export function installFirst(app: App, handler: EventHandler): void {
  app.use(handler)
  const layer = app.stack.pop()
  if (layer) app.stack.unshift(layer)
}
