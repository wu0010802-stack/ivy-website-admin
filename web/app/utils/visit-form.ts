export interface VisitContact {
  parentName: string
  phone: string
  consent: boolean
  childName?: string
  childBirthdate?: string
  email?: string
  /** 參觀人數（下拉選單的值，未選為空字串） */
  partySize?: string
}

export type VisitField = keyof VisitContact | 'visitDate' | 'slotId'
export type VisitErrors = Partial<Record<VisitField, string>>

export const REFERRAL_OPTIONS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'google_reviews', label: 'Google 評論' },
  { value: 'parent_community', label: '媽媽社團' },
  { value: 'friends_family', label: '親友介紹' },
  { value: 'other', label: '其他' }
] as const

// 規格 190：方便聯絡時段是固定選項，送代碼、顯示中文。API 也接受舊的
// 中文標籤（已快取的舊頁面），但新頁面一律送代碼。
export const CONTACT_TIME_OPTIONS = [
  { value: 'flexible', label: '時間彈性' },
  { value: 'weekday_morning', label: '平日上午' },
  { value: 'weekday_afternoon', label: '平日下午' },
  { value: 'other', label: '其他，另行確認' }
] as const

export type ContactTimeCode = (typeof CONTACT_TIME_OPTIONS)[number]['value']

// 規格 L194：參觀人數 1–10（含大人與孩子）。名額仍以家庭組數計，人數給園所準備接待。
export const PARTY_SIZE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

export function isValidPartySize(value: string | number | null | undefined): boolean {
  const size = Number(value)
  return value !== '' && value !== null && value !== undefined && Number.isInteger(size) && size >= 1 && size <= 10
}

export function contactTimeLabel(value: string): string {
  return CONTACT_TIME_OPTIONS.find((option) => option.value === value)?.label ?? value
}

export function taipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function visitDateLabel(value: string) {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${value}T12:00:00+08:00`))
}

/** 線上取消／改期截止說明。期限是各校設定（預設參觀前 24 小時），整天數且超過一天時講「天」。 */
export function changeDeadlineRule(hours: number | null | undefined) {
  if (!hours || hours < 1) return ''
  return hours >= 48 && hours % 24 === 0 ? `參觀前 ${hours / 24} 天` : `參觀前 ${hours} 小時`
}

// 送單時選的時段已經不能用：API 依原因回不同代碼（已關閉不再冒充「額滿」），
// 家長看到的說明跟著原因走；都要重新選時段。
const SLOT_UNAVAILABLE_MESSAGES: Record<string, string> = {
  SLOT_FULL: '這個時段名額剛好滿了，請選擇其他時段。',
  SLOT_CLOSED: '這個時段剛被園所關閉了，請選擇其他時段。',
  SLOT_NOT_FOUND: '這個時段已經不存在了，請選擇其他時段。',
  SLOT_NOT_BOOKABLE: '這個時段已經無法預約了，請選擇其他時段。',
}

export function slotUnavailableMessage(code: string | null | undefined): string | null {
  return (code && SLOT_UNAVAILABLE_MESSAGES[code]) || null
}

export function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** 接受手機自動填入、複製貼上的空格與連字號，API 仍收到 09 開頭的十碼。 */
export function normalizeVisitPhone(phone: string) {
  return phone.replace(/[\s\-\u2010-\u2015\u2212\uFF0D\u3000]/g, '')
}

export function validateVisitContact(contact: VisitContact, today = taipeiDate()): VisitErrors {
  const errors: VisitErrors = {}
  if (!contact.parentName.trim()) errors.parentName = '請填寫家長稱呼，讓我們知道怎麼稱呼你。'
  else if (contact.parentName.trim().length > 40) errors.parentName = '家長稱呼請在 40 字以內。'
  if (!/^09[0-9]{8}$/.test(normalizeVisitPhone(contact.phone))) errors.phone = '請填寫 09 開頭的 10 碼手機號碼。'
  if (!contact.consent) errors.consent = '請勾選同意，讓園所能聯繫本次參觀需求。'
  // 舊呼叫端不帶兒童欄位；新版表單帶空字串時才套用必填驗證。
  if (contact.childName !== undefined) {
    if (!contact.childName.trim()) errors.childName = '請填寫孩子姓名。'
    else if (contact.childName.trim().length > 64) errors.childName = '孩子姓名請在 64 字以內。'
  }
  if (contact.childBirthdate !== undefined) {
    if (!isValidDate(contact.childBirthdate)) errors.childBirthdate = '請填寫完整的出生年月日。'
    else if (contact.childBirthdate > today) errors.childBirthdate = '出生日期不能晚於今天。'
  }
  // 舊呼叫端不帶人數；新版表單未選時是空字串。
  if (contact.partySize !== undefined && !isValidPartySize(contact.partySize)) errors.partySize = '請選擇參觀人數。'
  if (contact.email?.trim() && (contact.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim()))) errors.email = '請填寫有效的 Email，例如 name@example.com。'
  return errors
}
