// 案件歷程一筆要顯示的字：動作、誰做的、異動前後與原因。後端的 before／after
// 只放狀態、時段、承辦人、下次聯絡時間與連結期限，這裡逐一翻成園方看得懂的句子。
import type { VisitHistoryOut } from './types'
import {
  formatDateTime,
  formatSlotWhen,
  staffLabel,
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
  return visitEventLabel(event.event_type)
}

/** 誰做的。後台人員顯示帳號 @ 前面那段；帳號刪除後顯示「已移除的帳號」。 */
export function visitEventActor(event: VisitHistoryOut): string {
  if (event.source === 'staff') {
    if (event.actor_email) return event.actor_email.split('@')[0]!
    return event.actor_user_id ? '已移除的帳號' : VISIT_EVENT_SOURCE_LABELS.staff!
  }
  return event.source ? (VISIT_EVENT_SOURCE_LABELS[event.source] ?? event.source) : ''
}

/** 異動前後，一行一件事。 */
export function visitEventChanges(
  event: VisitHistoryOut,
  staff: readonly { id: string; email: string }[] = [],
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
    lines.push(`${staffLabel(text(before, 'assigned_staff_id'), staff)} → ${staffLabel(text(after, 'assigned_staff_id'), staff)}`)
  }
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
