import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey, type Router } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import VisitSlotsView from '../views/VisitSlotsView.vue'
import DashboardView from '../views/DashboardView.vue'
import BookingSettingsView from '../views/BookingSettingsView.vue'
import VisitSchedulePanel from '../components/VisitSchedulePanel.vue'
import CampusStatusCard from '../components/CampusStatusCard.vue'
import ParentAccessLinkPanel from '../components/ParentAccessLinkPanel.vue'
import { api } from '../api/client'
import { AUDIT_ACTION_LABELS, attentionListPath, parentDeadlineLabel } from '../api/labels'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

async function mountAt(component: unknown, path: string, props: Record<string, unknown> = {}): Promise<{ wrapper: VueWrapper; router: Router }> {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: [] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    props,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

// 案件清單的最後一次查詢（同頁還會讀承辦人清單）。
function lastListQuery(get: { mock: { calls: unknown[][] } }): URLSearchParams {
  const calls = get.mock.calls.map(call => String(call[0])).filter(path => path.startsWith('/admin/visit-requests?'))
  return new URLSearchParams(calls.at(-1)!.split('?')[1])
}

describe('中文標籤與連結', () => {
  it('期限整天數時講天，連結帶校區', () => {
    expect(parentDeadlineLabel(24)).toBe('參觀前 24 小時')
    expect(parentDeadlineLabel(36)).toBe('參觀前 36 小時')
    expect(parentDeadlineLabel(72)).toBe('參觀前 3 天')
    expect(attentionListPath()).toBe('/visit-requests?attention=1')
    expect(attentionListPath('yihua')).toBe('/visit-requests?attention=1&campus=yihua')
    for (const action of ['visit_exception.create', 'visit_exception.delete', 'visit_schedule.update', 'visit_slots.generate', 'campus.deactivate']) {
      expect(AUDIT_ACTION_LABELS[action]).toBeTruthy()
    }
  })
})

describe('案件清單：待人工處理、送出日期與依篩選匯出', () => {
  it('從提示連過來會帶校區與待人工處理，並說明這是哪些案件', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const { wrapper } = await mountAt(VisitRequestsView, '/visit-requests?attention=1&campus=yihua')
    const query = lastListQuery(get)
    expect(query.get('needs_attention')).toBe('true')
    expect(query.get('campus_key')).toBe('yihua')
    expect(wrapper.text()).toContain('待人工處理的案件')
    expect(wrapper.text()).toContain('沒有待人工處理的案件')
  })

  it('送出日期區間帶給後端，清除篩選一起清掉', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const { wrapper } = await mountAt(VisitRequestsView, '/visit-requests')
    wrapper.findComponent({ name: 'ElDatePicker' }).vm.$emit('update:modelValue', ['2026-09-01', '2026-09-07'])
    await flushPromises()
    let query = lastListQuery(get)
    expect(query.get('created_from')).toBe('2026-09-01')
    expect(query.get('created_to')).toBe('2026-09-07')
    expect(query.get('page')).toBe('1')
    expect(wrapper.get('.more-filters').text()).toContain('1')
    await wrapper.findAll('button').find(button => button.text() === '清除篩選')!.trigger('click')
    await flushPromises()
    query = lastListQuery(get)
    expect(query.has('created_from')).toBe(false)
  })

  it('匯出送出畫面上全部的篩選（不含分頁），按鈕旁講清楚範圍', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { wrapper } = await mountAt(VisitRequestsView, '/visit-requests?status=confirmed&attention=1')
    expect(wrapper.get('#export-scope').text()).toContain('目前篩選的全部結果')
    wrapper.findComponent({ name: 'ElDatePicker' }).vm.$emit('update:modelValue', ['2026-09-01', '2026-09-07'])
    await wrapper.get('input[aria-label="搜尋家長／孩子姓名、電話或 Email"]').setValue('王')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '匯出 CSV')!.trigger('click')
    const url = String(open.mock.calls[0]![0])
    expect(url.startsWith('/api/website/v1/admin/visit-requests/export?')).toBe(true)
    const query = new URLSearchParams(url.split('?')[1])
    expect(Object.fromEntries(query)).toEqual({
      status: 'confirmed', q: '王', created_from: '2026-09-01', created_to: '2026-09-07', needs_attention: 'true',
    })

    await wrapper.findAll('button').find(button => button.text() === '清除篩選')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('#export-scope').text()).toContain('可見校區的全部案件')
  })
})

