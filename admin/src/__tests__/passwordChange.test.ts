import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import ChangePasswordDialog from '../components/ChangePasswordDialog.vue'
import AccountView from '../views/AccountView.vue'
import { api, ApiError } from '../api/client'
import { apiErrorMessage, apiFieldError } from '../api/errors'
import { passwordBytes, passwordHint, passwordLength, passwordOk } from '../composables/passwordRules'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

// 2026-09-29 資安修正：新密碼 UTF-8 最多 72 bytes（bcrypt 上限）、目前的密碼
// 跟登入共用帳號鎖（429）、總管理者不能用「重設」改自己的密碼（後端 409
// USE_CHANGE_PASSWORD；後台自己那一列本來就沒有「重設密碼」），要到「我的帳號」
// 用本人更改密碼。

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
})

function button(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').filter(item => item.text() === text)
}

describe('新密碼長度規則', () => {
  it('以 UTF-8 bytes 計算：中文 24 字剛好 72 bytes，25 字超過', () => {
    expect(passwordBytes('常'.repeat(24))).toBe(72)
    expect(passwordOk('常'.repeat(24))).toBe(true)
    expect(passwordOk('常'.repeat(25))).toBe(false)
    expect(passwordOk('a'.repeat(11))).toBe(false)
    expect(passwordOk('a'.repeat(72))).toBe(true)
    expect(passwordOk('a'.repeat(73))).toBe(false)
  })

  // 後端 pydantic 的 min_length／max_length 數 code point（Python len），不是 UTF-16 單位：
  // emoji 一個字在 JS 的 .length 是 2，前端照 .length 算會放行只有 6 個字的密碼，後端再回英文 422。
  it('字數以 code point 計，和後端一致：emoji 算 1 個字，不是 2 個', () => {
    expect('😀'.repeat(6).length).toBe(12)
    expect(passwordLength('😀'.repeat(6))).toBe(6)
    expect(passwordOk('😀'.repeat(6))).toBe(false)
    expect(passwordOk('😀'.repeat(11))).toBe(false)
    expect(passwordOk('😀'.repeat(12))).toBe(true)
    // bytes 上限照舊：emoji 每個 4 bytes，18 個剛好 72。
    expect(passwordOk('😀'.repeat(18))).toBe(true)
    expect(passwordOk('😀'.repeat(19))).toBe(false)
    expect(passwordHint('😀'.repeat(6))).toContain('目前 6 字')
  })

  it('後端回 422 的英文長度訊息，密碼欄位改顯示中文；其他欄位的訊息照舊', () => {
    const tooShort = new ApiError(422, [{ type: 'string_too_short', loc: ['body', 'new_password'], msg: 'String should have at least 12 characters', ctx: { min_length: 12 } }])
    expect(apiErrorMessage(tooShort, '失敗')).toBe('新密碼至少要 12 個字')
    expect(apiFieldError(tooShort, 'new_password')).toBe('新密碼至少要 12 個字')
    const tooLong = new ApiError(422, [{ type: 'string_too_long', loc: ['body', 'password'], msg: 'String should have at most 128 characters', ctx: { max_length: 128 } }])
    expect(apiErrorMessage(tooLong, '失敗')).toBe('密碼最多 128 個字')
    const current = new ApiError(422, [{ type: 'string_too_long', loc: ['body', 'current_password'], msg: 'String should have at most 128 characters' }])
    expect(apiErrorMessage(current, '失敗')).toBe('目前的密碼最多 128 個字')
    // 後端自己寫的中文（72 bytes 上限）原樣顯示；不是密碼欄位的英文訊息不動。
    const bytes = new ApiError(422, [{ type: 'password_too_long', loc: ['body', 'password'], msg: '密碼太長：最多 72 個位元組（英數字 72 個、中文約 24 個字），超過的部分不會生效' }])
    expect(apiErrorMessage(bytes, '失敗')).toBe('密碼太長：最多 72 個位元組（英數字 72 個、中文約 24 個字），超過的部分不會生效')
    const other = new ApiError(422, [{ type: 'string_too_short', loc: ['body', 'title'], msg: 'String should have at least 1 character' }])
    expect(apiErrorMessage(other, '失敗')).toBe('String should have at least 1 character')
  })
})

