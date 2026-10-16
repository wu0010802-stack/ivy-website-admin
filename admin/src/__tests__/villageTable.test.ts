// 「各里」合併表（2026-10-16 區域分析工作台規格 §2.8、D11、D15–D17）：招生機會、里的變化、在籍合成一張。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import AreaVillageTable from '../components/admissions/area/AreaVillageTable.vue'
import {
  defaultVillageSort, sortVillageRows, villageColumns, villageCsvCell, villageCsvColumns, villageHowText, villageSortOptions,
  villageTableRows, type VillageTableRow,
} from '../components/admissions/area/villageTable'
import { areaEnrolled, areaOpportunity, areaTrends, villageBoundaries } from './admissionsTestKit'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { CSV_BOM, downloadCsv } from '../utils/csv'

afterEach(() => vi.mocked(downloadCsv).mockClear())

const MINUS = '−'
const GROUP = '三民區寶業里、龍子里（里界調整，合併）'
const notJudged = () => areaOpportunity({ baseline: { ...areaOpportunity().baseline!, judged: false } })
const rowOf = (rows: VillageTableRow[], place: string) => rows.find((row) => row.place === place)!

/** 龍子里（合併組的另一個成員）也有招生機會列，且沒有附近平均。 */
const withLongzi = (expected: number | null) => {
  const opportunity = areaOpportunity()
  opportunity.villages.push({
    district: '鼓山區', village: '龍子里', village_code: '64000020015', distance_m: 900, children: 80, infants: 20,
    visit: 2, rate: 2.5, expected, shortfall: null, signal: 'few_children',
  })
  return opportunity
}

