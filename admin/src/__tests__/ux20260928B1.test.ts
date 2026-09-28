import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey, type Router } from 'vue-router'
import ElementPlus from 'element-plus'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import VisitCalendarView from '../views/VisitCalendarView.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import type { UserOut } from '../api/types'
import { testUser } from './fixtures'

// 2026-09-28 案件列表與接待月曆 UX 修正：網址同步、單校欄位、電話搜尋、切回分頁更新、
// 月曆圖例與名額單位。

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const superAdmin = () => testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: [] })
const reception = () => testUser('reception', { id: 'desk', email: 'desk@example.invalid', campus_keys: ['yihua'] })

async function mountAt(component: unknown, path: string, user: UserOut = superAdmin()): Promise<{ wrapper: VueWrapper; router: Router }> {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

type GetSpy = { mock: { calls: unknown[][] } }
const listCalls = (get: GetSpy) => get.mock.calls.map(call => String(call[0])).filter(path => path.startsWith('/admin/visit-requests?'))
const lastListQuery = (get: GetSpy) => new URLSearchParams(listCalls(get).at(-1)!.split('?')[1])

const request = (changes: Record<string, unknown> = {}) => ({
  id: 'case-a', campus_key: 'yihua', status: 'new', parent_name: '王媽媽', phone: '0912345678', child_name: '小安',
  child_birthdate: null, email: null, referral_sources: [], age: null, preferred_time: null, questions: null, source: 'web',
  slot_id: null, slot: null, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null, assigned_staff_id: null, ...changes,
})

describe('案件列表：篩選與頁數跟網址雙向同步', () => {
  it('網址上的條件（含搜尋、來源、送出日期與頁數）掛載時全部讀回來', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const { wrapper } = await mountAt(VisitRequestsView,
      '/visit-requests?status=new&q=%E7%8E%8B&source=phone&created_from=2026-09-01&created_to=2026-09-07&assignee=me&order=oldest&page=3&campus=renwu')
    expect(listCalls(get)).toHaveLength(1)
    expect(Object.fromEntries(lastListQuery(get))).toEqual({
      status: 'new', q: '王', source: 'phone', created_from: '2026-09-01', created_to: '2026-09-07', assignee: 'me',
      campus_key: 'renwu', order: 'oldest', page: '3', page_size: '20',
    })
    expect(wrapper.findAll('.status-tab').find(tab => tab.text().startsWith('待處理'))!.attributes('aria-pressed')).toBe('true')
    expect((wrapper.get('input[aria-label="搜尋家長／孩子姓名、電話或 Email"]').element as HTMLInputElement).value).toBe('王')
  })

  it('畫面上改條件用 replace 寫回網址並回到第一頁，不會再讀回來多查一次', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(Array.from({ length: 20 }, (_, i) => request({ id: `case-${i}` })) as never)
    const { wrapper, router } = await mountAt(VisitRequestsView, '/visit-requests?order=oldest&page=2')
    const replace = vi.spyOn(router, 'replace')
    const push = vi.spyOn(router, 'push')

    await wrapper.findAll('.status-tab').find(tab => tab.text() === '已確認')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ status: 'confirmed', order: 'oldest' })
    expect(lastListQuery(get).get('page')).toBe('1')
    expect(listCalls(get)).toHaveLength(2)

    await wrapper.findAll('button').find(button => button.text() === '下一頁')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ status: 'confirmed', order: 'oldest', page: '2' })
    expect(listCalls(get)).toHaveLength(3)

    wrapper.findComponent({ name: 'ElDatePicker' }).vm.$emit('update:modelValue', ['2026-09-01', '2026-09-07'])
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ status: 'confirmed', order: 'oldest', created_from: '2026-09-01', created_to: '2026-09-07' })
    expect(listCalls(get)).toHaveLength(4)
    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledTimes(3)
  })

  it('搜尋停下來才寫進網址；清除篩選後網址也清乾淨', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const { wrapper, router } = await mountAt(VisitRequestsView, '/visit-requests?due=1')
    await wrapper.get('input[aria-label="搜尋家長／孩子姓名、電話或 Email"]').setValue('陳')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ due: '1' })
    await new Promise(resolve => setTimeout(resolve, 350))
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ due: '1', q: '陳' })

    await wrapper.findAll('button').find(button => button.text() === '清除篩選')!.trigger('click')
    await new Promise(resolve => setTimeout(resolve, 350))
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('側欄或總覽連結改了網址就套用新條件；點進案件時不會清掉條件重查', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const { wrapper, router } = await mountAt(VisitRequestsView, '/visit-requests?status=new')
    await router.push('/visit-requests?status=pending_confirmation&order=oldest')
    await flushPromises()
    expect(wrapper.findAll('.status-tab').find(tab => tab.text().startsWith('待園方確認'))!.attributes('aria-pressed')).toBe('true')
    expect(lastListQuery(get).get('status')).toBe('pending_confirmation')
    expect(lastListQuery(get).get('order')).toBe('oldest')
    expect(listCalls(get)).toHaveLength(2)
    expect(router.currentRoute.value.fullPath).toBe('/visit-requests?status=pending_confirmation&order=oldest')

    await router.push('/visit-requests/case-a')
    await flushPromises()
    expect(listCalls(get)).toHaveLength(2)
  })
})

