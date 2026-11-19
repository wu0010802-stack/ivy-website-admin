// GA4 與 Meta Pixel（2026-11-12，規格 docs/specs/2026-11-12-external-integrations-design.md 第 1 節）的純函式；
// 2026-11-15 加上 ChatGPT 廣告的 OpenAI 評估像素（規格 docs/specs/2026-11-15-openai-ads-pixel-design.md）。
// 瀏覽器端的載入與事件在 app/utils/third-party-analytics.ts、plugins/third-party-analytics.client.ts；
// 伺服器端的 CSP 在 server/utils/security-headers.ts。兩邊共用的判斷放這裡，單元測試在
// tests/third-party-analytics.spec.ts。
//
// 全部預設關：runtimeConfig.public 的三個 ID 沒設（或格式不符）就視同未設定——不載外部腳本，CSP 也一字不變。

export interface AnalyticsIds {
  /** GA4 評估 ID，例如 G-ABC123DEF4；沒設定是 null。 */
  gaMeasurementId: string | null
  /** Meta Pixel ID（純數字）；沒設定是 null。 */
  metaPixelId: string | null
  /** ChatGPT 廣告（OpenAI Ads）評估像素的 Pixel ID；沒設定是 null。 */
  openaiPixelId: string | null
  /** LINE Tag（LINE 廣告）的 Tag ID（UUID）；沒設定是 null。 */
  lineTagId: string | null
}

export const GA_SCRIPT_ORIGIN = 'https://www.googletagmanager.com'
export const META_PIXEL_SCRIPT_ORIGIN = 'https://connect.facebook.net'
/** OpenAI 評估像素的 SDK 來源（oaiq.min.js）；事件送到 OPENAI_PIXEL_EVENT_ORIGIN。 */
export const OPENAI_PIXEL_SCRIPT_ORIGIN = 'https://bzrcdn.openai.com'
export const OPENAI_PIXEL_EVENT_ORIGIN = 'https://bzr.openai.com'
/** SDK 取「自動進階比對」設定檔的網址開頭（後面接 v1/<Pixel ID>.json）。 */
export const OPENAI_PIXEL_CONFIG_PREFIX = `${OPENAI_PIXEL_SCRIPT_ORIGIN}/pixel-config/`

/** LINE Tag：lt.js 載入後會再載入 ltag.js（LINE Yahoo 共用的標籤引擎），兩支都要放行 script-src。 */
export const LINE_TAG_SCRIPT_ORIGIN = 'https://d.line-scdn.net'
export const LINE_TAG_ENGINE_ORIGIN = 'https://tag.flvcdn.net'
/** 事件以 1x1 圖片請求送到這裡（tag.gif／err.gif），所以只放 img-src。 */
export const LINE_TAG_EVENT_ORIGIN = 'https://tr.line.me'

export function normalizeGaMeasurementId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return /^G-[A-Z0-9]{4,20}$/.test(id) ? id : null
}

// Nitro 把環境變數灌進 runtimeConfig 時會先用 destr 解析：NUXT_PUBLIC_META_PIXEL_ID=1234567890123456 進來的是
// number，不是字串（2026-11-12 用 nitropack 的 applyEnv 實測）。所以數字要收；但超過 Number.MAX_SAFE_INTEGER
// （9007199254740991，16 位且開頭 9007 以上）的 ID 在解析時已經失真，無從還原，一律視同未設定，
// 而不是載入一個錯的 Pixel（deploy/README.md 寫了這種 ID 要連雙引號一起填，讓 destr 當字串）。
export function normalizeMetaPixelId(value: unknown): string | null {
  let id: string
  if (typeof value === 'string') id = value.trim()
  else if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) id = String(value)
  else return null
  return /^\d{8,20}$/.test(id) ? id : null
}

// OpenAI 的 Pixel ID 由廣告管理平台「轉換 → 資料來源」產生。官方文件沒有寫死格式，所以只收不可能跳出網址或
// 物件字面值的字元（英數、底線、連字號），6–64 字。和 Meta 的 ID 一樣，純數字的環境變數會被 Nitro 解析成 number。
export function normalizeOpenaiPixelId(value: unknown): string | null {
  let id: string
  if (typeof value === 'string') id = value.trim()
  else if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) id = String(value)
  else return null
  return /^[A-Za-z0-9][A-Za-z0-9_-]{5,63}$/.test(id) ? id : null
}

