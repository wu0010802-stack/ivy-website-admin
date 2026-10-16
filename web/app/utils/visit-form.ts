export interface VisitContact {
  parentName: string
  phone: string
  childName?: string
  childBirthdate?: string
  email?: string
}

export type VisitField = keyof VisitContact | 'visitDate' | 'slotId' | 'expectedStart'
export type VisitErrors = Partial<Record<VisitField, string>>

export const REFERRAL_OPTIONS = [
  // 2026-10-03：只問來源歸因看不到的管道，網路來源合成一項（細節之後由自建歸因補）。
  // 媽媽社團、LINE 群組的口碑算親友介紹；舊代碼 facebook／google_reviews／parent_community 後端仍收。
  // 2026-10-05 照園方紙本加兄姊（舊生弟妹）與傳單，兩者都是網站追蹤看不到的管道。
  { value: 'friends_family', label: '親友介紹' },
  { value: 'sibling', label: '哥哥姊姊讀過或正在讀' },
  { value: 'nearby', label: '住附近／路過看到' },
  { value: 'flyer', label: '傳單／DM' },
  { value: 'online', label: '網路上看到' },
  { value: 'other', label: '其他' }
] as const

// 2026-10-15 預計入學時間（選填）：盡快、接下來四個學期的開學月份、還不確定。學期規則同後端
// app/admissions/academic.py 的 current_term（8/1 起上學期、2/1 起下學期、1 月仍屬上學期）；值是「民國學年-學期」，
// 和後端 app/booking/expected_start.py 讀同一份案例 contracts/expected-start-cases.json。
export interface ExpectedStartOption { value: string; label: string }

function currentTerm(today: string): [number, number] {
  const [year, month] = today.split('-').map(Number) as [number, number]
  if (month >= 8) return [year - 1911, 1]
  if (month >= 2) return [year - 1912, 2]
  return [year - 1912, 1]
}

function termMonthText(schoolYear: number, semester: number): string {
  return semester === 1 ? `${schoolYear + 1911} 年 9 月` : `${schoolYear + 1912} 年 2 月`
}

/** today 是台北日期（YYYY-MM-DD，taipeiDate()）。 */
export function expectedStartOptions(today: string): ExpectedStartOption[] {
  const [schoolYear, semester] = currentTerm(today)
  const current = schoolYear * 2 + semester - 1
  const options: ExpectedStartOption[] = [{ value: 'asap', label: '盡快（這學期）' }]
  for (let offset = 1; offset <= 4; offset++) {
    const index = current + offset
    const termYear = Math.floor(index / 2)
    const termSemester = (index % 2) + 1
    options.push({ value: `${termYear}-${termSemester}`, label: termMonthText(termYear, termSemester) })
  }
  options.push({ value: 'unsure', label: '還不確定' })
  return options
}

/** 家長管理頁顯示已選的值（原值可能已不在今天的選項裡）。 */
export function expectedStartText(value: string): string {
  if (value === 'asap') return '盡快'
  if (value === 'unsure') return '還不確定'
  const match = /^(1\d{2})-([12])$/.exec(value)
  return match ? termMonthText(Number(match[1]), Number(match[2])) : value
}

// 規格 190：方便聯絡時段是固定選項，送代碼、顯示中文。API 也接受舊的
// 中文標籤（已快取的舊頁面），但新頁面一律送代碼。
export const CONTACT_TIME_OPTIONS = [
  { value: 'flexible', label: '時間彈性' },
  { value: 'weekday_morning', label: '平日上午' },
  { value: 'weekday_afternoon', label: '平日下午' },
  { value: 'other', label: '其他，另行確認' }
] as const

export type ContactTimeCode = (typeof CONTACT_TIME_OPTIONS)[number]['value']


export function contactTimeLabel(value: string): string {
  return CONTACT_TIME_OPTIONS.find((option) => option.value === value)?.label ?? value
}