describe('案件列表：電話搜尋與欄位', () => {
  it('搜尋字像電話時去掉空格、連字號與國碼再查，網址留使用者打的字', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const { wrapper, router } = await mountAt(VisitRequestsView, '/visit-requests')
    const input = wrapper.get('input[aria-label="搜尋家長／孩子姓名、電話或 Email"]')
    for (const [typed, sent] of [['0912-345 678', '0912345678'], ['+886 912-345-678', '0912345678'], ['(02) 2345-6789', '0223456789'], ['王 小明', '王 小明']]) {
      await input.setValue(typed)
      await new Promise(resolve => setTimeout(resolve, 350))
      await flushPromises()
      expect(lastListQuery(get).get('q')).toBe(sent)
      expect(router.currentRoute.value.query.q).toBe(typed)
    }
  })

  it('方便接電話時段併進家長欄；送出時間今年省略年份，跨年照寫', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-28T12:00:00+08:00'))
    vi.spyOn(api, 'get').mockResolvedValue([
      request({ preferred_time: 'weekday_morning', created_at: '2026-09-28T13:41:00Z', follow_up_at: '2026-09-27T07:00:00Z', source: 'phone' }),
      request({ id: 'case-b', parent_name: '林爸爸', created_at: '2025-12-31T02:00:00Z' }),
    ] as never)
    const { wrapper } = await mountAt(VisitRequestsView, '/visit-requests')
    const headers = wrapper.findAll('.requests-table th').map(th => th.text())
    expect(headers).toEqual(['狀態', '校區', '家長／孩子', '參觀時間', '電話', '承辦人', '送出時間'])
    const rows = wrapper.findAll('.requests-table .el-table__row')
    expect(rows[0]!.text()).toContain('方便接電話時段：平日上午')
    expect(rows[0]!.text()).toContain('小安 · 電話補登')
    expect(rows[0]!.text()).toContain('到期待追蹤 09/27 15:00')
    expect(rows[0]!.find('.date-cell').text()).toBe('09/28 21:41')
    expect(rows[1]!.find('.date-cell').text()).toBe('2025/12/31 10:00')
    expect(rows[1]!.text()).not.toContain('方便接電話')
    const cards = wrapper.findAll('.request-list li')
    expect(cards[0]!.text()).toContain('義華校 · 小安 · 承辦：未指派 · 電話補登')
    expect(cards[0]!.text()).toContain('方便接電話時段：平日上午')
    expect(cards[0]!.text()).toContain('09/28 21:41 送出')
  })

  it('只負責一校的櫃台：沒有校區欄，校區篩選是唯讀標籤，網址帶別校也不會拿去查', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([request()] as never)
    const { wrapper } = await mountAt(VisitRequestsView, '/visit-requests?campus=renwu', reception())
    expect(wrapper.findAll('.requests-table th').map(th => th.text())).not.toContain('校區')
    expect(wrapper.find('.campus-single').text()).toContain('義華')
    expect(wrapper.findComponent({ name: 'CampusSelect' }).find('.el-select').exists()).toBe(false)
    expect(lastListQuery(get).has('campus_key')).toBe(false)
    expect(wrapper.find('.request-list li').text()).not.toContain('義華校')
  })
})

describe('案件列表：切回分頁時更新', () => {
  it('超過 60 秒才靜靜重抓（不閃載入中）並更新側欄數字；60 秒內不重抓', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-28T09:00:00+08:00'))
    let resolveList: ((value: unknown) => void) | null = null
    let listRequests = 0
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/dashboard') return { new_requests: 5, awaiting_confirmation: 1 } as never
      if (path.startsWith('/admin/visit-requests?') && listRequests++ > 0) return new Promise(resolve => { resolveList = resolve }) as never
      return [request()] as never
    })
    const { wrapper } = await mountAt(VisitRequestsView, '/visit-requests')
    expect(listCalls(get)).toHaveLength(1)

    vi.setSystemTime(new Date('2026-09-28T09:00:30+08:00'))
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(listCalls(get)).toHaveLength(1)
    expect(get).not.toHaveBeenCalledWith('/admin/dashboard')

    vi.setSystemTime(new Date('2026-09-28T09:01:05+08:00'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(listCalls(get)).toHaveLength(2)
    expect(get).toHaveBeenCalledWith('/admin/dashboard')
    // 重抓期間保留原本的清單，不顯示「載入中」。
    expect(wrapper.text()).toContain('王媽媽')
    expect(wrapper.find('.panel__head').text()).toContain('本頁 1 件')
    resolveList!([request(), request({ id: 'case-new', parent_name: '新來的家長' })])
    await flushPromises()
    expect(wrapper.text()).toContain('新來的家長')
  })
})

