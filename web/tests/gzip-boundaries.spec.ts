// @vitest-environment node
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createError, defineEventHandler, getHeader, proxyRequest, toNodeListener } from 'h3'
import { trustedClientIp } from '../server/utils/client-ip'
import { acceptsGzip, createBoundariesGzip, createJsonGzip, isBoundariesRequest } from '../server/utils/gzip-boundaries'

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

/** 原樣送出請求、不自動解壓（fetch 會替我們解壓，看不到實際位元組）。 */
function rawRequest(port: number, path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; headers: IncomingMessage['headers']; body: Buffer }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers: init.headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

// 約 600 KB 的 GeoJSON 形狀文字：重複度高、gzip 後小很多。
const GEOJSON = Buffer.from(JSON.stringify({
  type: 'FeatureCollection',
  features: Array.from({ length: 4000 }, (_, i) => ({ type: 'Feature', properties: { county: '高雄市', village: `里${i}` }, geometry: { type: 'Polygon', coordinates: [[[120.3, 22.6], [120.31, 22.6], [120.31, 22.61], [120.3, 22.6]]] } })),
}))
const BOUNDARIES = '/api/website/v1/admin/admissions/area/boundaries'
const CACHE_CONTROL = 'private, max-age=86400'

let upstreamHits: Array<{ method: string; url: string; headers: IncomingMessage['headers'] }> = []
let upstreamHandler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => res.end('{}')

/** 假上游：像後端一樣回里界（200＋ETag＋Cache-Control），If-None-Match 相同回 304。 */
function geoUpstream(etag = '"e1"', body: Buffer = GEOJSON) {
  upstreamHandler = (req, res) => {
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': CACHE_CONTROL })
      res.end()
      return
    }
    // 和 uvicorn 一樣帶 Content-Length；沒帶（分塊傳輸）的情況由下面幾個直接寫 writeHead 的測試涵蓋。
    res.writeHead(200, { 'content-type': 'application/geo+json', 'content-length': String(body.length), etag, 'cache-control': CACHE_CONTROL })
    res.end(body)
  }
}

beforeEach(async () => {
  upstreamHits = []
  upstreamHandler = (_req, res) => res.end('{}')
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections()
    server.close(() => resolve())
  })))
})

async function startUpstream() {
  return listen(createServer((req, res) => {
    upstreamHits.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers })
    upstreamHandler(req, res)
  }))
}

/** 起真的 nitro 代理路由（和 api-proxy.spec 同樣的做法）。 */
async function startProxy() {
  const upstreamPort = await startUpstream()
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  vi.stubGlobal('getHeader', getHeader)
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('trustedClientIp', trustedClientIp)
  vi.stubGlobal('proxyRequest', proxyRequest)
  vi.stubGlobal('useRuntimeConfig', () => ({ websiteApiInternalBase: `http://127.0.0.1:${upstreamPort}`, trustedProxyHops: 1, mediaMaxUploadMb: 150 }))
  vi.resetModules()
  const { default: handler } = await import('../server/routes/api/website/v1/[...]')
  return listen(createServer(toNodeListener(createApp().use(handler))))
}

/** 只掛 createBoundariesGzip（可注入壓縮函式）的小代理，用來數壓縮次數。 */
async function startCountingProxy(compress: (input: Buffer) => Promise<Buffer>) {
  const upstreamPort = await startUpstream()
  const onResponse = createBoundariesGzip(compress)
  const app = createApp().use(defineEventHandler(event => proxyRequest(event, `http://127.0.0.1:${upstreamPort}/geo`, {
    fetchOptions: { redirect: 'manual' },
    onResponse,
  })))
  return listen(createServer(toNodeListener(app)))
}

describe('acceptsGzip', () => {
  it.each([
    ['gzip', true],
    ['gzip, deflate, br', true],
    ['deflate, GZIP', true],
    ['x-gzip', true],
    ['br;q=1.0, gzip;q=0.8', true],
    ['*', true],
    ['*;q=0.5', true],
    ['gzip;q=0', false],
    ['gzip;q=0.0, *', false],
    ['*;q=0', false],
    ['identity', false],
    ['br, deflate', false],
    ['', false],
    [undefined, false],
    ['gzip;q=abc', false],
  ])('%j → %s', (header, expected) => {
    expect(acceptsGzip(header)).toBe(expected)
  })
})

