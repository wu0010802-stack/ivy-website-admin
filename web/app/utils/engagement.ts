import { ENGAGEMENT_KEY, ENGAGEMENT_MAX_ACTIVE_MS, ENGAGEMENT_MAX_KEYS, ENGAGEMENT_SOURCES, newsItemOf, type EngagementEvent, type EngagementSource } from '#shared/engagement'
import { publicPage } from '#shared/telemetry'
import { newIdempotencyKey } from './idempotency-key'

// 內容興趣統計的瀏覽器端邏輯（plugins/engagement.client.ts 用），抽出來方便測試。
// 量的是：這一頁實際在看的時間、捲到多深、畫面中央停在哪個區塊多久、做了哪些互動。
// 區塊在外層標 data-track-section="代碼"，互動的按鈕或連結標 data-track-action="代碼"；
// 消息內文標 data-track-read，底部進到畫面就算讀到文末。

/** 這麼久沒有任何操作（捲動、點擊、按鍵、移動游標）就不再累計停留：分頁開著人走了不算。 */
export const IDLE_MS = 60_000
/** 一次計時最多算這麼久：電腦休眠醒來、計時器被瀏覽器延後時不會一次灌進一大段。 */
export const MAX_TICK_MS = 2_000
export const BOOKED_ACTION = 'booking_done'
export const READ_ACTION = 'read_end'
const SESSION_KEY = 'ivy-engagement'

const SEARCH_HOSTS = /(^|\.)(google\.[a-z.]+|bing\.com|yahoo\.com|duckduckgo\.com|baidu\.com)$/
const PAID_MEDIUM = /^(cpc|ppc|paid|paid_social|paidsocial|ads?|display|banner)$/i

/**
 * 這次造訪從哪裡來，只分成幾種代碼，不保留來源網址。順序：廣告參數 → utm_source → 來源網站 →
 * App 內建瀏覽器（LINE、Facebook、Instagram 常不帶來源網站，從 User-Agent 認）→ 直接進站。
 */
export function classifySource(referrer: string, search: string, origin: string, userAgent = ''): EngagementSource {
  const params = new URLSearchParams(search)
  if (['gclid', 'gbraid', 'wbraid'].some((key) => params.has(key)) || PAID_MEDIUM.test(params.get('utm_medium') ?? '')) return 'ads'
  const named = bySourceName((params.get('utm_source') ?? '').toLowerCase())
  if (named) return named
  if (params.has('fbclid')) return 'facebook'
  let host = ''
  try { if (referrer) { const url = new URL(referrer); host = url.origin === origin ? '' : url.hostname.toLowerCase() } } catch { /* 來源網址壞掉當作沒有 */ }
  if (host) {
    if (SEARCH_HOSTS.test(host)) return 'search'
    if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(host)) return 'facebook'
    if (/(^|\.)instagram\.com$/.test(host)) return 'instagram'
    if (/(^|\.)(line\.me|lin\.ee|line\.naver\.jp)$/.test(host)) return 'line'
    if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return 'youtube'
    return 'other'
  }
  if (/\bLine\//.test(userAgent)) return 'line'
  if (/Instagram/.test(userAgent)) return 'instagram'
  if (/FBAN|FBAV|FB_IAB/.test(userAgent)) return 'facebook'
  return 'direct'
}

function bySourceName(name: string): EngagementSource | null {
  if (!name) return null
  if (/^(facebook|fb|meta)/.test(name)) return 'facebook'
  if (/^(instagram|ig)/.test(name)) return 'instagram'
  if (/^line/.test(name)) return 'line'
  if (/^(youtube|yt)/.test(name)) return 'youtube'
  if (/^(google|bing|yahoo)/.test(name)) return 'search'
  return 'other'
}

export interface EngagementSession { id: string; source: EngagementSource }

/**
 * 分頁內的暫時代碼與進站來源：存在 sessionStorage，關掉分頁就消失，不跨分頁、不跨次造訪。
 * 來源只在這次造訪的第一頁判斷一次，站內換頁不會變成「直接進站」。sessionStorage 不能用
 * （無痕模式的某些設定）時每次載入各算一次造訪。
 */
