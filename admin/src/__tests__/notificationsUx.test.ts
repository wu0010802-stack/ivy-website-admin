import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import NotificationsView from '../views/NotificationsView.vue'
import CampusSelect from '../components/CampusSelect.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })
function notification(id: string, campus_key = 'yihua') {
  return { id, campus_key, kind: 'visit_request_created', payload: { parent_name: id }, created_at: '2026-09-22T00:00:00Z', read_at: null }
}
async function setup(user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: ['yihua', 'renwu'] })) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/notifications')
  await router.isReady()
  const wrapper = mount(NotificationsView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  return wrapper
}

describe('通知操作與回應競態', () => {
  it('切換校區後，舊通知回應不覆蓋新校區', async () => {
    let resolveOld!: (value: unknown[]) => void
    const old = new Promise<unknown[]>(resolve => { resolveOld = resolve })
    vi.spyOn(api, 'get').mockImplementation(url => {
      if (String(url).includes('notification-outbox')) return Promise.resolve({ items: [], total: 0 }) as Promise<never>
      if (String(url).includes('reschedule-requests')) return Promise.resolve([]) as Promise<never>
      if (String(url).includes('renwu')) return Promise.resolve([notification('仁武新通知', 'renwu')]) as Promise<never>
      return old as Promise<never>
    })
    const wrapper = await setup()
    expect(wrapper.text()).toContain('正在讀取通知')
    expect(wrapper.text()).not.toContain('還沒有通知')
    wrapper.getComponent(CampusSelect).vm.$emit('update:modelValue', 'renwu')
    await flushPromises()
    expect(wrapper.text()).toContain('仁武新通知')
    resolveOld([notification('過時通知')])
    await flushPromises()
    expect(wrapper.text()).not.toContain('過時通知')
    expect(wrapper.text()).toContain('仁武新通知')
  })

  it('批次期間鎖住重複操作與校區切換，部分失敗保持未讀', async () => {
    vi.spyOn(api, 'get').mockImplementation(url => Promise.resolve(String(url).includes('notification-outbox') ? { items: [], total: 0 } : String(url).includes('reschedule-requests') ? [] : [notification('first'), notification('second')]) as Promise<never>)
    let resolveFirst!: () => void
    const first = new Promise<void>(resolve => { resolveFirst = resolve })
    const post = vi.spyOn(api, 'post').mockImplementationOnce(() => first as Promise<never>).mockRejectedValueOnce(new Error('offline'))
    const wrapper = await setup()
    await flushPromises()
    const bulk = wrapper.findAll('button').find(button => button.text() === '全部標記已讀')!
    await bulk.trigger('click')
    await bulk.trigger('click')
    wrapper.getComponent(CampusSelect).vm.$emit('update:modelValue', 'renwu')
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
    expect(wrapper.getComponent(CampusSelect).props('modelValue')).toBe('yihua')
    expect(wrapper.text()).toContain('標記中 0 / 2')
    resolveFirst()
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('已標記 1 則，1 則失敗')
    expect(wrapper.text()).toContain('2 則通知，1 則未讀')
  })
})

function failedItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, campus_key: 'renwu', visit_request_id: `case-${id}`, kind: 'visit_request_created', reason: null,
    status: 'failed', attempts: 5, error_code: 'SMTPAuthenticationError',
    created_at: '2026-09-22T00:00:00Z', next_attempt_at: '2026-09-22T00:20:00Z', requeued_at: null,
    delivered: { inbox: true, line: true, email: 0 }, ...overrides,
  }
}

function mockFailed(rows: unknown[], total = rows.length) {
  return vi.spyOn(api, 'get').mockImplementation(url => {
    const path = String(url)
    if (path.includes('notification-outbox')) return Promise.resolve({ items: rows, total }) as Promise<never>
    return Promise.resolve([]) as Promise<never>
  })
}

