import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import NotificationsView from '../views/NotificationsView.vue'
import DashboardView from '../views/DashboardView.vue'
import { api } from '../api/client'
import { AUDIT_ACTION_LABELS, NOTIFICATION_KIND_LABELS, slotStarted } from '../api/labels'
import { visitEventActor, visitEventChanges, visitEventTitle } from '../api/visitHistory'
import type { UserOut, VisitHistoryOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const current = { id: 'slot-a', slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00' }
const later = { ...current, id: 'slot-b', slot_date: '2099-10-03', start_time: '14:00:00', end_time: '15:00:00' }
// 已經開始的場次：完成參觀／未到場只在這種場次出現。
const started = { ...current, id: 'slot-started', slot_date: '2020-01-01' }
const listSlot = (slot: typeof current, extra = {}) => ({ ...slot, campus_key: 'yihua', capacity: 2, booked_count: 0, closed: false, ...extra })
const confirmedCase = (extra = {}) => ({
  id: 'case-a', campus_key: 'yihua', status: 'confirmed', parent_name: '陳媽媽', phone: '0912345678', child_name: null,
  child_birthdate: null, email: null, referral_sources: [], age: null, preferred_time: null, questions: null,
  slot_id: current.id, slot: current, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null,
  confirmed_at: '2026-09-22T01:00:00Z', cancelled_at: null, source: 'web',
  history: [], access_link: null, ...extra,
})
const confirmOk = () => vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue({ value: '', action: 'confirm' } as never)

async function mountDetail(data: Record<string, unknown>, slots: unknown[] = [], user: UserOut = testUser('super_admin')) {
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    const url = String(path)
    if (url.endsWith('/contact-notes')) return [] as never
    if (url.startsWith('/admin/slots')) return slots as never
    if (url.startsWith('/admin/visit-requests?') || url.startsWith('/admin/visit-staff')) return [] as never
    if (url === '/admin/dashboard') return {} as never
    return data as never
  })
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/visit-requests/:id', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/visit-requests/case-a'); await router.isReady()
  const wrapper = mount(VisitDetailView, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, get }
}

const button = (wrapper: VueWrapper, text: string) => wrapper.findAll('button').find(b => b.text() === text)

