import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey, type Router } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import DashboardView from '../views/DashboardView.vue'
import BookingSettingsView from '../views/BookingSettingsView.vue'
import DayPanel from '../components/sessions/DayPanel.vue'
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
    const { wrapper } = await mountAt(VisitRequestsView, '/visit-requests?group=upcoming&attention=1')
    expect(wrapper.get('#export-scope').text()).toContain('目前篩選的全部結果')
    wrapper.findComponent({ name: 'ElDatePicker' }).vm.$emit('update:modelValue', ['2026-09-01', '2026-09-07'])
    await wrapper.get('input[aria-label="搜尋家長／孩子姓名、電話或 Email"]').setValue('王')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '匯出 CSV')!.trigger('click')
    const url = String(open.mock.calls[0]![0])
    expect(url.startsWith('/api/website/v1/admin/visit-requests/export?')).toBe(true)
    const query = new URLSearchParams(url.split('?')[1])
    expect(Object.fromEntries(query)).toEqual({
      group: 'upcoming', q: '王', created_from: '2026-09-01', created_to: '2026-09-07', needs_attention: 'true',
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

  it('設整天休假：當天還有家長預約時先說明不會自動取消，再送出', async () => {
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '研習', action: 'confirm' } as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'e1' } as never)
    const slot = { id: 's1', campus_key: 'yihua', slot_date: '2099-01-07', start_time: '10:00:00', end_time: '11:00:00', capacity: 3, closed: false, closed_source: null, version: 1, booked_count: 2,
      visits: [1, 2].map(n => ({ id: `v${n}`, status: 'confirmed', parent_name: `家長${n}`, child_name: null, phone: '0911222333', source: 'web', assigned_staff_id: null })) }
    const { wrapper } = await mountAt(DayPanel, '/', { day: '2099-01-07', campusKey: 'yihua', slots: [slot], holiday: null, canManage: true, staff: [] })
    await wrapper.findAll('button').find(button => button.text() === '整天休假')!.trigger('click')
    await flushPromises()
    expect(String(prompt.mock.calls[0]![0])).toContain('這天還有 2 組家長預約，設為休假後不會自動取消')
    expect(post).toHaveBeenCalledWith('/admin/visit-schedule/yihua/exceptions', { exception_date: '2099-01-07', reason: '研習' })
    expect(wrapper.emitted('changed')).toBeTruthy()
  })

  it('取消休假先確認，選「先不要」什麼都不改', async () => {
    const del = vi.spyOn(api, 'delete').mockResolvedValue({} as never)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValueOnce('confirm' as never)
    const success = vi.spyOn(ElMessage, 'success')
    const { wrapper } = await mountAt(DayPanel, '/', { day: '2099-01-07', campusKey: 'yihua', slots: [], holiday: { id: 'e1', reason: '研習' }, canManage: true, staff: [] })
    expect(wrapper.text()).toContain('休假：研習')
    const cancelHoliday = () => wrapper.findAll('button').find(button => button.text() === '取消休假')!
    await cancelHoliday().trigger('click')
    await flushPromises()
    expect(del).not.toHaveBeenCalled()
    const [message, title, options] = confirm.mock.calls[0]!
    expect(String(title)).toContain('取消休假')
    expect(String(message)).toContain('固定場次會重新開放')
    expect(options).toMatchObject({ confirmButtonText: '取消休假', cancelButtonText: '先不要' })
    await cancelHoliday().trigger('click')
    await flushPromises()
    expect(del).toHaveBeenCalledWith('/admin/visit-schedule/yihua/exceptions/e1')
    expect(String(success.mock.calls.at(-1)![0])).toContain('已取消休假')
  })

  it('停用中的分校連到該校待人工處理的案件', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ key: 'yihua', name: '義華', active: false, deactivated_at: null, deactivated_reason: null } as never)
    const { wrapper, router } = await mountAt(CampusStatusCard, '/booking', { campusKey: 'yihua' })
    await wrapper.findAll('button').find(button => button.text() === '看待人工處理的案件')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/visit-requests?attention=1&campus=yihua')
  })

  it('停用分校的說明與確認講清楚會從官網下架；讀不到狀態時留下重新載入', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ key: 'yihua', name: '義華', active: true } as never)
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockRejectedValue('cancel')
    const { wrapper } = await mountAt(CampusStatusCard, '/booking', { campusKey: 'yihua' })
    expect(wrapper.text()).toContain('分校網址會顯示找不到頁面')
    await wrapper.findAll('button').find(button => button.text() === '停用分校')!.trigger('click')
    await flushPromises()
    const [message, , options] = prompt.mock.calls[0]!
    expect(String(message)).toContain('會從官網下架')
    expect(String(message)).toContain('首頁五校區塊、選單與頁尾都不再列出')
    expect(options).toMatchObject({ confirmButtonText: '停用分校', cancelButtonText: '先不要' })

    get.mockRejectedValue(new Error('offline'))
    const failed = (await mountAt(CampusStatusCard, '/booking', { campusKey: 'yihua' })).wrapper
    expect(failed.text()).toContain('無法讀取分校目前是啟用還是停用')
    get.mockResolvedValue({ key: 'yihua', name: '義華', active: true } as never)
    await failed.findAll('button').find(button => button.text() === '重新載入')!.trigger('click')
    await flushPromises()
    expect(failed.text()).toContain('分校啟用中')
  })

  it('停用確認框按下當下讀進行中件數：有件數、0 件、讀不到各自說清楚', async () => {
    const impact = { open_requests: 9, new_requests: 1, contacting: 0, pending_confirmation: 1, upcoming_confirmed: 7, past_confirmed: 0, bookable_slots: 3, weekly_rules: 0 }
    let readiness: unknown = { blockers: {}, impact }
    const get = vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).endsWith('/readiness')) {
        if (readiness instanceof Error) throw readiness
        return readiness as never
      }
      return { key: 'yihua', name: '義華', active: true } as never
    })
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockRejectedValue('cancel')
    const { wrapper } = await mountAt(CampusStatusCard, '/booking', { campusKey: 'yihua' })
    const stop = () => wrapper.findAll('button').find(button => button.text() === '停用分校')!
    await stop().trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/booking-config/yihua/readiness')
    const first = String(prompt.mock.calls[0]![0])
    expect(first).toContain('進行中的案件 9 件（已確認、還沒參觀 7、待園方確認 1、待處理／聯絡中 1）')
    expect(first).toContain('停用後官網不會通知這些家長，要另外逐一聯絡')
    expect(prompt.mock.calls[0]![2]).toMatchObject({ confirmButtonText: '停用分校', cancelButtonText: '先不要' })

    readiness = { blockers: {}, impact: { ...impact, open_requests: 0, new_requests: 0, pending_confirmation: 0, upcoming_confirmed: 0 } }
    await stop().trigger('click')
    await flushPromises()
    expect(String(prompt.mock.calls[1]![0])).toContain('目前沒有進行中的案件。')

    readiness = new Error('offline')
    await stop().trigger('click')
    await flushPromises()
    expect(String(prompt.mock.calls[2]![0])).toContain('目前無法讀取進行中的案件數，停用後請到「待人工處理」確認。')
  })

  it('預約方式頁：啟用中的分校狀態放在表單下方，已停用時留在頁首', async () => {
    const config = { campus_key: 'yihua', version: 3, mode: 'slots', line_url: null, phone: null, external_url: null, message: null, parent_change_deadline_hours: 24 }
    let active = true
    vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).startsWith('/admin/campuses/')) return { key: 'yihua', name: '義華', active } as never
      if (String(path).endsWith('/readiness')) return null as never
      return config as never
    })
    const { wrapper } = await mountAt(BookingSettingsView, '/booking')
    const on = wrapper.html()
    expect(on.indexOf('分校啟用中')).toBeGreaterThan(on.indexOf('儲存並套用到官網'))
    expect(wrapper.find('.campus-zone').exists()).toBe(true)

    active = false
    const inactive = (await mountAt(BookingSettingsView, '/booking')).wrapper
    await flushPromises()
    const off = inactive.html()
    expect(off.indexOf('分校已停用')).toBeGreaterThan(-1)
    expect(off.indexOf('分校已停用')).toBeLessThan(off.indexOf('儲存並套用到官網'))
    expect(inactive.find('.campus-zone').exists()).toBe(false)
  })

  it('分校狀態還在讀時不先擺空的標題；重新載入時原因留著', async () => {
    const config = { campus_key: 'yihua', version: 3, mode: 'slots', line_url: null, phone: null, external_url: null, message: null, parent_change_deadline_hours: 24 }
    let resolveStatus!: (value: unknown) => void
    const get = vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).startsWith('/admin/campuses/')) return new Promise(resolve => { resolveStatus = resolve }) as never
      if (String(path).endsWith('/readiness')) return null as never
      return config as never
    })
    const { wrapper } = await mountAt(BookingSettingsView, '/booking')
    expect(wrapper.find('.campus-zone__title').exists()).toBe(false)
    resolveStatus({ key: 'yihua', name: '義華', active: true })
    await flushPromises()
    expect(wrapper.find('.campus-zone__title').text()).toBe('分校狀態')

    get.mockImplementation(async () => { throw new Error('offline') })
    const failed = (await mountAt(CampusStatusCard, '/booking', { campusKey: 'yihua' })).wrapper
    get.mockImplementation(() => new Promise(resolve => { resolveStatus = resolve }) as never)
    await failed.findAll('button').find(button => button.text() === '重新載入')!.trigger('click')
    await flushPromises()
    expect(failed.text()).toContain('無法讀取分校目前是啟用還是停用')
    resolveStatus({ key: 'yihua', name: '義華', active: true })
    await flushPromises()
    expect(failed.text()).toContain('分校啟用中')
  })

  it('停用分校後卡片移到頁首，焦點落在「重新啟用」，不掉回頁面最上方', async () => {
    const config = { campus_key: 'yihua', version: 3, mode: 'slots', line_url: null, phone: null, external_url: null, message: null, parent_change_deadline_hours: 24 }
    let active = true
    vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).startsWith('/admin/campuses/')) return { key: 'yihua', name: '義華', active } as never
      if (String(path).endsWith('/readiness')) return null as never
      return config as never
    })
    vi.spyOn(api, 'patch').mockImplementation(async () => { active = false; return { key: 'yihua', name: '義華', active: false, open_requests: 0 } as never })
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '' } as never)
    vi.spyOn(ElMessage, 'success')
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: [] })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/booking')
    await router.isReady()
    const wrapper = mount(BookingSettingsView, { attachTo: document.body, global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
    wrappers.push(wrapper)
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '停用分校')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.campus-zone').exists()).toBe(false)
    const html = wrapper.html()
    expect(html.indexOf('分校已停用')).toBeLessThan(html.indexOf('儲存並套用到官網'))
    expect(document.activeElement?.textContent?.trim()).toBe('重新啟用')
  })
})

