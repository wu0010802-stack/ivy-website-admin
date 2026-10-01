import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import VisitSlotsView from '../views/VisitSlotsView.vue'
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
    const get = countsMock({ pending: 4, upcoming: 3, past: 2, cancelled: 1 })
    const { wrapper } = await mountView(VisitRequestsView, '/visit-requests')
    await flushPromises()
    const tabs = wrapper.findAll('.status-tab')
    expect(tabs.map(tab => tab.text().replace(/\s+/g, ''))).toEqual(['全部', '待處理4件', '預約正常3件', '時間已過2件', '已取消1件'])
    expect(tabs[0]!.attributes('aria-pressed')).toBe('true')
    await tabs[2]!.trigger('click')
    await flushPromises()
    const lists = get.mock.calls.map(call => String(call[0])).filter(path => path.startsWith('/admin/visit-requests?'))
    expect(lists.at(-1)).toContain('group=upcoming')
    expect(wrapper.findAll('.status-tab')[2]!.attributes('aria-pressed')).toBe('true')
  })

  it('縮小到單一校區時，數字也跟著帶校區條件重算', async () => {
    const get = countsMock({ pending: 0, upcoming: 3, past: 0, cancelled: 0 })
    const { wrapper } = await mountView(VisitRequestsView, '/visit-requests')
    wrapper.findAllComponents({ name: 'ElSelect' })[0]!.vm.$emit('update:modelValue', 'yihua')
    await flushPromises()
    const counts = get.mock.calls.map(call => String(call[0])).filter(path => path.startsWith('/admin/visit-requests/group-counts'))
    expect(counts.at(-1)).toContain('campus_key=yihua')
    expect(counts.at(-1)).not.toContain('group=')
  })
})

describe('時段依日期分組', () => {
  const slot = (id: string, slot_date: string, start_time: string, end_time: string) => ({ id, campus_key: 'yihua', slot_date, start_time, end_time, capacity: 3, booked_count: 0, closed: false })

  it('同一天的場次共用一個日期，已結束的場次不顯示開放中也不能再調整', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T12:00:00+08:00'))
    vi.spyOn(api, 'get').mockResolvedValue([
      slot('a', '2026-09-24', '09:30:00', '10:30:00'),
      slot('b', '2026-09-24', '14:00:00', '15:00:00'),
      slot('c', '2026-09-25', '09:30:00', '10:30:00'),
    ] as never)
    const { wrapper } = await mountView(VisitSlotsView, '/slots')
    await flushPromises()
    const days = wrapper.findAll('.slot-day')
    expect(days).toHaveLength(2)
    expect(days[0]!.find('.slot-day__date').text()).toContain('今天')
    const [past, upcoming] = days[0]!.findAll('.slot-row')
    expect(past!.classes()).toContain('is-past')
    expect(past!.text()).toContain('已結束')
    expect(past!.text()).not.toContain('關閉')
    expect(past!.find('.el-input-number').classes()).toContain('is-disabled')
    expect(upcoming!.text()).toContain('開放中')
    expect(wrapper.text()).toContain('期間內 3 場，2 場仍有名額')
  })
})
