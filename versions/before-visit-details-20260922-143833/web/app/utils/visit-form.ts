export interface VisitContact {
  parentName: string
  phone: string
  consent: boolean
}

export type VisitField = keyof VisitContact
export type VisitErrors = Partial<Record<VisitField, string>>

/** 接受手機自動填入、複製貼上的空格與連字號，API 仍收到 09 開頭的十碼。 */
export function normalizeVisitPhone(phone: string) {
  return phone.replace(/[\s-]/g, '')
}

export function validateVisitContact(contact: VisitContact): VisitErrors {
  const errors: VisitErrors = {}
  if (!contact.parentName.trim()) errors.parentName = '請填寫家長稱呼，讓我們知道怎麼稱呼你。'
  else if (contact.parentName.trim().length > 40) errors.parentName = '家長稱呼請在 40 字以內。'
  if (!/^09[0-9]{8}$/.test(normalizeVisitPhone(contact.phone))) errors.phone = '請填寫 09 開頭的 10 碼手機號碼。'
  if (!contact.consent) errors.consent = '請勾選同意，讓園所能聯繫本次參觀需求。'
  return errors
}
