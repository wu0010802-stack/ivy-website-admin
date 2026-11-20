import { AD_PLATFORMS, ENGAGEMENT_CAMPAIGN, ENGAGEMENT_SOURCES, type AdPlatform, type EngagementSource } from './engagement'
import { adPlatformOf, campaignOf, classifySource } from './engagement-source'

// 跨次造訪的網站來源（2026-11-16，docs/specs/2026-11-16-cookie-features-design.md §1）。
// 官網伺服器在訪客「進站」（整頁載入公開頁）時更新這個第一方 cookie（server/middleware/01.attribution.ts），
// 家長送出預約時後端讀它（backend/app/booking/attribution.py，兩邊格式要一致、測試用同一組樣本）。
// 內容只有來源代碼、活動代碼（utm_campaign）、日期，以及廣告平台的點擊代碼；不存來源網址、query 原文或 IP。

export const ATTRIBUTION_COOKIE = 'ivy_src'
/** 最後一次造訪後 90 天：每次進站都重設期限。 */
export const ATTRIBUTION_MAX_AGE_SECONDS = 90 * 24 * 3600

export interface AttributionTouch {
  /** 來源代碼（第一方統計的 ENGAGEMENT_SOURCES） */
  s: EngagementSource
  /** 廣告平台（只在 s 是 ads 時有） */
  p?: AdPlatform
  /** 活動代碼（utm_campaign 正規化後） */
  c?: string
  /** 台北日期 YYYY-MM-DD */
  d: string
}

export interface AttributionClick {
  v: string
  /** 毫秒 */
  t: number
}

export interface AttributionCookie {
  v: 1
  /** 第一次進站（就算是直接進站也記） */
  f: AttributionTouch
  /** 最後一次不是直接進站的進站 */
  l?: AttributionTouch
  /** OpenAI 廣告的點擊代碼（落地網址的 oppref） */
  o?: AttributionClick
  /** Meta 的 fbclid（後端在沒有 _fbc 時用它組 fbc） */
  b?: AttributionClick
  /** LINE 廣告的點擊代碼（落地網址的 ldtag_cl，2026-11-16；後端回傳到場、預繳給 LINE 時用） */
  n?: AttributionClick
  /**
   * 同一瀏覽器的匿名代號（2026-11-19，docs/specs/2026-11-19-cookie-stats-design.md §4～6）：16 bytes 隨機碼的
   * base64url。官網代理只把它轉給 API 的內容興趣統計（API 再 HMAC 後存），不寫進預約、不給前端 JS。
   */
  i?: string
}

export interface Landing {
  /** Referer 標頭；站內換頁傳空字串 */
  referrer: string
  /** 落地網址的 query（含 ?） */
  search: string
  userAgent: string
}

const OPPREF = /^[A-Za-z0-9._~:+/=-]{1,500}$/
export const BROWSER_ID = /^[A-Za-z0-9_-]{22}$/
const FBCLID = /^[A-Za-z0-9_-]{1,500}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const MAX_COOKIE_LENGTH = 3000
// classifySource 只拿 origin 比對「是不是站內」；呼叫端已經把站內來源換成空字串，這裡給一個不會撞到的值。
const NO_ORIGIN = 'https://ivy-site.invalid'

/** 台北日期（UTC+8，沒有日光節約）。 */
export function taipeiDay(now: Date): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
}

function validTouch(raw: unknown): AttributionTouch | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { s, p, c, d } = raw as Record<string, unknown>
  if (!ENGAGEMENT_SOURCES.some((source) => source === s) || typeof d !== 'string' || !DAY.test(d)) return undefined
  return { s: s as EngagementSource, ...(s === 'ads' && AD_PLATFORMS.some((platform) => platform === p) ? { p: p as AdPlatform } : {}), d, ...(typeof c === 'string' && ENGAGEMENT_CAMPAIGN.test(c) ? { c } : {}) }
}

function validClick(raw: unknown, pattern: RegExp): AttributionClick | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { v, t } = raw as Record<string, unknown>
  if (typeof v !== 'string' || !pattern.test(v) || typeof t !== 'number' || !Number.isInteger(t) || t < 1e12 || t > 1e14) return undefined
  return { v, t }
}

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): string {
  const normal = text.replace(/-/g, '+').replace(/_/g, '/')
  return atob(normal + '='.repeat((4 - (normal.length % 4)) % 4))
}

/** cookie 值：base64url（無補位）的 JSON。內容都經過上面的格式檢查，只有 ASCII。 */
export function encodeAttribution(value: AttributionCookie): string {
  return toBase64Url(JSON.stringify(value))
}

