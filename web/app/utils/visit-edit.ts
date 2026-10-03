import { normalizeVisitPhone, validateVisitContact, type VisitErrors, type VisitField } from './visit-form'

export interface EditForm { parentName: string; phone: string; email: string; childName: string; childBirthdate: string }
interface EditRecord { parent_name: string; phone: string; email?: string | null; child_name?: string | null; child_birthdate?: string | null }
export type EditChanges = Partial<{ parent_name: string; phone: string; email: string; child_name: string; child_birthdate: string }>

const KEYS = ['parentName', 'phone', 'email', 'childName', 'childBirthdate'] as const

export function editBaseFrom(record: EditRecord): EditForm {
  return {
    parentName: record.parent_name, phone: record.phone, email: record.email ?? '',
    childName: record.child_name ?? '', childBirthdate: record.child_birthdate ?? ''
  }
}

// 後端送出前的正規化：前後空白、手機分隔符。
function normalize(form: EditForm): Required<EditChanges> {
  return {
    parent_name: form.parentName.trim(), phone: normalizeVisitPhone(form.phone), email: form.email.trim(),
    child_name: form.childName.trim(), child_birthdate: form.childBirthdate
  }
}

/** 只送「家長在這次開啟表單後真的改過」且與目前紀錄不同的欄位；沒動的欄位不送，才不會蓋掉別人剛改的值。 */
export function editedChanges(current: EditRecord, form: EditForm, base: EditForm): EditChanges {
  const next = normalize(form)
  const before = normalize(base)
  const now = normalize(editBaseFrom(current))
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    if (next[key] !== before[key] && next[key] !== now[key]) out[key] = next[key]
  }
  return out as EditChanges
}

/** 版本衝突、重抓最新紀錄後：沒動過的欄位換成新值，家長改過的欄位保留。 */
export function rebaseEdit(form: EditForm, base: EditForm, fresh: EditRecord): { form: EditForm; base: EditForm } {
  const nextBase = editBaseFrom(fresh)
  const nextForm = { ...form }
  for (const key of KEYS) if (form[key] === base[key]) nextForm[key] = nextBase[key]
  return { form: nextForm, base: nextBase }
}

const CHANGE_FIELD: Record<string, VisitField> = {
  parent_name: 'parentName', phone: 'phone', email: 'email', child_name: 'childName', child_birthdate: 'childBirthdate'
}

/**
 * 只驗證這次改過的欄位：後台補登的案件孩子資料、Email 可能是空的（後端也允許維持空值），
 * 家長只想改手機時，不能被沒碰過的欄位擋住。
 */
export function validateEdit(current: EditRecord, form: EditForm, base: EditForm, today: string): VisitErrors {
  const touched = new Set(Object.keys(editedChanges(current, form, base)).map(key => CHANGE_FIELD[key]).filter(Boolean))
  const errors = validateVisitContact(form, today)
  return Object.fromEntries(Object.entries(errors).filter(([field]) => touched.has(field as VisitField))) as VisitErrors
}
