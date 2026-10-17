import { describe, expect, it } from 'vitest'
import { editBaseFrom, editedChanges, rebaseEdit, validateEdit } from '../app/utils/visit-edit'

const record = { parent_name: '王媽媽', phone: '0912345678', email: 'wang@example.com', child_name: '小安', child_birthdate: '2022-05-01', expected_start: 'asap' }

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

  it('預計入學時間：沒動不送，清空送 null，改了送新值（2026-10-15）', () => {
    const base = editBaseFrom(record)
    expect(base.expectedStart).toBe('asap')
    expect(editedChanges(record, { ...base, phone: '0922333444' }, base)).toEqual({ phone: '0922333444' })
    expect(editedChanges(record, { ...base, expectedStart: '' }, base)).toEqual({ expected_start: null })
    expect(editedChanges(record, { ...base, expectedStart: '116-1' }, base)).toEqual({ expected_start: '116-1' })
  })

  it('原值已不在新選項（跨學期）：只改別的欄位時不送、也不擋（Review Focus 3）', () => {
    const old = { ...record, expected_start: '110-1' }
    const base = editBaseFrom(old)
    const form = { ...base, childName: '小樹' }
    expect(editedChanges(old, form, base)).toEqual({ child_name: '小樹' })
    expect(validateEdit(old, form, base, '2026-10-15')).toEqual({})
  })

  it('原本沒填預計入學時間的案件：沒動不送，選了才送', () => {
    const blank = { ...record, expected_start: null }
    const base = editBaseFrom(blank)
    expect(base.expectedStart).toBe('')
    expect(editedChanges(blank, { ...base, phone: '0922333444' }, base)).toEqual({ phone: '0922333444' })
    expect(editedChanges(blank, { ...base, expectedStart: 'unsure' }, base)).toEqual({ expected_start: 'unsure' })
  })

  it('版本衝突後預計入學時間：沒動過的換成新值，家長改過的保留', () => {
    const base = editBaseFrom(record)
    const fresh = { ...record, expected_start: '116-1' }
    expect(rebaseEdit({ ...base }, base, fresh).form.expectedStart).toBe('116-1')
    expect(rebaseEdit({ ...base, expectedStart: 'unsure' }, base, fresh).form.expectedStart).toBe('unsure')
  })
})
