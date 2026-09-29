import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import LoginView from '../views/LoginView.vue'
import { api, ApiError } from '../api/client'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

async function mountLogin() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)', name: 'dashboard', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/login'); await router.isReady()
  const wrapper = mount(LoginView, { global: { plugins: [createPinia(), router, ElementPlus] } })
  wrappers.push(wrapper)
  return wrapper
}

async function submit(wrapper: VueWrapper, email: string, password: string) {
  await wrapper.find('input[type="email"]').setValue(email)
  await wrapper.find('input[type="password"]').setValue(password)
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('登入頁的帳號格式', () => {
  it('只打帳號名稱時直接說要完整 Email，不送出也不顯示狀態碼', async () => {
    const post = vi.spyOn(api, 'post')
    const wrapper = await mountLogin()
    await submit(wrapper, 'admin', 'secret-password')
    expect(post).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('請輸入完整的 Email')
    expect(wrapper.text()).not.toContain('422')
  })

  it('空白送出時在各欄下方提示並指向錯誤說明，改了該欄就收掉', async () => {
    const post = vi.spyOn(api, 'post')
    const wrapper = await mountLogin()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
    expect(wrapper.get('#admin-email-error').text()).toBe('請輸入帳號（Email）')
    expect(wrapper.get('#current-password-error').text()).toBe('請輸入密碼')
    const email = wrapper.get('input[type="email"]')
    expect(email.attributes('aria-invalid')).toBe('true')
    expect(email.attributes('aria-describedby')).toBe('admin-email-error')
    await email.setValue('staff@ivy.example')
    expect(wrapper.find('#admin-email-error').exists()).toBe(false)
    expect(wrapper.find('#current-password-error').exists()).toBe(true)
  })

  it('後端仍回 422 時也講同一句話', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, [{ msg: 'value is not a valid email address' }]))
    const wrapper = await mountLogin()
    await submit(wrapper, 'admin@localhost.test', 'secret-password')
    expect(wrapper.text()).toContain('請輸入完整的 Email')
    expect(wrapper.text()).not.toContain('422')
  })
})

describe('密碼登入的帳號鎖與超長密碼（2026-09-29）', () => {
  it('429 說明這個帳號的密碼登入暫停 15 分鐘，並提示有開放的 Google／LINE', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true, line: true })
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(429, { code: 'LOGIN_LOCKED', message: '密碼錯誤次數過多，這個帳號的密碼登入暫停 15 分鐘' }))
    const wrapper = await mountLogin()
    await flushPromises()
    await submit(wrapper, 'staff@ivy.example', 'wrong-password-xx')
    expect(wrapper.text()).toContain('這個帳號的密碼登入暫停 15 分鐘，可改用 Google／LINE 登入')
    expect(wrapper.text()).not.toContain('5 分鐘後再試')
  })

  it('沒有開放 Google／LINE 時不提示改用', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: false })
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(429, { code: 'LOGIN_LOCKED', message: '密碼錯誤次數過多，這個帳號的密碼登入暫停 15 分鐘' }))
    const wrapper = await mountLogin()
    await flushPromises()
    await submit(wrapper, 'staff@ivy.example', 'wrong-password-xx')
    expect(wrapper.text()).toContain('密碼登入暫停 15 分鐘，請稍後再試')
    expect(wrapper.text()).not.toContain('改用')
  })

  it('來源限流或系統忙碌（LOGIN_RATE_LIMITED）不講成帳號鎖 15 分鐘，也不建議改用 Google／LINE', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: true, line: true })
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(429, { code: 'LOGIN_RATE_LIMITED', message: '嘗試太頻繁或系統忙碌，請稍候再試' }),
    )
    const wrapper = await mountLogin()
    await flushPromises()
    await submit(wrapper, 'staff@ivy.example', 'wrong-password-xx')
    expect(wrapper.text()).toContain('嘗試太頻繁或系統忙碌，請稍候再試')
    expect(wrapper.text()).not.toContain('15 分鐘')
    expect(wrapper.text()).not.toContain('改用')
  })

  it('密碼超過上限的 422 標在密碼欄，不誤報成 Email 格式', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(422, [{ loc: ['body', 'password'], msg: 'String should have at most 128 characters' }]),
    )
    const wrapper = await mountLogin()
    await submit(wrapper, 'staff@ivy.example', 'x'.repeat(200))
    expect(wrapper.get('#current-password-error').text()).toContain('密碼太長')
    expect(wrapper.find('#admin-email-error').exists()).toBe(false)
  })
})