// LINE Tag ID 由 LINE 廣告管理後台「事件管理 → LINE Tag」產生，格式是 UUID。只收 UUID：
// 不可能夾帶網址或物件字面值，也不會誤把別的字串當 ID 載入外部腳本。
export function normalizeLineTagId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim().toLowerCase()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null
}

/** 從 runtimeConfig（含 public）取四個 ID；格式不符一律當作沒設。config 可能是空物件（測試）。 */
export function analyticsIdsFromConfig(config: unknown): AnalyticsIds {
  const pub = (config as { public?: Record<string, unknown> } | null | undefined)?.public
  return {
    gaMeasurementId: normalizeGaMeasurementId(pub?.gaMeasurementId),
    metaPixelId: normalizeMetaPixelId(pub?.metaPixelId),
    openaiPixelId: normalizeOpenaiPixelId(pub?.openaiPixelId),
    lineTagId: normalizeLineTagId(pub?.lineTagId)
  }
}

export function analyticsEnabled(ids: AnalyticsIds): boolean {
  return Boolean(ids.gaMeasurementId || ids.metaPixelId || ids.openaiPixelId || ids.lineTagId)
}

export interface AnalyticsCspSources {
  script: string[]
  connect: string[]
  img: string[]
}

/**
 * 公開頁 CSP 要多放行的來源。只加有設定的那一家；全都沒設時三個陣列都是空的，
 * CSP 字串就和沒有這個功能時完全相同。後台 CSP 不用這個。
 */
export function analyticsCspSources(ids: AnalyticsIds): AnalyticsCspSources {
  const sources: AnalyticsCspSources = { script: [], connect: [], img: [] }
  if (ids.gaMeasurementId) {
    sources.script.push(GA_SCRIPT_ORIGIN)
    // *.google.com（2026-11-19）：GA4 連結 Google Ads 之後，gtag.js 把事件改送 analytics.google.com（裸網域，
    // *.analytics.google.com 配不到），失敗再退回 www.google.com/g/collect。少了這條，GA4 收不到任何事件，
    // 匯進 Google Ads 的 generate_lead 轉換也就永遠是 0（正式站 Chrome 與 WebKit 都實測全被擋）。
    // Google 官方的 GA4 CSP 基準（沒開廣告功能也一樣）就是 connect-src 含 https://*.google.com。
    // Google 信號／再行銷名單的端點（stats.g.doubleclick.net、www.google.<國碼>/ads/ga-audiences）刻意不放行：
    // 廣告個人化是關的，那幾支被擋只會在主控台留下 CSP 違規，不影響 GA4 收資料與轉換匯入。
    sources.connect.push('https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.google.com', GA_SCRIPT_ORIGIN)
    sources.img.push('https://*.google-analytics.com', GA_SCRIPT_ORIGIN)
  }
  if (ids.metaPixelId) {
    sources.script.push(META_PIXEL_SCRIPT_ORIGIN)
    sources.connect.push('https://www.facebook.com', META_PIXEL_SCRIPT_ORIGIN)
    sources.img.push('https://www.facebook.com')
  }
  if (ids.openaiPixelId) {
    // 官方文件「Configure a content security policy」：SDK 從 bzrcdn 載入；事件以 fetch／sendBeacon 送到 bzr，
    // 失敗時退回圖片請求。
    // 文件另外要求 connect-src 放行 bzrcdn，用途只有一個：取這顆像素的設定檔，內容是「自動進階比對」開不開。
    // **刻意不放行**：那個功能會掃頁面上的 Email／電話欄位、雜湊後跟事件一起送，平台上沒有開關可關（網頁像素一律啟用），
    // 而預約表單有這些欄位、隱私權政策寫明不傳送。SDK 取不到設定檔就維持關閉。平常由瀏覽器端攔下這個請求直接回「關」
    // （app/utils/third-party-analytics.ts 的 keepOpenaiAutoMatchingOff，主控台不會有錯誤）；這裡是第二道：
    // 哪天攔截失效，請求會被 CSP 擋掉（主控台會出現 CSP 違規，功能仍然是關的）。
    sources.script.push(OPENAI_PIXEL_SCRIPT_ORIGIN)
    sources.connect.push(OPENAI_PIXEL_EVENT_ORIGIN)
    sources.img.push(OPENAI_PIXEL_EVENT_ORIGIN)
  }
  if (ids.lineTagId) {
    // 2026-11-16 以真的 lt.js 3.7.0 在空白頁實測（送往 LINE 的請求以 204 攔下，沒有真的送出事件）：
    // lt.js（d.line-scdn.net）載入後再插入 tag.flvcdn.net/ltag.js；init／pv／cv 各是一張 1x1 圖片請求
    // tr.line.me/tag.gif，沒有 fetch／XHR／sendBeacon，所以 connect-src 不用放行。
    // ltag.js 內有 LINE Yahoo 的 apm.yahoo.co.jp 呼叫，那一支會讀完整網址（含 hash）、不受我們傳給 lt.js 的 $location 影響，
    // 刻意不放行：CSP 擋下之後只是少了日本市場用的功能（主控台會有 CSP 違規），台灣站用不到。
    sources.script.push(LINE_TAG_SCRIPT_ORIGIN, LINE_TAG_ENGINE_ORIGIN)
    sources.img.push(LINE_TAG_EVENT_ORIGIN)
  }
  return sources
}

