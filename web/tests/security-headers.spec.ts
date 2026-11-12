// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { createHooks } from 'hookable'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, eventHandler, setResponseHeader, toNodeListener, type H3Event } from 'h3'
import { ADMIN_CSP, publicCsp, securityHeadersFor } from '../server/utils/security-headers'

describe('資安標頭', () => {
  it('公開頁預設 CSP 限制腳本來源（2026-11-04）：同源＋登記過的 inline 雜湊，不放 unsafe-inline／eval', () => {
    const headers = securityHeadersFor('/campuses/yihua?x=1', 'production')
    const csp = headers['Content-Security-Policy']
    expect(csp).toBe(publicCsp())
    expect(csp).toMatch(/^script-src 'self' https:\/\/challenges\.cloudflare\.com 'sha256-[A-Za-z0-9+/]+=*'/)
    expect(csp).toContain("script-src-attr 'none'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain("frame-ancestors 'self'; base-uri 'self'; object-src 'none'")
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toContain('strict-dynamic')
    expect(headers['X-Frame-Options']).toBe('SAMEORIGIN')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains')
    expect(headers['Cache-Control']).toBeUndefined()
  })

  it('公開頁限制圖片、連線與內嵌框的來源（2026-11-12）', () => {
    const csp = securityHeadersFor('/', 'production')['Content-Security-Policy']
    expect(csp).toContain("img-src 'self' data: blob: https://i.ytimg.com;")
    expect(csp).toContain("connect-src 'self' https://challenges.cloudflare.com;")
    expect(csp).toContain("frame-src 'self' https://www.youtube-nocookie.com https://challenges.cloudflare.com;")
    expect(csp).not.toContain('default-src')
    // nuxt dev 不收 script-src，但資源來源照收不收都沒差：只留原本三條
    expect(securityHeadersFor('/', 'production', { scriptPolicy: false })['Content-Security-Policy']).not.toContain('img-src')
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

  it('百分比編碼的後台路徑（/%61dmin/）照樣套後台 CSP：nitro 靜態處理器會先解碼再找檔', () => {
    for (const path of ['/%61dmin/', '/%61dmin/index.html', '/a%64min', '/%61dmin/assets/index-abc.js?v=1']) {
      const headers = securityHeadersFor(path, 'production')
      expect(headers['Content-Security-Policy'], path).toBe(ADMIN_CSP)
      expect(headers['X-Robots-Tag'], path).toBe('noindex, nofollow')
    }
    expect(securityHeadersFor('/%61dmin/', 'production')['Cache-Control']).toBe('private, no-store')
    expect(securityHeadersFor('/%61dmin/index.html', 'production')['Cache-Control']).toBe('private, no-store')
    // 不合法的編碼不會讓標頭計算丟例外。
    expect(securityHeadersFor('/%E0%A4%A', 'production')['Content-Security-Policy']).not.toBe(ADMIN_CSP)
    // %2F 不解（同 decodePath），/admin%2F 不是後台目錄。
    expect(securityHeadersFor('/x%2F..%2Fadmin', 'production')['Content-Security-Policy']).not.toBe(ADMIN_CSP)
  })

  it('後台可以用 iframe 嵌同源的 /preview（內容編輯右側預覽），/preview 只給同源嵌', () => {
    expect(ADMIN_CSP).toContain("frame-src 'self'")
    const preview = securityHeadersFor('/preview?embed=1&live=1', 'production')
    expect(preview['Content-Security-Policy']).toBe(publicCsp())
    expect(preview['X-Frame-Options']).toBe('SAMEORIGIN')
  })

  it('後台地圖的底圖圖磚只放行國土測繪中心（招生區域分析，2026-10-08）；公開頁不變', () => {
    expect(ADMIN_CSP).toContain("img-src 'self' data: blob: https://wmts.nlsc.gov.tw;")
    expect(ADMIN_CSP).not.toMatch(/img-src[^;]*\*/)
    expect(ADMIN_CSP).toContain("connect-src 'self';")
    expect(securityHeadersFor('/', 'production')['Content-Security-Policy']).not.toContain('nlsc')
  })

  it('後台是 PWA：worker-src 與 manifest-src 明寫 self（2026-11-05），不放行其他來源', () => {
    expect(ADMIN_CSP).toContain("worker-src 'self';")
    expect(ADMIN_CSP).toContain("manifest-src 'self';")
    expect(ADMIN_CSP).not.toMatch(/(?:worker|manifest)-src[^;]*(?:https?:|\*|blob:|data:)/)
    // 其餘規則不因此放寬：腳本仍只收同源、連線仍只連同源。
    expect(ADMIN_CSP).toContain("script-src 'self';")
    expect(ADMIN_CSP).toContain("connect-src 'self';")
    // 公開頁不帶這兩條。
    expect(securityHeadersFor('/', 'production')['Content-Security-Policy']).not.toContain('worker-src')
    expect(securityHeadersFor('/admin/sw.js', 'production')['Content-Security-Policy']).toBe(ADMIN_CSP)
    expect(securityHeadersFor('/admin/manifest.webmanifest', 'production')['Content-Security-Policy']).toBe(ADMIN_CSP)
  })

  it('/admin/sw.js 與 /admin/manifest.webmanifest 每次重新驗證（no-cache）；其他後台檔案不受影響', () => {
    for (const path of ['/admin/sw.js', '/admin/sw.js?v=2', '/admin/manifest.webmanifest', '/%61dmin/sw.js', '/admin/%73w.js']) {
      const headers = securityHeadersFor(path, 'production')
      expect(headers['Cache-Control'], path).toBe('no-cache')
      expect(headers['X-Robots-Tag'], path).toBe('noindex, nofollow')
    }
    // 圖示沒有雜湊但很少變，照一般靜態檔處理（不設 Cache-Control）；入口仍是 no-store；有雜湊的資源不變。
    expect(securityHeadersFor('/admin/pwa-192.png', 'production')['Cache-Control']).toBeUndefined()
    expect(securityHeadersFor('/admin/', 'production')['Cache-Control']).toBe('private, no-store')
    expect(securityHeadersFor('/admin/assets/index-abc.js', 'production')['Cache-Control']).toBeUndefined()
    // 前台同名的檔案不是後台的 worker。
    expect(securityHeadersFor('/sw.js', 'production')['Cache-Control']).toBeUndefined()
    expect(securityHeadersFor('/admin/sub/sw.js', 'production')['Cache-Control']).toBeUndefined()
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

  it('nuxt dev 不收 script-src（Vite／devtools 會插入其他 inline script），其他規則照舊', () => {
    expect(securityHeadersFor('/', 'development', { scriptPolicy: false })['Content-Security-Policy'])
      .toBe("frame-ancestors 'self'; base-uri 'self'; object-src 'none'")
    expect(securityHeadersFor('/admin/', 'development', { scriptPolicy: false })['Content-Security-Policy']).toBe(ADMIN_CSP)
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
  expect(admin.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains')
  expect(admin.headers.get('cache-control')).toBe('private, no-store')
  expect(admin.headers.get('x-robots-tag')).toBe('noindex, nofollow')

  const asset = await fetch(`${base}/assets/x.webp`)
  expect(asset.headers.get('x-content-type-options')).toBe('nosniff')
  expect(asset.headers.get('content-security-policy')).toBe(publicCsp())
})
