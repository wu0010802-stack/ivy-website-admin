import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import NotificationsView from '../views/NotificationsView.vue'
import DashboardView from '../views/DashboardView.vue'
import AdminSidebar from '../components/AdminSidebar.vue'
import CampusSelect from '../components/CampusSelect.vue'
import { api } from '../api/client'
import { AUDIT_ACTION_LABELS, NOTIFICATION_KIND_LABELS, slotStarted } from '../api/labels'
import { visitEventActor, visitEventChanges, visitEventTitle } from '../api/visitHistory'
import type { UserOut, VisitHistoryOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { useOpenRequestsStore } from '../stores/openRequests'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const current = { id: 'slot-a', slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00' }
const later = { ...current, id: 'slot-b', slot_date: '2099-10-03', start_time: '14:00:00', end_time: '15:00:00' }
// 已經開始的場次：完成參觀／未到場只在這種場次出現。
const started = { ...current, id: 'slot-started', slot_date: '2020-01-01' }
const listSlot = (slot: typeof current, extra = {}) => ({ ...slot, campus_key: 'yihua', capacity: 2, booked_count: 0, closed: false, ...extra })
const pendingReschedule = (extra = {}) => ({
  id: 'req-1', visit_request_id: 'case-a', campus_key: 'yihua', status: 'pending', parent_name: '陳媽媽',
  current_slot: current, requested_slot: later, requested_slot_remaining: 2, requested_slot_available: true,
  created_at: '2026-09-24T02:00:00Z', ...extra,
})
const confirmedCase = (extra = {}) => ({
  id: 'case-a', campus_key: 'yihua', status: 'confirmed', parent_name: '陳媽媽', phone: '0912345678', child_name: null,
  child_birthdate: null, email: null, referral_sources: [], age: null, preferred_time: null, questions: null,
  slot_id: current.id, slot: current, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null,
  assigned_staff_id: null, confirmed_at: '2026-09-22T01:00:00Z', cancelled_at: null, source: 'web',
  history: [], pending_reschedule: null, access_link: null, ...extra,
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
    const select = wrapper.findAllComponents({ name: 'ElSelect' })[0]!
    const options = wrapper.findAllComponents({ name: 'ElOption' }).map(o => o.props('value'))
    expect(options).toEqual(['slot-b'])
    confirmOk()
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    select.vm.$emit('update:modelValue', 'slot-b')
    await wrapper.find('input[aria-label="改期原因"]').setValue('家長來電改到週末')
    await flushPromises()
    await button(wrapper, '改到這個時段')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/case-a/reschedule', { new_slot_id: 'slot-b', reason: '家長來電改到週末' })
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toContain('參觀改到 2099/10/03')
  })

  it('標記未到場不再說會釋出名額，結案後重抓側欄的待核准數', async () => {
    const confirm = confirmOk()
    vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const { wrapper, get } = await mountDetail(confirmedCase({ slot: started, pending_reschedule: pendingReschedule() }))
    get.mockClear()
    await button(wrapper, '標記未到場')!.trigger('click')
    await flushPromises()
    expect(String(confirm.mock.calls[0]![0])).toContain('名額仍算已使用')
    expect(String(confirm.mock.calls[0]![0])).not.toContain('釋出')
    // 結案時家長的改期申請跟著失效，側欄徽章不能還留著。
    expect(get).toHaveBeenCalledWith('/admin/dashboard')
  })

  it('完成參觀後也重抓側欄的待核准數', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const { wrapper, get } = await mountDetail(confirmedCase({ slot: started, pending_reschedule: pendingReschedule() }))
    get.mockClear()
    await button(wrapper, '完成參觀')!.trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/dashboard')
  })

  it('場次還沒開始時不顯示完成參觀與標記未到場，提示改用取消預約', async () => {
    const { wrapper } = await mountDetail(confirmedCase())
    expect(button(wrapper, '完成參觀')).toBeUndefined()
    expect(button(wrapper, '標記未到場')).toBeUndefined()
    expect(wrapper.text()).toContain('參觀時段開始後可以標記完成或未到場')
    expect(wrapper.text()).toContain('請用下方的「取消預約」')
    expect(button(wrapper, '取消預約')).toBeDefined()
  })

  it('案件頁開著等到場次開始，完成參觀與標記未到場不必重新整理就出現', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      // current 是 2099/10/01 10:00（台灣時間）開始，先停在開始前 10 秒。
      vi.setSystemTime(new Date('2099-10-01T01:59:50Z'))
      const { wrapper } = await mountDetail(confirmedCase())
      expect(button(wrapper, '標記未到場')).toBeUndefined()
      vi.advanceTimersByTime(30_000)
      await flushPromises()
      expect(button(wrapper, '完成參觀')).toBeDefined()
      expect(button(wrapper, '標記未到場')).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('園方直接改期後重抓側欄的待核准數（家長先前的申請已失效）', async () => {
    const { wrapper, get } = await mountDetail(confirmedCase({ pending_reschedule: pendingReschedule() }), [listSlot(later)])
    confirmOk()
    vi.spyOn(api, 'post').mockResolvedValue({} as never)
    wrapper.findAllComponents({ name: 'ElSelect' })[0]!.vm.$emit('update:modelValue', 'slot-b')
    await flushPromises()
    get.mockClear()
    await button(wrapper, '改到這個時段')!.trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/dashboard')
  })

  it('案件頁直接看到家長的改期申請並可核准或退回（退回可填原因）', async () => {
    const { wrapper } = await mountDetail(confirmedCase({ pending_reschedule: pendingReschedule() }))
    expect(wrapper.text()).toContain('家長申請改期')
    expect(wrapper.text()).toContain('2099/10/03（週六）14:00–15:00')
    expect(wrapper.text()).toContain('新時段剩 2 位')
    const confirm = confirmOk()
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    await button(wrapper, '核准改期')!.trigger('click')
    await flushPromises()
    expect(String(confirm.mock.calls[0]![0])).toContain('陳媽媽 的參觀時間會從 2099/10/01（週四）10:00–11:00 改到 2099/10/03（週六）14:00–15:00')
    expect(post).toHaveBeenCalledWith('/admin/reschedule-requests/req-1/approve')

    post.mockClear()
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: ' 當天校外教學 ', action: 'confirm' } as never)
    await button(wrapper, '退回申請')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/reschedule-requests/req-1/reject', { reason: '當天校外教學' })
  })

  it('申請的時段已經不能用時，核准按鈕停用並提示退回', async () => {
    const { wrapper } = await mountDetail(confirmedCase({
      pending_reschedule: pendingReschedule({ requested_slot_available: false, requested_slot_remaining: 0 }),
    }))
    expect(wrapper.text()).toContain('無法核准')
    expect(button(wrapper, '核准改期')!.attributes('disabled')).toBeDefined()
  })

  it('沒有處理權的帳號看不到改期與連結操作', async () => {
    const viewer = testUser('readonly', { campus_keys: ['yihua'], effective_capabilities: ['booking.read'] })
    const { wrapper } = await mountDetail(confirmedCase({ pending_reschedule: pendingReschedule() }), [listSlot(later)], viewer)
    for (const label of ['改到這個時段', '核准改期', '退回申請', '產生連結']) expect(button(wrapper, label)).toBeUndefined()
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
    await button(wrapper, '重新產生連結')!.trigger('click')
    await flushPromises()
    expect(String(confirm.mock.calls[0]![0])).toContain('先前給家長的連結會立即失效')
  })

  it('已有有效連結時只顯示期限，可以撤銷；結案的案件不顯示', async () => {
    const link = { created_at: '2026-09-24T00:00:00Z', expires_at: '2026-10-08T00:00:00Z' }
    const { wrapper } = await mountDetail(confirmedCase({ access_link: link }))
    expect(wrapper.text()).toContain('目前有一條有效連結')
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
    expect(visitEventChanges(cancelled)).toEqual(['已確認 → 已取消', '原參觀時間 2099/10/01（週四）10:00–11:00'])

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
    const timeline = wrapper.find('ol[aria-label="案件歷程"]')
    expect(timeline.exists()).toBe(true)
    const items = timeline.findAll('li').map(li => li.text())
    // 最新的在上面。
    expect(items[0]).toContain('取消預約')
    expect(items[0]).toContain('amy')
    expect(items[0]).toContain('原因：家長臨時出國')
    expect(items[1]).toContain('家長從官網送出')
    expect(wrapper.find('.notes__author').text()).toBe('amy')
  })
})

