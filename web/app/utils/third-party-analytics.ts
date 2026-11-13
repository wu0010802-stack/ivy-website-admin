import { analyticsPageLocation, analyticsSuppressedPath, GA_SCRIPT_ORIGIN, META_PIXEL_SCRIPT_ORIGIN, type AnalyticsIds } from '#shared/third-party-analytics'
import { isCampusKey, isCtaEntry } from './cta-analytics'

// GA4 與 Meta Pixel 的瀏覽器端（2026-11-12，規格 docs/specs/2026-11-12-external-integrations-design.md 第 1 節）。
// 掛載條件、DNT／GPC 與換頁掛鉤在 plugins/third-party-analytics.client.ts；ID 驗證、page_location 清洗、
// 不送事件的路徑、CSP 來源在 shared/third-party-analytics.ts。
//
// 為什麼這樣寫：
// - 公開頁 CSP 只允許登記過雜湊的 inline script，所以 gtag／fbq 的 queue stub 不能照官方貼 <script>，
//   改在這裡用 JS 建，外部腳本用 createElement 載（不用 GTM：GTM 讓有容器權限的人能注入任意腳本到和後台同源的網站）。
// - GA 與 Pixel 預設都會自己送完整網址。/visit/manage 的識別碼在網址 hash，所以：
//   1. GA 以 send_page_view:false 設定，page_view 自己送，page_location 自組（不帶 hash，query 只留歸因參數）；
//   2. 第一頁就是不送事件的路徑（預約修改頁、後台、草稿預覽）時根本不載入外部腳本；
//   3. 已載入後要進入那些頁面，先在換頁前（router.beforeEach）把 GA 以 window['ga-disable-<ID>'] 關掉、
//      Pixel 以 fbq('consent','revoke') 暫停，連兩家自動送的事件（GA 的強化評估、Pixel 的自動事件）也擋下；
//      離開後才恢復。
// - Pixel 關掉 autoConfig（自動偵測按鈕點擊、頁面 metadata），預約表單有 Email、電話欄位，不讓它自動比對。
// - 外部腳本延後載入（2026-11-12 手機效能）：gtag／fbq 的 queue stub 照舊在第一個可送事件的頁面就建好，事件先排進 queue，
//   兩支外部腳本（共約 360 KB）等 defer 叫了才加進文件——外掛給的是 whenPageSettled（整頁 load 之後、主執行緒有空時）。
//   原本 app:mounted 當下就載：慢速手機網路上和首屏照片、字型搶頻寬（內頁 LCP 晚 0.4–0.6 秒），
//   執行又剛好落在 hydration 之後的第一秒（桌機 CPU 約 190ms，中階手機約四倍）。
//   延後期間的規則：
//   1. GA 的事件自帶 page_location，照常排進 dataLayer，腳本載入後原樣送出（中途換過頁也不會記錯網址）。
//   2. Pixel 的 PageView 取的是腳本執行當下的網址，所以載入前不排進 queue，只記「有一次要送」，載入時補送一次（當下這一頁）。
//   3. 輪到要載入時人在不送事件的頁面就不載，等離開（setPaused(false)）再載；這段期間也不把 consent revoke／grant 排進
//      Pixel 的 queue（理由寫在 setPaused）。GA 的關閉開關只是 window 上的旗標，照常設。

type Gtag = (...args: unknown[]) => void
interface Fbq {
  (...args: unknown[]): void
  callMethod?: (...args: unknown[]) => void
  queue: unknown[][]
  push: unknown
  loaded: boolean
  version: string
  disablePushState?: boolean
}
type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag; fbq?: Fbq; _fbq?: Fbq }

function loadScript(doc: Document, src: string): void {
  const script = doc.createElement('script')
  script.async = true
  script.src = src
  // 被廣告攔截器或網路擋掉就安靜略過，不影響頁面。
  script.addEventListener('error', () => script.remove())
  doc.head.appendChild(script)
}

function setupGa(win: AnalyticsWindow, doc: Document, id: string): void {
  win.dataLayer = win.dataLayer ?? []
  const dataLayer = win.dataLayer
  if (!win.gtag) {
    // gtag.js 只認 arguments 物件（不是陣列），所以不能改寫成 (...args) => dataLayer.push(args)。
    win.gtag = function gtag() { dataLayer.push(arguments) }
  }
  win.gtag('js', new Date())
  // send_page_view:false：config 不自動送 page_view，由換頁掛鉤自己送（page_location 已清洗）。
  // 關掉 Google 訊號與廣告個人化：這次不做 Google Ads，也就用不到 doubleclick／google.com 那幾個端點（CSP 沒放行）。
  win.gtag('config', id, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false })
}

