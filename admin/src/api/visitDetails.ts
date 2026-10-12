// 後台修改家長資料（2026-10-12 規格第 3 節）：PATCH /admin/visit-requests/{id}/details。
// 型別取自契約產生檔（api/types.ts 的別名）。只送有改的欄位；Email、孩子姓名、孩子生日送 null 是清空。
import { api } from './client'
import type { AdminDetailsUpdate, AdminDetailsUpdateOut, VisitRequestFullOut } from './types'

export function updateVisitDetails(id: string, body: AdminDetailsUpdate): Promise<AdminDetailsUpdateOut> {
  return api.patch<AdminDetailsUpdateOut>(`/admin/visit-requests/${id}/details`, body)
}

// 保存政策匿名化時，後端把稱呼換成這句（retention_service.ANONYMIZED_NOTE）。案件回應沒有
// anonymized_at，園方端只能用它判斷；真的送出時後端另外會擋（409 VISIT_REQUEST_ANONYMIZED）。
export const ANONYMIZED_PARENT_NAME = '（已依保存政策匿名化）'

export function isAnonymizedCase(detail: Pick<VisitRequestFullOut, 'parent_name'> | null | undefined): boolean {
  return detail?.parent_name === ANONYMIZED_PARENT_NAME
}

// ---- 輸入檢查（前端先擋；後端 normalize_phone 與 EmailStr 才是準的）----

/** 後端會去掉空白與連字號再檢查，這裡也先去掉。 */
export function normalizePhoneInput(value: string): string {
  return value.replace(/[\s\-－]/g, '')
}

export function phoneError(value: string): string {
  const digits = normalizePhoneInput(value)
  if (!digits) return '請填手機'
  return /^09\d{8}$/.test(digits) ? '' : '手機號碼要是 09 開頭的 10 碼'
}

export function emailError(value: string): string {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? '' : '請輸入正確的 Email'
}

// ---- 結果提示 ----

// 招生欄位名（招生訪視的 contact_name、phone、child_name、birthday、grade）對照園方看的字。
export const ADMISSIONS_SYNC_FIELD_LABELS: Record<string, string> = {
  contact_name: '家長稱呼', phone: '電話', child_name: '孩子姓名', birthday: '生日', grade: '年級',
}

function admissionsFieldsText(fields: readonly string[]): string {
  return Array.from(new Set(fields.map((field) => ADMISSIONS_SYNC_FIELD_LABELS[field] ?? field))).join('、')
}

export interface DetailsNotices {
  /** 成功提示的幾句，用「。」接起來顯示成一則。 */
  success: string[]
  /** 需要園方留意的：招生資料沒跟著改、沒有寄出變更通知。各自一則警告。 */
  warnings: string[]
}

/**
 * 存好之後要告訴園方的事。emailEnabled：該校有沒有設定寄信（預約設定 parent_email_enabled，
 * 讀不到是 null）；後端說變更通知已排給新信箱，但沒設定寄信時信不會真的寄出，不能說「已寄」。
 */
export function detailsNotices(result: AdminDetailsUpdateOut, emailEnabled: boolean | null = null): DetailsNotices {
  if (!result.changed_fields.length) return { success: ['資料沒有變動'], warnings: [] }
  const success = ['已更新家長資料']
  const warnings: string[] = []
  if (result.admissions_synced_fields.length) success.push(`招生資料已一起更新：${admissionsFieldsText(result.admissions_synced_fields)}`)
  if (result.admissions_skipped_fields.length) warnings.push(`招生資料的${admissionsFieldsText(result.admissions_skipped_fields)}另外改過，沒有跟著改`)
  if (result.email_notified) {
    if (emailEnabled === false) warnings.push('尚未設定寄信，變更通知沒有寄出，請電話通知家長')
    else success.push('已寄變更通知到新信箱')
  }
  return { success, warnings }
}
