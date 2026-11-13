// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsIds } from '../shared/third-party-analytics'
import { createThirdPartyAnalytics, leadEventParams, reportBookingLead, whenPageSettled } from '../app/utils/third-party-analytics'

// GA4＋Meta Pixel 的瀏覽器端（2026-11-12）：載入時機、gtag／fbq 收到什麼、哪些頁面完全不送、預約成功事件的參數。
// 純函式與 CSP 在 third-party-analytics.spec.ts。外部腳本一律不真的載入（假的 document，或攔下 appendChild）。

const ORIGIN = 'http://localhost:3000'
const GA = 'G-TEST123456'
const PIXEL = '1234567890123456'
const BOTH: AnalyticsIds = { gaMeasurementId: GA, metaPixelId: PIXEL }
const GA_ONLY: AnalyticsIds = { gaMeasurementId: GA, metaPixelId: null }
const PIXEL_ONLY: AnalyticsIds = { gaMeasurementId: null, metaPixelId: PIXEL }

type Win = Window & { dataLayer?: unknown[]; gtag?: unknown; fbq?: unknown; _fbq?: unknown }
const win = window as unknown as Win

function resetWindow() {
  delete win.dataLayer
  delete win.gtag
  delete win.fbq
  delete win._fbq
  for (const key of Object.keys(win)) if (key.startsWith('ga-disable-')) delete (win as unknown as Record<string, unknown>)[key]
}

/** 假的 document：記下被建立、加進 head 的 script，不會真的連外。 */
function fakeDocument() {
  const scripts: { src: string; async: boolean; removed: boolean }[] = []
  const doc = {
    createElement: (tag: string) => {
      expect(tag).toBe('script')
      const script = { src: '', async: false, removed: false, addEventListener: vi.fn(), remove() { this.removed = true } }
      return script
    },
    head: { appendChild: (script: (typeof scripts)[number]) => { scripts.push(script) } }
  } as unknown as Document
  return { doc, scripts }
}

/** dataLayer 裡放的是 arguments 物件（gtag.js 只認這個），轉成陣列方便比對。 */
const layer = () => (win.dataLayer ?? []).map(entry => Array.from(entry as ArrayLike<unknown>))
const events = (name: string) => layer().filter(entry => entry[0] === 'event' && entry[1] === name).map(entry => entry[2] as Record<string, unknown>)
const pixelQueue = () => ((win.fbq as { queue?: unknown[][] } | undefined)?.queue ?? []).map(entry => Array.from(entry))

function setup(ids: AnalyticsIds = BOTH) {
  const { doc, scripts } = fakeDocument()
  return { analytics: createThirdPartyAnalytics(ids, win, doc), scripts }
}
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

