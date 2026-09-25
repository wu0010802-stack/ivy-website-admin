// B03 審查意見：改規則後舊時段跟著調整、只停止新預約不必關閉時段、手機上的
// 日期區間面板、存預約設定會讓填表中的家長重新確認。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import VisitSchedulePanel from '../components/VisitSchedulePanel.vue'
import VisitSlotsView from '../views/VisitSlotsView.vue'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import AnalyticsView from '../views/AnalyticsView.vue'
import BookingSettingsView from '../views/BookingSettingsView.vue'
import { api } from '../api/client'
import { auditMetadataSummary, slotClosedLabel, slotSyncLines } from '../api/labels'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function mountAt(component: unknown, path: string, props: Record<string, unknown> = {}): Promise<VueWrapper> {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: [] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    props,
    global: {
      plugins: [pinia, router, ElementPlus],
      stubs: { SiteTrafficPanel: true },
      provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) },
    },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const RULE = { weekday: 2, start_time: '09:00:00', end_time: '10:30:00', slot_minutes: 30, capacity: 2 }
const schedule = (extra: object = {}) => ({ campus_key: 'yihua', min_lead_hours: 24, max_advance_days: 60, rules: [RULE], exceptions: [], rules_extended_on: null, version: 4, ...extra })

describe('改每週規則：還沒有人預約的時段跟著調整', () => {
  it('存檔後說明調整了哪些時段，已排入家長的場次留下提醒', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(schedule() as never)
    const put = vi.spyOn(api, 'put').mockResolvedValue(schedule({
      rules: [{ ...RULE, slot_minutes: 45 }],
      version: 5,
      slot_sync: { removed: 2, closed: 1, reopened: 0, capacity_updated: 1, kept_booked: 1 },
    }) as never)
    const success = vi.spyOn(ElMessage, 'success')
    const wrapper = await mountAt(VisitSchedulePanel, '/', { campusKey: 'yihua', canManage: true })
    wrapper.findAllComponents({ name: 'ElInputNumber' }).find(item => item.find('input[aria-label="每場分鐘"]').exists())!.vm.$emit('update:modelValue', 45)
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '儲存規則')!.trigger('click')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/visit-schedule/yihua', expect.objectContaining({ expected_version: 4 }))
    const message = String(success.mock.calls.at(-1)![0])
    expect(message).toContain('還沒有人預約的時段已跟著調整：3 場不符合新規則的時段不再開放、1 場名額改成新規則')
    expect(message).not.toContain('已存在的不會變動')
    expect(wrapper.emitted('slots-changed')).toBeTruthy()
    expect(wrapper.text()).toContain('1 場不在新規則內，但已有家長排入')
    expect(wrapper.text()).toContain('把名額調成已占用的組數')
    expect(wrapper.text()).toContain('改規則時，還沒有人預約的時段會跟著調整')
  })

  it('沒有要調整的時段就不多說，也不重新讀時段清單', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(schedule() as never)
    vi.spyOn(api, 'put').mockResolvedValue(schedule({
      min_lead_hours: 48, version: 5, slot_sync: { removed: 0, closed: 0, reopened: 0, capacity_updated: 0, kept_booked: 0 },
    }) as never)
    const success = vi.spyOn(ElMessage, 'success')
    const wrapper = await mountAt(VisitSchedulePanel, '/', { campusKey: 'yihua', canManage: true })
    wrapper.findAllComponents({ name: 'ElInputNumber' })[0]!.vm.$emit('update:modelValue', 48)
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '儲存規則')!.trigger('click')
    await flushPromises()
    expect(String(success.mock.calls.at(-1)![0])).not.toContain('跟著調整')
    expect(wrapper.emitted('slots-changed')).toBeFalsy()
    expect(wrapper.text()).not.toContain('已有家長排入')
  })

  it('中文標籤：規則變更停用的時段、操作紀錄的時段調整', () => {
    expect(slotClosedLabel('rule')).toBe('不在開放規則內')
    expect(slotClosedLabel('exception')).toBe('休假日關閉')
    expect(slotClosedLabel(null)).toBe('已關閉')
    expect(slotSyncLines({ removed: 0, closed: 0, reopened: 2, capacity_updated: 0, kept_booked: 0 })).toEqual(['重新開放 2 場'])
    expect(auditMetadataSummary({ rule_count: 1, slot_sync: { removed: 3, closed: 0, reopened: 0, capacity_updated: 0, kept_booked: 1 } }))
      .toBe('rule_count=1，時段：3 場不符合新規則的時段不再開放、1 場已有家長排入，維持原樣')
  })
})

