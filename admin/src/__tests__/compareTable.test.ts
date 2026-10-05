import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import CompareTable from '../components/admissions/CompareTable.vue'
import StatsTab from '../components/admissions/StatsTab.vue'
import type { AdmissionsCompare, AdmissionsCompareRow, AdmissionsStats } from '../api/types'
import { button, cleanup, deferred, mockGet, mountWith, pathsTo } from './admissionsTestKit'

afterEach(cleanup)

// get() 回傳的型別不含 exists，沿用 statsTab.test.ts 的別名。
type Dom = Omit<DOMWrapper<Element>, 'exists'>

const ALL = ['yihua', 'minghua', 'chongde', 'international', 'renwu']
const rate = (value: number | null, numerator: number, denominator: number) => ({ value, numerator, denominator })
const NO_RATE = rate(null, 0, 0)

function row(campusKey: string, changes: Partial<AdmissionsCompareRow> = {}): AdmissionsCompareRow {
  return {
    campus_key: campusKey, visit: 0, deposit: 0, enrolled: 0, transfer_term: 0, effective_deposit: 0, pending_deposit: 0,
    visit_to_deposit_rate: NO_RATE, visit_to_enrolled_rate: NO_RATE, deposit_to_enrolled_rate: NO_RATE,
    effective_to_enrolled_rate: NO_RATE, target_seats: null, remaining_seats: null, grades_with_target: 0, ...changes,
  }
}

// 義華、明華、仁武取自 C2 test_compare_rows_and_seats／test_compare_without_targets 的期望值；
// 崇德是超額：計畫 2，已保留 3。
const YIHUA = row('yihua', {
  visit: 4, deposit: 3, enrolled: 1, effective_deposit: 3, pending_deposit: 2,
  visit_to_deposit_rate: rate(75, 3, 4), visit_to_enrolled_rate: rate(25, 1, 4),
  deposit_to_enrolled_rate: rate(33.3, 1, 3), effective_to_enrolled_rate: rate(33.3, 1, 3),
  target_seats: 10, remaining_seats: 8, grades_with_target: 2,
})
const MINGHUA = row('minghua', { visit: 1, visit_to_deposit_rate: rate(0, 0, 1), visit_to_enrolled_rate: rate(0, 0, 1) })
const CHONGDE = row('chongde', {
  visit: 3, deposit: 3, effective_deposit: 3, pending_deposit: 3,
  visit_to_deposit_rate: rate(100, 3, 3), visit_to_enrolled_rate: rate(0, 0, 3),
  deposit_to_enrolled_rate: rate(0, 0, 3), effective_to_enrolled_rate: rate(0, 0, 3),
  target_seats: 2, remaining_seats: -1, grades_with_target: 1,
})
const RENWU = row('renwu')

const compare = (rows: AdmissionsCompareRow[], schoolYear = 115, semester: number | null = 1): AdmissionsCompare => ({
  as_of: '2026-10-01T04:00:00Z', school_year: schoolYear, semester, seat_semester: semester ?? 1, rows,
})

const cells = (tr: Dom) => tr.findAll('th, td').map((cell) => cell.text())
const headers = (root: VueWrapper | Dom) => root.findAll('thead th').map((th) => th.text())
const bodyRows = (root: VueWrapper | Dom) => root.findAll('tbody tr').map(cells)
const tabTexts = (wrapper: VueWrapper) => wrapper.findAll('.stats-subtabs .el-tabs__item').map((tab) => tab.text())
const statsProps = (changes: Record<string, unknown> = {}) => ({ campusKey: 'yihua', schoolYear: 115, semester: 1, campusKeys: ALL, ...changes })