/** 讀回 cookie；格式不對整個當沒有，個別欄位不合規則就丟掉那一欄（cookie 可能被改過）。 */
export function decodeAttribution(raw: string | undefined | null): AttributionCookie | null {
  if (!raw || raw.length > MAX_COOKIE_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw)) return null
  let data: unknown
  try { data = JSON.parse(fromBase64Url(raw)) } catch { return null }
  if (!data || typeof data !== 'object' || (data as { v?: unknown }).v !== 1) return null
  const record = data as Record<string, unknown>
  const f = validTouch(record.f)
  if (!f) return null
  const l = validTouch(record.l)
  const o = validClick(record.o, OPPREF)
  const b = validClick(record.b, FBCLID)
  const n = validClick(record.n, OPPREF)
  const i = typeof record.i === 'string' && BROWSER_ID.test(record.i) ? record.i : undefined
  return { v: 1, f, ...(l ? { l } : {}), ...(o ? { o } : {}), ...(b ? { b } : {}), ...(n ? { n } : {}), ...(i ? { i } : {}) }
}

/** 新的匿名代號：16 bytes 隨機碼的 base64url（22 字）。Node 與瀏覽器都有 Web Crypto。 */
export function newBrowserId(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return toBase64Url(String.fromCharCode(...bytes))
}

/**
 * 來源只是從 App 內建瀏覽器的 User-Agent 認出來的（沒有廣告參數、utm_source、fbclid，也沒有外部來源網址）。
 * LINE／FB／IG 內建瀏覽器重新整理時常常就是這樣，不能拿來蓋掉當天從廣告進來的「最後一次」（2026-11-19 §9）。
 */
export function sourceFromUserAgentOnly(landing: Landing): boolean {
  if (classifySource(landing.referrer, landing.search, NO_ORIGIN, '') !== 'direct') return false
  return classifySource(landing.referrer, landing.search, NO_ORIGIN, landing.userAgent) !== 'direct'
}

/** 僅公開同一瀏覽器是否跨台北日回訪。來源、首次日期與廣告代碼留在 HttpOnly cookie。 */
export function isReturningVisit(raw: string | undefined, now: Date): boolean | null {
  const firstDay = decodeAttribution(raw)?.f.d
  if (!firstDay) return null
  const parsed = new Date(firstDay + 'T00:00:00Z')
  const today = taipeiDay(now)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== firstDay || firstDay > today) return null
  return firstDay < today
}

/** 這次進站之後的 cookie 內容。直接進站不蓋掉「最後一次」；點擊代碼只在落地網址有帶時更新。 */
export function nextAttribution(previous: AttributionCookie | null, landing: Landing, now: Date, newId: () => string = newBrowserId): AttributionCookie {
  const source = classifySource(landing.referrer, landing.search, NO_ORIGIN, landing.userAgent)
  const campaign = campaignOf(landing.search)
  const platform = source === 'ads' ? adPlatformOf(landing.search) : undefined
  const touch: AttributionTouch = { s: source, ...(platform ? { p: platform } : {}), d: taipeiDay(now), ...(campaign ? { c: campaign } : {}) }
  const next: AttributionCookie = previous ? { ...previous } : { v: 1, f: touch }
  if (!next.i) next.i = newId()
  // 只靠 User-Agent 認出的 App 來源不蓋掉當天的「最後一次」（App 內建瀏覽器重新整理，§9）；不同天照常更新。
  const keepToday = previous?.l?.d === touch.d && sourceFromUserAgentOnly(landing)
  if (source !== 'direct' && !keepToday) next.l = touch
  const params = new URLSearchParams(landing.search)
  const oppref = params.get('oppref')
  if (oppref && OPPREF.test(oppref)) next.o = { v: oppref, t: now.getTime() }
  const fbclid = params.get('fbclid')
  if (fbclid && FBCLID.test(fbclid)) next.b = { v: fbclid, t: now.getTime() }
  const ldtag = params.get('ldtag_cl')
  if (ldtag && OPPREF.test(ldtag)) next.n = { v: ldtag, t: now.getTime() }
  return next
}

/**
 * 這個請求算不算「進站」：GET、整頁要 HTML（不是預先載入）、而且是第一方統計認得的公開頁。
 * /admin、/api、/preview、/visit/manage、靜態檔與 _payload.json 都不是 publicPage。
 */
export function isLandingRequest(input: { method: string; isPublicPage: boolean; secFetchDest?: string; accept?: string; purpose?: string }): boolean {
  if (input.method !== 'GET' || !input.isPublicPage) return false
  if (input.purpose && /prefetch|prerender/i.test(input.purpose)) return false
  // Safari 16.4 以前沒有 Sec-Fetch-Dest（官網支援到 iOS 15），退回看 Accept。
  if (input.secFetchDest) return input.secFetchDest === 'document'
  return /text\/html/.test(input.accept ?? '')
}
