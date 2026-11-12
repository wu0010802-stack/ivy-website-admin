import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ContentInterestPanel from '../components/ContentInterestPanel.vue'
import { api } from '../api/client'
import { CLASS_LABELS, FORM_STEP_LABELS, SECTION_LABELS, SOURCE_LABELS, actionLabel, conversionLabel, formatDelta, formatDuration, formatShare, hourGrid, pathLabel, sectionGroups, type EngagementSummary } from '../api/engagement'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const summary = (): EngagementSummary => ({
  days: 28, since: '2026-10-15', until: '2026-11-11', as_of: '2026-11-11T06:05:00Z', device: null,
  totals: { visits: 240, sessions: 100, booked_sessions: 8, booked_rate: 0.08, median_active_ms: 42_000, median_session_ms: 95_000, pages_per_session: 2.4, mobile_sessions: 80 },
  previous: { visits: 150, sessions: 80, booked_sessions: 4, booked_rate: 0.05, median_session_ms: 70_000, pages_per_session: 1.88 },
  daily: [{ day: '2026-11-10', visits: 20, sessions: 9 }, { day: '2026-11-11', visits: 30, sessions: 12 }],
  stories: [
    { kind: 'news', id: 'garden', title: '小小園丁，把好奇心種進生活裡。', visits: 18 },
    { kind: 'event', id: 'visit', title: '秋季校園開放日', visits: 25 },
  ],
  classes: [
    { key: 'class_young', visits: 4 }, { key: 'class_toddler', visits: 12 }, { key: 'class_small', visits: 20 },
    { key: 'class_middle', visits: 3 }, { key: 'class_big', visits: 1 }, { key: 'class_school', visits: 0 },
  ],
  campaigns: [{ campaign: 'open-day-1122', source: 'facebook', sessions: 25, booked_sessions: 5, booked_rate: 0.2 }],
  booking_form: {
    sessions: 40, no_slots_sessions: 6, invalid_sessions: 3,
    steps: [
      { key: 'visit', sessions: 40, rate: 1 }, { key: 'campus', sessions: 32, rate: 0.8 }, { key: 'form_date', sessions: 15, rate: 0.375 },
      { key: 'form_slot', sessions: 13, rate: 0.325 }, { key: 'form_contact', sessions: 11, rate: 0.275 },
      { key: 'form_submit', sessions: 9, rate: 0.225 }, { key: 'booking_done', sessions: 8, rate: 0.2 },
    ],
  },
  journey: {
    sessions: 90,
    entries: [{ page: 'home', sessions: 60, rate: 0.6667 }, { page: 'news', sessions: 30, rate: 0.3333 }],
    exits: [{ page: 'home', sessions: 40, rate: 0.4444 }, { page: 'admission', sessions: 50, rate: 0.5556 }],
    paths: [{ pages: ['home', 'admission', 'visit'], sessions: 22, rate: 0.2444 }, { pages: ['news'], sessions: 18, rate: 0.2 }, { pages: ['home', 'admission', 'visit', 'visit'], sessions: 5, rate: 0.0556 }],
  },
  hours: [{ weekday: 3, hour: 20, visits: 40 }, { weekday: 3, hour: 19, visits: 10 }, { weekday: 7, hour: 10, visits: 30 }, { weekday: 1, hour: 2, visits: 1 }],
  campuses: [
    { campus_key: 'yihua', tab_visits: 12, map_visits: 5, visit_sessions: 20, bookings: 6 },
    { campus_key: 'minghua', tab_visits: 30, map_visits: 9, visit_sessions: 8, bookings: null },
  ],
  pages: [
    { page: 'home', campus_key: null, visits: 120, previous_visits: 80, median_active_ms: 65_000, bounce_rate: 0.25, median_scroll_pct: 48 },
    { page: 'visit', campus_key: 'yihua', visits: 30, previous_visits: 0, median_active_ms: 130_000, bounce_rate: 0.1, median_scroll_pct: 100 },
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
    { id: 'garden', title: '小小園丁，把好奇心種進生活裡。', visits: 22, previous_visits: 44, median_active_ms: 48_000, read_rate: 0.6364 },
    { id: 'gone', title: null, visits: 3, previous_visits: 3, median_active_ms: 5_000, read_rate: 0 },
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
    // 後台新增的卡代號是 moment-<時間戳>：用後端帶來的卡片名稱，不露出代號。
    expect(actionLabel('polaroid_moment-1793877225050', '戶外寫生')).toBe('孩子的一天：翻開「戶外寫生」')
    expect(actionLabel('polaroid_hello', null)).toBe('孩子的一天：翻開「早安入園」')
    expect(actionLabel('polaroid_moment-1793877225050')).toBe('孩子的一天：翻開「已移除的卡」')
    expect(actionLabel('faq_tuition')).toBe('常見問題：學費大概多少？')
    expect(actionLabel('campus_renwu')).toBe('首頁五校：切到仁武校')
    expect(actionLabel('map_yihua')).toBe('首頁五校：點義華校地址（開地圖）')
    expect(actionLabel('hero_video')).toBe('首頁影片：播放／暫停')
    expect([actionLabel('campus_taipei'), actionLabel('junk_key'), actionLabel('x')]).toEqual([null, null, null])
  })

  it('第二輪：表單步驟與班別都有名稱（和後端一致），上一期與時段的換算', () => {
    const models = read('../../../backend/app/operations/models.py')
    const tuple = (name: string) => [...models.split('\n').find((text) => text.startsWith(`${name} = (`))!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!)
    expect(tuple('ENGAGEMENT_FORM_STEPS').filter((key) => !FORM_STEP_LABELS[key])).toEqual([])
    expect(tuple('ENGAGEMENT_CLASS_ACTIONS')).toEqual(Object.keys(CLASS_LABELS))
    expect([formatDelta(120, 80), formatDelta(22, 44), formatDelta(5, 5), formatDelta(3, 0), formatDelta(0, 0), formatDelta(3, null)]).toEqual(['+50%', '−50%', '持平', '上一期沒有', '持平', ''])
    expect([pathLabel(['home', 'admission', 'visit', 'visit']), pathLabel(['news', 'news'])]).toEqual(['首頁 → 入學資訊 → 預約頁', '最新消息'])
    const grid = hourGrid(summary().hours)
    expect([grid.total, grid.max, grid.rows[2]![5], grid.rows[6]![2], grid.rows[0]![0]]).toEqual([81, 50, 50, 30, 1])
    expect(grid.peaks[0]).toEqual({ weekday: '星期三', band: '晚上（18–21 點）', visits: 50 })
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
    const empty: EngagementSummary = {
      ...summary(), previous: null, daily: [], stories: [], classes: summary().classes.map((row) => ({ ...row, visits: 0 })), campaigns: [], hours: [],
      totals: { visits: 0, sessions: 0, booked_sessions: 0, booked_rate: null, median_active_ms: 0, median_session_ms: 0, pages_per_session: null, mobile_sessions: 0 },
      booking_form: { sessions: 0, no_slots_sessions: 0, invalid_sessions: 0, steps: [] }, journey: { sessions: 0, entries: [], exits: [], paths: [] },
      campuses: summary().campuses.map((row) => ({ ...row, tab_visits: 0, map_visits: 0, visit_sessions: 0, bookings: null })),
      pages: [], sections: [], actions: [], news: [], sources: [], conversion: [],
    }
    const { wrapper } = await mountPanel(empty)
    expect(wrapper.find('[data-test="interest-empty"]').text()).toContain('2026/11/11 上線')
    expect(wrapper.find('.stat').exists()).toBe(false)
    for (const name of ['form', 'classes', 'stories', 'campuses', 'entries', 'paths', 'hours', 'campaigns']) expect(wrapper.find(`[data-test="interest-${name}"]`).exists()).toBe(false)
    expect(wrapper.text()).toContain('這段期間沒有帶活動代碼的造訪')
  })

  it('第二輪：和上一期比、每日造訪、只看手機或電腦', async () => {
    const { wrapper, get } = await mountPanel()
    const overview = wrapper.find('#interest-overview-title').element.closest('section')!.textContent!
    expect(overview).toContain('上一期 80 次（+25%）')
    expect(overview).toContain('手機造訪占 80%')
    expect(overview).toContain('每日造訪')
    const pages = wrapper.find('[data-test="interest-pages"]').text()
    expect(pages).toContain('和上一期比')
    expect(pages).toContain('+50%')
    expect(pages).toContain('上一期沒有')
    expect(wrapper.find('[data-test="interest-news"]').text()).toContain('−50%')
    wrapper.findAllComponents({ name: 'ElSelect' })[0]!.vm.$emit('update:modelValue', 'mobile')
    await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/admin/analytics/engagement?days=28&device=mobile')
    expect(wrapper.text()).toContain('只看手機')
  })

  it('第二輪：預約表單標出流失最多的一步', async () => {
    const { wrapper } = await mountPanel()
    const rows = wrapper.findAll('[data-test="interest-form"] li')
    expect(rows.map((row) => row.find('.interest__bar-label').text())).toEqual(['1. 進到預約頁', '2. 選好校區', '3. 選了日期', '4. 選了場次', '5. 開始填資料', '6. 按了「確認預約」', '7. 預約成功'])
    expect(rows[2]!.text()).toContain('比上一步少 17 次（流失最多）')
    expect(rows[2]!.classes()).toContain('is-worst')
    expect(rows.filter((row) => row.classes().includes('is-worst'))).toHaveLength(1)
    const notes = wrapper.find('[data-test="interest-form-notes"]').text()
    expect(notes).toContain('6 次')
    expect(notes).toContain('3 次')
  })

  it('第二輪：班別、首頁消息、各校、瀏覽順序、時段、活動代碼', async () => {
    const { wrapper } = await mountPanel()
    const classes = wrapper.findAll('[data-test="interest-classes"] li').map((row) => row.text())
    expect(classes[2]).toContain('小班')
    expect(classes[2]).toContain('50%')
    const stories = wrapper.find('[data-test="interest-stories"]').text()
    expect(stories).toContain('秋季校園開放日')
    expect(stories).toContain('活動')
    const campuses = wrapper.findAll('[data-test="interest-campuses"] tbody tr').map((row) => row.findAll('td').map((cell) => cell.text()))
    // 沒有權限看的校區，實際預約那一格是「—」。
    expect(campuses).toEqual([['12', '5', '20', '6'], ['30', '9', '8', '—']])
    const entries = wrapper.findAll('[data-test="interest-entries"] tbody tr').map((row) => row.text())
    expect(entries).toHaveLength(3)
    expect(entries[0]).toContain('首頁')
    expect(entries[2]).toContain('入學資訊')
    const paths = wrapper.findAll('[data-test="interest-paths"] li').map((row) => row.text())
    // 只差在有沒有先經過選校頁的兩種順序合併成一列。
    expect(paths).toHaveLength(2)
    expect(paths[0]).toContain('首頁 → 入學資訊 → 預約頁')
    expect(paths[0]).toContain('27 次')
    expect(wrapper.find('[data-test="interest-peaks"]').text()).toContain('星期三晚上（18–21 點） 50 次')
    const heat = wrapper.findAll('[data-test="interest-hours"] tbody tr')
    expect(heat).toHaveLength(7)
    expect(heat[2]!.findAll('td')[5]!.text()).toBe('50')
    const campaigns = wrapper.find('[data-test="interest-campaigns"]').text()
    expect(campaigns).toContain('open-day-1122')
    expect(campaigns).toContain('Facebook')
    expect(campaigns).toContain('20%')
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
