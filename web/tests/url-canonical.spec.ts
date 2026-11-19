// @vitest-environment node
import { readdirSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, eventHandler, toNodeListener } from 'h3'
import { PAGE_ROOTS, canonicalPageLocation, decideUrlCanonical } from '../server/utils/url-canonical'
import { isValidHostHeader, normalizeHost } from '../server/utils/admin-host'

// 頁面網址只有一種寫法（2026-11-12 QA L27／L4／L5）：連續斜線收成一個、去尾斜線（/ 與 /admin/ 除外）、
// 第一段是已知頁面時轉小寫，一律 301；Host 標頭格式錯誤直接 400，不進 SSR。
// 純函式在 server/utils/url-canonical.ts，由 server/plugins/url-canonical.ts 排在靜態資源處理器之前套用。

const canon = (url: string, method = 'GET') => canonicalPageLocation(url, method)

describe('PAGE_ROOTS 跟 app/pages 的頁面一致（新增頁面路由時要補）', () => {
  it('每個頁面的第一段都在清單裡，清單裡除了後台（/admin 是靜態 SPA）都有對應的頁面', () => {
    const pagesDir = fileURLToPath(new URL('../app/pages', import.meta.url))
    const roots = readdirSync(pagesDir).map(name => name.replace(/\.vue$/, '')).filter(name => name !== 'index')
    expect([...roots].sort()).toEqual([...PAGE_ROOTS].filter(name => name !== 'admin').sort())
  })
})

describe('canonicalPageLocation：要轉址的寫法', () => {
  it.each([
    // 去尾斜線
    ['/about/', '/about'],
    ['/curriculum/', '/curriculum'],
    ['/visit/yihua/', '/visit/yihua'],
    ['/visit/manage/', '/visit/manage'],
    ['/news/ABC/', '/news/ABC'],
    ['/preview/', '/preview'],
    // 第一段轉小寫
    ['/About', '/about'],
    ['/ABOUT', '/about'],
    ['/Visit/yihua', '/visit/yihua'],
    ['/Preview', '/preview'],
    ['/News/ABC', '/news/ABC'],
    ['/Admin/', '/admin/'],
    // 連續斜線
    ['//about', '/about'],
    ['///about', '/about'],
    ['/about//', '/about'],
    ['/visit//yihua', '/visit/yihua'],
    ['///admin/', '/admin/'],
    ['//admin//', '/admin/'],
    ['///Preview', '/preview'],
    // 三者疊在一起、只轉一次
    ['//About//', '/about'],
    ['///News//ABC//', '/news/ABC'],
    // 百分比編碼的第一段（路由會解碼，等於另一個網址）
    ['/%61bout', '/about'],
    ['/%41BOUT/', '/about'],
    // 後面的段落一律不動（消息 id、校區代碼大小寫有意義）
    ['/About/Team/', '/about/Team'],
    ['/Visit/YiHua', '/visit/YiHua'],
    // /admin/ 底下除了收斜線與第一段大小寫，其他都不動（尾斜線不去）
    ['/Admin/visit-requests', '/admin/visit-requests'],
    ['/admin//visit-requests/', '/admin/visit-requests/'],
    // 只有斜線
    ['//', '/'],
    ['////', '/']
  ])('%s → %s', (url, expected) => {
    expect(canon(url)).toBe(expected)
  })

  it('查詢字串原樣帶過去，包括問號後的斜線與大小寫', () => {
    expect(canon('/about/?x=1')).toBe('/about?x=1')
    expect(canon('/About?utm_source=FB&q=//a/')).toBe('/about?utm_source=FB&q=//a/')
    expect(canon('//about?x=1')).toBe('/about?x=1')
    expect(canon('/about/?')).toBe('/about?')
    expect(canon('//?campus=yihua')).toBe('/?campus=yihua')
    expect(canon('///admin/?next=%2Fvisit')).toBe('/admin/?next=%2Fvisit')
  })

  it('HEAD 也轉', () => {
    expect(canon('/about/', 'HEAD')).toBe('/about')
    expect(canon('/about/', 'head')).toBe('/about')
  })
})

