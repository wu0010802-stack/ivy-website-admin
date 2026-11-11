import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ContentInterestPanel from '../components/ContentInterestPanel.vue'
import { api } from '../api/client'
import { SECTION_LABELS, SOURCE_LABELS, actionLabel, conversionLabel, formatDuration, formatShare, sectionGroups, type EngagementSummary } from '../api/engagement'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const summary = (): EngagementSummary => ({
  days: 28, since: '2026-10-15', until: '2026-11-11', as_of: '2026-11-11T06:05:00Z',
  totals: { visits: 240, sessions: 100, booked_sessions: 8, booked_rate: 0.08, median_active_ms: 42_000, median_session_ms: 95_000, pages_per_session: 2.4 },
  pages: [
    { page: 'home', campus_key: null, visits: 120, median_active_ms: 65_000, bounce_rate: 0.25, median_scroll_pct: 48 },
    { page: 'visit', campus_key: 'yihua', visits: 30, median_active_ms: 130_000, bounce_rate: 0.1, median_scroll_pct: 100 },
  ],
  sections: [
    { page: 'home', key: 'campuses', reached: 40, visits: 120, reach_rate: 0.3333, median_ms: 9_000 },
    { page: 'home', key: 'day', reached: 90, visits: 120, reach_rate: 0.75, median_ms: 31_000 },
    { page: 'home', key: 'zzz-junk', reached: 99, visits: 120, reach_rate: 0.9, median_ms: 1_000 },
    { page: 'admission', key: 'faq', reached: 10, visits: 12, reach_rate: 0.8333, median_ms: 50_000 },
  ],
  actions: [
    { page: 'home', key: 'polaroid_lunch', visits: 33, total: 41 },
    { page: 'admission', key: 'faq_tuition', visits: 9, total: 9 },
    { page: 'home', key: 'junk_key', visits: 500, total: 500 },
  ],
  news: [
    { id: 'garden', title: '小小園丁，把好奇心種進生活裡。', visits: 22, median_active_ms: 48_000, read_rate: 0.6364 },
    { id: 'gone', title: null, visits: 3, median_active_ms: 5_000, read_rate: 0 },
  ],
  sources: [
    { source: 'facebook', sessions: 40, booked_sessions: 5, booked_rate: 0.125 },
    { source: 'line', sessions: 6, booked_sessions: 1, booked_rate: 0.1667 },
  ],
  conversion: [
    { kind: 'page', page: 'home', key: null, sessions: 90, booked_sessions: 6, booked_rate: 0.0667 },
    { kind: 'section', page: 'home', key: 'day', sessions: 50, booked_sessions: 7, booked_rate: 0.14 },
    { kind: 'page', page: 'anniversary', key: null, sessions: 4, booked_sessions: 2, booked_rate: 0.5 },
    { kind: 'section', page: 'home', key: 'zzz-junk', sessions: 80, booked_sessions: 80, booked_rate: 1 },
  ],
})

