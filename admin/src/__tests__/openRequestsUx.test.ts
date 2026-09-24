import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import { useAuthStore } from '../stores/auth'
import DashboardView from '../views/DashboardView.vue'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import { api } from '../api/client'
import { formatHoldRemaining, holdIsUrgent } from '../api/labels'

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
  useAuthStore(pinia).user = { id: 'local-test', email: 'test@example.invalid', role: 'super_admin', is_active: true, campus_keys: [] }
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
    expect(wrapper.find('.dash__primary').text()).toContain('5')
  })

  it('只有待確認時，主按鈕直接帶去待確認', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(summary({ awaiting_confirmation: 1, next_hold_expires_at: new Date(Date.now() + 20 * hour).toISOString() }) as never)
    const { wrapper } = await mountAt('/')
    expect(wrapper.find('.dash__primary').attributes('href')).toBe('/visit-requests?status=pending_confirmation&order=oldest')
  })

  it('舊版 API 沒有新欄位時仍正常顯示', async () => {
    const { new_requests: _n, awaiting_confirmation: _a, next_hold_expires_at: _h, ...legacy } = summary()
    vi.spyOn(api, 'get').mockResolvedValue(legacy as never)
    const { wrapper } = await mountAt('/')
    expect(wrapper.text()).toContain('目前沒有待處理事項')
    expect(wrapper.find('.dash__primary').attributes('href')).toBe('/visit-requests?status=new&order=oldest')
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