describe('isBoundariesRequest：只認 GET 里界這一條', () => {
  it('GET /admin/admissions/area/boundaries', () => {
    expect(isBoundariesRequest('GET', '/admin/admissions/area/boundaries')).toBe(true)
  })
  it.each([
    ['HEAD', '/admin/admissions/area/boundaries'],
    ['POST', '/admin/admissions/area/boundaries'],
    ['GET', '/admin/admissions/area/boundaries/'],
    ['GET', '/admin/admissions/area/Boundaries'],
    ['GET', '/admin/admissions/area/kindergartens'],
    ['GET', '/admin/admissions/area/boundaries/extra'],
    ['GET', '/public/admin/admissions/area/boundaries'],
  ])('%s %s 不算', (method, path) => {
    expect(isBoundariesRequest(method, path)).toBe(false)
  })
})

describe('里界 GeoJSON 由官網代理 gzip', () => {
  it('客戶端收 gzip：解壓後內容一致、標頭齊全、體積變小', async () => {
    geoUpstream()
    const proxy = await startProxy()
    const response = await rawRequest(proxy, BOUNDARIES, { headers: { 'accept-encoding': 'gzip, deflate, br' } })
    expect(response.status).toBe(200)
    expect(response.headers['content-encoding']).toBe('gzip')
    expect(response.headers.vary).toBe('Accept-Encoding')
    expect(response.headers['content-type']).toBe('application/geo+json')
    expect(response.headers.etag).toBe('"e1"')
    expect(response.headers['cache-control']).toBe(CACHE_CONTROL)
    expect(response.headers['content-length']).toBe(String(response.body.length))
    expect(response.body.length).toBeLessThan(GEOJSON.length / 4)
    expect(gunzipSync(response.body).equals(GEOJSON)).toBe(true)
  })

  it('請求照原本代理轉給上游：cookie、CSRF、If-None-Match 照轉，訪客自填的 client IP 標頭被覆寫', async () => {
    geoUpstream()
    const proxy = await startProxy()
    await rawRequest(proxy, BOUNDARIES, {
      headers: {
        'accept-encoding': 'gzip',
        cookie: 'ivy_admin_session=s',
        'x-csrf-token': 'tok',
        'if-none-match': '"stale"',
        'x-website-client-ip': 'spoofed',
        'x-forwarded-for': '6.6.6.6, 203.0.113.9',
      },
    })
    expect(upstreamHits).toHaveLength(1)
    const seen = upstreamHits[0]!
    expect(seen.method).toBe('GET')
    expect(seen.url).toBe('/api/website/v1/admin/admissions/area/boundaries')
    expect(seen.headers.cookie).toBe('ivy_admin_session=s')
    expect(seen.headers['x-csrf-token']).toBe('tok')
    expect(seen.headers['if-none-match']).toBe('"stale"')
    expect(seen.headers['x-website-client-ip']).toBe('203.0.113.9')
  })

  it('上游 304 直通：帶 ETag 與 Cache-Control、沒有本文、不加 Content-Encoding', async () => {
    geoUpstream()
    const proxy = await startProxy()
    const response = await rawRequest(proxy, BOUNDARIES, { headers: { 'accept-encoding': 'gzip', 'if-none-match': '"e1"' } })
    expect(response.status).toBe(304)
    expect(response.headers.etag).toBe('"e1"')
    expect(response.headers['cache-control']).toBe(CACHE_CONTROL)
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.headers.vary).toBe('Accept-Encoding')
    expect(response.body.length).toBe(0)
  })

  it.each([
    ['沒帶 Accept-Encoding', undefined],
    ['identity', 'identity'],
    ['gzip;q=0', 'gzip;q=0'],
    ['只收 br', 'br'],
  ])('客戶端不收 gzip（%s）：原樣回，仍帶 Vary', async (_label, acceptEncoding) => {
    geoUpstream()
    const proxy = await startProxy()
    const response = await rawRequest(proxy, BOUNDARIES, { headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding } })
    expect(response.status).toBe(200)
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.headers.vary).toBe('Accept-Encoding')
    expect(response.headers['content-type']).toBe('application/geo+json')
    expect(response.headers.etag).toBe('"e1"')
    expect(response.headers['cache-control']).toBe(CACHE_CONTROL)
    expect(response.body.equals(GEOJSON)).toBe(true)
  })

  it('上游已有 Vary 時併入 Accept-Encoding，不重複', async () => {
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/geo+json', etag: '"v"', vary: 'Cookie' })
      res.end(GEOJSON)
    }
    const proxy = await startProxy()
    const gz = await rawRequest(proxy, BOUNDARIES, { headers: { 'accept-encoding': 'gzip' } })
    expect(gz.headers.vary).toBe('Cookie, Accept-Encoding')
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/geo+json', etag: '"v"', vary: 'accept-encoding, Cookie' })
      res.end(GEOJSON)
    }
    const again = await rawRequest(proxy, BOUNDARIES, { headers: { 'accept-encoding': 'gzip' } })
    expect(again.headers.vary).toBe('accept-encoding, Cookie')
  })

  it.each([401, 403, 404, 500])('上游 %i：照原本代理回，不壓縮、不動 Vary', async (status) => {
    const errorBody = JSON.stringify({ detail: 'x'.repeat(2000) })
    upstreamHandler = (_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(errorBody)
    }
    const proxy = await startProxy()
    const response = await rawRequest(proxy, BOUNDARIES, { headers: { 'accept-encoding': 'gzip' } })
    expect(response.status).toBe(status)
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.headers.vary).toBeUndefined()
    expect(response.body.toString()).toBe(errorBody)
  })

  it('上游本身壓縮過（fetch 已解壓）：web 層重壓一次，解開內容仍一致', async () => {
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/geo+json', etag: '"up"', 'content-encoding': 'gzip' })
      res.end(gzipSync(GEOJSON))
    }
    const proxy = await startProxy()
    const response = await rawRequest(proxy, BOUNDARIES, { headers: { 'accept-encoding': 'gzip' } })
    expect(response.status).toBe(200)
    expect(response.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(response.body).equals(GEOJSON)).toBe(true)
  })

  it('上游本文讀到一半斷線：回 502，不帶上游的一天快取與 ETag（瀏覽器與 CDN 不能把錯誤存下來）', async () => {
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/geo+json', 'content-length': String(GEOJSON.length), etag: '"e1"', 'cache-control': CACHE_CONTROL })
      res.write(GEOJSON.subarray(0, 1024))
      // 只送出一小段就斷線：fetch 讀本文時丟錯
      setTimeout(() => res.destroy(), 20)
    }
    const proxy = await startProxy()
    const response = await rawRequest(proxy, BOUNDARIES, { headers: { 'accept-encoding': 'gzip' } })
    expect(response.status).toBe(502)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers.etag).toBeUndefined()
    expect(response.headers['content-encoding']).toBeUndefined()
  })

  it('斷線後的下一次請求恢復正常（沒有把壞結果留在快取）', async () => {
    let broken = true
    upstreamHandler = (_req, res) => {
      if (broken) {
        res.writeHead(200, { 'content-type': 'application/geo+json', 'content-length': String(GEOJSON.length), etag: '"e1"', 'cache-control': CACHE_CONTROL })
        res.write(GEOJSON.subarray(0, 1024))
        setTimeout(() => res.destroy(), 20)
        return
      }
      res.writeHead(200, { 'content-type': 'application/geo+json', 'content-length': String(GEOJSON.length), etag: '"e1"', 'cache-control': CACHE_CONTROL })
      res.end(GEOJSON)
    }
    const proxy = await startProxy()
    expect((await rawRequest(proxy, BOUNDARIES, { headers: { 'accept-encoding': 'gzip' } })).status).toBe(502)
    broken = false
    const ok = await rawRequest(proxy, BOUNDARIES, { headers: { 'accept-encoding': 'gzip' } })
    expect(ok.status).toBe(200)
    expect(ok.headers.etag).toBe('"e1"')
    expect(ok.headers['cache-control']).toBe(CACHE_CONTROL)
    expect(gunzipSync(ok.body).equals(GEOJSON)).toBe(true)
  })

  it('同一個 ETag 連續兩次：第二次內容與第一次相同', async () => {
    geoUpstream()
    const proxy = await startProxy()
    const first = await rawRequest(proxy, BOUNDARIES, { headers: { 'accept-encoding': 'gzip' } })
    const second = await rawRequest(proxy, BOUNDARIES, { headers: { 'accept-encoding': 'gzip' } })
    expect(second.body.equals(first.body)).toBe(true)
    expect(upstreamHits).toHaveLength(2)
  })
})

