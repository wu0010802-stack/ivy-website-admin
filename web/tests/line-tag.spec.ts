// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  analyticsCspSources, analyticsEnabled, analyticsIdsFromConfig, lineTagSearch, normalizeLineTagId, type AnalyticsIds
} from '../shared/third-party-analytics'
import { publicScriptSources } from '../server/utils/script-csp'
import { ADMIN_CSP, publicCsp, securityHeadersFor } from '../server/utils/security-headers'
import { createThirdPartyAnalytics, lineTagLocation, reportBookingLead } from '../app/utils/third-party-analytics'

// LINE Tag（LINE 廣告，2026-11-16）：ID 驗證、CSP 來源、載入時機、傳給 lt.js 的 $location 清洗、預約成功的 Conversion、
// 不送個資。來源清單與請求形狀來自 2026-11-16 以真的 lt.js 3.7.0 在空白頁的實測（見 deploy/README.md「LINE Tag」）。
// 外部腳本一律不真的載入（假的 document）。

const ORIGIN = 'http://localhost:3000'
const TAG = '0b5a8c1e-7d2f-4c3a-9e61-2f4d8a6b1c07'
const GA = 'G-TEST123456'
const NONE: AnalyticsIds = { gaMeasurementId: null, metaPixelId: null, openaiPixelId: null, lineTagId: null }
const LINE_ONLY: AnalyticsIds = { ...NONE, lineTagId: TAG }
const ALL: AnalyticsIds = { gaMeasurementId: GA, metaPixelId: '1234567890123456', openaiPixelId: 'pix_test_1234567890', lineTagId: TAG }
const SDK = 'https://d.line-scdn.net/n/line_tag/public/release/v1/lt.js'

type Win = Window & { _lt?: (...args: unknown[]) => void; _ltq?: unknown[]; gtag?: unknown; fbq?: unknown; _fbq?: unknown; dataLayer?: unknown[]; oaiq?: unknown }
const win = window as unknown as Win

function resetWindow() {
  delete win._lt
  delete win._ltq
  delete win.gtag
  delete win.fbq
  delete win._fbq
  delete win.dataLayer
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

/** _ltq 放的是 arguments 物件（和官方 snippet 相同），轉成陣列方便比對；$location 這種 getter 物件另外驗。 */
const queue = () => (win._ltq ?? []).map(entry => Array.from(entry as ArrayLike<unknown>))
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

describe('Tag ID 驗證（不符視同未設定）', () => {
  it('UUID；前後空白修掉、大寫轉小寫', () => {
    expect(normalizeLineTagId(TAG)).toBe(TAG)
    expect(normalizeLineTagId(`  ${TAG.toUpperCase()}\n`)).toBe(TAG)
    for (const bad of ['', 'abc', TAG.slice(1), `${TAG}0`, `${TAG}"`, TAG.replace(/-/g, ''), 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz', "x'}); alert(1)//", 'https://x.test/a', '<YOUR-TAG-ID>']) {
      expect(normalizeLineTagId(bad), bad).toBeNull()
    }
    for (const bad of [undefined, null, 12345678, {}, [], true]) expect(normalizeLineTagId(bad), String(bad)).toBeNull()
  })

  it('從 runtimeConfig 取：沒設是 null；只設這一個也算啟用', () => {
    expect(analyticsIdsFromConfig({ public: { lineTagId: '' } })).toEqual(NONE)
    expect(analyticsIdsFromConfig({ public: { lineTagId: 'bad' } })).toEqual(NONE)
    expect(analyticsIdsFromConfig({ public: { lineTagId: TAG } })).toEqual(LINE_ONLY)
    expect(analyticsIdsFromConfig({ public: { gaMeasurementId: GA, metaPixelId: '1234567890123456', openaiPixelId: 'pix_test_1234567890', lineTagId: TAG } })).toEqual(ALL)
    expect(analyticsEnabled(NONE)).toBe(false)
    expect(analyticsEnabled(LINE_ONLY)).toBe(true)
  })
})