describe('載入與第一頁', () => {
  it('第一個可送事件的頁面才載入：GA 與 Pixel 腳本網址、stub 與初始化命令', () => {
    const { analytics, scripts } = setup()
    expect(scripts).toEqual([])
    expect(win.gtag).toBeUndefined()
    analytics.pageView(at('/'), '/', '常春藤幼兒園')
    expect(scripts.map(script => script.src)).toEqual([
      `https://www.googletagmanager.com/gtag/js?id=${GA}`,
      'https://connect.facebook.net/en_US/fbevents.js'
    ])
    expect(scripts.every(script => script.async)).toBe(true)
    expect(layer()[0]![0]).toBe('js')
    expect(layer()[1]).toEqual(['config', GA, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false }])
    // Pixel：先關自動設定再 init，最後才是 PageView
    expect(pixelQueue()).toEqual([['set', 'autoConfig', false, PIXEL], ['init', PIXEL], ['track', 'PageView']])

    // fbevents.js 不自己在 pushState 時送 PageView（換頁由程式送，否則重複計次）
    expect((win.fbq as { disablePushState?: boolean }).disablePushState).toBe(true)
  })

  it('dataLayer 放的是 arguments 物件，不是陣列（gtag.js 只認 arguments）', () => {
    const { analytics } = setup(GA_ONLY)
    analytics.pageView(at('/'), '/', 'x')
    expect(win.dataLayer!.length).toBeGreaterThan(0)
    for (const entry of win.dataLayer!) {
      expect(Array.isArray(entry)).toBe(false)
      expect(Object.prototype.toString.call(entry)).toBe('[object Arguments]')
    }
  })

  it('只設 GA 就沒有 fbq 也不載 Meta；只設 Pixel 就沒有 gtag 也不載 Google', () => {
    const ga = setup(GA_ONLY)
    ga.analytics.pageView(at('/'), '/', 'x')
    expect(ga.scripts.map(script => script.src)).toEqual([`https://www.googletagmanager.com/gtag/js?id=${GA}`])
    expect(win.fbq).toBeUndefined()
    resetWindow()
    const px = setup(PIXEL_ONLY)
    px.analytics.pageView(at('/'), '/', 'x')
    expect(px.scripts.map(script => script.src)).toEqual(['https://connect.facebook.net/en_US/fbevents.js'])
    expect(win.gtag).toBeUndefined()
    expect(win.dataLayer).toBeUndefined()
  })

  it('腳本載入失敗（廣告攔截器）會把自己移掉，頁面不受影響', () => {
    const { doc, scripts } = fakeDocument()
    createThirdPartyAnalytics(GA_ONLY, win, doc).pageView(at('/'), '/', 'x')
    const script = scripts[0] as unknown as { addEventListener: ReturnType<typeof vi.fn>; removed: boolean }
    const [type, onError] = script.addEventListener.mock.calls[0] as [string, () => void]
    expect(type).toBe('error')
    onError()
    expect(script.removed).toBe(true)
  })

  it('第一頁是預約修改頁（識別碼在 hash）：完全不載入、不建 stub、不送任何事件', () => {
    const { analytics, scripts } = setup()
    analytics.hold('/visit/manage')
    analytics.pageView(at('/visit/manage#token=SECRET'), '/visit/manage', '管理預約')
    expect(scripts).toEqual([])
    expect(win.gtag).toBeUndefined()
    expect(win.fbq).toBeUndefined()
    expect(win.dataLayer).toBeUndefined()
  })

  it('後台與草稿預覽同樣完全不載入', () => {
    for (const path of ['/admin/content', '/preview']) {
      resetWindow()
      const { analytics, scripts } = setup()
      analytics.pageView(at(`${path}?embed=1`), path, 'x')
      expect(scripts, path).toEqual([])
      expect(win.dataLayer, path).toBeUndefined()
    }
  })

  it('第一頁是修改頁，之後換頁到一般頁面才載入，而且只載一次', () => {
    const { analytics, scripts } = setup()
    analytics.pageView(at('/visit/manage#token=SECRET'), '/visit/manage', 'x')
    expect(scripts).toEqual([])
    analytics.pageView(at('/'), '/', '首頁')
    expect(scripts).toHaveLength(2)
    analytics.pageView(at('/about'), '/about', '關於')
    expect(scripts).toHaveLength(2)
    expect(events('page_view')).toHaveLength(1 + 1)
  })
})

describe('page_view', () => {
  it('page_location 不帶 hash 與一般 query，只留歸因參數；page_title 取傳入的標題', () => {
    const { analytics } = setup(GA_ONLY)
    analytics.pageView(at('/visit/yihua?utm_source=fb&token=zzz&fbclid=F1#frag'), '/visit/yihua', '預約參觀')
    expect(events('page_view')).toEqual([{ page_location: `${ORIGIN}/visit/yihua?utm_source=fb&fbclid=F1`, page_title: '預約參觀' }])
    // set：GA 自己送的事件也用清洗過的網址
    expect(layer().find(entry => entry[0] === 'set')).toEqual(['set', { page_location: `${ORIGIN}/visit/yihua?utm_source=fb&fbclid=F1`, page_title: '預約參觀' }])
    expect(JSON.stringify(layer())).not.toMatch(/token|zzz|frag/)
  })

  it('第一次不帶 page_referrer（交給 GA 用 document.referrer）；之後換頁帶上一頁清洗過的網址', () => {
    const { analytics } = setup(GA_ONLY)
    analytics.pageView(at('/?utm_campaign=a#x'), '/', '首頁')
    analytics.pageView(at('/about?secret=1'), '/about', '關於')
    const views = events('page_view')
    expect(views[0]).not.toHaveProperty('page_referrer')
    expect(views[1]).toEqual({ page_location: `${ORIGIN}/about`, page_title: '關於', page_referrer: `${ORIGIN}/?utm_campaign=a` })
  })

  it('同一路徑不重送（page:finish 與 app:mounted 都會呼叫）；Pixel 一樣', () => {
    const { analytics } = setup()
    analytics.pageView(at('/'), '/', 'x')
    analytics.pageView(at('/'), '/', 'x')
    expect(events('page_view')).toHaveLength(1)
    expect(pixelQueue().filter(entry => entry[0] === 'track')).toEqual([['track', 'PageView']])
    analytics.pageView(at('/about'), '/about', 'y')
    expect(events('page_view')).toHaveLength(2)
    expect(pixelQueue().filter(entry => entry[0] === 'track')).toHaveLength(2)
  })
})

