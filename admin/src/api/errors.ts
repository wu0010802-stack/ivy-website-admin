import { ApiError } from './client'
import { contentPathLabel } from './contentFieldLabels'

// API 錯誤的共用解析。後端錯誤本文是 {detail: {code, message, request_id}}
// （字串 detail 與 422 陣列另外在最外層帶 request_id），訊息本身已是中文；
// 這裡補上「後端沒給訊息時」的代碼對照，並在系統錯誤時附上錯誤編號，讓
// 使用者回報時可以對 log。

// 後端錯誤碼 → 中文（只在 detail 沒有 message 時使用）。
export const ERROR_CODE_MESSAGES: Record<string, string> = {
  SLOT_FULL: '這個場次名額已滿',
  SLOT_CLOSED: '這個場次已關閉',
  SLOT_NOT_FOUND: '找不到這個場次',
  SLOT_NOT_BOOKABLE: '這個場次目前無法預約',
  MEDIA_NOT_READY: '引用的素材還沒處理完成或已被刪除',
  MEDIA_NOT_RETRYABLE: '只有處理失敗的影片可以重新處理',
  MEDIA_ALREADY_PROCESSING: '這支影片已經在處理了',
  MEDIA_VIDEO_TOO_LONG: '影片最長 10 分鐘，請剪短後再上傳',
  CAMPUS_INACTIVE: '分校已停用，內容不會發布',
  CONTENT_NOT_READY: '內容還不能發布',
  CONTENT_SCHEMA_OUTDATED: '這一版的欄位格式已經過時，請到編輯頁手動修改後再發布',
  CONTENT_VERSION_CONFLICT: '內容已被其他人更新，請重新載入後再試',
  SCHEDULE_REVISION_NOT_NEWER: '官網已經是這一版或更新的版本，排程到時候不會發布',
  BOOKING_CONFIG_VERSION_CONFLICT: '設定已被其他人更新，請重新載入',
  SLOT_VERSION_CONFLICT: '這個場次剛被其他人修改，請重新載入後再調整',
  VISIT_REQUEST_VERSION_CONFLICT: '這筆案件剛被其他人修改，請重新載入後再操作',
  VISIT_SCHEDULE_VERSION_CONFLICT: '開放規則剛被其他人修改，請重新載入後再編輯',
  MEDIA_VERSION_CONFLICT: '這個素材的說明剛被其他人修改，請重新載入後再編輯',
  RETENTION_POLICY_VERSION_CONFLICT: '保存政策剛被其他人修改，請重新載入後再編輯',
  LINE_NOT_CONFIGURED: '尚未設定 LINE 官方帳號的 Messaging API 金鑰',
  LINE_GROUP_UNAVAILABLE: '官方帳號不在這個群組裡，請重新把它拉進群組',
  LINE_GROUP_UNVERIFIED: '這個群組還沒驗證：請先產生驗證碼，貼到要綁定的 LINE 群組裡，再選這個群組',
  RECRUITMENT_VISIT_VERSION_CONFLICT: '這筆招生訪視剛被其他人修改，請重新載入後再操作',
  RECRUITMENT_VISIT_ANONYMIZED: '這筆招生訪視已依保存政策匿名化，不能再修改',
  TRANSITION_NOT_ALLOWED: '這個階段不能直接移過去',
  VISIT_REQUEST_NOT_COMPLETED: '這筆預約不是「已到場」，不能建立招生訪視',
  VISIT_REQUEST_ANONYMIZED: '這筆預約已依保存政策匿名化，不能再建立招生訪視',
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

/** 密碼登入／驗證被擋（429）但不是帳號鎖：來源限流、排隊已滿、系統忙碌。 */
export const LOGIN_BUSY_MESSAGE = '嘗試太頻繁或系統忙碌，請稍候再試。'

/**
 * 密碼登入、改密碼、重新驗證共用的 429 文案（後端 reauth.login_rate_limited）。
 * 只有 LOGIN_LOCKED 才是「這個帳號的密碼暫停 15 分鐘」；LOGIN_RATE_LIMITED（來源
 * 限流、排隊已滿、限流連線池忙碌）幾秒到幾分鐘就恢復，而且 Google／LINE 登入
 * 也會被同一個來源限流擋，不能講成帳號被鎖或建議改用。
 * verb 是「登入」或「驗證」；alternative 是鎖定時的替代做法（沒有就請稍後再試）。
 */
export function loginLimitedMessage(err: unknown, options: { verb: '登入' | '驗證'; alternative?: string }): string {
  if (apiErrorCode(err) !== 'LOGIN_LOCKED') return LOGIN_BUSY_MESSAGE
  return `密碼錯誤次數過多，這個帳號的密碼${options.verb}暫停 15 分鐘，${options.alternative ?? '請稍後再試'}。`
}

/** 422 裡指到某個欄位（loc 含欄位名）的訊息，寫在那一欄下方用；沒有就回空字串。 */
export function apiFieldError(err: unknown, field: string): string {
  if (!(err instanceof ApiError) || err.status !== 422 || !Array.isArray(err.detail)) return ''
  return err.detail
    .filter((e): e is { loc: unknown[]; msg: unknown } => {
      const loc = (e as { loc?: unknown } | null)?.loc
      return Array.isArray(loc) && loc.includes(field)
    })
    .map((e) => String(e.msg).replace(/^Value error,\s*/, ''))
    .join('；')
}

/** 內容存檔被擋下（422）的一筆：錯在哪裡（loc）、中文位置、中文原因 */
export interface ContentFieldError {
  path: (string | number)[]
  label: string
  message: string
}

const CJK = /[\u3400-\u9fff]/

// pydantic 的英文訊息翻成中文；後端自己寫的（value_error）已經是中文，只拿掉前綴。
function validationMessage(type: string, msg: string): string {
  const n = /(\d+(?:\.\d+)?)/.exec(msg)?.[1]
  switch (type) {
    case 'string_too_short':
      return !n || n === '1' ? '不能空白' : `至少要 ${n} 個字`
    case 'string_too_long':
      return n ? `不能超過 ${n} 字` : '字數太多'
    case 'too_short':
      return n ? `至少要 ${n} 項` : '項目太少'
    case 'too_long':
      return n ? `最多 ${n} 項` : '項目太多'
    case 'missing':
      return '必填'
    case 'greater_than_equal':
    case 'greater_than':
      return n ? `不能小於 ${n}` : '數字太小'
    case 'less_than_equal':
    case 'less_than':
      return n ? `不能大於 ${n}` : '數字太大'
    case 'int_parsing':
    case 'int_type':
    case 'float_parsing':
    case 'float_type':
      return '要填數字'
    case 'literal_error':
    case 'enum':
      return '不是可以選的選項'
  }
  if (type.startsWith('date')) return '日期格式不正確'
  if (type.startsWith('time')) return '時間格式不正確'
  const text = msg.replace(/^(Value error|Assertion failed),\s*/, '')
  return CJK.test(text) ? text : '格式不正確'
}

/**
 * 內容存檔被後端擋下時，逐筆寫出「哪一則的哪一欄、為什麼」；不是 422 驗證錯誤回空陣列。
 * 和 apiErrorMessage 分開：其他頁面靠那邊的 join 格式，不能跟著改。
 */
export function contentFieldErrors(err: unknown, kind?: string): ContentFieldError[] {
  if (!(err instanceof ApiError) || err.status !== 422 || !Array.isArray(err.detail)) return []
  return err.detail
    .filter((e): e is { loc?: unknown; msg?: unknown; type?: unknown } => Boolean(e) && typeof e === 'object')
    .map((e) => {
      const loc = Array.isArray(e.loc) ? e.loc.filter((s): s is string | number => typeof s === 'string' || typeof s === 'number') : []
      // 整包請求驗證的 loc 以 body／payload 開頭；內容存檔的 loc 直接從欄位開始。
      const path = loc[0] === 'body' ? loc.slice(1) : loc
      if (path[0] === 'payload') path.shift()
      return {
        path,
        label: path.length ? contentPathLabel(kind, path) : '',
        message: validationMessage(typeof e.type === 'string' ? e.type : '', typeof e.msg === 'string' ? e.msg : ''),
      }
    })
}

/** 內容編輯頁存檔、發布失敗的 toast 文字：422 寫出位置與中文原因，其他沿用 apiErrorMessage。 */
export function contentSaveErrorMessage(err: unknown, kind: string | undefined, fallback: string): string {
  const errors = contentFieldErrors(err, kind)
  if (!errors.length) return apiErrorMessage(err, fallback)
  const lines = errors.map((e) => (e.label ? `${e.label}：${e.message}` : e.message))
  return lines.length > 3 ? `${lines.slice(0, 3).join('；')}；還有 ${lines.length - 3} 個地方` : lines.join('；')
}
