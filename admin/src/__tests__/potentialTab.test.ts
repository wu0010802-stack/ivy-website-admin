// 招生潛力與市佔率（2026-10-20 規格 §5）：大數字卡、走勢圖、各學年數字、國小對帳、來源說明，
// 以及尚未匯入、校址沒定位、讀取失敗、換校區、不在這個子分頁時不讀、匯出。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import PotentialTab from '../components/admissions/potential/PotentialTab.vue'
import ShareTrendChart from '../components/admissions/potential/ShareTrendChart.vue'
import { cleanup, deferred, mockGet, mountWith, pathsTo, potentialData, queryOf, shareYear } from './admissionsTestKit'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { CSV_BOM, downloadCsv } from '../utils/csv'

afterEach(() => {
  vi.mocked(downloadCsv).mockClear()
  cleanup()
})

const PATH = '/admin/admissions/potential'
async function mountPotential(data: unknown = potentialData(), props: Record<string, unknown> = {}) {
  const get = mockGet({ [PATH]: data })
  const mounted = await mountWith(PotentialTab, { props: { campusKey: 'yihua', active: true, ...props } })
  await flushPromises()
  return { ...mounted, get }
}
const tableRows = (wrapper: VueWrapper) => wrapper.findAll('.potential-years tbody tr').map((row) => row.findAll('th, td').map((cell) => cell.text()))

