import { describe, expect, it } from 'vitest'
import { createTelemetryQuota, TELEMETRY_QUOTA } from '../server/utils/telemetry-quota'

describe('/api/telemetry 配額（稽核 telemetry-global-quota-exhaustion）', () => {
  it('單一來源用完自己的額度，其他訪客照常回報', () => {
    const quota = createTelemetryQuota({ perSource: 3, global: 100, windowMs: 60_000, maxSources: 10 })
    const now = 1_000_000
    expect([1, 2, 3, 4].map(() => quota.admit('203.0.113.9', now))).toEqual([true, true, true, false])
    expect(quota.admit('198.51.100.7', now)).toBe(true)
  })

  it('全站上限是最後保險', () => {
    const quota = createTelemetryQuota({ perSource: 5, global: 4, windowMs: 60_000, maxSources: 10 })
    const now = 1_000_000
    expect(['a', 'b', 'c', 'd', 'e'].map(source => quota.admit(source, now))).toEqual([true, true, true, true, false])
  })

  it('每個窗口重新計算', () => {
    const quota = createTelemetryQuota({ perSource: 1, global: 100, windowMs: 60_000, maxSources: 10 })
    expect(quota.admit('a', 0)).toBe(true)
    expect(quota.admit('a', 59_999)).toBe(false)
    expect(quota.admit('a', 60_000)).toBe(true)
  })

  it('記住的來源數有上限，大量換來源不會吃光記憶體', () => {
    const quota = createTelemetryQuota({ perSource: 5, global: 1000, windowMs: 60_000, maxSources: 2 })
    expect(quota.admit('a', 0)).toBe(true)
    expect(quota.admit('b', 0)).toBe(true)
    expect(quota.admit('c', 0)).toBe(false)
    expect(quota.admit('a', 0)).toBe(true)
    expect(quota.size()).toBe(2)
  })

  it('預設：每來源每分鐘 60 筆，全站 3000 筆', () => {
    expect(TELEMETRY_QUOTA).toEqual({ perSource: 60, global: 3000, windowMs: 60_000, maxSources: 10_000 })
  })
})

describe('/api/telemetry 端點以 trustedClientIp 分桶', () => {
  it('一個來源被擋成 429，另一個來源照常 204', async () => {
    const { createServer } = await import('node:http')
    const h3 = await import('h3')
    const { vi } = await import('vitest')
    const { trustedClientIp } = await import('../server/utils/client-ip')
    for (const name of ['defineEventHandler', 'setResponseHeader', 'setResponseStatus', 'getHeader', 'createError', 'getRequestURL'] as const) vi.stubGlobal(name, h3[name])
    vi.stubGlobal('trustedClientIp', trustedClientIp)
    vi.stubGlobal('useRuntimeConfig', () => ({ websiteApiInternalBase: 'http://api.test', trustedProxyHops: 1, public: { telemetryEnabled: true, siteOrigin: '' } }))
    const stored: string[] = []
    vi.stubGlobal('$fetch', vi.fn(async (_url: string, init: { headers: Record<string, string> }) => { stored.push(init.headers['x-website-client-ip'] ?? '') }))
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      const { default: handler } = await import('../server/api/telemetry.post')
      // Nitro 的路由是 preemptive：handler 回 undefined 時照 setResponseStatus 送出（這裡是 204）。
      const server = createServer(h3.toNodeListener(h3.createApp().use(h3.eventHandler(async event => (await handler(event)) ?? null))))
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`
      const send = (ip: string) => fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ event: 'page_view', page: 'home', campus: null, device: 'mobile' })
      }).then(response => response.status)
      const flood: number[] = []
      for (let i = 0; i < 61; i++) flood.push(await send('2001:db8:1:2::1'.replace('::1', `::${i + 1}`)))
      expect(flood.slice(0, 60)).toEqual(Array(60).fill(204))
      expect(flood[60]).toBe(429)
      expect(await send('203.0.113.9')).toBe(204)
      expect(new Set(stored)).toEqual(new Set(['2001:db8:1:2::', '203.0.113.9']))
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    } finally {
      info.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
