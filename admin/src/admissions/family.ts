// 預約明細當家庭頁（docs/specs/2026-10-05-visit-family-page-design.md）的純函式：合併參觀前後的
// 聯絡紀錄與歷程、頁首「最後處理」、招生入學點列時要去哪、返回鍵的來源。
import type { ContactLog, RecruitmentEvent, VisitContactNoteOut, VisitHistoryOut } from '../api/types'
import { staffLabel, staffOf } from '../api/labels'
import { lastHandled, type LastHandled } from '../api/visitHistory'
import { termLabel } from './academic'
import { eventLabel, stageLabel } from './constants'
import { channelLabel } from './followUp'

/** 預約歷程裡最後一次「標記已到場」的時間；沒有就是 null。 */
export function arrivedAt(history: readonly VisitHistoryOut[]): string | null {
  let latest: string | null = null
  for (const event of history) {
    if (event.event_type !== 'completed') continue
    if (latest === null || Date.parse(event.created_at) > Date.parse(latest)) latest = event.created_at
  }
  return latest
}

/** 頁首狀態下方的「10/06 到場」：日期取招生訪視的參觀日期（YYYY-MM-DD）。 */
export function arrivedLabel(visitDate: string): string {
  const [, month = '', day = ''] = visitDate.split('-')
  return `${month}/${day} 到場`
}

/** 招生事件、參觀後聯絡帶的名字是顯示名稱或 Email；Email 只寫 @ 前面（同 staffLabel）。 */
export function personLabel(name: string | null | undefined): string {
  if (!name) return ''
  return staffLabel(name.includes('@') ? { email: name } : { display_name: name }, '')
}

export interface FamilyNote {
  key: string
  kind: 'booking' | 'admissions'
  at: string
  phase: 'before' | 'after'
  author: string
  note: string
  /** 參觀後聯絡才有：「電話・聯絡到了」；預約的聯絡紀錄是空字串。 */
  headline: string
  /** 參觀後聯絡當時排的下次聯絡（ISO）；沒有是 null。 */
  nextFollowUpAt: string | null
}

/**
 * 聯絡紀錄合併（規格 5.4）：參觀前記在預約、參觀後記在招生，這裡一起列，新的在上。
 * 預約的紀錄依時間標：早於標記已到場的是參觀前，之後補記的也算參觀後。同一時間參觀後排前面。
 */
export function familyNotes(
  bookingNotes: readonly VisitContactNoteOut[],
  logs: readonly ContactLog[],
  arrived: string | null,
): FamilyNote[] {
  const cut = arrived ? Date.parse(arrived) : Number.POSITIVE_INFINITY
  const items: FamilyNote[] = [
    ...bookingNotes.map((note): FamilyNote => ({
      key: `booking-${note.id}`,
      kind: 'booking',
      at: note.created_at,
      phase: Date.parse(note.created_at) < cut ? 'before' : 'after',
      author: note.created_by ? staffLabel(staffOf(note, 'created_by')) : '',
      note: note.note,
      headline: '',
      nextFollowUpAt: null,
    })),
    ...logs.map((log): FamilyNote => ({
      key: `admissions-${log.id}`,
      kind: 'admissions',
      at: log.contacted_at,
      phase: 'after',
      author: personLabel(log.created_by_name),
      note: log.note ?? '',
      headline: `${channelLabel(log.channel)}・${log.reached ? '聯絡到了' : '沒聯絡到'}`,
      nextFollowUpAt: log.next_follow_up_at,
    })),
  ]
  const rank = { admissions: 0, booking: 1 }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || rank[a.kind] - rank[b.kind])
}

export interface FamilyHistoryRow {
  key: string
  source: 'booking' | 'admissions'
  at: string
  booking?: VisitHistoryOut
  admissions?: RecruitmentEvent
}

/**
 * 案件歷程合併（規格 5.5）：預約歷程與招生事件（兩邊 API 都是舊到新）一起列，新的在上。
 * 同一時間（到場與建立訪視同一個交易）招生事件排上面；同來源同時間照原順序倒過來。
 */
