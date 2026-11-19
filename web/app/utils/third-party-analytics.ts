import { analyticsPageLocation, analyticsSuppressedPath, GA_SCRIPT_ORIGIN, lineTagSearch, LINE_TAG_SCRIPT_ORIGIN, META_PIXEL_SCRIPT_ORIGIN, OPENAI_PIXEL_CONFIG_PREFIX, OPENAI_PIXEL_SCRIPT_ORIGIN, type AnalyticsIds } from '#shared/third-party-analytics'
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
//
// OpenAI 評估像素（ChatGPT 廣告，2026-11-15，規格 docs/specs/2026-11-15-openai-ads-pixel-design.md）：
// - 只用來回報「預約成功」（appointment_scheduled）這一個轉換，不送 page_viewed：SDK（oaiq.min.js）不掛 pushState／popstate，
//   init 之後只有我們呼叫 measure 才送事件，事件帶的網址只有 origin＋pathname（2026-11-15 讀當時的 SDK 原始碼確認），
//   所以換頁不必通知它，也沒有 hash 裡的識別碼被送出去的問題。
// - 進不送事件的頁面一樣先暫停：oaiq('consent', false)。SDK 自己還會送診斷事件（載入、分頁切到背景時），暫停後完全不送
//   （2026-11-15 以真的 SDK 實測：暫停期間送往 bzr 的請求 0 筆）。副作用是它會把 __oppref（廣告點擊代碼）等 cookie 刪掉，
//   所以暫停前先把點擊代碼記在記憶體，離開時 consent(true) 之後重新 init 帶回去，同一次造訪的歸因不會斷。
//   暫停會在 localStorage 留一筆「拒絕」，所以每次建 stub 都先送 consent(true) 再 init（只有這裡會設拒絕）。
// - 廣告點擊代碼（網址的 oppref）在建 stub 當下就讀出來傳給 init：外部腳本延後載入，家長在載入前就站內換頁的話
//   網址上已經沒有 oppref，SDK 自己讀不到。
// - SDK 的「自動進階比對」會掃頁面上的 Email／電話欄位、雜湊後跟事件一起送。開不開看 SDK 向 bzrcdn 取的設定檔
//   （pixel-config/v1/<Pixel ID>.json），平台上沒有開關、網頁像素一律啟用（2026-11-15 建好像素後實測設定檔回 true）。
//   預約表單有這些欄位，隱私權政策寫明不傳送，所以官網自己把它關掉：keepOpenaiAutoMatchingOff 攔下那個請求、
//   直接回「關」；CSP 也不放行 bzrcdn 的 connect-src 當第二道（shared/third-party-analytics.ts）。

//
// LINE Tag（LINE 廣告，2026-11-16，第四家；NUXT_PUBLIC_LINE_TAG_ID，預設關）：
// - 只送頁面瀏覽（pv）與預約成功的轉換（cv，type: 'Conversion'）。lt.js 不掛 pushState／popstate，init 之後只有我們呼叫 send 才送事件。
// - 不送任何個資或雜湊個資：init 不帶 tel／email／externalId／deduplicationKey（LINE 的「進階比對」就是靠這幾個欄位），
//   也關掉跨網域同步（allowSync:false、不設 autoLink／syncByLCS／syncByLIFF）。
// - lt.js 預設把完整網址（含 hash 與所有 query）放進每個請求，所以 init 傳 $location 自己的清洗版（lineTagLocation）：
//   origin＋pathname＋只留歸因參數與 LINE 廣告點擊代碼的 query，hash 一律空（2026-11-16 實測：預設送 b_h=#hash-id、b_q=?secret=1，
//   帶 $location 後兩者都不見）。lt.js 只在 init 與每次送事件時讀 $location，所以 getter 每次取當下的網址。
//   例外：lt.js 自己壞掉時的 err.gif 會帶完整網址（lt.js 內建、無法改），預約修改頁因為不載入而不受影響。
// - Pixel 同樣的規矩：腳本載入前不把 pv 排進 queue（queue 在載入時才一次處理，所有 pv 都會讀到載入當下的網址），
//   只記「有一次要送」，載入時補送當下這一頁。lt.js 沒有暫停／同意 API，進不送事件的頁面只要不呼叫 send 就不會送。
// - lt.js 會在第一方網域寫 __lt__cid（兩年）與 __lt__sid（30 分鐘）cookie、localStorage 也有一份 __lt__cid；隱私權政策的揭露由使用者另外處理。

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
interface Oaiq {
  (...args: unknown[]): void
  q: unknown[]
}
type LineTag = (...args: unknown[]) => void
type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag; fbq?: Fbq; _fbq?: Fbq; oaiq?: Oaiq; _lt?: LineTag; _ltq?: unknown[] }

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