describe('canonicalPageLocation：不轉址的寫法', () => {
  it.each([
    '/', '/?campus=yihua', '/about', '/about?x=1', '/curriculum', '/environment', '/admission', '/news', '/news/ABC',
    '/visit', '/visit/yihua', '/visit/manage', '/privacy', '/anniversary', '/preview', '/preview?page=home',
    // /admin/ 本身與底下的路徑：尾斜線是後台 SPA 的正規寫法
    '/admin', '/admin/', '/admin/?x=1', '/admin/visit-requests', '/admin/visit-requests/', '/admin/assets/index-abc123.js', '/admin/sw.js', '/admin/manifest.webmanifest',
    // API、建置產物、靜態資源、內部路徑完全不碰
    '/api/website/v1/health', '/api/website/v1/health/', '/api/website/v1//public//site', '//api/website/v1/health/', '/API/website/v1/health/',
    '/_nuxt/entry.abc123.js', '/_nuxt/', '//_nuxt/x/', '/assets/fonts/x.woff2', '/assets/', '/__nuxt_error', '/__nuxt_island/x/', '/.well-known/security.txt',
    '/robots.txt', '/sitemap.xml', '/llms.txt', '/release.json', '/favicon.ico', '/apple-touch-icon.png',
    // 帶副檔名的路徑
    '/news/a.b', '/about.html', '//robots.txt', '/Preview/x.png',
    // 不是頁面的路徑不碰（也不會憑空多一次轉址）
    '/foo/', '/Foo', '//foo', '/administrator/', '/previews/', '/About-us/'
  ])('%s', (url) => {
    expect(canon(url)).toBeNull()
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('%s 不轉（轉址會讓瀏覽器改用 GET）', (method) => {
    expect(canon('/about/', method)).toBeNull()
    expect(canon('///admin/', method)).toBeNull()
  })

  it('舊 Wix 網址交給 site-redirects 一次轉到底，不先轉去尾斜線', () => {
    expect(canon('/%E5%88%86%E7%8F%AD%E8%A1%A8/')).toBeNull()
    expect(canon('/%E5%88%86%E7%8F%AD%E8%A1%A8')).toBeNull()
  })
})

describe('canonicalPageLocation：Location 一定是站內單斜線路徑（沒有開放轉址）', () => {
  it.each([
    '/\\evil.com/', '/about\\/', '/about/\\evil.com', '//\\evil.com/about/', '/%5Cevil.com',
    '/about/\t', '/about/ ', '/about/\n', '/about/é/', '/about/中文/'
  ])('含反斜線、空白、控制字元或非 ASCII 的路徑不轉址：%j', (url) => {
    expect(canon(url)).toBeNull()
  })

  it.each([
    '//evil.com', '//evil.com/', '///evil.com/about/', '//about//evil.com//', '/about//evil.com//', '//About/evil.com'
  ])('轉出去的網址不會以兩個斜線開頭：%s', (url) => {
    const location = canon(url)
    if (location !== null) {
      expect(location.startsWith('/')).toBe(true)
      expect(location.startsWith('//')).toBe(false)
    }
  })
})

describe('canonicalPageLocation：轉出去的網址再轉一次不會再變（不會繞圈）', () => {
  it.each([
    '/about/', '/About', '//about', '///Admin//', '//Visit//YiHua//?a=1', '/%41bout/', '//', '/Preview/', '/admin//x/', '//News//a//b//'
  ])('%s', (url) => {
    const first = canon(url)
    expect(first).not.toBeNull()
    expect(canon(first as string)).toBeNull()
  })
})

describe('decideUrlCanonical：Host 先驗、再看網址', () => {
  const decide = (url: string, host: string | undefined = 'www.ivykidschool.com', method = 'GET') => decideUrlCanonical({ host, method, url })

  it('Host 格式錯誤 → bad-host（不論方法與路徑，連靜態檔與 API 都一樣）', () => {
    for (const host of ['127.0.0.1:abc', '127.0.0.1:99999', 'a b', 'a/b', 'user@evil.com', 'evil.com:80:90', '', ' ', '[::1', '::1', 'ex%41mple.com', 'a\\b']) {
      expect(decide('/', host), host).toEqual({ action: 'bad-host' })
      expect(decide('/api/website/v1/health', host, 'POST'), host).toEqual({ action: 'bad-host' })
      expect(decide('/_nuxt/x.js', host), host).toEqual({ action: 'bad-host' })
    }
  })

  it('Host 合法（含 IPv6、連接埠、大小寫、結尾點、底線）→ 往下看網址', () => {
    for (const host of ['www.ivykidschool.com', 'WWW.IvyKidSchool.com:443', '127.0.0.1:3000', 'localhost', 'localhost:', '[::1]', '[::1]:3000', '[2001:db8::1]:8080', 'example.com.', 'web_1:3000', 'healthcheck.railway.app']) {
      expect(decide('/', host), host).toEqual({ action: 'pass' })
    }
  })

  it('沒有 Host 標頭（HTTP/1.0）不算格式錯誤', () => {
    expect(decide('/', undefined)).toEqual({ action: 'pass' })
  })

  it('非正規網址 → redirect；正規網址 → pass', () => {
    expect(decide('/about/')).toEqual({ action: 'redirect', location: '/about' })
    expect(decide('///admin/')).toEqual({ action: 'redirect', location: '/admin/' })
    expect(decide('/Preview')).toEqual({ action: 'redirect', location: '/preview' })
    expect(decide('/about')).toEqual({ action: 'pass' })
    expect(decide('/admin/')).toEqual({ action: 'pass' })
    expect(decide('/about/', 'www.ivykidschool.com', 'POST')).toEqual({ action: 'pass' })
  })
})

describe('Host 標頭合法性（admin-host.ts）', () => {
  it('isValidHostHeader：數字連接埠 0–65535、IPv6 方括號、不收怪字元', () => {
    expect(isValidHostHeader('127.0.0.1:3000')).toBe(true)
    expect(isValidHostHeader('127.0.0.1:65535')).toBe(true)
    expect(isValidHostHeader('127.0.0.1:65536')).toBe(false)
    expect(isValidHostHeader('127.0.0.1:abc')).toBe(false)
    expect(isValidHostHeader('[::1]:3000')).toBe(true)
    expect(isValidHostHeader('[::1]:abc')).toBe(false)
    expect(isValidHostHeader('[::1]x')).toBe(false)
    expect(isValidHostHeader('')).toBe(false)
    expect(isValidHostHeader(undefined)).toBe(true)
  })

  it('normalizeHost：IPv6 去連接埠後留方括號；既有行為不變', () => {
    expect(normalizeHost('[::1]:3000')).toBe('[::1]')
    expect(normalizeHost('[::1]')).toBe('[::1]')
    expect(normalizeHost('Admin.IvyKidSchool.com:8443')).toBe('admin.ivykidschool.com')
    expect(normalizeHost('evil.com/admin')).toBe('')
    expect(normalizeHost('127.0.0.1:abc')).toBe('')
    expect(normalizeHost(undefined)).toBe('')
  })
})

describe('外掛排在靜態檔之前（用真的 HTTP 請求）', () => {
  const servers: ReturnType<typeof createServer>[] = []
  afterEach(async () => {
    vi.unstubAllGlobals()
    await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })))
  })

  async function serve() {
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    vi.stubGlobal('useRuntimeConfig', () => ({ public: {} }))
    const { default: plugin } = await import('../server/plugins/url-canonical')
    const app = createApp()
    // 後面接一層「靜態檔」：任何路徑都送出假的後台 HTML，用來證明被攔下的請求到不了它。
    app.use(eventHandler(() => '<html>static entry</html>'))
    ;(plugin as (nitro: { h3App: typeof app }) => void)({ h3App: app })
    const server = createServer(toNodeListener(app))
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    return (path: string, options: { host?: string; method?: string } = {}) => new Promise<{ status: number; message: string; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
      const headers: Record<string, string> = {}
      if (options.host !== undefined) headers.host = options.host
      const req = request({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers }, (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, message: res.statusMessage ?? '', headers: res.headers, body }))
      })
      req.on('error', reject)
      req.end()
    })
  }

  it('非正規網址 301，靜態處理器不會送出後台 HTML；Location 是站內單斜線路徑', async () => {
    const get = await serve()
    for (const [path, location] of [['///admin/', '/admin/'], ['/about/', '/about'], ['/About?x=1', '/about?x=1'], ['//news//ABC/', '/news/ABC'], ['/Preview', '/preview']] as const) {
      const response = await get(path)
      expect(response.status, path).toBe(301)
      expect(response.headers.location, path).toBe(location)
      expect(response.body, path).not.toContain('static entry')
      expect(response.headers['cache-control'], path).toBe('public, max-age=3600')
    }
  })

  it('HEAD 也轉；POST 不轉、照常往後送', async () => {
    const get = await serve()
    const head = await get('/about/', { method: 'HEAD' })
    expect(head.status).toBe(301)
    expect(head.headers.location).toBe('/about')
    const post = await get('/about/', { method: 'POST' })
    expect(post.status).toBe(200)
    expect(post.body).toContain('static entry')
  })

  it('正規網址、API、靜態檔照常往後送', async () => {
    const get = await serve()
    for (const path of ['/', '/about', '/admin/', '/api/website/v1/health/', '/_nuxt/x.js', '/robots.txt', '/news/ABC']) {
      const response = await get(path)
      expect(response.status, path).toBe(200)
      expect(response.body, path).toContain('static entry')
    }
  })

  it('Host 格式錯誤 → 400 純文字，不往後送', async () => {
    const get = await serve()
    for (const host of ['127.0.0.1:abc', '127.0.0.1:99999', 'a b']) {
      const response = await get('/', { host })
      expect(response.status, host).toBe(400)
      expect(response.message, host).toBe('Bad Request')
      expect(response.headers['content-type'], host).toBe('text/plain; charset=utf-8')
      expect(response.body, host).not.toContain('static entry')
      expect(response.body.length, host).toBeLessThan(80)
    }
  })

  it('合法的 Host（含 IPv6）不受影響', async () => {
    const get = await serve()
    for (const host of ['127.0.0.1:3000', '[::1]:3000', 'www.ivykidschool.com']) {
      const response = await get('/', { host })
      expect(response.status, host).toBe(200)
    }
  })
})
