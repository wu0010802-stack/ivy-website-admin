import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLIENT_ERROR_QUOTA, createClientErrorQuota } from '../server/utils/client-error-quota'
import { TELEMETRY_QUOTA } from '../server/utils/telemetry-quota'

// POST /api/client-errors（server/api/client-errors.post.ts）：開關、來源檢查、本文上限、白名單驗證、
// 獨立配額、轉送給 API 的 header，以及「API 不通照樣回 204」。比照 telemetry.spec.ts／telemetry-quota.spec.ts。

const servers: Server[] = []
const report = (overrides: Record<string, unknown> = {}) => ({ source: 'web', kind: 'TypeError', message: 'x is not a function', path: '/campuses/yihua', ...overrides })

async function start(config: { errorReportsEnabled?: boolean; siteOrigin?: string } = {}) {
  vi.resetModules()
  const h3 = await import('h3')
  const { trustedClientIp } = await import('../server/utils/client-ip')
  for (const name of ['defineEventHandler', 'setResponseHeader', 'setResponseStatus', 'getHeader', 'createError', 'getRequestURL'] as const) vi.stubGlobal(name, h3[name])
  vi.stubGlobal('trustedClientIp', trustedClientIp)
  vi.stubGlobal('useRuntimeConfig', () => ({
    websiteApiInternalBase: 'http://api.test', trustedProxyHops: 1, errorReportsEnabled: config.errorReportsEnabled ?? true,
    public: { siteOrigin: config.siteOrigin ?? '' },
  }))
  const forwarded: { url: string; body: unknown; headers: Record<string, string>; timeout: number }[] = []
  const fetchApi = vi.fn(async (url: string, init: { body: unknown; headers: Record<string, string>; timeout: number }) => { forwarded.push({ url, ...init }) })
  vi.stubGlobal('$fetch', fetchApi)
  const { default: handler } = await import('../server/api/client-errors.post')
  const server = createServer(h3.toNodeListener(h3.createApp().use(h3.eventHandler(async (event) => (await handler(event)) ?? null))))
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { post, forwarded, fetchApi, url }
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) })))
})

describe('開關', () => {
  it('關閉（非 production）時直接回 204，不驗證也不轉送', async () => {
    const { post, forwarded } = await start({ errorReportsEnabled: false })
    expect((await post(report())).status).toBe(204)
    expect((await post('not json at all')).status).toBe(204)
    expect(forwarded).toEqual([])
  })
})

describe('轉送', () => {
  it('合法回報：回 204，轉給 API 的 client-errors，帶訪客 IP 與 User-Agent，2 秒逾時', async () => {
    const { post, forwarded } = await start()
    const body = report({ stack: 'TypeError: x\n    at f (/_nuxt/a.js:1:2)', release: 'build-1' })
    const response = await post(body, { 'user-agent': 'Mozilla/5.0 test' })
    expect(response.status).toBe(204)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(forwarded).toHaveLength(1)
    expect(forwarded[0]).toMatchObject({
      url: 'http://api.test/api/website/v1/public/client-errors', body,
      headers: { 'x-website-client-ip': '203.0.113.9', 'user-agent': 'Mozilla/5.0 test' }, timeout: 2000,
    })
  })
  it('User-Agent 截到 300 字', async () => {
    const { post, forwarded } = await start()
    await post(report(), { 'user-agent': 'u'.repeat(900) })
    expect(forwarded[0]!.headers['user-agent']).toHaveLength(300)
  })
  it('API 不通：只記 warn，仍回 204', async () => {
    const { post, fetchApi } = await start()
    fetchApi.mockImplementation(() => Promise.reject(new Error('api down')) as never)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      expect((await post(report())).status).toBe(204)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('website_client_error_store_failed'))
    } finally {
      warn.mockRestore()
    }
  })
})

