// 2026-09-28 UX 檢視 F 組：總覽開著會跟著時間走、切回分頁才在背景重讀，
// 待審清單讀取失敗看得出來，待辦連結的可及名稱，以及依角色的引導語。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import type { UserOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import DashboardView from '../views/DashboardView.vue'
import { api } from '../api/client'
import { testUser } from './fixtures'

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
    const get = vi.spyOn(api, 'get').mockResolvedValue(summary({ pending_reschedule_requests: 1 }) as never)
    const wrapper = await mountDashboard()
    expect(wrapper.text()).toContain('家長申請改期，等你核准')
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
    expect(wrapper.text()).toContain('家長申請改期，等你核准')
    resolve(summary({ pending_reschedule_requests: 2 }))
    await flushPromises()
    expect(wrapper.find('.dash__primary').text()).toContain('核准改期申請2')
    expect(wrapper.text()).toContain('更新於 11:30')
  })

  it('開著過午夜：換日時自動重讀一次，上面的日期和下面的件數都是新的一天', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date('2026-09-29T15:59:10Z')) // 台北 23:59
    const get = vi.spyOn(api, 'get').mockResolvedValue(summary({ today_visits: 3 }) as never)
    const wrapper = await mountDashboard()
    const todayVisits = () => wrapper.findAll('.dash__summary > div').find(cell => cell.text().includes('今日參觀'))!.find('dd').text()
    expect(wrapper.find('.dash__date').text()).toBe('9月29日星期二')
    expect(todayVisits()).toBe('3組')

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
    expect(todayVisits()).toBe('1組')
    expect(wrapper.text()).toContain('更新於 00:00')

    // 同一天之內不再自動重讀（不是輪詢）。
    vi.advanceTimersByTime(30 * 60_000)
    await flushPromises()
    expect(dashboardCalls(get)).toBe(2)
  })

  it('換日後重讀失敗：寫出是哪天幾點的資料，也不每 30 秒重試', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date('2026-09-29T15:59:10Z')) // 台北 23:59
    const get = vi.spyOn(api, 'get').mockResolvedValue(summary({ pending_reschedule_requests: 1 }) as never)
    const wrapper = await mountDashboard()
    expect(wrapper.text()).toContain('更新於 23:59')
    get.mockRejectedValue(new Error('offline'))
    vi.advanceTimersByTime(60_000)
    await flushPromises()
    expect(dashboardCalls(get)).toBe(2)
    expect(wrapper.text()).toContain('沒有更新成功，仍是 09/29 23:59 的資料')
    expect(wrapper.text()).toContain('家長申請改期，等你核准')
    vi.advanceTimersByTime(10 * 60_000)
    await flushPromises()
    expect(dashboardCalls(get)).toBe(2)
  })

  it('按「重新整理」讀不到時留著原本的資料，並說明是幾點的資料', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date('2026-09-29T06:05:00Z'))
    const get = vi.spyOn(api, 'get').mockResolvedValue(summary({ pending_reschedule_requests: 3 }) as never)
    const wrapper = await mountDashboard()
    get.mockRejectedValueOnce(new Error('offline'))
    await wrapper.findAll('button').find(button => button.text() === '重新整理')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.el-alert').exists()).toBe(false)
    expect(wrapper.text()).toContain('家長申請改期，等你核准')
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
    expect(wrapper.find('.dash__summary').exists()).toBe(true)
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
      pending_reschedule_requests: 2,
      pending_publish: 1,
      pending_publish_items: [{ kind: 'home_about', campus_key: null, latest_version: 2, published_version: 1, updated_at: '2026-09-28T13:45:00Z' }],
    }) as never)
    const wrapper = await mountDashboard()
    const task = wrapper.findAll('a.task').find(link => link.text().includes('家長申請改期，等你核准'))!
    const names = task.attributes('aria-labelledby')!.split(' ').map(id => wrapper.find(`#${id}`).text())
    expect(names).toEqual(['2', '家長申請改期，等你核准', '查看改期申請 →'])
    expect(wrapper.find(`#${task.attributes('aria-describedby')}`).text()).toContain('家長用管理連結申請換場次')
    // 所有箭頭都包在 aria-hidden 裡。
    for (const link of wrapper.findAll('a')) {
      const arrows = link.findAll('[aria-hidden="true"]').filter(el => el.text() === '→').length
      expect(link.text().split('→').length - 1).toBe(arrows)
    }
    expect(wrapper.text()).toContain('有修改尚未發布・09/28 21:45 儲存')
  })
})

describe('總覽依角色說明今天的工作', () => {
  it('櫃台不提官網更新，常用工作有參觀案件（補登從那裡進去）', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(summary() as never)
    const wrapper = await mountDashboard(testUser('reception', { id: 'desk', campus_keys: ['yihua'] }))
    expect(wrapper.find('.dash__lead').text()).toBe('先確認今天的參觀，再處理要追蹤或改期的家長。')
    const shortcut = wrapper.findAll('.dash__links a').find(link => link.text().includes('查看參觀案件'))!
    expect(shortcut.attributes('href')).toBe('/visit-requests')
    expect(shortcut.text()).toContain('補登案件')
  })

  it('能編內容的人維持原本的引導語，不多一個參觀案件捷徑', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(summary() as never)
    const wrapper = await mountDashboard()
    expect(wrapper.find('.dash__lead').text()).toBe('先確認參觀安排，再處理家長需求與官網更新。')
    expect(wrapper.findAll('.dash__links a').some(link => link.text().includes('查看參觀案件'))).toBe(false)
  })
})
