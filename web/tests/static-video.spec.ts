// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, truncateSync, utimesSync, writeFileSync } from 'node:fs'
import { createServer, request, type IncomingMessage, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp, eventHandler, toNodeListener, type H3Event } from 'h3'
import { createStaticVideoHandler, installFirst, parseRange } from '../server/utils/static-video'

describe('Range 解析', () => {
  it.each([
    ['bytes=0-1', { start: 0, end: 1 }],
    ['bytes=5-', { start: 5, end: 99 }],
    ['bytes=-10', { start: 90, end: 99 }],
    ['bytes=90-500', { start: 90, end: 99 }],
    ['bytes=-500', { start: 0, end: 99 }],
  ] as const)('%s', (header, expected) => {
    expect(parseRange(header, 100)).toEqual(expected)
  })

  it('超出檔案大小是 416；格式不認得或多段就整檔回', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable')
    expect(parseRange(undefined, 100)).toBeNull()
    expect(parseRange('bytes=5-1', 100)).toBeNull()
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull()
    expect(parseRange('items=0-1', 100)).toBeNull()
  })
})

let publicDir = ''
const SMALL = Buffer.from('0123456789abcdefghij')
const MTIME = new Date('2026-09-01T00:00:00Z')

beforeAll(() => {
  publicDir = mkdtempSync(join(tmpdir(), 'ivy-static-video-'))
  mkdirSync(join(publicDir, 'assets', 'optimized'), { recursive: true })
  writeFileSync(join(publicDir, 'assets', 'optimized', 'small.mp4'), SMALL)
  utimesSync(join(publicDir, 'assets', 'optimized', 'small.mp4'), MTIME, MTIME)
  // 64 MB 稀疏檔：夠大到看得出有沒有背壓，又不佔磁碟。
  writeFileSync(join(publicDir, 'assets', 'big.mp4'), '')
  truncateSync(join(publicDir, 'assets', 'big.mp4'), 64 * 1024 * 1024)
  writeFileSync(join(publicDir, 'secret.mp4'), 'outside assets')
})
afterAll(() => rmSync(publicDir, { recursive: true, force: true }))

let server: Server
let base = ''
let port = 0
let staticHits: string[] = []
let lastEvent: H3Event | undefined

beforeEach(async () => {
  staticHits = []
  const app = createApp({ onRequest: (event) => { lastEvent = event } })
  // 先註冊的「nitro 靜態資源處理器」：installFirst 之後影片要排在它前面。
  app.use(eventHandler((event) => { staticHits.push(event.path); return 'from-static' }))
  // public 目錄延後到請求時才解析（正式建置的 import.meta.url 要等入口執行完才是真值）。
  installFirst(app, createStaticVideoHandler(() => publicDir, () => ({ 'cache-control': 'public, max-age=31536000, immutable' })))
  server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  port = typeof address === 'object' && address ? address.port : 0
  base = `http://127.0.0.1:${port}`
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
})

describe('web/public 的影片邊讀邊送（稽核 v-nitro-static-video-full-buffer）', () => {
  it('整檔：200、長度、型別、快取與驗證標頭', async () => {
    const response = await fetch(`${base}/assets/optimized/small.mp4`)
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(SMALL)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('content-length')).toBe(String(SMALL.length))
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('last-modified')).toBe(MTIME.toUTCString())
    expect(response.headers.get('etag')).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/)
    expect(staticHits).toEqual([])
  })

  it('Range 回 206 與對應片段（iOS Safari 播 mp4 需要）', async () => {
    const response = await fetch(`${base}/assets/optimized/small.mp4`, { headers: { range: 'bytes=2-5' } })
    expect(response.status).toBe(206)
    expect(await response.text()).toBe('2345')
    expect(response.headers.get('content-range')).toBe(`bytes 2-5/${SMALL.length}`)
    expect(response.headers.get('content-length')).toBe('4')
  })

  it('超出範圍回 416', async () => {
    const response = await fetch(`${base}/assets/optimized/small.mp4`, { headers: { range: 'bytes=999-' } })
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe(`bytes */${SMALL.length}`)
  })

  it('If-None-Match／If-Modified-Since 回 304；If-Range 不符就整檔回', async () => {
    const first = await fetch(`${base}/assets/optimized/small.mp4`)
    const etag = first.headers.get('etag') ?? ''
    await first.arrayBuffer()
    expect((await fetch(`${base}/assets/optimized/small.mp4`, { headers: { 'if-none-match': etag } })).status).toBe(304)
    expect((await fetch(`${base}/assets/optimized/small.mp4`, { headers: { 'if-modified-since': MTIME.toUTCString() } })).status).toBe(304)
    const stale = await fetch(`${base}/assets/optimized/small.mp4`, { headers: { range: 'bytes=0-1', 'if-range': '"old"' } })
    expect(stale.status).toBe(200)
    expect(await stale.text()).toBe(SMALL.toString())
    const fresh = await fetch(`${base}/assets/optimized/small.mp4`, { headers: { range: 'bytes=0-1', 'if-range': etag } })
    expect(fresh.status).toBe(206)
  })

  it('HEAD 只回標頭', async () => {
    const response = await fetch(`${base}/assets/optimized/small.mp4`, { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(String(SMALL.length))
  })

  it('客戶端不讀時，web 不會把整支影片放進記憶體', async () => {
    let clientRes: IncomingMessage | undefined
    const req = request({ host: '127.0.0.1', port, path: '/assets/big.mp4' }, (res) => {
      clientRes = res
      res.pause()
    })
    req.on('error', () => undefined)
    req.end()
    const deadline = Date.now() + 3000
    while (!clientRes && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    await new Promise(resolve => setTimeout(resolve, 800))
    expect(clientRes?.statusCode).toBe(200)
    expect(lastEvent?.node.res.writableLength ?? Number.POSITIVE_INFINITY).toBeLessThan(4 * 1024 * 1024)
    req.destroy()
  })

  it('不是 /assets 底下的 mp4、找不到檔案、非 GET／HEAD 都交回給靜態處理器', async () => {
    for (const path of ['/secret.mp4', '/assets/missing.mp4', '/assets/optimized/small.webp', '/assets/%2e%2e/secret.mp4']) {
      const response = await fetch(`${base}${path}`)
      expect(await response.text()).toBe('from-static')
    }
    const post = await fetch(`${base}/assets/optimized/small.mp4`, { method: 'POST' })
    expect(await post.text()).toBe('from-static')
  })
})
