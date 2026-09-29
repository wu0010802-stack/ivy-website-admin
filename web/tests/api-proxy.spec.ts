// @vitest-environment node
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createError, defineEventHandler, getHeader, proxyRequest, toNodeListener } from 'h3'
import { trustedClientIp } from '../server/utils/client-ip'

const servers: Server[] = []
async function listen(server: Server) {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  return address.port
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(check: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await sleep(20)
  }
}

/** 原樣送出路徑（fetch 會先把 %2e%2e 正規化掉，測不到代理）。 */
function rawRequest(port: number, path: string, init: { method?: string; headers?: Record<string, string>; body?: string; onResponse?: (res: IncomingMessage) => void } = {}) {
  return new Promise<{ status: number; headers: IncomingMessage['headers']; body: Buffer }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers: init.headers }, (res) => {
      init.onResponse?.(res)
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end(init.body)
  })
}

let upstreamHits: string[] = []
let upstreamHandler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => res.end('{}')
let proxyPort = 0

beforeEach(async () => {
  upstreamHits = []
  const upstreamPort = await listen(createServer((req, res) => {
    upstreamHits.push(req.url ?? '')
    upstreamHandler(req, res)
  }))
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  vi.stubGlobal('getHeader', getHeader)
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('trustedClientIp', trustedClientIp)
  vi.stubGlobal('proxyRequest', proxyRequest)
  vi.stubGlobal('useRuntimeConfig', () => ({ websiteApiInternalBase: `http://127.0.0.1:${upstreamPort}`, trustedProxyHops: 1, mediaMaxUploadMb: 150 }))
  const { default: handler } = await import('../server/routes/api/website/v1/[...]')
  proxyPort = await listen(createServer(toNodeListener(createApp().use(handler))))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections()
    server.close(() => resolve())
  })))
})

describe('路徑跳脫一律 400，後端收不到（稽核 proxy-dot-segment-*）', () => {
  it.each([
    '/api/website/v1/%2e%2e/%2e%2e/%2e%2e/openapi.json',
    '/api/website/v1/../../../docs',
    '/api/website/v1/a/..%5C..%5C..%5C..%5Cdocs',
    '/api/website/v1/public%2ftelemetry',
    '/api/website/v1/x/%252e%252e/public/telemetry',
    '/api/website/v1/x/.%09./public/telemetry',
  ])('%s', async (path) => {
    const response = await rawRequest(proxyPort, path)
    expect(response.status).toBe(400)
    expect(upstreamHits).toEqual([])
  })

  it('一般路徑照常轉送', async () => {
    const response = await rawRequest(proxyPort, '/api/website/v1/public/site?x=1')
    expect(response.status).toBe(200)
    expect(upstreamHits).toEqual(['/api/website/v1/public/site?x=1'])
  })
})

describe('/public/telemetry 只給伺服器內部轉送（稽核 public-telemetry-analytics-storage-flood）', () => {
  it.each(['/api/website/v1/public/telemetry', '/api/website/v1/public/telemetry/', '/api/website/v1/public/%74elemetry'])('%s → 404', async (path) => {
    const response = await rawRequest(proxyPort, path, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '2' }, body: '{}' })
    expect(response.status).toBe(404)
    expect(upstreamHits).toEqual([])
  })
})

