import { publicPage, type PublicPage } from './telemetry'

// 內容興趣統計（2026-11-11）：一次頁面瀏覽的停留、捲動、各區塊停留與互動次數。
// 只送代碼與數字：不帶網址、query、來源網址或任何家長資料。規則要和後端
// backend/app/operations/routes.py 的 EngagementIn 一致。

// 造訪來源只分這幾種代碼；要和後端 operations/models.py 的 ENGAGEMENT_SOURCES 一致（測試會比對）。
export const ENGAGEMENT_SOURCES = ['direct', 'search', 'facebook', 'instagram', 'line', 'youtube', 'ads', 'other'] as const
export type EngagementSource = (typeof ENGAGEMENT_SOURCES)[number]

export const ENGAGEMENT_MAX_ACTIVE_MS = 1_800_000
export const ENGAGEMENT_MAX_KEYS = 24
export const ENGAGEMENT_MAX_SEQ = 500
/** 區塊與互動代碼：小寫英數、底線、連字號與冒號，最長 48 字（冒號給各校消息的代號用，例如 sn_yihua:open-day）。 */
export const ENGAGEMENT_KEY = /^[a-z0-9][a-z0-9_:-]{0,47}$/
/** 活動代碼（utm_campaign）：小寫英數、底線、連字號，最長 32 字。 */
export const ENGAGEMENT_CAMPAIGN = /^[a-z0-9][a-z0-9_-]{0,31}$/
export const ENGAGEMENT_MAX_REV = 100_000
// 各校消息的代號帶校區前綴（yihua:open-day）。
const ITEM = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,63}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type EngagementEvent = PublicPage & {
  event: 'engagement'
  /** 這次頁面瀏覽的隨機代碼：離開前會回報多次，後端留最新的一次 */
  id: string
  /** 分頁內的暫時代碼（sessionStorage），只用來串起同一次造訪看過的頁面 */
  session: string
  device: 'mobile' | 'desktop'
  /** 最新消息內文頁的消息代號 */
  item?: string
  source: EngagementSource
  active_ms: number
  scroll: number
  sections: Record<string, number>
  actions: Record<string, number>
  /** 這次造訪的第幾頁（從 1 起算）：看進站頁、離開頁與瀏覽順序用 */
  seq?: number
  /** 進站連結上的活動代碼（utm_campaign，園方自己設的） */
  campaign?: string
  /** 這次瀏覽的第幾次回報：晚到的舊回報不蓋掉新的區塊與互動 */
  rev?: number
}

/** 最新消息內文頁（/news/<代號>）的消息代號（網址上是 encodeURIComponent 過的）；代號不是單純英數與冒號就不帶。 */
export function newsItemOf(path: string): string | undefined {
  const match = path.split(/[?#]/)[0]?.replace(/\/$/, '').match(/^\/news\/([^/]+)$/)
  if (!match) return undefined
  let id = match[1]!
  try { id = decodeURIComponent(id) } catch { return undefined }
  return ITEM.test(id) ? id : undefined
}

function isCounts(value: unknown, min: number, max: number): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return entries.length <= ENGAGEMENT_MAX_KEYS
    && entries.every(([key, count]) => ENGAGEMENT_KEY.test(key) && Number.isInteger(count) && count >= min && count <= max)
}

export function validateEngagement(input: unknown): EngagementEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const item = input as Record<string, unknown>
  const allowed = ['event', 'id', 'session', 'page', 'campus', 'device', 'item', 'source', 'active_ms', 'scroll', 'sections', 'actions', 'seq', 'campaign', 'rev']
  if (item.event !== 'engagement' || Object.keys(item).some((key) => !allowed.includes(key))) return null
  if (typeof item.id !== 'string' || !UUID.test(item.id) || typeof item.session !== 'string' || !UUID.test(item.session)) return null
  if (typeof item.page !== 'string' || !['mobile', 'desktop'].includes(item.device as string)) return null
  // page 與 campus 的組合沿用瀏覽統計的規則：拿對應的路徑回推一次。
  const path = item.page === 'home' ? '/' : item.page === 'campus' ? `/campuses/${item.campus}` : item.page === 'visit' ? (item.campus ? `/visit/${item.campus}` : '/visit') : `/${item.page}`
  const page = publicPage(path)
  if (!page || page.page !== item.page || page.campus !== item.campus) return null
  if (item.item !== undefined && (typeof item.item !== 'string' || !ITEM.test(item.item) || item.page !== 'news')) return null
  if (!ENGAGEMENT_SOURCES.some((source) => source === item.source)) return null
  if (!Number.isInteger(item.active_ms) || (item.active_ms as number) < 0 || (item.active_ms as number) > ENGAGEMENT_MAX_ACTIVE_MS) return null
  if (!Number.isInteger(item.scroll) || (item.scroll as number) < 0 || (item.scroll as number) > 100) return null
  if (!isCounts(item.sections, 0, ENGAGEMENT_MAX_ACTIVE_MS) || !isCounts(item.actions, 1, 99)) return null
  if (item.seq !== undefined && (!Number.isInteger(item.seq) || (item.seq as number) < 1 || (item.seq as number) > ENGAGEMENT_MAX_SEQ)) return null
  if (item.campaign !== undefined && (typeof item.campaign !== 'string' || !ENGAGEMENT_CAMPAIGN.test(item.campaign))) return null
  if (item.rev !== undefined && (!Number.isInteger(item.rev) || (item.rev as number) < 1 || (item.rev as number) > ENGAGEMENT_MAX_REV)) return null
  return item as EngagementEvent
}
