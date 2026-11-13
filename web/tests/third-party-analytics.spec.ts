// @vitest-environment node
import { createHooks } from 'hookable'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  analyticsCspSources, analyticsEnabled, analyticsIdsFromConfig, analyticsPageLocation, analyticsSuppressedPath,
  normalizeGaMeasurementId, normalizeMetaPixelId, type AnalyticsIds
} from '../shared/third-party-analytics'
import { publicScriptSources, scriptHashSource } from '../server/utils/script-csp'
import { ADMIN_CSP, PUBLIC_RESOURCE_CSP, publicCsp, securityHeadersFor } from '../server/utils/security-headers'

// GA4＋Meta Pixel（2026-11-12 規格第 1 節）的純函式與伺服器端 CSP。瀏覽器端載入與事件在
// third-party-analytics-runtime.spec.ts。

const NONE: AnalyticsIds = { gaMeasurementId: null, metaPixelId: null }
const GA: AnalyticsIds = { gaMeasurementId: 'G-TEST123456', metaPixelId: null }
const PIXEL: AnalyticsIds = { gaMeasurementId: null, metaPixelId: '1234567890123456' }
const BOTH: AnalyticsIds = { gaMeasurementId: 'G-TEST123456', metaPixelId: '1234567890123456' }

describe('ID 格式驗證（不符視同未設定）', () => {
  it('GA4 評估 ID：G- 開頭、大寫英數；前後空白會修掉', () => {
    expect(normalizeGaMeasurementId('G-ABC123DEF4')).toBe('G-ABC123DEF4')
    expect(normalizeGaMeasurementId('  G-ABC123DEF4\n')).toBe('G-ABC123DEF4')
    for (const bad of ['', 'g-abc123def4', 'UA-12345-1', 'GTM-ABCDEF', 'G-', 'G-AB', 'G-ABC 123', 'G-ABC123"></script>', 'G-' + 'A'.repeat(21), 'https://x.test/G-ABC123DEF4']) {
      expect(normalizeGaMeasurementId(bad), bad).toBeNull()
    }
    expect(normalizeGaMeasurementId(undefined)).toBeNull()
    expect(normalizeGaMeasurementId(123456)).toBeNull()
  })

  it('Meta Pixel ID：純數字 8–20 碼', () => {
    expect(normalizeMetaPixelId('1234567890123456')).toBe('1234567890123456')
    expect(normalizeMetaPixelId(' 12345678 ')).toBe('12345678')
    for (const bad of ['', '1234567', '12345678901234567890 1', '12a45678901', 'fb-1234567890', '1234567890123456789012', '１２３４５６７８９０']) {
      expect(normalizeMetaPixelId(bad), bad).toBeNull()
    }
    expect(normalizeMetaPixelId(null)).toBeNull()
  })

  it('Nitro 會把純數字的環境變數解析成 number：收安全整數，失真或不合理的數字視同未設定', () => {
    expect(normalizeMetaPixelId(1234567890123456)).toBe('1234567890123456')
    expect(normalizeMetaPixelId(123456789012345)).toBe('123456789012345')
    expect(normalizeMetaPixelId(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991')
    for (const bad of [9876543210987654, 12345678901234567890, 1234567, 0, -12345678, 1.5e8 + 0.5, NaN, Infinity]) {
      expect(normalizeMetaPixelId(bad), String(bad)).toBeNull()
    }
    // 連雙引號一起填時 destr 解析成字串，大於 MAX_SAFE_INTEGER 的 ID 靠這個辦法保持完整
    expect(normalizeMetaPixelId('9876543210987654')).toBe('9876543210987654')
    expect(analyticsIdsFromConfig({ public: { gaMeasurementId: 'G-ABC123DEF4', metaPixelId: 1234567890123456 } }))
      .toEqual({ gaMeasurementId: 'G-ABC123DEF4', metaPixelId: '1234567890123456' })
  })

  it('從 runtimeConfig 取：沒有 public、鍵不存在、格式不符都是 null', () => {
    expect(analyticsIdsFromConfig(undefined)).toEqual(NONE)
    expect(analyticsIdsFromConfig({})).toEqual(NONE)
    expect(analyticsIdsFromConfig({ websiteEnv: 'production' })).toEqual(NONE)
    expect(analyticsIdsFromConfig({ public: { gaMeasurementId: '', metaPixelId: '' } })).toEqual(NONE)
    expect(analyticsIdsFromConfig({ public: { gaMeasurementId: 'UA-1', metaPixelId: 'abc' } })).toEqual(NONE)
    expect(analyticsIdsFromConfig({ public: { gaMeasurementId: 'G-TEST123456', metaPixelId: '1234567890123456' } })).toEqual(BOTH)
    expect(analyticsEnabled(NONE)).toBe(false)
    expect(analyticsEnabled(GA)).toBe(true)
    expect(analyticsEnabled(PIXEL)).toBe(true)
  })
})

describe('不送事件的路徑', () => {
  it('預約修改頁、後台、草稿預覽（含子路徑、尾端斜線）', () => {
    for (const path of ['/visit/manage', '/visit/manage/', '/visit/manage/abc', '/admin', '/admin/', '/admin/content/news', '/preview', '/preview/']) {
      expect(analyticsSuppressedPath(path), path).toBe(true)
    }
  })

  it('大小寫、編碼、重複斜線都擋：vue-router 預設不分大小寫，/Visit/Manage 一樣進得了修改頁', () => {
    for (const path of ['/Visit/Manage', '/VISIT/MANAGE/', '/visit/%6Danage', '/visit%2Fmanage', '//visit//manage', '/ADMIN/', '/%61dmin/']) {
      expect(analyticsSuppressedPath(path), path).toBe(true)
    }
  })

  it('其他公開頁照送，包括長得像但不是的路徑', () => {
    for (const path of ['/', '/visit', '/visit/yihua', '/visit/manager', '/visit/managed', '/about', '/news/abc', '/administrator', '/previews', '/anniversary']) {
      expect(analyticsSuppressedPath(path), path).toBe(false)
    }
  })

  it('解不開的 % 序列用原字串比對，不丟例外', () => {
    expect(analyticsSuppressedPath('/visit/manage%E0%A4%A')).toBe(false)
    expect(analyticsSuppressedPath('/admin/%E0%A4%A')).toBe(true)
  })
})

describe('page_location 清洗', () => {
  const base = 'https://www.ivykidschool.com'

  it('origin＋pathname；hash 與一般 query 拿掉', () => {
    expect(analyticsPageLocation(`${base}/visit/yihua#token=secret`)).toBe(`${base}/visit/yihua`)
    expect(analyticsPageLocation(`${base}/about?ref=abc&x=1#chapter`)).toBe(`${base}/about`)
    expect(analyticsPageLocation(`${base}/`)).toBe(`${base}/`)
  })

  it('只保留 utm_*、gclid、fbclid（鍵不分大小寫），順序照原本', () => {
    expect(analyticsPageLocation(`${base}/?utm_source=fb&utm_medium=cpc&email=a%40b.c&gclid=GCL1&fbclid=FB1&token=zzz&UTM_Campaign=spring`))
      .toBe(`${base}/?utm_source=fb&utm_medium=cpc&gclid=GCL1&fbclid=FB1&UTM_Campaign=spring`)
    expect(analyticsPageLocation(`${base}/visit?utm_term=a+b%26c`)).toBe(`${base}/visit?utm_term=a+b%26c`)
  })

  // 2026-11-13：iPhone 上的 Google 廣告點擊常常沒有 gclid，改帶 gbraid／wbraid；濾掉的話 GA4 匯進 Google Ads 的轉換會漏算這些點擊。
  it('Google 廣告在 iOS 用的點擊代碼 gbraid、wbraid 也保留', () => {
    expect(analyticsPageLocation(`${base}/visit/yihua?wbraid=WB1&token=zzz&gbraid=GB1&utm_campaign=gads-yihua`))
      .toBe(`${base}/visit/yihua?wbraid=WB1&gbraid=GB1&utm_campaign=gads-yihua`)
    expect(analyticsPageLocation(`${base}/?WBRAID=WB2#frag`)).toBe(`${base}/?WBRAID=WB2`)
    expect(analyticsPageLocation(`${base}/?gbraidx=1&xwbraid=2&braid=3`)).toBe(`${base}/`)
  })

  it('不像歸因的鍵不能夾帶：utm 開頭但沒有底線、gclid 前綴、重複 utm', () => {
    expect(analyticsPageLocation(`${base}/?utmx=1&gclidx=2&xgclid=3&utm=4`)).toBe(`${base}/`)
    expect(analyticsPageLocation(`${base}/?utm_source=a&utm_source=b`)).toBe(`${base}/?utm_source=a&utm_source=b`)
  })

  it('相對網址搭配 base；帶帳密的網址不會把帳密送出去', () => {
    expect(analyticsPageLocation('/about?x=1#y', base)).toBe(`${base}/about`)
    expect(analyticsPageLocation('https://user:pass@www.ivykidschool.com/a?utm_source=x#h')).toBe(`${base}/a?utm_source=x`)
  })
})

describe('CSP 來源（analyticsCspSources）', () => {
  it('都沒設：三個陣列都是空的', () => {
    expect(analyticsCspSources(NONE)).toEqual({ script: [], connect: [], img: [] })
  })

  it('只有 GA：只加 Google 的網域', () => {
    expect(analyticsCspSources(GA)).toEqual({
      script: ['https://www.googletagmanager.com'],
      connect: ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com'],
      img: ['https://*.google-analytics.com', 'https://www.googletagmanager.com']
    })
  })

  it('只有 Pixel：只加 Meta 的網域', () => {
    expect(analyticsCspSources(PIXEL)).toEqual({
      script: ['https://connect.facebook.net'],
      connect: ['https://www.facebook.com', 'https://connect.facebook.net'],
      img: ['https://www.facebook.com']
    })
  })
})

describe('公開頁 CSP', () => {
  const resources = "img-src 'self' data: blob: https://i.ytimg.com; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://www.youtube-nocookie.com https://challenges.cloudflare.com"
  const base = "frame-ancestors 'self'; base-uri 'self'; object-src 'none'"
  const original = `script-src ${publicScriptSources()}; script-src-attr 'none'; form-action 'self'; ${resources}; ${base}`
  const parts = (csp: string) => Object.fromEntries(csp.split('; ').map(part => [part.split(' ')[0]!, part.split(' ').slice(1)]))

  it('兩個 ID 都沒設：和這個功能出現之前一字不差（2026-11-12 以前的字串）', () => {
    expect(PUBLIC_RESOURCE_CSP).toBe(resources)
    expect(publicCsp()).toBe(original)
    expect(publicCsp([], NONE)).toBe(original)
    expect(publicCsp(undefined, undefined)).toBe(original)
    const page = [scriptHashSource('window.__NUXT__={}')]
    expect(publicCsp(page, NONE)).toBe(publicCsp(page))
    expect(securityHeadersFor('/', 'production')['Content-Security-Policy']).toBe(original)
    expect(securityHeadersFor('/', 'production', { analytics: NONE })['Content-Security-Policy']).toBe(original)
    expect(securityHeadersFor('/', 'production', { analytics: analyticsIdsFromConfig({ public: { gaMeasurementId: 'bad', metaPixelId: 'bad' } }) })['Content-Security-Policy']).toBe(original)
  })

  it('只有 GA：script／connect／img 各加 Google 網域，沒有 Meta', () => {
    const csp = publicCsp([], GA)
    const p = parts(csp)
    expect(p['script-src']).toEqual([...publicScriptSources().split(' '), 'https://www.googletagmanager.com'])
    expect(p['connect-src']).toEqual(["'self'", 'https://challenges.cloudflare.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com'])
    expect(p['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https://i.ytimg.com', 'https://*.google-analytics.com', 'https://www.googletagmanager.com'])
    expect(p['frame-src']).toEqual(["'self'", 'https://www.youtube-nocookie.com', 'https://challenges.cloudflare.com'])
    expect(csp).not.toMatch(/facebook/)
    expect(csp).toContain(base)
  })

  it('只有 Pixel：加 Meta 網域，沒有 Google', () => {
    const csp = publicCsp([], PIXEL)
    const p = parts(csp)
    expect(p['script-src']).toEqual([...publicScriptSources().split(' '), 'https://connect.facebook.net'])
    expect(p['connect-src']).toEqual(["'self'", 'https://challenges.cloudflare.com', 'https://www.facebook.com', 'https://connect.facebook.net'])
    expect(p['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https://i.ytimg.com', 'https://www.facebook.com'])
    expect(csp).not.toMatch(/google|googletagmanager/)
  })

  it('兩個都設：兩家都加；仍然沒有 unsafe-inline／unsafe-eval／萬用字元腳本來源', () => {
    const csp = publicCsp([scriptHashSource('window.__NUXT__={}')], BOTH)
    const p = parts(csp)
    expect(p['script-src']).toContain('https://www.googletagmanager.com')
    expect(p['script-src']).toContain('https://connect.facebook.net')
    expect(p['script-src']).toContain(scriptHashSource('window.__NUXT__={}'))
    expect(p['script-src']!.filter(source => source.includes('*'))).toEqual([])
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    expect(p['script-src-attr']).toEqual(["'none'"])
  })

  it('securityHeadersFor 帶 analytics：公開頁（含 /preview）有來源，後台 CSP 完全不動，nuxt dev 仍只留 base', () => {
    expect(securityHeadersFor('/', 'production', { analytics: GA })['Content-Security-Policy']).toBe(publicCsp([], GA))
    expect(securityHeadersFor('/preview?embed=1', 'production', { analytics: BOTH })['Content-Security-Policy']).toBe(publicCsp([], BOTH))
    for (const path of ['/admin/', '/admin/assets/a.js', '/%61dmin/']) {
      expect(securityHeadersFor(path, 'production', { analytics: BOTH })['Content-Security-Policy'], path).toBe(ADMIN_CSP)
    }
    expect(ADMIN_CSP).not.toMatch(/google|facebook/)
    expect(securityHeadersFor('/', 'development', { scriptPolicy: false, analytics: BOTH })['Content-Security-Policy']).toBe(base)
  })
})

describe('security-headers 外掛讀執行期設定', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function loadPlugin(config: Record<string, unknown>) {
    const headers = new Map<string, string>()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    vi.stubGlobal('useRuntimeConfig', () => config)
    vi.stubGlobal('setResponseHeader', (_e: unknown, name: string, value: string) => headers.set(name.toLowerCase(), value))
    vi.stubGlobal('getResponseHeader', (_e: unknown, name: string) => headers.get(name.toLowerCase()))
    vi.stubGlobal('removeResponseHeader', (_e: unknown, name: string) => headers.delete(name.toLowerCase()))
    vi.resetModules()
    const { default: plugin } = await import('../server/plugins/security-headers')
    const hooks = createHooks<Record<string, (...args: never[]) => unknown>>()
    ;(plugin as (app: { hooks: typeof hooks }) => void)({ hooks })
    return { hooks, headers }
  }
  const render = { head: ['<script type="importmap">{"imports":{}}</script>'], bodyPrepend: [], body: [], bodyAppend: ['<script>window.__NUXT__={}</script>'] }
  const pageHashes = [scriptHashSource('{"imports":{}}'), scriptHashSource('window.__NUXT__={}')]

  it('沒有 public 設定（既有測試的情形）或 ID 空白：request 與 render:html 的 CSP 都是原本的字串', async () => {
    for (const config of [{ websiteEnv: 'production' }, { websiteEnv: 'production', public: { gaMeasurementId: '', metaPixelId: '' } }]) {
      const { hooks, headers } = await loadPlugin(config)
      await hooks.callHook('request', { path: '/' } as never)
      expect(headers.get('content-security-policy')).toBe(publicCsp())
      await hooks.callHook('render:html', render as never, { event: {} } as never)
      expect(headers.get('content-security-policy')).toBe(publicCsp(pageHashes))
    }
  })

  it('設了 ID：靜態資源等的 request 標頭與 Nuxt 渲染頁的 CSP 都帶來源，雜湊機制不變', async () => {
    const { hooks, headers } = await loadPlugin({ websiteEnv: 'production', public: { gaMeasurementId: 'G-TEST123456', metaPixelId: '1234567890123456' } })
    await hooks.callHook('request', { path: '/assets/x.webp' } as never)
    expect(headers.get('content-security-policy')).toBe(publicCsp([], BOTH))
    await hooks.callHook('render:html', render as never, { event: {} } as never)
    expect(headers.get('content-security-policy')).toBe(publicCsp(pageHashes, BOTH))
    expect(headers.get('content-security-policy')).toContain(scriptHashSource('window.__NUXT__={}'))
  })

  it('後台入口：設了 ID 也維持後台 CSP，render:html 不會蓋掉', async () => {
    const { hooks, headers } = await loadPlugin({ websiteEnv: 'production', public: { gaMeasurementId: 'G-TEST123456', metaPixelId: '1234567890123456' } })
    await hooks.callHook('request', { path: '/admin/' } as never)
    expect(headers.get('content-security-policy')).toBe(ADMIN_CSP)
    await hooks.callHook('render:html', render as never, { event: {} } as never)
    expect(headers.get('content-security-policy')).toBe(ADMIN_CSP)
  })

  it('格式不符的 ID 當作沒設，CSP 不放行任何來源', async () => {
    const { hooks, headers } = await loadPlugin({ websiteEnv: 'production', public: { gaMeasurementId: 'UA-123', metaPixelId: 'pixel' } })
    await hooks.callHook('request', { path: '/' } as never)
    expect(headers.get('content-security-policy')).toBe(publicCsp())
  })
})