describe('家長改期申請：清單、通知與計數（第 4、19 條）', () => {
  async function mountNotifications(user: UserOut = testUser('super_admin', { campus_keys: ['yihua'] })) {
    const pinia = createPinia()
    useAuthStore(pinia).user = user
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/notifications'); await router.isReady()
    const wrapper = mount(NotificationsView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
    wrappers.push(wrapper); await flushPromises()
    return wrapper
  }

  it('清單顯示家長、原時段、申請的新時段與剩餘名額；通知連得到案件', async () => {
    vi.spyOn(api, 'get').mockImplementation(async path => (String(path).includes('notification-outbox') ? { items: [], total: 0 } : String(path).includes('reschedule-requests')
      ? [pendingReschedule()]
      : [{ id: 'n1', campus_key: 'yihua', kind: 'visit_reschedule_requested', payload: { campus_key: 'yihua', receipt_id: 'case-a', reschedule_request_id: 'req-1' }, created_at: '2026-09-24T02:00:00Z', read_at: null }]) as never)
    const wrapper = await mountNotifications()
    const text = wrapper.text()
    expect(text).toContain('陳媽媽')
    expect(text).toContain('2099/10/01（週四）10:00–11:00')
    expect(text).toContain('2099/10/03（週六）14:00–15:00')
    expect(text).toContain('剩 2 位')
    expect(text).toContain('家長申請改期（待園方核准）')
    expect(wrapper.findAll('a').some(a => a.attributes('href') === '/visit-requests/case-a')).toBe(true)

    const confirm = confirmOk()
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    await wrapper.findAll('button').find(b => b.text() === '核准')!.trigger('click')
    await flushPromises()
    expect(String(confirm.mock.calls[0]![0])).toContain('改到 2099/10/03（週六）14:00–15:00')
    expect(post).toHaveBeenCalledWith('/admin/reschedule-requests/req-1/approve')
  })

  it('待核准清單列出負責的所有校區，不跟著校區選單只看第一校', async () => {
    // 管明華、義華的分校管理者：校區選單預設明華，義華的申請也要看得到（側欄徽章算的是兩校）。
    const get = vi.spyOn(api, 'get').mockImplementation(async path => (String(path).startsWith('/admin/reschedule-requests')
      ? [pendingReschedule()]
      : []) as never)
    const wrapper = await mountNotifications(testUser('campus_admin', { campus_keys: ['minghua', 'yihua'] }))
    const paths = get.mock.calls.map(([path]) => String(path))
    expect(paths).toContain('/admin/reschedule-requests')
    expect(paths).toContain('/admin/notifications?campus_key=minghua')
    const panel = wrapper.find('section.reschedule')
    expect(panel.text()).toContain('待核准的改期申請（1）')
    expect(panel.text()).toContain('陳媽媽')
    expect(panel.text()).toContain('義華')

    // 切換校區只重讀那一校的通知，不會把待核准清單清掉。
    get.mockClear()
    wrapper.getComponent(CampusSelect).vm.$emit('update:modelValue', 'yihua')
    await flushPromises()
    expect(get.mock.calls.map(([path]) => String(path))).toEqual(['/admin/notifications?campus_key=yihua'])
    expect(wrapper.find('section.reschedule').text()).toContain('陳媽媽')
  })

  it('側欄的站內通知旁顯示待核准改期數，總覽列出待辦', async () => {
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: DashboardView }, { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/'); await router.isReady()
    vi.spyOn(api, 'get').mockResolvedValue({
      today_visits: 0, pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0,
      new_requests: 0, awaiting_confirmation: 0, next_hold_expires_at: null, pending_reschedule_requests: 3,
    } as never)
    const dashboard = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(dashboard); await flushPromises()
    expect(dashboard.text()).toContain('家長申請改期，等你核准')
    expect(dashboard.find('a.dash__primary').text()).toContain('核准改期申請')
    expect(useOpenRequestsStore(pinia).reschedules).toBe(3)

    const sidebar = mount(AdminSidebar, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(sidebar); await flushPromises()
    const badge = sidebar.findAll('.sidebar__badge').find(b => b.element.closest('a')!.getAttribute('href') === '/notifications')!
    expect(badge.text()).toBe('3 件改期待核准')
  })
})

describe('標籤與小工具', () => {
  it('新的通知 kind 與稽核動作有中文，已開始的場次判斷用台灣時間', () => {
    expect(NOTIFICATION_KIND_LABELS.visit_reschedule_requested).toBe('家長申請改期（待園方核准）')
    expect(visitEventTitle({
      id: 'e', event_type: 'reschedule_superseded', source: 'staff', actor_user_id: 'u1', actor_email: 'desk@ivy.example',
      before: null, after: { requested_slot: later }, reason: null, created_at: '2026-09-24T02:00:00Z',
    })).toBe('家長的改期申請失效（園方已直接改期）')
    for (const action of ['visit_request.create_access_link', 'visit_request.revoke_access']) expect(AUDIT_ACTION_LABELS[action]).toBeTruthy()
    const slot = { slot_date: '2026-09-26', start_time: '10:00:00' }
    expect(slotStarted(slot, Date.parse('2026-09-26T01:59:00Z'))).toBe(false)
    expect(slotStarted(slot, Date.parse('2026-09-26T02:00:00Z'))).toBe(true)
  })
})
