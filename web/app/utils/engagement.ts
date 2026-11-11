import { ENGAGEMENT_CAMPAIGN, ENGAGEMENT_KEY, ENGAGEMENT_MAX_ACTIVE_MS, ENGAGEMENT_MAX_KEYS, ENGAGEMENT_MAX_SEQ, ENGAGEMENT_SOURCES, newsItemOf, type EngagementEvent, type EngagementSource } from '#shared/engagement'
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
// 預約表單的進度（預約頁）：選了日期、選了場次、開始填資料、按了送出；另外兩個是看到「沒有開放場次」
// 與送出時欄位沒過。要和後端 operations/models.py 的 ENGAGEMENT_FORM_* 一致（測試會比對）。
export const FORM_ACTIONS = { date: 'form_date', slot: 'form_slot', contact: 'form_contact', submit: 'form_submit', noSlots: 'form_no_slots', invalid: 'form_invalid' } as const
// 入學試算查到的班別：還沒到幼幼班年齡、幼幼班、小班、中班、大班、已到國小年齡。只記班別，不記生日。
// 要和後端的 ENGAGEMENT_CLASS_ACTIONS 一致（測試會比對）。
export const CLASS_ACTIONS = ['class_young', 'class_toddler', 'class_small', 'class_middle', 'class_big', 'class_school'] as const

/** 入學試算的結果 → 班別代碼。position 是成長軌道上的站（0＝幼幼班…3＝大班）。 */
export function classActionKey(status: 'enrolled' | 'young' | 'school', position: number): string | null {
  if (status === 'young') return CLASS_ACTIONS[0]
  if (status === 'school') return CLASS_ACTIONS[5]
  return CLASS_ACTIONS[position + 1] && position >= 0 && position <= 3 ? CLASS_ACTIONS[position + 1]! : null
}

const STORY_PREFIXES: Record<string, string> = { news: 'sn_', event: 'se_', film: 'sf_' }
/** 首頁點開的消息／活動／影片（HomeStories 的 id 是「news:<代號>」）→ 互動代碼；代號不合格式就不分篇記。 */
export function storyActionKey(storyId: string): string | null {
  const [kind, ...rest] = storyId.split(':')
  const key = `${STORY_PREFIXES[kind ?? ''] ?? ''}${rest.join(':')}`
  return STORY_PREFIXES[kind ?? ''] && ENGAGEMENT_KEY.test(key) ? key : null
}

/**
 * 進站連結上的活動代碼（utm_campaign）：園方貼連結時自己設的，用來分辨是哪一則貼文或廣告。
 * 只留小寫英數、底線、連字號，最長 32 字；其他字元換成連字號，整個不合格式就不記。
 */
export function campaignOf(search: string): string | undefined {
  const raw = new URLSearchParams(search).get('utm_campaign') ?? ''
  const key = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 32).replace(/-+$/, '')
  return ENGAGEMENT_CAMPAIGN.test(key) ? key : undefined
}
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

export interface EngagementSession { id: string; source: EngagementSource; campaign?: string; /** 這次造訪已經看了幾頁 */ pages: number }

/**
 * 分頁內的暫時代碼與進站來源：存在 sessionStorage，關掉分頁就消失，不跨分頁、不跨次造訪。
 * 來源只在這次造訪的第一頁判斷一次，站內換頁不會變成「直接進站」。sessionStorage 不能用
 * （無痕模式的某些設定）時每次載入各算一次造訪。
 */
export function engagementSession(storage: Pick<Storage, 'getItem' | 'setItem'> | null, classify: () => EngagementSource, campaign?: () => string | undefined): EngagementSession {
  try {
    const saved = JSON.parse(storage?.getItem(SESSION_KEY) || 'null') as Partial<EngagementSession> | null
    if (saved && typeof saved.id === 'string' && ENGAGEMENT_SOURCES.some((source) => source === saved.source)) {
      return {
        id: saved.id, source: saved.source!,
        ...(typeof saved.campaign === 'string' && ENGAGEMENT_CAMPAIGN.test(saved.campaign) ? { campaign: saved.campaign } : {}),
        pages: Number.isInteger(saved.pages) && saved.pages! > 0 ? saved.pages! : 0
      }
    }
  } catch { /* 存的內容壞掉就重新產生 */ }
  const code = campaign?.()
  const session: EngagementSession = { id: newIdempotencyKey(), source: classify(), ...(code ? { campaign: code } : {}), pages: 0 }
  try { storage?.setItem(SESSION_KEY, JSON.stringify(session)) } catch { /* 寫不進去也照樣統計這一頁 */ }
  return session
}

/** 這次造訪又看了一頁：回傳這一頁是第幾頁，並記回 sessionStorage（重新整理、換頁都接著數）。 */
export function nextPage(storage: Pick<Storage, 'setItem'> | null, session: EngagementSession): number {
  session.pages += 1
  try { storage?.setItem(SESSION_KEY, JSON.stringify(session)) } catch { /* 寫不進去就只在這次載入內累計 */ }
  return session.pages
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

export function startVisit(path: string, session: EngagementSession, device: 'mobile' | 'desktop', id: string = newIdempotencyKey(), seq?: number): EngagementVisit | null {
  const page = publicPage(path)
  if (!page) return null
  const item = newsItemOf(path)
  let activeMs = 0
  let scroll = 0
  const sections: Record<string, number> = {}
  const actions: Record<string, number> = {}
  let sent = ''
  let rev = 0
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
        actions: { ...actions },
        ...(seq && seq <= ENGAGEMENT_MAX_SEQ ? { seq } : {}),
        ...(session.campaign ? { campaign: session.campaign } : {})
      }
      const text = JSON.stringify(payload)
      if (text === sent) return null
      sent = text
      // 回報序號：這幾筆不保證照順序到，後端靠它不讓晚到的舊回報蓋掉新的。
      rev += 1
      return { ...payload, rev }
    }
  }
}

// 目前這一頁的瀏覽，由 plugin 設定；元件用 trackEngagementAction 回報不是點擊就能認出來的互動
// （例如預約送出成功）。統計關閉、訪客要求不追蹤時是 null，呼叫了也不會送任何東西。
let current: EngagementVisit | null = null
export function setCurrentVisit(visit: EngagementVisit | null): void { current = visit }
export function trackEngagementAction(key: string): void { current?.mark(key) }
