// Google 商家檔案與搜尋需求（2026-11-25，docs/specs/2026-11-25-business-profile-keyword-planner-design.md）：
// 格式函式、商家檔案面板（未設定、每月表、搜尋字詞、同步失敗說明）、搜尋需求（地區切換、量太少、新增與刪除）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import BusinessProfilePanel from '../components/analytics/BusinessProfilePanel.vue'
import SearchDemandSection from '../components/admissions/ads/SearchDemandSection.vue'
import {
  demandCell, demandMonthHeader, gbpKeywordValue, gbpMobileShare, gbpMonthLabel, syncErrorHint, syncTime,
} from '../api/googleData'
import type { BusinessProfile, GbpLocation, GbpMonth, SearchDemand, SearchKeyword } from '../api/types'
import { cleanup, mockDelete, mockGet, mockPost, mountWith, pathsTo } from './admissionsTestKit'

afterEach(cleanup)

const GBP = '/admin/business-profile'
const DEMAND = '/admin/search-demand'

const month = (changes: Partial<GbpMonth> = {}): GbpMonth => ({
  month: '2026-10', days: 31, last_day: '2026-10-31', desktop_search: 100, mobile_search: 300, desktop_maps: 20, mobile_maps: 80,
  calls: 6, directions: 9, website: 12, messages: 0, ...changes,
})
const location = (changes: Partial<GbpLocation> = {}): GbpLocation => ({
  campus_key: 'yihua', campus_name: '義華', last_success_at: '2026-11-25T02:00:00Z', last_attempt_at: '2026-11-25T02:00:00Z',
  failed: false, error: null, last_day: '2026-11-22',
  months: [month({ month: '2026-11', days: 22, last_day: '2026-11-22' }), month()],
  keywords_month: '2026-10',
  keywords: [
    { keyword: '常春藤幼兒園', impressions: 1234, below: null },
    { keyword: '義華路 幼兒園', impressions: null, below: 15 },
  ],
  keyword_total: 40,
  ...changes,
})

describe('格式函式', () => {
  it('每月標題：沒過完的月份寫到哪一天', () => {
    expect(gbpMonthLabel(month())).toBe('2026 年 10 月')
    expect(gbpMonthLabel(month({ month: '2026-11', last_day: '2026-11-22' }))).toBe('2026 年 11 月（到 11/22）')
    expect(gbpMonthLabel(month({ month: '2024-02', last_day: '2024-02-29' }))).toBe('2024 年 2 月')
  })

  it('手機占與搜尋字詞的值', () => {
    expect(gbpMobileShare(month())).toBe(76)
    expect(gbpMobileShare(month({ desktop_search: 0, mobile_search: 0, desktop_maps: 0, mobile_maps: 0 }))).toBeNull()
    expect(gbpKeywordValue({ keyword: 'a', impressions: 1234, below: null })).toBe('1,234')
    expect(gbpKeywordValue({ keyword: 'a', impressions: null, below: 15 })).toBe('少於 15')
  })

  it('搜尋量的格子：量太少不補 0、沒有這個月寫破折號', () => {
    expect(demandCell({ month: '2026-10', available: true, searches: 1300 })).toEqual({ kind: 'value', text: '1,300' })
    expect(demandCell({ month: '2026-10', available: true, searches: null })).toEqual({ kind: 'low', text: '量太少' })
    expect(demandCell({ month: '2026-10', available: false, searches: null })).toEqual({ kind: 'missing', text: '—' })
  })

  it('表頭只在第一欄與跨年時寫年份', () => {
    const months = ['2025-11', '2025-12', '2026-01', '2026-02']
    expect(months.map((_, i) => demandMonthHeader(months, i))).toEqual([
      { year: '2025', month: '11 月' }, { year: '', month: '12 月' }, { year: '2026', month: '1 月' }, { year: '', month: '2 月' },
    ])
  })

  it('同步失敗的說明', () => {
    expect(syncErrorHint('以 refresh token 取得 Google 權杖（HTTP 400）', 'gbp')).toContain('WEBSITE_GBP_REFRESH_TOKEN')
    expect(syncErrorHint('以 refresh token 取得 Google 權杖（HTTP 400）', 'ads')).toContain('WEBSITE_GOOGLE_ADS_REFRESH_TOKEN')
    expect(syncErrorHint('查詢商家檔案每日指標（HTTP 403）', 'gbp')).toContain('商家檔案 API 還沒核准')
    expect(syncErrorHint('查詢 Keyword Planner（HTTP 403）', 'ads')).toContain('Basic')
    expect(syncErrorHint('查詢商家檔案每日指標（HTTP 404）', 'gbp')).toContain('WEBSITE_GBP_LOCATIONS')
    expect(syncErrorHint('查詢 Keyword Planner（HTTP 429）', 'ads')).toContain('用量上限')
    expect(syncErrorHint('查詢 Keyword Planner（ConnectTimeout）', 'ads')).toBeNull()
    expect(syncErrorHint(null, 'gbp')).toBeNull()
  })

  it('同步時間用台北時間', () => {
    expect(syncTime('2026-11-24T16:05:00Z')).toBe('11/25 00:05')
    expect(syncTime(null)).toBe('')
  })
})