function setupPixel(win: AnalyticsWindow, doc: Document, id: string): void {
  if (!win.fbq) {
    // 與 Meta 官方 snippet 相同的 queue stub；fbevents.js 載入後會接手 callMethod 並處理 queue。
    const queue: unknown[][] = []
    const fbq = ((...args: unknown[]) => {
      if (fbq.callMethod) fbq.callMethod(...args)
      else queue.push(args)
    }) as Fbq
    fbq.queue = queue
    fbq.push = fbq
    fbq.loaded = true
    fbq.version = '2.0'
    // fbevents.js 預設在 pushState／popstate 時自己送 PageView；換頁由 pageView() 送，不關會重複計次。
    fbq.disablePushState = true
    win.fbq = fbq
    win._fbq = fbq
  }
  // 要在 init 之前：關掉自動設定（自動事件、頁面 metadata）。
  win.fbq('set', 'autoConfig', false, id)
  win.fbq('init', id)
}

/** 什麼時候把外部腳本加進文件；預設馬上（單元測試與沒有特別要求的呼叫端）。 */
export type DeferScripts = (inject: () => void) => void

/**
 * 整頁 load 之後、主執行緒有空時才叫 run（外掛用來延後 GA／Pixel 的外部腳本）。
 * - 等 load：首屏照片、字型、hydration 都先跑完，第三方腳本不跟它們搶頻寬與主執行緒。
 * - requestIdleCallback 給 2 秒上限：使用者一直在捲動也不會等不到。沒有這個 API 的瀏覽器（Safari）load 後固定等 1 秒。
 * - 另有 8 秒保底：某個資源卡住讓 load 遲遲不來時照樣載入，不會整個工作階段都沒有統計。
 */
export function whenPageSettled(run: () => void, win: Window = window, doc: Document = document): void {
  let done = false
  const once = () => {
    if (done) return
    done = true
    win.clearTimeout(fallback)
    run()
  }
  const idle = () => {
    if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(once, { timeout: 2000 })
    else win.setTimeout(once, 1000)
  }
  const fallback = win.setTimeout(once, 8000)
  if (doc.readyState === 'complete') idle()
  else win.addEventListener('load', idle, { once: true })
}

export interface ThirdPartyAnalytics {
  /** 換頁開始前（router.beforeEach）：目的地是不送事件的頁面就先暫停兩家。 */
  hold(pathname: string): void
  /** 換頁結束後（router.afterEach）：依目前實際所在的頁面恢復或維持暫停（換頁被取消時也要回得來）。 */
  settle(pathname: string): void
  /** 進入一頁（含第一頁）：不送事件的頁面什麼都不做；其餘送 GA page_view 與 Pixel PageView，同一路徑不重送。 */
  pageView(href: string, pathname: string, title: string): void
}

/**
 * ids 至少有一個 ID。queue stub 等到第一個可送事件的頁面才建（第一頁是預約修改頁就完全不建、不載）；
 * 外部腳本再等 defer 叫了才加進文件（預設馬上，外掛傳 whenPageSettled）。
 * win／doc 可替換，給單元測試用。
 */