describe('寄送失敗的通知（第 2 條）', () => {
  it('列出所有負責校區的失敗通知、原因與已送到的管道，可逐則重新寄送', async () => {
    const get = mockFailed([
      failedItem('a'),
      failedItem('b', { campus_key: 'yihua', kind: 'visit_request_overdue', reason: 'hold_expiring', error_code: 'LinePushError', delivered: { inbox: true, line: false, email: 2 } }),
    ])
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const wrapper = await setup()
    await flushPromises()
    // 不帶校區：總覽的失敗數是所有校區加總，這裡要看得到同一批。
    expect(get).toHaveBeenCalledWith('/admin/notification-outbox')
    const text = wrapper.text()
    expect(text).toContain('寄送失敗（2）')
    expect(text).toContain('寄信伺服器帳號或密碼錯誤')
    expect(text).toContain('站內通知、LINE 群組')
    expect(text).toContain('案件逾期未處理：待確認的時段申請 6 小時內到期')
    expect(text).toContain('LINE 推播失敗')
    expect(text).toContain('站內通知、Email 2 人')

    const retry = wrapper.find('.failed .data-table').findAll('button').find(button => button.text() === '重新寄送')!
    await retry.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/notification-outbox/a/retry')
    expect(wrapper.text()).toContain('寄送失敗（1）')
  })

  it('全部重新寄送送出畫面上的每一則，並回報被略過的', async () => {
    mockFailed([failedItem('a'), failedItem('b')])
    const post = vi.spyOn(api, 'post').mockResolvedValue({ requeued: 1, skipped: 1 } as never)
    const wrapper = await setup()
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '全部重新寄送')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/notification-outbox/retry', { ids: ['a', 'b'] })
    expect(wrapper.text()).toContain('已排入 1 則重新寄送；1 則已被其他人處理或無法重送。')
  })

  it('失敗超過列表上限時標題顯示全部則數，並提示重新寄送後再按一次', async () => {
    const get = mockFailed([failedItem('a'), failedItem('b')], 350)
    const post = vi.spyOn(api, 'post').mockResolvedValue({ requeued: 2, skipped: 0 } as never)
    const wrapper = await setup()
    await flushPromises()
    // 標題和總覽的失敗數一致，不是畫面上列出的則數。
    expect(wrapper.text()).toContain('寄送失敗（350）')
    expect(wrapper.text()).toContain('這裡只列出最新的 2 則，另有 348 則沒有列出')

    // 重新寄送後，下一批補上來：告訴園方還要再按一次。
    get.mockImplementation(url => Promise.resolve(String(url).includes('notification-outbox')
      ? { items: [failedItem('c')], total: 348 }
      : []) as Promise<never>)
    await wrapper.findAll('button').find(button => button.text() === '全部重新寄送')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/notification-outbox/retry', { ids: ['a', 'b'] })
    expect(wrapper.text()).toContain('已排入 2 則重新寄送，約一分鐘內由系統重送。還有 348 則寄送失敗，請再按一次「全部重新寄送」。')
    expect(wrapper.text()).toContain('寄送失敗（348）')
    expect(wrapper.text()).toContain('這裡只列出最新的 1 則，另有 347 則沒有列出')
  })

  it('沒有處理權的帳號只看得到失敗清單，沒有重新寄送按鈕', async () => {
    mockFailed([failedItem('a')])
    const viewer = testUser('readonly', { campus_keys: ['renwu'], effective_capabilities: ['booking.read'] })
    const wrapper = await setup(viewer)
    await flushPromises()
    expect(wrapper.text()).toContain('寄送失敗（1）')
    const labels = wrapper.findAll('button').map(button => button.text())
    expect(labels).not.toContain('重新寄送')
    expect(labels).not.toContain('全部重新寄送')
  })

  it('站內通知的提醒顯示中文標題', async () => {
    vi.spyOn(api, 'get').mockImplementation(url => Promise.resolve(String(url).includes('?campus_key=') && String(url).includes('/admin/notifications')
      ? [{ id: 'n1', campus_key: 'yihua', kind: 'visit_request_overdue', payload: { receipt_id: 'c1', reason: 'new_unhandled' }, created_at: '2026-09-22T00:00:00Z', read_at: null },
         { id: 'n2', campus_key: 'yihua', kind: 'visit_upcoming', payload: { receipt_id: 'c2', slot_id: 's1' }, created_at: '2026-09-22T00:00:00Z', read_at: null }]
      : []) as Promise<never>)
    const wrapper = await setup()
    await flushPromises()
    expect(wrapper.text()).toContain('案件逾期未處理：新的參觀需求超過 24 小時尚未處理')
    expect(wrapper.text()).toContain('即將參觀（24 小時內）')
    expect(wrapper.text()).not.toContain('visit_upcoming')
  })
})