export function engagementSession(storage: Pick<Storage, 'getItem' | 'setItem'> | null, classify: () => EngagementSource): EngagementSession {
  try {
    const saved = JSON.parse(storage?.getItem(SESSION_KEY) || 'null') as Partial<EngagementSession> | null
    if (saved && typeof saved.id === 'string' && ENGAGEMENT_SOURCES.some((source) => source === saved.source)) return saved as EngagementSession
  } catch { /* 存的內容壞掉就重新產生 */ }
  const session = { id: newIdempotencyKey(), source: classify() }
  try { storage?.setItem(SESSION_KEY, JSON.stringify(session)) } catch { /* 寫不進去也照樣統計這一頁 */ }
  return session
}

/** 互動代碼：元件上寫的 data-track-action；不合格式的不記。 */
export function actionKeyOf(element: Element | null | undefined): string | null {
  const target = element?.closest<HTMLElement>('[data-track-action]')
  const key = target?.dataset.trackAction
  if (!target || !key || !ENGAGEMENT_KEY.test(key)) return null
  // 只記「打開」：已經展開的拍立得、常見問題再點一次是收起來，不算一次興趣。
  if (target.getAttribute('aria-expanded') === 'true') return null
  if (target.tagName === 'SUMMARY' && (target.parentElement as HTMLDetailsElement | null)?.open) return null
  return key
}

/** 畫面中央那一點落在哪個區塊；被對話框、選單蓋住時不算任何區塊。 */
export function sectionKeyAt(doc: Pick<Document, 'elementFromPoint'>, width: number, height: number): string | null {
  const key = doc.elementFromPoint(width / 2, height / 2)?.closest<HTMLElement>('[data-track-section]')?.dataset.trackSection
  return key && ENGAGEMENT_KEY.test(key) ? key : null
}

export interface EngagementVisit {
  readonly path: string
  tick(elapsedMs: number, section: string | null, scrollPct: number): void
  action(key: string): void
  mark(key: string): void
  /** 和上次回報比有變動才回傳，沒有就回 null（不重送一樣的內容） */
  takePayload(): EngagementEvent | null
}

export function startVisit(path: string, session: EngagementSession, device: 'mobile' | 'desktop', id: string = newIdempotencyKey()): EngagementVisit | null {
  const page = publicPage(path)
  if (!page) return null
  const item = newsItemOf(path)
  let activeMs = 0
  let scroll = 0
  const sections: Record<string, number> = {}
  const actions: Record<string, number> = {}
  let sent = ''
  const room = (map: Record<string, number>, key: string) => key in map || Object.keys(map).length < ENGAGEMENT_MAX_KEYS
  return {
    path,
    tick(elapsedMs, section, scrollPct) {
      const elapsed = Math.max(0, Math.min(elapsedMs, MAX_TICK_MS))
      activeMs = Math.min(ENGAGEMENT_MAX_ACTIVE_MS, activeMs + elapsed)
      if (Number.isFinite(scrollPct)) scroll = Math.max(scroll, Math.min(100, Math.max(0, Math.round(scrollPct))))
      if (section && ENGAGEMENT_KEY.test(section) && room(sections, section)) {
        sections[section] = Math.min(ENGAGEMENT_MAX_ACTIVE_MS, (sections[section] ?? 0) + elapsed)
      }
    },
    action(key) {
      if (ENGAGEMENT_KEY.test(key) && room(actions, key)) actions[key] = Math.min(99, (actions[key] ?? 0) + 1)
    },
    mark(key) {
      if (ENGAGEMENT_KEY.test(key) && room(actions, key)) actions[key] = 1
    },
    takePayload() {
      const payload: EngagementEvent = {
        event: 'engagement', id, session: session.id, ...page, device, ...(item ? { item } : {}), source: session.source,
        active_ms: Math.round(activeMs), scroll,
        sections: Object.fromEntries(Object.entries(sections).map(([key, ms]) => [key, Math.round(ms)])),
        actions: { ...actions }
      }
      const text = JSON.stringify(payload)
      if (text === sent) return null
      sent = text
      return payload
    }
  }
}

// 目前這一頁的瀏覽，由 plugin 設定；元件用 trackEngagementAction 回報不是點擊就能認出來的互動
// （例如預約送出成功）。統計關閉、訪客要求不追蹤時是 null，呼叫了也不會送任何東西。
let current: EngagementVisit | null = null
export function setCurrentVisit(visit: EngagementVisit | null): void { current = visit }
export function trackEngagementAction(key: string): void { current?.mark(key) }