export function taipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** 新預約表單讀公開場次的查詢（2026-10-13）：多帶 purpose=new_booking，伺服器據此記一次「最早能約哪天」。
 *  purpose 只決定記不記，不影響回傳的場次；改期管理頁讀同一支端點，不帶。 */
export function newBookingSlotsQuery(campusKey: string, today: string, days = 60) {
  const end = new Date(`${today}T12:00:00+08:00`)
  end.setUTCDate(end.getUTCDate() + days)
  return { campus_key: campusKey, date_from: today, date_to: taipeiDate(end), purpose: 'new_booking' as const }
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
  // 舊呼叫端不帶兒童欄位；新版表單帶空字串時才套用必填驗證。
  if (contact.childName !== undefined) {
    if (!contact.childName.trim()) errors.childName = '請填寫孩子姓名。'
    else if (contact.childName.trim().length > 64) errors.childName = '孩子姓名請在 64 字以內。'
  }
  if (contact.childBirthdate !== undefined) {
    if (!isValidDate(contact.childBirthdate)) errors.childBirthdate = '請填寫完整的出生年月日。'
    else if (contact.childBirthdate > today) errors.childBirthdate = '出生日期不能晚於今天。'
  }
  // 新版表單一律帶 email 欄位（2026-09-30 起必填）；舊呼叫端不帶。錯誤字不提「確認信會寄到這裡」：
  // 寄信看各校 parent_email_enabled（10-02 正式站是關的），欄位說明才跟著設定換句子（2026-10-12）。
  if (contact.email !== undefined) {
    const email = contact.email.trim()
    if (!email) errors.email = '請填寫 Email。'
    else if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = '請填寫有效的 Email，例如 name@example.com。'
  }
  return errors
}

const API_FIELDS: Record<string, VisitField> = {
  slot_id: 'slotId', email: 'email', phone: 'phone', parent_name: 'parentName', child_name: 'childName',
  child_birthdate: 'childBirthdate', expected_start: 'expectedStart'
}
const API_FIELD_MESSAGES: Partial<Record<VisitField, string>> = {
  slotId: '請選擇這一天的參觀場次。',
  email: '請填寫有效的 Email，例如 name@example.com。',
  phone: '請填寫 09 開頭的 10 碼手機號碼。',
  parentName: '請填寫家長稱呼。',
  childName: '請填寫孩子姓名。',
  childBirthdate: '請填寫完整的出生年月日，且不能晚於今天。',
  expectedStart: '這個入學時間已過期，請重新選擇。'
}

// 後端 422 是 FastAPI 的標準格式：detail 是陣列，loc[1] 是欄位名稱。
export function apiFieldErrors(detail: unknown): VisitErrors {
  if (!Array.isArray(detail)) return {}
  const errors: VisitErrors = {}
  for (const item of detail) {
    const field = API_FIELDS[String((item as { loc?: unknown[] })?.loc?.[1] ?? '')]
    if (field && !errors[field]) errors[field] = API_FIELD_MESSAGES[field] ?? '請檢查這個欄位。'
  }
  return errors
}

/**
 * 觸控裝置的文字欄位按 Enter（虛擬鍵盤的「下一項」）跳到下一欄，最後一欄收起鍵盤；不攔注音選字，
 * 桌機照舊 Enter 送出（2026-09-29 預約表單，2026-10-12 家長修改資料共用）。
 */
export function focusNextFieldOnEnter(event: KeyboardEvent, root: HTMLElement | null | undefined) {
  if (event.isComposing || event.keyCode === 229 || !matchMedia('(pointer: coarse)').matches) return
  const target = event.target
  if (!(target instanceof HTMLInputElement) || !['text', 'tel', 'email', 'date'].includes(target.type)) return
  event.preventDefault()
  const fields = [...(root?.querySelectorAll<HTMLElement>('input:not([type=radio]):not([type=checkbox]),select,textarea') ?? [])]
    .filter(el => el.offsetParent && !el.closest('details:not([open])'))
  const next = fields[fields.indexOf(target) + 1]
  if (next) next.focus()
  else target.blur()
}