/** 網址上的 ChatGPT 廣告點擊代碼（oppref）；沒有或長得不合理就不傳。 */
export function openaiClickId(search: string): string | undefined {
  const value = new URLSearchParams(search).get('oppref')?.trim()
  return value && value.length <= 512 ? value : undefined
}

const AUTO_MATCHING_OFF = '{"automatic_advanced_matching_enabled":false}'
const FETCH_GUARD = '__ivyOpenaiAutoMatchingOff'

/**
 * 讓 OpenAI 的 SDK 永遠拿到「自動進階比對：關」：包一層 fetch，只攔它取設定檔的那個網址（不連外、直接回固定內容），
 * 其他請求原封不動交給原本的 fetch。SDK 每次都從 window.fetch 取用（讀 2026-11-15 的 oaiq.min.js 確認），
 * 所以要在載入 SDK 之前裝好；重複呼叫只裝一次。
 */
export function keepOpenaiAutoMatchingOff(win: Window): void {
  const native = win.fetch as (typeof fetch & { [FETCH_GUARD]?: true }) | undefined
  if (typeof native !== 'function' || native[FETCH_GUARD]) return
  const guarded = function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let url = ''
    try {
      url = typeof input === 'string' ? input : input instanceof URL ? input.href : String((input as Request).url ?? '')
    } catch {
      // 讀不出網址就當一般請求
    }
    if (url.startsWith(OPENAI_PIXEL_CONFIG_PREFIX)) {
      return Promise.resolve(new Response(AUTO_MATCHING_OFF, { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    return native.call(win, input, init)
  } as typeof fetch & { [FETCH_GUARD]?: true }
  guarded[FETCH_GUARD] = true
  win.fetch = guarded
}

/** SDK 存廣告點擊代碼的第一方 cookie（暫停前讀出來，恢復時帶回去）。 */
function storedOpenaiClickId(doc: Document): string | undefined {
  try {
    const match = /(?:^|;\s*)__oppref=([^;]*)/.exec(doc.cookie ?? '')
    const value = match ? decodeURIComponent(match[1]!).trim() : ''
    return value && value.length <= 512 ? value : undefined
  } catch {
    return undefined
  }
}

function initOpenaiPixel(win: AnalyticsWindow, id: string, oppref: string | undefined): void {
  win.oaiq?.('init', { pixelId: id, ...(oppref ? { oppref } : {}) })
}

/** 回傳進站網址上的廣告點擊代碼（沒有就是 undefined），給暫停／恢復用。 */
function setupOpenaiPixel(win: AnalyticsWindow, id: string): string | undefined {
  keepOpenaiAutoMatchingOff(win)
  if (!win.oaiq) {
    // 與官方 snippet 相同的 queue stub：oaiq.min.js 載入後會接手，並把 q 裡的 arguments 依序處理。
    const queue: unknown[] = []
    const oaiq = function oaiq() { queue.push(arguments) } as unknown as Oaiq
    oaiq.q = queue
    win.oaiq = oaiq
  }
  const oppref = openaiClickId(win.location.search)
  // 先 consent(true)：上次造訪若停在不送事件的頁面，SDK 會記著「拒絕」，不清掉的話這次什麼都不送。
  win.oaiq('consent', true)
  initOpenaiPixel(win, id, oppref)
  return oppref
}

/**
 * 傳給 lt.js 的 $location（它原本用 window.location）：欄位與 lt.js 內建的相同，href／search／hash 是清洗版。
 * 每個欄位都是 getter，換頁後取到的是當下的網址。
 */
export function lineTagLocation(win: Pick<Window, 'location'>) {
  const loc = () => win.location
  return {
    get href() { return `${loc().origin}${loc().pathname}${lineTagSearch(loc().search)}` },
    get protocol() { return loc().protocol },
    get host() { return loc().host },
    get hostname() { return loc().hostname },
    get port() { return loc().port },
    get pathname() { return loc().pathname },
    get search() { return lineTagSearch(loc().search) },
    get hash() { return '' },
    get origin() { return loc().origin }
  }
}

function setupLineTag(win: AnalyticsWindow, id: string): void {
  if (!win._lt) {
    // 與 LINE 官方 snippet 相同的 queue stub：lt.js 載入後會把 _ltq 依序處理並接手 window._lt。
    win._ltq = win._ltq ?? []
    const queue = win._ltq
    win._lt = function lt() { queue.push(arguments) }
  }
  win._lt('init', { customerType: 'account', tagId: id, allowSync: false, $location: lineTagLocation(win) })
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
  /** 同上，LINE Tag 的 pv。 */
  let linePageViewPending = false
  let paused = false
  let lastPath: string | null = null
  let lastLocation: string | null = null
  /** OpenAI 的廣告點擊代碼：進站網址上的，或暫停前從 cookie 讀到的；恢復時帶回 init。 */
  let openaiClick: string | undefined

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
    if (ids.openaiPixelId) loadScript(doc, `${OPENAI_PIXEL_SCRIPT_ORIGIN}/sdk/oaiq.min.js`)
    if (ids.lineTagId) {
      if (linePageViewPending) win._lt?.('send', 'pv', [ids.lineTagId])
      linePageViewPending = false
      loadScript(doc, `${LINE_TAG_SCRIPT_ORIGIN}/n/line_tag/public/release/v1/lt.js`)
    }
  }

  function setPaused(next: boolean): void {
    if (next === paused) return
    paused = next
    // 進了不送事件的頁面：還沒送出的 Pixel PageView 作廢（離開後的那一頁自己會再送，不然補送時會算兩次）。
    if (next) { pixelPageViewPending = false; linePageViewPending = false }
    if (!loaded) return
    // GA 的官方關閉開關：window['ga-disable-<評估 ID>'] 為 true 時不送任何資料。
    if (ids.gaMeasurementId) (win as unknown as Record<string, unknown>)[`ga-disable-${ids.gaMeasurementId}`] = next
    // Pixel 的暫停只在外部腳本加進文件之後才排：還沒載入本來就送不出任何東西，而且 fbevents.js 載入後清 queue 時
    // 遇到 consent revoke 就停，排在後面的 grant 與事件會一直卡在 queue（2026-11-12 以正式站的 fbevents.js 實測）。
    if (ids.metaPixelId && injected) win.fbq?.('consent', next ? 'revoke' : 'grant')
    // OpenAI：暫停會刪掉點擊代碼的 cookie，先記下來；恢復後重新 init 帶回去（理由見檔頭）。
    if (ids.openaiPixelId) {
      if (next) {
        openaiClick = storedOpenaiClickId(doc) ?? openaiClick
        win.oaiq?.('consent', false)
      } else {
        win.oaiq?.('consent', true)
        initOpenaiPixel(win, ids.openaiPixelId, openaiClick)
      }
    }
    // 輪到載入時人在不送事件的頁面所以沒載：離開了，現在補載。
    if (!next && due) inject()
  }

  function ensureLoaded(): void {
    if (loaded) return
    loaded = true
    if (ids.gaMeasurementId) setupGa(win, doc, ids.gaMeasurementId)
    if (ids.metaPixelId) setupPixel(win, doc, ids.metaPixelId)
    if (ids.openaiPixelId) openaiClick = setupOpenaiPixel(win, ids.openaiPixelId)
    if (ids.lineTagId) setupLineTag(win, ids.lineTagId)
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
      if (ids.lineTagId) {
        if (injected) win._lt?.('send', 'pv', [ids.lineTagId])
        else linePageViewPending = true
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
 * 預約成功（伺服器回 status === 'confirmed'）時呼叫：GA generate_lead、Pixel Lead、OpenAI appointment_scheduled、LINE Tag 的 Conversion。
 * 沒載入（沒設 ID、DNT／GPC、被擋）時 window 上沒有 gtag／fbq／oaiq，什麼都不會發生。
 * 不帶 receipt、修改連結或任何個資；GA 事件另帶清洗過的 page_location，不取 document.location。
 * OpenAI 的事件只有事件名稱（標準事件 appointment_scheduled 的資料格式不收自訂欄位），校區與入口代碼不送。
 * LINE Tag 的 cv 只帶 type: 'Conversion'（不帶金額、校區、入口、個資），不指定 Tag ID（用 init 的那一個）。
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
  try {
    win.oaiq?.('measure', 'appointment_scheduled', { type: 'customer_action' })
  } catch {
    // 同上；另外包一層，前面兩家出錯也不會讓這一筆漏掉。
  }
  try {
    win._lt?.('send', 'cv', { type: 'Conversion' })
  } catch {
    // 同上
  }
}
