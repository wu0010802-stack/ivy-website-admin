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

const hour = 3600 * 1000
const summary = (changes = {}) => ({
  today_visits: 0, pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0,
  new_requests: 0, awaiting_confirmation: 0, next_hold_expires_at: null, ...changes,
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
  it('倒數每 30 秒重算；切回分頁超過 30 秒才在背景重讀，保留舊資料、不閃骨架', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date('2026-09-29T02:00:00Z'))
    const expires = new Date(Date.now() + 5 * hour + 60000).toISOString()
    const get = vi.spyOn(api, 'get').mockResolvedValue(summary({ awaiting_confirmation: 1, next_hold_expires_at: expires }) as never)
    const wrapper = await mountDashboard()
    expect(wrapper.text()).toContain('最早一筆還剩 5 小時')
    expect(wrapper.text()).toContain('更新於 10:00')
    expect(dashboardCalls(get)).toBe(1)

    // 30 秒內切回來不重讀。
    vi.advanceTimersByTime(20_000)
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(dashboardCalls(get)).toBe(1)

    // 開著一個半小時：倒數跟著時鐘走，不必重新整理。
    vi.advanceTimersByTime(90 * 60_000)
    await flushPromises()
    expect(wrapper.text()).toContain('最早一筆還剩 3 小時')

    // 切回分頁：背景重讀，讀的期間畫面保留舊資料。
    let resolve!: (value: unknown) => void
    get.mockImplementationOnce(() => new Promise(r => { resolve = r }) as never)
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(dashboardCalls(get)).toBe(2)
    expect(wrapper.find('.el-skeleton').exists()).toBe(false)
    expect(wrapper.text()).toContain('時段預約等園方確認')
    resolve(summary({ awaiting_confirmation: 2, next_hold_expires_at: expires }))
    await flushPromises()
    expect(wrapper.find('.dash__primary').text()).toContain('確認時段預約2')
    expect(wrapper.text()).toContain('更新於 11:30')
  })

  it('按「重新整理」讀不到時留著原本的資料，並說明是幾點的資料', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date('2026-09-29T06:05:00Z'))
    const get = vi.spyOn(api, 'get').mockResolvedValue(summary({ new_requests: 3 }) as never)
    const wrapper = await mountDashboard()
    get.mockRejectedValueOnce(new Error('offline'))
    await wrapper.findAll('button').find(button => button.text() === '重新整理')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.el-alert').exists()).toBe(false)
    expect(wrapper.text()).toContain('新的參觀需求還沒聯絡')
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
})

describe('待辦連結的可及名稱', () => {
  it('整列連結用標題、數字與去處命名，說明段落放描述，箭頭不唸', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(summary({
      new_requests: 2,
      pending_publish: 1,
      pending_publish_items: [{ kind: 'home_about', campus_key: null, latest_version: 2, published_version: 1, updated_at: '2026-09-28T13:45:00Z' }],
    }) as never)
    const wrapper = await mountDashboard()
    const task = wrapper.findAll('a.task').find(link => link.text().includes('新的參觀需求還沒聯絡'))!
    const names = task.attributes('aria-labelledby')!.split(' ').map(id => wrapper.find(`#${id}`).text())
    expect(names).toEqual(['2', '新的參觀需求還沒聯絡', '從最早送出的開始聯絡 →'])
    expect(wrapper.find(`#${task.attributes('aria-describedby')}`).text()).toContain('家長送出後在等園方回電')
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
    expect(wrapper.find('.dash__lead').text()).toBe('先確認今天的參觀，再聯絡新需求與待確認的家長。')
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
