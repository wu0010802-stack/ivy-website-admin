// 2026-10-06 總覽改成「今天的行程板」：今天的參觀當主體（上午／下午、孩子、電話、承辦、
// 已到場也列）、本週五校小表取代「校區尚未開放」提醒卡、待辦只列有數字的、常用工作縮成一列。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import DashboardView from '../views/DashboardView.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
import type { UserOut } from '../api/types'

beforeAll(() => { Element.prototype.scrollIntoView = () => {} })
const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(w => w.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const base = () => ({
  today_visits: 0, today_visit_list: [], pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0,
})
const visit = (changes: Record<string, unknown>) => ({
  id: 'v1', parent_name: '林小姐', child_name: '小安', phone: '0912000001', status: 'confirmed', campus_key: 'yihua',
  start_time: '10:00:00', end_time: '11:00:00', assignee_display_name: null, assignee_email: null, ...changes,
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
      visit({ id: 'now', parent_name: '黃媽媽', campus_key: 'minghua', start_time: '12:00:00', end_time: '13:00:00', assignee_display_name: '怡君', assignee_email: 'desk@ivy.example' }),
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

    // 上午／下午分組，列內有孩子、電話連結、承辦人。
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
    expect(rows[2]!.text()).toContain('承辦：怡君')
    expect(rows[3]!.text()).toContain('承辦：未指派')
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
    const wrapper = await mountDashboard({ ...base(), pending_follow_up: 2, pending_reschedule_requests: 1, week_campuses: week() })
    const tasks = wrapper.findAll('.task')
    expect(tasks.map(t => t.get('h3').text())).toEqual(['家長申請改期，等你核准', '到期待追蹤'])
    expect(tasks[0]!.find('p').exists()).toBe(false)
    expect(wrapper.get('.dash__links').findAll('a').length).toBeGreaterThan(3)
    expect(wrapper.find('.dash__links small').exists()).toBe(false)
  })

  it('今天沒有參觀時寫清楚，不留空白板', async () => {
    const wrapper = await mountDashboard({ ...base(), week_campuses: week() })
    expect(wrapper.get('.today__empty').text()).toContain('今天沒有參觀')
  })
})