describe('各里表的列與排序', () => {
  it('judged：多參觀四欄、預設參觀偏少、合併組排最後且不判讀', () => {
    const rows = sortVillageRows(villageTableRows(areaTrends(), areaOpportunity(), areaEnrolled()), defaultVillageSort(true))
    expect(rows.map((r) => r.place)).toEqual(['三民區鼎金里', '三民區本揚里', GROUP])
    expect(villageColumns(true, true).map((c) => c.label).slice(-4)).toEqual(['參觀人數', '參觀率', '照附近應有', '判讀'])
    const group = rows[2]!
    expect([group.visit, group.expected_text, group.signal_text, group.enrolled]).toEqual([11, '約 4 位', '—', 1])
    expect(group.merged).toBe(true)
    expect(group.signal).toBeNull()
  })

  it('沒到門檻：沒有參觀欄、預設孩子最多', () => {
    const opp = notJudged()
    expect(villageColumns(false, true).map((c) => c.label)).not.toContain('參觀人數')
    expect(sortVillageRows(villageTableRows(areaTrends(), opp, null), defaultVillageSort(false)).map((r) => r.place))
      .toEqual([GROUP, '三民區鼎金里', '三民區本揚里'])
    expect(villageSortOptions(false).map((o) => o.label)).toEqual(['孩子最多', '增加最多', '減少最多', '新屋最多', '在籍最多'])
    expect(villageSortOptions(true).map((o) => [o.value, o.label])).toEqual([
      ['shortfall', '參觀偏少'], ['children', '孩子最多'], ['up', '增加最多'], ['down', '減少最多'], ['homes', '新屋最多'], ['enrolled', '在籍最多'],
    ])
    expect(defaultVillageSort(true)).toBe('shortfall')
    expect(defaultVillageSort(false)).toBe('children')
  })

  it('沒到門檻時列上不帶判讀（即使後端列仍有 signal）', () => {
    const rows = villageTableRows(areaTrends(), notJudged(), null)
    expect(rows.map((row) => row.signal)).toEqual([null, null, null])
    expect(rows.map((row) => row.signal_text)).toEqual(['—', '—', '—'])
  })

  it('各排序鍵：增加最多、減少最多、新屋最多、在籍最多；同數保留後端順序，沒有值的排最後', () => {
    const rows = villageTableRows(areaTrends(), areaOpportunity(), areaEnrolled())
    const places = (sort: Parameters<typeof sortVillageRows>[1]) => sortVillageRows(rows, sort).map((row) => row.place)
    expect(places('children')).toEqual([GROUP, '三民區鼎金里', '三民區本揚里'])
    expect(places('up')).toEqual(['三民區本揚里', GROUP, '三民區鼎金里'])
    expect(places('down')).toEqual(['三民區鼎金里', GROUP, '三民區本揚里'])
    expect(places('homes')).toEqual(['三民區鼎金里', '三民區本揚里', GROUP])
    expect(places('enrolled')).toEqual(['三民區本揚里', GROUP, '三民區鼎金里'])
    // 原陣列不被改動
    expect(rows.map((row) => row.place)).toEqual(['三民區本揚里', GROUP, '三民區鼎金里'])
    // 在籍名冊沒匯入：全部沒有值，維持後端順序
    const noRoster = villageTableRows(areaTrends(), areaOpportunity(), null)
    expect(sortVillageRows(noRoster, 'enrolled').map((row) => row.place)).toEqual(['三民區本揚里', GROUP, '三民區鼎金里'])
  })

  it('參觀偏少：沒有 shortfall 的孩子少列排在有數字的後面、合併組更後面', () => {
    const opportunity = areaOpportunity()
    opportunity.villages[1] = { ...opportunity.villages[1]!, signal: 'few_children', shortfall: null }
    const rows = sortVillageRows(villageTableRows(areaTrends(), opportunity, null), 'shortfall')
    expect(rows.map((row) => row.place)).toEqual(['三民區鼎金里', '三民區本揚里', GROUP])
    const plain = sortVillageRows(villageTableRows(areaTrends(), areaOpportunity(), null), 'shortfall')
    expect(plain.map((row) => row.shortfall)).toEqual([7, 0, null])
  })

  it('一般的里：欄位格式沿用兩個舊面板', () => {
    const row = rowOf(villageTableRows(areaTrends(), areaOpportunity(), areaEnrolled()), '三民區本揚里')
    expect(row).toMatchObject({
      key: '64000050015', code: '64000050015', codes: ['64000050015'], merged: false, distance: '300 m', children: 317, children_text: '317',
      infants: 90, infants_text: '90', kids_text: '+36（+12.8%）', level_text: '增加多', births_text: '36',
      migration_text: `${MINUS}122`, homes_text: '24', income_text: '45.8 萬', schools_text: '東光國小',
      enrolled: 3, visit: 6, rate: 2, expected_text: '約 6 位', signal: 'typical', signal_text: '差不多',
    })
    const gold = rowOf(villageTableRows(areaTrends(), areaOpportunity(), areaEnrolled()), '三民區鼎金里')
    expect(gold).toMatchObject({ income_text: '51.2 萬*', schools_text: '獅湖國小、民族國小（部分，自由學區）', enrolled: 0, signal_text: '少了約 7 位', expected_text: '約 10 位' })
  })

  it('沒有在籍名冊（沒匯入或還沒到）：在籍是 null，不是 0', () => {
    const none = villageTableRows(areaTrends(), areaOpportunity(), null)
    expect(none.map((row) => row.enrolled)).toEqual([null, null, null])
    const notImported = villageTableRows(areaTrends(), areaOpportunity(), areaEnrolled({ status: 'not_imported', villages: [] }))
    expect(notImported.map((row) => row.enrolled)).toEqual([null, null, null])
  })

  it('合併組：參觀人數、照附近應有、0–1 歲加總，參觀率＝加總參觀 ÷ 組的 2–5 歲', () => {
    const group = rowOf(villageTableRows(areaTrends(), withLongzi(3), null), GROUP)
    expect([group.visit, group.infants, group.expected, group.expected_text]).toEqual([13, 80, 7, '約 7 位'])
    expect(group.rate).toBeCloseTo((13 / 583) * 100, 6)
    expect(group.signal_text).toBe('—')
  })

  it('合併組：有一個里沒有附近平均，照附近應有整個寫「—」', () => {
    const group = rowOf(villageTableRows(areaTrends(), withLongzi(null), null), GROUP)
    expect([group.visit, group.expected, group.expected_text]).toEqual([13, null, '—'])
  })

  it('合併組在籍：組內各里加總；沒有代碼的在籍列用區＋里名對', () => {
    const enrolled = areaEnrolled()
    enrolled.villages.push({ district: '三民區', village: '龍子里', village_code: null, counts: { 幼幼班: 0, 小班: 0, 中班: 1, 大班: 0, 其他: 0 }, total: 1 })
    const group = rowOf(villageTableRows(areaTrends(), areaOpportunity(), enrolled), GROUP)
    expect(group.enrolled).toBe(2)
    expect(group.enrolled_counts).toEqual({ 幼幼班: 1, 小班: 0, 中班: 1, 大班: 0, 其他: 0 })
  })

  it('不在招生機會裡的里（沒有人口資料）：參觀用 no_population_villages 的人數，其餘寫「—」', () => {
    const opportunity = areaOpportunity()
    opportunity.villages = opportunity.villages.filter((row) => row.village_code !== '64000050001')
    opportunity.no_population_villages = [{ district: '三民區', village: '鼎金里', village_code: '64000050001', distance_m: 800, visit: 4 }]
    const row = rowOf(villageTableRows(areaTrends(), opportunity, null), '三民區鼎金里')
    expect([row.visit, row.rate, row.expected_text, row.signal_text]).toEqual([4, null, '—', '—'])
  })

  it('trends 讀不到：以 opportunity 為底、里的變化欄寫「—」', () => {
    const rows = villageTableRows(null, areaOpportunity(), areaEnrolled())
    expect(rows.map((row) => row.place)).toEqual(['三民區鼎金里', '三民區本揚里', '三民區寶業里'])
    expect(rows.every((row) => !row.merged)).toBe(true)
    expect(rowOf(rows, '三民區本揚里')).toMatchObject({
      key: '64000050015', code: '64000050015', distance: '300 m', children: 300, infants_text: '90', kids_text: '—', level_text: '—',
      births_text: '—', migration_text: '—', homes_text: '—', income_text: '—', schools_text: '—', enrolled: 3, visit: 6,
      expected_text: '約 6 位', signal_text: '差不多',
    })
    expect(villageTableRows(null, null, null)).toEqual([])
  })

  it('opportunity 讀不到：以 trends 為底、0–1 歲與參觀欄沒有值', () => {
    const rows = villageTableRows(areaTrends(), null, areaEnrolled())
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.infants === null && row.infants_text === '—' && row.visit === null && row.signal === null)).toBe(true)
    expect(rows.map((row) => row.signal_text)).toEqual(['—', '—', '—'])
  })

  it('里代碼：codes 裡第一個在里界裡找得到的；都找不到、或沒有里界用 codes[0]', () => {
    const trends = areaTrends()
    const all = villageTableRows(trends, areaOpportunity(), null, villageBoundaries())
    expect(rowOf(all, GROUP).code).toBe('64000050025')
    // codes[0]（寶業里）不在里界：換成第一個找得到的（龍子里）
    const boundaries = villageBoundaries()
    boundaries.features = boundaries.features.filter((feature) => feature.properties.VILLCODE !== '64000050025')
    const shifted = villageTableRows(trends, areaOpportunity(), null, boundaries)
    expect(rowOf(shifted, GROUP).code).toBe('64000020015')
    expect(rowOf(shifted, GROUP).codes).toEqual(['64000050025', '64000020015', '64000059999'])
    expect(rowOf(shifted, '三民區本揚里').code).toBe('64000050015')
    // 一個都找不到
    const empty = { ...villageBoundaries(), features: [] }
    expect(rowOf(villageTableRows(trends, areaOpportunity(), null, empty), GROUP).code).toBe('64000050025')
    expect(rowOf(villageTableRows(trends, areaOpportunity(), null, null), GROUP).code).toBe('64000050025')
  })
})

