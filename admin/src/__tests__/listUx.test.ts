import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import { useAuthStore } from '../stores/auth'
import { api } from '../api/client'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks(); vi.useRealTimers() })

async function mountView(component: object, path: string) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: [] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  return { wrapper, pinia }
}

describe('案件列表的分組頁籤', () => {
  const countsMock = (counts: Record<string, number>) => vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
    (path.startsWith('/admin/visit-requests/group-counts') ? counts : []) as never)

  it('一鍵切換分組並帶給後端，數字來自 group-counts', async () => {
    const get = countsMock({ upcoming: 3, past: 2, cancelled: 1 })
    const { wrapper } = await mountView(VisitRequestsView, '/visit-requests')
    await flushPromises()
    const tabs = wrapper.findAll('.status-tab')
    expect(tabs.map(tab => tab.text().replace(/\s+/g, ''))).toEqual(['全部', '預約正常3件', '時間已過2件', '已取消1件'])
    // 2026-10-05：沒有「待處理」頁籤，只剩全部＋三組。
    expect(tabs.map(tab => tab.text()).join('')).not.toContain('待處理')
    expect(tabs[0]!.attributes('aria-pressed')).toBe('true')
    await tabs[1]!.trigger('click')
    await flushPromises()
    const lists = get.mock.calls.map(call => String(call[0])).filter(path => path.startsWith('/admin/visit-requests?'))
    expect(lists.at(-1)).toContain('group=upcoming')
    expect(wrapper.findAll('.status-tab')[1]!.attributes('aria-pressed')).toBe('true')
  })

  it('縮小到單一校區時，數字也跟著帶校區條件重算', async () => {
    const get = countsMock({ upcoming: 3, past: 0, cancelled: 0 })
    const { wrapper } = await mountView(VisitRequestsView, '/visit-requests')
    wrapper.findAllComponents({ name: 'ElSelect' })[0]!.vm.$emit('update:modelValue', 'yihua')
    await flushPromises()
    const counts = get.mock.calls.map(call => String(call[0])).filter(path => path.startsWith('/admin/visit-requests/group-counts'))
    expect(counts.at(-1)).toContain('campus_key=yihua')
    expect(counts.at(-1)).not.toContain('group=')
  })
})
