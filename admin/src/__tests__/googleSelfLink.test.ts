import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import LoginView from '../views/LoginView.vue'
import AccountView from '../views/AccountView.vue'
import { api, ApiError } from '../api/client'
import { browser } from '../api/oauth'
import { useAuthStore } from '../stores/auth'
import type { UserOut } from '../api/types'
import { testUser } from './fixtures'

// 2026-10-06 業主裁定：Google 跟 LINE 一樣，只能登入後在「我的帳號」自己綁定，不再用 Email 自動綁定。
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=abc&scope=openid&state=xyz'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
})

function staff(overrides: Partial<UserOut> = {}): UserOut {
  return testUser('campus_admin', { email: 'staff@ivy.example', campus_keys: ['renwu'], ...overrides })
}

async function mountAt(component: typeof LoginView, path: string, user?: UserOut) {
  const pinia = createPinia()
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/login', name: 'login', component: LoginView },
    { path: '/account', name: 'account', component: AccountView },
    { path: '/', name: 'dashboard', component: { template: '<div />' } },
    { path: '/:rest(.*)*', component: { template: '<div />' } },
  ] })
  await router.push(path)
  await router.isReady()
  const auth = useAuthStore(pinia)
  if (user) auth.user = user
  const wrapper = mount(component, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router, auth }
}

describe('我的帳號：綁定 Google', () => {
  it('未綁定時說明要在這裡綁定，按下後整頁前往 Google 授權', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true, line: false })
    const post = vi.spyOn(api, 'post').mockResolvedValue({ authorize_url: AUTHORIZE })
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => {})
    const { wrapper } = await mountAt(AccountView, '/account', staff())
    expect(wrapper.text()).not.toContain('相同 Email')
    expect(wrapper.text()).not.toContain('自動綁定')
    await wrapper.get('[data-test="google-link"]').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/auth/google/link')
    expect(assign).toHaveBeenCalledWith(AUTHORIZE)
  })

  it('後端回傳的網址不是 Google 授權端點時不前往', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true, line: false })
    vi.spyOn(api, 'post').mockResolvedValue({ authorize_url: 'https://evil.example/o/oauth2/v2/auth?x=1' })
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => {})
    const { wrapper } = await mountAt(AccountView, '/account', staff())
    await wrapper.get('[data-test="google-link"]').trigger('click')
    await flushPromises()
    expect(assign).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('無法開始綁定')
  })

  it('已在別處綁定時提示先解除', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true, line: false })
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, '此帳號已綁定 Google，請先解除綁定'))
    const { wrapper, auth } = await mountAt(AccountView, '/account', staff())
    await wrapper.get('[data-test="google-link"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('已經綁定 Google')
    expect(auth.user?.google_linked).toBe(true)
  })

  it('收到 REAUTH_REQUIRED 時請本人輸入目前的密碼，帶密碼重送', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true, line: false })
    const reauth = new ApiError(403, { code: 'REAUTH_REQUIRED', message: '為了安全，請輸入目前的密碼（或重新登入後 10 分鐘內）再變更登入方式' })
    const post = vi.spyOn(api, 'post').mockRejectedValueOnce(reauth).mockResolvedValueOnce({ authorize_url: AUTHORIZE })
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => {})
    const { wrapper } = await mountAt(AccountView, '/account', staff())
    await wrapper.get('[data-test="google-link"]').trigger('click')
    await flushPromises()
    expect(assign).not.toHaveBeenCalled()
    const found = wrapper.get('[data-test="reauth-password"]')
    await (found.element.tagName === 'INPUT' ? found : found.get('input')).setValue('staff-password-123')
    await wrapper.get('[data-test="reauth-submit"]').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenLastCalledWith('/auth/google/link', { current_password: 'staff-password-123' })
    expect(assign).toHaveBeenCalledWith(AUTHORIZE)
  })

  it.each([
    ['linked', '已綁定 Google'],
    ['cancelled', '已取消綁定'],
    ['in_use', '這個 Google 帳號已經綁定另一個後台帳號'],
    ['already', '已經綁定其他 Google'],
    ['failed', 'Google 綁定未完成'],
  ])('綁定結果 %s 顯示提示並清掉網址參數', async (result, message) => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true, line: false })
    const { wrapper, router } = await mountAt(AccountView, `/account?google_link=${result}`, staff({ google_linked: result === 'linked' }))
    expect(wrapper.text()).toContain(message)
    expect(router.currentRoute.value.query.google_link).toBeUndefined()
  })

  it('未知的結果值不回顯', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true, line: false })
    const { wrapper } = await mountAt(AccountView, '/account?google_link=private-token', staff())
    expect(wrapper.text()).not.toContain('private-token')
    expect(wrapper.find('.el-alert').exists()).toBe(false)
  })

  it('解除後說明要再綁定才能用 Google 登入，不再說同 Email 會自動綁回來', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true, line: false })
    vi.spyOn(api, 'delete').mockResolvedValue(undefined)
    const { wrapper, auth } = await mountAt(AccountView, '/account', staff({ google_linked: true }))
    expect(wrapper.text()).not.toContain('登出後再用 Google 登入一次')
    const popconfirms = wrapper.findAllComponents({ name: 'ElPopconfirm' })
    const googlePop = popconfirms.find(pop => String(pop.props('title')).includes('Google'))!
    expect(String(googlePop.props('title'))).not.toContain('同一個 Email')
    googlePop.vm.$emit('confirm', new MouseEvent('click'))
    await flushPromises()
    expect(auth.user?.google_linked).toBe(false)
    expect(wrapper.text()).toContain('已解除 Google 綁定')
    expect(wrapper.text()).not.toContain('會重新綁定')
    expect(wrapper.find('[data-test="google-link"]').exists()).toBe(true)
  })
})

describe('登入頁：未綁定的 Google 帳號', () => {
  it('說明要先用 Email 與密碼登入，到「我的帳號」綁定 Google', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true, line: false })
    const { wrapper } = await mountAt(LoginView, '/login?oauth_error=not_allowed')
    expect(wrapper.text()).toContain('到「我的帳號」綁定 Google')
  })
})
