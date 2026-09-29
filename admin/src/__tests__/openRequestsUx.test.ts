import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import DashboardView from '../views/DashboardView.vue'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import VisitDetailView from '../views/VisitDetailView.vue'
import AdminSidebar from '../components/AdminSidebar.vue'
import AdminLayout from '../layouts/AdminLayout.vue'
import { useOpenRequestsStore } from '../stores/openRequests'
import { api } from '../api/client'
import { formatHoldRemaining, holdIsUrgent } from '../api/labels'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const hour = 3600 * 1000
const summary = (changes = {}) => ({
  today_visits: 0, pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0,
  new_requests: 0, awaiting_confirmation: 0, next_hold_expires_at: null, ...changes,
})
const request = (changes = {}) => ({
  id: 'case-a', campus_key: 'yihua', status: 'new', parent_name: '測試家長', phone: '0912345678', child_name: null,
  child_birthdate: null, email: null, referral_sources: [], age: null, preferred_time: null, questions: null,
  slot_id: null, slot: null, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null, ...changes,
})

async function mountAt(path: string) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: [] })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: DashboardView },
      { path: '/visit-requests', component: VisitRequestsView },
      { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) },
    ],
  })
  await router.push(path); await router.isReady()
  const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper); await flushPromises()
  return { wrapper, router }
}

describe('待確認占位的倒數', () => {
  it('無條件捨去到小時或分鐘，過期講「已逾期」', () => {
    const now = Date.parse('2026-09-24T00:00:00Z')
    expect(formatHoldRemaining('2026-09-24T23:59:00Z', now)).toBe('還剩 23 小時')
    expect(formatHoldRemaining('2026-09-24T00:40:30Z', now)).toBe('還剩 40 分鐘')
    expect(formatHoldRemaining('2026-09-23T23:00:00Z', now)).toBe('已逾期')
    expect(formatHoldRemaining(null, now)).toBe('')
    expect(holdIsUrgent('2026-09-24T05:00:00Z', now)).toBe(true)
    expect(holdIsUrgent('2026-09-24T07:00:00Z', now)).toBe(false)
  })
})

describe('總覽看得到還沒處理的參觀案件', () => {
  it('新需求與待確認都有數字、有同定義的入口，不會說「沒有待處理事項」', async () => {
    const expires = new Date(Date.now() + 5 * hour + 60000).toISOString()
    vi.spyOn(api, 'get').mockResolvedValue(summary({ new_requests: 3, awaiting_confirmation: 2, next_hold_expires_at: expires }) as never)
    const { wrapper } = await mountAt('/')
    expect(wrapper.text()).not.toContain('目前沒有待處理事項')
    expect(wrapper.text()).toContain('時段預約等園方確認')
    expect(wrapper.text()).toContain('新的參觀需求還沒聯絡')
    expect(wrapper.text()).toContain('最早一筆還剩 5 小時')
    const hrefs = wrapper.findAll('a').map(a => a.attributes('href'))
    expect(hrefs).toContain('/visit-requests?status=new&order=oldest')
    expect(hrefs).toContain('/visit-requests?status=pending_confirmation&order=oldest')
    // 主按鈕只帶去最急的那批（待確認），數字也只算那一批，不是 3＋2。
    expect(wrapper.find('.dash__primary').text()).toContain('確認時段預約2')
    expect(wrapper.find('.dash__primary').attributes('href')).toBe('/visit-requests?status=pending_confirmation&order=oldest')
  })

  it('只有新需求時，主按鈕帶去新需求且數字相同', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(summary({ new_requests: 4 }) as never)
    const { wrapper } = await mountAt('/')
    expect(wrapper.find('.dash__primary').text()).toContain('聯絡新需求4')
    expect(wrapper.find('.dash__primary').attributes('href')).toBe('/visit-requests?status=new&order=oldest')
  })

  it('只有待確認時，主按鈕直接帶去待確認', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(summary({ awaiting_confirmation: 1, next_hold_expires_at: new Date(Date.now() + 20 * hour).toISOString() }) as never)
    const { wrapper } = await mountAt('/')
    expect(wrapper.find('.dash__primary').attributes('href')).toBe('/visit-requests?status=pending_confirmation&order=oldest')
  })

  it('主按鈕依序：待確認 → 家長還要來 → 改期申請 → 新需求 → 到期追蹤，字講的是點進去那一批', async () => {
    const cases: [Record<string, number>, string, string][] = [
      [{ awaiting_confirmation: 1, needs_attention: 2 }, '確認時段預約1', '/visit-requests?status=pending_confirmation&order=oldest'],
      [{ needs_attention: 2, pending_reschedule_requests: 3, new_requests: 4, pending_follow_up: 5 }, '聯絡要改期的家長2', '/visit-requests?attention=1'],
      [{ pending_reschedule_requests: 3, new_requests: 4, pending_follow_up: 5 }, '核准改期申請3', '/notifications'],
      [{ new_requests: 4, pending_follow_up: 5 }, '聯絡新需求4', '/visit-requests?status=new&order=oldest'],
      [{ pending_follow_up: 5 }, '追蹤到期案件5', '/visit-requests?due=1'],
    ]
    for (const [changes, label, href] of cases) {
      vi.spyOn(api, 'get').mockResolvedValue(summary(changes) as never)
      const { wrapper } = await mountAt('/')
      const primary = wrapper.find('.dash__primary')
      expect(primary.text()).toContain(label)
      expect(primary.attributes('href')).toBe(href)
      // 主按鈕帶去的那一批，待辦清單裡也有同一個入口。
      expect(wrapper.findAll('a.task').map(a => a.attributes('href'))).toContain(href)
      wrapper.unmount(); wrappers.length = 0; vi.restoreAllMocks()
    }
  })

  it('舊版 API 沒有新欄位時仍正常顯示', async () => {
    const { new_requests: _n, awaiting_confirmation: _a, next_hold_expires_at: _h, ...legacy } = summary()
    vi.spyOn(api, 'get').mockResolvedValue(legacy as never)
    const { wrapper } = await mountAt('/')
    expect(wrapper.text()).toContain('目前沒有待處理事項')
    expect(wrapper.find('.dash__primary').text()).toContain('查看參觀案件')
    expect(wrapper.find('.dash__primary').attributes('href')).toBe('/visit-requests')
  })
})