describe('接待月曆', () => {
  const slot = (changes: Record<string, unknown> = {}) => ({
    id: 's1', campus_key: 'yihua', slot_date: '2026-09-24', start_time: '10:00:00', end_time: '11:00:00', capacity: 3, closed: false, booked_count: 0, visits: [], ...changes,
  })
  const visit = (id: string, status: string, parent_name: string) => ({ id, status, parent_name, child_name: null, phone: '0911222333', source: 'web', assigned_staff_id: null })

  it('有圖例；有待園方確認的日子數字點改暖色，格子的朗讀文字講組數', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T09:00:00+08:00'))
    vi.spyOn(api, 'get').mockResolvedValue([
      slot({ booked_count: 2, visits: [visit('v1', 'pending_confirmation', '王小姐'), visit('v2', 'confirmed', '林太太')] }),
      slot({ id: 's2', slot_date: '2026-09-25', booked_count: 1, visits: [visit('v3', 'confirmed', '陳先生')] }),
    ] as never)
    const { wrapper } = await mountAt(VisitCalendarView, '/visit-calendar')
    const legend = wrapper.get('.calendar__legend').text()
    for (const label of ['待園方確認', '已確認', '已完成或未到場', '有開放時段']) expect(legend).toContain(label)

    const day24 = wrapper.findAll('.calendar__day').find(cell => cell.attributes('aria-label')?.startsWith('2026/09/24'))!
    const day25 = wrapper.findAll('.calendar__day').find(cell => cell.attributes('aria-label')?.startsWith('2026/09/25'))!
    expect(day24.attributes('aria-label')).toBe('2026/09/24，2 組，其中 1 組待園方確認')
    expect(day25.attributes('aria-label')).toBe('2026/09/25，1 組')
    expect(day24.get('.calendar__dot').classes()).toContain('is-pending')
    expect(day25.get('.calendar__dot').classes()).not.toContain('is-pending')
    expect(day24.text()).toContain('可約 1 組')
    // 全部校區時格內標出是哪一校的家長。
    expect(day24.text()).toContain('10:00 義華 王小姐')
  })

  it('已結束的場次不算可約；全部結束的日子不顯示可約', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T12:00:00+08:00'))
    vi.spyOn(api, 'get').mockResolvedValue([
      slot({ id: 'morning', start_time: '09:00:00', end_time: '10:00:00' }),
      slot({ id: 'afternoon', start_time: '14:00:00', end_time: '15:00:00', capacity: 2 }),
      slot({ id: 'yesterday', slot_date: '2026-09-23' }),
    ] as never)
    const { wrapper } = await mountAt(VisitCalendarView, '/visit-calendar')
    const cell = (date: string) => wrapper.findAll('.calendar__day').find(day => day.attributes('aria-label')?.startsWith(date))!
    expect(cell('2026/09/24').text()).toContain('可約 2 組')
    expect(cell('2026/09/23').text()).not.toContain('可約')
  })

  it('?campus= 帶進來就看那一校，切校寫回網址', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const { wrapper, router } = await mountAt(VisitCalendarView, '/visit-calendar?campus=renwu')
    const calendarCalls = () => get.mock.calls.map(call => String(call[0])).filter(path => path.startsWith('/admin/visit-calendar?'))
    expect(new URLSearchParams(calendarCalls().at(-1)!.split('?')[1]).get('campus_key')).toBe('renwu')
    const select = wrapper.findComponent({ name: 'CampusSelect' }).findComponent({ name: 'ElSelect' })
    expect(select.props('modelValue')).toBe('renwu')
    select.vm.$emit('update:modelValue', 'minghua')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'minghua' })
    expect(new URLSearchParams(calendarCalls().at(-1)!.split('?')[1]).get('campus_key')).toBe('minghua')
    select.vm.$emit('update:modelValue', '')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('只負責一校時校區是唯讀標籤', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const { wrapper } = await mountAt(VisitCalendarView, '/visit-calendar', reception())
    expect(wrapper.find('.campus-single').text()).toContain('義華')
  })

  it('點日期後名單不在畫面裡就捲過去；已經看得到就不動', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const { wrapper } = await mountAt(VisitCalendarView, '/visit-calendar')
    const heading = wrapper.get('.calendar__detail h2').element as HTMLElement
    const scroll = vi.fn()
    heading.scrollIntoView = scroll
    const rect = (top: number) => vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue({ top, bottom: top + 24 } as DOMRect)
    const days = wrapper.findAll('.calendar__day')

    rect(940)
    await days[10]!.trigger('click')
    await flushPromises()
    expect(scroll).toHaveBeenCalledOnce()

    rect(300)
    await days[11]!.trigger('click')
    await flushPromises()
    expect(scroll).toHaveBeenCalledOnce()
  })
})
