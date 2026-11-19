// 廣告成效子分頁（2026-11-16）：主表、Google 未設定、新增花費、切換歸因、子分頁清單。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElDatePicker, ElMessageBox, ElSelect } from 'element-plus'
import AdsTab from '../components/admissions/ads/AdsTab.vue'
import AdSpendDialog from '../components/admissions/ads/AdSpendDialog.vue'
import { STATS_SUBS } from '../admissions/useAdmissionsFilters'
import type { AdRoi, AdRoiRow } from '../api/types'
import { cleanup, mockDelete, mockGet, mockPut, mountWith, pathsTo, queryOf } from './admissionsTestKit'

afterEach(cleanup)

const ROI = '/admin/admissions/ad-roi'
const SPEND = '/admin/admissions/ad-spend'

const row = (changes: Partial<AdRoiRow> = {}): AdRoiRow => ({
  key: 'google', spend: 9000, spend_state: 'ok', missing_months: 0, clicks: 310, cases: 6, completed: 4, no_show: 1, deposited: 1,
  cost_per_case: 1500, cost_per_completed: 2250, cost_per_deposit: 9000, cost_partial: false, ...changes,
})
const roi = (changes: Partial<AdRoi> = {}): AdRoi => ({
  as_of: '2026-11-16T10:00:00+08:00', touch: 'last', months: ['2026-11'],
  google: { configured: true, error: null, currency: 'TWD', time_zone: 'Asia/Taipei', fetched_at: null, campaigns: [] },
  rows: [
    row(),
    row({ key: 'openai', spend: 3000, clicks: null, cases: 1, completed: 0, no_show: 0, deposited: 0, cost_per_case: 3000, cost_per_completed: null, cost_per_deposit: null }),
    row({ key: 'organic', spend: null, spend_state: 'none', clicks: null, cases: 18, completed: 12, deposited: 5, cost_per_case: null, cost_per_completed: null, cost_per_deposit: null }),
  ],
  pending: { upcoming: 3, awaiting_attendance: 0, considering: 2 }, by_campus: [], ...changes,
})

async function mountAds(data: AdRoi = roi(), entries: unknown[] = []) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T10:00:00+08:00'))
  const get = mockGet({ [ROI]: data, [SPEND]: { entries } })
  const mounted = await mountWith(AdsTab, { props: { active: true } })
  await flushPromises()
  return { ...mounted, get }
}
const mainRows = (wrapper: Awaited<ReturnType<typeof mountAds>>['wrapper']) =>
  wrapper.findAll('.ads-main tbody tr').map((tr) => tr.findAll('th, td').map((cell) => cell.text()))