describe('案件列表接住總覽帶來的條件', () => {
  it('?order=oldest 傳給後端，待確認案件顯示確認期限，沒填的方便時段不佔一行', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([
      request({ status: 'pending_confirmation', slot_id: 'slot-1', slot: { id: 'slot-1', slot_date: '2026-09-30', start_time: '10:00:00', end_time: '11:00:00' }, hold_expires_at: new Date(Date.now() + 2 * hour + 60000).toISOString() }),
    ] as never)
    const { wrapper } = await mountAt('/visit-requests?status=pending_confirmation&order=oldest')
    const listCall = get.mock.calls.map(c => String(c[0])).find(p => p.startsWith('/admin/visit-requests?'))!
    expect(listCall).toContain('order=oldest')
    expect(listCall).toContain('status=pending_confirmation')
    expect(wrapper.text()).toContain('確認期限還剩 2 小時')
    expect(wrapper.find('.hold.is-due').exists()).toBe(true)
    expect(wrapper.find('.request-list').text()).not.toContain('方便時段')
  })
})

describe('側欄的待處理數字', () => {
  it('參觀案件旁顯示新需求＋待確認的總數，0 件時不顯示', async () => {
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: [] })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/'); await router.isReady()
    const wrapper = mount(AdminSidebar, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    expect(wrapper.find('.sidebar__badge').exists()).toBe(false)
    useOpenRequestsStore(pinia).apply({ new_requests: 4, awaiting_confirmation: 7 })
    await flushPromises()
    const badge = wrapper.find('.sidebar__badge')
    expect(badge.text()).toBe('11 件待處理')
    expect(badge.element.closest('a')!.getAttribute('href')).toBe('/visit-requests')
    expect(badge.attributes('title')).toBe('新需求 4 件、待園方確認 7 件')
  })

  it('30 秒內換頁不重抓，強制重抓才會打 API；讀不到時保留原數字', async () => {
    setActivePinia(createPinia())
    const store = useOpenRequestsStore()
    const get = vi.spyOn(api, 'get').mockResolvedValue(summary({ new_requests: 2, awaiting_confirmation: 1 }) as never)
    await store.refresh()
    await store.refresh()
    expect(get).toHaveBeenCalledOnce()
    expect(store.total).toBe(3)
    get.mockRejectedValueOnce(new Error('offline'))
    await store.refresh(true)
    expect(get).toHaveBeenCalledTimes(2)
    expect(store.total).toBe(3)
  })

  it('登出（reset）後不接上一位使用者還在路上的彙總，舊請求回來也不改數字', async () => {
    setActivePinia(createPinia())
    const store = useOpenRequestsStore()
    let resolveOld!: (value: unknown) => void
    const get = vi.spyOn(api, 'get')
      .mockImplementationOnce(() => new Promise(r => { resolveOld = r }) as never)
      .mockResolvedValueOnce(summary({ new_requests: 1 }) as never)
    const old = store.loadSummary()
    store.reset()
    const next = await store.loadSummary<ReturnType<typeof summary>>()
    expect(get).toHaveBeenCalledTimes(2)
    expect(next.new_requests).toBe(1)
    resolveOld(summary({ new_requests: 9, awaiting_confirmation: 9 }))
    await old
    expect(store.total).toBe(1)
  })

  it('總覽載入的數字直接給側欄，不必另外打一次', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(summary({ new_requests: 1, awaiting_confirmation: 1 }) as never)
    const { wrapper } = await mountAt('/')
    expect(get).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('確認時段預約1')
  })

  it('連同外殼一起掛上時，進一次總覽只打一次 /admin/dashboard', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    // jsdom 沒有 scrollIntoView（外殼換頁時把主要內容捲回頂端）。
    const scroll = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = () => {}
    onTestFinished(() => { Element.prototype.scrollIntoView = scroll; vi.unstubAllGlobals() })
    const get = vi.spyOn(api, 'get').mockResolvedValue(summary({ new_requests: 1 }) as never)
    const dashboardCalls = () => get.mock.calls.filter(call => call[0] === '/admin/dashboard').length
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: [] })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{
        path: '/', component: AdminLayout, children: [
          { path: '', component: DashboardView },
          { path: ':rest(.*)', component: defineComponent({ template: '<div />' }) },
        ],
      }],
    })
    await router.push('/'); await router.isReady()
    const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper); await flushPromises()
    expect(dashboardCalls()).toBe(1)
    expect(wrapper.text()).toContain('聯絡新需求1')
    // 換到別頁（側欄數字 30 秒內不重抓），再回總覽：總覽自己讀一次，也只有一次。
    await router.push('/media'); await flushPromises()
    expect(dashboardCalls()).toBe(1)
    await router.push('/'); await flushPromises()
    expect(dashboardCalls()).toBe(2)
  })
})

