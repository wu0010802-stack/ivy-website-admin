// @vitest-environment node
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createError, defineEventHandler, getHeader, toNodeListener } from 'h3'
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
let upstreamBase = ''
let runtimeOverrides: Record<string, unknown> = {}

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
  upstreamBase = `http://127.0.0.1:${upstreamPort}`
  runtimeOverrides = {}
  vi.stubGlobal('useRuntimeConfig', () => ({ websiteApiInternalBase: upstreamBase, trustedProxyHops: 1, mediaMaxUploadMb: 150, ...runtimeOverrides }))
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

describe('路徑跳脫一律 404，後端收不到（稽核 proxy-dot-segment-*）', () => {
  it.each([
    '/api/website/v1/%2e%2e/%2e%2e/%2e%2e/openapi.json',
    '/api/website/v1/../../../docs',
    '/api/website/v1/a/..%5C..%5C..%5C..%5Cdocs',
    '/api/website/v1/public%2ftelemetry',
    '/api/website/v1/x/%252e%252e/public/telemetry',
    '/api/website/v1/x/.%09./public/telemetry',
  ])('%s', async (path) => {
    const response = await rawRequest(proxyPort, path)
    expect(response.status).toBe(404)
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

describe('/public/engagement 同樣只給 telemetry.post.ts 轉送（2026-11-12）', () => {
  it.each(['/api/website/v1/public/engagement', '/api/website/v1/public/engagement/', '/api/website/v1/public/%65ngagement', '/api/website/v1//public//engagement'])('%s → 404', async (path) => {
    const response = await rawRequest(proxyPort, path, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '2' }, body: '{}' })
    expect(response.status).toBe(404)
    expect(upstreamHits).toEqual([])
  })
})

describe('/public/client-errors 同樣只給伺服器內部轉送（2026-11-05 前端錯誤回報）', () => {
  it.each(['/api/website/v1/public/client-errors', '/api/website/v1/public/client-errors/', '/api/website/v1/public/%63lient-errors', '/api/website/v1//public//client-errors'])('%s → 404', async (path) => {
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

describe('一般 API 只轉白名單請求標頭、不回傳 server（2026-11-12）', () => {
  it('偽造 IP／Host 的標頭與 Authorization 不轉；後端會讀的標頭照轉', async () => {
    let seen: IncomingMessage['headers'] = {}
    upstreamHandler = (req, res) => {
      seen = req.headers
      res.writeHead(200, { 'content-type': 'application/json', server: 'uvicorn', 'x-request-id': 'abc12345', 'set-cookie': 'ivy_admin_session=new; HttpOnly' })
      res.end('{}')
    }
    const body = '{"a":1}'
    const response = await rawRequest(proxyPort, '/api/website/v1/admin/visit-requests/1/confirm', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'content-length': String(body.length),
        cookie: 'ivy_admin_session=s',
        origin: 'https://www.ivykidschool.com',
        'user-agent': 'Mozilla/5.0 test',
        'sec-fetch-site': 'same-origin',
        'x-csrf-token': 'csrf',
        'idempotency-key': 'key-1',
        'x-ivy-parent': '1',
        'x-ivy-search': '["a"]',
        'x-line-signature': 'sig',
        'x-request-id': 'req-12345678',
        'x-forwarded-for': '6.6.6.6, 203.0.113.9',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'http',
        forwarded: 'for=6.6.6.6;host=evil.example',
        'x-real-ip': '6.6.6.6',
        authorization: 'Bearer leak',
        'x-website-client-ip': 'spoofed',
        referer: 'https://www.ivykidschool.com/admin/?token=x',
        'x-other': 'drop',
      },
    })
    expect(response.status).toBe(200)
    expect(response.headers.server).toBeUndefined()
    expect(response.headers['x-request-id']).toBe('abc12345')
    expect(response.headers['set-cookie']).toEqual(['ivy_admin_session=new; HttpOnly'])
    for (const name of ['content-type', 'cookie', 'origin', 'user-agent', 'sec-fetch-site', 'x-csrf-token', 'idempotency-key', 'x-ivy-parent', 'x-ivy-search', 'x-line-signature', 'x-request-id']) {
      expect(seen[name], name).toBeDefined()
    }
    expect(seen['x-website-client-ip']).toBe('203.0.113.9')
    for (const name of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip', 'authorization', 'referer', 'x-other']) {
      expect(seen[name], name).toBeUndefined()
    }
  })

  it('白名單涵蓋後端會讀的標頭（新增後端標頭時要一起加）', async () => {
    const { API_FORWARD_REQUEST_HEADERS } = await import('../server/utils/api-proxy')
    expect([...API_FORWARD_REQUEST_HEADERS].sort()).toEqual([
      'content-length', 'content-type', 'cookie', 'idempotency-key', 'if-modified-since', 'if-none-match', 'if-range',
      'origin', 'range', 'sec-fetch-site', 'user-agent', 'x-csrf-token', 'x-request-id',
    ])
  })
})

describe('上游逾時（2026-11-12）', () => {
  it('API 一直不回應標頭就回 504，並關掉上游連線', async () => {
    runtimeOverrides = { apiProxyTimeoutSeconds: 0.3 }
    const state = { closed: false }
    upstreamHandler = (_req, res) => { res.on('close', () => { state.closed = true }) }
    const response = await rawRequest(proxyPort, '/api/website/v1/public/site')
    expect(response.status).toBe(504)
    await waitFor(() => state.closed)
  })

  it('回應標頭到了之後，本文送很久也不會被逾時切斷', async () => {
    runtimeOverrides = { apiProxyTimeoutSeconds: 0.2 }
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/csv' })
      res.write('a,b\n')
      setTimeout(() => res.end('1,2\n'), 500)
    }
    const response = await rawRequest(proxyPort, '/api/website/v1/admin/visit-requests/export')
    expect(response.status).toBe(200)
    expect(response.body.toString()).toBe('a,b\n1,2\n')
  })

  it('素材上游不回應也回 504', async () => {
    runtimeOverrides = { apiProxyTimeoutSeconds: 0.3 }
    upstreamHandler = () => undefined
    const response = await rawRequest(proxyPort, '/api/website/v1/public/media/0b7c3b3e-1a2b-4c5d-8e9f-001122334455/file')
    expect(response.status).toBe(504)
  })

  it('素材下載的客戶端停著不讀，閒置逾時後斷線並中止上游', async () => {
    runtimeOverrides = { mediaIdleTimeoutSeconds: 0.5 }
    const state = { sent: 0, closedEarly: false }
    upstreamHandler = (_req, res) => {
      const chunk = Buffer.alloc(64 * 1024, 1)
      res.on('close', () => { if (!res.writableFinished) state.closedEarly = true })
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(256 * 1024 * 1024) })
      Readable.from((async function* () {
        while (state.sent < 256 * 1024 * 1024) { state.sent += chunk.length; yield chunk }
      })()).pipe(res)
    }
    // 停著不讀的客戶端看不到 close（資料還卡在暫停的串流裡），所以只看上游有沒有被中止。
    const req = request({ host: '127.0.0.1', port: proxyPort, path: '/api/website/v1/public/media/0b7c3b3e-1a2b-4c5d-8e9f-001122334455/file' }, (res) => {
      res.pause()
      res.on('error', () => undefined)
    })
    req.on('error', () => undefined)
    req.end()
    await waitFor(() => state.closedEarly, 8000)
    expect(state.sent).toBeLessThan(256 * 1024 * 1024)
    req.destroy()
  }, 15000)
})

describe('請求方法白名單（2026-11-12 QA L3）', () => {
  // 後端只有 GET／POST／PUT／PATCH／DELETE 路由（沒有 CORS，不會有跨站預檢），素材另外會被 HEAD 探活。
  // TRACE 之類 fetch 不收的方法以前被當成上游故障回 502，現在直接回 405，不往上游送。
  it.each(['TRACE', 'PROPFIND', 'OPTIONS'])('%s → 405 並附 Allow，不轉給後端', async (method) => {
    const response = await rawRequest(proxyPort, '/api/website/v1/public/site', { method })
    expect(response.status).toBe(405)
    expect(response.headers.allow).toBe('GET, HEAD, POST, PUT, PATCH, DELETE')
    expect(upstreamHits).toEqual([])
  })

  it('不合法路徑加上不支援的方法，也是 405（方法先於路徑判斷）', async () => {
    const response = await rawRequest(proxyPort, '/api/website/v1/%2e%2e/docs', { method: 'TRACE' })
    expect(response.status).toBe(405)
    expect(upstreamHits).toEqual([])
  })

  it.each(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])('%s 照常轉給後端', async (method) => {
    const seen: string[] = []
    upstreamHandler = (req, res) => { seen.push(req.method ?? ''); res.writeHead(200, { 'content-type': 'application/json' }); res.end(req.method === 'HEAD' ? undefined : '{}') }
    const body = '{}'
    const response = await rawRequest(proxyPort, '/api/website/v1/public/site', {
      method,
      headers: method === 'GET' || method === 'HEAD' ? undefined : { 'content-type': 'application/json', 'content-length': String(body.length) },
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
    })
    expect(response.status).toBe(200)
    expect(seen).toEqual([method])
  })

  it('白名單常數就是 Allow 標頭的來源', async () => {
    const { API_PROXY_METHODS } = await import('../server/utils/api-proxy')
    expect([...API_PROXY_METHODS]).toEqual(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])
  })
})
