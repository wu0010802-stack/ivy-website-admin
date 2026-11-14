// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  analyticsCspSources, analyticsEnabled, analyticsIdsFromConfig, normalizeOpenaiPixelId, type AnalyticsIds
} from '../shared/third-party-analytics'
import { publicScriptSources } from '../server/utils/script-csp'
import { ADMIN_CSP, publicCsp, securityHeadersFor } from '../server/utils/security-headers'
import { createThirdPartyAnalytics, keepOpenaiAutoMatchingOff, openaiClickId, reportBookingLead } from '../app/utils/third-party-analytics'

// ChatGPT 廣告的 OpenAI 評估像素（2026-11-15，規格 docs/specs/2026-11-15-openai-ads-pixel-design.md）：
// ID 驗證、CSP、載入時機、廣告點擊代碼、預約成功事件、把「自動進階比對」關掉的攔截。GA4／Meta Pixel 的測試在 third-party-analytics*.spec.ts。
// 外部腳本一律不真的載入（假的 document，或攔下 appendChild）。

const ORIGIN = 'http://localhost:3000'
const OPENAI = 'pix_test_1234567890'
const GA = 'G-TEST123456'
const PIXEL = '1234567890123456'
const NONE: AnalyticsIds = { gaMeasurementId: null, metaPixelId: null, openaiPixelId: null }
const OPENAI_ONLY: AnalyticsIds = { gaMeasurementId: null, metaPixelId: null, openaiPixelId: OPENAI }
const ALL: AnalyticsIds = { gaMeasurementId: GA, metaPixelId: PIXEL, openaiPixelId: OPENAI }
const SDK = 'https://bzrcdn.openai.com/sdk/oaiq.min.js'

type Win = Window & { dataLayer?: unknown[]; gtag?: unknown; fbq?: unknown; _fbq?: unknown; oaiq?: { q: unknown[] } & ((...args: unknown[]) => void) }
const win = window as unknown as Win

const nativeFetch = window.fetch

function resetWindow() {
  window.fetch = nativeFetch
  delete win.dataLayer
  delete win.gtag
  delete win.fbq
  delete win._fbq
  delete win.oaiq
}

function fakeDocument() {
  const scripts: { src: string; async: boolean; removed: boolean }[] = []
  const doc = {
    createElement: () => ({ src: '', async: false, removed: false, addEventListener: vi.fn(), remove() { this.removed = true } }),
    head: { appendChild: (script: (typeof scripts)[number]) => { scripts.push(script) } }
  } as unknown as Document
  return { doc, scripts }
}

/** oaiq 的 queue 放的是 arguments 物件（和官方 snippet 相同），轉成陣列方便比對。 */
const queue = () => (win.oaiq?.q ?? []).map(entry => Array.from(entry as ArrayLike<unknown>))
const at = (path: string) => `${ORIGIN}${path}`

beforeEach(() => {
  resetWindow()
  history.replaceState(null, '', '/')
  document.title = '常春藤幼兒園'
})
afterEach(() => {
  resetWindow()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Pixel ID 驗證（不符視同未設定）', () => {
  it('英數、底線、連字號 6–64 字；前後空白會修掉', () => {
    expect(normalizeOpenaiPixelId('pix_abc123DEF')).toBe('pix_abc123DEF')
    expect(normalizeOpenaiPixelId('  6af88a06-5b00-81a1\n')).toBe('6af88a06-5b00-81a1')
    expect(normalizeOpenaiPixelId('A'.repeat(64))).toBe('A'.repeat(64))
    for (const bad of ['', 'abc12', 'A'.repeat(65), 'pix abc123', 'pix"abc123', "pix'}); alert(1)//", 'pix/../x12', '-pix123456', '_pix123456', 'https://x.test/pix_abc', '<YOUR-PIXEL-ID>', 'ｐｉｘ１２３４５６']) {
      expect(normalizeOpenaiPixelId(bad), bad).toBeNull()
    }
    for (const bad of [undefined, null, {}, [], true]) expect(normalizeOpenaiPixelId(bad), String(bad)).toBeNull()
  })

  it('純數字的環境變數會被 Nitro 解析成 number：收安全整數，失真的不收', () => {
    expect(normalizeOpenaiPixelId(1234567890123456)).toBe('1234567890123456')
    for (const bad of [12345, 0, -1234567, 1.5, 12345678901234567890, NaN, Infinity]) {
      expect(normalizeOpenaiPixelId(bad), String(bad)).toBeNull()
    }
  })

  it('從 runtimeConfig 取：沒設是 null；只設這一個也算啟用', () => {
    expect(analyticsIdsFromConfig({ public: { openaiPixelId: '' } })).toEqual(NONE)
    expect(analyticsIdsFromConfig({ public: { openaiPixelId: 'bad id' } })).toEqual(NONE)
    expect(analyticsIdsFromConfig({ public: { openaiPixelId: OPENAI } })).toEqual(OPENAI_ONLY)
    expect(analyticsIdsFromConfig({ public: { gaMeasurementId: GA, metaPixelId: PIXEL, openaiPixelId: OPENAI } })).toEqual(ALL)
    expect(analyticsEnabled(NONE)).toBe(false)
    expect(analyticsEnabled(OPENAI_ONLY)).toBe(true)
  })
})

