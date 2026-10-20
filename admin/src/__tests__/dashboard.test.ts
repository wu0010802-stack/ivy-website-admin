// 2026-10-06 總覽改成「今天的行程板」：今天的參觀當主體（上午／下午、孩子、電話、
// 已到場也列）、本週五校小表取代「校區尚未開放」提醒卡、待辦只列有數字的、常用工作縮成一列。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import ElementPlus from 'element-plus'
import DashboardView from '../views/DashboardView.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
import type { UserOut } from '../api/types'
import AdminLayout from '../layouts/AdminLayout.vue'
import AdminSidebar from '../components/AdminSidebar.vue'

beforeAll(() => { Element.prototype.scrollIntoView = () => {} })
const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(w => w.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const base = () => ({
  today_visits: 0, today_visit_list: [], pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0,
})
const visit = (changes: Record<string, unknown>) => ({
  id: 'v1', parent_name: '林小姐', child_name: '小安', phone: '0912000001', status: 'confirmed', campus_key: 'yihua',
  start_time: '10:00:00', end_time: '11:00:00', ...changes,
})
const week = () => [
  { campus_key: 'yihua', mode: 'slots', booked: 5, open: 7 },
  { campus_key: 'minghua', mode: 'slots', booked: 3, open: 6 },
  { campus_key: 'chongde', mode: 'paused', booked: 0, open: null },
  { campus_key: 'international', mode: 'phone', booked: 0, open: null },
  { campus_key: 'renwu', mode: 'paused', booked: 0, open: null },
]

async function mountDashboard(data: object, user: UserOut = testUser('super_admin')) {
  vi.spyOn(api, 'get').mockImplementation(async path => (path === '/admin/dashboard' ? data : []) as never)
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: DashboardView }, { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/'); await router.isReady()
  const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
  wrappers.push(wrapper); await flushPromises()
  return wrapper
}

describe('總覽＝今天的行程板', () => {
  it('標題是今天的參觀，摘要句寫各校幾組與幾組結束了還沒標記；沒有兩格大數字', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-06T12:30:00+08:00').getTime())
    const list = [
      visit({ id: 'ended', start_time: '10:00:00', end_time: '11:00:00' }),
      visit({ id: 'done', parent_name: '王先生', child_name: '小芸', status: 'completed', start_time: '10:00:00', end_time: '11:00:00' }),
      visit({ id: 'now', parent_name: '黃媽媽', campus_key: 'minghua', start_time: '12:00:00', end_time: '13:00:00' }),
      visit({ id: 'later', parent_name: '陳媽媽', start_time: '16:00:00', end_time: '17:00:00' }),
    ]
    const wrapper = await mountDashboard({ ...base(), today_visits: 4, today_visit_list: list, week_campuses: week() })
    expect(wrapper.get('.dash__title').text()).toBe('今天的參觀')
    expect(wrapper.get('.dash__date').text()).toContain('10月6日')
    const sum = wrapper.get('.dash__sum').text()
    expect(sum).toContain('義華 3 組')
    expect(sum).toContain('明華 1 組')
    expect(sum).toContain('1 組結束了還沒標記')
    expect(wrapper.find('.dash__summary').exists()).toBe(false)

    // 上午／下午分組，列內有孩子、電話連結。
    expect(wrapper.findAll('.today__group').map(g => g.text())).toEqual(['上午', '下午'])
    const rows = wrapper.findAll('.today li.today__row')
    expect(rows).toHaveLength(4)
    expect(rows[0]!.text()).toContain('小安')
    expect(rows[0]!.get('a[href="tel:0912000001"]').text()).toBe('0912000001')
    expect(rows[0]!.text()).toContain('還沒標記')
    expect(rows[0]!.find('.today__attendance').exists()).toBe(true)
    // 已到場的留在名單上：寫狀態、沒有到了／沒來。
    expect(rows[1]!.text()).toContain('已到場')
    expect(rows[1]!.find('.today__attendance').exists()).toBe(false)
    expect(rows[2]!.text()).toContain('進行中')
    expect(wrapper.text()).not.toContain('承辦')
    expect(rows[3]!.find('.today__attendance').exists()).toBe(false)
  })

  it('本週五校：已預約、還可約，未開放的給開放入口、自選場次的連到該校月曆；有這張表就不再放「校區尚未開放」卡', async () => {
    const wrapper = await mountDashboard({ ...base(), campuses_without_active_booking: ['chongde', 'renwu'], week_campuses: week() })
    const rows = wrapper.findAll('.dash__week tbody tr')
    expect(rows.map(r => r.get('th').text())).toEqual(['義華', '明華', '崇德', '國際', '仁武'])
    expect(rows[0]!.text()).toContain('5')
    expect(rows[0]!.text()).toContain('7')
    expect(rows[0]!.get('a').attributes('href')).toBe('/visit-calendar?campus=yihua')
    expect(rows[2]!.text()).toContain('未開放')
    expect(rows[2]!.get('a').attributes('href')).toBe('/booking')
    expect(rows[3]!.text()).toContain('電話')
    expect(wrapper.text()).not.toContain('校區尚未開放預約')
  })

  it('櫃台看本週表但沒有開放入口；舊版 API 沒有本週表時仍顯示「校區尚未開放」卡', async () => {
    const desk = testUser('reception', { id: 'desk', campus_keys: ['yihua', 'chongde'] })
    const wrapper = await mountDashboard({ ...base(), campuses_without_active_booking: ['chongde'], week_campuses: week().filter(w => ['yihua', 'chongde'].includes(w.campus_key)) }, desk)
    const rows = wrapper.findAll('.dash__week tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[1]!.text()).toContain('未開放')
    expect(rows[1]!.find('a').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('校區尚未開放預約')

    const old = await mountDashboard({ ...base(), campuses_without_active_booking: ['chongde'] }, desk)
    expect(old.find('.dash__week').exists()).toBe(false)
    expect(old.text()).toContain('校區尚未開放預約')
  })

  it('要處理只列有數字的，一列一件；常用工作是一列文字連結', async () => {
    const wrapper = await mountDashboard({ ...base(), pending_follow_up: 2, awaiting_attendance: 1, week_campuses: week() })
    const tasks = wrapper.findAll('.task')
    expect(tasks.map(t => t.get('h3').text())).toEqual(['到期待追蹤', '參觀時間過了，還沒標記到場'])
    expect(tasks[0]!.find('p').exists()).toBe(false)
    expect(wrapper.get('.dash__links').findAll('a').length).toBeGreaterThan(3)
    expect(wrapper.find('.dash__links small').exists()).toBe(false)
  })

  it('今天沒有參觀時寫清楚，不留空白板', async () => {
    const wrapper = await mountDashboard({ ...base(), week_campuses: week() })
    expect(wrapper.get('.today__empty').text()).toContain('今天沒有參觀')
  })
})

// ---- 併自 shellDashboard20261002.test.ts（2026-10-20 依功能整併測試檔）----
// 2026-10-02 後台 UX 稽核：外殼與總覽（dashboard-1、dashboard-3、dashboard-4、nav-1、nav-2、shell-1）。
describe('2026-10-02 外殼與總覽稽核', () => {
  beforeAll(() => {
    // AdminLayout 用 matchMedia 判斷手機版；jsdom 沒有。
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }),
    })
    Element.prototype.scrollIntoView = () => {}
  })

  const wrappers: VueWrapper[] = []
  afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks(); vi.useRealTimers() })

  const summary = (changes = {}) => ({
    today_visits: 0, today_visit_list: [], pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [],
    failed_notifications: 0, new_requests: 0, awaiting_confirmation: 0, next_hold_expires_at: null, ...changes,
  })

  async function mountAt(path: string, component: unknown) {
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin', { email: 'staff@ivy.example', campus_keys: [] })
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/', component: component as never, children: [{ path: ':rest(.*)*', component: { render: () => h('div') } }] },
      { path: '/login', name: 'login', component: { render: () => h('div') } },
    ] })
    await router.push(path)
    await router.isReady()
    const wrapper = mount(RouterView, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }

  async function mountDashboard(data: object) {
    vi.spyOn(api, 'get').mockImplementation(async path => (path === '/admin/dashboard' ? data : []) as never)
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: DashboardView }, { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) }],
    })
    await router.push('/'); await router.isReady()
    const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
    wrappers.push(wrapper); await flushPromises()
    return wrapper
  }

  describe('側欄：只有一項的「總覽」不畫收合標題（nav-1）', () => {
    it('營運總覽直接顯示，其他分組照常可收合；搜尋時照常顯示分組名', async () => {
      vi.spyOn(api, 'get').mockResolvedValue({} as never)
      const wrapper = await mountAt('/visit-requests', defineComponent({ render: () => h(AdminSidebar) }))
      expect(wrapper.find('[aria-controls="nav-overview"]').exists()).toBe(false)
      expect(wrapper.get('#nav-overview').isVisible()).toBe(true)
      expect(wrapper.get('#nav-overview').text()).toContain('營運總覽')
      expect(wrapper.find('[aria-controls="nav-visits"]').exists()).toBe(true)

      await wrapper.get('input[aria-label="搜尋後台功能"]').setValue('總覽')
      expect(wrapper.find('[aria-controls="nav-overview"]').exists()).toBe(true)
    })
  })

  describe('頁首分組（nav-2）', () => {
    it('我的帳號顯示「個人」，找不到頁面不顯示分組，不寫「管理後台」', async () => {
      vi.spyOn(api, 'get').mockResolvedValue({} as never)
      const account = await mountAt('/account', AdminLayout)
      expect(account.get('.top__group').text()).toBe('個人')

      const missing = await mountAt('/no-such-page', AdminLayout)
      expect(missing.find('.top__group').exists()).toBe(false)
      expect(missing.get('.top').text()).not.toContain('管理後台')
    })
  })

  describe('總覽的今日參觀（dashboard-1、dashboard-4）', () => {
    const list = [
      { id: 'a', parent_name: '周美玲', campus_key: 'yihua', start_time: '10:00:00', end_time: '11:00:00' },
      { id: 'b', parent_name: '王小明', campus_key: 'yihua', start_time: '11:30:00', end_time: '12:30:00' },
      { id: 'c', parent_name: '黃志明', campus_key: 'yihua', start_time: '16:00:00', end_time: '17:00:00' },
    ]

    // 2026-10-06 行程板：今天的參觀就是頁面主體，沒有「今日參觀」格與捲動連結。
    it('有名單時名單直接就是頁面主體，標題帶 today-title', async () => {
      const wrapper = await mountDashboard(summary({ today_visits: 3, today_visit_list: list }))
      expect(wrapper.find('.dash__summary').exists()).toBe(false)
      expect(wrapper.get('#today-title').text()).toBe('今天的參觀')
      expect(wrapper.findAll('.today li.today__row')).toHaveLength(3)
    })

    it('今天沒有參觀時連到預約正常的案件', async () => {
      const wrapper = await mountDashboard(summary())
      const empty = wrapper.get('.today__empty')
      expect(empty.text()).toContain('今天沒有參觀')
      expect(empty.get('a').attributes('href')).toBe('/visit-requests?group=upcoming')
    })

    it('有參觀但名單是空的：數字已排除，連結也帶 excluded=hide，點進去是同一批（2026-10-15）', async () => {
      const wrapper = await mountDashboard(summary({ today_visits: 2 }))
      const link = wrapper.get('.today__empty a')
      expect(wrapper.get('.today__empty').text()).toContain('今天有 2 組參觀')
      expect(link.attributes('href')).toBe('/visit-requests?group=upcoming&excluded=hide')
    })

    it('依台北現在時間標示已結束與進行中，狀態寫在時間旁', async () => {
      // 台北 12:00
      vi.useFakeTimers({ now: new Date('2026-10-02T04:00:00Z'), toFake: ['Date'] })
      const wrapper = await mountDashboard(summary({ today_visits: 3, today_visit_list: list }))
      const rows = wrapper.findAll('.today li.today__row')
      expect(rows[0]!.classes()).toContain('is-ended')
      expect(rows[0]!.get('.today__phase').text()).toBe('還沒標記')
      expect(rows[1]!.classes()).toContain('is-ongoing')
      expect(rows[1]!.get('.today__phase').text()).toBe('進行中')
      expect(rows[2]!.classes()).toEqual(['today__row'])
      expect(rows[2]!.text()).not.toMatch(/已結束|進行中/)
    })
  })

  describe('總覽待辦：參觀時間過了還沒標記到場（dashboard-1）', () => {
    it('有 awaiting_attendance 就列一項，連到時間已過、已確認的案件', async () => {
      const wrapper = await mountDashboard(summary({ awaiting_attendance: 2 }))
      const task = wrapper.findAll('a.task').find(a => a.text().includes('參觀時間過了，還沒標記到場'))!
      expect(task.attributes('href')).toBe('/visit-requests?group=past&status=confirmed&excluded=hide')
      expect(task.get('.task__number').text()).toBe('2')
      expect(wrapper.text()).not.toContain('目前沒有待處理事項')
    })

    it('舊版 API 沒有這個欄位時不列', async () => {
      const wrapper = await mountDashboard(summary())
      expect(wrapper.text()).not.toContain('還沒標記到場')
    })
  })
})

