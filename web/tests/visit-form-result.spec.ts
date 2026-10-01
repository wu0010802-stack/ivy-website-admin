import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, '../app/components/VisitForm.vue'), 'utf8')

describe('預約表單接線', () => {
  it('不再有方便接電話時段與選填 Email', () => {
    expect(source).not.toContain('contact-time')
    expect(source).not.toContain('preferred_time')
    expect(source).toMatch(/聯絡 Email<small>必填<\/small>/)
  })

  it('結果頁有修改連結與複製按鈕，文案由 visitResultCopy 決定', () => {
    expect(source).toContain('visitResultCopy(')
    expect(source).toContain('managePath')
    expect(source).toContain('修改或取消預約')
    expect(source).toContain('複製連結')
  })

  it('422 依欄位標出錯誤', () => {
    expect(source).toContain('apiFieldErrors(detail)')
  })
})