describe('CSP', () => {
  const parts = (csp: string) => Object.fromEntries(csp.split('; ').map(part => [part.split(' ')[0]!, part.split(' ').slice(1)]))

  it('只設 OpenAI：只加 bzrcdn（腳本）與 bzr（事件）', () => {
    expect(analyticsCspSources(OPENAI_ONLY)).toEqual({
      script: ['https://bzrcdn.openai.com'],
      connect: ['https://bzr.openai.com'],
      img: ['https://bzr.openai.com']
    })
    const csp = publicCsp([], OPENAI_ONLY)
    const p = parts(csp)
    expect(p['script-src']).toEqual([...publicScriptSources().split(' '), 'https://bzrcdn.openai.com'])
    expect(p['connect-src']).toEqual(["'self'", 'https://challenges.cloudflare.com', 'https://bzr.openai.com'])
    expect(p['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https://i.ytimg.com', 'https://bzr.openai.com'])
    expect(csp).not.toMatch(/google|facebook/)
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    expect(p['script-src']!.filter(source => source.includes('*'))).toEqual([])
  })

  // 官方文件要 connect-src 也放行 bzrcdn，用途只有取「自動進階比對」的設定檔；不放行，SDK 取不到就維持關閉。
  it('connect-src 刻意不放行 bzrcdn（自動進階比對的設定檔），三家都設也一樣', () => {
    for (const ids of [OPENAI_ONLY, ALL]) {
      expect(parts(publicCsp([], ids))['connect-src']).not.toContain('https://bzrcdn.openai.com')
      expect(parts(publicCsp([], ids))['img-src']).not.toContain('https://bzrcdn.openai.com')
    }
  })

  it('沒設：和沒有這個功能時一字不差；三家都設：各家來源都在', () => {
    expect(publicCsp([], NONE)).toBe(publicCsp())
    expect(publicCsp()).not.toContain('openai')
    const p = parts(publicCsp([], ALL))
    expect(p['script-src']).toEqual(expect.arrayContaining(['https://www.googletagmanager.com', 'https://connect.facebook.net', 'https://bzrcdn.openai.com']))
    expect(p['connect-src']).toEqual(expect.arrayContaining(['https://www.facebook.com', 'https://bzr.openai.com']))
  })

  it('後台 CSP 不放行；公開頁的 request 標頭帶來源', () => {
    expect(securityHeadersFor('/', 'production', { analytics: OPENAI_ONLY })['Content-Security-Policy']).toBe(publicCsp([], OPENAI_ONLY))
    expect(securityHeadersFor('/admin/', 'production', { analytics: ALL })['Content-Security-Policy']).toBe(ADMIN_CSP)
    expect(ADMIN_CSP).not.toContain('openai')
  })
})