// 統計本身不是這支測試的重點：一筆訪視的最小資料，讓子分頁出現。
function quietStats(): AdmissionsStats {
  const snap = {
    visit: 1, deposit: 0, enrolled: 0, transfer_term: 0, pending_deposit: 0, effective_deposit: 0,
    visit_to_deposit_rate: 0, visit_to_enrolled_rate: 0, deposit_to_enrolled_rate: null, effective_to_enrolled_rate: null,
  }
  const diff = { current: 1, previous: 0, delta: 1 }
  const rateDiff = { current: null, previous: null, delta: null }
  return {
    as_of: '2026-10-01T04:00:00Z',
    filters: { campus_key: 'yihua', school_year: 115, semester: 1, reference_month: null },
    reference_month: '115.09',
    kpi: { ...snap, unique_visit: 1, unique_deposit: 0 },
    decision_summary: { current_month: snap, rolling_30d: snap, rolling_90d: snap, ytd: snap },
    funnel_snapshot: { visit: 1, deposit: 0, enrolled: 0, transfer_term: 0, effective_deposit: 0, pending_deposit: 0 },
    month_over_month: {
      current_month: '115.09', previous_month: '115.08', visit: diff, deposit: diff, enrolled: diff, effective_deposit: diff,
      pending_deposit: diff, visit_to_deposit_rate: rateDiff, visit_to_enrolled_rate: rateDiff,
      deposit_to_enrolled_rate: rateDiff, effective_to_enrolled_rate: rateDiff,
    },
    alerts: [], top_action_queue: [], monthly: [{ month: '115.09', ...snap }], by_year: [{ year: '115', ...snap }],
    by_grade: [], month_grade: {}, by_source: [], top_source_names: [], by_referrer: [],
    referrer_source_cross: { referrers: [], sources: [] }, no_deposit_reasons: [], no_deposit_total: 0,
    no_deposit_priority: { high: 0, medium: 0, low: 0, other: 0 },
    no_deposit_summary: { high_potential_count: 0, overdue_followup_count: 0, cold_count: 0, high_potential_backlog_count: 0 },
  }
}

async function openCompare(wrapper: VueWrapper): Promise<Dom> {
  const tab = wrapper.findAll('.stats-subtabs .el-tabs__item').find((item) => item.text() === '五校比較')!
  await tab.trigger('click')
  await flushPromises()
  return wrapper.get('#pane-stats-compare')
}

describe('五校比較表（規格 9.3）', () => {
  it('每校一列：招生案件數、比率寫分子分母；不顯示計畫名額與名額剩餘（名額規劃已拿掉）', async () => {
    const { wrapper } = await mountWith(CompareTable, { props: { rows: [YIHUA, MINGHUA, CHONGDE, RENWU], schoolYear: 115, semester: 1 } })

    expect(wrapper.get('.stats-block__title').text()).toBe('五校比較（115 上學期）')
    expect(wrapper.text()).toContain('數字是招生案件數')
    expect(wrapper.text()).toContain('不是跨校去重後的孩子數')
    expect(headers(wrapper)).toEqual([
      '校區', '參觀', '預繳', '註冊', '有效預繳', '預繳未註冊',
      '參觀→預繳率', '參觀→註冊率', '預繳→註冊率', '排除轉期→註冊率',
    ])
    expect(bodyRows(wrapper)).toEqual([
      ['義華', '4', '3', '1', '3', '2', '75.0%（3/4）', '25.0%（1/4）', '33.3%（1/3）', '33.3%（1/3）'],
      ['明華', '1', '0', '0', '0', '0', '0.0%（0/1）', '0.0%（0/1）', '—（0/0）', '—（0/0）'],
      ['崇德', '3', '3', '0', '3', '3', '100.0%（3/3）', '0.0%（0/3）', '0.0%（0/3）', '0.0%（0/3）'],
      ['仁武', '0', '0', '0', '0', '0', '—（0/0）', '—（0/0）', '—（0/0）', '—（0/0）'],
    ])
    expect(wrapper.text()).not.toContain('名額')
  })
})

