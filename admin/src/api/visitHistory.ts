// 案件歷程一筆要顯示的字：動作、誰做的、異動前後與原因。後端的 before／after
// 只放狀態、時段、承辦人、下次聯絡時間與連結期限，這裡逐一翻成園方看得懂的句子。
import type { VisitHistoryOut } from './types'
import {
  formatDateTime,
  formatSlotWhen,
  type StaffPerson,
  staffLabel,
  staffLabelById,
  staffOf,
  visitEventLabel,
  VISIT_EVENT_SOURCE_LABELS,
  visitSourceLabel,
  visitStatus,
} from './labels'

type SlotBrief = { slot_date: string; start_time: string; end_time: string }
type Snapshot = Record<string, unknown> | null | undefined

function slotOf(snapshot: Snapshot, key = 'slot'): SlotBrief | null {
  const value = snapshot?.[key]
  if (value && typeof value === 'object' && 'slot_date' in value) return value as SlotBrief
  return null
}

function text(snapshot: Snapshot, key: string): string | null {
  const value = snapshot?.[key]
  return typeof value === 'string' ? value : null
}

function sameSlot(a: SlotBrief | null, b: SlotBrief | null): boolean {
  return formatSlotWhen(a) === formatSlotWhen(b)
}

export function visitEventTitle(event: VisitHistoryOut): string {
  if (event.event_type === 'created') {
    const source = text(event.after, 'source')
    if (source && source !== 'web') return `${visitSourceLabel(source)}補登`
    return event.source === 'parent' ? '家長從官網送出' : visitEventLabel('created')
  }
  // 還沒排時段（待處理、聯絡中）就取消的是「參觀需求」，不叫預約；和明細的
  // 「取消這筆需求」同一個詞。舊事件沒有記原狀態時照舊寫「取消預約」。
  if (event.event_type === 'cancelled') {
    const from = text(event.before, 'status')
    if (from === 'new' || from === 'contacting') return '取消需求'
  }
  return visitEventLabel(event.event_type)
}

/** 誰做的。後台人員顯示同事的名字（沒有顯示名稱時是 Email @ 前面那段）；
 * 帳號刪除後顯示「已移除的帳號」。 */
export function visitEventActor(event: VisitHistoryOut): string {
  if (event.source === 'staff') {
    if (event.actor_email || event.actor_display_name) return staffLabel(staffOf(event, 'actor'))
    return event.actor_user_id ? '已移除的帳號' : VISIT_EVENT_SOURCE_LABELS.staff!
  }
  return event.source ? (VISIT_EVENT_SOURCE_LABELS[event.source] ?? event.source) : ''
}

// 家長修改資料只記改了哪些欄位，不記內容（歷程會給多位同事看）。
const PARENT_FIELD_LABELS: Record<string, string> = {
  parent_name: '家長稱呼', phone: '手機', email: 'Email', child_name: '孩子姓名',
  child_birthdate: '孩子出生年月日', party_size: '參觀人數', questions: '想了解的事',
}

/** 異動前後，一行一件事。 */
export function visitEventChanges(
  event: VisitHistoryOut,
  staff: readonly (StaffPerson & { id: string })[] = [],
): string[] {
  const { before, after } = event
  const lines: string[] = []

  const fromStatus = text(before, 'status')
  const toStatus = text(after, 'status')
  if (fromStatus && toStatus && fromStatus !== toStatus) {
    lines.push(`${visitStatus(fromStatus).label} → ${visitStatus(toStatus).label}`)
  }

  const fromSlot = slotOf(before)
  const toSlot = slotOf(after)
  const afterHasSlotKey = !!after && 'slot' in after
  if (fromSlot && toSlot && !sameSlot(fromSlot, toSlot)) {
    lines.push(`${formatSlotWhen(fromSlot)} → ${formatSlotWhen(toSlot)}`)
  } else if (toSlot) {
    lines.push(`參觀時間 ${formatSlotWhen(toSlot)}`)
  } else if (fromSlot && afterHasSlotKey) {
    lines.push(`釋出 ${formatSlotWhen(fromSlot)}`)
  } else if (fromSlot) {
    // 結案類的動作只記原本的時段（取消、逾期要講「原」，完成／未到場就是那一場）。
    const released = event.event_type === 'cancelled' || event.event_type === 'hold_expired'
    lines.push(`${released ? '原參觀時間' : '參觀時間'} ${formatSlotWhen(fromSlot)}`)
  }

  const requested = slotOf(after, 'requested_slot')
  if (requested) lines.push(`申請的時段 ${formatSlotWhen(requested)}`)

  if (after && 'assigned_staff_id' in after) {
    lines.push(`${staffLabelById(text(before, 'assigned_staff_id'), staff)} → ${staffLabelById(text(after, 'assigned_staff_id'), staff)}`)
  }
  const fields = after?.fields
  if (Array.isArray(fields) && fields.length) lines.push(`修改欄位：${fields.map(f => PARENT_FIELD_LABELS[String(f)] ?? String(f)).join('、')}`)
  const followUp = text(after, 'follow_up_at')
  if (followUp) lines.push(`下次聯絡 ${formatDateTime(followUp)}`)
  const expires = text(after, 'expires_at')
  if (expires) lines.push(`有效到 ${formatDateTime(expires)}${after?.replaced_previous ? '，先前的連結已失效' : ''}`)
  return lines
}

/** 關聯的另一筆案件（重新預約）。 */
export function visitEventRelatedId(event: VisitHistoryOut): string | null {
  return text(event.after, 'related_request_id')
}

export interface LastHandled {
  /** 誰：同事的顯示名稱（沒設時 Email 前段），自己是「你」 */
  who: string
  at: string
  /** 做了什麼，和歷程列表同一個詞（visitEventTitle） */
  what: string
  self: boolean
}

/**
 * 案件頁首的「最後處理」：後台同事最近一次動這筆案件（歷程裡 source=staff 的事件）。
 * 新增聯絡紀錄也會寫一筆 contact_logged 歷程，所以只看歷程就夠。家長自己改、系統排程
 * 的不算——櫃台要知道的是「同事是不是剛處理過」。
 */
export function lastHandled(history: VisitHistoryOut[], selfId: string | null): LastHandled | null {
  let best: LastHandled | null = null
  let bestAt = Number.NEGATIVE_INFINITY
  for (const event of history) {
    if (event.source !== 'staff') continue
    const at = Date.parse(event.created_at)
    if (Number.isNaN(at) || at <= bestAt) continue
    const self = Boolean(selfId) && event.actor_user_id === selfId
    best = { who: self ? '你' : visitEventActor(event), at: event.created_at, what: visitEventTitle(event), self }
    bestAt = at
  }
  return best
}