describe('進出預約修改頁（SPA 換頁）', () => {
  it('換頁前先暫停：GA 關閉開關、Pixel consent revoke；修改頁本身不送；離開後恢復並重新送 page_view', () => {
    const { analytics } = setup()
    analytics.pageView(at('/'), '/', '首頁')
    expect((win as unknown as Record<string, unknown>)[`ga-disable-${GA}`]).toBeUndefined()
    const before = layer().length

    analytics.hold('/visit/manage') // router.beforeEach：此時網址還沒變
    expect((win as unknown as Record<string, unknown>)[`ga-disable-${GA}`]).toBe(true)
    expect(pixelQueue().at(-1)).toEqual(['consent', 'revoke'])

    analytics.settle('/visit/manage') // router.afterEach
    analytics.pageView(at('/visit/manage#token=SECRET'), '/visit/manage', '管理預約')
    expect(layer().length).toBe(before)
    expect(events('page_view')).toHaveLength(1)
    expect(pixelQueue().filter(entry => entry[0] === 'track')).toHaveLength(1)

    analytics.settle('/visit/yihua')
    analytics.pageView(at('/visit/yihua'), '/visit/yihua', '預約參觀')
    expect((win as unknown as Record<string, unknown>)[`ga-disable-${GA}`]).toBe(false)
    expect(pixelQueue().at(-2)).toEqual(['consent', 'grant'])
    const views = events('page_view')
    expect(views).toHaveLength(2)
    // 上一頁是修改頁，不能把它當成 page_referrer
    expect(views[1]).not.toHaveProperty('page_referrer')
    expect(JSON.stringify(layer())).not.toMatch(/SECRET|manage/)
  })

  it('換頁被取消（afterEach 看到人還在原本的一般頁面）：暫停會解除，後面的事件照送', () => {
    const { analytics } = setup(GA_ONLY)
    analytics.pageView(at('/about'), '/about', '關於')
    analytics.hold('/visit/manage')
    expect((win as unknown as Record<string, unknown>)[`ga-disable-${GA}`]).toBe(true)
    analytics.settle('/about')
    expect((win as unknown as Record<string, unknown>)[`ga-disable-${GA}`]).toBe(false)
  })

  it('hold 目的地是一般頁面時不動作', () => {
    const { analytics } = setup()
    analytics.pageView(at('/'), '/', 'x')
    const before = layer().length
    analytics.hold('/about')
    expect(layer().length).toBe(before)
    expect((win as unknown as Record<string, unknown>)[`ga-disable-${GA}`]).toBeUndefined()
  })
})

