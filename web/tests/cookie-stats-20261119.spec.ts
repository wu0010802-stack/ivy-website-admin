import { describe, expect, it, vi } from 'vitest'
import { encodeAttribution } from '../shared/attribution-cookie'
import { validateEngagement } from '../shared/engagement'
import { engagementSession, startVisit } from '../app/utils/engagement'

// 前台 cookie 帶來的後台統計（2026-11-19，docs/specs/2026-11-19-cookie-stats-design.md）。

const SESSION = { id: '4b0c8a52-1f0e-4f43-9d4f-1d3a6e7c2b10', source: 'direct' as const, pages: 1 }
const VISIT_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

function memoryStorage() {
  const map = new Map<string, string>()
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) } }
}

describe('記住的校區（ivy_campus）跟著造訪送出', () => {
  it('新造訪記下當時記住的校區，之後換頁沿用；不認得的值不記', () => {
    const storage = memoryStorage()
    const session = engagementSession(storage, () => 'direct', undefined, { day: '2026-11-19', newArrival: true, pref: 'minghua' })
    expect(session.pref).toBe('minghua')
    expect(engagementSession(storage, () => 'direct', undefined, { day: '2026-11-19', newArrival: false, pref: 'yihua' }).pref).toBe('minghua')
    expect(engagementSession(memoryStorage(), () => 'direct', undefined, { day: '2026-11-19', newArrival: true, pref: 'tokyo' }).pref).toBeUndefined()
  })

  it('回報帶 pref，驗證只收五校代碼', () => {
    const payload = startVisit('/', { ...SESSION, pref: 'renwu' }, 'mobile', VISIT_ID)!.takePayload()!
    expect(payload.pref).toBe('renwu')
    expect(validateEngagement(payload)).not.toBeNull()
    expect(validateEngagement({ ...payload, pref: 'tokyo' })).toBeNull()
  })

  it('瀏覽器端送不進匿名代號：browser 欄位一律拒收', () => {
    const payload = startVisit('/', SESSION, 'mobile', VISIT_ID)!.takePayload()!
    expect(validateEngagement({ ...payload, browser: 'AAAAAAAAAAAAAAAAAAAAAA' })).toBeNull()
  })
})

describe('/api/telemetry 從 ivy_src 附上匿名代號', () => {
  async function serve() {
    const { createServer } = await import('node:http')
    const h3 = await import('h3')
    const { trustedClientIp } = await import('../server/utils/client-ip')
    for (const name of ['defineEventHandler', 'setResponseHeader', 'setResponseStatus', 'getHeader', 'getCookie', 'createError', 'getRequestURL'] as const) vi.stubGlobal(name, h3[name])
    vi.stubGlobal('trustedClientIp', trustedClientIp)
    vi.stubGlobal('useRuntimeConfig', () => ({ websiteApiInternalBase: 'http://api.test', trustedProxyHops: 1, public: { telemetryEnabled: true, siteOrigin: '' } }))
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('$fetch', vi.fn(async (_url: string, init: { body: Record<string, unknown> }) => { bodies.push(init.body) }))
    const { default: handler } = await import('../server/api/telemetry.post')
    const server = createServer(h3.toNodeListener(h3.createApp().use(h3.eventHandler(async event => (await handler(event)) ?? null))))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`
    const close = async () => {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      vi.unstubAllGlobals()
    }
    return { url, bodies, close }
  }
  const cookie = `ivy_src=${encodeAttribution({ v: 1, f: { s: 'direct', d: '2026-11-19' }, i: 'AbCdEfGhIjKlMnOpQrStUv' })}`
  const engagement = () => startVisit('/', SESSION, 'mobile', VISIT_ID)!.takePayload()!

  it('內容興趣回報帶代號；瀏覽量回報不帶；DNT／GPC 不帶', async () => {
    const { url, bodies, close } = await serve()
    try {
      const post = (body: unknown, headers: Record<string, string> = {}) => fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie, ...headers }, body: JSON.stringify(body)
      }).then(response => response.status)
      expect(await post(engagement())).toBe(204)
      expect(await post({ event: 'page_view', page: 'home', campus: null, device: 'mobile' })).toBe(204)
      expect(await post(engagement(), { dnt: '1' })).toBe(204)
      expect(await post(engagement(), { 'sec-gpc': '1' })).toBe(204)
      expect(bodies.map(body => body.browser)).toEqual(['AbCdEfGhIjKlMnOpQrStUv', undefined, undefined, undefined])
    } finally {
      await close()
    }
  })

  it('沒有 cookie 或 cookie 裡沒有代號就不帶', async () => {
    const { url, bodies, close } = await serve()
    try {
      const legacy = `ivy_src=${encodeAttribution({ v: 1, f: { s: 'direct', d: '2026-11-19' } })}`
      for (const header of [{}, { cookie: legacy }]) {
        await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...header }, body: JSON.stringify(engagement()) })
      }
      expect(bodies.map(body => 'browser' in body)).toEqual([false, false])
    } finally {
      await close()
    }
  })
})
