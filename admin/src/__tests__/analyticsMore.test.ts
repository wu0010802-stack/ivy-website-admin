import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { api } from '../api/client'
import {
  CRAWLER_GROUP_LABELS, CRAWLER_LABELS, changeText, lastYearMonth, monthLabel,
  type ContactHours, type CrawlerSummary, type MonthlyItem, type MonthlySummary, type NotFoundSummary, type StatsHealth,
} from '../api/analyticsMore'
import { TOUCH_SOURCE_LABELS } from '../api/labels'
import ContactHoursPanel from '../components/analytics/ContactHoursPanel.vue'
import CrawlerPanel from '../components/analytics/CrawlerPanel.vue'
import MonthlyPanel from '../components/analytics/MonthlyPanel.vue'
import NotFoundPanel from '../components/analytics/NotFoundPanel.vue'
import StatsHealthBanner from '../components/analytics/StatsHealthBanner.vue'

// 成效統計補強（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md）。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach((wrapper) => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

async function mountWith<T>(component: unknown, result: T, props: Record<string, unknown> = {}) {
  const get = vi.spyOn(api, 'get').mockResolvedValue(result as never)
  const wrapper = mount(component as never, { props: props as never, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, get }
}

describe('名稱和後端一致', () => {
  it('每個爬蟲代碼與類別都有名稱', () => {
    const service = read('../../../backend/app/operations/crawler_service.py')
    const block = service.slice(service.indexOf('CRAWLER_GROUPS'), service.indexOf('}', service.indexOf('CRAWLER_GROUPS')))
    const pairs = [...block.matchAll(/"([a-z0-9-]+)": "([a-z_]+)"/g)].map((m) => [m[1]!, m[2]!] as const)
    expect(pairs.length).toBeGreaterThan(10)
    expect(pairs.filter(([bot]) => !CRAWLER_LABELS[bot]).map(([bot]) => bot)).toEqual([])
    expect([...new Set(pairs.map(([, group]) => group))].filter((group) => !(group in CRAWLER_GROUP_LABELS))).toEqual([])
  })

  it('預約案件的網站來源也認得 AI 助理', () => {
    expect(TOUCH_SOURCE_LABELS.ai).toBe('AI 助理')
  })
})

describe('每月比較', () => {
  it('小工具', () => {
    expect(monthLabel('2026-11')).toBe('2026 年 11 月')
    expect(lastYearMonth('2026-01')).toBe('2025-01')
    expect(changeText(120, 100)).toBe('+20%')
    expect(changeText(80, 100)).toBe('−20%')
    expect(changeText(5, 0)).toBe('去年沒有')
    expect(changeText(null, 100)).toBe('')
  })

  const month = (overrides: Partial<MonthlyItem>): MonthlyItem => ({
    month: '2026-11', first_day: '2026-11-13', last_day: '2026-11-19', complete: false, page_views: 500, bookings: 3,
    sessions: 200, visits: 400, booked_sessions: 4, median_session_ms: 65_000,
    devices: [{ key: 'mobile', sessions: 150, visits: 300, booked_sessions: 3, median_ms: null }],
    sources: [{ key: 'search', sessions: 120, visits: 0, booked_sessions: 2, median_ms: null }, { key: 'ai', sessions: 10, visits: 0, booked_sessions: 1, median_ms: null }],
    returning: [{ key: 'new', sessions: 150, visits: 0, booked_sessions: 0, median_ms: null }, { key: 'returning', sessions: 50, visits: 0, booked_sessions: 0, median_ms: null }],
    pages: [{ key: 'home', sessions: 150, visits: 250, booked_sessions: 0, median_ms: 30_000 }],
    form: [{ key: 'visit', sessions: 30, visits: 0, booked_sessions: 0, median_ms: null }],
    computed_at: '2026-11-20T01:00:00Z',
    ...overrides,
  })
  const summary = (months: MonthlyItem[]): MonthlySummary => ({ months, stats_start: '2026-11-13', as_of: '2026-11-20T02:00:00Z' })

  it('一列一個月：涵蓋天數、手機與回訪占比、沒有去年同月時說明何時開始能比', async () => {
    const { wrapper, get } = await mountWith(MonthlyPanel, summary([month({})]))
    expect(get).toHaveBeenCalledWith('/admin/analytics/monthly')
    const row = wrapper.get('[data-test="monthly-2026-11"]').text()
    expect(row).toContain('2026 年 11 月')
    expect(row).toContain('11/13–11/19')
    expect(row).toContain('75%')
    expect(row).toContain('25%')
    expect(row).toContain('1 分 5 秒')
    expect(wrapper.get('[data-test="monthly-lede"]').text()).toContain('2027 年 11 月起')
    expect(wrapper.get('[data-test="monthly-sources"]').text()).toContain('AI 助理')
  })

  it('有去年同月時每一格下面寫增減；沒有預約權限就不列實際預約', async () => {
    const { wrapper } = await mountWith(MonthlyPanel, summary([
      month({ month: '2027-11', page_views: 600, bookings: null, complete: true, first_day: '2027-11-01', last_day: '2027-11-30' }),
      month({ bookings: null }),
    ]))
    const row = wrapper.get('[data-test="monthly-2027-11"]').text()
    expect(row).toContain('去年 +20%')
    expect(wrapper.get('[data-test="monthly-overview"]').text()).not.toContain('實際預約')
    expect(wrapper.get('[data-test="monthly-lede"]').text()).toContain('比去年同月')
  })

  it('2026-11-20 可讀性：次數加千分位（比例、停留照舊）', async () => {
    const { wrapper } = await mountWith(MonthlyPanel, summary([month({ page_views: 14840, sessions: 2930, visits: 6800, sources: [{ key: 'search', sessions: 1200, visits: 0, booked_sessions: 2, median_ms: null }], pages: [{ key: 'home', sessions: 1500, visits: 2650, booked_sessions: 0, median_ms: 30_000 }], form: [{ key: 'visit', sessions: 1030, visits: 0, booked_sessions: 0, median_ms: null }] })]))
    const row = wrapper.get('[data-test="monthly-2026-11"]').text()
    expect(row).toContain('14,840')
    expect(row).toContain('2,930')
    expect(row).toContain('2.3')
    expect(wrapper.get('[data-test="monthly-sources"]').text()).toContain('1,200（41%）')
    expect(wrapper.get('[data-test="monthly-form"]').text()).toContain('1,030')
    expect(wrapper.get('[data-test="monthly-pages"]').text()).toContain('2,650')
  })

  it('還沒切到這一類不讀', async () => {
    const { get } = await mountWith(MonthlyPanel, summary([]), { active: false })
    expect(get).not.toHaveBeenCalled()
  })
})

describe('統計健康檢查', () => {
  it('有異常才顯示，一條一行', async () => {
    const health: StatsHealth = { day: '2026-11-19', as_of: '2026-11-20T02:00:00Z', issues: [
      { key: 'engagement_low', day: '2026-11-19', message: '11/19 官網有 120 次瀏覽，內容興趣只記到 3 次' },
      { key: 'ga4_silent', day: '2026-11-18', message: '11/18 GA4 沒有收到任何事件' },
    ] }
    const { wrapper } = await mountWith(StatsHealthBanner, health)
    expect(wrapper.findAll('li')).toHaveLength(2)
    expect(wrapper.get('[data-test="stats-health-ga4_silent"]').text()).toContain('GA4')
  })

  it('沒有異常或讀不到都不顯示', async () => {
    const { wrapper } = await mountWith(StatsHealthBanner, { day: '2026-11-19', issues: [], as_of: '' } satisfies StatsHealth)
    expect(wrapper.find('[data-test="stats-health"]').exists()).toBe(false)
    vi.restoreAllMocks()
    vi.spyOn(api, 'get').mockRejectedValue(new Error('down'))
    const failed = mount(StatsHealthBanner, { global: { plugins: [ElementPlus] } })
    wrappers.push(failed)
    await flushPromises()
    expect(failed.find('[data-test="stats-health"]').exists()).toBe(false)
  })
})

describe('找不到的網址與爬蟲', () => {
  it('找不到的網址：訪客與爬蟲分開數，訪客從哪裡來寫白話', async () => {
    const data: NotFoundSummary = {
      days: 28, since: '2026-11-13', until: '2026-11-20', paths_total: 2, as_of: '', probe_hits: 0, probe_paths: 0,
      totals: [{ ref: 'none', hits: 1 }, { ref: 'internal', hits: 0 }, { ref: 'search', hits: 2 }, { ref: 'external', hits: 0 }, { ref: 'crawler', hits: 4 }],
      paths: [{ path: '/blank-1', hits: 7, visitor_hits: 3, last_day: '2026-11-19', refs: [{ ref: 'search', hits: 2 }, { ref: 'none', hits: 1 }, { ref: 'crawler', hits: 4 }] }],
    }
    const { wrapper, get } = await mountWith(NotFoundPanel, data, { days: 28 })
    expect(get).toHaveBeenCalledWith('/admin/analytics/not-found?days=28')
    expect(wrapper.get('[data-test="not-found-lede"]').text()).toContain('訪客打開不存在的網址 3 次')
    const row = wrapper.get('[data-test="not-found-paths"] tbody tr').text()
    expect(row).toContain('/blank-1')
    expect(row).toContain('搜尋引擎 2')
    expect(row).toContain('11/19')
    expect(wrapper.find('[data-test="not-found-probes"]').exists()).toBe(false)
  })

  // 2026-11-27 後台 QA：掃描程式試探 /.env 之類網址，後端已從名單排除；畫面一句話說明、不叫人處理。
  it('掃描程式的試探另寫一句，說明已排除、不用處理；只有試探時也講', async () => {
    const data: NotFoundSummary = {
      days: 28, since: '2026-11-13', until: '2026-11-27', paths_total: 1, as_of: '', probe_hits: 5, probe_paths: 4,
      totals: [{ ref: 'none', hits: 2 }, { ref: 'crawler', hits: 4 }],
      paths: [{ path: '/副本-2025冬令營', hits: 6, visitor_hits: 2, last_day: '2026-11-25', refs: [{ ref: 'none', hits: 2 }, { ref: 'crawler', hits: 4 }] }],
    }
    const { wrapper } = await mountWith(NotFoundPanel, data, { days: 28 })
    const probes = wrapper.get('[data-test="not-found-probes"]').text()
    expect(probes).toContain('5 次')
    expect(probes).toContain('/.env')
    expect(probes).toContain('不用處理')
    expect(wrapper.get('[data-test="not-found-paths"]').text()).not.toContain('/.env')
    vi.restoreAllMocks()

    const onlyProbes: NotFoundSummary = { ...data, paths_total: 0, totals: [], paths: [], probe_hits: 2, probe_paths: 2 }
    const empty = (await mountWith(NotFoundPanel, onlyProbes, { days: 28 })).wrapper
    expect(empty.find('[data-test="not-found-empty"]').exists()).toBe(true)
    expect(empty.get('[data-test="not-found-probes"]').text()).toContain('2 次')
  })

  it('爬蟲依類別分組，AI 即時來讀的另外寫出來', async () => {
    const data: CrawlerSummary = {
      days: 28, since: '2026-11-13', until: '2026-11-20', hits: 12, as_of: '',
      groups: [
        { group: 'ai_user', hits: 3, pages: [{ page: 'about', hits: 3 }], bots: [{ bot: 'chatgpt-user', group: 'ai_user', hits: 3, errors: 0, last_day: '2026-11-19', pages: [{ page: 'about', hits: 3 }] }] },
        { group: 'search', hits: 9, pages: [{ page: 'home', hits: 7 }, { page: 'other', hits: 2 }], bots: [{ bot: 'googlebot', group: 'search', hits: 9, errors: 2, last_day: '2026-11-20', pages: [{ page: 'home', hits: 7 }, { page: 'llms', hits: 2 }] }] },
      ],
    }
    const { wrapper } = await mountWith(CrawlerPanel, data, { days: 28 })
    expect(wrapper.get('[data-test="crawlers-lede"]').text()).toContain('它當下來讀的 3 次')
    expect(wrapper.get('[data-test="crawler-chatgpt-user"]').text()).toContain('ChatGPT（有人在問）')
    const google = wrapper.get('[data-test="crawler-googlebot"]').text()
    expect(google).toContain('首頁 7')
    expect(google).toContain('llms.txt 2')
  })

  it('2026-11-20 可讀性：兩張表的次數加千分位', async () => {
    const missing: NotFoundSummary = {
      days: 28, since: '2026-11-13', until: '2026-11-20', paths_total: 1, as_of: '', probe_hits: 0, probe_paths: 0,
      totals: [{ ref: 'search', hits: 1021 }, { ref: 'crawler', hits: 13400 }],
      paths: [{ path: '/blank-1', hits: 14421, visitor_hits: 1021, last_day: '2026-11-19', refs: [{ ref: 'search', hits: 1021 }, { ref: 'crawler', hits: 13400 }] }],
    }
    const notFound = (await mountWith(NotFoundPanel, missing, { days: 28 })).wrapper
    expect(notFound.get('[data-test="not-found-lede"]').text()).toContain('訪客打開不存在的網址 1,021 次')
    expect(notFound.get('[data-test="not-found-lede"]').text()).toContain('13,400')
    expect(notFound.findAll('[data-test="not-found-paths"] tbody td').map((cell) => cell.text()).filter((text) => text.includes(','))).toEqual(['1,021', '13,400'])
    vi.restoreAllMocks()
    const crawled: CrawlerSummary = {
      days: 28, since: '2026-11-13', until: '2026-11-20', hits: 5236, as_of: '',
      groups: [{ group: 'search', hits: 5236, pages: [{ page: 'home', hits: 5236 }], bots: [{ bot: 'googlebot', group: 'search', hits: 5236, errors: 1612, last_day: '2026-11-20', pages: [{ page: 'home', hits: 5236 }] }] }],
    }
    const crawlers = (await mountWith(CrawlerPanel, crawled, { days: 28 })).wrapper
    expect(crawlers.get('[data-test="crawlers-lede"]').text()).toContain('爬蟲來抓官網 5,236 次')
    const cells = crawlers.get('[data-test="crawler-googlebot"]').findAll('td').map((cell) => cell.text())
    expect([cells[0], cells[2]]).toEqual(['5,236', '1,612'])
  })
})

describe('電話與 LINE 的時段', () => {
  it('上班時間外的比例、星期 × 時段、各校', async () => {
    const data: ContactHours = {
      days: 28, since: '2026-11-13', until: '2026-11-20', as_of: '', clicks: 4, office: 1,
      office_hours: { weekdays: [1, 5], hours: [8, 18] },
      channels: [{ channel: 'phone', clicks: 2, office: 1 }, { channel: 'line', clicks: 2, office: 0 }],
      campuses: [{ campus_key: 'yihua', phone: 2, line: 1, clicks: 3, office: 1 }, { campus_key: 'minghua', phone: 0, line: 1, clicks: 1, office: 0 }],
      cells: [{ weekday: 1, hour: 9, phone: 1, line: 0 }, { weekday: 1, hour: 21, phone: 1, line: 1 }, { weekday: 6, hour: 10, phone: 0, line: 1 }],
    }
    const { wrapper, get } = await mountWith(ContactHoursPanel, data, { days: 28 })
    expect(get).toHaveBeenCalledWith('/admin/analytics/contact-hours?days=28')
    const lede = wrapper.get('[data-test="contact-hours-lede"]').text()
    expect(lede).toContain('3 次（75%）在上班時間（週一到週五 8–18 點）以外')
    const monday = wrapper.findAll('[data-test="contact-hours-grid"] tbody tr')[0]!
    expect(monday.findAll('td').map((cell) => cell.text())).toEqual(['0', '0', '1', '0', '0', '0', '2'])
    expect(monday.findAll('td')[2]!.classes()).toContain('is-office')
    expect(wrapper.get('[data-test="contact-hours-campuses"]').text()).toContain('義華校')
    // 2026-11-20 可讀性：每列的「星期」另外包一層（手機上收起來，七個時段才放得下），文字不變。
    expect(monday.get('th').text()).toBe('星期一')
    expect(monday.get('th .contact-hours__weekday').text()).toBe('星期')
  })
})
