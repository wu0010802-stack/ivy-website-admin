import { ApiError } from './client'

// API 錯誤的共用解析。後端錯誤本文是 {detail: {code, message, request_id}}
// （字串 detail 與 422 陣列另外在最外層帶 request_id），訊息本身已是中文；
// 這裡補上「後端沒給訊息時」的代碼對照，並在系統錯誤時附上錯誤編號，讓
// 使用者回報時可以對 log。

// 後端錯誤碼 → 中文（只在 detail 沒有 message 時使用）。
export const ERROR_CODE_MESSAGES: Record<string, string> = {
  SLOT_FULL: '這個時段名額已滿',
  SLOT_CLOSED: '這個時段已關閉',
  SLOT_NOT_FOUND: '找不到這個時段',
  SLOT_NOT_BOOKABLE: '這個時段目前無法預約',
  MEDIA_NOT_READY: '引用的素材還沒處理完成或已被刪除',
  CAMPUS_INACTIVE: '分校已停用，內容不會發布',
  CONTENT_NOT_READY: '內容還不能發布',
  CONTENT_SCHEMA_OUTDATED: '這一版的欄位格式已經過時，請到編輯頁手動修改後再發布',
  CONTENT_VERSION_CONFLICT: '內容已被其他人更新，請重新載入後再試',
  BOOKING_CONFIG_VERSION_CONFLICT: '設定已被其他人更新，請重新載入',
  SLOT_VERSION_CONFLICT: '這個時段剛被其他人修改，請重新載入後再調整',
  VISIT_REQUEST_VERSION_CONFLICT: '這筆案件剛被其他人修改，請重新載入後再操作',
  VISIT_SCHEDULE_VERSION_CONFLICT: '開放規則剛被其他人修改，請重新載入後再編輯',
  MEDIA_VERSION_CONFLICT: '這個素材的說明剛被其他人修改，請重新載入後再編輯',
  RETENTION_POLICY_VERSION_CONFLICT: '保存政策剛被其他人修改，請重新載入後再編輯',
  INTERNAL_ERROR: '系統發生未預期的錯誤，請稍後再試',
}

interface ErrorDetail {
  code?: string
  message?: string
  request_id?: string
}

function detailObject(err: unknown): ErrorDetail {
  return err instanceof ApiError && err.detail !== null && typeof err.detail === 'object' && !Array.isArray(err.detail)
    ? (err.detail as ErrorDetail)
    : {}
}

export function apiErrorCode(err: unknown): string | undefined {
  return detailObject(err).code
}

/** 別人先改過（樂觀鎖不符）：各資源的代碼都以 _VERSION_CONFLICT 結尾。 */
export function isVersionConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && (apiErrorCode(err) ?? '').endsWith('_VERSION_CONFLICT')
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback
  const d = err.detail
  if (typeof d === 'string' && d) return d
  // FastAPI 的 422 驗證錯誤是陣列（每筆有 loc/msg/type）。
  if (Array.isArray(d)) {
    const messages = d
      .map((e) => (e && typeof e === 'object' && 'msg' in e ? String((e as { msg: unknown }).msg) : ''))
      .filter(Boolean)
      // pydantic 會在訊息前面加 "Value error, "，對使用者沒有意義。
      .map((msg) => msg.replace(/^Value error,\s*/, ''))
    if (messages.length) return messages.join('；')
    return fallback
  }
  const detail = detailObject(err)
  const message = detail.message ?? (detail.code ? ERROR_CODE_MESSAGES[detail.code] : undefined) ?? fallback
  // 系統錯誤附上錯誤編號（前 8 碼就夠對 log），其他錯誤是使用者自己能處理的。
  if (err.status >= 500 && detail.request_id) return `${message}（錯誤編號 ${detail.request_id.slice(0, 8)}）`
  return message
}
