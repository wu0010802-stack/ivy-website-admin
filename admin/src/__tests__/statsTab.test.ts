import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { ElSelect } from 'element-plus'
import StatsTab from '../components/admissions/StatsTab.vue'
import NoDepositList from '../components/admissions/NoDepositList.vue'
import type { AdmissionsStats } from '../api/types'
import { taipeiToday } from '../admissions/academic'
import { button, cleanup, deferred, mockGet, mountWith, pathsTo, queryOf } from './admissionsTestKit'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { downloadCsv } from '../utils/csv'

afterEach(cleanup)

type Rate = number | null
const snap = (visit: number, deposit: number, enrolled: number, transfer: number, pending: number, effective: number,
  v2d: Rate, v2e: Rate, d2e: Rate, e2e: Rate) => ({
  visit, deposit, enrolled, transfer_term: transfer, pending_deposit: pending, effective_deposit: effective,
  visit_to_deposit_rate: v2d, visit_to_enrolled_rate: v2e, deposit_to_enrolled_rate: d2e, effective_to_enrolled_rate: e2e,
})
const EMPTY = snap(0, 0, 0, 0, 0, 0, null, null, null, null)
const diff = (current: number, previous: number) => ({ current, previous, delta: current - previous })
const rateDiff = (current: Rate, previous: Rate, delta: Rate) => ({ current, previous, delta })