describe('各里表的欄與說明', () => {
  it('2–5 歲：全部有人口用長條，有里沒有人口改文字欄', () => {
    expect(villageColumns(false, true).find((column) => column.label === '2–5 歲')).toMatchObject({ key: 'children', kind: 'bar' })
    expect(villageColumns(false, false).find((column) => column.label === '2–5 歲')).toMatchObject({ key: 'children_text' })
  })

  it('畫面欄：里 sticky 在最前面，judged 才多參觀四欄', () => {
    expect(villageColumns(false, true).map((column) => column.label)).toEqual([
      '里', '距本校', '2–5 歲', '0–1 歲', '這一年淨增', '孩子增減', '近 12 個月出生', '近 12 個月淨遷入', '近 4 季新屋', '所得中位數', '國小學區', '在籍',
    ])
    expect(villageColumns(false, true)[0]).toMatchObject({ key: 'place', sticky: true })
    expect(villageColumns(true, true)).toHaveLength(16)
  })

  it('說明：兩個舊面板的 caption 接起來，「附近」那句只寫一次；沒有資料時是空字串', () => {
    const text = villageHowText(areaTrends(), areaOpportunity())
    expect(text.startsWith('「附近」是里的中心點在半徑內的里。')).toBe(true)
    expect(text.split('「附近」是里的中心點在半徑內的里。')).toHaveLength(2)
    expect(text).toContain('參觀率＝參觀人數 ÷ 2–5 歲孩子數')
    expect(text).toContain('這一年淨增＝本月 2–5 歲減一年前 1–4 歲')
    expect(text).toContain('國小學區依 115 學年度一覽表')
    expect(villageHowText(null, null)).toBe('')
    const onlyTrends = villageHowText(areaTrends(), null)
    expect(onlyTrends).toContain('這一年淨增＝')
    expect(onlyTrends).not.toContain('參觀率＝')
    const onlyOpportunity = villageHowText(null, areaOpportunity())
    expect(onlyOpportunity).toContain('參觀率＝')
    expect(onlyOpportunity).not.toContain('這一年淨增＝')
  })
})

