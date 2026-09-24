import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import VisitSlotsView from '../views/VisitSlotsView.vue'
import { useAuthStore } from '../stores/auth'
import { useOpenRequestsStore } from '../stores/openRequests'
import { api } from '../api/client'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks(); vi.useRealTimers() })

async function mountView(component: object, path: string) {
  const pinia = createPinia()
  useAuthStore(pinia).user = { id: 'local-test', email: 'test@example.invalid', role: 'super_admin', is_active: true, campus_keys: [], line_linked: false }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  return { wrapper, pinia }
}

describe('案件列表的狀態頁籤', () => {
  it('一鍵切換狀態並帶給後端，待處理兩種狀態顯示側欄同源的數字', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const { wrapper, pinia } = await mountView(VisitRequestsView, '/visit-requests')
    useOpenRequestsStore(pinia).apply({ new_requests: 4, awaiting_confirmation: 2 })
    await flushPromises()
    const tabs = wrapper.findAll('.status-tab')
    // 「聯絡中」沒有側欄數字（不是待辦），只有兩種待處理狀態帶數字。
    expect(tabs.map(tab => tab.text())).toEqual(['全部', '待處理4 件', '聯絡中', '待園方確認2 件', '已確認', '已完成', '未到場', '已取消'])
    expect(tabs[0]!.attributes('aria-pressed')).toBe('true')
    await tabs[3]!.trigger('click')
    await flushPromises()
    expect(String(get.mock.calls.at(-1)![0])).toContain('status=pending_confirmation')
    expect(wrapper.findAll('.status-tab')[3]!.attributes('aria-pressed')).toBe('true')
  })

  it('縮小到單一校區時不顯示總數，避免和清單對不上', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const { wrapper, pinia } = await mountView(VisitRequestsView, '/visit-requests')
    useOpenRequestsStore(pinia).apply({ new_requests: 4, awaiting_confirmation: 2 })
    wrapper.findAllComponents({ name: 'ElSelect' })[0]!.vm.$emit('update:modelValue', 'yihua')
    await flushPromises()
    expect(wrapper.findAll('.status-tab__count')).toHaveLength(1) // 只剩「更多篩選」上的套用數
    expect(wrapper.get('.more-filters').text()).toContain('1')
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
