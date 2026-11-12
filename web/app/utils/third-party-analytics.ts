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
  loadScript(doc, `${GA_SCRIPT_ORIGIN}/gtag/js?id=${encodeURIComponent(id)}`)
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
  loadScript(doc, `${META_PIXEL_SCRIPT_ORIGIN}/en_US/fbevents.js`)
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
 * ids 至少有一個 ID。外部腳本等到第一個可送事件的頁面才載入（第一頁是預約修改頁就完全不載）。
 * win／doc 可替換，給單元測試用。
 */
export function createThirdPartyAnalytics(ids: AnalyticsIds, win: AnalyticsWindow = window, doc: Document = document): ThirdPartyAnalytics {
  let loaded = false
  let paused = false
  let lastPath: string | null = null
  let lastLocation: string | null = null

  function setPaused(next: boolean): void {
    if (next === paused) return
    paused = next
    if (!loaded) return
    // GA 的官方關閉開關：window['ga-disable-<評估 ID>'] 為 true 時不送任何資料。
    if (ids.gaMeasurementId) (win as unknown as Record<string, unknown>)[`ga-disable-${ids.gaMeasurementId}`] = next
    if (ids.metaPixelId) win.fbq?.('consent', next ? 'revoke' : 'grant')
  }

  function ensureLoaded(): void {
    if (loaded) return
    loaded = true
    if (ids.gaMeasurementId) setupGa(win, doc, ids.gaMeasurementId)
    if (ids.metaPixelId) setupPixel(win, doc, ids.metaPixelId)
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
      if (ids.metaPixelId) win.fbq?.('track', 'PageView')
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
