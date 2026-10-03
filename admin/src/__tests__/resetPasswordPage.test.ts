// 2026-10-03 設定新密碼頁：不用登入；token 只在網址 # 後面，讀到就清掉。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import ResetPasswordView from '../views/ResetPasswordView.vue'
import LoginView from '../views/LoginView.vue'
import { authGuard, routes } from '../router'
import { api, ApiError } from '../api/client'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const ACCOUNT = { email: 'ca@ivy.example', expires_at: '2026-10-03T06:52:00Z' }
const NEW_PW = 'new-password-67890'

async function setup(path: string) {
  const pinia = createPinia()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/reset-password', name: 'reset-password', component: ResetPasswordView },
      { path: '/login', name: 'login', component: defineComponent({ template: '<p>login</p>' }) },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(ResetPasswordView, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('設定新密碼頁', () => {
  it('讀到網址 # 後的代碼就清掉，確認連結後顯示帳號與期限', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(ACCOUNT as never)
    const { wrapper, router } = await setup('/reset-password#token=abc123')
    expect(post).toHaveBeenCalledWith('/auth/password-reset/verify', { token: 'abc123' })
    expect(router.currentRoute.value.hash).toBe('')
    expect(router.currentRoute.value.fullPath).not.toContain('abc123')
    expect(wrapper.text()).toContain('ca@ivy.example')
    expect(wrapper.text()).toContain('10/03 14:52')
  })

  it('設定新密碼後回登入頁並帶 reason', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce(ACCOUNT as never).mockResolvedValueOnce(undefined as never)
    const { wrapper, router } = await setup('/reset-password#token=abc123')
    await wrapper.find('#reset-new-password').setValue(NEW_PW)
    await wrapper.find('#reset-confirm-password').setValue(NEW_PW)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(post).toHaveBeenLastCalledWith('/auth/password-reset/complete', { token: 'abc123', new_password: NEW_PW })
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.reason).toBe('password_reset')
  })

  it('兩次輸入不一樣或太短時不能送出', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(ACCOUNT as never)
    const { wrapper } = await setup('/reset-password#token=abc123')
    await wrapper.find('#reset-new-password').setValue(NEW_PW)
    await wrapper.find('#reset-confirm-password').setValue('something-else-123')
    expect(wrapper.text()).toContain('兩次輸入的新密碼不一樣')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
    await wrapper.find('#reset-new-password').setValue('short')
    await wrapper.find('#reset-confirm-password').setValue('short')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('連結失效時顯示後端的說明與回登入頁', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(410, { code: 'RESET_LINK_INVALID', reason: 'link_expired', message: '這個重設連結已過期（30 分鐘內有效），請總管理者重新寄一次。' }),
    )
    const { wrapper } = await setup('/reset-password#token=abc123')
    expect(wrapper.get('[data-test="reset-invalid"]').text()).toContain('已過期')
    expect(wrapper.find('#reset-new-password').exists()).toBe(false)
    expect(wrapper.text()).toContain('回登入頁')
  })

  it('網址沒有代碼（例如重新整理後）時請對方回信裡再點一次，不打 API', async () => {
    const post = vi.spyOn(api, 'post')
    const { wrapper } = await setup('/reset-password')
    expect(post).not.toHaveBeenCalled()
    expect(wrapper.get('[data-test="reset-invalid"]').text()).toContain('回到信裡再點一次連結')
  })

  it('連不上伺服器時可以再試一次', async () => {
    const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(ACCOUNT as never)
    const { wrapper } = await setup('/reset-password#token=abc123')
    expect(wrapper.text()).toContain('連不上伺服器')
    await wrapper.findAll('button').find(item => item.text() === '再試一次')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('ca@ivy.example')
  })
})

describe('路由與登入頁', () => {
  it('重設密碼頁不用登入，也不會先去恢復 session', async () => {
    setActivePinia(createPinia())
    const get = vi.spyOn(api, 'get')
    const router = createRouter({ history: createMemoryHistory(), routes })
    expect(await authGuard(router.resolve('/reset-password#token=abc') as never)).toBe(true)
    expect(get).not.toHaveBeenCalled()
  })

  it('登入頁說明密碼已更新', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: false } as never)
    const pinia = createPinia()
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/login', name: 'login', component: LoginView }] })
    await router.push('/login?reason=password_reset')
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('密碼已更新，請用新密碼登入')
  })
})