describe('商家檔案面板', () => {
  async function mountPanel(data: unknown) {
    const get = mockGet({ [GBP]: data })
    const mounted = await mountWith(BusinessProfilePanel, { props: { active: true } })
    await flushPromises()
    return { ...mounted, get }
  }

  it('沒設定：一句說明', async () => {
    const { wrapper } = await mountPanel({ configured: false, locations: [] } satisfies BusinessProfile)
    expect(wrapper.find('[data-test="gbp-unconfigured"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gbp-months"]').exists()).toBe(false)
  })

  it('每月表與搜尋字詞', async () => {
    const { wrapper } = await mountPanel({ configured: true, locations: [location()] } satisfies BusinessProfile)
    expect(wrapper.text()).toContain('Google 商家檔案義華')
    const rows = wrapper.findAll('[data-test="gbp-months"] tbody tr').map((tr) => tr.findAll('th, td').map((cell) => cell.text()))
    expect(rows[0]).toEqual(['2026 年 11 月（到 11/22）', '400', '100', '76%', '6', '9', '12', '0'])
    expect(rows[1]![0]).toBe('2026 年 10 月')
    expect(wrapper.text()).toContain('2026 年 10 月怎麼被搜尋到')
    expect(wrapper.text()).toContain('前 2 個，共 40 個字詞')
    const words = wrapper.findAll('[data-test="gbp-keywords"] tbody tr').map((tr) => tr.text())
    expect(words).toEqual(['常春藤幼兒園1,234', '義華路 幼兒園少於 15'])
    expect(wrapper.text()).toContain('每天同步一次・最近一次 11/25 10:00')
  })

  it('同步失敗：寫原因與該怎麼做，舊資料照樣顯示', async () => {
    const { wrapper } = await mountPanel({
      configured: true,
      locations: [location({ failed: true, error: '查詢商家檔案每日指標（HTTP 403）' })],
    } satisfies BusinessProfile)
    const alert = wrapper.get('[data-test="gbp-sync-error"]')
    expect(alert.text()).toContain('最近一次同步失敗：查詢商家檔案每日指標（HTTP 403）')
    expect(alert.text()).toContain('商家檔案 API 還沒核准')
    expect(wrapper.find('[data-test="gbp-months"]').exists()).toBe(true)
  })

  it('還沒同步過', async () => {
    const { wrapper } = await mountPanel({
      configured: true,
      locations: [location({ months: [], keywords_month: null, keywords: [], keyword_total: 0, last_success_at: null, last_attempt_at: null })],
    } satisfies BusinessProfile)
    expect(wrapper.get('[data-test="gbp-empty"]').text()).toContain('設定後一小時內會開始第一次同步')
  })

  it('讀不到：可以重新載入', async () => {
    const { wrapper, get } = await mountPanel(() => { throw new Error('boom') })
    expect(wrapper.text()).toContain('無法讀取 Google 商家檔案的資料')
    expect(pathsTo(get, GBP)).toHaveLength(1)
  })

  it('沒切到這一類不讀', async () => {
    const get = mockGet({ [GBP]: { configured: false, locations: [] } })
    await mountWith(BusinessProfilePanel, { props: { active: false } })
    await flushPromises()
    expect(pathsTo(get, GBP)).toHaveLength(0)
  })
})

const months = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
const keyword = (changes: Partial<SearchKeyword> = {}): SearchKeyword => ({
  id: 'k1', text: '三民區 幼兒園', created_at: '2026-11-20T02:00:00Z', synced_at: '2026-11-25T02:00:00Z',
  volumes: [
    { geo: 'kaohsiung', cells: months.map((m, i) => ({ month: m, available: true, searches: i === 0 ? null : 100 * i })) },
    { geo: 'sanmin', cells: months.map((m) => ({ month: m, available: m === '2026-10', searches: m === '2026-10' ? 40 : null })) },
    { geo: 'zuoying', cells: months.map((m) => ({ month: m, available: false, searches: null })) },
  ],
  ...changes,
})
const demand = (changes: Partial<SearchDemand> = {}): SearchDemand => ({
  configured: true,
  geos: [{ key: 'kaohsiung', label: '高雄市' }, { key: 'sanmin', label: '三民區' }, { key: 'zuoying', label: '左營區' }],
  months, keywords: [keyword()], keyword_limit: 50,
  last_success_at: '2026-11-25T02:00:00Z', last_attempt_at: '2026-11-25T02:00:00Z', failed: false, error: null,
  ...changes,
})

