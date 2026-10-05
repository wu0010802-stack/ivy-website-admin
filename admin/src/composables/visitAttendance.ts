import { ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import { formatShortSlotWhen, slotStarted } from '../api/labels'

export type AttendanceKind = 'complete' | 'no_show'

interface AttendanceRow {
  status: string
  parent_name: string
  slot?: { slot_date: string; start_time: string; end_time: string } | null
}

// 列表上直接標記到場（2026-10-05 第九輪）：參觀當天幾組家長陸續到，櫃台不必一筆筆點進明細。
// 只有「預約正常、場次已開始」的案件才出現（同明細「家長到了嗎？」的條件，後端也會擋）。
export function attendanceDue(row: AttendanceRow, now: number = Date.now()): boolean {
  return row.status === 'confirmed' && Boolean(row.slot) && slotStarted(row.slot!, now)
}

// 列表一列一列很密，兩種都先確認一次，寫出家長與場次，免得點到隔壁那列。
// 招生入學開著時，標記已到場會在同一個交易裡建立招生訪視（同明細的說法）。
export async function confirmAttendance(kind: AttendanceKind, row: AttendanceRow, withAdmissions: boolean): Promise<boolean> {
  const who = `${row.parent_name}（${formatShortSlotWhen(row.slot)}）`
  const [title, message, confirmButtonText, type] =
    kind === 'complete'
      ? ['標記已到場？', `${who}標記為已到場。${withAdmissions ? '會同時建立一筆招生訪視，之後在招生入學頁追蹤。' : ''}`, '標記已到場', 'info' as const]
      : ['標記為未到場？', `${who}標記為未到場後，這筆案件會結案。這一場的名額仍算已使用，不會再開放給別人。`, '標記未到場', 'warning' as const]
  try {
    await ElMessageBox.confirm(message, title, { confirmButtonText, cancelButtonText: '先不要', type })
    return true
  } catch {
    return false
  }
}

export function submitAttendance(id: string, kind: AttendanceKind): Promise<unknown> {
  return api.post(`/admin/visit-requests/${id}/${kind === 'complete' ? 'complete' : 'no-show'}`)
}