describe('已確認案件的改期（第 13 條）', () => {
  it('只列同校未來、還有名額、不是目前這一場的時段，送出新時段與原因', async () => {
    const past = { ...current, id: 'slot-past', slot_date: '2020-01-01' }
    const full = { ...later, id: 'slot-full' }
    const { wrapper } = await mountDetail(confirmedCase(), [
      listSlot(current), listSlot(later), listSlot(past), listSlot(full, { booked_count: 2 }),
    ])
    // 2026-10-05 第九輪：改期表單一律先收成連結，點開才出現。
    await button(wrapper, '改到其他場次…')!.trigger('click')
    await flushPromises()
    const select = wrapper.findAllComponents({ name: 'ElSelect' })[0]!
    const options = wrapper.findAllComponents({ name: 'ElOption' }).map(o => o.props('value'))
    expect(options).toEqual(['slot-b'])
    confirmOk()
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    select.vm.$emit('update:modelValue', 'slot-b')
    await wrapper.find('input[aria-label="改期原因"]').setValue('家長來電改到週末')
    await flushPromises()
    await button(wrapper, '改到這一場')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/case-a/reschedule', { new_slot_id: 'slot-b', reason: '家長來電改到週末' })
    // 改期後系統會寄信給家長，不再預填「已致電家長」的紀錄。
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  it('按「沒來」（標記未到場）不再說會釋出名額，結案後重抓頁首數字', async () => {
    const confirm = confirmOk()
    vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const { wrapper, get } = await mountDetail(confirmedCase({ slot: started }))
    get.mockClear()
    await button(wrapper, '沒來')!.trigger('click')
    await flushPromises()
    expect(String(confirm.mock.calls[0]![0])).toContain('名額仍算已使用')
    expect(String(confirm.mock.calls[0]![0])).not.toContain('釋出')
    expect(get).toHaveBeenCalledWith('/admin/dashboard')
  })

  it('按「家長到了」完成參觀後也重抓頁首數字', async () => {
    confirmOk()
    vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const { wrapper, get } = await mountDetail(confirmedCase({ slot: started }))
    get.mockClear()
    await button(wrapper, '家長到了')!.trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/dashboard')
  })

  it('場次還沒開始時不顯示「家長到了」與「沒來」，提示改用取消預約', async () => {
    const { wrapper } = await mountDetail(confirmedCase())
    expect(button(wrapper, '家長到了')).toBeUndefined()
    expect(button(wrapper, '沒來')).toBeUndefined()
    expect(wrapper.text()).toContain('參觀場次開始後可以標記已到場或未到場')
    expect(wrapper.text()).toContain('請用下方的「取消預約」')
    expect(button(wrapper, '取消預約')).toBeDefined()
  })

  it('案件頁開著等到場次開始，「家長到了」與「沒來」不必重新整理就出現', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      // current 是 2099/10/01 10:00（台灣時間）開始，先停在開始前 10 秒。
      vi.setSystemTime(new Date('2099-10-01T01:59:50Z'))
      const { wrapper } = await mountDetail(confirmedCase())
      expect(button(wrapper, '沒來')).toBeUndefined()
      vi.advanceTimersByTime(30_000)
      await flushPromises()
      expect(button(wrapper, '家長到了')).toBeDefined()
      expect(button(wrapper, '沒來')).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('園方直接改期後重抓頁首數字', async () => {
    const { wrapper, get } = await mountDetail(confirmedCase(), [listSlot(later)])
    // 手動改期先收起來，點開才出現。
    expect(button(wrapper, '改到這一場')).toBeUndefined()
    await button(wrapper, '改到其他場次…')!.trigger('click')
    confirmOk()
    vi.spyOn(api, 'post').mockResolvedValue({} as never)
    wrapper.findAllComponents({ name: 'ElSelect' })[0]!.vm.$emit('update:modelValue', 'slot-b')
    await flushPromises()
    get.mockClear()
    await button(wrapper, '改到這一場')!.trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/dashboard')
  })

  it('沒有處理權的帳號看不到改期與連結操作', async () => {
    const viewer = testUser('readonly', { campus_keys: ['yihua'], effective_capabilities: ['booking.read'] })
    const { wrapper } = await mountDetail(confirmedCase(), [listSlot(later)], viewer)
    for (const label of ['改到其他場次…', '改到這一場', '產生連結']) expect(button(wrapper, label)).toBeUndefined()
  })
})

describe('家長管理連結（第 20 條）', () => {
  it('產生後只顯示一次完整網址、可以複製；重新產生前先確認', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { wrapper } = await mountDetail(confirmedCase())
    expect(wrapper.text()).toContain('還沒有產生連結')
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      manage_url: 'https://www.ivy.example/visit/manage#token=abc', manage_url_fragment: '/visit/manage#token=abc',
      expires_at: '2026-10-09T00:00:00Z', replaced_previous: false,
    } as never)
    await button(wrapper, '產生連結')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/case-a/access-link')
    expect(wrapper.text()).toContain('連結只顯示這一次')
    const input = wrapper.find('input[aria-label="家長管理連結"]').element as HTMLInputElement
    expect(input.value).toBe('https://www.ivy.example/visit/manage#token=abc')
    await button(wrapper, '複製連結')!.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('https://www.ivy.example/visit/manage#token=abc')

    const confirm = confirmOk()
    // 這筆沒有 Email，不會寄信：按鈕不寫「並寄出」。
    await button(wrapper, '重新產生連結')!.trigger('click')
    await flushPromises()
    expect(String(confirm.mock.calls[0]![0])).toContain('舊連結會立即失效')
  })

  it('已有有效連結時只顯示期限，可以撤銷；結案的案件不顯示', async () => {
    const link = { created_at: '2026-09-24T00:00:00Z', expires_at: '2026-10-08T00:00:00Z' }
    const { wrapper } = await mountDetail(confirmedCase({ access_link: link }))
    expect(wrapper.text()).toContain('目前連結有效到')
    confirmOk()
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never)
    await button(wrapper, '撤銷連結')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/case-a/revoke-access')
    wrapper.unmount(); wrappers.length = 0; vi.restoreAllMocks()

    const closed = await mountDetail(confirmedCase({ status: 'cancelled' }))
    expect(closed.wrapper.text()).not.toContain('家長管理連結')
  })

  it('部署沒有設定公開網址時提示缺少 WEBSITE_ADMIN_ORIGIN', async () => {
    const { wrapper } = await mountDetail(confirmedCase())
    vi.spyOn(api, 'post').mockResolvedValue({
      manage_url: null, manage_url_fragment: '/visit/manage#token=abc', expires_at: '2026-10-09T00:00:00Z', replaced_previous: false,
    } as never)
    await button(wrapper, '產生連結')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('WEBSITE_ADMIN_ORIGIN')
    expect((wrapper.find('input[aria-label="家長管理連結"]').element as HTMLInputElement).value).toBe('/visit/manage#token=abc')
  })
})