describe('各里表的 CSV', () => {
  const HEADER = [
    '#', '里', '里代碼', '距本校', '2–5 歲', '0–1 歲', '這一年淨增', '一年前 1–4 歲', '孩子增減', '近 12 個月出生', '近 12 個月淨遷入',
    '近 4 季新屋', '最近一季新屋', '所得中位數（千元）', '所得年度', '界線在所得年度後調整', '國小學區', '在籍', '在籍幼幼班', '在籍小班',
    '在籍中班', '在籍大班', '在籍其他', '參觀人數', '參觀率', '照附近應有', '判讀',
  ]

  it('欄名聯集、同一欄只出現一次；參觀四欄不論 judged 都在', () => {
    const labels = villageCsvColumns(true).map((column) => column.label)
    expect(['#', ...labels]).toEqual(HEADER)
    expect(new Set(labels).size).toBe(labels.length)
    expect(villageCsvColumns(false).map((column) => column.label)).toEqual(labels)
  })

  it('格值：數字、拆欄、合併組里代碼、判讀空白', () => {
    const rows = villageTableRows(areaTrends(), areaOpportunity(), areaEnrolled())
    const cells = (row: VillageTableRow) => villageCsvColumns(true).map((column) => villageCsvCell(row, column))
    const columns = villageCsvColumns(true)
    const at = (label: string) => columns.findIndex((column) => column.label === label)

    const group = cells(rowOf(rows, GROUP))
    expect(group[at('里代碼')]).toBe('64000050025、64000020015、64000059999')
    expect([group[at('這一年淨增')], group[at('一年前 1–4 歲')], group[at('孩子增減')], group[at('近 4 季新屋')]]).toEqual([12, 600, '差不多', 0])
    expect([group[at('所得中位數（千元）')], group[at('所得年度')], group[at('界線在所得年度後調整')]]).toEqual(['', '', ''])
    expect([group[at('在籍')], group[at('在籍幼幼班')], group[at('在籍小班')]]).toEqual([1, 1, 0])
    expect([group[at('參觀人數')], group[at('照附近應有')], group[at('判讀')]]).toEqual([11, 4, ''])

    const gold = cells(rowOf(rows, '三民區鼎金里'))
    expect([gold[at('這一年淨增')], gold[at('近 12 個月淨遷入')], gold[at('所得中位數（千元）')], gold[at('所得年度')], gold[at('界線在所得年度後調整')]])
      .toEqual([-22, -68, 512, 112, '是'])
    expect([gold[at('國小學區')], gold[at('照附近應有')], gold[at('判讀')]]).toEqual(['獅湖國小；民族國小（部分，自由學區）', 10, '少了約 7 位'])
    expect(gold[at('在籍')]).toBe(0)
  })

  it('沒有值寫空白：trends 讀不到的里的變化欄、沒名冊的在籍、沒到門檻的判讀', () => {
    const base = villageTableRows(null, notJudged(), null)
    const row = rowOf(base, '三民區本揚里')
    const columns = villageCsvColumns(true)
    const cell = (label: string) => villageCsvCell(row, columns.find((column) => column.label === label)!)
    expect(['這一年淨增', '孩子增減', '近 12 個月出生', '近 12 個月淨遷入', '近 4 季新屋', '所得中位數（千元）', '國小學區', '在籍', '在籍小班', '判讀'].map(cell))
      .toEqual(['', '', '', '', '', '', '', '', '', ''])
    expect([cell('2–5 歲'), cell('0–1 歲'), cell('參觀人數'), cell('照附近應有')]).toEqual([300, 90, 6, 6])
  })
})

