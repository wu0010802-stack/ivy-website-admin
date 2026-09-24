import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import NotificationsView from '../views/NotificationsView.vue'
import CampusSelect from '../components/CampusSelect.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })
function notification(id: string, campus_key = 'yihua') {
  return { id, campus_key, kind: 'visit_request_created', payload: { parent_name: id }, created_at: '2026-09-22T00:00:00Z', read_at: null }
}
async function setup() {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: ['yihua', 'renwu'] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/notifications')
  await router.isReady()
  const wrapper = mount(NotificationsView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  return wrapper
}

describe('通知操作與回應競態', () => {
  it('切換校區後，舊通知回應不覆蓋新校區', async () => {
    let resolveOld!: (value: unknown[]) => void
    const old = new Promise<unknown[]>(resolve => { resolveOld = resolve })
    vi.spyOn(api, 'get').mockImplementation(url => {
      if (String(url).includes('reschedule-requests')) return Promise.resolve([]) as Promise<never>
      if (String(url).includes('renwu')) return Promise.resolve([notification('仁武新通知', 'renwu')]) as Promise<never>
      return old as Promise<never>
    })
    const wrapper = await setup()
    expect(wrapper.text()).toContain('正在讀取通知')
    expect(wrapper.text()).not.toContain('還沒有通知')
    wrapper.getComponent(CampusSelect).vm.$emit('update:modelValue', 'renwu')
    await flushPromises()
    expect(wrapper.text()).toContain('仁武新通知')
    resolveOld([notification('過時通知')])
    await flushPromises()
    expect(wrapper.text()).not.toContain('過時通知')
    expect(wrapper.text()).toContain('仁武新通知')
  })

  it('批次期間鎖住重複操作與校區切換，部分失敗保持未讀', async () => {
    vi.spyOn(api, 'get').mockImplementation(url => Promise.resolve(String(url).includes('reschedule-requests') ? [] : [notification('first'), notification('second')]) as Promise<never>)
    let resolveFirst!: () => void
    const first = new Promise<void>(resolve => { resolveFirst = resolve })
    const post = vi.spyOn(api, 'post').mockImplementationOnce(() => first as Promise<never>).mockRejectedValueOnce(new Error('offline'))
    const wrapper = await setup()
    await flushPromises()
    const bulk = wrapper.findAll('button').find(button => button.text() === '全部標記已讀')!
    await bulk.trigger('click')
    await bulk.trigger('click')
    wrapper.getComponent(CampusSelect).vm.$emit('update:modelValue', 'renwu')
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
    expect(wrapper.getComponent(CampusSelect).props('modelValue')).toBe('yihua')
    expect(wrapper.text()).toContain('標記中 0 / 2')
    resolveFirst()
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('已標記 1 則，1 則失敗')
    expect(wrapper.text()).toContain('2 則通知，1 則未讀')
  })
})