describe('外部腳本延後載入（2026-11-12 手機效能）', () => {
  /** defer 由測試控制：inject() 才等於「整頁載完、主執行緒有空」。 */
  function deferred(ids: AnalyticsIds = BOTH) {
    const { doc, scripts } = fakeDocument()
    const requests: (() => void)[] = []
    const analytics = createThirdPartyAnalytics(ids, win, doc, inject => { requests.push(inject) })
    return { analytics, scripts, requests, inject: () => requests[0]!() }
  }
  const pixelPageViews = () => pixelQueue().filter(entry => entry[0] === 'track' && entry[1] === 'PageView')

  it('第一個可送事件的頁面：stub 與 GA 事件先排進 queue，外部腳本等 defer 叫了才加進文件', () => {
    const { analytics, scripts, requests, inject } = deferred()
    analytics.pageView(at('/'), '/', '常春藤幼兒園')
    expect(requests).toHaveLength(1)
    expect(scripts).toEqual([])
    expect(layer().map(entry => entry[0])).toEqual(['js', 'config', 'set', 'event'])
    expect(events('page_view')).toEqual([{ page_location: at('/'), page_title: '常春藤幼兒園' }])
    expect(pixelQueue()).toEqual([['set', 'autoConfig', false, PIXEL], ['init', PIXEL]])

    inject()
    expect(scripts.map(script => script.src)).toEqual([
      `https://www.googletagmanager.com/gtag/js?id=${GA}`,
      'https://connect.facebook.net/en_US/fbevents.js'
    ])
    // Pixel 的 PageView 在腳本加進文件之前才排進 queue（送出時取當下網址）
    expect(pixelQueue()).toEqual([['set', 'autoConfig', false, PIXEL], ['init', PIXEL], ['track', 'PageView']])
  })

  it('載入前換過頁：GA 兩筆 page_view 各帶自己的網址；Pixel 只補送一次；defer 只排一次', () => {
    const { analytics, scripts, requests, inject } = deferred()
    analytics.pageView(at('/?utm_source=line'), '/', '首頁')
    analytics.pageView(at('/about'), '/about', '關於常春藤')
    expect(requests).toHaveLength(1)
    expect(pixelPageViews()).toEqual([])
    inject()
    expect(events('page_view')).toEqual([
      { page_location: at('/?utm_source=line'), page_title: '首頁' },
      { page_location: at('/about'), page_title: '關於常春藤', page_referrer: at('/?utm_source=line') }
    ])
    expect(pixelPageViews()).toHaveLength(1)
    expect(scripts).toHaveLength(2)

    // 載入後照舊：每換一頁各送一次；inject 再被叫也不會重複載入
    analytics.pageView(at('/environment'), '/environment', '校園環境')
    inject()
    expect(pixelPageViews()).toHaveLength(2)
    expect(scripts).toHaveLength(2)
  })

  it('輪到載入時人在預約修改頁：不載；離開後才載，Pixel 只送離開後那一頁', () => {
    const { analytics, scripts, inject } = deferred()
    analytics.pageView(at('/visit/yihua'), '/visit/yihua', '預約參觀')
    analytics.hold('/visit/manage')
    analytics.settle('/visit/manage')
    analytics.pageView(at('/visit/manage#token=SECRET'), '/visit/manage', '修改預約')
    inject()
    expect(scripts).toEqual([])
    expect(pixelPageViews()).toEqual([])
    expect((win as unknown as Record<string, unknown>)[`ga-disable-${GA}`]).toBe(true)

    analytics.hold('/')
    analytics.settle('/')
    expect(scripts).toHaveLength(2)
    expect(pixelPageViews()).toEqual([])
    // 腳本載入前不排 consent：fbevents.js 清 queue 遇到 revoke 就停，後面的 grant 與事件會卡住
    expect(pixelQueue()).toEqual([['set', 'autoConfig', false, PIXEL], ['init', PIXEL]])
    analytics.pageView(at('/'), '/', '首頁')
    expect(pixelPageViews()).toHaveLength(1)
    expect((win as unknown as Record<string, unknown>)[`ga-disable-${GA}`]).toBe(false)
    expect(JSON.stringify([layer(), pixelQueue()])).not.toMatch(/SECRET|manage/)

    // 載入之後再進修改頁：照舊用 consent 暫停、離開後恢復
    analytics.hold('/visit/manage')
    expect(pixelQueue().at(-1)).toEqual(['consent', 'revoke'])
    analytics.settle('/')
    expect(pixelQueue().at(-1)).toEqual(['consent', 'grant'])
  })

  it('換頁被取消（人還在一般頁面）時輪到載入：照常載', () => {
    const { analytics, scripts, inject } = deferred()
    analytics.pageView(at('/'), '/', '首頁')
    analytics.hold('/visit/manage')
    inject()
    expect(scripts).toEqual([])
    analytics.settle('/')
    expect(scripts).toHaveLength(2)
  })

  it('第一頁是預約修改頁：連 defer 都不排', () => {
    const { analytics, requests } = deferred()
    analytics.pageView(at('/visit/manage#token=SECRET'), '/visit/manage', '修改預約')
    expect(requests).toEqual([])
    expect(win.fbq).toBeUndefined()
  })

  it('載入前就預約成功：generate_lead 與 Lead 照樣排進 queue，不會漏', () => {
    const { analytics, inject } = deferred()
    history.replaceState(null, '', '/visit/yihua')
    analytics.pageView(at('/visit/yihua'), '/visit/yihua', '預約參觀')
    reportBookingLead('yihua', 'visit_page')
    expect(events('generate_lead')).toHaveLength(1)
    expect(pixelQueue().at(-1)![1]).toBe('Lead')
    inject()
    // PageView 補在 Lead 後面也無妨：兩筆都會送出
    expect(pixelPageViews()).toHaveLength(1)
  })
})

