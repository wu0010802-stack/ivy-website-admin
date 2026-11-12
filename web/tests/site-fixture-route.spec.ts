// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

// GET /api/site-fixture（server/api/site-fixture.get.ts）：完整 fixture 含未發布內容。
// 2026-11-12：執行期把正式環境設錯成 fixture 模式時，不能不驗身分就送出去。

async function call(config: { websiteEnv: string; contentMode: string }, cookie?: string) {
  vi.resetModules()
  const h3 = await import('h3')
  for (const name of ['defineEventHandler', 'setResponseHeader', 'getHeader', 'createError'] as const) vi.stubGlobal(name, h3[name])
  vi.stubGlobal('useRuntimeConfig', () => ({ websiteApiInternalBase: 'http://api.test', websiteEnv: config.websiteEnv, public: { contentMode: config.contentMode } }))
  const fetchApi = vi.fn(async () => ({}))
  vi.stubGlobal('$fetch', fetchApi)
  const { default: handler } = await import('../server/api/site-fixture.get')
  const event = h3.createEvent(
    { headers: cookie ? { cookie } : {}, method: 'GET', url: '/api/site-fixture' } as never,
    { setHeader: () => undefined, getHeader: () => undefined } as never,
  )
  try {
    return { body: await handler(event), status: 200, fetchApi }
  } catch (error) {
    return { body: undefined, status: (error as { statusCode?: number }).statusCode, fetchApi }
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('/api/site-fixture', () => {
  it('本機 fixture 模式直接回示範資料', async () => {
    const result = await call({ websiteEnv: 'development', contentMode: 'fixture' })
    expect(result.status).toBe(200)
    expect(result.body).toBeTruthy()
  })

  it('正式環境被設成 fixture 模式時回 503，不送出未發布內容', async () => {
    const result = await call({ websiteEnv: 'production', contentMode: 'fixture' })
    expect(result.status).toBe(503)
    expect(result.body).toBeUndefined()
  })

  it('正式內容模式沒有 cookie 回 401', async () => {
    const result = await call({ websiteEnv: 'production', contentMode: 'live' })
    expect(result.status).toBe(401)
    expect(result.fetchApi).not.toHaveBeenCalled()
  })

  it('正式內容模式要 API 認得這個 session 才回', async () => {
    const result = await call({ websiteEnv: 'production', contentMode: 'live' }, 'ivy_admin_session=s')
    expect(result.status).toBe(200)
    expect(result.fetchApi).toHaveBeenCalledOnce()
  })
})