describe('案件歷程（第 15 條）', () => {
  const event = (extra: Partial<VisitHistoryOut>): VisitHistoryOut => ({
    id: Math.random().toString(36), event_type: 'created', source: null, actor_user_id: null, actor_email: null,
    before: null, after: null, reason: null, created_at: '2026-09-24T02:00:00Z', ...extra,
  })

  it('翻成看得懂的動作、操作者、前後差異與原因', () => {
    const moved = event({
      event_type: 'rescheduled', source: 'staff', actor_user_id: 'u1', actor_email: 'desk@ivy.example',
      before: { status: 'confirmed', slot: current }, after: { status: 'confirmed', slot: later }, reason: '家長來電',
    })
    expect(visitEventTitle(moved)).toBe('改期')
    expect(visitEventActor(moved)).toBe('desk')
    expect(visitEventChanges(moved)).toEqual(['2099/10/01（週四）10:00–11:00 → 2099/10/03（週六）14:00–15:00'])

    const cancelled = event({ event_type: 'cancelled', source: 'parent', before: { status: 'confirmed', slot: current }, after: { status: 'cancelled' } })
    expect(visitEventActor(cancelled)).toBe('家長')
    expect(visitEventChanges(cancelled)).toEqual(['預約正常 → 已取消', '原參觀時間 2099/10/01（週四）10:00–11:00'])

    expect(visitEventActor(event({ event_type: 'hold_expired', source: 'system' }))).toBe('系統自動')
    expect(visitEventActor(event({ source: 'staff', actor_user_id: 'gone' }))).toBe('已移除的帳號')
    expect(visitEventTitle(event({ source: 'staff', after: { status: 'new', source: 'phone' } }))).toBe('電話補登')
    expect(visitEventTitle(event({ source: 'parent', after: { status: 'new', slot: null } }))).toBe('家長從官網送出')
    expect(visitEventChanges(event({
      event_type: 'assigned', before: { assigned_staff_id: null }, after: { assigned_staff_id: 'u2' },
    }), [{ id: 'u2', email: 'amy@ivy.example' }])).toEqual(['未指派 → amy'])
  })

  it('案件頁顯示歷程與聯絡紀錄是誰記的', async () => {
    const history = [
      event({ id: 'e1', source: 'parent', after: { status: 'confirmed', slot: current } }),
      event({ id: 'e2', event_type: 'cancelled', source: 'staff', actor_user_id: 'u1', actor_email: 'amy@ivy.example', before: { status: 'confirmed', slot: current }, after: { status: 'cancelled' }, reason: '家長臨時出國', created_at: '2026-09-25T02:00:00Z' }),
    ]
    const get = vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).endsWith('/contact-notes')) return [{ id: 'n1', note: '已致電', created_at: '2026-09-24T03:00:00Z', created_by: 'u1', created_by_email: 'amy@ivy.example' }] as never
      return (String(path).startsWith('/admin/') && String(path).includes('?')) || String(path).startsWith('/admin/visit-staff') ? [] as never : confirmedCase({ status: 'cancelled', history }) as never
    })
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/visit-requests/:id', component: VisitDetailView }] })
    await router.push('/visit-requests/case-a'); await router.isReady()
    const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper); await flushPromises()
    expect(get).toHaveBeenCalled()
    const timeline = wrapper.find('ol[aria-label="聯絡紀錄與案件歷程"]')
    expect(timeline.exists()).toBe(true)
    const items = timeline.findAll('li[data-kind="event"]').map(li => li.text())
    // 最新的在上面。
    expect(items[0]).toContain('取消預約')
    expect(items[0]).toContain('amy')
    expect(items[0]).toContain('原因：家長臨時出國')
    expect(items[1]).toContain('家長從官網送出')
    expect(wrapper.find('.notes__author').text()).toBe('amy')
  })
})