export function familyHistory(history: readonly VisitHistoryOut[], events: readonly RecruitmentEvent[]): FamilyHistoryRow[] {
  const rank = { admissions: 0, booking: 1 }
  return [
    ...history.map((event, index) => ({ index, row: { key: `booking-${event.id}`, source: 'booking' as const, at: event.created_at, booking: event } })),
    ...events.map((event, index) => ({ index, row: { key: `admissions-${event.id}`, source: 'admissions' as const, at: event.created_at, admissions: event } })),
  ]
    .sort((a, b) => Date.parse(b.row.at) - Date.parse(a.row.at) || rank[a.row.source] - rank[b.row.source] || b.index - a.index)
    .map(({ row }) => row)
}

/** 招生事件的變更行：階段變化（「已訪視 → 已預繳」）與保留座位的年級學期。歷程抽屜與預約明細共用。 */
export function recruitmentEventChanges(event: RecruitmentEvent): string[] {
  const lines: string[] = []
  if (event.from_stage && event.to_stage && event.from_stage !== event.to_stage) {
    lines.push(`${stageLabel(event.from_stage)} → ${stageLabel(event.to_stage)}`)
  }
  if (event.event_type === 'seat_reserved' || event.event_type === 'seat_released') {
    const metadata = (event.metadata_json && typeof event.metadata_json === 'object' ? event.metadata_json : {}) as Record<string, unknown>
    const grade = typeof metadata.grade === 'string' ? metadata.grade : ''
    const year = typeof metadata.school_year === 'number' ? metadata.school_year : null
    const semester = typeof metadata.semester === 'number' ? metadata.semester : null
    const seat = [grade, year ? termLabel(year, semester) : ''].filter(Boolean).join('・')
    if (seat) lines.push(seat)
  }
  return lines
}

/**
 * 家庭版面頁首的「最後處理」（規格 5.2）：預約歷程（園方操作）、招生事件、參觀後聯絡三者取最新一筆。
 * 只算有操作者的；時間相同時維持先找到的（預約那筆），到場與建立訪視才不會寫成「建立訪視」。
 */
export function familyLastHandled(
  history: readonly VisitHistoryOut[],
  events: readonly RecruitmentEvent[],
  logs: readonly ContactLog[],
  selfId: string | null,
): LastHandled | null {
  let best = lastHandled([...history], selfId)
  const consider = (at: string, actorId: string | null | undefined, name: string | null | undefined, what: string) => {
    const time = Date.parse(at)
    if (!actorId || Number.isNaN(time) || (best && time <= Date.parse(best.at))) return
    const self = Boolean(selfId) && actorId === selfId
    best = { who: self ? '你' : personLabel(name) || '同事', at, what, self }
  }
  for (const event of events) consider(event.created_at, event.actor_user_id, event.actor_name, eventLabel(event.event_type, event.metadata_json))
  for (const log of logs) consider(log.created_at, log.created_by, log.created_by_name, '記錄聯絡')
  return best
}

/** 最新一筆參觀後聯絡（依聯絡時間，不假設 API 的順序）。 */
export function latestContact(logs: readonly ContactLog[]): ContactLog | null {
  return logs.reduce<ContactLog | null>(
    (best, log) => (!best || Date.parse(log.contacted_at) > Date.parse(best.contacted_at) ? log : best),
    null,
  )
}

/** 招生入學點一筆訪視時要開的預約明細（規格 6.1）；沒有預約或看不到預約時回 null，照舊開抽屜。 */
export function visitRequestPath(visitRequestId: string | null | undefined, can: (capability: string) => boolean): string | null {
  return visitRequestId && can('booking.read') ? `/visit-requests/${visitRequestId}` : null
}

export type DetailOrigin = 'admissions' | 'visit-list' | 'other'

/** 預約明細的上一頁（router history.state.back）是招生入學、案件列表或其他（規格 6.2）。 */
export function detailOrigin(back: unknown): DetailOrigin {
  if (typeof back !== 'string') return 'other'
  const path = back.split(/[?#]/)[0]!.replace(/\/+$/, '')
  if (path === '/admissions') return 'admissions'
  if (path === '/visit-requests') return 'visit-list'
  return 'other'
}
