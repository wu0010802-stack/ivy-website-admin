import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import CruxPanel from '../components/CruxPanel.vue'
import SearchInsightsPanel from '../components/SearchInsightsPanel.vue'
import { api, ApiError } from '../api/client'
import {
  cruxAllInsufficient, cruxRating, cruxTrend, formatCtr, formatPosition, formatRatio, latestCruxWeek, searchPageLabel, searchPeriod,
  type CruxDevice, type CruxHistory, type CruxValue, type CruxWeek, type SearchInsights,
} from '../api/googleInsights'

// 成效統計的兩個外部數據（2026-11-12）：Google 搜尋（Search Console）與 Chrome 真實使用者（CrUX）。
const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach((wrapper) => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

describe('Google 搜尋的算式與文字', () => {
  it('整頁的「近 N 天」換成含今天的起訖日', () => {
    expect(searchPeriod(28, '2026-11-12')).toEqual({ start: '2026-10-16', end: '2026-11-12' })
    expect(searchPeriod(7, '2026-11-12')).toEqual({ start: '2026-11-06', end: '2026-11-12' })
    expect(searchPeriod(90, '2026-11-12')).toEqual({ start: '2026-08-15', end: '2026-11-12' })
    // 跨年、跨月
    expect(searchPeriod(7, '2027-01-03')).toEqual({ start: '2026-12-28', end: '2027-01-03' })
  })

  it('點閱率是小數換成百分比，排名一位小數，沒有資料寫破折號', () => {
    expect(formatCtr(0.0667)).toBe('6.7%')
    expect(formatCtr(0.042)).toBe('4.2%')
    expect(formatCtr(null)).toBe('—')
    expect(formatPosition(8.76)).toBe('8.8')
    expect(formatPosition(null)).toBe('—')
    expect(formatRatio(0.824)).toBe('82%')
    expect(formatRatio(null)).toBe('—')
  })

  it('頁面路徑對得上的寫白話名稱，其餘只寫路徑', () => {
    expect(searchPageLabel('/')).toBe('首頁')
    expect(searchPageLabel('/curriculum')).toBe('特色教學')
    expect(searchPageLabel('/curriculum/')).toBe('特色教學')
    expect(searchPageLabel('/visit/yihua')).toBe('義華校預約頁')
    expect(searchPageLabel('/visit/manage')).toBeNull()
    expect(searchPageLabel('/news/abc123')).toBeNull()
    expect(searchPageLabel('/visit/unknown')).toBeNull()
  })
})

const search = (overrides: Partial<SearchInsights> = {}): SearchInsights => ({
  configured: true,
  start: '2026-10-16',
  end: '2026-11-12',
  as_of: '2026-11-12T06:00:00Z',
  totals: { clicks: 42, impressions: 1000, ctr: 0.042, position: 8.8 },
  queries: [
    { query: '常春藤幼兒園', clicks: 20, impressions: 300, ctr: 0.0667, position: 2.3 },
    { query: '義華 幼兒園', clicks: 9, impressions: 200, ctr: 0.045, position: 5.5 },
  ],
  pages: [
    { page: '/', clicks: 25, impressions: 500, ctr: 0.05, position: 4 },
    { page: '/news/abc123', clicks: 3, impressions: 40, ctr: 0.075, position: 6.1 },
  ],
  devices: [
    { device: 'mobile', clicks: 30, impressions: 700, ctr: 0.043, position: 8 },
    { device: 'desktop', clicks: 10, impressions: 280, ctr: 0.036, position: 9.5 },
  ],
  ...overrides,
})

describe('Google 搜尋面板', () => {
  async function mountPanel(result: SearchInsights | Error, props: { days?: 7 | 28 | 90; active?: boolean } = {}) {
    const get = vi.spyOn(api, 'get')
    if (result instanceof Error) get.mockRejectedValue(result)
    else get.mockResolvedValue(result as never)
    const wrapper = mount(SearchInsightsPanel, { props, global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    return { wrapper, get }
  }

  it('用整頁的期間向後端要資料，總計寫白話', async () => {
    const { wrapper, get } = await mountPanel(search())
    const { start, end } = searchPeriod(28)
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith(`/admin/search-insights?start=${start}&end=${end}`)
    expect(wrapper.find('h2').text()).toBe('Google 搜尋')
    const totals = wrapper.find('[data-test="search-totals"]')
    expect(totals.text()).toContain('點進官網')
    expect(totals.text()).toContain('42')
    expect(totals.text()).toContain('1000')
    expect(totals.text()).toContain('4.2%')
    expect(totals.text()).toContain('8.8')
    // 期間、單位與涵蓋範圍；資料延遲寫在區塊小字。
    expect(wrapper.text()).toContain('2026/10/16–2026/11/12')
    expect(wrapper.text()).toContain('2–3 天延遲')
  })

  it('搜尋字詞與頁面各一張表；頁面對得上的寫名稱加路徑，其餘只寫路徑', async () => {
    const { wrapper } = await mountPanel(search())
    const queries = wrapper.findAll('[data-test="search-queries"] tbody tr')
    expect(queries).toHaveLength(2)
    expect(queries[0]!.text()).toContain('常春藤幼兒園')
    expect(queries[0]!.text()).toContain('6.7%')
    const pages = wrapper.findAll('[data-test="search-pages"] tbody tr')
    expect(pages[0]!.find('th').text()).toBe('首頁/')
    expect(pages[1]!.find('th').text()).toBe('/news/abc123')
    const devices = wrapper.findAll('[data-test="search-devices"] tbody tr')
    expect(devices.map((row) => row.find('th').text())).toEqual(['手機', '電腦'])
    expect(devices[0]!.text()).toContain('75%')
  })

  it('表格有可鍵盤捲動的區域名稱', async () => {
    const { wrapper } = await mountPanel(search())
    const regions = wrapper.findAll('[role="region"]')
    expect(regions.length).toBeGreaterThanOrEqual(2)
    expect(regions.every((region) => region.attributes('tabindex') === '0' && !!region.attributes('aria-label'))).toBe(true)
  })

  it('沒有資料的期間寫「沒有資料」，不留空表格', async () => {
    const { wrapper } = await mountPanel(search({
      totals: { clicks: 0, impressions: 0, ctr: null, position: null }, queries: [], pages: [], devices: [],
    }))
    expect(wrapper.find('[data-test="search-queries"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('這段期間沒有資料')
    expect(wrapper.find('[data-test="search-totals"]').text()).toContain('—')
  })

  it('尚未設定只留一行小字', async () => {
    const { wrapper } = await mountPanel({ configured: false })
    expect(wrapper.find('[data-test="search-unconfigured"]').text()).toBe('尚未設定')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('Google 查詢失敗時寫出步驟與狀態碼，可以重新載入', async () => {
    const { wrapper, get } = await mountPanel({ configured: true, error: '查詢 Search Console（HTTP 403）' })
    expect(wrapper.find('[data-test="search-error"]').text()).toContain('查詢 Search Console（HTTP 403）')
    get.mockResolvedValue(search() as never)
    await wrapper.find('[data-test="search-error"] button').trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-test="search-queries"]').exists()).toBe(true)
  })

  it('連後台 API 都讀不到時顯示錯誤與重新載入', async () => {
    const { wrapper } = await mountPanel(new ApiError(500, null))
    expect(wrapper.find('.el-alert').text()).toContain('無法讀取 Google 搜尋資料')
    expect(wrapper.find('.el-alert button').exists()).toBe(true)
  })

  it('換期間重新讀；不在這一類時不向後端要，切過來才讀，期間沒變不重讀', async () => {
    const { wrapper, get } = await mountPanel(search(), { active: false })
    expect(get).not.toHaveBeenCalled()
    expect(wrapper.find('table').exists()).toBe(false)

    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ days: 7 })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenLastCalledWith(`/admin/search-insights?start=${searchPeriod(7).start}&end=${searchPeriod(7).end}`)
  })

  it('不在這一類時換期間，等切過來才用新期間讀', async () => {
    const { wrapper, get } = await mountPanel(search())
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ days: 90 })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenLastCalledWith(`/admin/search-insights?start=${searchPeriod(90).start}&end=${searchPeriod(90).end}`)
  })

  it('讀取中保留上一次的數字並告訴頁首更新中', async () => {
    const { wrapper, get } = await mountPanel(search())
    let finish: (value: SearchInsights) => void = () => {}
    get.mockReturnValue(new Promise<SearchInsights>((resolve) => { finish = resolve }) as never)
    await wrapper.setProps({ days: 7 })
    await flushPromises()
    expect(wrapper.emitted('updating')?.at(-1)).toEqual([true])
    expect(wrapper.find('[data-test="search-queries"]').exists()).toBe(true)
    finish(search())
    await flushPromises()
    expect(wrapper.emitted('updating')?.at(-1)).toEqual([false])
  })
})

// ---- CrUX ----

const value = (p75: number | null, good: number | null = null, ni: number | null = null, poor: number | null = null): CruxValue =>
  ({ p75, good, needs_improvement: ni, poor })
const emptyValue = value(null)
const week = (lastDate: string, lcp: CruxValue, inp: CruxValue, cls: CruxValue): CruxWeek => ({ last_date: lastDate, lcp, inp, cls })
const okDevice = (form: CruxDevice['form_factor'], lcp: number): CruxDevice => ({
  form_factor: form,
  status: 'ok',
  weeks: [
    week('2026-10-25', emptyValue, emptyValue, emptyValue),
    week('2026-11-01', value(lcp - 100, 0.8, 0.15, 0.05), value(180, 0.9, 0.07, 0.03), value(0.05, 0.95, 0.04, 0.01)),
    week('2026-11-08', value(lcp, 0.82, 0.15, 0.03), value(204, 0.91, 0.06, 0.03), value(0.12, 0.7, 0.2, 0.1)),
  ],
})
const insufficient = (form: CruxDevice['form_factor']): CruxDevice => ({ form_factor: form, status: 'insufficient', weeks: [] })
const crux = (devices: CruxDevice[], overrides: Partial<CruxHistory> = {}): CruxHistory => ({
  configured: true, origin: 'https://www.ivykidschool.com', as_of: '2026-11-12T06:00:00Z', devices, ...overrides,
})

describe('Chrome 真實使用者的評等與取值', () => {
  it('依 Google 的門檻評等：LCP 2.5／4 秒、INP 200／500 毫秒、CLS 0.1／0.25', () => {
    expect(cruxRating('lcp', 2500)).toBe('good')
    expect(cruxRating('lcp', 2501)).toBe('needs_improvement')
    expect(cruxRating('lcp', 4001)).toBe('poor')
    expect(cruxRating('inp', 200)).toBe('good')
    expect(cruxRating('inp', 501)).toBe('poor')
    expect(cruxRating('cls', 0.1)).toBe('good')
    expect(cruxRating('cls', 0.2)).toBe('needs_improvement')
    expect(cruxRating('cls', 0.26)).toBe('poor')
    expect(cruxRating('lcp', null)).toBeNull()
  })

  it('最新一格取最近一個有資料的視窗；走勢由新到舊，沒資料的視窗不列', () => {
    const device = okDevice('phone', 2200)
    expect(latestCruxWeek(device)?.last_date).toBe('2026-11-08')
    expect(cruxTrend(device).map((item) => item.last_date)).toEqual(['2026-11-08', '2026-11-01'])
    expect(latestCruxWeek(insufficient('phone'))).toBeNull()
    expect(cruxAllInsufficient(crux([insufficient('phone'), insufficient('desktop')]))).toBe(true)
    expect(cruxAllInsufficient(crux([okDevice('phone', 2200), insufficient('desktop')]))).toBe(false)
  })
})

describe('Chrome 真實使用者面板', () => {
  async function mountPanel(result: CruxHistory | Error, props: { active?: boolean } = {}) {
    const get = vi.spyOn(api, 'get')
    if (result instanceof Error) get.mockRejectedValue(result)
    else get.mockResolvedValue(result as never)
    const wrapper = mount(CruxPanel, { props, global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    return { wrapper, get }
  }

  it('速度表一個指標一列、手機與電腦各一欄，附評等與好／需要改善／不佳的比例', async () => {
    const { wrapper, get } = await mountPanel(crux([okDevice('phone', 2200), okDevice('desktop', 3100)]))
    expect(get).toHaveBeenCalledWith('/admin/crux')
    expect(wrapper.find('h2').text()).toBe('Chrome 真實使用者28 天滾動，每週更新')
    const header = wrapper.findAll('[data-test="crux-table"] thead th').map((th) => th.text())
    expect(header).toEqual(['項目', '手機', '電腦'])
    const rows = wrapper.findAll('[data-test="crux-table"] tbody tr')
    expect(rows).toHaveLength(3)
    // 主畫面出現：手機 2.2 秒（良好）、電腦 3.1 秒（需要改善）
    expect(rows[0]!.find('th').text()).toContain('主畫面出現')
    const lcp = rows[0]!.findAll('td')
    expect(lcp[0]!.text()).toContain('2.2 秒')
    expect(lcp[0]!.text()).toContain('良好')
    expect(lcp[0]!.text()).toContain('良好 82%・需要改善 15%・不佳 3%')
    expect(lcp[1]!.text()).toContain('3.1 秒')
    expect(lcp[1]!.text()).toContain('需要改善')
    expect(rows[1]!.findAll('td')[0]!.text()).toContain('204 毫秒')
    // 版面跳動 0.12 超過 0.1 → 需要改善
    expect(rows[2]!.findAll('td')[0]!.text()).toContain('0.12')
    expect(rows[2]!.findAll('td')[0]!.text()).toContain('需要改善')
    // 畫面上只用白話，英文縮寫只在滑鼠提示。
    expect(wrapper.text()).not.toMatch(/LCP|INP|CLS|p75|CrUX/)
  })

  it('寫出期間、網域換過的提醒與資料延遲的性質', async () => {
    const { wrapper } = await mountPanel(crux([okDevice('phone', 2200), okDevice('desktop', 3100)]))
    expect(wrapper.text()).toContain('到 2026/11/08 為止的 28 天')
    expect(wrapper.text()).toContain('網域 2026/11/11 才從舊網站換過來')
    expect(wrapper.text()).toContain('https://www.ivykidschool.com')
  })

  it('近 25 週走勢收在可展開的區塊，每個裝置一張表、由新到舊', async () => {
    const { wrapper } = await mountPanel(crux([okDevice('phone', 2200), okDevice('desktop', 3100)]))
    const trend = wrapper.find('[data-test="crux-trend"]')
    expect(trend.find('summary').text()).toBe('近 25 週走勢')
    const tables = trend.findAll('table')
    expect(tables).toHaveLength(2)
    expect(tables[0]!.find('caption').text()).toBe('手機')
    const body = tables[0]!.findAll('tbody tr')
    expect(body.map((row) => row.find('th').text())).toEqual(['2026/11/08', '2026/11/01'])
    expect(body[0]!.text()).toContain('2.2 秒')
    expect(trend.findAll('[role="region"]').every((region) => region.attributes('tabindex') === '0')).toBe(true)
  })

  it('一個裝置資料量不足：那一欄寫「Chrome 使用者數量還不夠」，另一欄照常', async () => {
    const { wrapper } = await mountPanel(crux([okDevice('phone', 2200), insufficient('desktop')]))
    const lcp = wrapper.findAll('[data-test="crux-table"] tbody tr')[0]!.findAll('td')
    expect(lcp[0]!.text()).toContain('2.2 秒')
    expect(lcp[1]!.text()).toBe('Chrome 使用者數量還不夠')
    expect(wrapper.findAll('[data-test="crux-trend"] table')).toHaveLength(1)
  })

  it('兩個裝置都資料量不足：整區只寫一句話', async () => {
    const { wrapper } = await mountPanel(crux([insufficient('phone'), insufficient('desktop')]))
    expect(wrapper.find('[data-test="crux-insufficient"]').text()).toBe('Chrome 使用者數量還不夠，Google 尚未提供這個網站的數據。')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('尚未設定只留一行小字', async () => {
    const { wrapper } = await mountPanel({ configured: false, devices: [] })
    expect(wrapper.find('[data-test="crux-unconfigured"]').text()).toBe('尚未設定')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('Google 查詢失敗時寫出步驟與狀態碼，可以重新載入', async () => {
    const { wrapper, get } = await mountPanel({ configured: true, error: '查詢 CrUX（HTTP 403）', devices: [] })
    expect(wrapper.find('[data-test="crux-error"]').text()).toContain('查詢 CrUX（HTTP 403）')
    get.mockResolvedValue(crux([okDevice('phone', 2200), okDevice('desktop', 3100)]) as never)
    await wrapper.find('[data-test="crux-error"] button').trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-test="crux-table"]').exists()).toBe(true)
  })

  it('不在「瀏覽與速度」時不向後端要，切過來才讀一次', async () => {
    const { wrapper, get } = await mountPanel(crux([okDevice('phone', 2200), okDevice('desktop', 3100)]), { active: false })
    expect(get).not.toHaveBeenCalled()
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(1)
  })
})