// 2026-10-13：里界以外的 JSON 回應也由代理壓縮（不快取）；不是 JSON 的（CSV、重新導向）照舊串流原樣送。
describe('其他 JSON 回應：收 gzip 就壓縮，每次壓、不快取', () => {
  const RECORDS = '/api/website/v1/admin/admissions/records?campus_key=yihua&page=1'
  // 後台列表的樣子：50 筆、每筆幾十個欄位，約 50 KB。
  const LIST = Buffer.from(JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ id: `v-${i}`, child_name: `小安${i}`, notes: '家長關心午睡與戶外活動時間', address: '高雄市左營區明華一路175號' }))))

  it.each([
    ['GET', RECORDS],
    ['GET', '/api/website/v1/admin/admissions/area/kindergartens?campus_key=chongde'],
    ['GET', '/api/website/v1/admin/admissions/area/boundaries/'],
    ['GET', '/api/website/v1/public/site'],
    ['POST', '/api/website/v1/admin/admissions/area/boundaries'],
  ])('%s %s：gzip 後送出，標頭照上游、加 Vary', async (method, path) => {
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(LIST.length), etag: '"o"', 'cache-control': 'private, no-store' })
      res.end(LIST)
    }
    const proxy = await startProxy()
    const response = await rawRequest(proxy, path, { method, headers: { 'accept-encoding': 'gzip, deflate, br' } })
    expect(response.status).toBe(200)
    expect(response.headers['content-encoding']).toBe('gzip')
    expect(response.headers.vary).toBe('Accept-Encoding')
    expect(response.headers.etag).toBe('"o"')
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.headers['content-length']).toBe(String(response.body.length))
    expect(response.body.length).toBeLessThan(LIST.length / 4)
    expect(gunzipSync(response.body).equals(LIST)).toBe(true)
  })

  it('上游沒帶 Content-Length（分塊傳輸）也壓', async () => {
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.write(LIST.subarray(0, 100))
      res.end(LIST.subarray(100))
    }
    const proxy = await startProxy()
    const response = await rawRequest(proxy, RECORDS, { headers: { 'accept-encoding': 'gzip' } })
    expect(response.headers['content-encoding']).toBe('gzip')
    expect(response.headers['transfer-encoding']).toBeUndefined()
    expect(gunzipSync(response.body).equals(LIST)).toBe(true)
  })

  it('錯誤回應的 JSON 夠大也壓（422 的欄位說明）', async () => {
    const errorBody = JSON.stringify({ detail: Array.from({ length: 40 }, (_, i) => ({ loc: ['body', `field${i}`], msg: '欄位格式不正確' })) })
    upstreamHandler = (_req, res) => {
      res.writeHead(422, { 'content-type': 'application/json' })
      res.end(errorBody)
    }
    const proxy = await startProxy()
    const response = await rawRequest(proxy, RECORDS, { method: 'POST', headers: { 'accept-encoding': 'gzip' } })
    expect(response.status).toBe(422)
    expect(response.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(response.body).toString()).toBe(errorBody)
  })

  it('1 KB 以下不壓：上游有宣告長度時照原本串流，沒宣告時原樣送（補 Content-Length）', async () => {
    const small = Buffer.from(JSON.stringify({ ok: true, items: [1, 2, 3] }))
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(small.length) })
      res.end(small)
    }
    const proxy = await startProxy()
    const declared = await rawRequest(proxy, RECORDS, { headers: { 'accept-encoding': 'gzip' } })
    expect(declared.headers['content-encoding']).toBeUndefined()
    expect(declared.headers.vary).toBe('Accept-Encoding')
    expect(declared.body.equals(small)).toBe(true)
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(small)
    }
    const chunked = await rawRequest(proxy, RECORDS, { headers: { 'accept-encoding': 'gzip' } })
    expect(chunked.headers['content-encoding']).toBeUndefined()
    expect(chunked.headers['content-length']).toBe(String(small.length))
    expect(chunked.body.equals(small)).toBe(true)
  })

  it.each([
    ['沒帶 Accept-Encoding', undefined],
    ['identity', 'identity'],
    ['只收 br', 'br'],
  ])('客戶端不收 gzip（%s）：原樣回，仍帶 Vary', async (_label, acceptEncoding) => {
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', etag: '"o"' })
      res.end(LIST)
    }
    const proxy = await startProxy()
    const response = await rawRequest(proxy, RECORDS, { headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding } })
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.headers.vary).toBe('Accept-Encoding')
    expect(response.body.equals(LIST)).toBe(true)
  })

  it('上游 304：沒有本文、不加 Content-Encoding，Vary 和 200 一致', async () => {
    upstreamHandler = (_req, res) => {
      res.writeHead(304, { etag: '"o"' })
      res.end()
    }
    const proxy = await startProxy()
    const response = await rawRequest(proxy, '/api/website/v1/public/site', { headers: { 'accept-encoding': 'gzip', 'if-none-match': '"o"' } })
    expect(response.status).toBe(304)
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.headers.vary).toBe('Accept-Encoding')
    expect(response.body.length).toBe(0)
  })

  it.each([
    ['CSV 匯出', 'text/csv; charset=utf-8'],
    ['純文字', 'text/plain'],
    ['JSON 字樣不在開頭', 'text/x-json-like'],
  ])('不是 JSON（%s）：不壓縮、不加 Vary，照原本串流', async (_label, contentType) => {
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': contentType, etag: '"o"' })
      res.end(LIST)
    }
    const proxy = await startProxy()
    const response = await rawRequest(proxy, RECORDS, { headers: { 'accept-encoding': 'gzip' } })
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.headers.vary).toBeUndefined()
    expect(response.body.equals(LIST)).toBe(true)
  })

  it('HEAD：不讀本文、不壓縮', async () => {
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', etag: '"o"' })
      res.end()
    }
    const proxy = await startProxy()
    const response = await rawRequest(proxy, '/api/website/v1/admin/admissions/area/boundaries', { method: 'HEAD', headers: { 'accept-encoding': 'gzip' } })
    expect(response.status).toBe(200)
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.headers.etag).toBe('"o"')
  })

  it('本文讀到一半斷線：回 502、no-store、不帶 ETag', async () => {
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(LIST.length), etag: '"o"', 'cache-control': 'private, max-age=60' })
      res.write(LIST.subarray(0, 1024))
      setTimeout(() => res.destroy(), 20)
    }
    const proxy = await startProxy()
    const response = await rawRequest(proxy, RECORDS, { headers: { 'accept-encoding': 'gzip' } })
    expect(response.status).toBe(502)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers.etag).toBeUndefined()
  })

  it('同樣的回應連續兩次都壓（不快取：後台資料每次都可能不同）', async () => {
    let n = 0
    upstreamHandler = (_req, res) => {
      const body = Buffer.from(JSON.stringify({ n: ++n, rows: JSON.parse(LIST.toString()) }))
      res.writeHead(200, { 'content-type': 'application/json', etag: '"same"' })
      res.end(body)
    }
    const proxy = await startProxy()
    const first = await rawRequest(proxy, RECORDS, { headers: { 'accept-encoding': 'gzip' } })
    const second = await rawRequest(proxy, RECORDS, { headers: { 'accept-encoding': 'gzip' } })
    expect(JSON.parse(gunzipSync(first.body).toString()).n).toBe(1)
    expect(JSON.parse(gunzipSync(second.body).toString()).n).toBe(2)
  })
})

