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

  it('後端仍回 422 時也講同一句話', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, [{ msg: 'value is not a valid email address' }]))
    const wrapper = await mountLogin()
    await submit(wrapper, 'admin@localhost.test', 'secret-password')
    expect(wrapper.text()).toContain('請輸入完整的 Email')
    expect(wrapper.text()).not.toContain('422')
  })
})