describe('自動進階比對一律關（攔下 SDK 取設定檔的請求）', () => {
  const CONFIG = `https://bzrcdn.openai.com/pixel-config/v1/${OPENAI}.json`

  function install() {
    const native = vi.fn(async () => new Response('native'))
    window.fetch = native as unknown as typeof fetch
    keepOpenaiAutoMatchingOff(window)
    return native
  }

  it('設定檔網址：不連外，直接回「關」；字串、URL、Request 三種寫法都攔', async () => {
    const native = install()
    for (const input of [CONFIG, new URL(CONFIG), new Request(CONFIG), 'https://bzrcdn.openai.com/pixel-config/v2/other.json']) {
      const response = await window.fetch(input, { method: 'GET', credentials: 'omit', mode: 'cors' })
      expect(response.ok).toBe(true)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ automatic_advanced_matching_enabled: false })
    }
    expect(native).not.toHaveBeenCalled()
  })

  it('其他請求原封不動交給原本的 fetch（含同一個網域的 SDK 腳本、事件端點、站內 API）', async () => {
    const native = install()
    const init = { method: 'POST', body: 'x' }
    const inputs = ['https://bzrcdn.openai.com/sdk/oaiq.min.js', 'https://bzr.openai.com/v1/sdk/events?pid=x', '/api/website/v1/public/site', new URL('https://example.test/pixel-config/v1/x.json')] as const
    for (const input of inputs) expect(await (await window.fetch(input, init)).text()).toBe('native')
    expect(native.mock.calls).toEqual(inputs.map(input => [input, init]))
    expect(native.mock.contexts.every(context => context === window)).toBe(true)
  })

  it('重複呼叫只包一層；沒有 fetch 的環境不丟例外', async () => {
    const native = install()
    const once = window.fetch
    keepOpenaiAutoMatchingOff(window)
    keepOpenaiAutoMatchingOff(window)
    expect(window.fetch).toBe(once)
    await window.fetch('/x')
    expect(native).toHaveBeenCalledTimes(1)
    expect(() => keepOpenaiAutoMatchingOff({} as Window)).not.toThrow()
  })

  it('有設 OpenAI 的 ID 才裝，而且在 SDK 加進文件之前就裝好；只設另外兩家不動 fetch', async () => {
    const native = vi.fn(async () => new Response('native'))
    window.fetch = native as unknown as typeof fetch
    const other = fakeDocument()
    createThirdPartyAnalytics({ gaMeasurementId: GA, metaPixelId: PIXEL, openaiPixelId: null }, win, other.doc).pageView(at('/'), '/', 'x')
    expect(window.fetch).toBe(native)

    resetWindow()
    window.fetch = native as unknown as typeof fetch
    let guardedWhenInjected = false
    const doc = {
      createElement: () => ({ src: '', async: false, addEventListener: vi.fn(), remove: vi.fn() }),
      head: { appendChild: () => { guardedWhenInjected = window.fetch !== native } }
    } as unknown as Document
    createThirdPartyAnalytics(OPENAI_ONLY, win, doc).pageView(at('/'), '/', 'x')
    expect(guardedWhenInjected).toBe(true)
    expect(await (await window.fetch(CONFIG)).json()).toEqual({ automatic_advanced_matching_enabled: false })
    expect(native).not.toHaveBeenCalled()
  })

  it('第一頁是不送事件的頁面（不載 SDK）就不動 fetch', () => {
    const native = vi.fn()
    window.fetch = native as unknown as typeof fetch
    const { doc } = fakeDocument()
    createThirdPartyAnalytics(OPENAI_ONLY, win, doc).pageView(at('/visit/manage'), '/visit/manage', 'x')
    expect(window.fetch).toBe(native)
  })
})

describe('廣告點擊代碼（網址的 oppref）', () => {
  it('有就原樣取出；沒有、空白、過長都不傳', () => {
    expect(openaiClickId('?utm_source=chatgpt&oppref=abc.DEF-123_x&utm_medium=cpc')).toBe('abc.DEF-123_x')
    expect(openaiClickId('?oppref=a%2Bb%3D')).toBe('a+b=')
    expect(openaiClickId('')).toBeUndefined()
    expect(openaiClickId('?utm_source=chatgpt')).toBeUndefined()
    expect(openaiClickId('?oppref=')).toBeUndefined()
    expect(openaiClickId('?oppref=%20%20')).toBeUndefined()
    expect(openaiClickId(`?oppref=${'x'.repeat(513)}`)).toBeUndefined()
    expect(openaiClickId('?xoppref=1&opprefx=2')).toBeUndefined()
  })
})