describe('whenPageSettled（整頁 load 之後、主執行緒有空才載）', () => {
  function fakeWindow(readyState: DocumentReadyState, withIdle = true) {
    const listeners: Record<string, () => void> = {}
    const idle: { fn: () => void; timeout?: number }[] = []
    const fake = {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      addEventListener: (name: string, fn: () => void) => { listeners[name] = fn },
      ...(withIdle ? { requestIdleCallback: (fn: () => void, options?: { timeout?: number }) => { idle.push({ fn, timeout: options?.timeout }) } } : {})
    }
    return { fake: fake as unknown as Window, doc: { readyState } as Document, listeners, idle }
  }
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('還在載入：等 load，再等 requestIdleCallback（上限 2 秒）', () => {
    const run = vi.fn()
    const { fake, doc, listeners, idle } = fakeWindow('interactive')
    whenPageSettled(run, fake, doc)
    expect(idle).toEqual([])
    listeners.load!()
    expect(run).not.toHaveBeenCalled()
    expect(idle).toHaveLength(1)
    expect(idle[0]!.timeout).toBe(2000)
    idle[0]!.fn()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('已經載完（SPA 後來才第一次進到可送事件的頁面）：直接等閒置', () => {
    const run = vi.fn()
    const { fake, doc, listeners, idle } = fakeWindow('complete')
    whenPageSettled(run, fake, doc)
    expect(listeners.load).toBeUndefined()
    idle[0]!.fn()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('沒有 requestIdleCallback（Safari）：load 後等 1 秒', () => {
    const run = vi.fn()
    const { fake, doc, listeners } = fakeWindow('loading', false)
    whenPageSettled(run, fake, doc)
    listeners.load!()
    vi.advanceTimersByTime(999)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('load 遲遲不來：8 秒保底照樣載，之後 load 才到也不會再跑一次', () => {
    const run = vi.fn()
    const { fake, doc, listeners, idle } = fakeWindow('loading')
    whenPageSettled(run, fake, doc)
    vi.advanceTimersByTime(7999)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
    listeners.load!()
    idle[0]!.fn()
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('預約成功事件', () => {
  it('參數只留白名單：campus_key 必須是五校之一、entry 必須是 CTA 入口代碼', () => {
    expect(leadEventParams('yihua', 'visit_page')).toEqual({ campus_key: 'yihua', entry: 'visit_page' })
    expect(leadEventParams('renwu', 'other')).toEqual({ campus_key: 'renwu', entry: 'other' })
    expect(leadEventParams('somewhere', 'hacked')).toEqual({})
    expect(leadEventParams(null, undefined)).toEqual({})
    expect(leadEventParams('yihua', 'visit_page')).not.toHaveProperty('receipt_id')
  })

  it('GA generate_lead＋Pixel Lead：只有白名單參數與清洗過的 page_location，沒有 receipt／修改連結／個資', () => {
    const { analytics } = setup()
    history.replaceState(null, '', '/visit/yihua?utm_source=fb&parent=Alice#frag')
    analytics.pageView(location.href, location.pathname, '預約參觀')
    reportBookingLead('yihua', 'visit_page')
    expect(events('generate_lead')).toEqual([{ campus_key: 'yihua', entry: 'visit_page', page_location: `${ORIGIN}/visit/yihua?utm_source=fb`, page_title: '常春藤幼兒園' }])
    expect(pixelQueue().at(-1)).toEqual(['track', 'Lead', { campus_key: 'yihua', entry: 'visit_page' }])
    expect(JSON.stringify([layer(), pixelQueue()])).not.toMatch(/Alice|frag|receipt|manage_path/)
  })

  it('不合白名單的值直接省略，不會把任意字串送出去', () => {
    const { analytics } = setup()
    analytics.pageView(at('/visit'), '/visit', 'x')
    reportBookingLead('王小明@example.com', '0912345678')
    expect(events('generate_lead')[0]).not.toHaveProperty('campus_key')
    expect(events('generate_lead')[0]).not.toHaveProperty('entry')
    expect(pixelQueue().at(-1)).toEqual(['track', 'Lead', {}])
    expect(JSON.stringify([layer(), pixelQueue()])).not.toMatch(/example\.com|0912/)
  })

  it('沒有載入（沒設 ID、DNT／GPC、被擋）時什麼都不發生，也不丟例外', () => {
    expect(win.gtag).toBeUndefined()
    expect(() => reportBookingLead('yihua', 'visit_page')).not.toThrow()
    expect(win.dataLayer).toBeUndefined()
  })

  it('在不送事件的頁面不送；第三方腳本丟例外也不影響預約成功畫面', () => {
    const { analytics } = setup()
    analytics.pageView(at('/'), '/', 'x')
    const before = layer().length
    history.replaceState(null, '', '/visit/manage')
    reportBookingLead('yihua', 'visit_page')
    expect(layer().length).toBe(before)

    history.replaceState(null, '', '/visit/yihua')
    win.gtag = () => { throw new Error('boom') }
    expect(() => reportBookingLead('yihua', 'visit_page')).not.toThrow()
  })
})

// plugins/third-party-analytics.client.ts：掛載條件與換頁掛鉤。
describe('外掛（plugins/third-party-analytics.client.ts）', () => {
  type Setup = (app: { hook: (name: string, fn: () => void) => void }) => void
  let setupPlugin: Setup
  let appended: HTMLScriptElement[]

  beforeAll(async () => {
    vi.stubGlobal('defineNuxtPlugin', (setup: Setup) => setup)
    setupPlugin = (await import('../app/plugins/third-party-analytics.client')).default as unknown as Setup
  })

  beforeEach(() => {
    appended = []
    // 外掛把外部腳本延到整頁載完、主執行緒有空（whenPageSettled）：用假時鐘，settle() 直接走到 8 秒保底。
    vi.useFakeTimers()
    // 外部腳本不真的載入：攔下 appendChild（script 只在加進文件時才會被 happy-dom 抓取）。
    vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
      appended.push(node as unknown as HTMLScriptElement)
      return node
    })
  })

  function mount(publicConfig: Record<string, unknown>, nav: Record<string, unknown> = { doNotTrack: null }) {
    const hooks: Record<string, () => void> = {}
    const before: ((to: { path: string }) => void)[] = []
    const after: (() => void)[] = []
    vi.stubGlobal('defineNuxtPlugin', (setup: Setup) => setup)
    vi.stubGlobal('useRuntimeConfig', () => ({ public: publicConfig }))
    vi.stubGlobal('useRouter', () => ({ beforeEach: (fn: (to: { path: string }) => void) => before.push(fn), afterEach: (fn: () => void) => after.push(fn) }))
    vi.stubGlobal('navigator', nav)
    setupPlugin({ hook: (name, fn) => { hooks[name] = fn } })
    return { hooks, before, after }
  }
  afterEach(() => { vi.useRealTimers() })
  const settle = () => { vi.advanceTimersByTime(8000) }
  const configured = { gaMeasurementId: GA, metaPixelId: PIXEL, telemetryEnabled: false }
  const go = (path: string) => {
    history.replaceState(null, '', path)
    return [location.href, location.pathname, document.title] as const
  }

  it('兩個 ID 都沒設（預設）：什麼都不掛、不載任何腳本', () => {
    const { hooks, before, after } = mount({ gaMeasurementId: '', metaPixelId: '', telemetryEnabled: true })
    expect(hooks).toEqual({})
    expect(before).toEqual([])
    expect(after).toEqual([])
    expect(appended).toEqual([])
    expect(win.gtag).toBeUndefined()
  })

  it('格式不符視同未設定', () => {
    const { hooks } = mount({ gaMeasurementId: 'UA-1234-1', metaPixelId: 'abc', telemetryEnabled: true })
    expect(hooks).toEqual({})
    expect(appended).toEqual([])
  })

  it('瀏覽器要求不追蹤（DNT）或 Global Privacy Control：不載入', () => {
    for (const nav of [{ doNotTrack: '1' }, { doNotTrack: null, globalPrivacyControl: true }]) {
      const { hooks, before } = mount(configured, nav)
      expect(hooks).toEqual({})
      expect(before).toEqual([])
      expect(appended).toEqual([])
    }
    expect(win.gtag).toBeUndefined()
  })

  it('只看自己的 ID 與 DNT／GPC：第一方統計關掉（telemetryEnabled=false）不影響 GA 與 Pixel', () => {
    const { hooks } = mount(configured)
    go('/')
    hooks['app:mounted']!()
    // hydration 完成當下還不載：事件先排在 queue，外部腳本等頁面載完
    expect(appended).toEqual([])
    expect(events('page_view')).toHaveLength(1)
    settle()
    expect(appended.map(script => script.src)).toEqual([
      `https://www.googletagmanager.com/gtag/js?id=${GA}`,
      'https://connect.facebook.net/en_US/fbevents.js'
    ])
  })

  it('page:finish 與 app:mounted 都觸發同一頁只送一次 page_view，標題取 document.title', () => {
    const { hooks } = mount(configured)
    go('/about?utm_source=line#x')
    document.title = '關於常春藤'
    hooks['page:finish']!()
    hooks['app:mounted']!()
    expect(events('page_view')).toEqual([{ page_location: `${ORIGIN}/about?utm_source=line`, page_title: '關於常春藤' }])
  })

  it('第一頁是 /visit/manage#token：不載入；SPA 換到一般頁面才載入', () => {
    const { hooks, before, after } = mount(configured)
    go('/visit/manage#token=SECRET')
    hooks['app:mounted']!()
    hooks['page:finish']!()
    expect(appended).toEqual([])
    expect(win.dataLayer).toBeUndefined()

    before[0]!({ path: '/' })
    go('/')
    after[0]!()
    hooks['page:finish']!()
    expect(appended).toEqual([])
    settle()
    expect(appended).toHaveLength(2)
    expect(events('page_view')).toHaveLength(1)
    expect(JSON.stringify(layer())).not.toMatch(/SECRET|manage/)
  })

  it('已載入後 SPA 換到 /visit/manage：先在 beforeEach 暫停，修改頁不送事件，離開後恢復', () => {
    const { hooks, before, after } = mount(configured)
    go('/visit/yihua')
    hooks['app:mounted']!()
    settle()
    expect(appended).toHaveLength(2)
    const sent = layer().length

    before[0]!({ path: '/visit/manage' })
    expect((win as unknown as Record<string, unknown>)[`ga-disable-${GA}`]).toBe(true)
    go('/visit/manage#token=SECRET')
    after[0]!()
    hooks['page:finish']!()
    expect(layer().length).toBe(sent)
    expect(pixelQueue().at(-1)).toEqual(['consent', 'revoke'])

    before[0]!({ path: '/' })
    go('/')
    after[0]!()
    hooks['page:finish']!()
    expect((win as unknown as Record<string, unknown>)[`ga-disable-${GA}`]).toBe(false)
    expect(events('page_view')).toHaveLength(2)
    expect(JSON.stringify(layer())).not.toMatch(/SECRET|manage/)
  })
})
