// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createApp, eventHandler, toNodeListener } from 'h3'
import { createServer, request } from 'node:http'
import { decideAdminHost, normalizeHost } from '../server/utils/admin-host'

// 後台獨立子網域的 Host 分流（2026-11-12，server/utils/admin-host.ts）。預設關閉。

const SITE = 'https://www.ivykidschool.com'
const ADMIN = 'admin.ivykidschool.com'
const decide = (host: string, url: string, method = 'GET', adminHost = ADMIN) =>
  decideAdminHost({ adminHost, host, method, url, siteOrigin: SITE })

describe('沒設 NUXT_ADMIN_HOST：一律照舊', () => {
  it.each(['/admin/', '/preview', '/api/website/v1/admin/users', '/api/website/v1/auth/login', '/'])('%s', (url) => {
    expect(decide('www.ivykidschool.com', url, 'GET', '')).toEqual({ action: 'pass' })
  })
})

describe('官網主機（www）', () => {
  it('後台頁與草稿預覽 301 到後台主機，路徑與查詢字串照帶', () => {
    expect(decide('www.ivykidschool.com', '/admin/visit-requests?status=confirmed')).toEqual({ action: 'redirect', location: 'https://admin.ivykidschool.com/admin/visit-requests?status=confirmed', status: 301 })
    expect(decide('www.ivykidschool.com', '/admin')).toMatchObject({ action: 'redirect', location: 'https://admin.ivykidschool.com/admin' })
    expect(decide('www.ivykidschool.com', '/preview?page=home')).toMatchObject({ action: 'redirect', location: 'https://admin.ivykidschool.com/preview?page=home' })
    expect(decide('www.ivykidschool.com', '/api/site-fixture')).toMatchObject({ action: 'redirect' })
  })

  it.each([
    '/api/website/v1/admin/users',
    '/api/website/v1/auth/me',
    '/api/website/v1/auth/login',
    '/api/website/v1/auth/google/callback?code=x',
    '/api/website/v1//admin/users',
    '/api/website/v1/%61dmin/users',
  ])('後台與登入 API 一律 404：%s', (url) => {
    expect(decide('www.ivykidschool.com', url, 'POST')).toEqual({ action: 'not-found' })
    expect(decide('www.ivykidschool.com', url, 'GET')).toEqual({ action: 'not-found' })
  })

  it('後台頁的寫入方法不轉址（轉址會讓瀏覽器改用 GET），直接 404', () => {
    expect(decide('www.ivykidschool.com', '/admin/x', 'POST')).toEqual({ action: 'not-found' })
  })

  it.each(['/', '/visit', '/visit/manage', '/api/website/v1/public/visit-requests', '/api/website/v1/public/visit-manage/exchange', '/api/website/v1/line/webhook', '/api/published-site', '/administrator', '/previews'])('公開頁與公開 API 照常：%s', (url) => {
    expect(decide('www.ivykidschool.com', url, 'POST')).toEqual({ action: 'pass' })
  })
})

describe('後台主機', () => {
  it.each([
    '/admin/', '/admin/assets/index-abc.js', '/admin/sw.js', '/preview?page=news',
    '/api/website/v1/admin/users', '/api/website/v1/auth/login', '/api/website/v1/public/media/x/file', '/api/website/v1/line/webhook', '/api/website/v1/health',
    '/api/site-fixture', '/api/published-site', '/api/client-errors', '/_nuxt/entry.js', '/assets/fonts/x.woff2', '/favicon.ico', '/release.json',
  ])('後台、預覽、API 與靜態檔照常：%s', (url) => {
    expect(decide('admin.ivykidschool.com', url)).toEqual({ action: 'pass' })
  })

  it('首頁轉到 /admin/', () => {
    expect(decide('admin.ivykidschool.com', '/')).toEqual({ action: 'redirect', location: '/admin/', status: 302 })
  })

  it('公開頁 301 回官網（家長點到舊連結也不會停在後台主機）', () => {
    expect(decide('admin.ivykidschool.com', '/visit/manage')).toEqual({ action: 'redirect', location: 'https://www.ivykidschool.com/visit/manage', status: 301 })
    expect(decide('ADMIN.ivykidschool.com:443', '/news?x=1')).toEqual({ action: 'redirect', location: 'https://www.ivykidschool.com/news?x=1', status: 301 })
  })

  it('公開頁的寫入或官網 origin 沒設時 404', () => {
    expect(decide('admin.ivykidschool.com', '/visit', 'POST')).toEqual({ action: 'not-found' })
    expect(decideAdminHost({ adminHost: ADMIN, host: ADMIN, method: 'GET', url: '/visit', siteOrigin: '' })).toEqual({ action: 'not-found' })
  })
})

describe('normalizeHost', () => {
  it('去連接埠、轉小寫；怪字元回空字串', () => {
    expect(normalizeHost('Admin.IvyKidSchool.com:8443')).toBe('admin.ivykidschool.com')
    expect(normalizeHost('evil.com/admin')).toBe('')
    expect(normalizeHost(undefined)).toBe('')
  })
})

describe('外掛排在靜態檔之前', () => {
  it('官網主機的 /admin/ 靜態入口被轉走，靜態處理器不會送出後台 HTML', async () => {
    const { vi } = await import('vitest')
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    vi.stubGlobal('useRuntimeConfig', () => ({ adminHost: ADMIN, public: { siteOrigin: SITE } }))
    const { default: plugin } = await import('../server/plugins/admin-host')
    const app = createApp()
    app.use(eventHandler(() => '<html>admin entry</html>'))
    ;(plugin as (nitro: { h3App: typeof app }) => void)({ h3App: app })
    const server = createServer(toNodeListener(app))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    const get = (host: string, path: string) => new Promise<{ status: number; location?: string; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, body }))
      })
      req.on('error', reject)
      req.end()
    })
    try {
      const www = await get('www.ivykidschool.com', '/admin/')
      expect(www.status).toBe(301)
      expect(www.location).toBe('https://admin.ivykidschool.com/admin/')
      expect(www.body).not.toContain('admin entry')
      const api = await get('www.ivykidschool.com', '/api/website/v1/auth/me')
      expect(api.status).toBe(404)
      const admin = await get('admin.ivykidschool.com', '/admin/')
      expect(admin.status).toBe(200)
      expect(admin.body).toContain('admin entry')
    } finally {
      vi.unstubAllGlobals()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