describe('本人更改密碼對話框', () => {
  async function mountDialog() {
    const wrapper = mount(ChangePasswordDialog, {
      props: { modelValue: true },
      global: { plugins: [ElementPlus], stubs: { teleport: true } },
    })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }

  async function fill(wrapper: VueWrapper, current: string, next: string) {
    const inputs = wrapper.findAll('input[type="password"]')
    await inputs[0]!.setValue(current)
    await inputs[1]!.setValue(next)
    await inputs[2]!.setValue(next)
  }

  it('新密碼超過 72 bytes 時說明上限並不能送出', async () => {
    const post = vi.spyOn(api, 'post')
    const wrapper = await mountDialog()
    await fill(wrapper, 'current-password-1', '常'.repeat(25))
    expect(wrapper.get('[data-test="new-password-hint"]').text()).toContain('超過 72 bytes')
    expect(button(wrapper, '更新密碼')[0]!.attributes('disabled')).toBeDefined()
    await fill(wrapper, 'current-password-1', '常'.repeat(24))
    expect(wrapper.get('[data-test="new-password-hint"]').text()).not.toContain('超過')
    expect(button(wrapper, '更新密碼')[0]!.attributes('disabled')).toBeUndefined()
    expect(post).not.toHaveBeenCalled()
  })

  it('目前的密碼錯太多次（429 LOGIN_LOCKED）說明密碼驗證暫停 15 分鐘', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(429, { code: 'LOGIN_LOCKED', message: '密碼錯誤次數過多，這個帳號的密碼登入暫停 15 分鐘' }),
    )
    const wrapper = await mountDialog()
    await fill(wrapper, 'wrong-password-xx', 'new-password-1234')
    await button(wrapper, '更新密碼')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('密碼驗證暫停 15 分鐘')
  })

  it('系統忙碌的 429（LOGIN_RATE_LIMITED）請人稍候再試，不講成帳號鎖', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(429, { code: 'LOGIN_RATE_LIMITED', message: '嘗試太頻繁或系統忙碌，請稍候再試' }),
    )
    const wrapper = await mountDialog()
    await fill(wrapper, 'current-password-1', 'new-password-1234')
    await button(wrapper, '更新密碼')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('嘗試太頻繁或系統忙碌，請稍候再試')
    expect(wrapper.text()).not.toContain('15 分鐘')
  })

  it('後端 422 password_too_long 顯示中文訊息，不是「更新失敗」', async () => {
    const message = '密碼太長：最多 72 個位元組（英數字 72 個、中文約 24 個字），超過的部分不會生效'
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(422, [{ loc: ['body', 'new_password'], msg: message, type: 'password_too_long' }]),
    )
    const wrapper = await mountDialog()
    await fill(wrapper, 'current-password-1', 'new-password-1234')
    await button(wrapper, '更新密碼')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('密碼太長：最多 72 個位元組')
    expect(wrapper.text()).not.toContain('更新失敗')
  })
})

describe('我的帳號：更改密碼入口', () => {
  it('USE_CHANGE_PASSWORD 的訊息指向「我的帳號」，這一頁要有更改密碼的按鈕', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: false })
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin', { email: 'admin@ivy.example', campus_keys: [] })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)*', component: AccountView }] })
    await router.push('/account')
    await router.isReady()
    const wrapper = mount(AccountView, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    // 合併 main（PR #15 也加了「密碼」區）後只留一個入口、一個對話框。
    expect(wrapper.findAll('[data-test="change-password"]')).toHaveLength(1)
    expect(wrapper.findAllComponents(ChangePasswordDialog)).toHaveLength(1)
    const dialog = wrapper.getComponent(ChangePasswordDialog)
    expect(dialog.props('modelValue')).toBe(false)
    await wrapper.get('[data-test="change-password"]').trigger('click')
    expect(dialog.props('modelValue')).toBe(true)
  })
})
