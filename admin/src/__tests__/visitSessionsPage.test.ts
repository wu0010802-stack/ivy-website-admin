import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import VisitCalendarView from '../views/VisitCalendarView.vue'
import { routes } from '../router'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import type { UserOut } from '../api/types'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T09:00:00+08:00'))
})
afterEach(() => { wrappers.forEach(w => w.unmount()); wrappers.length = 0; vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = '' })

const campusAdmin = () => testUser('campus_admin', { id: 'ca', email: 'ca@example.invalid', campus_keys: ['yihua'] })
const reception = () => testUser('reception', { id: 'desk', email: 'desk@example.invalid', campus_keys: ['yihua'] })

const slot = (changes: Record<string, unknown> = {}) => ({
  id: 's1', campus_key: 'yihua', slot_date: '2026-10-06', start_time: '10:00:00', end_time: '11:00:00',
  capacity: 2, closed: false, closed_source: null, version: 1, booked_count: 0, visits: [], ...changes,
})
const visit = (id: string, parent_name: string, status = 'confirmed') =>
  ({ id, status, parent_name, child_name: null, phone: '0911222333', source: 'web', assigned_staff_id: null })

function mockGets({ calendar }: { calendar: unknown[] }) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/admin/visit-calendar')) return calendar as never
    if (path.startsWith('/admin/visit-schedule')) return { campus_key: 'yihua', min_lead_hours: 24, max_advance_days: 60, rules: [], exceptions: [], version: 1 } as never
    if (path.startsWith('/admin/booking-config')) return { mode: 'slots', version: 1, parent_email_enabled: false } as never
    return [] as never
  })
}

async function mountPage(user: UserOut = campusAdmin()) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/visit-calendar?campus=yihua'); await router.isReady()
  const wrapper = mount(VisitCalendarView, {
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

async function selectDay(wrapper: VueWrapper, day: string) {
  const label = day.replace(/-/g, '/')
  await wrapper.findAll('.calendar__day').find(b => (b.attributes('aria-label') ?? '').startsWith(label))!.trigger('click')
  await flushPromises()
}
const buttonsByText = (wrapper: VueWrapper, text: string) => wrapper.findAll('button').filter(b => b.text() === text)
const buttonByText = (wrapper: VueWrapper, text: string) => buttonsByText(wrapper, text)[0]!

describe('參觀場次頁', () => {
  it('停止申請直接生效並帶版本；已約的家長照常參觀', async () => {
    const booked = slot({ id: 's1', booked_count: 1, visits: [visit('v1', '王小明')] })
    mockGets({ calendar: [booked] })
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...booked, closed: true, version: 2 } as never)
    const { wrapper } = await mountPage()
    await selectDay(wrapper, '2026-10-06')

    await buttonByText(wrapper, '停止申請').trigger('click')
    await flushPromises()

    expect(patch).toHaveBeenCalledWith('/admin/slots/s1', { closed: true, expected_version: 1 })
    expect(document.body.textContent).toContain('已約好的 1 組家長照常參觀')
  })

  it('已停止的場次可以恢復開放；休假日關閉的場次要先取消休假', async () => {
    mockGets({ calendar: [slot({ id: 's1', closed: true, closed_source: 'manual' }), slot({ id: 's2', start_time: '14:30:00', end_time: '15:30:00', closed: true, closed_source: 'exception' })] })
    const { wrapper } = await mountPage()
    await selectDay(wrapper, '2026-10-06')

    expect(buttonsByText(wrapper, '恢復開放')).toHaveLength(1)
  })

  it('整天休假：有預約時先說明不會自動取消', async () => {
    mockGets({ calendar: [slot({ booked_count: 1, visits: [visit('v1', '王小明')] })] })
    const confirm = vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '研習', action: 'confirm' } as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'e1' } as never)
    const { wrapper } = await mountPage()
    await selectDay(wrapper, '2026-10-06')

    await buttonByText(wrapper, '整天休假').trigger('click')
    await flushPromises()

    expect(String(confirm.mock.calls[0]?.[0])).toContain('這天還有 1 組家長預約，設為休假後不會自動取消')
    expect(post).toHaveBeenCalledWith('/admin/visit-schedule/yihua/exceptions', { exception_date: '2026-10-06', reason: '研習' })
  })

  it('加開一場', async () => {
    mockGets({ calendar: [] })
    const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 's9' } as never)
    const { wrapper } = await mountPage()
    await selectDay(wrapper, '2026-10-06')

    await buttonByText(wrapper, '＋加開一場').trigger('click')
    await buttonByText(wrapper, '加開').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/admin/slots?campus_key=yihua', { slot_date: '2026-10-06', start_time: '10:00:00', end_time: '11:00:00', capacity: 1 })
  })

  it('接待人員看得到名單，沒有停止申請、休假、加開', async () => {
    mockGets({ calendar: [slot({ booked_count: 1, visits: [visit('v1', '王小明')] })] })
    const { wrapper } = await mountPage(reception())
    await selectDay(wrapper, '2026-10-06')

    expect(wrapper.text()).toContain('王小明')
    for (const text of ['停止申請', '整天休假', '＋加開一場']) expect(buttonsByText(wrapper, text)).toHaveLength(0)
  })

  it('/slots 轉到參觀場次並保留校區', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/slots?campus=renwu')
    expect(router.currentRoute.value.fullPath).toBe('/visit-calendar?campus=renwu')
  })

})