const mountTable = (props: Record<string, unknown> = {}) =>
  mount(AreaVillageTable, {
    props: {
      trends: areaTrends(), trendsFailed: false, opportunity: areaOpportunity(), opportunityFailed: false, enrolled: areaEnrolled(),
      boundaries: villageBoundaries(), csvName: (title: string) => `${title}.csv`, ...props,
    },
    global: { plugins: [ElementPlus] },
  })
const places = (wrapper: ReturnType<typeof mountTable>) => wrapper.findAll('tbody th').map((cell) => cell.text())

describe('AreaVillageTable', () => {
  it('標題、預設排序、排序鈕；點排序鈕換順序', async () => {
    const wrapper = mountTable()
    expect(wrapper.get('h3').text()).toBe('各里（本校 3 公里內）')
    expect(places(wrapper)).toEqual(['三民區鼎金里', '三民區本揚里', GROUP])
    expect(wrapper.findAll('.el-radio-button').map((item) => item.text())).toEqual(['參觀偏少', '孩子最多', '增加最多', '減少最多', '新屋最多', '在籍最多'])
    expect(wrapper.get('.el-radio-button.is-active').text()).toBe('參觀偏少')
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 'children')
    await wrapper.vm.$nextTick()
    expect(places(wrapper)).toEqual([GROUP, '三民區鼎金里', '三民區本揚里'])
    wrapper.unmount()
  })

  it('沒到門檻：沒有「參觀偏少」鈕與參觀欄，預設孩子最多', () => {
    const wrapper = mountTable({ opportunity: notJudged() })
    expect(wrapper.findAll('.el-radio-button').map((item) => item.text())).toEqual(['孩子最多', '增加最多', '減少最多', '新屋最多', '在籍最多'])
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).not.toContain('參觀人數')
    expect(places(wrapper)).toEqual([GROUP, '三民區鼎金里', '三民區本揚里'])
    wrapper.unmount()
  })

  it('選了「參觀偏少」後門檻消失：退回孩子最多；選別的排序則不受影響', async () => {
    const wrapper = mountTable()
    const pick = async (value: string) => {
      wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', value)
      await wrapper.vm.$nextTick()
    }
    await pick('shortfall')
    await wrapper.setProps({ opportunity: notJudged() })
    expect(wrapper.get('.el-radio-button.is-active').text()).toBe('孩子最多')
    expect(places(wrapper)).toEqual([GROUP, '三民區鼎金里', '三民區本揚里'])
    await wrapper.setProps({ opportunity: areaOpportunity() })
    await pick('homes')
    await wrapper.setProps({ opportunity: notJudged() })
    expect(wrapper.get('.el-radio-button.is-active').text()).toBe('新屋最多')
    wrapper.unmount()
  })

  it('沒挑過排序時，預設跟著門檻走（招生機會晚到也一樣）', async () => {
    const wrapper = mountTable({ opportunity: null })
    expect(wrapper.get('.el-radio-button.is-active').text()).toBe('孩子最多')
    await wrapper.setProps({ opportunity: areaOpportunity() })
    expect(wrapper.get('.el-radio-button.is-active').text()).toBe('參觀偏少')
    expect(places(wrapper)).toEqual(['三民區鼎金里', '三民區本揚里', GROUP])
    wrapper.unmount()
  })

  it('里名是按鈕，按下 emit select-village 帶里代碼（合併組取里界裡找得到的第一個）', async () => {
    const boundaries = villageBoundaries()
    boundaries.features = boundaries.features.filter((feature) => feature.properties.VILLCODE !== '64000050025')
    const wrapper = mountTable({ boundaries })
    const buttons = wrapper.findAll('tbody th button.stats-table__name-link')
    expect(buttons.map((button) => button.attributes('aria-label'))).toEqual([
      '在地圖上選取：三民區鼎金里', '在地圖上選取：三民區本揚里', `在地圖上選取：${GROUP}`,
    ])
    await buttons[0]!.trigger('click')
    await buttons[2]!.trigger('click')
    expect(wrapper.emitted('select-village')).toEqual([['64000050001'], ['64000020015']])
    wrapper.unmount()
  })

  it('caption 收進「這些數字怎麼算」，預設收起', () => {
    const wrapper = mountTable()
    const details = wrapper.get('details.stats-block__how')
    expect(details.attributes('open')).toBeUndefined()
    expect(details.text()).toContain(villageHowText(areaTrends(), areaOpportunity()))
    wrapper.unmount()
  })

  it('表格下方的 hint：合併組、淨增算不出的原因、沒算進去的參觀', () => {
    const wrapper = mountTable()
    const hints = wrapper.findAll('p.village-table__note').map((item) => item.text())
    expect(hints.join('')).toContain('三民區寶業里、龍子里的里界調整過，合併成一列計算。')
    expect(hints.join('')).toContain('另有 2 位來自 3 公里外、1 位沒填地址、2 位沒對到里，不算在內。')
    wrapper.unmount()
  })

  it('trends 讀取失敗：表格上方一行失敗句＋重試，表格以招生機會為底', async () => {
    const wrapper = mountTable({ trends: null, trendsFailed: true })
    const alert = wrapper.get('.el-alert')
    expect(alert.text()).toContain('無法讀取里的變化，請重新載入。')
    await alert.get('button').trigger('click')
    expect(wrapper.emitted('retry-trends')).toHaveLength(1)
    expect(wrapper.emitted('retry-opportunity')).toBeUndefined()
    expect(places(wrapper)).toEqual(['三民區鼎金里', '三民區本揚里', '三民區寶業里'])
    wrapper.unmount()
  })

  it('opportunity 讀取失敗：失敗句＋重試，表格以里的變化為底、沒有參觀欄', async () => {
    const wrapper = mountTable({ opportunity: null, opportunityFailed: true })
    const alert = wrapper.get('.el-alert')
    expect(alert.text()).toContain('無法讀取招生機會，請重新載入。')
    await alert.get('button').trigger('click')
    expect(wrapper.emitted('retry-opportunity')).toHaveLength(1)
    expect(places(wrapper)).toEqual([GROUP, '三民區鼎金里', '三民區本揚里'])
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).not.toContain('參觀人數')
    wrapper.unmount()
  })

  it('兩份都失敗：兩句失敗句，沒有表格', () => {
    const wrapper = mountTable({ trends: null, trendsFailed: true, opportunity: null, opportunityFailed: true })
    expect(wrapper.findAll('.el-alert').map((alert) => alert.text())).toEqual([
      expect.stringContaining('無法讀取里的變化，請重新載入。'),
      expect.stringContaining('無法讀取招生機會，請重新載入。'),
    ])
    expect(wrapper.find('table').exists()).toBe(false)
    wrapper.unmount()
  })

  it('兩份都還在讀：骨架', () => {
    const wrapper = mountTable({ trends: null, opportunity: null })
    expect(wrapper.find('.el-skeleton').exists()).toBe(true)
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.find('.el-alert').exists()).toBe(false)
    wrapper.unmount()
  })

  it('半徑內沒有里：寫原因', () => {
    const wrapper = mountTable({ trends: areaTrends({ villages: [] }), opportunity: areaOpportunity({ villages: [] }) })
    expect(wrapper.get('.stats-block__empty').text()).toBe('本校 3 公里內沒有里的資料。')
    wrapper.unmount()
  })

  it('匯出 CSV：檔名 csvName(各里)、欄名與合併組一列', async () => {
    const wrapper = mountTable()
    await wrapper.get('[data-test="stats-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('各里.csv')
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(`${CSV_BOM}${HEADER_LINE}`)
    expect(lines).toHaveLength(5)
    expect(lines[3]).toBe(
      '3,三民區寶業里、龍子里（里界調整，合併）,64000050025、64000020015、64000059999,300 m,583,60,12,600,差不多,90,30,0,0,,,,' +
        '光武國小（部分）；鼓山區龍華國小（部分）,1,1,0,0,0,0,11,1.9%,4,',
    )
    wrapper.unmount()
  })
})

const HEADER_LINE = [
  '#', '里', '里代碼', '距本校', '2–5 歲', '0–1 歲', '這一年淨增', '一年前 1–4 歲', '孩子增減', '近 12 個月出生', '近 12 個月淨遷入',
  '近 4 季新屋', '最近一季新屋', '所得中位數（千元）', '所得年度', '界線在所得年度後調整', '國小學區', '在籍', '在籍幼幼班', '在籍小班',
  '在籍中班', '在籍大班', '在籍其他', '參觀人數', '參觀率', '照附近應有', '判讀',
].join(',')