// 完全不送事件的頁面：預約修改頁（識別碼在網址 hash，Referrer-Policy 也是 no-referrer）、
// 後台、草稿預覽（內容還沒發布）。比對前先解碼、合併重複斜線、轉小寫：vue-router 預設不分大小寫，
// /Visit/Manage 一樣會進到修改頁；寧可多擋也不要漏。
const SUPPRESSED_PATH = /^\/(?:admin|preview|visit\/manage)(?:\/|$)/

function comparablePath(pathname: string): string {
  let path = pathname
  try {
    path = decodeURIComponent(pathname)
  } catch {
    // 解不開的 % 序列就用原字串比對
  }
  return path.replace(/\/{2,}/g, '/').toLowerCase()
}

export function analyticsSuppressedPath(pathname: string): boolean {
  return SUPPRESSED_PATH.test(comparablePath(pathname))
}

// query 只留行銷歸因用的：utm_*、gclid、gbraid、wbraid、fbclid。其他參數與 hash 一律不送。
// gbraid／wbraid（2026-11-13）：Google 廣告在 iOS 上拿不到 gclid 時改帶這兩個點擊代碼；
// 濾掉的話 GA4 匯進 Google Ads 的轉換會漏算 iPhone 的廣告點擊。
const ATTRIBUTION_PARAM = /^(?:utm_[a-z0-9_]+|gclid|gbraid|wbraid|fbclid)$/i

// LINE Tag 另外要保留 LINE 廣告自己帶的點擊代碼（lt.js 在 init 時從網址讀，見 lt.js 的 _parseMessageParam）。
const LINE_CLICK_PARAM = /^(?:ldtag_m|ldtag_cl|ldtag_t|lt_r|srclt)$/i

/** 傳給 lt.js 的 $location 用：query 只留歸因參數與 LINE 廣告點擊代碼，其他一律不送。 */
export function lineTagSearch(search: string): string {
  const kept = new URLSearchParams()
  for (const [key, value] of new URLSearchParams(search)) {
    if (ATTRIBUTION_PARAM.test(key) || LINE_CLICK_PARAM.test(key)) kept.append(key, value)
  }
  const query = kept.toString()
  return query ? `?${query}` : ''
}

/**
 * GA 的 page_location：origin ＋ pathname ＋ 只保留歸因參數的 query，不帶 hash。
 * GA 預設送完整網址（含 hash 與所有 query），所以每個事件都要自己帶這個值。
 */
export function analyticsPageLocation(href: string, base?: string): string {
  const url = new URL(href, base)
  const kept = new URLSearchParams()
  for (const [key, value] of url.searchParams) {
    if (ATTRIBUTION_PARAM.test(key)) kept.append(key, value)
  }
  const query = kept.toString()
  return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`
}