function stats(changes: Partial<AdmissionsStats> = {}): AdmissionsStats {
  return {
    as_of: '2026-10-01T04:00:00Z',
    filters: { campus_key: 'yihua', school_year: 115, semester: 1, reference_month: null },
    reference_month: '115.09',
    kpi: { ...snap(9, 5, 2, 1, 2, 4, 55.6, 22.2, 40, 50), unique_visit: 8, unique_deposit: 4 },
    decision_summary: {
      current_month: snap(5, 1, 0, 0, 1, 1, 20, 0, 0, 0), rolling_30d: snap(6, 2, 0, 1, 1, 1, 33.3, 0, 0, 0),
      rolling_90d: snap(7, 3, 1, 1, 1, 2, 42.9, 14.3, 33.3, 50), ytd: snap(8, 4, 1, 1, 2, 3, 50, 12.5, 25, 33.3),
    },
    funnel_snapshot: { visit: 5, deposit: 1, enrolled: 0, transfer_term: 0, effective_deposit: 1, pending_deposit: 1 },
    month_over_month: {
      current_month: '115.09', previous_month: '115.08',
      visit: diff(5, 3), deposit: diff(1, 3), enrolled: diff(0, 1), effective_deposit: diff(1, 2), pending_deposit: diff(1, 1),
      visit_to_deposit_rate: rateDiff(20, 100, -80), visit_to_enrolled_rate: rateDiff(0, 33.3, -33.3),
      deposit_to_enrolled_rate: rateDiff(0, 33.3, -33.3), effective_to_enrolled_rate: rateDiff(0, 50, -50),
    },
    alerts: [{
      code: 'FUNNEL_DROP', level: 'warning', title: '本月漏斗轉換下滑',
      message: '115.09 參觀轉預繳 -80.0 個百分點，參觀轉註冊 -33.3 個百分點。', target_tab: 'records', target_filter: { month: '115.09' },
    }],
    top_action_queue: [
      { code: 'FOLLOW_HIGH_POTENTIAL', title: '查看高風險未預繳', description: '目前有 2 筆高潛力名單逾期未追。',
        target_tab: 'nodeposit', target_filter: { priority: 'high', overdue_days: 14 } },
      { code: 'REVIEW_CURRENT_MONTH', title: '查看本月明細', description: '切換到 115.09 明細，檢查本月漏斗掉點。',
        target_tab: 'records', target_filter: { month: '115.09' } },
    ],
    monthly: [
      { month: '114.12', ...snap(1, 1, 1, 0, 0, 1, 100, 100, 100, 100) },
      { month: '115.08', ...snap(3, 3, 1, 1, 1, 2, 100, 33.3, 33.3, 50) },
      { month: '115.09', ...snap(5, 1, 0, 0, 1, 1, 20, 0, 0, 0) },
    ],
    by_year: [
      { year: '114', ...snap(1, 1, 1, 0, 0, 1, 100, 100, 100, 100) },
      { year: '115', ...snap(8, 4, 1, 1, 2, 3, 50, 12.5, 25, 33.3) },
    ],
    by_grade: [
      { grade: '小班', visit: 5, deposit: 3, enrolled: 1, visit_to_deposit_rate: 60, visit_to_enrolled_rate: 20, deposit_to_enrolled_rate: 33.3 },
      { grade: '中班', visit: 2, deposit: 2, enrolled: 1, visit_to_deposit_rate: 100, visit_to_enrolled_rate: 50, deposit_to_enrolled_rate: 50 },
      { grade: '幼幼班', visit: 1, deposit: 0, enrolled: 0, visit_to_deposit_rate: 0, visit_to_enrolled_rate: 0, deposit_to_enrolled_rate: null },
      { grade: '未填寫', visit: 1, deposit: 0, enrolled: 0, visit_to_deposit_rate: 0, visit_to_enrolled_rate: 0, deposit_to_enrolled_rate: null },
    ],
    month_grade: {
      '114.12': { 中班: 1, 合計: 1 },
      '115.08': { 小班: 2, 中班: 1, 合計: 3 },
      '115.09': { 小班: 3, 幼幼班: 1, 未填寫: 1, 合計: 5 },
    },
    by_source: [
      { source: 'Facebook', visit: 5, deposit: 4, visit_to_deposit_rate: 80 },
      { source: '親友介紹', visit: 2, deposit: 1, visit_to_deposit_rate: 50 },
      { source: 'Google 評論', visit: 1, deposit: 0, visit_to_deposit_rate: 0 },
      { source: '未填寫', visit: 1, deposit: 0, visit_to_deposit_rate: 0 },
    ],
    top_source_names: ['Facebook', '親友介紹', 'Google 評論', '未填寫'],
    by_tour_guide: [
      { tour_guide: '林老師', visit: 5, deposit: 3, visit_to_deposit_rate: 60, by_grade: { 小班: { visit: 5, deposit: 3 } } },
      { tour_guide: '張老師', visit: 3, deposit: 2, visit_to_deposit_rate: 66.7,
        by_grade: { 中班: { visit: 2, deposit: 2 }, 幼幼班: { visit: 1, deposit: 0 } } },
      { tour_guide: '未填寫', visit: 1, deposit: 0, visit_to_deposit_rate: 0, by_grade: { 未填寫: { visit: 1, deposit: 0 } } },
    ],
    tour_guide_source_cross: {
      sources: ['Facebook', '親友介紹', 'Google 評論', '未填寫'],
      tour_guides: [
        { tour_guide: '林老師', sources: { Facebook: 4, 親友介紹: 1, 'Google 評論': 0, 未填寫: 0 }, total: 5 },
        { tour_guide: '張老師', sources: { Facebook: 1, 親友介紹: 1, 'Google 評論': 1, 未填寫: 0 }, total: 3 },
        { tour_guide: '未填寫', sources: { Facebook: 0, 親友介紹: 0, 'Google 評論': 0, 未填寫: 1 }, total: 1 },
      ],
    },
    no_deposit_reasons: [
      { reason: '時程未到／仍在觀望', count: 2, by_grade: { 小班: 1, 未填寫: 1 }, priority: 'high' },
      { reason: '未分類', count: 1, by_grade: { 幼幼班: 1 }, priority: null },
    ],
    no_deposit_total: 3,
    no_deposit_priority: { high: 2, medium: 0, low: 0, other: 1 },
    no_deposit_summary: { high_potential_count: 2, overdue_followup_count: 3, cold_count: 0, high_potential_backlog_count: 2 },
    ...changes,
  }
}