describe('載入', () => {
  it('第一個可送事件的頁面才建 stub、init、載 SDK；queue 放的是 arguments 物件', () => {
    const { doc, scripts } = fakeDocument()
    const analytics = createThirdPartyAnalytics(OPENAI_ONLY, win, doc)
    expect(win.oaiq).toBeUndefined()
    expect(scripts).toEqual([])
    analytics.pageView(at('/'), '/', '常春藤幼兒園')
    expect(scripts.map(script => script.src)).toEqual([SDK])
    expect(scripts[0]!.async).toBe(true)
    expect(queue()).toEqual([['init', { pixelId: OPENAI }]])
    expect(Object.prototype.toString.call(win.oaiq!.q[0])).toBe('[object Arguments]')
    // 只設這一家：沒有 gtag／fbq，也不載 Google、Meta
    expect(win.gtag).toBeUndefined()
    expect(win.fbq).toBeUndefined()
    expect(win.dataLayer).toBeUndefined()
  })

  it('換頁不送任何東西（只回報預約成功，不送 page_viewed）', () => {
    const { doc, scripts } = fakeDocument()
    const analytics = createThirdPartyAnalytics(OPENAI_ONLY, win, doc)
    analytics.pageView(at('/'), '/', 'a')
    analytics.pageView(at('/about'), '/about', 'b')
    analytics.pageView(at('/visit'), '/visit', 'c')
    expect(queue()).toEqual([['init', { pixelId: OPENAI }]])
    expect(scripts.length).toBe(1)
  })

  it('落地頁網址有 oppref：建 stub 當下就讀出來傳給 init（SDK 延後載入，之後站內換頁網址上就沒有了）', () => {
    const { doc } = fakeDocument()
    let inject: (() => void) | undefined
    history.replaceState(null, '', '/?utm_source=chatgpt&utm_medium=cpc&oppref=click-123')
    const analytics = createThirdPartyAnalytics(OPENAI_ONLY, win, doc, (run) => { inject = run })
    analytics.pageView(location.href, location.pathname, 'x')
    history.replaceState(null, '', '/visit')
    analytics.pageView(location.href, location.pathname, 'y')
    inject!()
    expect(queue()).toEqual([['init', { pixelId: OPENAI, oppref: 'click-123' }]])
  })

  it('三家都設：三支腳本都載，各自的 stub 都在', () => {
    const { doc, scripts } = fakeDocument()
    createThirdPartyAnalytics(ALL, win, doc).pageView(at('/'), '/', 'x')
    expect(scripts.map(script => script.src)).toEqual([
      `https://www.googletagmanager.com/gtag/js?id=${GA}`,
      'https://connect.facebook.net/en_US/fbevents.js',
      SDK
    ])
    expect(win.gtag).toBeTypeOf('function')
    expect(win.fbq).toBeTypeOf('function')
    expect(win.oaiq).toBeTypeOf('function')
  })

  it('已經有 oaiq（別處先建了 stub）就沿用，不蓋掉既有的 queue', () => {
    const existing = Object.assign(function oaiq() { existing.q.push(arguments) }, { q: [] as unknown[] })
    win.oaiq = existing as unknown as Win['oaiq']
    const { doc } = fakeDocument()
    createThirdPartyAnalytics(OPENAI_ONLY, win, doc).pageView(at('/'), '/', 'x')
    expect(win.oaiq).toBe(existing)
    expect(queue()).toEqual([['init', { pixelId: OPENAI }]])
  })

  it('第一頁是預約修改頁、後台、草稿預覽：不建 stub、不載；之後換到一般頁面才載，而且只載一次', () => {
    for (const path of ['/visit/manage', '/admin/', '/preview']) {
      resetWindow()
      const { doc, scripts } = fakeDocument()
      const analytics = createThirdPartyAnalytics(OPENAI_ONLY, win, doc)
      analytics.pageView(at(path), path, 'x')
      expect(win.oaiq, path).toBeUndefined()
      expect(scripts, path).toEqual([])
      analytics.pageView(at('/'), '/', 'x')
      analytics.pageView(at('/about'), '/about', 'x')
      expect(scripts.map(script => script.src), path).toEqual([SDK])
    }
  })

  it('輪到載入時人在預約修改頁：不載，離開後才載', () => {
    const { doc, scripts } = fakeDocument()
    let inject: (() => void) | undefined
    const analytics = createThirdPartyAnalytics(OPENAI_ONLY, win, doc, (run) => { inject = run })
    analytics.pageView(at('/'), '/', 'x')
    analytics.hold('/visit/manage')
    analytics.pageView(at('/visit/manage'), '/visit/manage', 'x')
    inject!()
    expect(scripts).toEqual([])
    analytics.pageView(at('/'), '/', 'x')
    expect(scripts.map(script => script.src)).toEqual([SDK])
  })

  it('進出預約修改頁不呼叫 consent（會刪掉廣告點擊代碼的 cookie），queue 只有 init', () => {
    const { doc } = fakeDocument()
    const analytics = createThirdPartyAnalytics(OPENAI_ONLY, win, doc)
    analytics.pageView(at('/'), '/', 'x')
    analytics.hold('/visit/manage')
    analytics.settle('/visit/manage')
    analytics.pageView(at('/visit/manage'), '/visit/manage', 'x')
    analytics.settle('/')
    analytics.pageView(at('/'), '/', 'x')
    expect(queue()).toEqual([['init', { pixelId: OPENAI }]])
    expect(JSON.stringify(queue())).not.toContain('consent')
  })

  it('SDK 載入失敗（廣告攔截器）會把自己移掉', () => {
    const { doc, scripts } = fakeDocument()
    createThirdPartyAnalytics(OPENAI_ONLY, win, doc).pageView(at('/'), '/', 'x')
    const script = scripts[0] as unknown as { addEventListener: ReturnType<typeof vi.fn>; removed: boolean }
    const [type, onError] = script.addEventListener.mock.calls[0] as [string, () => void]
    expect(type).toBe('error')
    onError()
    expect(script.removed).toBe(true)
  })
})

