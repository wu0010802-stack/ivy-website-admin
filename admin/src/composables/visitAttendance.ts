import { ElMessageBox } from 'element-plus'
import { api, ApiError } from '../api/client'
import { apiErrorCode, apiErrorMessage } from '../api/errors'
import { formatShortSlotWhen, slotStarted } from '../api/labels'

export type AttendanceKind = 'complete' | 'no_show'

interface AttendanceRow {
  status: string
  parent_name: string
  slot?: { slot_date: string; start_time: string; end_time?: string | null } | null
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

// 同事剛處理過同一筆：後端拒絕轉換（409 INVALID_TRANSITION），重讀後清單就是現在的狀態。
export function attendanceChanged(err: unknown): boolean {
  return (err instanceof ApiError && err.status === 409) || apiErrorCode(err) === 'INVALID_TRANSITION'
}

// ── 批次標記已到場（2026-10-04 參觀後追蹤規格 7.5；2026-10-05 從招生入學「官網預約」分頁搬到案件列表）──
// 一天的場次結束後，把來了的家長一次勾起來。只批次「已到場」：沒來的個別按「沒來」。
export async function confirmBatchArrival(count: number, withAdmissions: boolean): Promise<boolean> {
  const message = withAdmissions
    ? `會同時建立 ${count} 筆招生訪視，之後在招生入學頁追蹤。沒來的請個別按「沒來」。`
    : '沒來的請個別按「沒來」。'
  try {
    await ElMessageBox.confirm(message, `${count} 位標記已到場？`, { confirmButtonText: '標記已到場', cancelButtonText: '先不要', type: 'info' })
    return true
  } catch {
    return false
  }
}

export interface BatchFailure { id: string; name: string; reason: string }

// 依序呼叫既有的 /complete，每筆各自一個交易（與單筆相同），不另開批次端點；失敗的逐筆記下原因。
export async function markArrivedInOrder(
  rows: { id: string; parent_name: string }[],
  onProgress: (done: number) => void,
): Promise<{ succeeded: number; failures: BatchFailure[] }> {
  let succeeded = 0
  const failures: BatchFailure[] = []
  for (const [index, row] of rows.entries()) {
    try {
      await submitAttendance(row.id, 'complete')
      succeeded += 1
    } catch (err) {
      const reason = attendanceChanged(err) ? '狀態剛被其他人更新，請看最新的清單' : apiErrorMessage(err, '標記失敗')
      failures.push({ id: row.id, name: row.parent_name, reason })
    }
    onProgress(index + 1)
  }
  return { succeeded, failures }
}

// 「場次已過、還沒標記到場」＝案件列表的 ?group=past&status=confirmed（後端 pending_kinds
// 的 awaiting_attendance，總覽卡片、成效統計同一個條件）。招生入學看板全空時用來提示。
export function awaitingAttendanceLink(campusKey: string) {
  return { path: '/visit-requests', query: { campus: campusKey, group: 'past', status: 'confirmed' } }
}

export async function hasAwaitingAttendance(campusKey: string): Promise<boolean> {
  const params = new URLSearchParams({ campus_key: campusKey, group: 'past', status: 'confirmed', page_size: '1' })
  const rows = await api.get<unknown[]>(`/admin/visit-requests?${params}`)
  return Array.isArray(rows) && rows.length > 0
}