function emptyStats(): AdmissionsStats {
  return stats({
    reference_month: null,
    kpi: { ...EMPTY, unique_visit: 0, unique_deposit: 0 },
    decision_summary: { current_month: EMPTY, rolling_30d: EMPTY, rolling_90d: EMPTY, ytd: EMPTY },
    funnel_snapshot: { visit: 0, deposit: 0, enrolled: 0, transfer_term: 0, effective_deposit: 0, pending_deposit: 0 },
    month_over_month: {
      current_month: null, previous_month: null,
      visit: diff(0, 0), deposit: diff(0, 0), enrolled: diff(0, 0), effective_deposit: diff(0, 0), pending_deposit: diff(0, 0),
      visit_to_deposit_rate: rateDiff(null, null, null), visit_to_enrolled_rate: rateDiff(null, null, null),
      deposit_to_enrolled_rate: rateDiff(null, null, null), effective_to_enrolled_rate: rateDiff(null, null, null),
    },
    alerts: [], top_action_queue: [], monthly: [], by_year: [], by_grade: [], month_grade: {}, by_source: [],
    top_source_names: [], by_tour_guide: [], tour_guide_source_cross: { tour_guides: [], sources: [] }, no_deposit_reasons: [],
    no_deposit_total: 0, no_deposit_priority: { high: 0, medium: 0, low: 0, other: 0 },
    no_deposit_summary: { high_potential_count: 0, overdue_followup_count: 0, cold_count: 0, high_potential_backlog_count: 0 },
  })
}

const props = (changes: Record<string, unknown> = {}) => ({ campusKey: 'yihua', schoolYear: 115, semester: 1, campusKeys: ['yihua'], ...changes })
type Dom = Omit<DOMWrapper<Element>, 'exists'>
const cells = (row: Dom) => row.findAll('th, td').map((cell) => cell.text())
const block = (root: VueWrapper | Dom, title: string) =>
  root.findAll('.stats-block').find((section) => section.get('.stats-block__title').text() === title)!
const headers = (section: Dom) => section.findAll('thead th').map((th) => th.text())
const bodyRows = (section: Dom) => section.findAll('tbody tr').map(cells)

async function openSubTab(wrapper: VueWrapper, label: string): Promise<Dom> {
  const tab = wrapper.findAll('.stats-subtabs .el-tabs__item').find((item) => item.text() === label)!
  await tab.trigger('click')
  await flushPromises()
  return wrapper.get(`#${tab.attributes('id')!.replace(/^tab-/, 'pane-')}`)
}

