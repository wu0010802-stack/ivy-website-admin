import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import { useAuthStore } from '../stores/auth'
import DashboardView from '../views/DashboardView.vue'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import VisitDetailView from '../views/VisitDetailView.vue'
import AdminSidebar from '../components/AdminSidebar.vue'
import AdminLayout from '../layouts/AdminLayout.vue'
import { useOpenRequestsStore } from '../stores/openRequests'
import { api } from '../api/client'
import * as labels from '../api/labels'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const hour = 3600 * 1000
const summary = (changes: Record<string, unknown> = {}) => ({
  today_visits: 0, pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0,
  pending_reschedule_requests: 0, my_unread_notifications: 0, ...changes,
})
const request = (changes = {}) => ({
  id: 'case-a', campus_key: 'yihua', status: 'new', parent_name: '測試家長', phone: '0912345678', child_name: null,
  child_birthdate: null, email: null, referral_sources: [], age: null, preferred_time: null, questions: null,
  slot_id: null, slot: null, created_at: '2026-09-22T00:00:00Z', follow_up_at: null, ...changes,
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

describe('待確認占位的倒數已拿掉', () => {
  it('labels 不再有確認期限倒數的函式與舊狀態排序', () => {
    expect('formatHoldRemaining' in labels).toBe(false)
    expect('holdIsUrgent' in labels).toBe(false)
    expect('VISIT_STATUS_ORDER' in labels).toBe(false)
  })
})

describe('總覽的主按鈕與待辦（2026-10-05 拿掉待處理狀態後）', () => {
  it('舊案數字不再出現：沒有「場次預約等園方確認」「新的參觀需求還沒聯絡」，也沒有確認期限倒數', async () => {
    // 即使舊版 API 還多帶舊欄位，總覽也不看。
    vi.spyOn(api, 'get').mockResolvedValue(summary({ new_requests: 3, awaiting_confirmation: 2, next_hold_expires_at: new Date(Date.now() + 5 * hour).toISOString() }) as never)
    const { wrapper } = await mountAt('/')
    expect(wrapper.text()).not.toContain('場次預約等園方確認')
    expect(wrapper.text()).not.toContain('新的參觀需求還沒聯絡')
    expect(wrapper.text()).not.toContain('最早一筆還剩')
    const hrefs = wrapper.findAll('a').map(a => a.attributes('href'))
    expect(hrefs.some(href => /status=(new|pending_confirmation)/.test(href ?? ''))).toBe(false)
    expect(wrapper.find('.dash__primary').text()).toContain('查看參觀案件')
    expect(wrapper.find('.dash__primary').attributes('href')).toBe('/visit-requests')
  })

  it('營運摘要固定兩格：今日參觀、到期待追蹤，沒有 .is-attention 格', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(summary({ new_requests: 3, awaiting_confirmation: 2 }) as never)
    const { wrapper } = await mountAt('/')
    expect(wrapper.findAll('.dash__summary dt').map(dt => dt.text())).toEqual(['今日參觀', '到期待追蹤'])
    expect(wrapper.find('.dash__summary .is-attention').exists()).toBe(false)
  })

  it('主按鈕依序：家長還要來 → 改期申請 → 到期追蹤 → 查看參觀案件，字講的是點進去那一批', async () => {
    const cases: [Record<string, number>, string, string][] = [
      [{ needs_attention: 2, pending_reschedule_requests: 3, pending_follow_up: 5 }, '聯絡要改期的家長2', '/visit-requests?attention=1'],
      [{ pending_reschedule_requests: 3, pending_follow_up: 5 }, '核准改期申請3', '/notifications'],
      [{ pending_follow_up: 5 }, '追蹤到期案件5', '/visit-requests?due=1'],
      [{}, '查看參觀案件', '/visit-requests'],
    ]
    for (const [changes, label, href] of cases) {
      vi.spyOn(api, 'get').mockResolvedValue(summary(changes) as never)
      const { wrapper } = await mountAt('/')
      const primary = wrapper.find('.dash__primary')
      expect(primary.text()).toContain(label)
      expect(primary.attributes('href')).toBe(href)
      // 主按鈕帶去的那一批，待辦清單裡也有同一個入口（沒有待辦時主按鈕是預設入口，不在清單裡）。
      if (Object.keys(changes).length) expect(wrapper.findAll('a.task').map(a => a.attributes('href'))).toContain(href)
      wrapper.unmount(); wrappers.length = 0; vi.restoreAllMocks()
    }
  })

  it('舊版 API 沒有舊欄位時仍正常顯示，沒有待辦就說目前沒有待處理事項', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(summary() as never)
    const { wrapper } = await mountAt('/')
    expect(wrapper.text()).toContain('目前沒有待處理事項')
    expect(wrapper.find('.dash__primary').text()).toContain('查看參觀案件')
    expect(wrapper.find('.dash__primary').attributes('href')).toBe('/visit-requests')
  })
})