describe('案件明細的確認期限', () => {
  const held = (hoursLeft: number) => request({
    status: 'pending_confirmation', slot_id: 'slot-1',
    slot: { id: 'slot-1', slot_date: '2026-09-30', start_time: '10:00:00', end_time: '11:00:00' },
    hold_expires_at: new Date(Date.now() + hoursLeft * hour + 60000).toISOString(),
  })

  async function mountDetail(data: ReturnType<typeof request>) {
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: [] })
    const get = vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).endsWith('/contact-notes')) return [] as never
      if (path === '/admin/dashboard') return summary() as never
      if (String(path).startsWith('/admin/visit-requests?')) return [] as never
      return data as never
    })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/visit-requests/:id', component: VisitDetailView }, { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/visit-requests/case-a'); await router.isReady()
    const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper); await flushPromises()
    return { wrapper, get }
  }

  it('顯示剩多久，剩不到 6 小時改用暖色', async () => {
    const soon = await mountDetail(held(3))
    expect(soon.wrapper.find('.hold-deadline').text()).toContain('還剩 3 小時')
    expect(soon.wrapper.find('.hold-deadline').classes()).toContain('is-urgent')
    soon.wrapper.unmount(); wrappers.length = 0; vi.restoreAllMocks()
    const later = await mountDetail(held(20))
    expect(later.wrapper.find('.hold-deadline').classes()).not.toContain('is-urgent')
  })

  it('確認之後強制更新側欄數字', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(Promise.resolve({ value: '', action: 'confirm' }) as unknown as ReturnType<typeof ElMessageBox.confirm>)
    vi.spyOn(api, 'post').mockResolvedValue({})
    const { wrapper, get } = await mountDetail(held(10))
    await wrapper.findAll('button').find(button => button.text() === '確認已選場次')!.trigger('click')
    await flushPromises()
    expect(get.mock.calls.some(call => call[0] === '/admin/dashboard')).toBe(true)
  })
})
