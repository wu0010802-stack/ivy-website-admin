import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ContentInterestPanel from '../components/ContentInterestPanel.vue'
import { api } from '../api/client'
import * as csvExport from '../components/analytics/csvExport'
import type { InterestView } from '../components/analytics/filters'
import { CLASS_LABELS, FORM_STEP_LABELS, MIN_ENGAGEMENT_SAMPLES, SECTION_LABELS, SOURCE_LABELS, actionLabel, conversionLabel, formatDelta, formatDuration, formatShare, hourGrid, pathLabel, sectionGroups, type EngagementSummary } from '../api/engagement'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const summary = (): EngagementSummary => ({
  days: 28, since: '2026-10-15', until: '2026-11-11', as_of: '2026-11-11T06:05:00Z', device: null,
  totals: { visits: 240, sessions: 100, booked_sessions: 8, booked_rate: 0.08, median_active_ms: 42_000, median_session_ms: 95_000, pages_per_session: 2.4, mobile_sessions: 80 },
  cohorts: [
    { returning: false, sessions: 60, campus_sessions: 25, contact_sessions: 5, visit_sessions: 20 },
    { returning: true, sessions: 20, campus_sessions: 9, contact_sessions: 4, visit_sessions: 10 },
    { returning: null, sessions: 20, campus_sessions: 0, contact_sessions: 0, visit_sessions: 0 },
  ],
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
  campus_destinations: {
    tracked_visits: 12, first_day: '2026-11-11',
    rows: ['yihua', 'minghua', 'chongde', 'international', 'renwu'].map((campus_key, i) => ({
      campus_key, available: i ? 0 : 3, empty: i ? 0 : 2, phone: i ? 1 : 2,
      line: i ? 0 : 1, booked: i ? 0 : 2, contact_after_empty: i ? 0 : 1,
    })),
  },
  campus_prefs: [
    { campus_key: 'yihua', sessions: 25, visit_sessions: 10, booked_same: 3, booked_other: 1 },
    { campus_key: 'minghua', sessions: 4, visit_sessions: 1, booked_same: null, booked_other: null },
  ],
  browser: {
    browsers: 80, booked_browsers: 10, booked_rate: 0.125, multi_visit_browsers: 30, first_day: '2026-11-19',
    visits_before_booking: [{ visits: '1', browsers: 4 }, { visits: '2', browsers: 3 }, { visits: '3', browsers: 2 }, { visits: '4_plus', browsers: 1 }],
    sources: [{ source: 'ads', browsers: 40, booked_browsers: 8, booked_rate: 0.2 }, { source: 'line', browsers: 5, booked_browsers: 1, booked_rate: 0.2 }],
    conversion: [
      { kind: 'page', page: 'about', key: null, browsers: 30, booked_browsers: 9, booked_rate: 0.3 },
      { kind: 'page', page: 'home', key: null, browsers: 70, booked_browsers: 10, booked_rate: 0.1429 },
    ],
  },
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
    expect(formatShare(1 / 221)).toBe('0.45%')
    expect(formatShare(1 / 30000)).toBe('<0.01%')
    expect([formatShare(0.3333), formatShare(0), formatShare(null)]).toEqual(['33%', '0%', '—'])
    const groups = sectionGroups(summary().sections)
    expect(groups.map((group) => group.label)).toEqual(['首頁', '入學資訊'])
    expect(groups[0]!.rows.map((row) => row.label)).toEqual(['孩子的一天', '五校介紹'])
    expect(conversionLabel({ kind: 'section', page: 'home', key: 'day' })).toBe('首頁：孩子的一天')
    expect(conversionLabel({ kind: 'section', page: 'home', key: 'zzz-junk' })).toBeNull()
  })
})