describe('待人工處理的入口', () => {
  it('總覽列出待辦並連到篩選後的清單', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      today_visits: 0, today_visit_list: [], new_requests: 0, awaiting_confirmation: 0, pending_reschedule_requests: 0,
      needs_attention: 2, pending_follow_up: 0, pending_publish: 0, pending_publish_kinds: [], pending_review: 0,
      campuses_without_active_booking: [], failed_notifications: 0,
    } as never)
    const { wrapper } = await mountAt(DashboardView, '/')
    const task = wrapper.findAll('a.task').find(link => link.text().includes('家長還要來'))!
    expect(task.text()).toContain('2')
    expect(task.attributes('href')).toBe('/visit-requests?attention=1')
    expect(wrapper.text()).not.toContain('目前沒有待處理事項')
  })

  it('設休假日當天還有家長要來時，留下連到待人工處理的提醒', async () => {
    const schedule = { campus_key: 'yihua', min_lead_hours: 24, max_advance_days: 60, rules: [], exceptions: [], rules_extended_on: null }
    vi.spyOn(api, 'get').mockResolvedValue(schedule as never)
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue({ action: 'confirm' } as never)
    vi.spyOn(api, 'post').mockResolvedValue({ id: 'e1', exception_date: '2099-01-07', reason: null, closed_slots: 3, affected_requests: 2 } as never)
    const { wrapper } = await mountAt(VisitSchedulePanel, '/', { campusKey: 'yihua', canManage: true })
    await wrapper.findAll('button').find(button => button.text() === '設為休假')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('還有 2 組家庭已排入')
    // 待確認的案件沒有「改期」按鈕，要告訴櫃台改走退回聯絡中。
    expect(wrapper.text()).toContain('已確認的用「改期（換時段）」')
    expect(wrapper.text()).toContain('待園方確認的先「退回聯絡中」再重新排入')
    expect(wrapper.find('a[href="/visit-requests?attention=1&campus=yihua"]').exists()).toBe(true)
  })

  it('取消休假告訴園方重開與補上幾場', async () => {
    const schedule = { campus_key: 'yihua', min_lead_hours: 24, max_advance_days: 60, rules: [], exceptions: [{ id: 'e1', exception_date: '2099-01-07', reason: '研習' }], rules_extended_on: '2099-01-01' }
    vi.spyOn(api, 'get').mockResolvedValue(schedule as never)
    const del = vi.spyOn(api, 'delete').mockResolvedValue({ reopened_slots: 2, created_slots: 1 } as never)
    const success = vi.spyOn(ElMessage, 'success')
    const { wrapper } = await mountAt(VisitSchedulePanel, '/', { campusKey: 'yihua', canManage: true })
    await wrapper.findAll('button').find(button => button.text() === '取消休假')!.trigger('click')
    await flushPromises()
    expect(del).toHaveBeenCalledWith('/admin/visit-schedule/yihua/exceptions/e1')
    expect(String(success.mock.calls.at(-1)![0])).toContain('重新開放 2 場、依規則補上 1 場')
    expect(wrapper.text()).toContain('系統每天依規則把時段補到最遠開放天數')
  })

  it('關閉還有人排入的時段後可以直接去聯絡；休假日關的標成休假日關閉', async () => {
    const slot = (id: string, extra: object) => ({ id, campus_key: 'yihua', slot_date: '2099-01-06', start_time: '10:00:00', end_time: '11:00:00', capacity: 3, booked_count: 0, closed: false, closed_source: null, ...extra })
    vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).startsWith('/admin/visit-schedule/')) return { campus_key: 'yihua', min_lead_hours: 24, max_advance_days: 60, rules: [], exceptions: [] } as never
      return [slot('booked', { booked_count: 2 }), slot('holiday', { slot_date: '2099-01-07', closed: true, closed_source: 'exception' })] as never
    })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue({ action: 'confirm' } as never)
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({} as never)
    const { wrapper } = await mountAt(VisitSlotsView, '/slots')
    expect(wrapper.text()).toContain('休假日關閉')
    const close = wrapper.findAll('.slot-row').find(row => row.text().includes('開放中'))!.findAll('button').find(button => button.text() === '關閉')!
    await close.trigger('click')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/slots/booked', { closed: true })
    expect(wrapper.text()).toContain('還有 2 組占用名額')
    expect(wrapper.find('a[href="/visit-requests?attention=1&campus=yihua"]').exists()).toBe(true)
  })

  it('停用中的分校連到該校待人工處理的案件', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ key: 'yihua', name: '義華', active: false, deactivated_at: null, deactivated_reason: null } as never)
    const { wrapper, router } = await mountAt(CampusStatusCard, '/booking', { campusKey: 'yihua' })
    await wrapper.findAll('button').find(button => button.text() === '看待人工處理的案件')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/visit-requests?attention=1&campus=yihua')
  })
})

describe('家長線上取消／改期期限', () => {
  const deadlineInput = (wrapper: VueWrapper) =>
    wrapper.findAllComponents({ name: 'ElInputNumber' }).find(item => item.find('input[aria-label="參觀前幾小時截止"]').exists())!
  const config = { campus_key: 'yihua', version: 3, mode: 'slots', line_url: null, phone: null, external_url: null, message: null, slots_auto_confirm: false, parent_change_deadline_hours: 48 }

  it('各校預約方式可以設定，存檔一起送出', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(config as never)
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...config, version: 4, parent_change_deadline_hours: 72 } as never)
    const { wrapper } = await mountAt(BookingSettingsView, '/booking')
    expect(wrapper.text()).toContain('最晚到參觀前 2 天')
    const input = deadlineInput(wrapper)
    input.vm.$emit('update:modelValue', 72)
    await flushPromises()
    expect(wrapper.text()).toContain('最晚到參觀前 3 天')
    await wrapper.findAll('button').find(button => button.text() === '儲存並套用到官網')!.trigger('click')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/booking-config/yihua', expect.objectContaining({ parent_change_deadline_hours: 72, expected_version: 3 }))
  })

  it('清空期限時不能存檔', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(config as never)
    const patch = vi.spyOn(api, 'patch')
    const { wrapper } = await mountAt(BookingSettingsView, '/booking')
    const input = deadlineInput(wrapper)
    input.vm.$emit('update:modelValue', null)
    await flushPromises()
    const save = wrapper.findAll('button').find(button => button.text() === '儲存並套用到官網')!
    expect(save.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('請填 1 到 336 小時')
    await save.trigger('click')
    expect(patch).not.toHaveBeenCalled()
  })

  it('案件的家長連結說明用該校的期限', async () => {
    const { wrapper } = await mountAt(ParentAccessLinkPanel, '/', { visitId: 'v1', accessLink: null, canHandle: true, deadlineHours: 48 })
    expect(wrapper.text()).toContain('參觀前 2 天截止')
    await wrapper.setProps({ deadlineHours: undefined })
    expect(wrapper.text()).toContain('截止時間依本校預約設定')
    expect(wrapper.text()).not.toContain('24 小時')
  })
})