describe('統計分頁：總覽', () => {
  it('依頁首校區與學期查詢；決策摘要四張卡、月比徽章、快照、月比、月度與年度表', async () => {
    const get = mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    expect(queryOf(pathsTo(get, '/admin/admissions/stats')[0]!).toString()).toBe('campus_key=yihua&school_year=115&semester=1')
    const overview = wrapper.get('#pane-stats-overview')
    expect(overview.get('.decision h3').text()).toBe('主管決策摘要')
    expect(overview.get('.decision .hint').text()).toBe('參考月份：115.09')
    expect(overview.get('.decision__badge').text()).toBe('▼ 月比預繳率 -80.0 個百分點')
    expect(overview.findAll('.decision__card h4').map((n) => n.text())).toEqual(['本月', '近 30 天', '近 90 天', '年度累計'])
    expect(overview.findAll('.decision__visit').map((n) => n.text())).toEqual(['5 人次', '6 人次', '7 人次', '8 人次'])
    expect(overview.findAll('.decision__card')[2]!.text()).toContain('預繳率42.9%')
    expect(overview.findAll('.decision__foot').map((n) => n.text())[3]).toBe('預繳 4 · 註冊 1')
    // 本月漏斗快照：參觀 5 → 轉預繳 20.0% → 預繳 1 → 轉註冊 0.0% → 註冊 0；待轉換 1。
    expect(overview.get('.snapshot').text().replace(/\s+/g, '')).toBe('本月漏斗快照參觀5轉預繳20.0%預繳1轉註冊0.0%註冊0待轉換（預繳未註冊）1')
    expect(overview.get('.mom').text().replace(/\s+/g, '')).toContain('對比月份115.09/115.08')
    expect(headers(block(overview, '月度明細表'))).toEqual([
      '月份', '參觀人數', '預繳人數', '註冊人數', '轉其他學期', '有效預繳', '預繳未註冊', '參觀→預繳率', '參觀→註冊率', '排除轉期→註冊率',
    ])
    expect(bodyRows(block(overview, '月度明細表'))[1]).toEqual(['115.08', '3', '3', '1', '1', '2', '1', '100.0%', '33.3%', '50.0%'])
    expect(bodyRows(block(overview, '年度統計')).map((row) => row[0])).toEqual(['114年', '115年'])
    expect(overview.text()).toContain('有效預繳＝預繳且沒有轉其他學期')
  })

  it('比率是 null 就寫「—」，不寫 0', async () => {
    mockGet({
      '/admin/admissions/stats': stats({
        decision_summary: { ...stats().decision_summary, rolling_30d: EMPTY },
        month_over_month: { ...stats().month_over_month, visit_to_deposit_rate: rateDiff(20, null, null) },
      }),
    })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    const rolling = wrapper.findAll('.decision__card')[1]!
    expect(rolling.text()).toContain('預繳率—')
    expect(rolling.text()).toContain('註冊率—')
    expect(rolling.text()).not.toContain('0.0%')
    expect(wrapper.get('.decision__badge').text()).toBe('月比預繳率 —')
  })

  it('月比沒有值：只寫「—」不加趨勢符號；有值時符號照舊', async () => {
    mockGet({
      '/admin/admissions/stats': stats({
        month_over_month: {
          ...stats().month_over_month,
          visit_to_deposit_rate: rateDiff(20, null, null), visit_to_enrolled_rate: rateDiff(0, 33.3, -33.3),
        },
      }),
    })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    const badge = wrapper.get('.decision__badge').text()
    expect(badge).not.toContain('–')
    expect(badge).toContain('—')
    const [noValue, withValue] = wrapper.findAll('.mom__list dd').map((n) => n.text())
    expect(noValue).not.toContain('–')
    expect(noValue).toContain('—')
    expect(withValue).toBe('▼ -33.3 個百分點')
  })

  it('本月漏斗快照的轉換率與「本月」卡同一個值（讀後端，不自己五入）', async () => {
    const base = stats()
    mockGet({
      '/admin/admissions/stats': stats({
        decision_summary: { ...base.decision_summary, current_month: snap(16, 1, 0, 0, 1, 1, 6.2, 0, 0, 0) },
        funnel_snapshot: { visit: 16, deposit: 1, enrolled: 0, transfer_term: 0, effective_deposit: 1, pending_deposit: 1 },
      }),
    })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    expect(wrapper.findAll('.decision__card')[0]!.text()).toContain('預繳率6.2%')
    const snapshot = wrapper.get('.snapshot').text().replace(/\s+/g, '')
    expect(snapshot).toContain('轉預繳6.2%')
    expect(snapshot).not.toContain('6.3%')
  })

  it('警示與行動入口：統計內的跳子分頁，「訪視明細」交給頁面切分頁並帶月份', async () => {
    mockGet({ '/admin/admissions/stats': stats(), [NO_DEPOSIT_PATH]: noDepositRecords })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    const alert = wrapper.get('.alert-item')
    expect(alert.text().replace(/\s+/g, '')).toBe('中本月漏斗轉換下滑115.09參觀轉預繳-80.0個百分點，參觀轉註冊-33.3個百分點。')
    await alert.trigger('click')
    expect(wrapper.emitted('open-records')).toEqual([[{ month: '115.09' }]])

    await wrapper.findAll('.action-item')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.stats-subtabs .el-tabs__item.is-active').text()).toBe('未預繳原因')
  })
})

describe('統計分頁：子分頁由 sub 控制（X2a 3A）', () => {
  it('sub 決定現在的子分頁；點子分頁回報 update:sub，不自己改（父層放網址）', async () => {
    mockGet({ '/admin/admissions/stats': stats(), [NO_DEPOSIT_PATH]: noDepositRecords })
    const { wrapper } = await mountWith(StatsTab, { props: props({ sub: 'nodeposit' }) })
    expect(wrapper.get('.stats-subtabs .el-tabs__item.is-active').text()).toBe('未預繳原因')
    const tab = wrapper.findAll('.stats-subtabs .el-tabs__item').find((item) => item.text() === '來源分析')!
    await tab.trigger('click')
    expect(wrapper.emitted('update:sub')).toEqual([['source']])
  })

  it('只看得到一校卻帶 sub=compare：退回總覽', async () => {
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props({ sub: 'compare' }) })
    expect(wrapper.emitted('update:sub')).toEqual([['overview']])
  })
})

