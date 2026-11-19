import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import LoginView from '../views/LoginView.vue'
import { api } from '../api/client'
import { testUser } from './fixtures'

// 登入頁「記住這台裝置」（2026-11-19）：勾了保持登入 30 天，帳密、Google、LINE 三種都適用。
const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

async function mountLogin(path = '/login') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)', name: 'dashboard', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path); await router.isReady()
  const wrapper = mount(LoginView, { global: { plugins: [createPinia(), router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

async function submit(wrapper: VueWrapper) {
  await wrapper.find('input[type="email"]').setValue('staff@ivy.example')
  await wrapper.find('input[type="password"]').setValue('test-password-123')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

const loggedIn = { csrf_token: 't', user: testUser('editor'), features: { admissions: false } }

describe('登入頁的「記住這台裝置」', () => {
  it('預設不勾，帳密登入送 remember: false', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: false })
    const post = vi.spyOn(api, 'post').mockResolvedValue(loggedIn as never)
    const wrapper = await mountLogin()
    const box = wrapper.get('[data-test="login-remember"] input[type="checkbox"]')
    expect((box.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.get('[data-test="login-remember"]').text()).toContain('記住這台裝置')
    await submit(wrapper)
    expect(post).toHaveBeenCalledWith('/auth/login', { email: 'staff@ivy.example', password: 'test-password-123', remember: false })
  })

  it('勾了之後帳密登入送 remember: true', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: false })
    const post = vi.spyOn(api, 'post').mockResolvedValue(loggedIn as never)
    const wrapper = await mountLogin()
    await wrapper.get('[data-test="login-remember"] input[type="checkbox"]').setValue(true)
    await submit(wrapper)
    expect(post).toHaveBeenCalledWith('/auth/login', { email: 'staff@ivy.example', password: 'test-password-123', remember: true })
  })

  it('勾了之後 Google、LINE 入口也帶 remember=1，取消勾選就拿掉', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true, line: true })
    const wrapper = await mountLogin('/login?redirect=%2Fvisit-requests')
    const google = () => wrapper.get('a[href*="/auth/google/login"]').attributes('href')
    const line = () => wrapper.get('a[href*="/auth/line/login"]').attributes('href')
    expect(google()).toBe('/api/website/v1/auth/google/login?redirect=%2Fvisit-requests')
    expect(line()).toBe('/api/website/v1/auth/line/login?redirect=%2Fvisit-requests')
    const box = wrapper.get('[data-test="login-remember"] input[type="checkbox"]')
    await box.setValue(true)
    expect(google()).toBe('/api/website/v1/auth/google/login?redirect=%2Fvisit-requests&remember=1')
    expect(line()).toBe('/api/website/v1/auth/line/login?redirect=%2Fvisit-requests&remember=1')
    await box.setValue(false)
    expect(line()).toBe('/api/website/v1/auth/line/login?redirect=%2Fvisit-requests')
  })
})
