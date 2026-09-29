import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import UsersView from '../views/UsersView.vue'
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
