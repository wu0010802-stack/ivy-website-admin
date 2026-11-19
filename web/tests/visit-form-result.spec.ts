import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, '../app/components/VisitForm.vue'), 'utf8')

describe('預約表單接線', () => {
  it('不再有方便接電話時段；Email 是選填（2026-11-13）', () => {
    expect(source).not.toContain('contact-time')
    expect(source).not.toContain('preferred_time')
    expect(source).toMatch(/聯絡 Email<small>選填<\/small>/)
    // 欄位不能帶 required：瀏覽器原生驗證會在送出前擋下空白。
    expect(source).toMatch(/<input id="parent-email" v-model="form\.email"/)
  })

  it('沒填 Email 就不送這個欄位，完成頁也不列空白的 Email', () => {
    // 後端的 Email 是 EmailStr | None：送空字串會 422，沒填要整個欄位不帶。
    expect(source).toContain("...(form.email ? { email: form.email } : {}),")
    expect(source).not.toMatch(/^\s+email: form\.email,\n\s+referral_sources/m)
    expect(source).toContain('<div v-if="form.email"><dt>聯絡 Email</dt><dd>{{ form.email }}</dd></div>')
  })

  it('沒填 Email 的家長沒有確認信：重複送出的提示不能叫他去信裡找連結', () => {
    expect(source).not.toContain("(bookingConfig.value?.parent_email_enabled\n          ? '你先前")
    expect(source.match(/\(mailedToParent\.value\n\s+\? '/g)).toHaveLength(2)
    expect(source).toContain('const mailedToParent = computed(() => Boolean(bookingConfig.value?.parent_email_enabled && form.email))')
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

  it('修改連結用整頁導覽，不讓 token 存進 router 歷史狀態；送單區不再說以園所確認為準', () => {
    expect(source).toMatch(/<a class="button primary" :href="managePath">修改或取消預約<\/a>/)
    expect(source).not.toContain('參觀時間以園所確認為準')
    expect(source).not.toContain('你先前那一次其實已經送出成功了，請查看確認信')
  })
})
