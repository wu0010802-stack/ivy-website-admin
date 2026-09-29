// 核准／退回家長的線上改期申請。站內通知頁與案件明細頁共用同一套確認文字，
// 園方在兩個地方看到的後果說明才會一致：核准直接換掉家長的參觀時間，退回
// 讓家長維持原時段，兩者都要另行告知家長（系統不會通知家長）。
import { ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import { formatSlotWhen } from '../api/labels'
import type { RescheduleRequestOut } from '../api/types'

export type RescheduleAction = 'approve' | 'reject'

/** 跳確認框；使用者取消回 null，確定回 { reason }（只有退回會有原因）。 */
export async function confirmRescheduleDecision(
  request: Pick<RescheduleRequestOut, 'parent_name' | 'current_slot' | 'requested_slot'>,
  action: RescheduleAction,
): Promise<{ reason: string | null } | null> {
  const who = request.parent_name || '家長'
  const from = formatSlotWhen(request.current_slot)
  const to = formatSlotWhen(request.requested_slot)
  try {
    if (action === 'approve') {
      await ElMessageBox.confirm(
        `${who} 的參觀時間會從 ${from} 改到 ${to}，原時段名額釋出。請另行告知家長已改期。`,
        '核准這筆改期？',
        { confirmButtonText: '核准改期', cancelButtonText: '先不要', type: 'warning' },
      )
      return { reason: null }
    }
    const result = await ElMessageBox.prompt(
      `${who} 申請改到 ${to}。退回後維持原時段 ${from}，請另行告知家長。`,
      '退回這筆改期申請？',
      {
        confirmButtonText: '退回申請',
        cancelButtonText: '先不要',
        inputPlaceholder: '退回原因（選填，會記在案件歷程）',
        inputValidator: (value: string) => !value || value.length <= 500 || '原因最多 500 字',
        type: 'warning',
      },
    )
    const value = (result as { value?: string }).value ?? ''
    return { reason: value.trim() || null }
  } catch {
    return null
  }
}

export function submitRescheduleDecision(id: string, action: RescheduleAction, reason: string | null = null) {
  return action === 'approve'
    ? api.post(`/admin/reschedule-requests/${id}/approve`)
    : api.post(`/admin/reschedule-requests/${id}/reject`, { reason })
}