describe('CSP', () => {
  const parts = (csp: string) => Object.fromEntries(csp.split('; ').map(part => [part.split(' ')[0]!, part.split(' ').slice(1)]))

  it('只設 LINE：script 放行 lt.js 與 ltag.js 的來源，圖片放行 tr.line.me，connect-src 不動', () => {
    expect(analyticsCspSources(LINE_ONLY)).toEqual({
      script: ['https://d.line-scdn.net', 'https://tag.flvcdn.net'],
      connect: [],
      img: ['https://tr.line.me']
    })
    const csp = publicCsp([], LINE_ONLY)
    const p = parts(csp)
    expect(p['script-src']).toEqual([...publicScriptSources().split(' '), 'https://d.line-scdn.net', 'https://tag.flvcdn.net'])
    expect(p['connect-src']).toEqual(["'self'", 'https://challenges.cloudflare.com'])
    expect(p['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https://i.ytimg.com', 'https://tr.line.me'])
    expect(csp).not.toMatch(/google|facebook|openai|yahoo/)
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    expect(p['script-src']!.filter(source => source.includes('*'))).toEqual([])
  })

  it('沒設：和沒有這個功能時一字不差（不含任何 line 網域）', () => {
    expect(publicCsp([], NONE)).toBe(publicCsp())
    expect(securityHeadersFor('/', 'production', { analytics: NONE })['Content-Security-Policy']).toBe(publicCsp())
    expect(securityHeadersFor('/', 'production', { analytics: analyticsIdsFromConfig({ public: { lineTagId: 'bad' } }) })['Content-Security-Policy']).toBe(publicCsp())
    expect(publicCsp()).not.toMatch(/line-scdn|flvcdn|line\.me/)
  })

  it('刻意不放行 LINE Yahoo 的 apm.yahoo.co.jp；四家都設：各家來源都在', () => {
    const p = parts(publicCsp([], ALL))
    for (const key of ['script-src', 'connect-src', 'img-src']) expect(p[key]!.join(' ')).not.toContain('yahoo')
    expect(p['script-src']).toEqual(expect.arrayContaining(['https://www.googletagmanager.com', 'https://connect.facebook.net', 'https://bzrcdn.openai.com', 'https://d.line-scdn.net', 'https://tag.flvcdn.net']))
    expect(p['img-src']).toEqual(expect.arrayContaining(['https://www.facebook.com', 'https://bzr.openai.com', 'https://tr.line.me']))
  })

  it('後台 CSP 不放行；公開頁的 request 標頭帶來源', () => {
    expect(securityHeadersFor('/', 'production', { analytics: LINE_ONLY })['Content-Security-Policy']).toBe(publicCsp([], LINE_ONLY))
    expect(securityHeadersFor('/admin/', 'production', { analytics: ALL })['Content-Security-Policy']).toBe(ADMIN_CSP)
    expect(ADMIN_CSP).not.toMatch(/line-scdn|flvcdn|line\.me/)
  })
})

describe('傳給 lt.js 的網址（$location）清洗', () => {
  it('query 只留歸因參數與 LINE 廣告點擊代碼，其他一律拿掉', () => {
    expect(lineTagSearch('?utm_source=a&secret=1&gclid=g&ldtag_cl=C1&ldtag_m=m&ldtag_t=1&lt_r=r&srclt=s&token=zz')).toBe('?utm_source=a&gclid=g&ldtag_cl=C1&ldtag_m=m&ldtag_t=1&lt_r=r&srclt=s')
    expect(lineTagSearch('?a=1&b=2')).toBe('')
    expect(lineTagSearch('')).toBe('')
    expect(lineTagSearch('?ldtag_cl_x=1&xldtag_cl=1&utm=1')).toBe('')
  })

  it('href／search／hash 是清洗版，換頁後 getter 取到當下的網址', () => {
    const loc = lineTagLocation(window)
    history.replaceState(null, '', '/visit/x?utm_source=a&secret=1&ldtag_cl=C1#hash-id')
    expect(loc.href).toBe(`${ORIGIN}/visit/x?utm_source=a&ldtag_cl=C1`)
    expect(loc.search).toBe('?utm_source=a&ldtag_cl=C1')
    expect(loc.hash).toBe('')
    expect(loc.pathname).toBe('/visit/x')
    expect(loc.host).toBe('localhost:3000')
    expect(loc.origin).toBe(ORIGIN)
    history.replaceState(null, '', '/environment#a')
    expect(loc.href).toBe(`${ORIGIN}/environment`)
    expect(loc.pathname).toBe('/environment')
  })
})

describe('載入與頁面瀏覽', () => {
  it('第一頁：建 stub、init（不帶任何個資欄位、關跨網域同步），腳本整頁載完才加進文件', () => {
    const { doc, scripts } = fakeDocument()
    let run: (() => void) | undefined
    const analytics = createThirdPartyAnalytics(LINE_ONLY, win, doc, (inject) => { run = inject })
    analytics.pageView(at('/'), '/', '常春藤')
    expect(scripts).toEqual([])
    const q = queue()
    expect(q).toHaveLength(1)
    const [name, config] = q[0] as [string, Record<string, unknown>]
    expect(name).toBe('init')
    expect(Object.keys(config).sort()).toEqual(['$location', 'allowSync', 'customerType', 'tagId'])
    expect(config).toMatchObject({ customerType: 'account', tagId: TAG, allowSync: false })
    for (const pii of ['tel', 'email', 'externalId', 'deduplicationKey', 'autoLink', 'syncByLCS', 'syncByLIFF', 'userId']) expect(config).not.toHaveProperty(pii)
    run!()
    expect(scripts.map(script => script.src)).toEqual([SDK])
    // 載入前不把 pv 排進 queue（queue 載入時才處理，所有 pv 都會讀到載入當下的網址），載入時補送一次
    expect(queue().slice(1)).toEqual([['send', 'pv', [TAG]]])
  })

  it('載入後換頁：每一頁送一次 pv，同一路徑不重送', () => {
    const { doc } = fakeDocument()
    const analytics = createThirdPartyAnalytics(LINE_ONLY, win, doc)
    analytics.pageView(at('/'), '/', 'a')
    analytics.pageView(at('/'), '/', 'a')
    analytics.pageView(at('/visit'), '/visit', 'b')
    expect(queue().map(entry => entry[0])).toEqual(['init', 'send', 'send'])
    expect(queue().slice(1)).toEqual([['send', 'pv', [TAG]], ['send', 'pv', [TAG]]])
  })

  it('預約修改頁、後台、草稿預覽：第一頁就是這些時完全不建 stub、不載；進去之後也不送', () => {
    for (const path of ['/visit/manage', '/admin/', '/preview']) {
      resetWindow()
      const { doc, scripts } = fakeDocument()
      createThirdPartyAnalytics(LINE_ONLY, win, doc).pageView(at(path), path, 'x')
      expect(win._lt, path).toBeUndefined()
      expect(scripts, path).toEqual([])
    }
    resetWindow()
    const { doc } = fakeDocument()
    const analytics = createThirdPartyAnalytics(LINE_ONLY, win, doc)
    analytics.pageView(at('/'), '/', 'x')
    const before = queue().length
    analytics.hold('/visit/manage')
    analytics.pageView(at('/visit/manage'), '/visit/manage', 'x')
    expect(queue()).toHaveLength(before)
  })

  it('不載入時 window 上沒有 _lt', () => {
    const { doc, scripts } = fakeDocument()
    createThirdPartyAnalytics({ ...NONE, gaMeasurementId: GA }, win, doc).pageView(at('/'), '/', 'x')
    expect(win._lt).toBeUndefined()
    expect(scripts.map(script => script.src)).toEqual([expect.stringContaining('googletagmanager')])
  })
})

