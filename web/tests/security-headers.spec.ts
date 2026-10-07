// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { createHooks } from 'hookable'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, eventHandler, setResponseHeader, toNodeListener, type H3Event } from 'h3'
import { ADMIN_CSP, securityHeadersFor } from '../server/utils/security-headers'

describe('資安標頭', () => {
  it('公開頁維持原本的 CSP（Nuxt 的 inline script 不受影響）', () => {
    const headers = securityHeadersFor('/campuses/yihua?x=1', 'production')
    expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'self'; base-uri 'self'; object-src 'none'")
    expect(headers['X-Frame-Options']).toBe('SAMEORIGIN')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000')
    expect(headers['Cache-Control']).toBeUndefined()
  })

  it('後台一律用嚴格 CSP（縱深防禦；admin-same-origin-as-public-site 僅部分緩解、仍未關閉）', () => {
    for (const path of ['/admin', '/admin/', '/admin/index.html', '/admin/visit-requests', '/admin/assets/index-abc.js']) {
      const headers = securityHeadersFor(path, 'production')
      expect(headers['Content-Security-Policy']).toBe(ADMIN_CSP)
      expect(headers['X-Robots-Tag']).toBe('noindex, nofollow')
    }
    expect(ADMIN_CSP).toContain("script-src 'self';")
    expect(ADMIN_CSP).not.toContain("'unsafe-eval'")
    expect(ADMIN_CSP).toContain("frame-ancestors 'self'")
  })

  it('後台可以用 iframe 嵌同源的 /preview（內容編輯右側預覽），/preview 只給同源嵌', () => {
    expect(ADMIN_CSP).toContain("frame-src 'self'")
    const preview = securityHeadersFor('/preview?embed=1&live=1', 'production')
    expect(preview['Content-Security-Policy']).toBe("frame-ancestors 'self'; base-uri 'self'; object-src 'none'")
    expect(preview['X-Frame-Options']).toBe('SAMEORIGIN')
  })

  it('後台入口不快取；有雜湊的後台資源照常快取', () => {
    for (const path of ['/admin', '/admin/', '/admin/index.html']) {
      expect(securityHeadersFor(path, 'production')['Cache-Control']).toBe('private, no-store')
    }
    expect(securityHeadersFor('/admin/assets/index-abc.js', 'production')['Cache-Control']).toBeUndefined()
  })

  it('麥克風只在 /anniversary 開給同源（吹蠟燭），其他頁與 iframe 一律關閉', () => {
    for (const path of ['/anniversary', '/anniversary/', '/anniversary?x=1']) {
      expect(securityHeadersFor(path, 'production')['Permissions-Policy']).toBe('camera=(), microphone=(self), geolocation=(), payment=(), usb=(), browsing-topics=()')
    }
    for (const path of ['/', '/about', '/visit', '/anniversary-x', '/anniversary/x', '/admin/']) {
      expect(securityHeadersFor(path, 'production')['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()')
    }
  })

  it('/administrator 之類的路徑不算後台；HSTS 只在正式環境送', () => {
    expect(securityHeadersFor('/administrator', 'production')['Content-Security-Policy']).not.toBe(ADMIN_CSP)
    expect(securityHeadersFor('/', 'development')['Strict-Transport-Security']).toBeUndefined()
  })
})

const servers: Server[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections()
    server.close(() => resolve())
  })))
})

it('靜態資源處理器（排在所有 middleware 之前）回的 /admin/ 也帶標頭（稽核 static-admin-entry-no-security-headers）', async () => {
  vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
  vi.stubGlobal('useRuntimeConfig', () => ({ websiteEnv: 'production' }))
  vi.stubGlobal('setResponseHeader', setResponseHeader)
  const { default: plugin } = await import('../server/plugins/security-headers')
  const hooks = createHooks<{ request: (event: H3Event) => void }>()
  ;(plugin as (app: { hooks: typeof hooks }) => void)({ hooks })
  // 同 nitropack：onRequest 呼叫 request hook，接著第一個 handler 就是靜態資源。
  const app = createApp({ onRequest: event => hooks.callHook('request', event) })
  app.use(eventHandler((event) => {
    if (event.path === '/admin/' || event.path === '/assets/x.webp') return 'static'
  }))
  const server = createServer(toNodeListener(app))
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

  const admin = await fetch(`${base}/admin/`)
  expect(await admin.text()).toBe('static')
  expect(admin.headers.get('content-security-policy')).toBe(ADMIN_CSP)
  expect(admin.headers.get('x-frame-options')).toBe('SAMEORIGIN')
  expect(admin.headers.get('x-content-type-options')).toBe('nosniff')
  expect(admin.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
  expect(admin.headers.get('strict-transport-security')).toBe('max-age=31536000')
  expect(admin.headers.get('cache-control')).toBe('private, no-store')
  expect(admin.headers.get('x-robots-tag')).toBe('noindex, nofollow')

  const asset = await fetch(`${base}/assets/x.webp`)
  expect(asset.headers.get('x-content-type-options')).toBe('nosniff')
  expect(asset.headers.get('content-security-policy')).toBe("frame-ancestors 'self'; base-uri 'self'; object-src 'none'")
})