describe('案件列表接住總覽帶來的條件', () => {
  const listCallOf = (get: { mock: { calls: unknown[][] } }) => get.mock.calls.map(c => String(c[0])).find(p => p.startsWith('/admin/visit-requests?'))!

  it('?order=oldest 傳給後端，舊書籤 ?status=confirmed 轉成分組；列表不顯示確認期限，沒填的方便時段不佔一行', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([
      request({ status: 'confirmed', slot_id: 'slot-1', slot: { id: 'slot-1', slot_date: '2026-09-30', start_time: '10:00:00', end_time: '11:00:00' } }),
    ] as never)
    const { wrapper } = await mountAt('/visit-requests?status=confirmed&order=oldest')
    const listCall = listCallOf(get)
    expect(listCall).toContain('order=oldest')
    expect(listCall).toContain('group=upcoming') // 舊書籤的 ?status= 轉成分組
    expect(wrapper.text()).not.toContain('確認期限')
    expect(wrapper.find('.hold').exists()).toBe(false)
    expect(wrapper.find('.request-list').text()).not.toContain('方便時段')
  })

  it('舊的 ?group=pending 與 ?status=new|contacting|pending_confirmation 落到全部，不帶 group 給後端', async () => {
    for (const query of ['group=pending', 'status=new', 'status=contacting', 'status=pending_confirmation']) {
      const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
      const { wrapper } = await mountAt(`/visit-requests?${query}&order=oldest`)
      const listCall = listCallOf(get)
      expect(listCall, query).not.toContain('group=')
      expect(listCall, query).not.toContain('status=')
      expect(wrapper.findAll('.status-tab')[0]!.attributes('aria-pressed'), query).toBe('true')
      wrapper.unmount(); wrappers.length = 0; vi.restoreAllMocks()
    }
  })
})

describe('側欄不再掛待處理數字', () => {
  it('參觀案件旁沒有數字，即使 store 有改期與未讀通知數字也不掛', async () => {
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: [] })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/'); await router.isReady()
    const wrapper = mount(AdminSidebar, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    expect(wrapper.find('.sidebar__badge').exists()).toBe(false)
    useOpenRequestsStore(pinia).apply({ pending_reschedule_requests: 2, my_unread_notifications: 5, new_requests: 4, awaiting_confirmation: 7 } as never)
    await flushPromises()
    expect(wrapper.findAll('.sidebar__badge')).toHaveLength(0)
    for (const href of ['/visit-requests', '/notifications', '/releases']) {
      expect(wrapper.find(`a[href="${href}"]`).exists()).toBe(true)
      expect(wrapper.find(`a[href="${href}"] .sidebar__badge`).exists()).toBe(false)
    }
  })
})

describe('openRequests store（改期與未讀通知數字）', () => {
  it('30 秒內換頁不重抓，強制重抓才會打 API；讀不到時保留原數字', async () => {
    setActivePinia(createPinia())
    const store = useOpenRequestsStore()
    const get = vi.spyOn(api, 'get').mockResolvedValue(summary({ pending_reschedule_requests: 2, my_unread_notifications: 1 }) as never)
    await store.refresh()
    await store.refresh()
    expect(get).toHaveBeenCalledOnce()
    expect(store.reschedules).toBe(2)
    expect(store.myNotices).toBe(1)
    get.mockRejectedValueOnce(new Error('offline'))
    await store.refresh(true)
    expect(get).toHaveBeenCalledTimes(2)
    expect(store.reschedules).toBe(2)
  })

  it('登出（reset）後不接上一位使用者還在路上的彙總，舊請求回來也不改數字', async () => {
    setActivePinia(createPinia())
    const store = useOpenRequestsStore()
    let resolveOld!: (value: unknown) => void
    const get = vi.spyOn(api, 'get')
      .mockImplementationOnce(() => new Promise(r => { resolveOld = r }) as never)
      .mockResolvedValueOnce(summary({ pending_reschedule_requests: 1 }) as never)
    const old = store.loadSummary()
    store.reset()
    const next = await store.loadSummary<ReturnType<typeof summary>>()
    expect(get).toHaveBeenCalledTimes(2)
    expect(next.pending_reschedule_requests).toBe(1)
    resolveOld(summary({ pending_reschedule_requests: 9, my_unread_notifications: 9 }))
    await old
    expect(store.reschedules).toBe(1)
    expect(store.myNotices).toBe(0)
  })

  it('總覽載入的數字直接給 store，不必另外打一次', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(summary({ pending_reschedule_requests: 2 }) as never)
    const { wrapper } = await mountAt('/')
    expect(get).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('核准改期申請2')
  })

  it('連同外殼一起掛上時，進一次總覽只打一次 /admin/dashboard', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    // jsdom 沒有 scrollIntoView（外殼換頁時把主要內容捲回頂端）。
    const scroll = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = () => {}
    onTestFinished(() => { Element.prototype.scrollIntoView = scroll; vi.unstubAllGlobals() })
    const get = vi.spyOn(api, 'get').mockResolvedValue(summary({ pending_reschedule_requests: 1 }) as never)
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
    expect(wrapper.text()).toContain('核准改期申請1')
    // 換到別頁（數字 30 秒內不重抓），再回總覽：總覽自己讀一次，也只有一次。
    await router.push('/media'); await flushPromises()
    expect(dashboardCalls()).toBe(1)
    await router.push('/'); await flushPromises()
    expect(dashboardCalls()).toBe(2)
  })
})

describe('案件明細沒有確認期限與確認場次', () => {
  // 以前的待確認案件（舊資料）：已有場次，但後台不再有確認占位的操作。
  const held = () => request({
    status: 'pending_confirmation', slot_id: 'slot-1',
    slot: { id: 'slot-1', slot_date: '2026-09-30', start_time: '10:00:00', end_time: '11:00:00' },
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

  it('舊的待確認案件：沒有確認期限倒數、沒有「確認這個場次」，也不會打確認 API', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({})
    const { wrapper } = await mountDetail(held())
    expect(wrapper.find('.hold-deadline').exists()).toBe(false)
    expect(wrapper.find('.hold-status').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('確認期限')
    expect(wrapper.text()).not.toContain('還剩')
    expect(wrapper.findAll('button').some(button => button.text() === '確認這個場次')).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })
})