describe('統計分頁的「五校比較」子分頁', () => {
  it('只看得到一個校區：沒有這個子分頁，也不讀 compare', async () => {
    const get = mockGet({ '/admin/admissions/stats': quietStats() })
    const { wrapper } = await mountWith(StatsTab, { props: statsProps({ campusKeys: ['yihua'] }) })

    expect(tabTexts(wrapper)).toEqual(['總覽', '班別分析', '來源分析', '接待分析', '未預繳原因'])
    expect(pathsTo(get, '/admin/admissions/compare')).toEqual([])
  })

  it('多校：切到五校比較才讀，帶頁首的學年學期，依後端順序每校一列', async () => {
    const get = mockGet({ '/admin/admissions/stats': quietStats(), '/admin/admissions/compare': compare([YIHUA, MINGHUA, CHONGDE, RENWU]) })
    const { wrapper } = await mountWith(StatsTab, { props: statsProps() })
    expect(tabTexts(wrapper).at(-1)).toBe('五校比較')
    expect(pathsTo(get, '/admin/admissions/compare')).toEqual([])

    const pane = await openCompare(wrapper)
    expect(pathsTo(get, '/admin/admissions/compare')).toEqual(['/admin/admissions/compare?school_year=115&semester=1'])
    expect(bodyRows(pane).map((tr) => tr[0])).toEqual(['義華', '明華', '崇德', '仁武'])
    // 選了學年：學年學期寫在標題，不另加說明。
    expect(pane.find('.compare-note').exists()).toBe(false)
  })

  it('頁首整學年：請求不帶 semester，標題寫整學年', async () => {
    const get = mockGet({ '/admin/admissions/stats': quietStats(), '/admin/admissions/compare': compare([YIHUA], 115, null) })
    const { wrapper } = await mountWith(StatsTab, { props: statsProps({ semester: null }) })

    const pane = await openCompare(wrapper)
    expect(pathsTo(get, '/admin/admissions/compare').at(-1)).toBe('/admin/admissions/compare?school_year=115')
    expect(pane.get('.stats-block__title').text()).toBe('五校比較（115 學年）')
    expect(pane.find('.compare-note').exists()).toBe(false)
  })

  it('頁首選下學期：請求帶 semester=2，標題寫下學期', async () => {
    const get = mockGet({ '/admin/admissions/stats': quietStats(), '/admin/admissions/compare': compare([YIHUA], 115, 2) })
    const { wrapper } = await mountWith(StatsTab, { props: statsProps({ semester: 2 }) })

    const pane = await openCompare(wrapper)
    expect(pathsTo(get, '/admin/admissions/compare').at(-1)).toBe('/admin/admissions/compare?school_year=115&semester=2')
    expect(pane.get('.stats-block__title').text()).toBe('五校比較（115 下學期）')
  })

  it('頁首沒選學年學期：沒選學年用目前學年（台北日期）並寫明、沒選學期件數算整學年', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T09:00:00+08:00'))
    const get = mockGet({ '/admin/admissions/stats': quietStats(), '/admin/admissions/compare': compare([YIHUA], 115, null) })
    const { wrapper } = await mountWith(StatsTab, { props: statsProps({ schoolYear: null, semester: null }) })

    const pane = await openCompare(wrapper)
    expect(pathsTo(get, '/admin/admissions/compare').at(-1)).toBe('/admin/admissions/compare?school_year=115')
    expect(pane.get('.compare-note').text()).toBe('頁首沒選學年，用目前的 115 學年。')

    await wrapper.setProps({ schoolYear: 116 })
    await flushPromises()
    expect(pathsTo(get, '/admin/admissions/compare').at(-1)).toBe('/admin/admissions/compare?school_year=116')
  })

  it('下學期期間只選了今年：沒選學期不帶 semester（件數整學年）', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-02-10T09:00:00+08:00'))
    const get = mockGet({ '/admin/admissions/stats': quietStats(), '/admin/admissions/compare': compare([YIHUA], 115, null) })
    const { wrapper } = await mountWith(StatsTab, { props: statsProps({ schoolYear: 115, semester: null }) })

    const pane = await openCompare(wrapper)
    expect(pathsTo(get, '/admin/admissions/compare').at(-1)).toBe('/admin/admissions/compare?school_year=115')
    expect(pane.get('.stats-block__title').text()).toBe('五校比較（115 學年）')
  })

  it('在五校比較時換學期：重讀，舊學期的回應晚到也不會蓋掉', async () => {
    const first = deferred<AdmissionsCompare>()
    const second = deferred<AdmissionsCompare>()
    mockGet({
      '/admin/admissions/stats': quietStats(),
      '/admin/admissions/compare': (path: string) => (path.endsWith('semester=1') ? first.promise : second.promise),
    })
    const { wrapper } = await mountWith(StatsTab, { props: statsProps() })
    await openCompare(wrapper)

    await wrapper.setProps({ semester: 2 })
    await flushPromises()
    second.resolve(compare([row('yihua', { visit: 7 })], 115, 2))
    await flushPromises()
    first.resolve(compare([YIHUA]))
    await flushPromises()

    const pane = wrapper.get('#pane-stats-compare')
    expect(pane.get('.stats-block__title').text()).toBe('五校比較（115 下學期）')
    expect(bodyRows(pane)[0]![1]).toBe('7')
  })

  it('讀取失敗：顯示錯誤，按重新載入再讀一次', async () => {
    let fail = true
    const get = mockGet({
      '/admin/admissions/stats': quietStats(),
      '/admin/admissions/compare': () => {
        if (fail) throw new Error('network')
        return compare([YIHUA])
      },
    })
    const { wrapper } = await mountWith(StatsTab, { props: statsProps() })
    const pane = await openCompare(wrapper)

    expect(pane.get('.el-alert').text()).toContain('無法讀取五校比較，請重新載入。')
    fail = false
    await button(pane, '重新載入')!.trigger('click')
    await flushPromises()
    expect(pathsTo(get, '/admin/admissions/compare')).toHaveLength(2)
    expect(bodyRows(wrapper.get('#pane-stats-compare'))[0]![0]).toBe('義華')
  })
})
