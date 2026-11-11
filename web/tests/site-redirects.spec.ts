// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, eventHandler, getRequestHeader, sendRedirect, setResponseHeader, toNodeListener, type H3Event } from 'h3'
import { isCanonicalHost, LEGACY_REDIRECTS, normalizeLegacyPath, parseRedirectHosts, resolveSiteRedirect } from '../server/utils/site-redirects'

const ORIGIN = 'https://www.ivykidschool.com'
const RAILWAY = 'web-production-04caa.up.railway.app'
const none = new Set<string>()
const hosts = parseRedirectHosts(`ivykidschool.com, ${RAILWAY}`, ORIGIN)
const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/')

function resolve(url: string, opts: { host?: string, method?: string, redirectHosts?: ReadonlySet<string>, siteOrigin?: string } = {}) {
  return resolveSiteRedirect({
    method: opts.method ?? 'GET',
    host: opts.host ?? RAILWAY,
    url,
    siteOrigin: opts.siteOrigin ?? ORIGIN,
    redirectHosts: opts.redirectHosts ?? none
  })
}

describe('舊 Wix 網址對照', () => {
  it('瀏覽器送來的百分比編碼路徑轉到新頁，查詢字串保留', () => {
    expect(resolve(enc('/分班表'))).toBe('/admission#classes')
    expect(resolve(`${enc('/收退費辦法')}?lang=en&utm_source=fb`)).toBe('/admission?lang=en&utm_source=fb#fees')
    expect(resolve(enc('/常春藤入學-admission'))).toBe('/admission')
    expect(resolve(enc('/一日流程'))).toBe('/#life')
  })

  it('大小寫、結尾斜線、未編碼都認得', () => {
    expect(resolve(`${enc('/教學特色-COURSE')}/`)).toBe('/curriculum')
    expect(resolve('/常春藤環境-environment')).toBe('/environment')
  })

  it('分校介紹頁帶校別到首頁五校卡，原網址的參數照帶、目標的 campus 優先', () => {
    expect(resolve(enc('/仁武校介紹'))).toBe('/?campus=renwu#campuses')
    expect(resolve(`${enc('/明華校介紹')}?campus=yihua&ref=old`)).toBe('/?campus=minghua&ref=old#campuses')
  })

  it('新站本來就有的路徑與沒列入對照的舊網址不轉（不會全部導回首頁）', () => {
    for (const path of ['/', '/about', '/admission', '/news', '/visit/yihua', '/admin/', enc('/作品照片分享'), enc('/副本-2025冬令營'), '/blank-page']) {
      expect(resolve(path), path).toBeNull()
    }
  })

  it('只轉 GET／HEAD，表單送出不轉；壞掉的編碼不轉', () => {
    expect(resolve(enc('/分班表'), { method: 'HEAD' })).toBe('/admission#classes')
    expect(resolve(enc('/分班表'), { method: 'POST' })).toBeNull()
    expect(resolve('/%E5%88%86%')).toBeNull()
    expect(normalizeLegacyPath('/%zz')).toBeNull()
  })

  it('對照表的目標都是站內路徑，鍵都已正規化', () => {
    for (const [key, target] of Object.entries(LEGACY_REDIRECTS)) {
      expect(normalizeLegacyPath(key), key).toBe(key)
      expect(target, key).toMatch(/^\/(?!\/)/)
    }
  })
})