describe('搜尋需求', () => {
  async function mountDemand(data: unknown = demand()) {
    const get = mockGet({ [DEMAND]: data })
    const mounted = await mountWith(SearchDemandSection, { props: { active: true } })
    await flushPromises()
    return { ...mounted, get }
  }
  const cells = (wrapper: Awaited<ReturnType<typeof mountDemand>>['wrapper']) =>
    wrapper.findAll('[data-test="demand-table"] tbody tr').map((tr) => tr.findAll('th, td').map((cell) => cell.text()))

  it('預設高雄市；量太少不補 0；切到三民區', async () => {
    const { wrapper } = await mountDemand()
    const [row] = cells(wrapper)
    expect(row![0]).toBe('三民區 幼兒園')
    expect(row![1]).toBe('量太少')
    expect(row![12]).toBe('1,100')
    expect(wrapper.findAll('[data-test="demand-table"] thead th')[1]!.text()).toBe('202511 月')
    expect(wrapper.text()).toContain('每週更新一次・最近一次 11/25 10:00')
    const sanmin = wrapper.findAll('[data-test="demand-geo"] label, [data-test="demand-geo"] .el-radio-button').find((item) => item.text() === '三民區')!
    await sanmin.find('input').setValue(true)
    await flushPromises()
    const [after] = cells(wrapper)
    expect(after!.slice(1, 3)).toEqual(['—', '—'])
    expect(after![12]).toBe('40')
  })

  it('還沒同步的關鍵字：整列一句話', async () => {
    const { wrapper } = await mountDemand(demand({ keywords: [keyword({ synced_at: null })] }))
    expect(cells(wrapper)[0]![1]).toBe('還沒同步，一小時內會抓到')
  })

  it('沒設定：可以先加關鍵字', async () => {
    const { wrapper } = await mountDemand(demand({ configured: false, keywords: [keyword({ synced_at: null })], last_success_at: null }))
    expect(wrapper.find('[data-test="demand-unconfigured"]').exists()).toBe(true)
    expect(cells(wrapper)[0]![1]).toBe('Keyword Planner 設定好之後會抓')
    expect(wrapper.get('input[data-test="demand-input"]').attributes('disabled')).toBeUndefined()
  })

  it('同步失敗與部分地區查不到', async () => {
    const { wrapper } = await mountDemand(demand({ failed: true, error: '查詢 Keyword Planner（HTTP 403）' }))
    expect(wrapper.get('[data-test="demand-sync-error"]').text()).toContain('Basic')
    cleanup()
    const partial = await mountDemand(demand({ error: '左營區：查詢 Keyword Planner（HTTP 400）' }))
    expect(partial.wrapper.text()).toContain('；左營區：查詢 Keyword Planner（HTTP 400）')
  })

  it('新增關鍵字後重讀', async () => {
    const { wrapper, get } = await mountDemand()
    const post = mockPost({ [`${DEMAND}/keywords`]: keyword({ id: 'k2', text: '左營 幼稚園', synced_at: null }) })
    await wrapper.get('input[data-test="demand-input"]').setValue('  左營 幼稚園 ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`${DEMAND}/keywords`, { text: '左營 幼稚園' })
    expect(pathsTo(get, DEMAND)).toHaveLength(2)
    expect((wrapper.get('input[data-test="demand-input"]').element as HTMLInputElement).value).toBe('')
  })

  it('滿 50 個不能再加', async () => {
    const { wrapper } = await mountDemand(demand({ keyword_limit: 1 }))
    expect(wrapper.get('input[data-test="demand-input"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('1 / 1')
  })

  it('刪除要先確認', async () => {
    const { wrapper, get } = await mountDemand()
    const remove = mockDelete({ [`${DEMAND}/keywords/`]: undefined })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    await wrapper.get('[data-test="demand-delete"]').trigger('click')
    await flushPromises()
    expect(remove).toHaveBeenCalledWith(`${DEMAND}/keywords/k1`)
    expect(pathsTo(get, DEMAND)).toHaveLength(2)
  })

  it('取消確認就不刪', async () => {
    const { wrapper } = await mountDemand()
    const remove = mockDelete({})
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    await wrapper.get('[data-test="demand-delete"]').trigger('click')
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
  })

  it('沒有關鍵字時說明可以加什麼', async () => {
    const { wrapper } = await mountDemand(demand({ keywords: [] }))
    expect(wrapper.find('[data-test="demand-table"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('還沒有關鍵字')
  })
})
