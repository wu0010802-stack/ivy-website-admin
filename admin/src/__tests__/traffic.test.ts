import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import SiteTrafficPanel from '../components/SiteTrafficPanel.vue'
import { api } from '../api/client'
import { MIN_VITAL_SAMPLES, formatVital, trafficPageLabel, vitalRating, vitalTable, type TrafficSummary, type TrafficVital } from '../api/traffic'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const vital = (metric: TrafficVital['metric'], device: TrafficVital['device'], p75: number, samples: number, rating: TrafficVital['rating'] = 'good'): TrafficVital =>
  ({ metric, device, p75, samples, rating })

const traffic = (days = 28): TrafficSummary => ({
  as_of: '2026-10-03T06:05:00Z',
  days, since: '2026-09-02', until: '2026-09-29', total_views: 120,
  daily: [{ day: '2026-09-29', views: 7 }],
  pages: [{ page: 'home', campus_key: null, views: 80 }, { page: 'campus', campus_key: 'yihua', views: 40 }],
  devices: { mobile: 90, desktop: 30 },
  vitals: [vital('CLS', 'mobile', 0.02, 50), vital('LCP', 'mobile', 3200, 50, 'needs_improvement'), vital('LCP', 'desktop', 5100, 3, 'poor')],
})

describe('官網瀏覽與速度', () => {
  it('頁面名稱用園方看得懂的字', () => {
    expect(trafficPageLabel({ page: 'home', campus_key: null })).toBe('首頁')
    expect(trafficPageLabel({ page: 'campus', campus_key: 'renwu' })).toBe('仁武校介紹頁')
    expect(trafficPageLabel({ page: 'visit', campus_key: 'yihua' })).toBe('義華校預約頁')
    expect(trafficPageLabel({ page: 'visit', campus_key: null })).toBe('預約參觀（選校）')
    // 2026-09-30 起內頁也有瀏覽紀錄，不能被當成預約頁
    expect(trafficPageLabel({ page: 'about', campus_key: null })).toBe('關於常春藤')
    expect(trafficPageLabel({ page: 'curriculum', campus_key: null })).toBe('特色教學')
    expect(trafficPageLabel({ page: 'environment', campus_key: null })).toBe('常春藤環境')
    expect(trafficPageLabel({ page: 'admission', campus_key: null })).toBe('入學資訊')
    expect(trafficPageLabel({ page: 'news', campus_key: null })).toBe('最新消息')
  })

  it('指標單位：LCP 秒、INP 毫秒、CLS 無單位', () => {
    expect(formatVital('LCP', 2345)).toBe('2.3 秒')
    expect(formatVital('INP', 187.6)).toBe('188 毫秒')
    expect(formatVital('CLS', 0.1234)).toBe('0.12')
  })

  it('量測次數太少不給評等；速度表一個指標一列、手機與電腦各一欄', () => {
    expect(vitalRating({ rating: 'poor', samples: MIN_VITAL_SAMPLES - 1 })).toBe('too_few')
    expect(vitalRating({ rating: 'poor', samples: MIN_VITAL_SAMPLES })).toBe('poor')
    const rows = vitalTable(traffic().vitals)
    expect(rows.map(row => row.metric)).toEqual(['LCP', 'CLS'])
    expect(rows[0]!.mobile?.p75).toBe(3200)
    expect(rows[0]!.desktop?.p75).toBe(5100)
    expect(rows[1]!.desktop).toBeNull()
  })
})

describe('瀏覽統計面板', () => {
  async function mountPanel() {
    const get = vi.spyOn(api, 'get').mockResolvedValue(traffic() as never)
    const wrapper = mount(SiteTrafficPanel, { global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    return { wrapper, get }
  }

  it('標題寫出期間，期間選單有看得到的標籤；說明寫清楚算了哪些頁面', async () => {
    const { wrapper } = await mountPanel()
    expect(wrapper.find('h2').text()).toBe('官網瀏覽與速度（近 28 天）')
    expect(wrapper.find('.filter-field > span').text()).toBe('期間')
    const text = wrapper.text()
    // 2026-09-30 起內頁也回報瀏覽：說明要寫進去，並提醒跨過這天的期間不能直接比。
    expect(text).toContain('首頁、五校介紹頁、預約參觀頁')
    expect(text).toContain('2026/09/30 起也計入關於我們、特色教學、常春藤環境、入學資訊與最新消息')
    expect(text).toContain('不能直接比較')
    expect(text).not.toContain('還沒有計入')
    expect(text).not.toContain('只計算公開頁面')
  })

  it('速度表用白話，不出現百分位與縮寫；次數太少標「樣本太少」', async () => {
    const { wrapper } = await mountPanel()
    const table = wrapper.find('.traffic__vitals')
    const text = table.text()
    for (const jargon of ['p75', '百分位', 'LCP', 'INP', 'CLS']) expect(wrapper.text()).not.toContain(jargon)
    expect(table.findAll('tbody tr')).toHaveLength(2)
    expect(table.findAll('thead th').map(th => th.text())).toEqual(['項目', '手機', '電腦'])
    expect(text).toContain('需要改善')
    expect(text).toContain('樣本太少')
    expect(text).not.toContain('不佳')
    expect(text).toContain('量測 3 次')
    expect(table.find('tbody th').attributes('title')).toBe('LCP')
  })

  it('換期間時保留舊數字並寫「更新中…」，標題跟著換', async () => {
    const { wrapper, get } = await mountPanel()
    let resolve!: (value: unknown) => void
    get.mockImplementationOnce(() => new Promise(r => { resolve = r }) as never)
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 7)
    await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/admin/analytics/traffic?days=7')
    expect(wrapper.find('.el-skeleton').exists()).toBe(false)
    expect(wrapper.find('.traffic__panel').classes()).toContain('is-updating')
    expect(wrapper.text()).toContain('更新中…')
    resolve(traffic(7))
    await flushPromises()
    expect(wrapper.find('h2').text()).toBe('官網瀏覽與速度（近 7 天）')
    expect(wrapper.text()).not.toContain('更新中…')
  })
})

describe('每日瀏覽趨勢', () => {
  async function mountWith(daily: TrafficSummary['daily']) {
    vi.spyOn(api, 'get').mockResolvedValue({ ...traffic(), daily } as never)
    const wrapper = mount(SiteTrafficPanel, { global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }

  it('每天一根直條；期間包含 09/30 時標出內頁開始計入', async () => {
    const wrapper = await mountWith([
      { day: '2026-09-29', views: 3 }, { day: '2026-09-30', views: 5 }, { day: '2026-10-01', views: 1 },
    ])
    expect(wrapper.findAll('.daily-bars__col')).toHaveLength(3)
    expect(wrapper.text()).toContain('09/30 起：')
    expect(wrapper.text()).toContain('單位：瀏覽次數')
    expect(wrapper.text()).toContain('10/03 14:05')
  })

  it('期間不含 09/30 時不畫標記', async () => {
    const wrapper = await mountWith([{ day: '2026-10-02', views: 3 }, { day: '2026-10-03', views: 4 }])
    expect(wrapper.text()).not.toContain('09/30 起：')
  })
})
