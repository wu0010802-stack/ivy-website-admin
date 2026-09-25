// 預約方式的啟用條件與切換前的影響範圍（規格 L169-181）。後端
// booking/readiness.py 是權威：存檔時全部條件再驗一次，不符回 400
// BOOKING_MODE_NOT_READY。這裡讓園方在按儲存前就看到「不可啟用原因」：
// - 欄位類（連結、電話、暫停說明）看表單目前的值，即時判斷；
// - 要讀資料的（已發布的同意文字、可預約場次或每週規則）看 readiness 端點，
//   而且只在「切換成」該方式時才算數，和後端一致。
import type { BookingImpactOut, BookingMode, BookingReadinessOut } from '../api/types'
import { BOOKING_MODE_LABELS } from '../api/labels'
import { canOpenPath } from '../router/nav'

export interface BookingFormFields {
  mode: BookingMode
  line_url: string
  phone: string
  external_url: string
  message: string
}

// 與後端 readiness.field_blockers 的條件相同；文字是給正在填表的人看的。
export function fieldReasons(mode: BookingMode, form: Omit<BookingFormFields, 'mode'>): string[] {
  const blank = (value: string) => !value.trim()
  if (mode === 'line' && blank(form.line_url)) return ['請填寫 LINE 官方帳號連結']
  if (mode === 'phone' && blank(form.phone)) return ['請填寫洽詢電話']
  if (mode === 'external' && blank(form.external_url)) return ['請填寫外部預約網址']
  if (mode === 'paused' && blank(form.message)) return ['暫停預約時請填寫給家長看的暫停說明，例如何時恢復、可以怎麼聯絡']
  return []
}

/** readiness 回應形狀正確才用；讀取失敗或格式不對就當作沒有資料（存檔時後端仍會擋）。 */
export function asReadiness(value: unknown): BookingReadinessOut | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<BookingReadinessOut>
  if (!candidate.blockers || typeof candidate.blockers !== 'object' || !candidate.impact) return null
  return candidate as BookingReadinessOut
}

export interface ModeReason {
  code: string
  message: string
}

/** 選某個方式時的全部不可啟用原因。savedMode 是目前已儲存的方式。 */
export function modeReasons(
  mode: BookingMode,
  form: Omit<BookingFormFields, 'mode'>,
  savedMode: BookingMode | null,
  readiness: BookingReadinessOut | null,
): ModeReason[] {
  const reasons: ModeReason[] = fieldReasons(mode, form).map((message) => ({ code: 'FIELD', message }))
  if (readiness && mode !== savedMode) reasons.push(...(readiness.blockers[mode] ?? []))
  return reasons
}

// 不可啟用原因對應的處理頁面，讓園方可以直接過去補。進不去那一頁的人（例如
// 沒有「全站共用內容」授權的分校管理者，路由守衛會導回首頁）改顯示要找誰處理。
export const REASON_LINKS: Record<string, { to: string; label: string; otherwise: string }> = {
  CONSENT_NOT_PUBLISHED: {
    to: '/content/booking-content',
    label: '到預約文案發布同意文字',
    otherwise: '請聯絡總管理者到「預約文案」發布同意條款。',
  },
  NO_SLOTS_OR_RULES: { to: '/slots', label: '到時段與容量新增場次', otherwise: '請聯絡校區管理者新增場次或每週規則。' },
}

export type ReasonAction = { to: string; label: string } | { note: string } | null

/** 不可啟用原因後面接的處理方式：點得進去就給連結，進不去就說要找誰。 */
export function reasonAction(code: string, user: Parameters<typeof canOpenPath>[1]): ReasonAction {
  const link = REASON_LINKS[code]
  if (!link) return null
  return canOpenPath(link.to, user) ? { to: link.to, label: link.label } : { note: link.otherwise }
}

/** 切換確認框裡的影響範圍。切換不改既有案件，數字只是提醒還要繼續跟進的。 */
export function impactLines(impact: BookingImpactOut | null | undefined, to: BookingMode): string[] {
  if (!impact) return ['目前無法讀取進行中的案件數，請切換後到「參觀案件」確認。']
  const lines: string[] = []
  if (impact.open_requests > 0) {
    const parts = [
      impact.new_requests ? `待處理 ${impact.new_requests}` : '',
      impact.contacting ? `聯絡中 ${impact.contacting}` : '',
      impact.pending_confirmation ? `待園方確認 ${impact.pending_confirmation}` : '',
      impact.upcoming_confirmed ? `已確認、還沒參觀 ${impact.upcoming_confirmed}` : '',
      // 參觀時間已過、還沒改成完成或未到場；舊版 API 沒有這個欄位。
      impact.past_confirmed ? `已過參觀時間、尚未結案 ${impact.past_confirmed}` : '',
    ].filter(Boolean)
    lines.push(`進行中的案件 ${impact.open_requests} 件${parts.length ? `（${parts.join('、')}）` : ''}：不會被修改，照常在「參觀案件」處理。`)
  } else {
    lines.push('目前沒有進行中的案件。')
  }
  if (to === 'slots') {
    lines.push(`官網目前可預約的場次 ${impact.bookable_slots} 個${impact.weekly_rules ? `，每週開放規則 ${impact.weekly_rules} 條` : ''}。`)
  } else if (impact.bookable_slots > 0) {
    lines.push(`官網目前可預約的場次 ${impact.bookable_slots} 個：切換後家長不能再從官網選場次，已排定的參觀不受影響。`)
  }
  if (impact.pending_confirmation > 0 && to !== 'slots') {
    lines.push(`待園方確認的 ${impact.pending_confirmation} 件仍占著名額，請記得確認或取消。`)
  }
  return lines
}

export function modeLabel(mode: string | null | undefined): string {
  if (!mode) return '—'
  return BOOKING_MODE_LABELS[mode] ?? mode
}