describe('內容興趣面板', () => {
  // 2026-11-12 起一份資料分三類顯示（看了什麼／怎麼來、怎麼逛／走到預約），期間與裝置由頁首傳進來。
  async function mountPanel(data: EngagementSummary = summary(), view: InterestView = 'content') {
    const get = vi.spyOn(api, 'get').mockResolvedValue(data as never)
    const wrapper = mount(ContentInterestPanel, { props: { view }, global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    return { wrapper, get }
  }
  const emptySummary = (): EngagementSummary => ({
    ...summary(), cohorts: [], previous: null, daily: [], stories: [], classes: summary().classes.map((row) => ({ ...row, visits: 0 })), campaigns: [], hours: [],
    totals: { visits: 0, sessions: 0, booked_sessions: 0, booked_rate: null, median_active_ms: 0, median_session_ms: 0, pages_per_session: null, mobile_sessions: 0 },
    booking_form: { sessions: 0, no_slots_sessions: 0, invalid_sessions: 0, steps: [] }, journey: { sessions: 0, entries: [], exits: [], paths: [] },
    campus_destinations: { tracked_visits: 0, first_day: null, rows: [] },
    campus_prefs: [],
    browser: { browsers: 0, booked_browsers: 0, booked_rate: null, multi_visit_browsers: 0, first_day: null, visits_before_booking: [], sources: [], conversion: [] },
    campuses: summary().campuses.map((row) => ({ ...row, tab_visits: 0, map_visits: 0, visit_sessions: 0, bookings: null })),
    pages: [], sections: [], actions: [], news: [], sources: [], conversion: [],
  })
  const titles = (wrapper: VueWrapper) => wrapper.findAll('.panel__head h2').map((title) => title.element.firstChild!.textContent)

  it('三類各放哪幾張表', async () => {
    expect(titles((await mountPanel(summary(), 'content')).wrapper)).toEqual(['造訪概況', '各頁停留', '各區塊有多少人看到', '點開了什麼', '單篇消息', '首頁點開的消息', '家長查的是哪個班別'])
    expect(titles((await mountPanel(summary(), 'journey')).wrapper)).toEqual(['從哪裡來', '哪一則貼文或廣告帶來的', '同一瀏覽器的跨次造訪', '從哪一頁進來、哪一頁離開', '最常見的瀏覽順序', '同一瀏覽器的回訪', '什麼時候有人看'])
    expect(titles((await mountPanel(summary(), 'convert')).wrapper)).toEqual(['預約表單卡在哪一步', '各校的興趣與預約', '各校預約去向', '看過哪些內容的造訪比較會預約', '帶著記住的校區回來'])
  })

  it('讀近 28 天，列出各頁停留、區塊、互動與消息', async () => {
    const { wrapper, get } = await mountPanel()
    expect(get).toHaveBeenCalledWith('/admin/analytics/engagement?days=28')
    expect(wrapper.findComponent({ name: 'ElSelect' }).exists()).toBe(false)
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
    // 亂送的代碼不出現在畫面上。
    expect(wrapper.text()).not.toContain('junk')
  })

  it('來源在「怎麼來、怎麼逛」；這一類開頭寫期間、單位與更新時間', async () => {
    const { wrapper } = await mountPanel(summary(), 'journey')
    const sources = wrapper.find('[data-test="interest-sources"]').text()
    expect(sources).toContain('Facebook')
    expect(sources).toContain('13%')
    const context = wrapper.find('[data-test="interest-context"]').text()
    expect(context).toContain('期間 2026/10/15–2026/11/11')
    // 2026-11-20：開頭先用一句話回答「最多從哪裡來」，造訪次數寫在這一句，不在小字裡再寫一次。
    expect(wrapper.get('[data-test="interest-lede"]').text().replace(/\s+/g, '')).toBe('100次造訪裡，最多是Facebook（40次，40%），其次是LINE（6次，6%）。')
    expect(context).not.toContain('共 100 次造訪')
    // 來源表的造訪旁邊寫占比。
    expect(sources).toContain('40（40%）')
    expect(context).toContain('不是人數')
    // 「看了什麼」的造訪概況已經寫了，不重複一行。
    expect((await mountPanel()).wrapper.find('[data-test="interest-context"]').exists()).toBe(false)
  })

  it('內容與預約：樣本夠的照比例排，不夠的收在下面、不排成一整排「樣本太少」', async () => {
    const { wrapper } = await mountPanel(summary(), 'convert')
    const rows = wrapper.findAll('[data-test="interest-conversion"] tbody tr').map((row) => row.text())
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('首頁：孩子的一天')
    expect(rows[0]).toContain('14%')
    expect(rows[1]).toContain('首頁')
    expect(wrapper.get('[aria-labelledby="interest-conversion-title"]').text()).not.toContain('樣本太少')
    const few = wrapper.find('[data-test="interest-conversion-few"]')
    expect(few.find('summary').text()).toBe(`另外 1 項的造訪不到 ${MIN_ENGAGEMENT_SAMPLES} 次，先不算比例`)
    const fewRows = few.findAll('tbody tr').map((row) => row.text())
    expect(fewRows).toHaveLength(1)
    expect(fewRows[0]).toContain('30 週年')
  })

  it('2026-11-20：「走到預約」開頭一句話寫有多少造訪進到預約頁、送出預約', async () => {
    const { wrapper } = await mountPanel(summary(), 'convert')
    expect(wrapper.get('[data-test="interest-lede"]').text().replace(/\s+/g, '')).toBe(`100次造訪裡，40次進到預約頁（40%），${summary().totals.booked_sessions}次送出預約。`)
    const empty = (await mountPanel(emptySummary(), 'convert')).wrapper
    expect(empty.get('[data-test="interest-lede"]').text()).toBe('這段期間還沒有造訪紀錄。')
  })

  it('2026-11-20：整段期間沒有人預約時不排一整排 0%，各項次數收在下面', async () => {
    const data = summary()
    data.totals = { ...data.totals, booked_sessions: 0, booked_rate: 0 }
    data.conversion = data.conversion.map((row) => ({ ...row, booked_sessions: 0, booked_rate: 0 }))
    const { wrapper } = await mountPanel(data, 'convert')
    expect(wrapper.find('[data-test="interest-conversion"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="interest-conversion-nobody"]').text()).toContain('還沒有造訪送出預約')
    // 認不得的代碼不列，其餘三項的造訪數看得到。
    expect(wrapper.findAll('[data-test="interest-conversion-counts"] tbody tr')).toHaveLength(3)
  })

  it('2026-11-20：沒有紀錄的表收成一列（標題＋一句話），位置不變', async () => {
    const data = summary()
    data.news = []
    const { wrapper } = await mountPanel(data)
    const news = wrapper.get('[aria-labelledby="interest-news-title"]')
    expect(news.classes()).toContain('is-empty')
    expect(news.text()).toContain('這段期間還沒有人打開消息內文頁')
    expect(wrapper.get('[aria-labelledby="interest-pages-title"]').classes()).not.toContain('is-empty')
    // 活動代碼沒有紀錄時要教怎麼加，維持完整的卡片。
    const journey = (await mountPanel({ ...summary(), campaigns: [] }, 'journey')).wrapper
    expect(journey.get('[aria-labelledby="interest-campaigns-title"]').classes()).not.toContain('is-empty')
  })

  it('2026-11-20：「點開了什麼」超過 10 項先列前 10 項，可以展開；匯出仍是全部', async () => {
    const data = summary()
    data.actions = ['polaroid_lunch', 'polaroid_hello', 'polaroid_rest', 'faq_tuition', 'faq_fees', 'faq_diaper', 'campus_minghua', 'campus_yihua', 'campus_renwu', 'campus_chongde', 'campus_international', 'hero_video']
      .map((key, index) => ({ page: key.startsWith('faq') ? 'admission' : 'home', key, visits: 50 - index, total: 60 - index }))
    const { wrapper } = await mountPanel(data)
    expect(wrapper.findAll('[data-test="interest-actions"] li')).toHaveLength(10)
    const toggle = wrapper.get('[data-test="interest-actions-toggle"]')
    // 認得的互動代碼才列，總數寫在按鈕上。
    const total = Number(/^顯示全部 (\d+) 項$/.exec(toggle.text())?.[1])
    expect(total).toBeGreaterThan(10)
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(wrapper.findAll('[data-test="interest-actions"] li')).toHaveLength(total)
    expect(toggle.text()).toBe('只看前 10 項')
  })

  it('2026-11-20：各校去向每一格都是 0 時只寫一句話，不排一張全是 0 的表', async () => {
    const data = summary()
    data.campus_destinations = { ...data.campus_destinations!, rows: data.campus_destinations!.rows.map((row) => ({ ...row, available: 0, empty: 0, phone: 0, line: 0, booked: 0, contact_after_empty: 0 })) }
    const { wrapper } = await mountPanel(data, 'convert')
    expect(wrapper.find('[data-test="interest-destinations"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="interest-destinations-quiet"]').text()).toContain('12／240 頁')
  })

  it('內容與預約：每一項都還不到樣本數時寫一句話，不放空表', async () => {
    const data = summary()
    data.conversion = data.conversion.map((row) => ({ ...row, sessions: 5, booked_sessions: 0, booked_rate: 0 }))
    const { wrapper } = await mountPanel(data, 'convert')
    expect(wrapper.find('[data-test="interest-conversion"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="interest-conversion-pending"]').text()).toContain(`每一項的造訪都還不到 ${MIN_ENGAGEMENT_SAMPLES} 次`)
    expect(wrapper.findAll('[data-test="interest-conversion-few"] tbody tr')).toHaveLength(3)
  })

  it('還沒有紀錄時寫清楚上線日，不顯示一排 0', async () => {
    const { wrapper } = await mountPanel(emptySummary())
    expect(wrapper.find('[data-test="interest-empty"]').text()).toContain('2026/11/11 上線')
    expect(wrapper.find('.stat').exists()).toBe(false)
    for (const name of ['classes', 'stories']) expect(wrapper.find(`[data-test="interest-${name}"]`).exists()).toBe(false)
    const journey = (await mountPanel(emptySummary(), 'journey')).wrapper
    for (const name of ['entries', 'paths', 'hours', 'campaigns']) expect(journey.find(`[data-test="interest-${name}"]`).exists()).toBe(false)
    expect(journey.text()).toContain('這段期間沒有帶活動代碼的造訪')
    const convert = (await mountPanel(emptySummary(), 'convert')).wrapper
    for (const name of ['form', 'campuses', 'conversion', 'conversion-few']) expect(convert.find(`[data-test="interest-${name}"]`).exists()).toBe(false)
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
    get.mockResolvedValueOnce({ ...summary(), device: 'mobile' } as never)
    await wrapper.setProps({ device: 'mobile' })
    await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/admin/analytics/engagement?days=28&device=mobile')
    expect(wrapper.text()).toContain('只看手機')
    await wrapper.setProps({ days: 7 })
    await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/admin/analytics/engagement?days=7&device=mobile')
  })

  it('上一期完全沒有紀錄時不放「和上一期比」那一欄', async () => {
    const data = summary()
    data.previous = { visits: 0, sessions: 0, booked_sessions: 0, booked_rate: null, median_session_ms: 0, pages_per_session: null }
    const { wrapper } = await mountPanel(data)
    expect(wrapper.find('#interest-overview-title').element.closest('section')!.textContent).toContain('上一期沒有紀錄')
    expect(wrapper.find('[data-test="interest-pages"]').text()).not.toContain('上一期')
    expect(wrapper.find('[data-test="interest-news"]').text()).not.toContain('上一期')
  })

  it('換期間時保留舊數字、整塊淡一點，並告訴頁首正在更新', async () => {
    const { wrapper, get } = await mountPanel()
    let resolve!: (value: unknown) => void
    get.mockImplementationOnce(() => new Promise(r => { resolve = r }) as never)
    await wrapper.setProps({ days: 90 })
    await flushPromises()
    expect(wrapper.find('.el-skeleton').exists()).toBe(false)
    expect(wrapper.find('.interest__view').classes()).toContain('is-updating')
    expect(wrapper.emitted('updating')!.at(-1)).toEqual([true])
    resolve(summary())
    await flushPromises()
    expect(wrapper.find('.interest__view').classes()).not.toContain('is-updating')
    expect(wrapper.emitted('updating')!.at(-1)).toEqual([false])
  })

  it('第二輪：預約表單標出流失最多的一步', async () => {
    const { wrapper } = await mountPanel(summary(), 'convert')
    const rows = wrapper.findAll('[data-test="interest-form"] li')
    expect(rows.map((row) => row.find('.interest__step-name').text())).toEqual(['1. 進到預約頁', '2. 選好校區', '3. 選了日期', '4. 選了場次', '5. 開始填資料', '6. 按了「確認預約」', '7. 預約成功'])
    expect(rows[2]!.text()).toContain('比上一步少 17 次')
    expect(rows[2]!.find('.el-tag').text()).toBe('流失最多')
    expect(rows[2]!.classes()).toContain('is-worst')
    expect(rows.filter((row) => row.classes().includes('is-worst'))).toHaveLength(1)
    expect(wrapper.findAll('[data-test="interest-form"] .el-tag')).toHaveLength(1)
    const notes = wrapper.find('[data-test="interest-form-notes"]').text()
    expect(notes).toContain('6 次')
    expect(notes).toContain('3 次')
  })

  it('預約表單：前一步就沒有人走到的步驟不重複寫「0%，比上一步少 0 次」', async () => {
    const data = summary()
    data.booking_form = {
      sessions: 4, no_slots_sessions: 0, invalid_sessions: 0,
      steps: [
        { key: 'visit', sessions: 4, rate: 1 }, { key: 'campus', sessions: 2, rate: 0.5 }, { key: 'form_date', sessions: 0, rate: 0 },
        { key: 'form_slot', sessions: 0, rate: 0 }, { key: 'form_contact', sessions: 0, rate: 0 }, { key: 'form_submit', sessions: 0, rate: 0 }, { key: 'booking_done', sessions: 0, rate: 0 },
      ],
    }
    const { wrapper } = await mountPanel(data, 'convert')
    const rows = wrapper.findAll('[data-test="interest-form"] li')
    expect(rows[1]!.find('.interest__bar-note').text()).toBe('50%，比上一步少 2 次')
    expect(rows[2]!.find('.interest__bar-note').text()).toBe('0%，比上一步少 2 次')
    for (const row of rows.slice(3)) {
      expect(row.find('.interest__bar-note').exists()).toBe(false)
      expect(row.classes()).toContain('is-unreached')
    }
    // 兩步各少 2 次：只標前面那一步。
    expect(rows.filter((row) => row.classes().includes('is-worst'))).toHaveLength(1)
    expect(rows[1]!.classes()).toContain('is-worst')
  })

  it('第二輪：班別與首頁消息', async () => {
    const { wrapper } = await mountPanel()
    const classes = wrapper.findAll('[data-test="interest-classes"] li').map((row) => row.text())
    expect(classes[2]).toContain('小班')
    expect(classes[2]).toContain('50%')
    const stories = wrapper.find('[data-test="interest-stories"]').text()
    expect(stories).toContain('秋季校園開放日')
    expect(stories).toContain('活動')
  })

  it('五校去向列出重疊的造訪、區間涵蓋與同一份 CSV；舊版瀏覽顯示未涵蓋', async () => {
    const save = vi.spyOn(csvExport, 'saveAnalyticsCsv').mockImplementation(() => {})
    const { wrapper } = await mountPanel(summary(), 'convert')
    const panel = wrapper.get('[aria-labelledby="interest-destinations-title"]')
    expect(panel.findAll('tbody tr')).toHaveLength(5)
    expect(panel.findAll('tbody tr')[0]!.findAll('td').map((cell) => cell.text())).toEqual(['3', '2', '2', '1', '2', '1'])
    expect(panel.text()).toContain('12／240')
    expect(panel.text()).toContain('2026/11/11')
    await panel.get('button[data-test="interest-csv-destinations"]').trigger('click')
    const [filename, headers, rows] = save.mock.calls[0]!
    expect(filename).toContain('各校預約去向')
    expect(headers).toContain('無場次後點聯絡')
    expect(rows[0]).toEqual(['義華校', 3, 2, 2, 1, 2, 1, '2026-11-11', 12])
    const old = (await mountPanel({ ...summary(), campus_destinations: { tracked_visits: 0, first_day: null, rows: [] } }, 'convert')).wrapper
    expect(old.get('[aria-labelledby="interest-destinations-title"]').text()).toContain('舊版頁面')
    expect(old.find('[data-test="interest-csv-destinations"]').exists()).toBe(false)
  })

  it('2026-11-19：沒有這校招生統計權限時，去向的「完成線上預約」顯示破折號、CSV 留空', async () => {
    const save = vi.spyOn(csvExport, 'saveAnalyticsCsv').mockImplementation(() => {})
    const data = summary()
    data.campus_destinations.rows = data.campus_destinations.rows.map((row, i) => (i ? { ...row, booked: null } : row))
    const { wrapper } = await mountPanel(data, 'convert')
    const panel = wrapper.get('[aria-labelledby="interest-destinations-title"]')
    expect(panel.findAll('tbody tr')[1]!.findAll('td').map((cell) => cell.text())[4]).toBe('—')
    await panel.get('button[data-test="interest-csv-destinations"]').trigger('click')
    expect(save.mock.calls[0]![2][1]![5]).toBe('')
  })

  it('2026-11-19：帶著記住的校區回來，預約欄依權限顯示', async () => {
    const { wrapper } = await mountPanel(summary(), 'convert')
    const rows = wrapper.findAll('[data-test="interest-prefs"] tbody tr').map((row) => row.findAll('th, td').map((cell) => cell.text()))
    expect(rows[0]).toEqual(['義華校', '25', '10（40%）', '3', '1'])
    expect(rows[1]).toEqual(['明華校', '4', '1（樣本太少）', '—', '—'])
  })

  it('2026-11-19：同一瀏覽器的跨次造訪（預約前來了幾次、最早來源）', async () => {
    const { wrapper } = await mountPanel(summary(), 'journey')
    expect(wrapper.get('[data-test="interest-browser-summary"]').text()).toContain('80 個瀏覽器中，30 個來過兩次以上；10 個在這段期間完成線上預約（13%）')
    const visits = wrapper.findAll('[data-test="interest-browser-visits"] tbody tr').map((row) => row.text())
    expect(visits).toEqual(['第 1 次就預約4（40%）', '第 2 次3（30%）', '第 3 次2（20%）', '第 4 次以上1（10%）'])
    const sources = wrapper.findAll('[data-test="interest-browser-sources"] tbody tr').map((row) => row.text())
    expect(sources[0]).toContain('20%')
    expect(sources[1]).toContain('樣本太少')
  })

  it('2026-11-19：內容與預約切到「同一瀏覽器（跨次）」換成瀏覽器為單位', async () => {
    const { wrapper } = await mountPanel(summary(), 'convert')
    wrapper.get('[data-test="interest-conversion-unit"]').findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 'browser')
    await flushPromises()
    expect(wrapper.get('#interest-conversion-title').text()).toContain('看過哪些內容的瀏覽器比較會預約')
    expect(wrapper.get('#interest-conversion-title').text()).toContain('全部瀏覽器 10／80（13%）')
    const rows = wrapper.findAll('[data-test="interest-conversion"] tbody tr').map((row) => row.text())
    expect(rows[0]).toContain('關於常春藤')
    expect(rows[0]).toContain('30%')
  })

  it('第二輪：各校的興趣與預約', async () => {
    const { wrapper } = await mountPanel(summary(), 'convert')
    const campuses = wrapper.findAll('[data-test="interest-campuses"] tbody tr').map((row) => row.findAll('td').map((cell) => cell.text()))
    // 沒有權限看的校區，實際預約那一格是「—」。
    expect(campuses).toEqual([['12', '5', '20', '6'], ['30', '9', '8', '—']])
  })

  // 2026-11-12 QA L34：「實際預約」欄只有看得到預約數的人才有；說明文字不能對其他人還講那一欄。
  it('各校的興趣與預約：沒有「實際預約」欄的人，說明也不提那一欄', async () => {
    const panelOf = (wrapper: VueWrapper) => wrapper.get('[aria-labelledby="interest-campuses-title"]')
    const withoutBookings = summary()
    withoutBookings.campuses = withoutBookings.campuses.map((row) => ({ ...row, bookings: null }))
    const { wrapper: other } = await mountPanel(withoutBookings, 'convert')
    expect(other.findAll('[data-test="interest-campuses"] thead th').map((th) => th.text())).toEqual(['校區', '首頁切到這一校', '點地址', '進預約頁'])
    expect(panelOf(other).text()).not.toContain('實際預約')
    // 說明其他兩段照舊。
    expect(panelOf(other).text()).toContain('前兩欄是首頁五校區塊的點擊')
    expect(panelOf(other).text()).toContain('首頁一打開就顯示的那一校')

    const { wrapper: admin } = await mountPanel(summary(), 'convert')
    expect(admin.findAll('[data-test="interest-campuses"] thead th').map((th) => th.text())).toContain('實際預約')
    expect(panelOf(admin).text()).toContain('「實際預約」是這段期間官網真的送出的預約')
  })

  it('第二輪：瀏覽順序、時段、活動代碼', async () => {
    const { wrapper } = await mountPanel(summary(), 'journey')
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
    // 沒有人看的格子數字照寫，只是淡一點，有數字的格子才跳得出來。
    expect(heat[2]!.findAll('td')[5]!.find('.interest__heat-cell').classes()).not.toContain('is-zero')
    expect(heat[2]!.findAll('td')[0]!.text()).toBe('0')
    expect(heat[2]!.findAll('td')[0]!.find('.interest__heat-cell').classes()).toContain('is-zero')
    const campaigns = wrapper.find('[data-test="interest-campaigns"]').text()
    expect(campaigns).toContain('open-day-1122')
    expect(campaigns).toContain('Facebook')
    expect(campaigns).toContain('20%')
  })

  it('讀取失敗可以重新載入', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('boom')).mockResolvedValue(summary() as never)
    const wrapper = mount(ContentInterestPanel, { props: { view: 'content' }, global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('無法讀取內容興趣統計')
    await wrapper.find('.el-alert button').trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-test="interest-pages"]').exists()).toBe(true)
  })
})