describe('舊的家長改期申請通知（功能已於 2026-10-08 刪除）', () => {
  async function mountNotifications(user: UserOut = testUser('super_admin', { campus_keys: ['yihua'] })) {
    const pinia = createPinia()
    useAuthStore(pinia).user = user
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/notifications'); await router.isReady()
    const wrapper = mount(NotificationsView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
    wrappers.push(wrapper); await flushPromises()
    return wrapper
  }

  it('舊通知仍有中文標題、連得到案件；通知頁不再讀待核准清單', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async path => (String(path).includes('notification-outbox')
      ? { items: [], total: 0 }
      : [{ id: 'n1', campus_key: 'yihua', kind: 'visit_reschedule_requested', payload: { campus_key: 'yihua', receipt_id: 'case-a', reschedule_request_id: 'req-1' }, created_at: '2026-09-24T02:00:00Z', read_at: null }]) as never)
    const wrapper = await mountNotifications()
    expect(wrapper.text()).toContain('家長申請改期（待園方核准）')
    expect(wrapper.text()).not.toContain('待核准的改期申請')
    expect(wrapper.findAll('a').some(a => a.attributes('href') === '/visit-requests/case-a')).toBe(true)
    expect(get.mock.calls.some(([path]) => String(path).includes('reschedule-requests'))).toBe(false)
  })

  it('總覽沒有改期申請的待辦與主按鈕（即使舊版 API 還帶著舊欄位）', async () => {
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: DashboardView }, { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/'); await router.isReady()
    vi.spyOn(api, 'get').mockResolvedValue({
      today_visits: 0, pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0,
      pending_reschedule_requests: 3,
    } as never)
    const dashboard = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(dashboard); await flushPromises()
    expect(dashboard.text()).not.toContain('家長申請改期')
    expect(dashboard.find('a.dash__primary').text()).not.toContain('核准改期申請')
    expect(dashboard.text()).toContain('目前沒有待處理事項')
  })
})

describe('標籤與小工具', () => {
  it('新的通知 kind 與稽核動作有中文，已開始的場次判斷用台灣時間', () => {
    expect(NOTIFICATION_KIND_LABELS.visit_reschedule_requested).toBe('家長申請改期（待園方核准）')
    expect(visitEventTitle({
      id: 'e', event_type: 'reschedule_superseded', source: 'staff', actor_user_id: 'u1', actor_email: 'desk@ivy.example',
      before: null, after: { requested_slot: later }, reason: null, created_at: '2026-09-24T02:00:00Z',
    })).toBe('家長的改期申請失效（已直接改期）')
    for (const action of ['visit_request.create_access_link', 'visit_request.revoke_access']) expect(AUDIT_ACTION_LABELS[action]).toBeTruthy()
    const slot = { slot_date: '2026-09-26', start_time: '10:00:00' }
    expect(slotStarted(slot, Date.parse('2026-09-26T01:59:00Z'))).toBe(false)
    expect(slotStarted(slot, Date.parse('2026-09-26T02:00:00Z'))).toBe(true)
  })
})