describe('統計分頁：其他子分頁（表頭照園務原文）', () => {
  it('班別分析：班別統計與月份 × 班別', async () => {
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const pane = await openSubTab(wrapper, '班別分析')

    expect(headers(block(pane, '班別統計'))).toEqual(['班別', '參觀人數', '預繳人數', '預繳率'])
    expect(bodyRows(block(pane, '班別統計'))).toEqual([
      ['小班', '5', '3', '60.0%'], ['中班', '2', '2', '100.0%'], ['幼幼班', '1', '0', '0.0%'], ['未填寫', '1', '0', '0.0%'],
    ])
    expect(headers(block(pane, '月份 × 班別分布'))).toEqual(['月份', '幼幼班', '小班', '中班', '大班', '未填寫', '合計'])
    expect(bodyRows(block(pane, '月份 × 班別分布'))[2]).toEqual(['115.09', '1', '3', '0', '0', '1', '5'])
  })

  it('來源分析：排名明細有序號，依原文分組', async () => {
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const pane = await openSubTab(wrapper, '來源分析')

    expect(headers(block(pane, '來源排名明細'))).toEqual(['#', '來源', '參觀人數', '預繳人數', '預繳率'])
    expect(bodyRows(block(pane, '來源排名明細'))[0]).toEqual(['1', 'Facebook', '5', '4', '80.0%'])
    expect(pane.get('.stats-bar__fill').attributes('style')).toContain('width: 100%')
  })

  it('接待分析：接待人員（帶參觀老師）統計、× 各年級、× 來源', async () => {
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const pane = await openSubTab(wrapper, '接待分析')

    expect(bodyRows(block(pane, '接待人員統計'))[1]).toEqual(['張老師', '3', '2', '66.7%'])
    expect(pane.text()).toContain('依訪視表單的「帶參觀老師」計算，一筆有多位老師時每位各算一次。')
    expect(headers(block(pane, '接待人員 × 各年級預繳率'))).toEqual(['接待人員', '幼幼班', '小班', '中班', '大班', '未填寫'])
    expect(bodyRows(block(pane, '接待人員 × 各年級預繳率'))[1]).toEqual(['張老師', '1人 / 0.0%', '—', '2人 / 100.0%', '—', '—'])
    expect(headers(block(pane, '接待人員 × 來源 交叉分析'))).toEqual(['接待人員', 'Facebook', '親友介紹', 'Google 評論', '未填寫', '合計'])
    expect(bodyRows(block(pane, '接待人員 × 來源 交叉分析'))[0]).toEqual(['林老師', '4', '1', '0', '0', '5'])
  })

  it('未預繳原因：三張數字卡、優先度分組、原因 × 年級（名單不在 StatsTab 本身，由 C3b 的 NoDepositList 負責）', async () => {
    mockGet({ '/admin/admissions/stats': stats(), [NO_DEPOSIT_PATH]: noDepositRecords })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const pane = await openSubTab(wrapper, '未預繳原因')

    expect(pane.findAll('.nodeposit-kpi').map((n) => n.text().replace(/\s+/g, ''))).toEqual(['高潛力未預繳2', '逾14天待追3', '冷名單0'])
    expect(pane.get('.nodeposit-priority').text().replace(/\s+/g, '')).toBe('高潛力2・中潛力0・低潛力0・未歸類1（共3筆）')
    expect(headers(block(pane, '未預繳原因分佈'))).toEqual(['原因分類', '轉換潛力', '筆數', '幼幼班', '小班', '中班', '大班', '未填寫'])
    expect(bodyRows(block(pane, '未預繳原因分佈'))).toEqual([
      ['時程未到／仍在觀望', '高', '2', '0', '1', '0', '0', '1'],
      ['未分類', '—', '1', '1', '0', '0', '0', '0'],
    ])
    expect(pane.text()).toContain('已退預繳、退註冊的不算未預繳；逾 14 天待追、冷名單＝參觀滿 14、90 天仍未預繳。')
  })
})

