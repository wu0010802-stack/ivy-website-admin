// 後台修改家長資料（2026-10-12 規格第 3 節）：PATCH /admin/visit-requests/{id}/details。
// 型別取自契約產生檔（api/types.ts 的別名）。只送有改的欄位；Email、孩子姓名、孩子生日送 null 是清空。
import { api } from './client'
import type { AdminDetailsUpdate, AdminDetailsUpdateOut, VisitRequestFullOut } from './types'

export function updateVisitDetails(id: string, body: AdminDetailsUpdate): Promise<AdminDetailsUpdateOut> {
  return api.patch<AdminDetailsUpdateOut>(`/admin/visit-requests/${id}/details`, body)
}

// 已依保存政策匿名化的案件（後端 visit_request.anonymized_at 有值）不能再改資料；後端明細回應帶 anonymized，
// 不要用稱呼文字判斷。真的送出時後端另外會擋（409 VISIT_REQUEST_ANONYMIZED）。
export function isAnonymizedCase(detail: Pick<VisitRequestFullOut, 'anonymized'> | null | undefined): boolean {
  return detail?.anonymized === true
}

// ---- 輸入檢查（前端先擋；後端 normalize_phone 與 EmailStr 才是準的）----

/**
 * 後端會去掉空白與各種連字號再檢查（booking/schemas.py 的 _PHONE_STRIP_RE），這裡去掉同一組字：
 * 原本只去 -、－，從別處貼來的「0912–345–678」（en dash）後端收、這裡卻按不了儲存（2026-10-13）。
 * 官網預約表單（web/app/utils/visit-form.ts）用的也是這一組。
 */
export function normalizePhoneInput(value: string): string {
  return value.replace(/[\s\-\u2010-\u2015\u2212\uFF0D\u3000]/g, '')
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
  // 原本的 Email 被改掉：舊信箱收到的修改連結已失效（2026-10-13）。有寄變更信時新連結在信裡；
  // 沒寄（清空 Email、場次已開始、沒設定寄信）時家長手上沒有可用的連結。
  if (result.access_link_reset) {
    if (result.email_notified && emailEnabled !== false) success.push('原本寄出的家長管理連結已失效，新連結在變更通知裡')
    else warnings.push('原本寄出的家長管理連結已失效；家長需要連結時，請在「家長管理連結」重新產生')
  }
  return { success, warnings }
}