describe('招生潛力與市佔率', () => {
  it('依頁首校區讀', async () => {
    const { get } = await mountPotential()
    const [path] = pathsTo(get, PATH)
    expect(Object.fromEntries(queryOf(path!))).toEqual({ campus_key: 'yihua' })
  })

  it('大數字卡：最新學年的市佔率、分子 ÷ 分母、歷年最高', async () => {
    const { wrapper } = await mountPotential()
    const card = wrapper.get('.potential-card')
    expect(card.get('h3').text()).toBe('115 學年市佔率（3 公里內 2–5 歲）')
    expect(card.get('.potential-card__value').text()).toBe('1.93%')
    expect(card.text()).toContain('189 ÷ 9,788 位')
    expect(card.text()).toContain('歷年最高 1.94%（108 學年）')
  })

  it('最新一年就是歷年最高：寫「是歷年最高」', async () => {
    const years = [shareYear({ school_year: 114, registered: 121, children: 10255 }), shareYear({ school_year: 115, registered: 300, children: 9788 })]
    const { wrapper } = await mountPotential(potentialData({ share: { years } }))
    expect(wrapper.get('.potential-card').text()).toContain('是歷年最高')
    expect(wrapper.get('.potential-card').text()).not.toContain('歷年最高 ')
  })

  it('各學年數字預設收起；展開看得到全部學年，里界合併的學年後面加「*」，下面列出說明', async () => {
    const { wrapper } = await mountPotential()
    const item = wrapper.get('.potential-years .el-collapse-item')
    expect(item.classes()).not.toContain('is-active')
    expect(wrapper.get('.potential-years .el-collapse-item__header').text()).toBe('各學年數字')
    expect(wrapper.findAll('.potential-years thead th').map((cell) => cell.text())).toEqual(['學年', '秋季註冊', '3 公里內 2–5 歲', '市佔率'])
    const rows = tableRows(wrapper)
    expect(rows).toHaveLength(9)
    expect(rows[0]).toEqual(['107', '245', '14,507', '1.69%'])
    expect(rows[1]).toEqual(['108', '279', '14,366', '1.94%'])
    expect(rows[8]).toEqual(['115*', '189', '9,788', '1.93%'])
    expect(wrapper.get('.potential-years__notes').text()).toContain('115 學年里界調整，三民區 1 里合併計入')
  })

  it('沒有孩子數的學年：市佔率與孩子數都是「—」，走勢圖在那裡斷成兩條線', async () => {
    const data = potentialData()
    data.share.years[4] = shareYear({ school_year: 111, registered: 108, children: null })
    const { wrapper } = await mountPotential(potentialData({ share: { years: data.share.years } }))
    expect(tableRows(wrapper)[4]).toEqual(['111', '108', '—', '—'])
    expect(wrapper.findAll('.share-trend polyline')).toHaveLength(2)
    expect(wrapper.findAll('.share-trend circle')).toHaveLength(8)
  })

  it('國小一年級對帳與來源說明', async () => {
    const { wrapper } = await mountPotential()
    const check = wrapper.get('.potential-elementary')
    expect(check.text()).toBe('國小一年級對帳：114 學年 3 公里內各里所屬的 6 所國小，一年級 2,000 位，是 6 歲戶籍的 0.82（歷年 0.80–0.85）。')
    expect(check.classes()).not.toContain('potential-elementary--warn')
    expect(wrapper.get('.potential-source').text()).toBe(
      '註冊人數取自園內目標執行統計表（各學期 9/15）；孩子數取自內政部戶政司各里 9 月底人口；國小一年級取自教育部國民小學校別資料。市佔率的分子含住在 3 公里外的孩子。',
    )
  })

  it('warn：對帳那一行用警示色並加上提醒', async () => {
    const data = potentialData()
    data.share.elementary_check!.warn = true
    const { wrapper } = await mountPotential(data)
    const check = wrapper.get('.potential-elementary')
    expect(check.classes()).toContain('potential-elementary--warn')
    expect(check.text()).toContain('戶籍和實際就學差得比往年多，市佔率的分母可能偏高或偏低。')
  })

  it('沒有對帳資料（學年不足）就不畫那一行', async () => {
    const data = potentialData()
    data.share.elementary_check = null
    const { wrapper } = await mountPotential(data)
    expect(wrapper.find('.potential-elementary').exists()).toBe(false)
    expect(wrapper.find('.potential-source').exists()).toBe(true)
  })

  it('每個學年都沒有孩子數：沒有大數字卡與走勢圖，表格照列、市佔率全是「—」', async () => {
    const years = [shareYear({ school_year: 114, registered: 121, children: null }), shareYear({ school_year: 115, registered: 189, children: null })]
    const { wrapper } = await mountPotential(potentialData({ share: { years } }))
    expect(wrapper.find('.potential-card').exists()).toBe(false)
    expect(wrapper.find('.share-trend').exists()).toBe(false)
    expect(wrapper.get('.potential-empty').text()).toBe('各學年都還沒有九月底的孩子數，算不出市佔率。')
    expect(tableRows(wrapper)).toEqual([['114', '121', '—', '—'], ['115', '189', '—', '—']])
  })

  it('尚未匯入：只有「尚未匯入歷年註冊。」', async () => {
    const data = potentialData({ share: { status: 'not_imported', latest: null, best: null, years: [], elementary_check: null, notes: [] } })
    const { wrapper } = await mountPotential(data)
    expect(wrapper.get('.potential').text()).toBe('尚未匯入歷年註冊。')
    expect(wrapper.find('.share-trend').exists()).toBe(false)
    expect(wrapper.find('.potential-card').exists()).toBe(false)
  })

  it('校址還沒對到門牌：只有原因', async () => {
    const data = potentialData({ share: { status: 'no_campus_point', latest: null, best: null, years: [], elementary_check: null, notes: [] } })
    const { wrapper } = await mountPotential(data)
    expect(wrapper.get('.potential').text()).toBe('分校地址還沒對到門牌，算不出 3 公里範圍。')
  })

  it('讀取失敗：沿用統計的錯誤呈現，重新載入再讀一次', async () => {
    let failing = true
    mockGet({ [PATH]: () => { if (failing) throw new Error('network'); return potentialData() } })
    const { wrapper } = await mountWith(PotentialTab, { props: { campusKey: 'yihua', active: true } })
    await flushPromises()
    expect(wrapper.get('.el-alert').text()).toContain('無法讀取招生潛力與市佔率，請重新載入。')
    failing = false
    await wrapper.get('.el-alert button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.el-alert').exists()).toBe(false)
    expect(wrapper.get('.potential-card__value').text()).toBe('1.93%')
  })

  it('換校區：先清空再讀，只採用最後一次的回應', async () => {
    const first = deferred<ReturnType<typeof potentialData>>()
    const get = mockGet({ [PATH]: (path: string) => (queryOf(path).get('campus_key') === 'yihua' ? first.promise : potentialData({ share: { years: [shareYear({ school_year: 115, registered: 50, children: 5000 })] } })) })
    const { wrapper } = await mountWith(PotentialTab, { props: { campusKey: 'yihua', active: true } })
    await wrapper.setProps({ campusKey: 'renwu' })
    await flushPromises()
    expect(pathsTo(get, PATH).map((path) => queryOf(path).get('campus_key'))).toEqual(['yihua', 'renwu'])
    expect(wrapper.get('.potential-card__value').text()).toBe('1.00%')
    first.resolve(potentialData())
    await flushPromises()
    expect(wrapper.get('.potential-card__value').text()).toBe('1.00%')
  })

  it('A 校請求進行中切離子分頁再換成 B 校：A 的回應晚到也不寫進畫面，回來前不殘留 A 校數字', async () => {
    const first = deferred<ReturnType<typeof potentialData>>()
    const renwu = potentialData({ share: { years: [shareYear({ school_year: 115, registered: 50, children: 5000 })] } })
    mockGet({ [PATH]: (path: string) => (queryOf(path).get('campus_key') === 'yihua' ? first.promise : renwu) })
    const { wrapper } = await mountWith(PotentialTab, { props: { campusKey: 'yihua', active: true } })
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ campusKey: 'renwu' })
    first.resolve(potentialData())
    await flushPromises()
    expect(wrapper.find('.potential-card').exists()).toBe(false)
    expect(wrapper.find('.el-skeleton').exists()).toBe(true)
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(wrapper.get('.potential-card__value').text()).toBe('1.00%')
  })

  it('不在這個子分頁時不讀；回來才讀一次，期間換校區只讀最後一個', async () => {
    const get = mockGet({ [PATH]: potentialData() })
    const { wrapper } = await mountWith(PotentialTab, { props: { campusKey: 'yihua', active: false } })
    await wrapper.setProps({ campusKey: 'renwu' })
    await flushPromises()
    expect(pathsTo(get, PATH)).toEqual([])
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(pathsTo(get, PATH).map((path) => queryOf(path).get('campus_key'))).toEqual(['renwu'])
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(pathsTo(get, PATH)).toHaveLength(1)
  })

  it('匯出 CSV：各學年數字，市佔率寫百分比數字、沒有值寫空白', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-20T09:00:00+08:00'))
    const data = potentialData()
    data.share.years[4] = shareYear({ school_year: 111, registered: 108, children: null })
    const { wrapper } = await mountPotential(potentialData({ share: { years: data.share.years } }))
    await wrapper.get('[data-test="potential-csv"]').trigger('click')
    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls[0]!
    expect(filename).toBe('招生統計-招生潛力與市佔率-義華-2026-10-20.csv')
    const lines = String(csv).replace(CSV_BOM, '').trim().split('\r\n')
    expect(lines[0]).toBe('學年,秋季註冊,3 公里內 2–5 歲,市佔率（%）,里界調整')
    expect(lines[1]).toBe('107,245,14507,1.69,')
    expect(lines[5]).toBe('111,108,,,')
    expect(lines[9]).toBe('115,189,9788,1.93,是')
  })
})