export function createThirdPartyAnalytics(ids: AnalyticsIds, win: AnalyticsWindow = window, doc: Document = document, defer: DeferScripts = inject => inject()): ThirdPartyAnalytics {
  /** stub 已建、事件可以排進 queue。 */
  let loaded = false
  /** defer 已經叫過 inject：可以載了（人在不送事件的頁面時先不載，離開再載）。 */
  let due = false
  /** 外部腳本已加進文件。 */
  let injected = false
  /** 外部腳本載入前有 Pixel PageView 要送（載入時補送一次）。 */
  let pixelPageViewPending = false
  let paused = false
  let lastPath: string | null = null
  let lastLocation: string | null = null

  function inject(): void {
    due = true
    if (injected || paused) return
    injected = true
    if (ids.gaMeasurementId) loadScript(doc, `${GA_SCRIPT_ORIGIN}/gtag/js?id=${encodeURIComponent(ids.gaMeasurementId)}`)
    if (ids.metaPixelId) {
      if (pixelPageViewPending) win.fbq?.('track', 'PageView')
      pixelPageViewPending = false
      loadScript(doc, `${META_PIXEL_SCRIPT_ORIGIN}/en_US/fbevents.js`)
    }
  }

  function setPaused(next: boolean): void {
    if (next === paused) return
    paused = next
    // 進了不送事件的頁面：還沒送出的 Pixel PageView 作廢（離開後的那一頁自己會再送，不然補送時會算兩次）。
    if (next) pixelPageViewPending = false
    if (!loaded) return
    // GA 的官方關閉開關：window['ga-disable-<評估 ID>'] 為 true 時不送任何資料。
    if (ids.gaMeasurementId) (win as unknown as Record<string, unknown>)[`ga-disable-${ids.gaMeasurementId}`] = next
    // Pixel 的暫停只在外部腳本加進文件之後才排：還沒載入本來就送不出任何東西，而且 fbevents.js 載入後清 queue 時
    // 遇到 consent revoke 就停，排在後面的 grant 與事件會一直卡在 queue（2026-11-12 以正式站的 fbevents.js 實測）。
    if (ids.metaPixelId && injected) win.fbq?.('consent', next ? 'revoke' : 'grant')
    // 輪到載入時人在不送事件的頁面所以沒載：離開了，現在補載。
    if (!next && due) inject()
  }

  function ensureLoaded(): void {
    if (loaded) return
    loaded = true
    if (ids.gaMeasurementId) setupGa(win, doc, ids.gaMeasurementId)
    if (ids.metaPixelId) setupPixel(win, doc, ids.metaPixelId)
    defer(inject)
  }

  return {
    hold(pathname) {
      if (analyticsSuppressedPath(pathname)) setPaused(true)
    },
    settle(pathname) {
      setPaused(analyticsSuppressedPath(pathname))
    },
    pageView(href, pathname, title) {
      if (pathname === lastPath) return
      lastPath = pathname
      if (analyticsSuppressedPath(pathname)) {
        setPaused(true)
        lastLocation = null
        return
      }
      setPaused(false)
      ensureLoaded()
      const pageLocation = analyticsPageLocation(href)
      if (ids.gaMeasurementId) {
        // set：GA 自動送的事件（捲動、外連點擊）也用清洗過的網址與標題，不取 document.location。
        win.gtag?.('set', { page_location: pageLocation, page_title: title })
        // 第一次不帶 page_referrer，讓 GA 自己用 document.referrer 判斷來源；之後換頁才帶上一頁。
        win.gtag?.('event', 'page_view', { page_location: pageLocation, page_title: title, ...(lastLocation ? { page_referrer: lastLocation } : {}) })
      }
      if (ids.metaPixelId) {
        // 腳本還沒載入：Pixel 送出時取的是當下網址，先記著，載入時補送一次（見檔頭說明）。
        if (injected) win.fbq?.('track', 'PageView')
        else pixelPageViewPending = true
      }
      lastLocation = pageLocation
    }
  }
}

/** 預約成功事件的參數：只收白名單的 campus_key（五校之一）與 entry（CTA 區塊代碼），其他一律不送。 */
export function leadEventParams(campusKey: unknown, entry: unknown): { campus_key?: string; entry?: string } {
  return {
    ...(isCampusKey(campusKey) ? { campus_key: campusKey } : {}),
    ...(isCtaEntry(entry) ? { entry } : {})
  }
}

/**
 * 預約成功（伺服器回 status === 'confirmed'）時呼叫：GA generate_lead、Pixel Lead。
 * 沒載入（沒設 ID、DNT／GPC、被擋）時 window 上沒有 gtag／fbq，什麼都不會發生。
 * 不帶 receipt、修改連結或任何個資；GA 事件另帶清洗過的 page_location，不取 document.location。
 */
export function reportBookingLead(campusKey: unknown, entry: unknown, win: AnalyticsWindow = window): void {
  if (analyticsSuppressedPath(win.location.pathname)) return
  const params = leadEventParams(campusKey, entry)
  try {
    win.gtag?.('event', 'generate_lead', { ...params, page_location: analyticsPageLocation(win.location.href), page_title: win.document.title })
    win.fbq?.('track', 'Lead', params)
  } catch {
    // 第三方腳本出錯不能影響家長看到「預約成功」。
  }
}
