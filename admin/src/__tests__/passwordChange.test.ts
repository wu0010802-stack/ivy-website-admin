import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import ChangePasswordDialog from '../components/ChangePasswordDialog.vue'
import AccountView from '../views/AccountView.vue'
import { api, ApiError } from '../api/client'
import { passwordBytes, passwordOk } from '../composables/passwordRules'
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