describe('預約成功事件', () => {
  it('送標準事件 appointment_scheduled，只有事件名稱與資料格式，沒有校區、入口、receipt 或個資', () => {
    const { doc } = fakeDocument()
    const analytics = createThirdPartyAnalytics(OPENAI_ONLY, win, doc)
    history.replaceState(null, '', '/visit/yihua?utm_source=chatgpt&parent=Alice#token=secret')
    analytics.pageView(location.href, location.pathname, '預約參觀')
    reportBookingLead('yihua', 'visit_page')
    expect(queue()).toEqual([
      ['init', { pixelId: OPENAI }],
      ['measure', 'appointment_scheduled', { type: 'customer_action' }]
    ])
    expect(JSON.stringify(queue())).not.toMatch(/yihua|visit_page|Alice|secret|receipt|manage_path/)
  })

  it('SDK 還沒載入就預約成功：事件照樣排進 queue，不會漏', () => {
    const { doc, scripts } = fakeDocument()
    let inject: (() => void) | undefined
    const analytics = createThirdPartyAnalytics(OPENAI_ONLY, win, doc, (run) => { inject = run })
    analytics.pageView(at('/visit'), '/visit', 'x')
    history.replaceState(null, '', '/visit')
    reportBookingLead('yihua', 'visit_page')
    expect(scripts).toEqual([])
    expect(queue().at(-1)).toEqual(['measure', 'appointment_scheduled', { type: 'customer_action' }])
    inject!()
    expect(scripts.map(script => script.src)).toEqual([SDK])
  })

  it('三家都設：GA generate_lead、Pixel Lead、OpenAI appointment_scheduled 各送一筆', () => {
    const { doc } = fakeDocument()
    const analytics = createThirdPartyAnalytics(ALL, win, doc)
    history.replaceState(null, '', '/visit/yihua')
    analytics.pageView(location.href, location.pathname, 'x')
    reportBookingLead('yihua', 'visit_page')
    const layer = (win.dataLayer ?? []).map(entry => Array.from(entry as ArrayLike<unknown>))
    expect(layer.filter(entry => entry[0] === 'event' && entry[1] === 'generate_lead').length).toBe(1)
    expect(((win.fbq as unknown as { queue: unknown[][] }).queue).filter(entry => entry[1] === 'Lead').length).toBe(1)
    expect(queue().filter(entry => entry[0] === 'measure')).toEqual([['measure', 'appointment_scheduled', { type: 'customer_action' }]])
  })

  it('在不送事件的頁面不送；沒載入時什麼都不發生', () => {
    expect(() => reportBookingLead('yihua', 'visit_page')).not.toThrow()
    expect(win.oaiq).toBeUndefined()
    const { doc } = fakeDocument()
    createThirdPartyAnalytics(OPENAI_ONLY, win, doc).pageView(at('/'), '/', 'x')
    history.replaceState(null, '', '/visit/manage')
    reportBookingLead('yihua', 'visit_page')
    expect(queue()).toEqual([['init', { pixelId: OPENAI }]])
  })

  it('前兩家丟例外也不會讓 OpenAI 那一筆漏掉；OpenAI 丟例外不影響預約成功畫面', () => {
    const { doc } = fakeDocument()
    createThirdPartyAnalytics(ALL, win, doc).pageView(at('/visit'), '/visit', 'x')
    history.replaceState(null, '', '/visit')
    win.gtag = () => { throw new Error('boom') }
    expect(() => reportBookingLead('yihua', 'visit_page')).not.toThrow()
    expect(queue().at(-1)).toEqual(['measure', 'appointment_scheduled', { type: 'customer_action' }])
    win.oaiq = Object.assign(() => { throw new Error('boom') }, { q: [] }) as unknown as Win['oaiq']
    expect(() => reportBookingLead('yihua', 'visit_page')).not.toThrow()
  })
})

