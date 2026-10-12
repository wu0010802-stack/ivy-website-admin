// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, eventHandler, setResponseHeader, toNodeListener, type H3Event } from 'h3'

const servers: Server[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections()
    server.close(() => resolve())
  })))
})

// 把真的 preview-headers middleware 掛進 h3 app，用實際 HTTP 請求看回應標頭。
async function serve(indexingEnabled = true) {
  vi.stubGlobal('defineEventHandler', eventHandler)
  vi.stubGlobal('setResponseHeader', setResponseHeader)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { indexingEnabled } }))
  const { default: middleware } = await import('../server/middleware/preview-headers')
  const app = createApp()
  app.use(middleware as (event: H3Event) => void)
  app.use(eventHandler(() => 'ok'))
  const server = createServer(toNodeListener(app))
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
}

describe('預覽與家長修改頁的快取與索引標頭', () => {
  it('/visit/manage 不快取、不索引、不帶 referrer；路徑大小寫與結尾斜線都一樣', async () => {
    const base = await serve()
    for (const path of ['/visit/manage', '/visit/manage/', '/Visit/Manage', '/VISIT/manage/', '/visit/manage?t=abc']) {
      const response = await fetch(`${base}${path}`)
      expect(response.headers.get('cache-control'), path).toBe('private, no-store')
      expect(response.headers.get('x-robots-tag'), path).toBe('noindex, nofollow')
      expect(response.headers.get('referrer-policy'), path).toBe('no-referrer')
    }
  })

  it('/preview 與 /admin 不快取、不索引，路徑大小寫不影響（Nuxt 路由不分大小寫）', async () => {
    const base = await serve()
    for (const path of ['/preview', '/Preview', '/PREVIEW?embed=1', '/admin/x', '/Admin/x']) {
      const response = await fetch(`${base}${path}`)
      expect(response.headers.get('cache-control'), path).toBe('private, no-store')
      expect(response.headers.get('x-robots-tag'), path).toBe('noindex, nofollow')
    }
  })

  it('其他 /visit 頁只是不索引，維持可進 back/forward cache', async () => {
    const base = await serve()
    for (const path of ['/visit', '/Visit', '/visit/done']) {
      const response = await fetch(`${base}${path}`)
      expect(response.headers.get('cache-control'), path).toBe('no-cache, max-age=0')
      expect(response.headers.get('x-robots-tag'), path).toBe('noindex, nofollow')
      expect(response.headers.get('referrer-policy'), path).toBeNull()
    }
  })

  it('一般頁面不加 no-store 與 noindex', async () => {
    const base = await serve()
    const response = await fetch(`${base}/about`)
    expect(response.headers.get('cache-control')).toBeNull()
    expect(response.headers.get('x-robots-tag')).toBeNull()
  })
})
