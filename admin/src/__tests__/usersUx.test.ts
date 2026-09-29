import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import UsersView from '../views/UsersView.vue'
import UserActions from '../components/UserActions.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

async function setup() {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: ['yihua'] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/users')
  await router.isReady()
  const wrapper = mount(UsersView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
function button(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find(item => item.text() === text)!
}

describe('使用者清單讀寫互斥', () => {
  it('重新整理尚未完成時停用新增入口，完成後才恢復', async () => {
    let resolveRefresh!: (value: unknown[]) => void
    const pending = new Promise<unknown[]>(resolve => { resolveRefresh = resolve })
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce([]).mockImplementationOnce(() => pending as Promise<never>)
    const post = vi.spyOn(api, 'post')
    const wrapper = await setup()
    expect(button(wrapper, '新增使用者').attributes('disabled')).toBeUndefined()
    await button(wrapper, '重新整理').trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(button(wrapper, '新增使用者').attributes('disabled')).toBeDefined()
    await button(wrapper, '新增使用者').trigger('click')
    expect(post).not.toHaveBeenCalled()
    expect(wrapper.findAllComponents({ name: 'ElDialog' }).some(dialog => dialog.props('modelValue'))).toBe(false)
    resolveRefresh([])
    await flushPromises()
    expect(button(wrapper, '新增使用者').attributes('disabled')).toBeUndefined()
    await button(wrapper, '新增使用者').trigger('click')
    await flushPromises()
    expect(wrapper.findAllComponents({ name: 'ElDialog' }).some(dialog => dialog.props('modelValue'))).toBe(true)
  })
})

describe('解除別人的 Google／LINE 綁定並登出（2026-09-29）', () => {
  it('只對別人且有綁定的帳號顯示，成功後用回傳的資料更新該列', async () => {
    const me = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', line_linked: true })
    const other = testUser('campus_admin', { id: 'other', email: 'other@ivy.example', campus_keys: ['yihua'], line_linked: true, google_linked: true })
    const plain = testUser('editor', { id: 'plain', email: 'plain@ivy.example', campus_keys: ['yihua'] })
    vi.spyOn(api, 'get').mockResolvedValue([me, other, plain])
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ...other, line_linked: false, google_linked: false })
    const wrapper = await setup()
    // 桌機表格與手機清單各一份。
    expect(wrapper.findAll('[data-test="clear-external-logins"]')).toHaveLength(2)
    const actions = wrapper.findAllComponents(UserActions).find(item => item.props('user').id === 'other')!
    actions.vm.$emit('clearLogins', other)
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/users/other/clear-external-logins')
    expect(wrapper.findAll('[data-test="clear-external-logins"]')).toHaveLength(0)
  })

  it('自己的列不提供（要到「我的帳號」操作）', async () => {
    const me = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', line_linked: true, google_linked: true })
    vi.spyOn(api, 'get').mockResolvedValue([me])
    const wrapper = await setup()
    expect(wrapper.find('[data-test="clear-external-logins"]').exists()).toBe(false)
    expect(button(wrapper, '重設密碼')).toBeUndefined()
  })
})

describe('新密碼長度提示（bcrypt 72 bytes 上限）', () => {
  it('超過 72 bytes 的中文密碼不能建立，並說明上限', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([])
    const post = vi.spyOn(api, 'post')
    const wrapper = await setup()
    await button(wrapper, '新增使用者').trigger('click')
    await flushPromises()
    await wrapper.find('input[type="email"]').setValue('new@ivy.example')
    await wrapper.find('input[autocomplete="new-password"]').setValue('常'.repeat(25))
    expect(wrapper.text()).toContain('最多 72 bytes（中文約 24 字）')
    expect(wrapper.text()).toContain('超過 72 bytes')
    expect(button(wrapper, '建立帳號').attributes('disabled')).toBeDefined()
    await wrapper.find('input[autocomplete="new-password"]').setValue('常'.repeat(24))
    expect(wrapper.text()).not.toContain('超過 72 bytes')
    expect(post).not.toHaveBeenCalled()
  })
})