describe('擋下什麼', () => {
  it('壞 JSON、多餘欄位、不合法的值都回 400，不轉送也不佔配額', async () => {
    const { post, forwarded } = await start()
    for (const bad of ['{nope', report({ ip: '1.2.3.4' }), report({ source: 'api' }), report({ message: 'm'.repeat(501) }), report({ path: 'no-slash' })]) {
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(400)
    }
    expect(forwarded).toEqual([])
    for (let i = 0; i < 20; i++) expect((await post(report({ message: `ok ${i}` }))).status).toBe(204) // 無效請求沒有吃掉 20 筆額度
  })
  it('本文超過 8192 bytes 回 413（有 Content-Length 與分塊傳輸都擋）', async () => {
    const { post, forwarded, url } = await start()
    expect((await post(report({ stack: 's'.repeat(9000) }))).status).toBe(413)
    const chunked = JSON.stringify(report({ stack: 's'.repeat(9000) }))
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(chunked)); controller.close() } })
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit)
    expect(response.status).toBe(413)
    expect(forwarded).toEqual([])
  })
  it('跨站請求與別的 origin 回 403', async () => {
    const { post, forwarded } = await start({ siteOrigin: 'https://site.example' })
    expect((await post(report(), { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await post(report(), { origin: 'https://evil.example' })).status).toBe(403)
    expect((await post(report(), { origin: 'https://site.example' })).status).toBe(204)
    expect(forwarded).toHaveLength(1)
  })
})

describe('爬蟲與無畫面瀏覽器（2026-11-13）', () => {
  it('Lightpanda、Googlebot 之類的回報回 204 但不轉送，也不佔配額', async () => {
    const { post, forwarded } = await start()
    for (let i = 0; i < 25; i++) expect((await post(report({ message: `bot ${i}` }), { 'user-agent': 'Lightpanda/1.0' })).status).toBe(204)
    expect((await post(report(), { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' })).status).toBe(204)
    expect(forwarded).toEqual([])
    // 同一個來源的真人回報照收：前面 26 筆沒有吃掉每分鐘 20 筆的額度
    expect((await post(report(), { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.8 Mobile/15E148 Safari/604.1' })).status).toBe(204)
    expect(forwarded).toHaveLength(1)
  })
  it('格式不對的本文照樣回 400（爬蟲也一樣，先驗證再看 User-Agent）', async () => {
    const { post } = await start()
    expect((await post('{nope', { 'user-agent': 'Lightpanda/1.0' })).status).toBe(400)
  })
})

describe('配額（獨立於 telemetry）', () => {
  it('預設：每來源每分鐘 20 筆、全站 300 筆，和 telemetry 的 60／3000 是兩組', () => {
    expect(CLIENT_ERROR_QUOTA).toEqual({ perSource: 20, global: 300, windowMs: 60_000, maxSources: 10_000 })
    expect(CLIENT_ERROR_QUOTA).not.toEqual(TELEMETRY_QUOTA)
    const first = createClientErrorQuota()
    const second = createClientErrorQuota()
    for (let i = 0; i < 20; i++) expect(first.admit('a', 0)).toBe(true)
    expect(first.admit('a', 0)).toBe(false)
    expect(second.admit('a', 0)).toBe(true) // 各自計數，不共用
  })
  it('一個來源被擋成 429，另一個來源照常 204', async () => {
    const { post, forwarded } = await start()
    const flood: number[] = []
    for (let i = 0; i < 21; i++) flood.push((await post(report({ message: `flood ${i}` }), { 'x-forwarded-for': `2001:db8:1:2::${i + 1}` })).status)
    expect(flood.slice(0, 20)).toEqual(Array(20).fill(204))
    expect(flood[20]).toBe(429)
    expect((await post(report(), { 'x-forwarded-for': '198.51.100.7' })).status).toBe(204)
    expect(new Set(forwarded.map((call) => call.headers['x-website-client-ip']))).toEqual(new Set(['2001:db8:1:2::', '198.51.100.7']))
    expect(forwarded).toHaveLength(21)
  })
})