describe('家長線上取消／改期期限', () => {
  const deadlineInput = (wrapper: VueWrapper) =>
    wrapper.findAllComponents({ name: 'ElInputNumber' }).find(item => item.find('input[aria-label="參觀前幾小時截止"]').exists())!
  const config = { campus_key: 'yihua', version: 3, mode: 'slots', line_url: null, phone: null, external_url: null, message: null, parent_change_deadline_hours: 48 }

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

  it('自選場次的說明不先說會寄信；其他方式仍顯示期限並說明已排定的家長仍適用', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ...config, parent_email_enabled: false } as never)
    const { wrapper } = await mountAt(BookingSettingsView, '/booking')
    expect(wrapper.text()).toContain('選好送出即預約成功，並拿到修改連結')
    expect(wrapper.text()).not.toContain('收到確認信與修改連結')
    expect(wrapper.text()).toContain('尚未設定寄信')
    expect(wrapper.text()).not.toContain('已排定場次的家長仍照這個期限')

    vi.spyOn(api, 'get').mockResolvedValue({ ...config, mode: 'line', line_url: 'https://lin.ee/x' } as never)
    const line = (await mountAt(BookingSettingsView, '/booking')).wrapper
    expect(deadlineInput(line)).toBeTruthy()
    expect(line.text()).toContain('改成其他預約方式後，已排定場次的家長仍照這個期限')
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
    const { wrapper } = await mountAt(ParentAccessLinkPanel, '/', { visitId: 'v1', accessLink: null, canHandle: true, status: 'confirmed', email: null, deadlineHours: 48 })
    expect(wrapper.text()).toContain('參觀前 2 天截止')
    await wrapper.setProps({ deadlineHours: undefined })
    expect(wrapper.text()).toContain('截止時間依本校預約設定')
    expect(wrapper.text()).not.toContain('24 小時')
  })
})