describe('統計分頁：狀態', () => {
  it('無資料：寫出原因，不顯示假的 0；子分頁用園務的空狀態文案', async () => {
    mockGet({ '/admin/admissions/stats': emptyStats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    const overview = wrapper.get('#pane-stats-overview')
    expect(overview.get('.stats-empty').text()).toBe('義華在 115 上學期還沒有招生訪視。新增訪視，或在參觀案件標記家長已到場後，這裡就會有統計。')
    expect(overview.find('.decision').exists()).toBe(false)
    expect(overview.text()).not.toContain('0.0%')
    expect((await openSubTab(wrapper, '班別分析')).text()).toContain('此區間尚無班別資料')
    expect((await openSubTab(wrapper, '來源分析')).text()).toContain('此區間尚無來源資料')
    expect((await openSubTab(wrapper, '接待分析')).text()).toContain('此區間尚無接待資料')
    expect((await openSubTab(wrapper, '未預繳原因')).text()).toContain('此區間尚無未預繳資料')
  })

  it('沒選學年：寫「所有學年」', async () => {
    mockGet({ '/admin/admissions/stats': emptyStats() })
    const { wrapper } = await mountWith(StatsTab, { props: props({ schoolYear: null, semester: null }) })
    expect(wrapper.get('#pane-stats-overview .stats-empty').text()).toContain('義華在所有學年還沒有招生訪視。')
  })

  it('讀取失敗：顯示錯誤與重新載入，重試成功後恢復', async () => {
    let fail = true
    const get = mockGet({
      '/admin/admissions/stats': () => {
        if (fail) throw new Error('network')
        return stats()
      },
    })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    expect(wrapper.get('.el-alert').text()).toContain('無法讀取統計資料，請重新載入。')
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(pathsTo(get, '/admin/admissions/stats')).toHaveLength(2)
    expect(wrapper.find('.el-alert').exists()).toBe(false)
    expect(wrapper.get('.decision__badge').text()).toBe('▼ 月比預繳率 -80.0 個百分點')
  })

  it('快速切換校區只顯示最後一次（明華先回、義華晚回也不會蓋掉）', async () => {
    const yihua = deferred<AdmissionsStats>()
    const minghua = deferred<AdmissionsStats>()
    mockGet({ '/admin/admissions/stats': (path: string) => (queryOf(path).get('campus_key') === 'yihua' ? yihua.promise : minghua.promise) })
    const { wrapper } = await mountWith(StatsTab, { props: props({ campusKeys: ['yihua', 'minghua'] }) })

    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    minghua.resolve(stats({ reference_month: '115.08', filters: { campus_key: 'minghua', school_year: 115, semester: 1, reference_month: null } }))
    await flushPromises()
    yihua.resolve(stats())
    await flushPromises()

    expect(wrapper.get('.decision .hint').text()).toBe('參考月份：115.08')
  })

  it('參考月份選單在總覽裡（只影響總覽）；總覽有口徑說明；參考月份是目前這個月時「本月」卡標「進行中」', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-20T09:00:00+08:00'))
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const overview = wrapper.get('#pane-stats-overview')
    expect(overview.find('[aria-label="參考月份"]').exists()).toBe(true)
    expect(wrapper.get('.stats-toolbar').find('[aria-label="參考月份"]').exists()).toBe(false)
    expect(overview.get('.decision__basis').text()).toContain('本月依參觀月份；近 30／90 天依建檔時間')
    expect(overview.findAll('.decision__card h4')[0]!.text()).toContain('進行中')
    expect(overview.findAll('.decision__card h4')[1]!.text()).not.toContain('進行中')
  })

  it('參考月份：選項是有資料的月份（新到舊），選了就帶 reference_month；換校區回到最新月份', async () => {
    const get = mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props({ campusKeys: ['yihua', 'minghua'] }) })

    const select = wrapper.findComponent(ElSelect)
    expect(wrapper.findAll('.el-select-dropdown__item').map((item) => item.text())).toEqual(['115.09', '115.08', '114.12'])
    select.vm.$emit('update:modelValue', '115.08')
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/stats').at(-1)!).get('reference_month')).toBe('115.08')

    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    const last = queryOf(pathsTo(get, '/admin/admissions/stats').at(-1)!)
    expect([last.get('campus_key'), last.get('reference_month')]).toEqual(['minghua', null])
  })
})

