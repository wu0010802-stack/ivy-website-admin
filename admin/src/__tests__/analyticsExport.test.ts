// 成效統計匯出（2026-10-03 計畫 Task 12，2026-10-06 依三頁籤改版後的畫面重做）：
// 畫面上每張表都有「匯出 CSV」，欄名同畫面；比率沒有值寫空白（畫面的「—」不進檔案）、計數缺值寫 0、
// 沒有資料的表不顯示按鈕；檔名是「成效統計-表名-範圍-期間-今天（台北）」。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import AnalyticsView from '../views/AnalyticsView.vue'
import BookingOutcomesSection from '../components/analytics/BookingOutcomesSection.vue'
import ClassDistributionPanel from '../components/analytics/ClassDistributionPanel.vue'
import EventTrendPanel from '../components/analytics/EventTrendPanel.vue'
import SiteTrafficPanel from '../components/SiteTrafficPanel.vue'
import { api } from '../api/client'
import { funnelSourceLabel } from '../api/labels'
import type {
  AnalyticsFunnelOut, BookingOutcomesOut, CampusOutcomeOut, ClassDistributionOut, EventTrendOut, OutcomeCountsOut,
} from '../api/types'
import type { TrafficSummary } from '../api/traffic'
import { taipeiToday } from '../admissions/academic'
import { notifyError } from '../composables/notify'
import { useAuthStore } from '../stores/auth'
import { CSV_BOM, downloadCsv } from '../utils/csv'
import { testUser } from './fixtures'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
vi.mock('../composables/notify', () => ({ notifyError: vi.fn(), notifyWarning: vi.fn() }))

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  vi.mocked(downloadCsv).mockReset()
  vi.mocked(notifyError).mockClear()
})

const today = taipeiToday()
// 最近一次下載：檔名＋拆成一列一列（含最後的空字串，CRLF 結尾）。
function lastDownload() {
  const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
  return { filename, lines: csv.split('\r\n') }
}
const click = (wrapper: VueWrapper, test: string) => wrapper.get(`[data-test="${test}"]`).trigger('click')

const outcome = (created: number, confirmed: number, completed: number, cancelled: number) => ({
  request_created: created, visit_confirmed: confirmed, visit_completed: completed, visit_cancelled: cancelled,
})
const clicks = (form: number, line = 0, phone = 0, external = 0) => ({
  booking_cta_clicked: form, cta_click_line: line, cta_click_phone: phone, cta_click_external: external,
})

// ---- AnalyticsView：依來源、預約鈕點擊（其餘面板照 analyticsFunnel.test.ts 全部 stub）----

const funnel: AnalyticsFunnelOut = {
  as_of: '2026-10-03T06:05:00Z',
  campus_key: 'yihua',
  date_from: null,
  date_to: null,
  counts: { ...outcome(7, 4, 2, 4), ...clicks(14, 5, 3, 0) },
  cancelled_by_reason: {},
  by_source: [
    { source: 'unknown', counts: outcome(2, 0, 0, 0) },
    { source: 'line', counts: outcome(1, 0, 0, 2) },
    { source: 'phone', counts: outcome(0, 1, 0, 0) },
    { source: 'web', counts: outcome(4, 3, 2, 1) },
  ],
  by_referral: [
    { referral: 'none', counts: outcome(3, 1, 1, 1) },
    { referral: 'facebook', counts: outcome(5, 3, 2, 0) },
  ],
  clicks_by_entry: [
    { entry: 'header', counts: clicks(2, 1) },
    { entry: 'campus_hero', counts: clicks(12, 1, 0, 3) },
  ],
  unassigned_clicks: {},
}