describe('主網域轉址（NUXT_REDIRECT_HOSTS）', () => {
  it('預設不設＝任何主機都不轉，Railway 暫用網址照常可測', () => {
    expect(resolve('/about', { host: RAILWAY })).toBeNull()
    expect(resolve('/about', { host: 'ivykidschool.com' })).toBeNull()
  })

  it('設了以後 apex 與 Railway 網址 301 到正式網址，路徑與查詢字串保留', () => {
    expect(resolve('/about?x=1', { host: 'ivykidschool.com', redirectHosts: hosts })).toBe(`${ORIGIN}/about?x=1`)
    expect(resolve('/', { host: `${RAILWAY}:443`, redirectHosts: hosts })).toBe(`${ORIGIN}/`)
    expect(resolve('/', { host: 'IVYKIDSCHOOL.COM.', redirectHosts: hosts })).toBe(`${ORIGIN}/`)
  })

  it('舊網址在 apex 上一次轉到底', () => {
    expect(resolve(`${enc('/分班表')}?a=1`, { host: 'ivykidschool.com', redirectHosts: hosts })).toBe(`${ORIGIN}/admission?a=1#classes`)
  })

  it('正式網址本身、未列入的主機、API 與 release.json 不轉', () => {
    expect(resolve('/about', { host: 'www.ivykidschool.com', redirectHosts: hosts })).toBeNull()
    expect(resolve('/about', { host: 'evil.example', redirectHosts: hosts })).toBeNull()
    expect(resolve('/api/website/v1/health', { host: RAILWAY, redirectHosts: hosts })).toBeNull()
    expect(resolve('/release.json?commit=abc', { host: RAILWAY, redirectHosts: hosts })).toBeNull()
  })

  it('沒有有效正式網址就不轉；清單裡跟正式網址同主機的會被忽略', () => {
    expect(resolve('/about', { host: RAILWAY, redirectHosts: hosts, siteOrigin: '' })).toBeNull()
    expect([...parseRedirectHosts('www.ivykidschool.com, https://x.com, ivykidschool.com', ORIGIN)]).toEqual(['ivykidschool.com'])
  })
})

describe('robots.txt 只在正式網址主機開放', () => {
  it('Host 與正式網址相同才算', () => {
    expect(isCanonicalHost('www.ivykidschool.com', ORIGIN)).toBe(true)
    expect(isCanonicalHost('WWW.IVYKIDSCHOOL.COM:443', ORIGIN)).toBe(true)
    expect(isCanonicalHost('ivykidschool.com', ORIGIN)).toBe(false)
    expect(isCanonicalHost(RAILWAY, ORIGIN)).toBe(false)
    expect(isCanonicalHost(undefined, ORIGIN)).toBe(false)
    expect(isCanonicalHost(RAILWAY, '')).toBe(false)
  })
})

const servers: Server[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.resetModules()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(done => {
    server.closeAllConnections()
    server.close(() => done())
  })))
})

async function serve(config: { siteOrigin: string, redirectHosts: string }) {
  vi.stubGlobal('defineEventHandler', eventHandler)
  vi.stubGlobal('getRequestHeader', getRequestHeader)
  vi.stubGlobal('setResponseHeader', setResponseHeader)
  vi.stubGlobal('sendRedirect', sendRedirect)
  // contentMode: 'fixture'：舊站入學網址會先讀已發布內容看入學資訊分頁有沒有被隱藏（tests/admission-toggle.spec.ts），這裡用內建內容＝顯示。
  vi.stubGlobal('useRuntimeConfig', () => ({ redirectHosts: config.redirectHosts, websiteEnv: 'test', websiteApiInternalBase: '', public: { siteOrigin: config.siteOrigin, contentMode: 'fixture' } }))
  const { default: middleware } = await import('../server/middleware/00.site-redirects')
  const app = createApp()
  app.use(middleware as (event: H3Event) => void)
  app.use(eventHandler(() => 'page'))
  const server = createServer(toNodeListener(app))
  servers.push(server)
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
}

describe('middleware 實際回應', () => {
  it('舊網址回 301 與 Location，其他頁照常', async () => {
    const base = await serve({ siteOrigin: `https://${RAILWAY}`, redirectHosts: '' })
    const moved = await fetch(`${base}${enc('/新生入園須知')}?q=1`, { redirect: 'manual' })
    expect(moved.status).toBe(301)
    expect(moved.headers.get('location')).toBe('/admission?q=1#newcomer')
    const page = await fetch(`${base}/about`, { redirect: 'manual' })
    expect(page.status).toBe(200)
  })

  it('開了主網域轉址：列入的 Host 轉到正式網址', async () => {
    const base = await serve({ siteOrigin: ORIGIN, redirectHosts: '127.0.0.1' })
    const moved = await fetch(`${base}/about?x=1`, { redirect: 'manual' })
    expect(moved.status).toBe(301)
    expect(moved.headers.get('location')).toBe(`${ORIGIN}/about?x=1`)
    const api = await fetch(`${base}/api/website/v1/health`, { redirect: 'manual' })
    expect(api.status).toBe(200)
  })
})