// ── C3b：未預繳明細掛進「未預繳原因」 ──
const NO_DEPOSIT_PATH = '/admin/admissions/no-deposit-records'
const noDepositRecords = {
  total: 1, page: 1, page_size: 50,
  summary: { high_potential_count: 2, overdue_followup_count: 3, cold_count: 0 },
  records: [{
    id: '11111111-0000-4000-8000-000000000001', month: '115.09', seq_no: '3', child_name: '林小安', grade: '小班',
    no_deposit_reason: '時程未到／仍在觀望', no_deposit_reason_detail: null, source: 'Facebook', referrer: '林老師',
    parent_response: null, created_at: '2026-09-03T02:00:00Z', priority: 'high', cold: false,
  }],
}

describe('統計分頁：未預繳明細（C3b）', () => {
  it('打開「未預繳原因」才掛 NoDepositList，帶頁首校區與學期；不再叫人到訪視明細篩；名單的「查看」交給頁面', async () => {
    const get = mockGet({ '/admin/admissions/stats': stats(), [NO_DEPOSIT_PATH]: noDepositRecords })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    expect(pathsTo(get, NO_DEPOSIT_PATH)).toHaveLength(0)

    const pane = await openSubTab(wrapper, '未預繳原因')
    expect(wrapper.findComponent(NoDepositList).props()).toEqual({ campusKey: 'yihua', schoolYear: 115, semester: 1, preset: null, overallTotal: 3 })
    expect(pathsTo(get, NO_DEPOSIT_PATH)).toHaveLength(1)
    expect(pane.text()).toContain('林小安')
    expect(pane.text()).not.toContain('名單請到「訪視明細」')

    await button(pane, '查看')!.trigger('click')
    expect(wrapper.emitted('open-records')).toEqual([[{ month: '115.09' }]])
  })

  it('行動入口「查看高風險未預繳」把 target_filter 帶進名單（同園務 applyNoDepositFilter）', async () => {
    const get = mockGet({ '/admin/admissions/stats': stats(), [NO_DEPOSIT_PATH]: noDepositRecords })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    await wrapper.findAll('.action-item')[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.findComponent(NoDepositList).props('preset')).toEqual({ priority: 'high', overdue_days: 14 })
    const query = queryOf(pathsTo(get, NO_DEPOSIT_PATH).at(-1)!)
    expect([query.get('priority'), query.get('overdue_days')]).toEqual(['high', '14'])
  })

  it('沒有未預繳的訪視：不掛名單、不讀名單', async () => {
    const get = mockGet({ '/admin/admissions/stats': emptyStats(), [NO_DEPOSIT_PATH]: noDepositRecords })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    const pane = await openSubTab(wrapper, '未預繳原因')
    expect(pane.text()).toContain('此區間尚無未預繳資料')
    expect(wrapper.findComponent(NoDepositList).exists()).toBe(false)
    expect(pathsTo(get, NO_DEPOSIT_PATH)).toHaveLength(0)
  })
})

