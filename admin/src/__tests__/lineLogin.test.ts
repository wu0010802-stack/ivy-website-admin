import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import LoginView from '../views/LoginView.vue'
import AccountView from '../views/AccountView.vue'
import AdminSidebar from '../components/AdminSidebar.vue'
import { api, ApiError } from '../api/client'
import { browser } from '../api/oauth'
import { useAuthStore } from '../stores/auth'
import type { UserOut } from '../api/types'
import { testUser } from './fixtures'

const AUTHORIZE = 'https://access.line.me/oauth2/v2.1/authorize?client_id=1234567890&state=abc'

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

describe('登入頁的 LINE 入口', () => {
  it('啟用時提供同源連結、保留目的頁，並提示要先綁定', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: true })
    const { wrapper } = await mountAt(LoginView, '/login?redirect=%2Fvisit-requests%3Fstatus%3Dpending')
    const link = wrapper.get('a[href*="/auth/line/login"]')
    expect(link.text()).toContain('使用 LINE 登入')
    expect(link.attributes('href')).toBe('/api/website/v1/auth/line/login?redirect=%2Fvisit-requests%3Fstatus%3Dpending')
    expect(wrapper.text()).toContain('我的帳號')
    expect(wrapper.find('a[href*="/auth/google/login"]').exists()).toBe(false)
    expect(wrapper.findAll('form')).toHaveLength(1)
  })

  it('Google 與 LINE 都啟用時兩個入口並列', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true, line: true })
    const { wrapper } = await mountAt(LoginView, '/login')
    expect(wrapper.find('a[href*="/auth/google/login"]').exists()).toBe(true)
    expect(wrapper.find('a[href*="/auth/line/login"]').exists()).toBe(true)
    expect(wrapper.findAll('.login__divider')).toHaveLength(1)
  })

  it('未啟用 LINE 時不顯示入口', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true, line: false })
    const { wrapper } = await mountAt(LoginView, '/login')
    expect(wrapper.find('a[href*="/auth/line/login"]').exists()).toBe(false)
  })

  it.each([
    ['line_cancelled', '已取消 LINE 登入'],
    ['line_not_allowed', '尚未綁定後台帳號'],
    ['line_failed', 'LINE 登入未完成'],
    ['line_unavailable', 'LINE 登入尚未啟用'],
  ])('顯示 %s 的可操作提示', async (code, message) => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: true })
    const { wrapper } = await mountAt(LoginView, `/login?oauth_error=${code}`)
    expect(wrapper.text()).toContain(message)
    expect(wrapper.text()).not.toContain('Google')
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
  })
})

describe('我的帳號：LINE 綁定', () => {
  it('顯示帳號資料，按綁定後整頁前往 LINE 授權', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: true })
    const post = vi.spyOn(api, 'post').mockResolvedValue({ authorize_url: AUTHORIZE })
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => {})
    const { wrapper } = await mountAt(AccountView, '/account', staff())
    expect(wrapper.text()).toContain('staff@ivy.example')
    expect(wrapper.text()).toContain('校區管理者')
    expect(wrapper.text()).toContain('仁武')
    expect(wrapper.text()).toContain('尚未綁定')
    await wrapper.get('[data-test="line-link"]').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/auth/line/link')
    expect(assign).toHaveBeenCalledWith(AUTHORIZE)
  })

  it('後端回傳的網址不是 LINE 授權端點時不前往', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: true })
    vi.spyOn(api, 'post').mockResolvedValue({ authorize_url: 'https://evil.example/oauth2/v2.1/authorize?x=1' })
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => {})
    const { wrapper } = await mountAt(AccountView, '/account', staff())
    await wrapper.get('[data-test="line-link"]').trigger('click')
    await flushPromises()
    expect(assign).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('無法開始綁定')
  })

  it('已在別處綁定時提示先解除', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: true })
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, '此帳號已綁定 LINE，請先解除綁定'))
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => {})
    const { wrapper } = await mountAt(AccountView, '/account', staff())
    await wrapper.get('[data-test="line-link"]').trigger('click')
    await flushPromises()
    expect(assign).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('已經綁定 LINE')
  })

  it('已綁定時可以解除，解除後回到可綁定狀態', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: true })
    const remove = vi.spyOn(api, 'delete').mockResolvedValue(undefined)
    const { wrapper, auth } = await mountAt(AccountView, '/account', staff({ line_linked: true }))
    expect(wrapper.text()).toContain('已綁定')
    expect(wrapper.find('[data-test="line-link"]').exists()).toBe(false)
    await wrapper.getComponent({ name: 'ElPopconfirm' }).vm.$emit('confirm', new MouseEvent('click'))
    await flushPromises()
    expect(remove).toHaveBeenCalledWith('/auth/line/link')
    expect(auth.user?.line_linked).toBe(false)
    expect(wrapper.find('[data-test="line-link"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('已解除 LINE 綁定')
  })

  it('LINE 未啟用時不提供綁定，但已綁定的人仍可解除', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: false })
    const { wrapper } = await mountAt(AccountView, '/account', staff())
    expect(wrapper.find('[data-test="line-link"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('LINE 登入尚未啟用')
    const linked = await mountAt(AccountView, '/account', staff({ line_linked: true }))
    expect(linked.wrapper.findComponent({ name: 'ElPopconfirm' }).exists()).toBe(true)
  })

  it.each([
    ['linked', '已綁定 LINE'],
    ['cancelled', '已取消綁定'],
    ['in_use', '已經綁定另一個後台帳號'],
    ['already', '請先解除綁定'],
    ['failed', 'LINE 綁定未完成'],
  ])('綁定結果 %s 顯示提示並清掉網址參數', async (result, message) => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: true })
    const { wrapper, router } = await mountAt(AccountView, `/account?line_link=${result}`, staff({ line_linked: result === 'linked' }))
    expect(wrapper.text()).toContain(message)
    expect(router.currentRoute.value.query.line_link).toBeUndefined()
  })

  it('未知的結果值不回顯', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: true })
    const { wrapper } = await mountAt(AccountView, '/account?line_link=private-token', staff())
    expect(wrapper.text()).not.toContain('private-token')
    expect(wrapper.find('.el-alert').exists()).toBe(false)
  })
})

describe('側欄的帳號入口', () => {
  it('使用者區塊連到我的帳號，所在頁時標示為目前頁面', async () => {
    const { wrapper } = await mountAt(AdminSidebar as unknown as typeof LoginView, '/account', staff())
    const link = wrapper.get('a.sidebar__account')
    expect(link.attributes('href')).toBe('/account')
    expect(link.attributes('aria-label')).toBe('我的帳號：staff@ivy.example')
    expect(link.attributes('aria-current')).toBe('page')
    expect(wrapper.find('.sidebar__nav a[href="/account"]').exists()).toBe(false)
  })
})
