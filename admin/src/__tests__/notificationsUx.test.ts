import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import NotificationsView from '../views/NotificationsView.vue'
import CampusSelect from '../components/CampusSelect.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { formatShortSlotWhen } from '../api/labels'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })
function notification(id: string, campus_key = 'yihua', slot_date = '2026-10-24') {
  return { id, campus_key, kind: 'visit_request_created', payload: { receipt_id: `case-${id}` }, slot: { slot_date, start_time: '14:00:00', end_time: '15:00:00' }, created_at: '2026-09-22T00:00:00Z', read_at: null }
}
async function setupWithRouter(user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid', campus_keys: ['yihua', 'renwu'] }), path = '/notifications') {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(NotificationsView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  return { wrapper, router }
}
async function setup(user?: Parameters<typeof setupWithRouter>[0]) {
  return (await setupWithRouter(user)).wrapper
}

describe('通知操作與回應競態', () => {
  it('切換校區後，舊通知回應不覆蓋新校區', async () => {
    let resolveOld!: (value: unknown[]) => void
    const old = new Promise<unknown[]>(resolve => { resolveOld = resolve })
    vi.spyOn(api, 'get').mockImplementation(url => {
      if (String(url).includes('notification-outbox')) return Promise.resolve({ items: [], total: 0 }) as Promise<never>
      if (String(url).includes('renwu')) return Promise.resolve([notification('仁武新通知', 'renwu', '2026-10-24')]) as Promise<never>
      return old as Promise<never>
    })
    const wrapper = await setup()
    expect(wrapper.text()).toContain('正在讀取通知')
    expect(wrapper.text()).not.toContain('還沒有通知')
    wrapper.getComponent(CampusSelect).vm.$emit('update:modelValue', 'renwu')
    await flushPromises()
    expect(wrapper.text()).toContain('10/24（週六）')
    resolveOld([notification('過時通知', 'yihua', '2026-10-31')])
    await flushPromises()
    expect(wrapper.text()).not.toContain('10/31（')
    expect(wrapper.text()).toContain('10/24（週六）')
  })

  it('全部標記已讀只送一次請求，期間鎖住重複操作與校區切換，完成後本機清單全變已讀', async () => {
    vi.spyOn(api, 'get').mockImplementation(url => Promise.resolve(String(url).includes('notification-outbox') ? { items: [], total: 0 } : [notification('first'), notification('second')]) as Promise<never>)
    let resolveBulk!: (value: { updated: number }) => void
    const pending = new Promise<{ updated: number }>(resolve => { resolveBulk = resolve })
    const post = vi.spyOn(api, 'post').mockImplementationOnce(() => pending as Promise<never>)
    const wrapper = await setup()
    await flushPromises()
    wrapper.getComponent(CampusSelect).vm.$emit('update:modelValue', 'yihua')
    await flushPromises()
    const bulk = wrapper.findAll('button').find(button => button.text() === '全部標記已讀')!
    await bulk.trigger('click')
    await bulk.trigger('click')
    wrapper.getComponent(CampusSelect).vm.$emit('update:modelValue', 'renwu')
    await flushPromises()
    // 一次呼叫就標完，不再逐筆；單一校區帶 campus_key。
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/admin/notifications/read-all?campus_key=yihua')
    expect(wrapper.getComponent(CampusSelect).props('modelValue')).toBe('yihua')
    expect(wrapper.text()).toContain('標記中')
    // 後端標了 5 則（含畫面上沒列出的更早未讀）：訊息用後端回的則數，畫面上的全變已讀。
    resolveBulk({ updated: 5 })
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('已標記 5 則為已讀（義華）')
    expect(wrapper.text()).toContain('2 則通知，0 則未讀')
    expect(wrapper.findAll('.notice.is-unread')).toHaveLength(0)
  })

  it('全部標記已讀失敗時顯示錯誤，清單維持未讀', async () => {
    vi.spyOn(api, 'get').mockImplementation(url => Promise.resolve(String(url).includes('notification-outbox') ? { items: [], total: 0 } : [notification('first'), notification('second')]) as Promise<never>)
    const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('offline'))
    const wrapper = await setup()
    await flushPromises()
    wrapper.getComponent(CampusSelect).vm.$emit('update:modelValue', 'yihua')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '全部標記已讀')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('標記失敗，請重試')
    expect(wrapper.text()).not.toContain('已標記')
    expect(wrapper.text()).toContain('2 則通知，2 則未讀')
    expect(wrapper.findAll('.notice.is-unread')).toHaveLength(2)
    // 失敗後按鈕恢復可再按。
    expect(wrapper.findAll('button').find(button => button.text() === '全部標記已讀')!.attributes('disabled')).toBeUndefined()
  })
})