describe('廣告成效', () => {
  it('讀本月區間、最後一次進站；主表依 rows 順序', async () => {
    const { wrapper, get } = await mountAds()
    const [path] = pathsTo(get, ROI)
    expect(Object.fromEntries(queryOf(path!))).toEqual({ from: '2026-11', to: '2026-11', touch: 'last' })
    const rows = mainRows(wrapper)
    expect(rows.map((r) => r[0])).toEqual(['Google', 'ChatGPT', '非廣告來源'])
    expect(rows[0]).toEqual(['Google', '9,000', '310', '6', '4', '1', '1,500', '2,250', '9,000'])
    expect(rows[1]).toEqual(['ChatGPT', '3,000', '—', '1', '0', '0', '3,000', '—', '—'])
    expect(rows[2]![1]).toBe('—')
    expect(wrapper.text()).toContain('廣告帶來的預約中，另有 3 筆還沒到參觀日、2 筆到場後還在考慮。')
    expect(wrapper.text()).toContain('預約含之後取消的。沒有計入：開了「不要追蹤」的訪客、看到廣告後直接來電或到校的家長。')
    expect(wrapper.text()).toContain('Google 花費約晚一天。')
  })

  it('Google 還沒設定：那列顯示「未設定」並在表下說明', async () => {
    const { wrapper } = await mountAds(roi({
      google: { configured: false, error: null, currency: null, time_zone: null, fetched_at: null, campaigns: [] },
      rows: [row({ spend: null, spend_state: 'not_configured', clicks: null })],
    }))
    expect(mainRows(wrapper)[0]![1]).toBe('未設定')
    expect(wrapper.text()).toContain('Google 花費尚未設定。')
  })

  it('Google 讀取失敗：顯示原因', async () => {
    const { wrapper } = await mountAds(roi({
      google: { configured: true, error: '逾時', currency: null, time_zone: null, fetched_at: null, campaigns: [] },
      rows: [row({ spend: null, spend_state: 'error' })],
    }))
    expect(mainRows(wrapper)[0]![1]).toBe('讀取失敗')
    expect(wrapper.text()).toContain('Google 花費讀取失敗：逾時')
  })

  it('讀取失敗：顯示錯誤並可重新載入', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGet({ [ROI]: () => { throw new Error('boom') }, [SPEND]: { entries: [] } })
    const { wrapper } = await mountWith(AdsTab, { props: { active: true } })
    await flushPromises()
    expect(wrapper.text()).toContain('無法讀取廣告成效')
  })

  it('不在這個子分頁時不讀', async () => {
    const get = mockGet({ [ROI]: roi(), [SPEND]: { entries: [] } })
    await mountWith(AdsTab, { props: { active: false } })
    await flushPromises()
    expect(pathsTo(get, ROI)).toHaveLength(0)
  })

  it('切到「第一次進站」重新讀', async () => {
    const { wrapper, get } = await mountAds()
    const radios = wrapper.findAll('.ads-touch input[type="radio"]')
    await radios[1]!.setValue(true)
    await flushPromises()
    const paths = pathsTo(get, ROI)
    expect(Object.fromEntries(queryOf(paths.at(-1)!)).touch).toBe('first')
  })

  it('Google 活動表與各校表有資料才出現', async () => {
    const { wrapper } = await mountAds(roi({
      google: { configured: true, error: null, currency: 'TWD', time_zone: 'Asia/Taipei', fetched_at: null, campaigns: [{ campaign_id: '1', campaign_name: '搜尋-五校招生-202611', cost: 9000, clicks: 310, impressions: 4120, leads: 5, cost_per_click: 29 }] },
      by_campus: [{ campus_key: 'yihua', platform: 'google', cases: 4, completed: 3, deposited: 1 }],
    }))
    expect(wrapper.find('.ads-campus').text()).toContain('4 / 3 / 1')
    expect(wrapper.find('.ads-campaigns').text()).toContain('搜尋-五校招生-202611')
    expect(wrapper.find('.ads-campaigns').text()).toContain('4,120')
    expect(wrapper.find('.ads-campus').text()).toContain('義華')
    const empty = await mountAds()
    expect(empty.wrapper.find('.ads-campaigns').exists()).toBe(false)
    expect(empty.wrapper.find('.ads-campus').exists()).toBe(false)
  })

  it('手填平台只算部分月份：成本格加「＊」並在表下註明；時區不是台北時提醒', async () => {
    const { wrapper } = await mountAds(roi({
      google: { configured: true, error: null, currency: 'TWD', time_zone: 'America/Los_Angeles', fetched_at: null, campaigns: [] },
      rows: [
        row(),
        row({ key: 'openai', spend: 3000, missing_months: 1, cost_partial: true, cost_per_case: 1500, cost_per_completed: null, cost_per_deposit: 3000 }),
      ],
    }))
    const rows = mainRows(wrapper)
    expect(rows[1]!.slice(6)).toEqual(['1,500＊', '—', '3,000＊'])
    expect(rows[0]!.slice(6)).toEqual(['1,500', '2,250', '9,000'])
    expect(wrapper.find('.ads-partial').text()).toBe('＊ 只算有填花費的月份。')
    expect(wrapper.find('.ads-zone').text()).toBe('Google 花費依 America/Los_Angeles 切月份。')
    const plain = await mountAds()
    expect(plain.wrapper.find('.ads-partial').exists()).toBe(false)
    expect(plain.wrapper.find('.ads-zone').exists()).toBe(false)
  })

  it('新增花費：送出後呼叫 putAdSpend 並重新載入', async () => {
    const { wrapper, get } = await mountAds()
    const put = mockPut({ [`${SPEND}/2026-11/openai`]: { month: '2026-11', platform: 'openai', amount: 3000, note: null, updated_at: '2026-11-16T10:00:00+08:00' } })
    await wrapper.get('[data-test="ads-add"]').trigger('click')
    await flushPromises()
    const dialog = wrapper.findComponent(AdSpendDialog)
    await dialog.findComponent(ElDatePicker).setValue('2026-11')
    await dialog.findComponent(ElSelect).setValue('openai')
    await dialog.get('[data-test="ads-amount"] input').setValue('3000')
    const before = pathsTo(get, ROI).length
    await dialog.get('[data-test="ads-save"]').trigger('click')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/admissions/ad-spend/2026-11/openai', { amount: 3000, note: null })
    expect(pathsTo(get, ROI).length).toBe(before + 1)
  })

  it('刪除要先確認', async () => {
    const entry = { month: '2026-11', platform: 'openai', amount: 3000, note: '十一月', updated_at: '2026-11-16T10:00:00+08:00' }
    const { wrapper } = await mountAds(roi(), [entry])
    expect(wrapper.find('.ads-spend').text()).toContain('十一月')
    const del = mockDelete({ [`${SPEND}/2026-11/openai`]: undefined })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    await wrapper.get('[data-test="ads-delete"]').trigger('click')
    await flushPromises()
    expect(del).toHaveBeenCalledWith('/admin/admissions/ad-spend/2026-11/openai')
  })

  it('刪除失敗（例如已被刪掉）也重新讀取', async () => {
    const entry = { month: '2026-11', platform: 'openai', amount: 3000, note: null, updated_at: '2026-11-16T10:00:00+08:00' }
    const { wrapper, get } = await mountAds(roi(), [entry])
    mockDelete({ [`${SPEND}/2026-11/openai`]: () => { throw new Error('404') } })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const before = pathsTo(get, ROI).length
    await wrapper.get('[data-test="ads-delete"]').trigger('click')
    await flushPromises()
    expect(pathsTo(get, ROI).length).toBe(before + 1)
  })

  it('新增花費的月份與備註限制', async () => {
    const { wrapper } = await mountAds()
    await wrapper.get('[data-test="ads-add"]').trigger('click')
    await flushPromises()
    const dialog = wrapper.findComponent(AdSpendDialog)
    const picker = dialog.findComponent(ElDatePicker)
    const disabled = picker.props('disabledDate') as (date: Date) => boolean
    expect(disabled(new Date(2026, 9, 1))).toBe(true) // 2026-10 早於資料起點
    expect(disabled(new Date(2026, 10, 1))).toBe(false)
    expect(disabled(new Date(2026, 11, 1))).toBe(true) // 晚於本月
    expect(dialog.find('input[maxlength="100"]').exists()).toBe(true)
  })
})

describe('子分頁清單', () => {
  it('廣告成效排最後', () => {
    expect(STATS_SUBS.at(-1)).toBe('ads')
  })
})