// plugins/third-party-analytics.client.ts：只設 OpenAI 的 ID 也會掛；DNT／GPC 一樣不載。
describe('外掛', () => {
  type Setup = (app: { hook: (name: string, fn: () => void) => void }) => void
  let setupPlugin: Setup
  let appended: HTMLScriptElement[]

  beforeAll(async () => {
    vi.stubGlobal('defineNuxtPlugin', (setup: Setup) => setup)
    setupPlugin = (await import('../app/plugins/third-party-analytics.client')).default as unknown as Setup
  })
  beforeEach(() => {
    appended = []
    vi.useFakeTimers()
    vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
      appended.push(node as unknown as HTMLScriptElement)
      return node
    })
  })
  afterEach(() => { vi.useRealTimers() })

  function mount(publicConfig: Record<string, unknown>, nav: Record<string, unknown> = { doNotTrack: null }) {
    const hooks: Record<string, () => void> = {}
    vi.stubGlobal('defineNuxtPlugin', (setup: Setup) => setup)
    vi.stubGlobal('useRuntimeConfig', () => ({ public: publicConfig }))
    vi.stubGlobal('useRouter', () => ({ beforeEach: () => {}, afterEach: () => {} }))
    vi.stubGlobal('navigator', nav)
    setupPlugin({ hook: (name, fn) => { hooks[name] = fn } })
    return hooks
  }

  it('只設 NUXT_PUBLIC_OPENAI_PIXEL_ID：掛上換頁掛鉤，整頁載完後才載 SDK', () => {
    const hooks = mount({ gaMeasurementId: '', metaPixelId: '', openaiPixelId: OPENAI })
    expect(Object.keys(hooks).sort()).toEqual(['app:mounted', 'page:finish'])
    hooks['app:mounted']!()
    expect(queue()).toEqual([['init', { pixelId: OPENAI }]])
    expect(appended).toEqual([])
    vi.advanceTimersByTime(8000)
    expect(appended.map(script => script.src)).toEqual([SDK])
  })

  it('沒設或格式不符：什麼都不掛', () => {
    for (const openaiPixelId of ['', 'bad id', undefined]) {
      expect(mount({ gaMeasurementId: '', metaPixelId: '', openaiPixelId })).toEqual({})
    }
    expect(win.oaiq).toBeUndefined()
    expect(appended).toEqual([])
  })

  it('瀏覽器要求不追蹤（DNT）或 Global Privacy Control：不載入', () => {
    for (const nav of [{ doNotTrack: '1' }, { doNotTrack: null, globalPrivacyControl: true }]) {
      expect(mount({ openaiPixelId: OPENAI }, nav)).toEqual({})
    }
    vi.advanceTimersByTime(8000)
    expect(win.oaiq).toBeUndefined()
    expect(appended).toEqual([])
  })
})