describe('預約成功的 Conversion', () => {
  it('只帶 type: Conversion，不帶校區、入口、金額或任何個資', () => {
    const { doc } = fakeDocument()
    history.replaceState(null, '', '/visit/yihua')
    createThirdPartyAnalytics(LINE_ONLY, win, doc).pageView(location.href, location.pathname, 'x')
    reportBookingLead('yihua', 'visit_page')
    const last = queue().at(-1)!
    expect(last).toEqual(['send', 'cv', { type: 'Conversion' }])
    expect(JSON.stringify(last)).not.toMatch(/yihua|visit_page|@|phone|email/)
  })

  it('沒載入（沒設、DNT／GPC、被擋）時什麼都不會發生；不送事件的頁面不送；出錯不丟', () => {
    expect(() => reportBookingLead('yihua', 'visit_page')).not.toThrow()
    expect(win._lt).toBeUndefined()
    const calls: unknown[][] = []
    win._lt = (...args: unknown[]) => { calls.push(args) }
    history.replaceState(null, '', '/visit/manage')
    reportBookingLead('yihua', 'visit_page')
    expect(calls).toEqual([])
    history.replaceState(null, '', '/visit/yihua')
    win._lt = () => { throw new Error('boom') }
    expect(() => reportBookingLead('yihua', 'visit_page')).not.toThrow()
  })
})

// plugins/third-party-analytics.client.ts：只設 LINE 的 ID 也會掛；DNT／GPC 一樣不載。
describe('外掛', () => {
  type Setup = (app: { hook: (name: string, fn: () => void) => void }) => void
  let setupPlugin: Setup

  beforeAll(async () => {
    vi.stubGlobal('defineNuxtPlugin', (setup: Setup) => setup)
    setupPlugin = (await import('../app/plugins/third-party-analytics.client')).default as unknown as Setup
  })

  function mount(publicConfig: Record<string, unknown>, nav: Record<string, unknown> = { doNotTrack: null }) {
    const hooks: Record<string, () => void> = {}
    vi.stubGlobal('defineNuxtPlugin', (setup: Setup) => setup)
    vi.stubGlobal('useRuntimeConfig', () => ({ public: publicConfig }))
    vi.stubGlobal('useRouter', () => ({ beforeEach: () => {}, afterEach: () => {} }))
    vi.stubGlobal('injectHead', () => ({ hooks: { hook: () => {} } }))
    vi.stubGlobal('navigator', nav)
    setupPlugin({ hook: (name, fn) => { hooks[name] = fn } })
    return hooks
  }

  it('只設 NUXT_PUBLIC_LINE_TAG_ID：掛上換頁掛鉤', () => {
    const hooks = mount({ lineTagId: TAG })
    expect(Object.keys(hooks).sort()).toEqual(['app:mounted', 'page:finish'])
    hooks['app:mounted']!()
    expect(queue()[0]![0]).toBe('init')
  })

  it('沒設或格式不符：什麼都不掛', () => {
    for (const lineTagId of ['', 'bad id', undefined]) expect(mount({ lineTagId })).toEqual({})
    expect(win._lt).toBeUndefined()
  })

  it('瀏覽器要求不追蹤（DNT）或 Global Privacy Control：不載入', () => {
    for (const nav of [{ doNotTrack: '1' }, { doNotTrack: null, globalPrivacyControl: true }]) {
      expect(mount({ lineTagId: TAG }, nav)).toEqual({})
    }
    expect(win._lt).toBeUndefined()
  })
})