describe('內容興趣的名稱與格式', () => {
  it('來源代碼都有中文，和後端一致', () => {
    const models = read('../../../backend/app/operations/models.py')
    const line = models.split('\n').find((text) => text.startsWith('ENGAGEMENT_SOURCES = ('))!
    const sources = [...line.matchAll(/"([a-z]+)"/g)].map((m) => m[1]!)
    expect(sources.length).toBeGreaterThan(0)
    expect(sources.filter((source) => !SOURCE_LABELS[source])).toEqual([])
  })

  it('官網元件上標的區塊都有名稱', () => {
    const pages: Record<string, string[]> = {
      home: ['HeroVideo', 'AboutSection', 'DayExperience', 'CampusBoard', 'HomeNewsTransition'],
      about: ['AboutContent'], admission: ['AdmissionContent'], curriculum: ['CurriculumContent'],
      environment: ['EnvironmentContent'], anniversary: ['AnniversaryContent'], news: ['NewsArticleContent', 'NewsIndexContent'],
    }
    const used = Object.entries(pages).flatMap(([page, names]) => names.flatMap((name) =>
      [...read(`../../../web/app/components/${name}.vue`).matchAll(/ data-track-section="([^"]+)"/g)].map((m) => `${page}/${m[1]}`)))
    expect(used.length).toBeGreaterThanOrEqual(30)
    expect(used.filter((key) => !SECTION_LABELS[key])).toEqual([])
  })

  it('互動代碼換成白話；認不得的不顯示', () => {
    expect(actionLabel('polaroid_lunch')).toBe('孩子的一天：翻開「一起用餐」')
    expect(actionLabel('faq_tuition')).toBe('常見問題：學費大概多少？')
    expect(actionLabel('campus_renwu')).toBe('首頁五校：切到仁武校')
    expect(actionLabel('map_yihua')).toBe('首頁五校：點義華校地址（開地圖）')
    expect(actionLabel('hero_video')).toBe('首頁影片：播放／暫停')
    expect([actionLabel('campus_taipei'), actionLabel('junk_key'), actionLabel('x')]).toEqual([null, null, null])
  })

  it('停留與比例的寫法；區塊照看到的比例排、頁面照瀏覽排', () => {
    expect([formatDuration(400), formatDuration(42_000), formatDuration(60_000), formatDuration(95_000)]).toEqual(['0 秒', '42 秒', '1 分', '1 分 35 秒'])
    expect([formatShare(0.3333), formatShare(0), formatShare(null)]).toEqual(['33%', '0%', '—'])
    const groups = sectionGroups(summary().sections)
    expect(groups.map((group) => group.label)).toEqual(['首頁', '入學資訊'])
    expect(groups[0]!.rows.map((row) => row.label)).toEqual(['孩子的一天', '五校介紹'])
    expect(conversionLabel({ kind: 'section', page: 'home', key: 'day' })).toBe('首頁：孩子的一天')
    expect(conversionLabel({ kind: 'section', page: 'home', key: 'zzz-junk' })).toBeNull()
  })
})

describe('內容興趣面板', () => {
  async function mountPanel(data: EngagementSummary = summary()) {
    const get = vi.spyOn(api, 'get').mockResolvedValue(data as never)
    const wrapper = mount(ContentInterestPanel, { global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    return { wrapper, get }
  }

  it('讀近 28 天，列出各頁停留、區塊、互動、消息與來源', async () => {
    const { wrapper, get } = await mountPanel()
    expect(get).toHaveBeenCalledWith('/admin/analytics/engagement?days=28')
    expect(wrapper.find('h2').text()).toBe('內容興趣（近 28 天）')
    const pages = wrapper.find('[data-test="interest-pages"]').text()
    expect(pages).toContain('首頁')
    expect(pages).toContain('1 分 5 秒')
    expect(pages).toContain('義華校預約頁')
    const sections = wrapper.findAll('[data-test="interest-section-group"]')
    expect(sections).toHaveLength(2)
    expect(sections[0]!.text()).toContain('孩子的一天')
    expect(sections[0]!.text()).toContain('75%')
    // 入學資訊只有 12 次瀏覽：標樣本太少。
    expect(sections[1]!.text()).toContain('樣本太少')
    const actions = wrapper.find('[data-test="interest-actions"]').text()
    expect(actions).toContain('孩子的一天：翻開「一起用餐」')
    const news = wrapper.find('[data-test="interest-news"]').text()
    expect(news).toContain('小小園丁')
    expect(news).toContain('64%')
    expect(news).toContain('已下架或改過代號的消息（gone）')
    const sources = wrapper.find('[data-test="interest-sources"]').text()
    expect(sources).toContain('Facebook')
    expect(sources).toContain('13%')
    // 亂送的代碼不出現在畫面上。
    expect(wrapper.text()).not.toContain('junk')
  })

  it('內容與預約：樣本夠的照比例排前面，不夠的不算比例', async () => {
    const { wrapper } = await mountPanel()
    const rows = wrapper.findAll('[data-test="interest-conversion"] tbody tr').map((row) => row.text())
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('首頁：孩子的一天')
    expect(rows[0]).toContain('14%')
    expect(rows[1]).toContain('首頁')
    expect(rows[2]).toContain('30 週年')
    expect(rows[2]).toContain('樣本太少')
  })

  it('還沒有紀錄時寫清楚上線日，不顯示一排 0', async () => {
    const empty = { ...summary(), totals: { visits: 0, sessions: 0, booked_sessions: 0, booked_rate: null, median_active_ms: 0, median_session_ms: 0, pages_per_session: null }, pages: [], sections: [], actions: [], news: [], sources: [], conversion: [] }
    const { wrapper } = await mountPanel(empty)
    expect(wrapper.find('[data-test="interest-empty"]').text()).toContain('2026/11/11 上線')
    expect(wrapper.find('.stat').exists()).toBe(false)
  })

  it('讀取失敗可以重新載入', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('boom')).mockResolvedValue(summary() as never)
    const wrapper = mount(ContentInterestPanel, { global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('無法讀取內容興趣統計')
    await wrapper.find('.el-alert button').trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-test="interest-pages"]').exists()).toBe(true)
  })
})
