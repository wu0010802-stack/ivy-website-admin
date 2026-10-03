// 2026-10-03 使用者頁：重設密碼預設寄連結給本人設定；沒設定寄信時只能直接設定新密碼。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage } from 'element-plus'
import UsersView from '../views/UsersView.vue'
import { api, ApiError } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const other = testUser('campus_admin', { id: 'u2', email: 'ca@ivy.example', campus_keys: ['yihua'] })
const SENT = { sent_to: 'ca@ivy.example', expires_at: '2026-10-03T06:52:00Z', replaced_previous: false }

async function setup(passwordResetEmail: boolean) {
  const pinia = createPinia()
  const auth = useAuthStore(pinia)
  auth.user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid' })
  auth.features = { admissions: false, password_reset_email: passwordResetEmail }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/users')
  await router.isReady()
  const wrapper = mount(UsersView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
function button(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find(item => item.text() === text)
}
function openDialog(wrapper: VueWrapper) {
  return wrapper.findAllComponents({ name: 'ElDialog' }).find(dialog => dialog.props('modelValue'))!
}
function radio(wrapper: VueWrapper, text: string) {
  return openDialog(wrapper).findAllComponents({ name: 'ElRadio' }).find(item => item.text().includes(text))!
}
async function openReset(wrapper: VueWrapper) {
  await button(wrapper, '重設密碼')!.trigger('click')
  await flushPromises()
}

describe('寄重設密碼連結（2026-10-03）', () => {
  it('有寄信時預設寄連結；寄出後顯示寄到哪裡、幾點前有效，按完成才關', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([other] as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue(SENT as never)
    const wrapper = await setup(true)
    await openReset(wrapper)
    expect(radio(wrapper, '寄重設連結').classes()).toContain('is-checked')
    expect(openDialog(wrapper).find('input[aria-label="新密碼"]').exists()).toBe(false)
    await button(wrapper, '寄出重設連結')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/users/u2/password-reset-link')
    const sent = wrapper.get('[data-test="reset-link-sent"]')
    expect(sent.text()).toContain('已寄出重設連結到 ca@ivy.example')
    expect(sent.text()).toContain('10/03 14:52')
    expect(sent.text()).not.toContain('先前寄的連結已經失效')
    expect(openDialog(wrapper).props('closeOnClickModal')).toBe(false)
    await button(wrapper, '完成')!.trigger('click')
    await flushPromises()
    expect(wrapper.findAllComponents({ name: 'ElDialog' }).some(dialog => dialog.props('modelValue'))).toBe(false)
  })

  it('再寄一次時說明先前的連結已經失效', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([other] as never)
    vi.spyOn(api, 'post').mockResolvedValue({ ...SENT, replaced_previous: true } as never)
    const wrapper = await setup(true)
    await openReset(wrapper)
    await button(wrapper, '寄出重設連結')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="reset-link-sent"]').text()).toContain('先前寄的連結已經失效')
  })

  it('沒設定寄信時「寄重設連結」停用並說明，直接設定新密碼照舊', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([other] as never)
    const wrapper = await setup(false)
    await openReset(wrapper)
    expect(radio(wrapper, '寄重設連結').classes()).toContain('is-disabled')
    expect(radio(wrapper, '直接設定新密碼').classes()).toContain('is-checked')
    expect(wrapper.get('[data-test="reset-link-disabled"]').text()).toContain('尚未設定寄信')
    expect(openDialog(wrapper).find('input[aria-label="新密碼"]').exists()).toBe(true)
    expect(button(wrapper, '寄出重設連結')).toBeUndefined()
  })

  it('寄送失敗時說明原因，對話框留著，可以改用直接設定', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([other] as never)
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(502, { code: 'RESET_EMAIL_FAILED', message: '重設連結沒有寄出，請稍後再試，或改用「直接設定新密碼」', error_code: 'SMTPAuthenticationError' }),
    )
    const error = vi.spyOn(ElMessage, 'error')
    const wrapper = await setup(true)
    await openReset(wrapper)
    await button(wrapper, '寄出重設連結')!.trigger('click')
    await flushPromises()
    expect(error).toHaveBeenCalledWith(expect.objectContaining({
      message: '重設連結沒有寄出，請稍後再試，或改用「直接設定新密碼」（寄信伺服器帳號或密碼錯誤）',
    }))
    expect(wrapper.find('[data-test="reset-link-sent"]').exists()).toBe(false)
    await radio(wrapper, '直接設定新密碼').find('input').setValue(true)
    await flushPromises()
    expect(openDialog(wrapper).find('input[aria-label="新密碼"]').exists()).toBe(true)
  })
})
