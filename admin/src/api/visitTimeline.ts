// 案件明細的時間線（2026-10-06 方向 C）：聯絡紀錄與案件歷程合成一條，新的在上。家庭版面再併入
// 參觀後聯絡與招生事件（家庭頁規格 5.4、5.5 的 familyNotes／familyHistory，順序規則沿用）。
import type { ContactLog, RecruitmentEvent, VisitContactNoteOut, VisitHistoryOut } from './types'
import { formatDateTime, type StaffPerson, staffEmail, staffOf } from './labels'
import { visitEventActor, visitEventChanges, visitEventRelatedId, visitEventTitle } from './visitHistory'
import { eventLabel } from '../admissions/constants'
import { familyHistory, familyNotes, personLabel, recruitmentEventChanges } from '../admissions/family'

export type TimelineTone = 'staff' | 'parent' | 'system'

export interface TimelineEntry {
  key: string
  at: string
  kind: 'note' | 'event'
  tone: TimelineTone
  /** 聯絡紀錄：誰記的；事件：誰做的（同事名字、「家長」或「系統」） */
  person: string
  /** 同事的完整 Email，滑過去看得到（同前綴的同事靠這個分辨） */
  personEmail: string
  /** 聯絡紀錄：「記了一筆」或參觀後聯絡的「電話・聯絡到了」；事件：動作名稱 */
  title: string
  body: string
  lines: string[]
  reason: string | null
  related: string | null
  /** 「下次聯絡 10/05 10:00」「不用再追」「排下次聯絡 …」 */
  followUp: string | null
  phase: '' | 'before' | 'after'
  source: '' | '預約' | '招生'
}

export interface TimelineInput {
  notes: readonly VisitContactNoteOut[]
  history: readonly VisitHistoryOut[]
  staff: readonly (StaffPerson & { id: string })[]
  /** 家庭版面才傳 */
  family?: { logs: readonly ContactLog[]; events: readonly RecruitmentEvent[]; arrivedAt: string | null }
}

const PAIR_WINDOW_MS = 5_000

/** 新增聯絡紀錄時，後端在同一個交易寫一筆 contact_logged 歷程（workflow_service.add_contact_note）：
 * 同一人、5 秒內的配成一對（取最近的），時間線只列一筆。 */
function pairContactEvents(notes: readonly VisitContactNoteOut[], history: readonly VisitHistoryOut[]): Map<string, VisitHistoryOut> {
  const pairs = new Map<string, VisitHistoryOut>()
  const taken = new Set<string>()
  for (const note of notes) {
    if (!note.created_by) continue
    const at = Date.parse(note.created_at)
    let best: VisitHistoryOut | null = null
    let bestGap = Number.POSITIVE_INFINITY
    for (const event of history) {
      if (event.event_type !== 'contact_logged' || taken.has(event.id) || event.actor_user_id !== note.created_by) continue
      const gap = Math.abs(Date.parse(event.created_at) - at)
      if (gap <= PAIR_WINDOW_MS && gap < bestGap) {
        best = event
        bestGap = gap
      }
    }
    if (best) {
      pairs.set(note.id, best)
      taken.add(best.id)
    }
  }
  return pairs
}

function followUpLine(event: VisitHistoryOut | undefined): string | null {
  const after = event?.after
  if (!after || !('follow_up_at' in after)) return null
  return typeof after.follow_up_at === 'string' ? `下次聯絡 ${formatDateTime(after.follow_up_at)}` : '不用再追'
}

export function buildTimeline(input: TimelineInput): TimelineEntry[] {
  const { family } = input
  const pairs = pairContactEvents(input.notes, input.history)
  const paired = new Set([...pairs.values()].map((event) => event.id))
  const noteById = new Map(input.notes.map((note) => [note.id, note]))

  const notes = familyNotes(input.notes, family?.logs ?? [], family?.arrivedAt ?? null).map((item): TimelineEntry => {
    const base = { at: item.at, kind: 'note' as const, tone: 'staff' as const, person: item.author, body: item.note, lines: [], reason: null, related: null, source: '' as const }
    if (item.kind === 'booking') {
      const id = item.key.replace(/^booking-/, '')
      const note = noteById.get(id)
      return {
        ...base, key: `note-${id}`, title: '記了一筆',
        personEmail: note?.created_by ? staffEmail(staffOf(note, 'created_by')) : '',
        followUp: followUpLine(pairs.get(id)), phase: family ? item.phase : '',
      }
    }
    return {
      ...base, key: `log-${item.key.replace(/^admissions-/, '')}`, title: item.headline, personEmail: '',
      followUp: item.nextFollowUpAt ? `排下次聯絡 ${formatDateTime(item.nextFollowUpAt)}` : null, phase: 'after',
    }
  })

  const bookingEntry = (event: VisitHistoryOut, source: TimelineEntry['source']): TimelineEntry => ({
    key: `event-${event.id}`, at: event.created_at, kind: 'event',
    tone: event.source === 'parent' ? 'parent' : event.source === 'staff' ? 'staff' : 'system',
    person: visitEventActor(event), personEmail: event.source === 'staff' ? staffEmail(staffOf(event, 'actor')) : '',
    title: visitEventTitle(event), body: '', lines: visitEventChanges(event, input.staff), reason: event.reason,
    related: visitEventRelatedId(event), followUp: null, phase: '', source,
  })
  const admissionsEntry = (event: RecruitmentEvent): TimelineEntry => ({
    key: `admissions-${event.id}`, at: event.created_at, kind: 'event', tone: 'staff',
    person: personLabel(event.actor_name), personEmail: event.actor_name?.includes('@') ? event.actor_name : '',
    title: eventLabel(event.event_type, event.metadata_json), body: '', lines: recruitmentEventChanges(event),
    reason: event.reason, related: null, followUp: null, phase: '', source: '招生',
  })
  const history = input.history.filter((event) => !paired.has(event.id))
  const events = family
    ? familyHistory(history, family.events).map((row) => (row.booking ? bookingEntry(row.booking, '預約') : admissionsEntry(row.admissions!)))
    : [...history].reverse().map((event) => bookingEntry(event, ''))

  // 新的在上；同一時間聯絡紀錄排在事件前面。兩邊各自已經新到舊，穩定排序保留各自原本的順序。
  return [...notes, ...events].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.kind === b.kind ? 0 : a.kind === 'note' ? -1 : 1),
  )
}