describe('時段清單：只想停止新預約不用關閉時段', () => {
  const slot = (id: string, extra: object) => ({ id, campus_key: 'yihua', slot_date: '2099-01-06', start_time: '10:00:00', end_time: '11:00:00', capacity: 3, booked_count: 0, closed: false, closed_source: null, version: 2, ...extra })

  function mockSlots() {
    vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).startsWith('/admin/visit-schedule/')) return schedule({ rules: [] }) as never
      return [slot('booked', { booked_count: 2 }), slot('retired', { slot_date: '2099-01-07', closed: true, closed_source: 'rule' })] as never
    })
  }

  it('選「只停止新預約」把名額調成已占用的組數，不關閉、不列入待人工處理', async () => {
    mockSlots()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({} as never)
    const success = vi.spyOn(ElMessage, 'success')
    const wrapper = await mountAt(VisitSlotsView, '/slots')
    expect(wrapper.text()).toContain('不在開放規則內')
    expect(wrapper.text()).toContain('只想停止新預約，把名額調成已占用的組數')
    const close = wrapper.findAll('.slot-row').find(row => row.text().includes('開放中'))!.findAll('button').find(button => button.text() === '關閉')!
    await close.trigger('click')
    await flushPromises()
    const [text, , options] = confirm.mock.calls[0]!
    expect(String(text)).toContain('名額會改成 2 組')
    expect(options).toMatchObject({ confirmButtonText: '關閉時段', cancelButtonText: '只停止新預約', distinguishCancelAndClose: true })
    expect(patch).toHaveBeenCalledWith('/admin/slots/booked', { capacity: 2, expected_version: 2 })
    expect(patch).not.toHaveBeenCalledWith('/admin/slots/booked', expect.objectContaining({ closed: true }))
    expect(String(success.mock.calls.at(-1)![0])).toContain('已排入的家長照常參觀')
    expect(wrapper.text()).not.toContain('關閉的時段還有家長排入')
  })

  it('按叉叉或 Esc 關掉對話框什麼都不改', async () => {
    mockSlots()
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('close')
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({} as never)
    const wrapper = await mountAt(VisitSlotsView, '/slots')
    const close = wrapper.findAll('.slot-row').find(row => row.text().includes('開放中'))!.findAll('button').find(button => button.text() === '關閉')!
    await close.trigger('click')
    await flushPromises()
    expect(patch).not.toHaveBeenCalled()
  })
})

describe('手機上的日期區間面板只顯示一個月', () => {
  function stubViewport(narrow: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: narrow && query === '(max-width: 720px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  }
  const rangePicker = (wrapper: VueWrapper) =>
    wrapper.findAllComponents({ name: 'ElDatePicker' }).find(picker => picker.props('type') === 'daterange')!

  it('案件清單的送出日期：390px 用單月面板，桌機維持雙月', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    stubViewport(true)
    expect(rangePicker(await mountAt(VisitRequestsView, '/visit-requests')).props('singlePanel')).toBe(true)
    stubViewport(false)
    expect(rangePicker(await mountAt(VisitRequestsView, '/visit-requests')).props('singlePanel')).toBe(false)
  })

  it('依規則產生時段與成效統計的自訂區間也一樣', async () => {
    stubViewport(true)
    vi.spyOn(api, 'get').mockResolvedValue(schedule() as never)
    expect(rangePicker(await mountAt(VisitSchedulePanel, '/', { campusKey: 'yihua', canManage: true })).props('singlePanel')).toBe(true)
    vi.spyOn(api, 'get').mockResolvedValue({
      campus_key: 'yihua', date_from: null, date_to: null, counts: {}, cancelled_by_reason: {},
      by_source: [], by_referral: [], clicks_by_entry: [], unassigned_clicks: {},
    } as never)
    const analytics = await mountAt(AnalyticsView, '/analytics')
    const period = analytics.findAllComponents({ name: 'ElSelect' }).find(item => item.attributes('aria-label') === '期間' || item.props('ariaLabel') === '期間')!
    period.vm.$emit('update:modelValue', 'custom')
    await flushPromises()
    expect(rangePicker(analytics).props('singlePanel')).toBe(true)
  })
})

describe('預約設定存檔會讓填表中的家長重新確認', () => {
  const config = { campus_key: 'yihua', version: 3, mode: 'slots', line_url: null, phone: null, external_url: null, message: null, slots_auto_confirm: false, parent_change_deadline_hours: 48 }

  it('收表單的方式在存檔按鈕旁說明', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(config as never)
    const wrapper = await mountAt(BookingSettingsView, '/booking')
    expect(wrapper.get('.live-note').text()).toContain('正在官網填預約表的家長送出時，會被請確認一次再送')
  })

  it('電話、LINE 等不收表單的方式不提', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ...config, mode: 'phone', phone: '07-000-0000' } as never)
    const wrapper = await mountAt(BookingSettingsView, '/booking')
    expect(wrapper.get('.live-note').text()).not.toContain('填預約表')
  })
})
