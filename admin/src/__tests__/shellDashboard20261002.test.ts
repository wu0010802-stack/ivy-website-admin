// 2026-10-02 後台 UX 稽核：外殼與總覽（dashboard-1、dashboard-3、dashboard-4、nav-1、nav-2、shell-1）。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import ElementPlus from 'element-plus'
import AdminLayout from '../layouts/AdminLayout.vue'
import AdminSidebar from '../components/AdminSidebar.vue'
import DashboardView from '../views/DashboardView.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

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
    expect(task.attributes('href')).toBe('/visit-requests?group=past&status=confirmed')
    expect(task.get('.task__number').text()).toBe('2')
    expect(wrapper.text()).not.toContain('目前沒有待處理事項')
  })

  it('舊版 API 沒有這個欄位時不列', async () => {
    const wrapper = await mountDashboard(summary())
    expect(wrapper.text()).not.toContain('還沒標記到場')
  })
})
