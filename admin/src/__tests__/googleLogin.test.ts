import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import LoginView from '../views/LoginView.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
})

async function setup(path = '/login') {
  const pinia = createPinia()
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/login', name: 'login', component: LoginView },
    { path: '/', name: 'dashboard', component: { template: '<div />' } },
    { path: '/visit-requests', component: { template: '<div />' } },
  ] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(LoginView, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router, auth: useAuthStore(pinia) }
}

describe('Google 登入入口', () => {
  it('啟用時提供同源連結並保留原本目的頁，畫面沒有巢狀 form', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true })
    const { wrapper } = await setup('/login?redirect=%2Fvisit-requests%3Fstatus%3Dpending')
    const link = wrapper.get('a[href*="/auth/google/login"]')
    expect(link.text()).toContain('使用 Google 登入')
    expect(link.attributes('href')).toBe('/api/website/v1/auth/google/login?redirect=%2Fvisit-requests%3Fstatus%3Dpending')
    expect(wrapper.findAll('form')).toHaveLength(1)
  })

  it.each([false, 'offline'])('設定未啟用或讀取失敗時仍能用帳密登入：%s', async (mode) => {
    const get = vi.spyOn(api, 'get')
    if (mode === 'offline') get.mockRejectedValue(new Error('offline'))
    else get.mockResolvedValue({ google: false })
    const { wrapper, auth, router } = await setup()
    expect(wrapper.find('a[href*="/auth/google/login"]').exists()).toBe(false)
    const login = vi.spyOn(auth, 'login').mockResolvedValue()
    await wrapper.get('input[type="email"]').setValue('staff@gmail.com')
    await wrapper.get('input[type="password"]').setValue('password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(login).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenCalledWith('staff@gmail.com', 'password')
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it.each([
    ['cancelled', '已取消 Google 登入'],
    ['not_allowed', '尚未取得後台權限'],
    ['failed', 'Google 登入未完成'],
  ])('顯示 %s 的可操作提示', async (code, message) => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true })
    const { wrapper } = await setup(`/login?oauth_error=${code}`)
    expect(wrapper.text()).toContain(message)
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
  })

  it('未知錯誤值不回顯，站外 redirect 不帶入 Google 登入', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true })
    const { wrapper } = await setup('/login?oauth_error=private-token&redirect=%2F%2Fevil.example')
    expect(wrapper.text()).not.toContain('private-token')
    expect(wrapper.get('a[href*="/auth/google/login"]').attributes('href')).toBe('/api/website/v1/auth/google/login?redirect=%2F')
  })

  it('等待登入回應時重複提交只建立一次登入請求', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true })
    const { wrapper, auth, router } = await setup()
    let complete!: () => void
    const login = vi.spyOn(auth, 'login').mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
    await wrapper.get('input[type="email"]').setValue('staff@gmail.com')
    await wrapper.get('input[type="password"]').setValue('password')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(login).toHaveBeenCalledTimes(1)
    expect(wrapper.get('input[type="email"]').attributes('disabled')).toBeDefined()
    complete()
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('dashboard')
  })
})