describe('createJsonGzip：壓縮失敗退回原樣', () => {
  it('壓縮函式丟錯：原樣送出、不帶 Content-Encoding', async () => {
    const body = Buffer.from(JSON.stringify({ rows: 'x'.repeat(4000) }))
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(body)
    }
    const upstreamPort = await startUpstream()
    const onResponse = createJsonGzip(() => Promise.reject(new Error('zlib 壞了')))
    const app = createApp().use(defineEventHandler(event => proxyRequest(event, `http://127.0.0.1:${upstreamPort}/json`, { onResponse })))
    const proxy = await listen(createServer(toNodeListener(app)))
    const response = await rawRequest(proxy, '/json', { headers: { 'accept-encoding': 'gzip' } })
    expect(response.status).toBe(200)
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.headers['content-length']).toBe(String(body.length))
    expect(response.body.equals(body)).toBe(true)
  })
})

describe('壓縮結果依 ETag 快取一筆', () => {
  function counting() {
    const calls: number[] = []
    const compress = vi.fn(async (input: Buffer) => {
      calls.push(input.length)
      return gzipSync(input)
    })
    return { compress, calls }
  }
  const getGz = (port: number) => rawRequest(port, '/', { headers: { 'accept-encoding': 'gzip' } })

  it('同一個 ETag 不重壓，回的位元組相同', async () => {
    geoUpstream('"e1"')
    const { compress } = counting()
    const proxy = await startCountingProxy(compress)
    const first = await getGz(proxy)
    const second = await getGz(proxy)
    const third = await getGz(proxy)
    expect(compress).toHaveBeenCalledTimes(1)
    expect(second.body.equals(first.body)).toBe(true)
    expect(third.body.equals(first.body)).toBe(true)
    expect(gunzipSync(third.body).equals(GEOJSON)).toBe(true)
  })

  it('ETag 變了就重壓並換掉；上限一筆，換回舊 ETag 也要重壓', async () => {
    const { compress } = counting()
    const proxy = await startCountingProxy(compress)
    const bodyB = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [], note: 'B' }))
    geoUpstream('"e1"', GEOJSON)
    await getGz(proxy)
    geoUpstream('"e2"', bodyB)
    const changed = await getGz(proxy)
    expect(compress).toHaveBeenCalledTimes(2)
    expect(changed.headers.etag).toBe('"e2"')
    expect(gunzipSync(changed.body).equals(bodyB)).toBe(true)
    await getGz(proxy)
    expect(compress).toHaveBeenCalledTimes(2)
    geoUpstream('"e1"', GEOJSON)
    const back = await getGz(proxy)
    expect(compress).toHaveBeenCalledTimes(3)
    expect(gunzipSync(back.body).equals(GEOJSON)).toBe(true)
  })

  it('同時進來的同一個 ETag 只壓一次', async () => {
    geoUpstream('"e1"')
    const { compress } = counting()
    const proxy = await startCountingProxy(compress)
    const responses = await Promise.all(Array.from({ length: 5 }, () => getGz(proxy)))
    expect(compress).toHaveBeenCalledTimes(1)
    for (const response of responses) expect(gunzipSync(response.body).equals(GEOJSON)).toBe(true)
  })

  it('ETag 相同但本文長度不同（不該發生）：不信快取，重壓', async () => {
    const { compress } = counting()
    const proxy = await startCountingProxy(compress)
    geoUpstream('"e1"', GEOJSON)
    await getGz(proxy)
    const other = Buffer.from('{"type":"FeatureCollection","features":[]}')
    geoUpstream('"e1"', other)
    const response = await getGz(proxy)
    expect(compress).toHaveBeenCalledTimes(2)
    expect(gunzipSync(response.body).equals(other)).toBe(true)
  })

  it('上游沒有 ETag：每次都壓，不快取', async () => {
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/geo+json' })
      res.end(GEOJSON)
    }
    const { compress } = counting()
    const proxy = await startCountingProxy(compress)
    await getGz(proxy)
    await getGz(proxy)
    expect(compress).toHaveBeenCalledTimes(2)
  })

  it('304 與不收 gzip 的客戶端不觸發壓縮', async () => {
    geoUpstream('"e1"')
    const { compress } = counting()
    const proxy = await startCountingProxy(compress)
    await rawRequest(proxy, '/', { headers: { 'accept-encoding': 'gzip', 'if-none-match': '"e1"' } })
    await rawRequest(proxy, '/', { headers: { 'accept-encoding': 'identity' } })
    await rawRequest(proxy, '/')
    expect(compress).not.toHaveBeenCalled()
  })

  it('壓縮失敗：退回原樣（不壓）送出，失敗不留在快取裡', async () => {
    geoUpstream('"e1"')
    let fail = true
    const compress = vi.fn(async (input: Buffer) => {
      if (fail) throw new Error('zlib boom')
      return gzipSync(input)
    })
    const proxy = await startCountingProxy(compress)
    const broken = await getGz(proxy)
    expect(broken.status).toBe(200)
    expect(broken.headers['content-encoding']).toBeUndefined()
    expect(broken.body.equals(GEOJSON)).toBe(true)
    fail = false
    const recovered = await getGz(proxy)
    expect(compress).toHaveBeenCalledTimes(2)
    expect(recovered.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(recovered.body).equals(GEOJSON)).toBe(true)
  })
})