async function mountAnalytics(data: AnalyticsFunnelOut = funnel) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/analytics')
  await router.isReady()
  // 後端把查詢的期間原樣寫回 date_from／date_to（沒選期間是 null）。
  vi.spyOn(api, 'get').mockImplementation((url) => {
    const query = new URL(String(url), 'http://localhost').searchParams
    return Promise.resolve({ ...data, date_from: query.get('from'), date_to: query.get('to') }) as Promise<never>
  })
  const wrapper = mount(AnalyticsView, {
    global: {
      plugins: [pinia, router, ElementPlus],
      stubs: { SiteTrafficPanel: true, BookingOutcomesSection: true, EventTrendPanel: true, ClassDistributionPanel: true },
      provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('成效統計匯出：依來源與預約鈕點擊', () => {
  it('「案件來源」欄名同畫面；沒有送出需求或取消比送出多時，取消率寫空白', async () => {
    const wrapper = await mountAnalytics()
    await click(wrapper, 'analytics-csv-dimension')
    const { filename, lines } = lastDownload()
    expect(filename).toBe(`成效統計-案件來源-義華-開站至今-${today}.csv`)
    expect(lines).toEqual([
      `${CSV_BOM}來源,送出,確認,完成,取消,取消率`,
      `${funnelSourceLabel('web')},4,3,2,1,25%`,
      `${funnelSourceLabel('phone')},0,1,0,0,`, // 沒送出需求：「—」不寫進檔案
      `${funnelSourceLabel('line')},1,0,0,2,`, // 取消比送出多：畫面不計取消率
      '未記錄來源,2,0,0,0,0%',
      '',
    ])
  })

  it('切到「從哪裡知道我們」匯出的是那一張表，欄名與檔名跟著換', async () => {
    const wrapper = await mountAnalytics()
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 'referral')
    await flushPromises()
    await click(wrapper, 'analytics-csv-dimension')
    const { filename, lines } = lastDownload()
    expect(filename).toBe(`成效統計-從哪裡知道我們-義華-開站至今-${today}.csv`)
    expect(lines[0]).toBe(`${CSV_BOM}從哪裡知道,送出,確認,完成,取消,取消率`)
    expect(lines).toHaveLength(4) // 表頭＋兩列＋結尾換行
    expect(lines[1]!.endsWith(',5,3,2,0,0%')).toBe(true)
    expect(lines[2]).toBe('未填寫,3,1,1,1,33%')
  })

  it('選了近 30 天，檔名寫實際日期區間（斜線換成減號）', async () => {
    const wrapper = await mountAnalytics()
    const select = wrapper.findAllComponents({ name: 'ElSelect' }).find((item) => item.props('ariaLabel') === '期間' || item.attributes('aria-label') === '期間')!
    select.vm.$emit('update:modelValue', '30')
    await flushPromises()
    await click(wrapper, 'analytics-csv-entries')
    expect(lastDownload().filename).toMatch(new RegExp(`^成效統計-預約鈕點擊-義華-\\d{4}-\\d{2}-\\d{2}–${today}-${today}\\.csv$`))
  })

  it('「預約鈕點擊」欄名同畫面、照畫面的合計由多到少排', async () => {
    const wrapper = await mountAnalytics()
    await click(wrapper, 'analytics-csv-entries')
    const { filename, lines } = lastDownload()
    expect(filename).toBe(`成效統計-預約鈕點擊-義華-開站至今-${today}.csv`)
    expect(lines).toEqual([
      `${CSV_BOM}按鈕位置,預約表單,LINE,電話,外部網站`,
      '分校頁首屏,12,1,0,3',
      '頁首預約鈕,2,1,0,0',
      '',
    ])
  })

  it('這段期間沒有資料的表不顯示匯出鈕', async () => {
    const wrapper = await mountAnalytics({ ...funnel, by_source: [], by_referral: [], clicks_by_entry: [] })
    expect(wrapper.find('[data-test="analytics-csv-dimension"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="analytics-csv-entries"]').exists()).toBe(false)
  })

  it('下載失敗用 notifyError 提示，不讓錯誤飛出去', async () => {
    const wrapper = await mountAnalytics()
    vi.mocked(downloadCsv).mockImplementationOnce(() => { throw new Error('blocked') })
    await click(wrapper, 'analytics-csv-dimension')
    expect(notifyError).toHaveBeenCalledWith('匯出失敗，請再試一次。')
  })
})

// ---- 五校比較（BookingOutcomesSection）----

const rate = (numerator: number, denominator: number) =>
  ({ value: denominator ? Math.round((numerator / denominator) * 1000) / 10 : null, numerator, denominator })

function counts(over: Partial<OutcomeCountsOut> = {}): OutcomeCountsOut {
  const base = {
    cases: 8, web_cases: 7, upcoming: 1, awaiting_attendance: 1, completed: 2, no_show: 1, cancelled: 2,
    cancelled_by_reason: { parent: 1, staff: 0, hold_expired: 0, unknown: 1 },
    ...over,
  }
  const marked = base.completed + base.no_show
  return { ...base, attendance_rate: rate(base.completed, marked), no_show_rate: rate(base.no_show, marked), cancel_rate: rate(base.cancelled, base.cases) }
}
const EMPTY = { cases: 0, web_cases: 0, upcoming: 0, awaiting_attendance: 0, completed: 0, no_show: 0, cancelled: 0,
  cancelled_by_reason: { parent: 0, staff: 0, hold_expired: 0, unknown: 0 } }
const outcomeRow = (campusKey: string, over: Partial<OutcomeCountsOut> = {}, mode: string | null = 'slots', active = true): CampusOutcomeOut =>
  ({ ...counts(over), campus_key: campusKey, active, booking_mode: mode, open_now: { awaiting_attendance: 2, follow_up_due: 3 } })
const outcomes = (campuses: CampusOutcomeOut[]): BookingOutcomesOut => ({
  as_of: '2026-10-03T06:05:00Z', date_from: null, date_to: null, unit: 'visit_request', campuses, totals: counts(),
  open_now_totals: { awaiting_attendance: 4, follow_up_due: 6 },
})

async function mountOutcomes(data: BookingOutcomesOut) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { campus_keys: ['yihua', 'minghua'] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/analytics')
  await router.isReady()
  vi.spyOn(api, 'get').mockResolvedValue(data as never)
  const wrapper = mount(BookingOutcomesSection, {
    props: { range: null, campusKey: 'yihua', periodLabel: '開站至今', showCompare: true },
    global: { plugins: [pinia, router, ElementPlus] },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('成效統計匯出：五校比較', () => {
  it('欄名同畫面（「現在」標籤併進欄名）；比率沒有分母寫空白、停用的校區照畫面寫；最後一列是合計', async () => {
    const wrapper = await mountOutcomes(outcomes([
      outcomeRow('yihua'),
      outcomeRow('minghua', EMPTY, 'phone'),
      outcomeRow('chongde', {}, 'line', false),
    ]))
    await click(wrapper, 'analytics-csv-compare')
    const { filename, lines } = lastDownload()
    expect(filename).toBe(`成效統計-五校比較-開站至今-${today}.csv`)
    expect(lines).toEqual([
      `${CSV_BOM}校區,預約方式,預約案件,已到場,未到場,到場率,已取消,取消率,待標記到場（現在）,到期待追蹤（現在）`,
      '義華,自選場次,8,2,1,66.7%,2,25.0%,2,3',
      '明華,電話洽詢,0,0,0,,0,,2,3',
      '崇德（已停用）,LINE 官方帳號,8,2,1,66.7%,2,25.0%,2,3',
      '合計,,8,2,1,66.7%,2,25.0%,4,6',
      '',
    ])
  })

  it('檔名用畫面上這批資料的期間，不是剛換的選擇', async () => {
    const wrapper = await mountOutcomes(outcomes([outcomeRow('yihua')]))
    await wrapper.setProps({ periodLabel: '2026/09/01–2026/09/30' }) // 還沒重抓完，畫面仍是舊資料
    await click(wrapper, 'analytics-csv-compare')
    expect(lastDownload().filename).toBe(`成效統計-五校比較-開站至今-${today}.csv`)
  })

  it('沒有任何校區的資料時不顯示匯出鈕', async () => {
    const wrapper = await mountOutcomes(outcomes([]))
    expect(wrapper.find('[data-test="analytics-csv-compare"]').exists()).toBe(false)
  })
})

// ---- 預約孩子的班別（StatsDimensionTable 已有匯出，只傳檔名）----

const dist = (over: Partial<ClassDistributionOut> = {}): ClassDistributionOut => ({
  as_of: '2026-10-03T06:05:00Z', campus_key: 'yihua', date_from: null, date_to: null, school_year: 115, unit: 'visit_request',
  total: 9, grades: [{ grade: '幼幼班', count: 2 }, { grade: '小班', count: 3 }, { grade: '中班', count: 1 }, { grade: '大班', count: 0 }],
  out_of_range: 1, unrecorded: 2, ...over,
})

async function mountClasses(data: ClassDistributionOut) {
  vi.spyOn(api, 'get').mockResolvedValue(data as never)
  const wrapper = mount(ClassDistributionPanel, { props: { campusKey: 'yihua', range: null, periodLabel: '開站至今' }, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('成效統計匯出：預約孩子的班別', () => {
  it('欄名與每一列（含「不在幼幼班～大班」「沒有生日資料」）同畫面', async () => {
    const wrapper = await mountClasses(dist())
    await click(wrapper, 'stats-csv')
    const { filename, lines } = lastDownload()
    expect(filename).toBe(`成效統計-預約孩子的班別-義華-115學年度-開站至今-${today}.csv`)
    expect(lines).toEqual([
      `${CSV_BOM}班別,預約案件`, '幼幼班,2', '小班,3', '中班,1', '大班,0', '不在幼幼班～大班,1', '沒有生日資料,2', '',
    ])
  })

  it('沒有預約案件時畫面不畫表，也沒有匯出鈕', async () => {
    const wrapper = await mountClasses(dist({ total: 0, grades: [], out_of_range: 0, unrecorded: 0 }))
    expect(wrapper.find('[data-test="stats-csv"]').exists()).toBe(false)
  })
})

// ---- 每日變化（DailyBars 的「每日數字」）----

const day = (date: string, over: Partial<EventTrendOut['days'][number]> = {}) =>
  ({ day: date, request_created: 0, visit_completed: 0, visit_cancelled: 0, clicks: 0, ...over })
const trend = (over: Partial<EventTrendOut> = {}): EventTrendOut => ({
  as_of: '2026-10-03T06:05:00Z', campus_key: 'yihua', date_from: '2026-09-30', date_to: '2026-10-02', truncated: false, unit: 'event',
  days: [day('2026-09-30', { request_created: 2, clicks: 1 }), day('2026-10-01', { request_created: 4, clicks: 8 }), day('2026-10-02')],
  ...over,
})

async function mountTrend(data: EventTrendOut) {
  vi.spyOn(api, 'get').mockResolvedValue(data as never)
  const wrapper = mount(EventTrendPanel, { props: { campusKey: 'yihua', range: null, periodLabel: '開站至今' }, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('成效統計匯出：每日變化', () => {
  it('匯出「每日數字」那張表：日期寫完整西元年、順序同畫面（新的在上），檔名寫項目與實際畫出的期間', async () => {
    const wrapper = await mountTrend(trend())
    await click(wrapper, 'daily-bars-csv')
    const { filename, lines } = lastDownload()
    expect(filename).toBe(`成效統計-每日送出需求-義華-2026-09-30–2026-10-02-${today}.csv`)
    expect(lines).toEqual([`${CSV_BOM}日期,送出需求次數`, '2026/10/02,0', '2026/10/01,4', '2026/09/30,2', ''])
  })

  it('切到預約鈕點擊，匯出的是點擊數、檔名跟著換', async () => {
    const wrapper = await mountTrend(trend())
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 'clicks')
    await flushPromises()
    await click(wrapper, 'daily-bars-csv')
    const { filename, lines } = lastDownload()
    expect(filename).toBe(`成效統計-每日預約鈕點擊-義華-2026-09-30–2026-10-02-${today}.csv`)
    expect(lines.slice(0, 4)).toEqual([`${CSV_BOM}日期,預約鈕點擊次數`, '2026/10/02,0', '2026/10/01,8', '2026/09/30,1'])
  })

  it('這段期間沒有資料時不顯示匯出鈕', async () => {
    const wrapper = await mountTrend(trend({ days: [] }))
    expect(wrapper.find('[data-test="daily-bars-csv"]').exists()).toBe(false)
  })
})

// ---- 官網瀏覽與速度（SiteTrafficPanel）----

const vital = (metric: 'LCP' | 'INP' | 'CLS', device: 'mobile' | 'desktop', p75: number, samples: number, rating: 'good' | 'needs_improvement' | 'poor' = 'good') =>
  ({ metric, device, p75, samples, rating })
const traffic = (over: Partial<TrafficSummary> = {}): TrafficSummary => ({
  as_of: '2026-10-03T06:05:00Z',
  days: 28, since: '2026-09-02', until: '2026-09-29', total_views: 120,
  daily: [{ day: '2026-09-28', views: 4 }, { day: '2026-09-29', views: 7 }],
  pages: [{ page: 'home', campus_key: null, views: 80 }],
  devices: { mobile: 90, desktop: 30 },
  vitals: [vital('CLS', 'mobile', 0.02, 50), vital('LCP', 'mobile', 3200, 50, 'needs_improvement'), vital('LCP', 'desktop', 5100, 3, 'poor')],
  ...over,
})

async function mountTraffic(data: TrafficSummary) {
  vi.spyOn(api, 'get').mockResolvedValue(data as never)
  const wrapper = mount(SiteTrafficPanel, { global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('成效統計匯出：官網瀏覽與速度', () => {
  it('每日瀏覽：日期、次數，全站合計所以檔名寫「官網全站」', async () => {
    const wrapper = await mountTraffic(traffic())
    await click(wrapper, 'daily-bars-csv')
    const { filename, lines } = lastDownload()
    expect(filename).toBe(`成效統計-每日瀏覽-官網全站-2026-09-02–2026-09-29-${today}.csv`)
    expect(lines).toEqual([`${CSV_BOM}日期,瀏覽次數`, '2026/09/29,7', '2026/09/28,4', ''])
  })

  it('各頁瀏覽：頁面（畫面上的白話名稱）與瀏覽次數，順序同畫面；全站合計所以檔名寫「官網全站」', async () => {
    const pages: TrafficSummary['pages'] = [
      { page: 'home', campus_key: null, views: 80 },
      { page: 'campus', campus_key: 'yihua', views: 25 },
      { page: 'visit', campus_key: 'yihua', views: 9 },
      { page: 'visit', campus_key: null, views: 3 },
    ]
    const wrapper = await mountTraffic(traffic({ pages }))
    await click(wrapper, 'analytics-csv-pages')
    const { filename, lines } = lastDownload()
    expect(filename).toBe(`成效統計-各頁瀏覽-官網全站-2026-09-02–2026-09-29-${today}.csv`)
    expect(lines).toEqual([`${CSV_BOM}頁面,瀏覽次數`, '首頁,80', '義華校介紹頁,25', '義華校預約頁,9', '預約參觀（選校）,3', ''])
    // 檔案每一列和畫面上排行榜的每一列一一對應。
    expect(wrapper.findAll('.traffic__row').map((row) => row.get('.traffic__label').text())).toEqual(lines.slice(1, -1).map((line) => line.split(',')[0]))
  })

  it('各頁瀏覽匯出失敗用 notifyError 提示，不讓錯誤飛出去', async () => {
    const wrapper = await mountTraffic(traffic())
    vi.mocked(downloadCsv).mockImplementationOnce(() => { throw new Error('blocked') })
    await click(wrapper, 'analytics-csv-pages')
    expect(notifyError).toHaveBeenCalledWith('匯出失敗，請再試一次。')
  })

  it('網頁速度：欄名同畫面，每格寫畫面上的數值、評等與量測次數；沒有資料的格子空白', async () => {
    const wrapper = await mountTraffic(traffic())
    await click(wrapper, 'analytics-csv-vitals')
    const { filename, lines } = lastDownload()
    expect(filename).toBe(`成效統計-網頁速度-官網全站-2026-09-02–2026-09-29-${today}.csv`)
    expect(lines).toEqual([
      `${CSV_BOM}項目,手機,電腦`,
      '主畫面出現,3.2 秒 需要改善 量測 50 次,5.1 秒 樣本太少 量測 3 次',
      '版面跳動,0.02 良好 量測 50 次,',
      '',
    ])
  })

  it('沒有各頁、速度與每日資料時不顯示匯出鈕', async () => {
    const wrapper = await mountTraffic(traffic({ daily: [], vitals: [], pages: [] }))
    expect(wrapper.find('[data-test="daily-bars-csv"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="analytics-csv-vitals"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="analytics-csv-pages"]').exists()).toBe(false)
  })
})