// ---- 併自 ux20260928F.test.ts（2026-10-20 依功能整併測試檔）----
// 2026-09-28 UX 檢視 F 組：總覽開著會跟著時間走、切回分頁才在背景重讀，
// 待審清單讀取失敗看得出來，待辦連結的可及名稱，以及依角色的引導語。
describe('2026-09-28 總覽跟著時間走（F）', () => {
  const wrappers: VueWrapper[] = []
  afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks(); vi.useRealTimers() })

  const summary = (changes = {}) => ({
    today_visits: 0, pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0,
    ...changes,
  })

  async function mountDashboard(user: UserOut = testUser('super_admin')) {
    const pinia = createPinia()
    useAuthStore(pinia).user = user
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: DashboardView }, { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) }],
    })
    await router.push('/'); await router.isReady()
    const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper); await flushPromises()
    return wrapper
  }

  const dashboardCalls = (get: { mock: { calls: unknown[][] } }) => get.mock.calls.filter(call => call[0] === '/admin/dashboard').length

  describe('總覽開著也跟著時間走', () => {
    it('切回分頁超過 30 秒才在背景重讀，保留舊資料、不閃骨架；總覽沒有確認期限倒數', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
      vi.setSystemTime(new Date('2026-09-29T02:00:00Z'))
      const get = vi.spyOn(api, 'get').mockResolvedValue(summary({ pending_follow_up: 1 }) as never)
      const wrapper = await mountDashboard()
      expect(wrapper.text()).toContain('到期待追蹤')
      expect(wrapper.text()).not.toContain('最早一筆還剩')
      expect(wrapper.text()).toContain('更新於 10:00')
      expect(dashboardCalls(get)).toBe(1)

      // 30 秒內切回來不重讀。
      vi.advanceTimersByTime(20_000)
      window.dispatchEvent(new Event('focus'))
      await flushPromises()
      expect(dashboardCalls(get)).toBe(1)

      // 開著一個半小時：同一天內不自動重讀（不是輪詢），也沒有倒數字樣。
      vi.advanceTimersByTime(90 * 60_000)
      await flushPromises()
      expect(wrapper.text()).not.toContain('最早一筆還剩')

      // 切回分頁：背景重讀，讀的期間畫面保留舊資料。
      let resolve!: (value: unknown) => void
      get.mockImplementationOnce(() => new Promise(r => { resolve = r }) as never)
      document.dispatchEvent(new Event('visibilitychange'))
      await flushPromises()
      expect(dashboardCalls(get)).toBe(2)
      expect(wrapper.find('.el-skeleton').exists()).toBe(false)
      expect(wrapper.text()).toContain('到期待追蹤')
      resolve(summary({ pending_follow_up: 2 }))
      await flushPromises()
      expect(wrapper.find('.dash__primary').text()).toContain('追蹤到期案件2')
      expect(wrapper.text()).toContain('更新於 11:30')
    })

    it('開著過午夜：換日時自動重讀一次，上面的日期和下面的件數都是新的一天', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
      vi.setSystemTime(new Date('2026-09-29T15:59:10Z')) // 台北 23:59
      const get = vi.spyOn(api, 'get').mockResolvedValue(summary({ today_visits: 3 }) as never)
      const wrapper = await mountDashboard()
      const todayVisits = () => wrapper.get('.dash__sum').text()
      expect(wrapper.find('.dash__date').text()).toBe('9月29日星期二')
      expect(todayVisits()).toBe('3 組')

      // 30 秒後還是同一天：只有時鐘走，不重讀。
      vi.advanceTimersByTime(30_000)
      await flushPromises()
      expect(dashboardCalls(get)).toBe(1)

      // 過了午夜：日期換成新的一天，也在背景重讀一次今天的參觀與件數。
      get.mockResolvedValue(summary({ today_visits: 1 }) as never)
      vi.advanceTimersByTime(30_000)
      await flushPromises()
      expect(dashboardCalls(get)).toBe(2)
      expect(wrapper.find('.dash__date').text()).toBe('9月30日星期三')
      expect(todayVisits()).toBe('1 組')
      expect(wrapper.text()).toContain('更新於 00:00')

      // 同一天之內不再自動重讀（不是輪詢）。
      vi.advanceTimersByTime(30 * 60_000)
      await flushPromises()
      expect(dashboardCalls(get)).toBe(2)
    })

    it('換日後重讀失敗：寫出是哪天幾點的資料，也不每 30 秒重試', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
      vi.setSystemTime(new Date('2026-09-29T15:59:10Z')) // 台北 23:59
      const get = vi.spyOn(api, 'get').mockResolvedValue(summary({ pending_follow_up: 1 }) as never)
      const wrapper = await mountDashboard()
      expect(wrapper.text()).toContain('更新於 23:59')
      get.mockRejectedValue(new Error('offline'))
      vi.advanceTimersByTime(60_000)
      await flushPromises()
      expect(dashboardCalls(get)).toBe(2)
      expect(wrapper.text()).toContain('沒有更新成功，仍是 09/29 23:59 的資料')
      expect(wrapper.text()).toContain('到期待追蹤')
      vi.advanceTimersByTime(10 * 60_000)
      await flushPromises()
      expect(dashboardCalls(get)).toBe(2)
    })

    it('按「重新整理」讀不到時留著原本的資料，並說明是幾點的資料', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
      vi.setSystemTime(new Date('2026-09-29T06:05:00Z'))
      const get = vi.spyOn(api, 'get').mockResolvedValue(summary({ pending_follow_up: 3 }) as never)
      const wrapper = await mountDashboard()
      get.mockRejectedValueOnce(new Error('offline'))
      await wrapper.findAll('button').find(button => button.text() === '重新整理')!.trigger('click')
      await flushPromises()
      expect(wrapper.find('.el-alert').exists()).toBe(false)
      expect(wrapper.text()).toContain('到期待追蹤')
      expect(wrapper.text()).toContain('沒有更新成功，仍是 14:05 的資料')
    })
  })

  describe('待審清單讀不到時看得出來', () => {
    it('留一列提醒並可重新載入，不會說「目前沒有待處理事項」', async () => {
      let reviewsOk = false
      vi.spyOn(api, 'get').mockImplementation(async path => {
        if (path === '/admin/dashboard') return summary({ pending_review: 1 }) as never
        if (path === '/admin/content-reviews') {
          if (!reviewsOk) throw new Error('offline')
          return [{ kind: 'home_hero', campus_key: null, revision_id: 'rv1', submitted_by_email: null }] as never
        }
        return [] as never
      })
      const wrapper = await mountDashboard()
      expect(wrapper.text()).toContain('送審清單讀取失敗')
      expect(wrapper.text()).not.toContain('目前沒有待處理事項')
      reviewsOk = true
      await wrapper.findAll('button').find(button => button.text() === '重新載入送審清單')!.trigger('click')
      await flushPromises()
      expect(wrapper.text()).not.toContain('送審清單讀取失敗')
      expect(wrapper.text()).toContain('內容等你審核')
    })

    it('待審清單還在讀時不先說「目前沒有待處理事項」，讀到再列出來', async () => {
      let resolveReviews!: (value: unknown) => void
      vi.spyOn(api, 'get').mockImplementation(path => {
        if (path === '/admin/dashboard') return Promise.resolve(summary({ pending_review: 1 })) as never
        if (path === '/admin/content-reviews') return new Promise(r => { resolveReviews = r }) as never
        return Promise.resolve([]) as never
      })
      const wrapper = await mountDashboard()
      // 彙總已經回來（參觀數字先出現），待審清單還在路上。
      expect(wrapper.find('.dash__sum').exists()).toBe(true)
      expect(wrapper.text()).not.toContain('目前沒有待處理事項')
      expect(wrapper.text()).toContain('正在讀取送審清單')
      resolveReviews([{ kind: 'home_hero', campus_key: null, revision_id: 'rv1', submitted_by_email: null }])
      await flushPromises()
      expect(wrapper.text()).toContain('內容等你審核')
      expect(wrapper.text()).not.toContain('正在讀取送審清單')
      expect(wrapper.text()).not.toContain('目前沒有待處理事項')
    })

    it('待審清單讀回來是空的（例如已經有人審完），才說「目前沒有待處理事項」', async () => {
      let resolveReviews!: (value: unknown) => void
      vi.spyOn(api, 'get').mockImplementation(path => {
        if (path === '/admin/dashboard') return Promise.resolve(summary({ pending_review: 1 })) as never
        if (path === '/admin/content-reviews') return new Promise(r => { resolveReviews = r }) as never
        return Promise.resolve([]) as never
      })
      const wrapper = await mountDashboard()
      expect(wrapper.text()).not.toContain('目前沒有待處理事項')
      resolveReviews([])
      await flushPromises()
      expect(wrapper.text()).not.toContain('正在讀取送審清單')
      expect(wrapper.text()).toContain('目前沒有待處理事項')
    })
  })

  describe('待辦連結的可及名稱', () => {
    it('整列連結用標題、數字與去處命名，說明段落放描述，箭頭不唸', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(summary({
        pending_follow_up: 2,
        pending_publish: 1,
        pending_publish_items: [{ kind: 'home_about', campus_key: null, latest_version: 2, published_version: 1, updated_at: '2026-09-28T13:45:00Z' }],
      }) as never)
      const wrapper = await mountDashboard()
      const task = wrapper.findAll('a.task').find(link => link.text().includes('到期待追蹤'))!
      const names = task.attributes('aria-labelledby')!.split(' ').map(id => wrapper.find(`#${id}`).text())
      expect(names).toEqual(['2', '到期待追蹤', '查看'])
      expect(wrapper.find(`#${task.attributes('aria-describedby')}`).text()).toContain('之前記下「下次聯絡」的案件到期了')
      // 所有箭頭都包在 aria-hidden 裡。
      for (const link of wrapper.findAll('a')) {
        const arrows = link.findAll('[aria-hidden="true"]').filter(el => el.text() === '→').length
        expect(link.text().split('→').length - 1).toBe(arrows)
      }
      expect(wrapper.text()).toContain('有修改尚未發布・09/28 21:45 儲存')
    })
  })

  describe('總覽的常用連結依角色（2026-10-06 行程板：一列文字連結，沒有引導語）', () => {
    it('櫃台有補登案件（從案件列表進去）與查看參觀場次，沒有內容入口', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(summary() as never)
      const wrapper = await mountDashboard(testUser('reception', { id: 'desk', campus_keys: ['yihua'] }))
      expect(wrapper.find('.dash__lead').exists()).toBe(false)
      const links = wrapper.findAll('.dash__links a').map(link => [link.text(), link.attributes('href')])
      expect(links).toEqual([['補登案件', '/visit-requests'], ['查看參觀場次', '/visit-calendar']])
    })

    it('總管理者多了設定場次與內容入口', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(summary() as never)
      const wrapper = await mountDashboard()
      const titles = wrapper.findAll('.dash__links a').map(link => link.text())
      expect(titles).toEqual(['補登案件', '設定參觀場次', '更新首頁文字', '修改各校資料', '上傳素材', '管理使用者'])
    })
  })
})