describe('素材邊讀邊送（稽核 web-proxy-no-backpressure-oom、proxy-no-upstream-abort）', () => {
  const MEDIA = '/api/website/v1/public/media/0b7c3b3e-1a2b-4c5d-8e9f-001122334455/file'

  function bigUpstream(totalBytes: number, chunkDelayMs = 0) {
    const state = { sent: 0, finished: false, closedEarly: false }
    upstreamHandler = (_req, res) => {
      const chunk = Buffer.alloc(64 * 1024, 1)
      res.on('close', () => { if (!res.writableFinished) state.closedEarly = true })
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(totalBytes) })
      const body = Readable.from((async function* () {
        while (state.sent < totalBytes) {
          if (chunkDelayMs) await sleep(chunkDelayMs)
          state.sent += chunk.length
          yield chunk
        }
        state.finished = true
      })())
      body.pipe(res)
    }
    return state
  }

  it('客戶端不讀時，上游跟著停，不把整支檔案堆在 web 記憶體', async () => {
    const total = 64 * 1024 * 1024
    const state = bigUpstream(total)
    let clientRes: IncomingMessage | undefined
    const req = request({ host: '127.0.0.1', port: proxyPort, path: MEDIA }, (res) => {
      clientRes = res
      res.pause()
    })
    req.end()
    await waitFor(() => clientRes !== undefined)
    await sleep(800)
    expect(clientRes?.statusCode).toBe(200)
    expect(state.finished).toBe(false)
    expect(state.sent).toBeLessThan(24 * 1024 * 1024)
    req.destroy()
  })

  it('客戶端斷線就中止上游，不再把剩下的檔案讀完', async () => {
    const state = bigUpstream(32 * 1024 * 1024, 5)
    const req = request({ host: '127.0.0.1', port: proxyPort, path: MEDIA }, (res) => {
      res.once('data', () => req.destroy())
    })
    req.on('error', () => undefined)
    req.end()
    await waitFor(() => state.closedEarly)
    expect(state.finished).toBe(false)
  })

  it('只轉白名單標頭；Range／Cookie 轉給上游，訪客自填的 x-website-client-ip 被覆寫', async () => {
    let seen: IncomingMessage['headers'] = {}
    upstreamHandler = (req, res) => {
      seen = req.headers
      res.writeHead(206, {
        'content-type': 'video/mp4',
        'content-length': '4',
        'content-range': 'bytes 0-3/100',
        'accept-ranges': 'bytes',
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        etag: '"abc"',
        'x-internal-debug': 'leak',
        'set-cookie': 'upstream=1',
      })
      res.end('abcd')
    }
    const response = await rawRequest(proxyPort, MEDIA, {
      headers: { range: 'bytes=0-3', cookie: 'ivy_admin_session=s', 'x-website-client-ip': 'spoofed', 'x-forwarded-for': '6.6.6.6, 203.0.113.9', 'x-other': 'drop' },
    })
    expect(response.status).toBe(206)
    expect(response.body.toString()).toBe('abcd')
    expect(response.headers['content-range']).toBe('bytes 0-3/100')
    expect(response.headers['content-length']).toBe('4')
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(response.headers.etag).toBe('"abc"')
    expect(response.headers['x-internal-debug']).toBeUndefined()
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(seen.range).toBe('bytes=0-3')
    expect(seen.cookie).toBe('ivy_admin_session=s')
    expect(seen['x-website-client-ip']).toBe('203.0.113.9')
    expect(seen['x-other']).toBeUndefined()
  })

  it('304 與 HEAD 不帶本文', async () => {
    upstreamHandler = (req, res) => {
      if (req.headers['if-none-match'] === '"abc"') { res.writeHead(304, { etag: '"abc"' }); res.end(); return }
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '4' })
      res.end(req.method === 'HEAD' ? undefined : 'abcd')
    }
    const notModified = await rawRequest(proxyPort, MEDIA, { headers: { 'if-none-match': '"abc"' } })
    expect(notModified.status).toBe(304)
    expect(notModified.body.length).toBe(0)
    const head = await rawRequest(proxyPort, MEDIA, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers['content-length']).toBe('4')
    expect(head.body.length).toBe(0)
  })

  it('後台素材路徑也走串流', async () => {
    const state = bigUpstream(64 * 1024 * 1024)
    let clientRes: IncomingMessage | undefined
    const req = request({ host: '127.0.0.1', port: proxyPort, path: '/api/website/v1/admin/media/0b7c3b3e-1a2b-4c5d-8e9f-001122334455/file' }, (res) => {
      clientRes = res
      res.pause()
    })
    req.end()
    await waitFor(() => clientRes !== undefined)
    await sleep(800)
    expect(state.sent).toBeLessThan(24 * 1024 * 1024)
    req.destroy()
  })
})

describe('其他 API 也在客戶端斷線時中止上游', () => {
  it('客戶端斷線後上游連線被關閉', async () => {
    const state = { closedEarly: false, finished: false }
    upstreamHandler = (_req, res) => {
      res.on('close', () => { if (!res.writableFinished) state.closedEarly = true })
      res.writeHead(200, { 'content-type': 'text/csv' })
      res.write('a,b\n')
      const timer = setInterval(() => res.write('1,2\n'), 10)
      setTimeout(() => { clearInterval(timer); state.finished = true; res.end() }, 5000)
      res.on('close', () => clearInterval(timer))
    }
    const req = request({ host: '127.0.0.1', port: proxyPort, path: '/api/website/v1/admin/visit-requests/export' })
    req.on('error', () => undefined)
    req.end()
    await sleep(200)
    req.destroy()
    await waitFor(() => state.closedEarly)
    expect(state.finished).toBe(false)
  })
})