describe('走勢圖', () => {
  it('SVG：aria-label、每點的提示、折線', async () => {
    const { wrapper } = await mountPotential()
    const svg = wrapper.get('svg.share-trend')
    expect(svg.attributes('role')).toBe('img')
    expect(svg.attributes('aria-label')).toBe('107 至 115 學年市佔率走勢')
    expect(svg.attributes('viewBox')).toBe('0 0 520 160')
    expect(svg.attributes('width')).toBe('100%')
    expect(svg.findAll('polyline')).toHaveLength(1)
    const titles = svg.findAll('circle > title').map((title) => title.text())
    expect(titles).toHaveLength(9)
    expect(titles[1]).toBe('108 學年：279 ÷ 14,366 位，1.94%')
  })

  it('x 軸只標第一、最高、最新三個學年（由左到右），軸名「學年」在最左', async () => {
    const { wrapper } = await mountPotential()
    expect(wrapper.findAll('svg.share-trend .share-trend__x').map((label) => label.text())).toEqual(['107', '108', '115'])
    expect(wrapper.get('svg.share-trend .share-trend__axis-title').text()).toBe('學年')
  })

  it('最高就是最新：只標兩個', async () => {
    const years = [shareYear({ school_year: 107, registered: 100 }), shareYear({ school_year: 108, registered: 150 }), shareYear({ school_year: 109, registered: 300 })]
    const { wrapper } = await mountWith(ShareTrendChart, { props: { years } })
    expect(wrapper.findAll('.share-trend__x').map((label) => label.text())).toEqual(['107', '109'])
  })

  it('年份很多、最高緊貼最新（標籤會疊在一起）：最高讓位', async () => {
    const years = Array.from({ length: 24 }, (_, index) => shareYear({ school_year: 107 + index, registered: index === 22 ? 400 : 100 }))
    const { wrapper } = await mountWith(ShareTrendChart, { props: { years } })
    expect(wrapper.findAll('.share-trend__x').map((label) => label.text())).toEqual(['107', '130'])
  })

  it('只有一個學年：畫一個點、不畫線', async () => {
    const { wrapper } = await mountWith(ShareTrendChart, { props: { years: [shareYear()] } })
    expect(wrapper.findAll('polyline')).toHaveLength(0)
    expect(wrapper.findAll('circle')).toHaveLength(1)
    expect(wrapper.get('svg').attributes('aria-label')).toBe('115 學年市佔率走勢')
  })

  it('沒有任何市佔率：不畫圖', async () => {
    const { wrapper } = await mountWith(ShareTrendChart, { props: { years: [shareYear({ children: null })] } })
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  // 手機（≤720px）：viewBox 縮成窄版，SVG 在 360–390px 螢幕上縮放接近 1，軸線文字與圓點不會縮到看不清。
  describe('窄螢幕', () => {
    const stubNarrow = (matches: boolean) =>
      vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    afterEach(() => vi.unstubAllGlobals())

    it('窄螢幕用窄版 viewBox、圓點放大；點的位置與標籤仍在範圍內', async () => {
      stubNarrow(true)
      const { wrapper } = await mountPotential()
      const svg = wrapper.get('svg.share-trend')
      expect(svg.attributes('viewBox')).toBe('0 0 340 170')
      expect(svg.attributes('width')).toBe('100%')
      expect(svg.get('circle').attributes('r')).toBe('5')
      const xs = svg.findAll('circle').map((dot) => Number(dot.attributes('cx')))
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...xs)).toBeLessThanOrEqual(340)
      expect(svg.findAll('.share-trend__x').map((label) => label.text())).toEqual(['107', '108', '115'])
    })

    it('寬螢幕維持 0 0 520 160、圓點半徑 3.5', async () => {
      stubNarrow(false)
      const { wrapper } = await mountPotential()
      expect(wrapper.get('svg.share-trend').attributes('viewBox')).toBe('0 0 520 160')
      expect(wrapper.get('svg.share-trend circle').attributes('r')).toBe('3.5')
    })
  })
})
