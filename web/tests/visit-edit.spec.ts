import { describe, expect, it } from 'vitest'
import { editBaseFrom, editedChanges, rebaseEdit, validateEdit } from '../app/utils/visit-edit'

const record = { parent_name: '王媽媽', phone: '0912345678', email: 'wang@example.com', child_name: '小安', child_birthdate: '2022-05-01' }

describe('修改資料只送真正改過的欄位', () => {
  it('什麼都沒動就不送', () => {
    const form = editBaseFrom(record)
    expect(editedChanges(record, form, editBaseFrom(record))).toEqual({})
  })

  it('只送改過的欄位，手機去分隔符、稱呼去前後空白', () => {
    const base = editBaseFrom(record)
    const form = { ...base, phone: '0922-333-444', parentName: ' 王媽媽 ' }
    expect(editedChanges(record, form, base)).toEqual({ phone: '0922333444' })
  })

  it('版本衝突後以新紀錄為底，只保留家長自己改過的欄位，不把舊值改回去', () => {
    const base = editBaseFrom(record)
    const form = { ...base, childName: '小安安' }
    const fresh = { ...record, phone: '0911111111' }
    const next = rebaseEdit(form, base, fresh)
    expect(next.form.phone).toBe('0911111111')
    expect(next.form.childName).toBe('小安安')
    expect(editedChanges(fresh, next.form, next.base)).toEqual({ child_name: '小安安' })
  })

  it('補登案件只填了一部分資料：只改手機時，沒動過的空欄位不擋儲存', () => {
    const sparse = { parent_name: '王媽媽', phone: '0912345678', email: null, child_name: null, child_birthdate: null }
    const base = editBaseFrom(sparse)
    const form = { ...base, phone: '0922333444' }
    expect(validateEdit(sparse, form, base, '2026-10-01')).toEqual({})
  })

  it('改過的欄位照樣驗證；稱呼超過 40 字但沒改就不擋', () => {
    const longName = '王'.repeat(50)
    const record = { parent_name: longName, phone: '0912345678', email: 'a@b.co', child_name: '小安', child_birthdate: '2022-05-01' }
    const base = editBaseFrom(record)
    expect(validateEdit(record, { ...base, phone: '0922333444' }, base, '2026-10-01')).toEqual({})
    expect(validateEdit(record, { ...base, phone: '123' }, base, '2026-10-01')).toHaveProperty('phone')
    expect(validateEdit(record, { ...base, email: '' }, base, '2026-10-01')).toHaveProperty('email')
  })
})
