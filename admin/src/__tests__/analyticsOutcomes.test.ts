import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import BookingOutcomesSection from '../components/analytics/BookingOutcomesSection.vue'
import { api, ApiError } from '../api/client'
import type { BookingOutcomesOut, CampusOutcomeOut, OutcomeCountsOut, Role } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach((wrapper) => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const rate = (numerator: number, denominator: number) =>
  ({ value: denominator ? Math.round((numerator / denominator) * 1000) / 10 : null, numerator, denominator })

function counts(over: Partial<OutcomeCountsOut> = {}): OutcomeCountsOut {
  const base = {
    cases: 8, web_cases: 7, pending: 1, upcoming: 1, awaiting_attendance: 1, completed: 2, no_show: 1, cancelled: 2, unscheduled: 0,
    cancelled_by_reason: { parent: 1, staff: 0, hold_expired: 0, unknown: 1 },
    ...over,
  }
  const marked = base.completed + base.no_show
  return { ...base, attendance_rate: rate(base.completed, marked), no_show_rate: rate(base.no_show, marked), cancel_rate: rate(base.cancelled, base.cases) }
}

const EMPTY = { cases: 0, web_cases: 0, pending: 0, upcoming: 0, awaiting_attendance: 0, completed: 0, no_show: 0, cancelled: 0,
  cancelled_by_reason: { parent: 0, staff: 0, hold_expired: 0, unknown: 0 } }

function row(campusKey: string, over: Partial<OutcomeCountsOut> = {}, mode: string | null = 'slots'): CampusOutcomeOut {
  return { ...counts(over), campus_key: campusKey, active: true, booking_mode: mode, open_now: { legacy_pending: 1, awaiting_attendance: 2, follow_up_due: 3 } }
}

function outcomes(rows: CampusOutcomeOut[] = [row('yihua'), row('minghua', EMPTY, 'phone')], asOf = '2026-10-03T06:05:00Z'): BookingOutcomesOut {
  return { as_of: asOf, date_from: null, date_to: null, unit: 'visit_request', campuses: rows, totals: counts(),
    open_now_totals: { legacy_pending: 2, awaiting_attendance: 4, follow_up_due: 6 } }
}

async function mountSection(role: Role, props: Record<string, unknown> = {}, data: BookingOutcomesOut = outcomes()) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser(role, { campus_keys: ['yihua', 'minghua'] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/analytics')
  await router.isReady()
  const get = vi.spyOn(api, 'get').mockResolvedValue(data as never)
  const wrapper = mount(BookingOutcomesSection, {
    props: { range: null, campusKey: 'yihua', periodLabel: '開站至今', showCompare: true, ...props },
    global: { plugins: [pinia, router, ElementPlus] },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, get }
}

const caseLinks = (wrapper: VueWrapper) =>
  wrapper.findAll('a').map((link) => link.attributes('href')).filter((href) => href?.startsWith('/visit-requests'))

describe('預約結果', () => {
  it('寫出到場率、未到率、取消率（附分子分母），小樣本提示，還沒標記的另外寫', async () => {
    const { wrapper, get } = await mountSection('reception')
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('/admin/analytics/booking-outcomes')
    const text = wrapper.text()
    expect(text).toContain('66.7%（2/3）')
    expect(text).toContain('33.3%（1/3）')
    expect(text).toContain('25.0%（2/8）')
    expect(text).toContain('樣本較少')
    expect(text).toContain('另有 1 件參觀時間過了還沒標記')
    expect(text).toContain('家長自行取消 1・未記錄原因 1')
    expect(text).toContain('單位：預約案件數')
  })

  it('有案件權限的人點得進已套好篩選的案件列表', async () => {
    const { wrapper } = await mountSection('reception')
    expect(caseLinks(wrapper)).toEqual([
      '/visit-requests?campus=yihua&group=past&status=confirmed',
      '/visit-requests?campus=yihua&due=1',
      '/visit-requests?campus=yihua&group=pending',
    ])
  })

  it('只有統計權限的人只看數字，沒有連到案件的連結', async () => {
    const { wrapper } = await mountSection('editor')
    expect(caseLinks(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('你的帳號只能看統計數字')
    expect(wrapper.text()).toContain('3 件')
  })

  it('換校只換顯示的那一列不重抓；換期間才重抓', async () => {
    const { wrapper, get } = await mountSection('reception')
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('明華校目前的預約方式是「電話洽詢」')
    // 明華沒有任何案件：三個比率的分母都是 0，要寫「—」，不是 0%。
    expect(wrapper.findAll('.outcomes__rates dd.num').map((dd) => dd.text())).toEqual(['—', '—', '—'])
    await wrapper.setProps({ range: { from: '2026-09-01', to: '2026-09-30' } })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenLastCalledWith('/admin/analytics/booking-outcomes?from=2026-09-01&to=2026-09-30')
  })

  it('重新整理（refreshToken 變）時重抓，換校仍不重抓', async () => {
    const { wrapper, get } = await mountSection('reception')
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ refreshToken: 1 })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('五校比較表的比率：分母少寫「樣本較少」，夠多不寫，分母 0 只寫「—」', async () => {
    const data = outcomes([
      row('yihua', { completed: 2, no_show: 1, cancelled: 1, cases: 8 }),
      row('minghua', { completed: 15, no_show: 5, cancelled: 2, cases: 30 }),
      row('chongde', EMPTY),
    ])
    const { wrapper } = await mountSection('reception', {}, data)
    const cells = (key: string) => {
      const index = wrapper.findAll('thead th').findIndex((th) => th.text().includes('到場率'))
      const tr = wrapper.findAll('tbody tr').find((r) => r.text().includes(key))!
      return tr.findAll('td')[index - 1]!.text()
    }
    expect(cells('義華')).toContain('樣本較少')
    expect(cells('明華')).not.toContain('樣本較少')
    expect(cells('崇德')).toBe('—')
  })

  it('父層重算出同一段期間不會重抓', async () => {
    const { wrapper, get } = await mountSection('reception', { range: { from: '2026-09-01', to: '2026-09-30' } })
    await wrapper.setProps({ range: { from: '2026-09-01', to: '2026-09-30' } })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('五校比較每校一列加合計，比率附分子分母；不給 showCompare 就不畫', async () => {
    const { wrapper } = await mountSection('super_admin')
    const rows = wrapper.findAll('.stats-table tbody tr').map((tr) => tr.text())
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('義華')
    expect(rows[0]).toContain('66.7%（2/3）')
    expect(rows[1]).toContain('明華')
    expect(rows[1]).toContain('電話洽詢')
    expect(rows[2]).toContain('合計')
    const single = await mountSection('super_admin', { showCompare: false })
    expect(single.wrapper.find('.stats-table').exists()).toBe(false)
  })

  it('回應順序顛倒時只顯示最後一次選的期間', async () => {
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/analytics')
    await router.isReady()
    const resolvers: ((value: unknown) => void)[] = []
    vi.spyOn(api, 'get').mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve) }))
    const wrapper = mount(BookingOutcomesSection, {
      props: { range: null, campusKey: 'yihua', periodLabel: '開站至今', showCompare: false },
      global: { plugins: [pinia, router, ElementPlus] },
    })
    wrappers.push(wrapper)
    await wrapper.setProps({ range: { from: '2026-09-01', to: '2026-09-30' } })
    resolvers[1]!(outcomes([row('yihua', { cases: 5, web_cases: 5 })]))
    await flushPromises()
    resolvers[0]!(outcomes([row('yihua', { cases: 99, web_cases: 99 })]))
    await flushPromises()
    const casesStat = wrapper.findAll('.stat').find((stat) => stat.find('.stat__label').text() === '預約案件')!
    expect(casesStat.find('.stat__value').text()).toBe('5')
    expect(wrapper.text()).not.toContain('99')
  })

  it('讀取失敗顯示錯誤，不顯示 0', async () => {
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/analytics')
    await router.isReady()
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(500, null))
    const wrapper = mount(BookingOutcomesSection, {
      props: { range: null, campusKey: 'yihua', periodLabel: '開站至今', showCompare: true },
      global: { plugins: [pinia, router, ElementPlus] },
    })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('無法讀取預約結果')
    expect(wrapper.find('.stat__value').exists()).toBe(false)
  })

  async function mountPending(responses: (() => Promise<unknown>)[]) {
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/analytics')
    await router.isReady()
    let call = 0
    vi.spyOn(api, 'get').mockImplementation(() => responses[call++]!() as never)
    const wrapper = mount(BookingOutcomesSection, {
      props: { range: null, campusKey: 'yihua', periodLabel: '開站至今', showCompare: true },
      global: { plugins: [pinia, router, ElementPlus] },
    })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }

  it('換期間重抓失敗：不留上一期間的數字與比較表，只顯示錯誤', async () => {
    const wrapper = await mountPending([
      () => Promise.resolve(outcomes()),
      () => Promise.reject(new ApiError(500, null)),
    ])
    expect(wrapper.find('.stats-table').exists()).toBe(true)
    await wrapper.setProps({ range: { from: '2026-09-01', to: '2026-09-30' }, periodLabel: '2026/09/01–2026/09/30' })
    await flushPromises()
    expect(wrapper.text()).toContain('無法讀取預約結果')
    expect(wrapper.find('.stats-table').exists()).toBe(false)
    expect(wrapper.find('.stat__value').exists()).toBe(false)
  })

  it('換期間重抓中：標題與說明列仍是舊期間，整區變淡並標示忙碌', async () => {
    const wrapper = await mountPending([
      () => Promise.resolve(outcomes()),
      () => new Promise(() => {}),
    ])
    await wrapper.setProps({ range: { from: '2026-09-01', to: '2026-09-30' }, periodLabel: '2026/09/01–2026/09/30' })
    await flushPromises()
    expect(wrapper.text()).toContain('五校比較（開站至今）')
    expect(wrapper.text()).not.toContain('2026/09/01')
    expect(wrapper.find('.outcomes-section').classes()).toContain('is-updating')
    expect(wrapper.find('.outcomes-section').attributes('aria-busy')).toBe('true')
  })
})