describe('站內通知的校區範圍', () => {
  function mockList(rows: unknown[]) {
    return vi.spyOn(api, 'get').mockImplementation(url => Promise.resolve(String(url).includes('notification-outbox') ? { items: [], total: 0 } : rows) as Promise<never>)
  }

  it('管多校的人預設看全部校區，頁籤寫則數、未讀寫出在哪幾校', async () => {
    const get = mockList([notification('義華家長'), notification('仁武家長', 'renwu'), { ...notification('已讀'), read_at: '2026-09-23T00:00:00Z' }])
    const wrapper = await setup()
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/notifications')
    expect(wrapper.getComponent(CampusSelect).props('modelValue')).toBe('')
    expect(wrapper.getComponent(CampusSelect).props('allLabel')).toBe('全部校區')
    expect(wrapper.findAll('.status-tab').map(tab => tab.text())).toEqual(['全部3 則', '未讀2 則'])
    expect(wrapper.get('.notices__breakdown').text()).toBe('未讀：義華 1 則、仁武 1 則')
    // 螢幕報讀器讀得到整份清單的摘要。
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('全部校區 · 3 則通知，2 則未讀（義華 1 則、仁武 1 則）')
    // 全部校區時每則前面帶校名。
    expect(wrapper.findAll('.notice__meta').map(meta => meta.text())).toEqual(expect.arrayContaining([expect.stringMatching(/^仁武・參觀 /)]))
    expect(wrapper.text()).not.toContain('只列出最新的 100 則')
  })

  it('全部校區時「全部標記已讀」先列出會動到哪幾校，選先不要就不標', async () => {
    mockList([notification('a'), notification('b', 'renwu')])
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValueOnce('confirm' as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({ updated: 2 } as never)
    const wrapper = await setup()
    await flushPromises()
    const bulk = () => wrapper.findAll('button').find(button => button.text() === '全部標記已讀')!
    await bulk().trigger('click')
    await flushPromises()
    expect(String(confirm.mock.calls[0]![0])).toContain('義華 1 則、仁武 1 則，共 2 則未讀通知')
    expect(post).not.toHaveBeenCalled()
    await bulk().trigger('click')
    await flushPromises()
    // 全部校區不帶 campus_key，由後端標你負責的所有校區。
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/admin/notifications/read-all')
    expect(wrapper.text()).toContain('已標記 2 則為已讀（全部校區）')
    expect(wrapper.findAll('.notice.is-unread')).toHaveLength(0)
  })

  it('只管一校的人直接看那一校、不出現校區選單與校名；清單滿 100 則時說明只列出最新的', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => notification(`n${index}`))
    const get = mockList(rows)
    const wrapper = await setup(testUser('campus_admin', { id: 'ca', email: 'ca@example.invalid', campus_keys: ['yihua'] }))
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/notifications?campus_key=yihua')
    expect(wrapper.findComponent(CampusSelect).exists()).toBe(false)
    expect(wrapper.find('.notice__meta').text()).toMatch(/^參觀 /)
    expect(wrapper.text()).toContain('只列出最新的 100 則通知')
    expect(wrapper.text()).toContain('「全部標記已讀」會連沒有列出的未讀一併標記')

    // 後端一次標完資料庫裡全部未讀（比畫面上列出的 100 則多），訊息寫後端回的則數。
    const post = vi.spyOn(api, 'post').mockResolvedValue({ updated: 130 } as never)
    await wrapper.findAll('button').find(button => button.text() === '全部標記已讀')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/notifications/read-all?campus_key=yihua')
    expect(wrapper.text()).toContain('已標記 130 則為已讀（義華）')
    expect(wrapper.findAll('.notice.is-unread')).toHaveLength(0)
  })

  it('全部校區且清單滿 100 則時，確認框說明沒有列出的更早未讀也會一併標記', async () => {
    mockList(Array.from({ length: 100 }, (_, index) => notification(`n${index}`, index % 2 ? 'renwu' : 'yihua')))
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel')
    const post = vi.spyOn(api, 'post').mockResolvedValue({ updated: 0 } as never)
    const wrapper = await setup()
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '全部標記已讀')!.trigger('click')
    await flushPromises()
    expect(String(confirm.mock.calls[0]![0])).toContain('義華 50 則、仁武 50 則，共 100 則未讀通知')
    expect(String(confirm.mock.calls[0]![0])).toContain('沒有列出的更早未讀也會一併標記')
    expect(post).not.toHaveBeenCalled()
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
    vi.spyOn(api, 'get').mockImplementation(url => Promise.resolve(String(url).startsWith('/admin/notifications')
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

describe('站內通知的參觀場次', () => {
  it('每列寫出參觀日期時段（後端讀取時查的），沒有場次就不寫；整列連到案件', async () => {
    vi.spyOn(api, 'get').mockImplementation(url => Promise.resolve(String(url).includes('notification-outbox') ? { items: [], total: 0 } : [
      notification('n1', 'yihua', '2026-10-24'),
      { ...notification('n2'), slot: null },
    ]) as Promise<never>)
    const wrapper = await setup()
    await flushPromises()
    const rows = wrapper.findAll('.notice')
    expect(rows[0]!.get('.notice__meta').text()).toBe(`義華・參觀 ${formatShortSlotWhen({ slot_date: '2026-10-24', start_time: '14:00:00', end_time: '15:00:00' })}`)
    expect(rows[1]!.text()).not.toContain('參觀 ')
    expect(rows[0]!.get('a.notice__main').attributes('href')).toContain('/visit-requests/case-n1')
    expect(rows[0]!.get('a.notice__main').text()).toContain('新的參觀預約')
  })
})

describe('站內通知的版面（2026-10-05）', () => {
  function at(minutesAgo: number): string {
    return new Date(Date.now() - minutesAgo * 60_000).toISOString()
  }
  function mockRows(rows: unknown[]) {
    return vi.spyOn(api, 'get').mockImplementation(url => Promise.resolve(String(url).includes('notification-outbox') ? { items: [], total: 0 } : rows) as Promise<never>)
  }

  it('依台北日期分成今天、昨天與更早，列上只寫幾點幾分', async () => {
    const now = new Date()
    const taipei = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(d)
    const clock = (iso: string) => new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }).format(new Date(iso))
    const today = { ...notification('today'), created_at: now.toISOString() }
    const yesterday = { ...notification('yesterday'), created_at: new Date(`${taipei(new Date(now.getTime() - 86_400_000))}T12:00:00+08:00`).toISOString() }
    const older = { ...notification('older'), created_at: '2025-03-04T04:00:00Z' }
    mockRows([today, yesterday, older])
    const wrapper = await setup()
    await flushPromises()
    expect(wrapper.findAll('.notice-day__label').map(label => label.text())).toEqual(['今天', '昨天', '2025/03/04（週二）'])
    expect(wrapper.find('.notice__time').text()).toBe(clock(today.created_at))
    expect(wrapper.find('.notice__time').attributes('title')).toMatch(/^\d{4}\/\d{2}\/\d{2} /)
  })

  it('通知種類用圖示色調區分，已讀未讀看點與標題', async () => {
    mockRows([
      { ...notification('new'), created_at: at(1) },
      { ...notification('cancel'), kind: 'visit_request_cancelled', created_at: at(2), read_at: at(1) },
      { ...notification('soon'), kind: 'visit_upcoming', created_at: at(3) },
      { ...notification('late'), kind: 'visit_request_overdue', payload: { receipt_id: 'c', reason: 'new_unhandled' }, created_at: at(4) },
      { ...notification('odd'), kind: 'something_new', created_at: at(5) },
    ])
    const wrapper = await setup()
    await flushPromises()
    const rows = wrapper.findAll('.notice')
    expect(rows.map(row => row.attributes('data-tone'))).toEqual(['success', 'info', 'warning', 'danger', 'info'])
    expect(rows.map(row => row.classes('is-unread'))).toEqual([true, false, true, true, true])
    expect(rows[1]!.find('[aria-label="未讀"]').exists()).toBe(false)
    expect(rows[0]!.find('[aria-label="未讀"]').exists()).toBe(true)
  })

  it('「未讀」頁籤與校區寫進網址，返回時回到同一份清單', async () => {
    mockRows([{ ...notification('unread'), created_at: at(1) }, { ...notification('read', 'renwu'), created_at: at(2), read_at: at(1) }])
    const { wrapper, router } = await setupWithRouter(undefined, '/notifications?unread=1&campus=yihua')
    await flushPromises()
    expect(wrapper.getComponent(CampusSelect).props('modelValue')).toBe('yihua')
    expect(wrapper.findAll('.notice')).toHaveLength(1)
    expect(wrapper.findAll('.status-tab')[1]!.attributes('aria-pressed')).toBe('true')

    await wrapper.findAll('.status-tab')[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua' })
    wrapper.getComponent(CampusSelect).vm.$emit('update:modelValue', '')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('單校帳號的寄送失敗不列校區欄', async () => {
    vi.spyOn(api, 'get').mockImplementation(url => {
      const path = String(url)
      if (path.includes('notification-outbox')) return Promise.resolve({ items: [failedItem('a', { campus_key: 'yihua' })], total: 1 }) as Promise<never>
      return Promise.resolve([]) as Promise<never>
    })
    const wrapper = await setup(testUser('campus_admin', { id: 'ca', email: 'ca@example.invalid', campus_keys: ['yihua'] }))
    await flushPromises()
    const headers = wrapper.findAll('.failed th').map(th => th.text())
    expect(headers).not.toContain('校區')
    expect(wrapper.get('.failed .mobile-record').text()).not.toContain('校區')
  })

  it('切回分頁超過 60 秒才在背景重讀，清單留在畫面上', async () => {
    const start = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(start)
    const get = mockRows([{ ...notification('n1'), created_at: new Date(start).toISOString() }])
    const wrapper = await setup()
    await flushPromises()
    const reads = () => get.mock.calls.filter(([url]) => String(url).startsWith('/admin/notifications')).length
    expect(reads()).toBe(1)

    now.mockReturnValue(start + 30_000)
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(reads()).toBe(1)

    now.mockReturnValue(start + 61_000)
    window.dispatchEvent(new Event('focus'))
    // 背景重讀時不清空、不出現骨架。
    expect(wrapper.find('.notices__skeleton').exists()).toBe(false)
    expect(wrapper.findAll('.notice')).toHaveLength(1)
    await flushPromises()
    expect(reads()).toBe(2)
  })
})

describe('點開通知與家長稱呼（2026-10-05 業主裁定）', () => {
  function mockRows(rows: unknown[], failed: unknown[] = []) {
    return vi.spyOn(api, 'get').mockImplementation(url => Promise.resolve(String(url).includes('notification-outbox') ? { items: failed, total: failed.length } : rows) as Promise<never>)
  }

  it('通知列與寄送失敗都寫出家長稱呼，沒有（已匿名化）就不寫', async () => {
    mockRows(
      [{ ...notification('n1'), parent_name: '林小姐' }, { ...notification('n2'), parent_name: null }],
      [failedItem('f1', { parent_name: '陳媽媽' })],
    )
    const wrapper = await setup()
    await flushPromises()
    const rows = wrapper.findAll('.notice')
    expect(rows[0]!.get('.notice__who').text()).toBe('林小姐')
    expect(rows[0]!.get('a.notice__main').text()).toContain('新的參觀預約林小姐')
    expect(rows[1]!.find('.notice__who').exists()).toBe(false)
    expect(wrapper.get('.failed .data-table').text()).toContain('陳媽媽')
    expect(wrapper.get('.failed .mobile-record').text()).toContain('家長陳媽媽')
  })

  it('校區管理者點開一則就標成已讀，送不成功變回未讀', async () => {
    mockRows([{ ...notification('n1'), parent_name: '林小姐' }, { ...notification('n2'), parent_name: '王先生' }])
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce({} as never).mockRejectedValueOnce(new Error('offline'))
    const { wrapper, router } = await setupWithRouter(testUser('campus_admin', { id: 'ca', email: 'ca@example.invalid', campus_keys: ['yihua'] }))
    await flushPromises()
    await wrapper.findAll('a.notice__main')[0]!.trigger('click')
    expect(post).toHaveBeenCalledWith('/admin/notifications/n1/read')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/visit-requests/case-n1')
    expect(wrapper.findAll('.notice')[0]!.classes('is-unread')).toBe(false)

    // 已讀的再點不會重送。
    await wrapper.findAll('a.notice__main')[0]!.trigger('click')
    expect(post).toHaveBeenCalledTimes(1)

    // 中鍵開新分頁也算看過；這次送不成功，變回未讀。
    await wrapper.findAll('a.notice__main')[1]!.trigger('auxclick', { button: 1 })
    expect(post).toHaveBeenLastCalledWith('/admin/notifications/n2/read')
    await flushPromises()
    expect(wrapper.findAll('.notice')[1]!.classes('is-unread')).toBe(true)
  })

  it('櫃台點開不會改變已讀（標記仍限校區管理者以上）', async () => {
    mockRows([{ ...notification('n1'), parent_name: '林小姐' }])
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const desk = testUser('reception', { id: 'desk', email: 'desk@example.invalid', campus_keys: ['yihua'] })
    const wrapper = await setup(desk)
    await flushPromises()
    await wrapper.get('a.notice__main').trigger('click')
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
  })
})