describe('統計表匯出 CSV（2026-10-03）', () => {
  const tables = (root: VueWrapper | Dom) => root.findAll('.stats-block').filter((section) => section.find('table').exists())
  const lastDownload = () => vi.mocked(downloadCsv).mock.calls.at(-1)!

  afterEach(() => vi.mocked(downloadCsv).mockClear())

  it('總覽與班別、來源、接待分析的每張表都能匯出，檔名含校區、學期與日期', async () => {
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const overview = wrapper.get('#pane-stats-overview')
    expect(tables(overview).length).toBeGreaterThan(0)
    expect(tables(overview).every((section) => section.find('[data-test="stats-csv"]').exists())).toBe(true)
    for (const label of ['班別分析', '來源分析', '接待分析']) {
      const pane = await openSubTab(wrapper, label)
      expect(tables(pane).every((section) => section.find('[data-test="stats-csv"]').exists()), label).toBe(true)
    }
    await block(wrapper.get('#pane-stats-overview'), '月度明細表').get('[data-test="stats-csv"]').trigger('click')
    expect(lastDownload()[0]).toMatch(/^招生統計-月度明細表-義華-115 上學期-\d{4}-\d{2}-\d{2}\.csv$/)
  })

  it('九張統計表（總覽 2、班別 2、來源 1、接待 3、未預繳原因 1）各用自己的表名當檔名', async () => {
    mockGet({ '/admin/admissions/stats': stats(), [NO_DEPOSIT_PATH]: noDepositRecords })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const today = taipeiToday()
    const panes: [string, string[]][] = [
      ['總覽', ['月度明細表', '年度統計']],
      ['班別分析', ['班別統計', '月份 × 班別分布']],
      ['來源分析', ['來源排名明細']],
      ['接待分析', ['接待人員統計', '接待人員 × 各年級預繳率', '接待人員 × 來源 交叉分析']],
      ['未預繳原因', ['未預繳原因分佈']],
    ]
    for (const [label, titles] of panes) {
      const pane = await openSubTab(wrapper, label)
      for (const title of titles) {
        vi.mocked(downloadCsv).mockClear()
        await block(pane, title).get('[data-test="stats-csv"]').trigger('click')
        expect(lastDownload()[0], title).toBe(`招生統計-${title}-義華-115 上學期-${today}.csv`)
      }
    }
  })

  it('匯出內容同畫面：月度明細表的欄名一致，分母 0 的比率寫空白、不寫「—」，計數照寫', async () => {
    mockGet({ '/admin/admissions/stats': stats({ monthly: [{ month: '115.09', ...snap(0, 0, 0, 0, 0, 0, null, null, null, null) }, { month: '115.10', ...snap(4, 2, 1, 0, 1, 2, 50, 25, 50, 50) }] }) })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const section = block(wrapper.get('#pane-stats-overview'), '月度明細表')
    expect(section.text()).toContain('—')
    await section.get('[data-test="stats-csv"]').trigger('click')
    expect(lastDownload()[1].split('\r\n')).toEqual([
      `\uFEFF${headers(section).join(',')}`,
      '115年09月,0,0,0,0,0,0,,,',
      '115年10月,4,2,1,0,2,1,50.0%,25.0%,50.0%',
      '',
    ])
    // 畫面維持 115.09，只有匯出改寫（Excel 會把 115.10 轉成數字 115.1）。
    expect(bodyRows(section).map((row) => row[0])).toEqual(['115.09', '115.10'])
  })

  it('月份 × 班別分布的月份欄也寫「115年09月」，班別欄照寫計數', async () => {
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const section = block(await openSubTab(wrapper, '班別分析'), '月份 × 班別分布')
    await section.get('[data-test="stats-csv"]').trigger('click')
    const lines = lastDownload()[1].split('\r\n')
    expect(lines[0]).toBe(`\uFEFF${headers(section).join(',')}`)
    expect(lines.slice(1).map((line) => line.split(',')[0])).toEqual(['114年12月', '115年08月', '115年09月', ''])
    expect(bodyRows(section).map((row) => row[0])).toEqual(['114.12', '115.08', '115.09'])
  })

  it('沒選學年：檔名寫「全部學年」', async () => {
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props({ schoolYear: null, semester: null }) })
    await block(wrapper.get('#pane-stats-overview'), '年度統計').get('[data-test="stats-csv"]').trigger('click')
    expect(lastDownload()[0]).toBe(`招生統計-年度統計-義華-全部學年-${taipeiToday()}.csv`)
  })

  it('沒選學年但選了下學期：檔名寫「全部學年下學期」，不把只有下學期的數字寫成全部', async () => {
    mockGet({ '/admin/admissions/stats': stats() })
    const { wrapper } = await mountWith(StatsTab, { props: props({ schoolYear: null, semester: 2 }) })
    await block(wrapper.get('#pane-stats-overview'), '年度統計').get('[data-test="stats-csv"]').trigger('click')
    expect(lastDownload()[0]).toBe(`招生統計-年度統計-義華-全部學年下學期-${taipeiToday()}.csv`)
  })

  it('沒有資料的表不顯示匯出鈕', async () => {
    mockGet({ '/admin/admissions/stats': stats({ by_source: [] }) })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const pane = await openSubTab(wrapper, '來源分析')
    expect(block(pane, '來源排名明細').find('[data-test="stats-csv"]').exists()).toBe(false)
  })
})
