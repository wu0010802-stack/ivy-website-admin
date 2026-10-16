// 區域分析的「完整表格」六個分頁（2026-10-16 規格 §2.7、W9、W12、D13、D14）。AreaTables 單獨掛載，
// 還沒接進 AreaTab（Task 9），資料用 admissionsTestKit 的種子。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import AreaTables from '../components/admissions/area/AreaTables.vue'
import tablesSource from '../components/admissions/area/AreaTables.vue?raw'
import { BIRTH_SERIES_NOTE } from '../components/admissions/area/birthSeriesFormat'
import type { AdmissionsArea } from '../api/types'
import { areaQuery } from '../admissions/areaFilter'
import { AREA_TABLE_TABS, type AreaTableTab } from '../admissions/areaView'
import { areaEnrolled, areaOpportunity, areaPeerFees, areaStats, areaTrends, villageBoundaries } from './admissionsTestKit'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { downloadCsv } from '../utils/csv'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  document.body.innerHTML = ''
  vi.mocked(downloadCsv).mockClear()
})

const EMPTY_TEXT = '義華在 115 學年還沒有招生訪視。新增訪視，或在參觀案件標記家長已到場後，這裡就會有統計。'
function mountTables(changes: Record<string, unknown> = {}): VueWrapper {
  const wrapper = mount(AreaTables as never, {
    props: {
      tab: 'village', area: areaStats() as unknown as AdmissionsArea,
      trends: areaTrends(), trendsFailed: false, opportunity: areaOpportunity(), opportunityFailed: false,
      enrolled: areaEnrolled(), enrolledFailed: false, gradeFilter: 'all',
      peerFees: areaPeerFees(), peerFeesFailed: false, peerAge: 3,
      csvName: (title: string) => `招生統計-${title}.csv`, emptyText: EMPTY_TEXT, boundaries: villageBoundaries(),
      ...changes,
    },
    attachTo: document.body,
    global: { plugins: [ElementPlus] },
  } as never)
  wrappers.push(wrapper)
  return wrapper
}
const tabLabels = (wrapper: VueWrapper) => wrapper.findAll('.el-tabs__item').map((item) => item.text())
const titles = (wrapper: VueWrapper) => wrapper.findAll('.stats-block__title').map((title) => title.text())
const block = (wrapper: VueWrapper, title: string) => wrapper.findAll('.stats-block').find((section) => section.get('.stats-block__title').text() === title)!
const bodyRows = (section: ReturnType<typeof block>) => section.findAll('tbody tr').map((row) => row.findAll('th, td').map((cell) => cell.text()))
const pricedSchools = () => areaPeerFees().schools.filter((school) => school.semester_total !== null).length

describe('完整表格：分頁與數字', () => {
  it('標題「完整表格」；六個頁籤依序，標籤後帶數字，預設各里', () => {
    const wrapper = mountTables()
    expect(wrapper.get('h2').text()).toBe('完整表格')
    expect(pricedSchools()).toBeGreaterThan(0)
    expect(tabLabels(wrapper)).toEqual(['各里3', '國小學區3', '在籍學生5', `同業收費${pricedSchools()}`, '出生走勢', '參觀來源7'])
    expect(wrapper.findAll('.el-tabs__item').map((item) => item.attributes('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false'])
    expect(wrapper.findAll('.area-tables__count').map((count) => count.text())).toEqual(['3', '3', '5', String(pricedSchools()), '7'])
  })

  it('資料還沒回來的頁籤不帶數字（各里、國小學區、在籍學生、同業收費）；參觀來源的數字來自 area', () => {
    const wrapper = mountTables({ trends: null, opportunity: null, enrolled: null, peerFees: null })
    expect(tabLabels(wrapper)).toEqual(['各里', '國小學區', '在籍學生', '同業收費', '出生走勢', '參觀來源7'])
  })

  it('各里的數字要等兩份資料都到（只有一份到時列數會在另一份到時跳動）；讀取失敗的那份不等', () => {
    expect(tabLabels(mountTables({ opportunity: null }))[0]).toBe('各里')
    expect(tabLabels(mountTables({ opportunity: null, opportunityFailed: true }))[0]).toBe('各里3')
    expect(tabLabels(mountTables({ trends: null, trendsFailed: true }))[0]).toBe('各里3')
    expect(tabLabels(mountTables({ trends: null, trendsFailed: true, opportunity: null, opportunityFailed: true }))[0]).toBe('各里')
  })

  it('在籍名冊沒匯入時頁籤仍在，但沒有數字', () => {
    const wrapper = mountTables({ enrolled: areaEnrolled({ status: 'not_imported', total: 0 }) })
    expect(tabLabels(wrapper)[2]).toBe('在籍學生')
  })

  it('點頁籤 emit update:tab；認不得的值不 emit', async () => {
    const wrapper = mountTables()
    await wrapper.findAll('.el-tabs__item')[1]!.trigger('click')
    expect(wrapper.emitted('update:tab')).toEqual([['school']])
    wrapper.findComponent({ name: 'ElTabs' }).vm.$emit('update:modelValue', 'nope')
    expect(wrapper.emitted('update:tab')).toHaveLength(1)
  })

  it('只畫目前那頁：換頁其他五頁的面板不在 DOM', async () => {
    const markers: Record<AreaTableTab, string> = {
      village: '.village-table', school: '.school-districts', enrolled: '.enrolled-panel', fees: '.peer-fees',
      births: '.birth-series', visits: '.area-tables__visits',
    }
    const wrapper = mountTables()
    for (const tab of AREA_TABLE_TABS) {
      await wrapper.setProps({ tab })
      for (const other of AREA_TABLE_TABS) expect(wrapper.find(markers[other]).exists(), `${tab} 頁的 ${other}`).toBe(other === tab)
      expect(wrapper.findAll('[role="tabpanel"]').filter((panel) => (panel.element as HTMLElement).style.display !== 'none')).toHaveLength(1)
      expect(wrapper.get('.el-tabs__item.is-active').attributes('id')).toBe(`tab-${tab}`)
    }
  })
})

describe('完整表格：各里', () => {
  it('各里表在頁內；點里名 emit select-village（預設排序＝參觀偏少，鼎金里在最前）', async () => {
    const wrapper = mountTables()
    expect(titles(wrapper)).toEqual(['各里（本校 3 公里內）'])
    await wrapper.get('.stats-table__name-link').trigger('click')
    expect(wrapper.emitted('select-village')).toEqual([['64000050001']])
  })

  it('合併組選取地圖要用里界檔裡找得到的代碼（boundaries 傳給各里表）', async () => {
    const trends = areaTrends()
    trends.villages[1]!.codes = ['64000059999', '64000020015']
    const wrapper = mountTables({ trends })
    const merged = wrapper.findAll('.stats-table__name-link').find((button) => button.text().includes('寶業里、龍子里'))!
    await merged.trigger('click')
    expect(wrapper.emitted('select-village')).toEqual([['64000020015']])
  })

  it('兩份讀取失敗各自重試：emit retry 帶來源', async () => {
    const wrapper = mountTables({ trendsFailed: true, opportunityFailed: true, trends: null, opportunity: null })
    await wrapper.get('.trends-error button').trigger('click')
    await wrapper.get('.opportunity-error button').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([['trends'], ['opportunity']])
  })
})

describe('完整表格：國小學區', () => {
  it('學區表在頁內，長說明收在「這些數字怎麼算」（預設收起），表格上方沒有 hint 說明', () => {
    const wrapper = mountTables({ tab: 'school' })
    expect(titles(wrapper)).toEqual(['依國小學區（本校 3 公里內）'])
    const section = block(wrapper, '依國小學區（本校 3 公里內）')
    expect(section.find('.stats-block__caption').exists()).toBe(false)
    const details = section.get('details.explainer')
    expect(details.attributes('open')).toBeUndefined()
    expect(details.get('summary').text()).toBe('這些數字怎麼算')
    expect(details.text()).toContain('列出學區碰到本校 3 公里內任一個里的國小')
    expect(details.text()).toContain('各列不能相加')
    expect(bodyRows(section)[0]).toEqual(['1', '三民區東光國小', '3 里＋部分 1 里', '927', '+93', '12', '1.3%', '—'])
  })

  it('里的變化讀取失敗：這一頁自己寫失敗句與重試（沒有各里表可以代勞）', async () => {
    const wrapper = mountTables({ tab: 'school', trends: null, trendsFailed: true })
    expect(wrapper.get('.trends-error').text()).toContain('無法讀取里的變化，請重新載入。')
    expect(wrapper.find('.school-districts').exists()).toBe(false)
    await wrapper.get('.trends-error button').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([['trends']])
  })

  it('里的變化讀取中：骨架', () => {
    const wrapper = mountTables({ tab: 'school', trends: null })
    expect(wrapper.find('.el-skeleton').exists()).toBe(true)
  })
})

describe('完整表格：在籍學生', () => {
  it('距離分布與里排行，班別篩選跟著 gradeFilter（D13）', async () => {
    const wrapper = mountTables({ tab: 'enrolled' })
    expect(titles(wrapper)).toEqual(['在籍學生距離分布', '在籍學生里排行（全部）'])
    await wrapper.setProps({ gradeFilter: '小班' })
    expect(titles(wrapper)).toEqual(['在籍學生距離分布', '在籍學生里排行（小班）'])
  })

  it('尚未匯入名冊：寫「尚未匯入在籍名冊。」', () => {
    const wrapper = mountTables({ tab: 'enrolled', enrolled: areaEnrolled({ status: 'not_imported', total: 0 }) })
    expect(wrapper.get('.empty-note').text()).toBe('尚未匯入在籍名冊。')
    expect(wrapper.find('.stats-block').exists()).toBe(false)
  })

  it('讀取失敗：用在籍面板自己的失敗句與重試', async () => {
    const wrapper = mountTables({ tab: 'enrolled', enrolled: null, enrolledFailed: true })
    expect(wrapper.get('.enrolled-error').text()).toContain('無法讀取在籍學生，請重新載入。')
    await wrapper.get('.enrolled-error button').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([['enrolled']])
  })

  it('讀取中：骨架', () => {
    expect(mountTables({ tab: 'enrolled', enrolled: null }).find('.el-skeleton').exists()).toBe(true)
  })
})

describe('完整表格：同業收費', () => {
  it('同業收費面板全部在頁內；年齡 emit update:peerAge', async () => {
    const wrapper = mountTables({ tab: 'fees' })
    expect(wrapper.get('.peer-fees__title').text()).toBe('附近同業收費')
    expect(wrapper.findAll('table.peer-table')).toHaveLength(2)
    expect(titles(wrapper)).toEqual(['各所收費'])
    await wrapper.findAll('.peer-fees__head input.el-radio-button__original-radio')[2]!.setValue()
    expect(wrapper.emitted('update:peerAge')).toEqual([[4]])
  })

  it('讀取失敗重試：emit retry 帶 peerFees', async () => {
    const wrapper = mountTables({ tab: 'fees', peerFees: null, peerFeesFailed: true })
    await wrapper.get('.peer-fees .el-alert button').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([['peerFees']])
  })
})

describe('完整表格：出生走勢', () => {
  it('近幾年的出生數單獨放在這頁，底註跟著；CSV 檔名走 csvName', async () => {
    const wrapper = mountTables({ tab: 'births' })
    expect(wrapper.get('.birth-series__title').text()).toBe('近幾年的出生數（本校 3 公里內）')
    expect(wrapper.findAll('.birth-series__row:not(.birth-series__row--head)')).toHaveLength(3)
    expect(wrapper.get('.birth-series__note').text()).toBe(BIRTH_SERIES_NOTE)
    await wrapper.get('[data-test="birth-series-csv"]').trigger('click')
    expect(vi.mocked(downloadCsv).mock.calls.at(-1)![0]).toBe('招生統計-近幾年的出生數.csv')
  })

  it('半徑跟著 trends.radius_km', () => {
    const wrapper = mountTables({ tab: 'births', trends: areaTrends({ radius_km: 6 }) })
    expect(wrapper.get('.birth-series__title').text()).toBe('近幾年的出生數（本校 6 公里內）')
  })

  it('讀取失敗：失敗句與重試；讀取中：骨架', async () => {
    const failed = mountTables({ tab: 'births', trends: null, trendsFailed: true })
    expect(failed.get('.trends-error').text()).toContain('無法讀取里的變化，請重新載入。')
    await failed.get('.trends-error button').trigger('click')
    expect(failed.emitted('retry')).toEqual([['trends']])
    expect(mountTables({ tab: 'births', trends: null }).find('.el-skeleton').exists()).toBe(true)
  })

  it('整塊用不了寫原因；沒有期別寫沒有里的資料', () => {
    const base = areaTrends()
    const unlocated = areaTrends({ campus: { ...base.campus, lat: null, lng: null, locate_error: 'pending' }, baseline: null, villages: [], schools: [] })
    expect(mountTables({ tab: 'births', trends: unlocated }).get('.empty-note').text()).toBe('本校位置未標示（門牌資料尚未匯入），算不出附近有哪些里。')
    const noSeries = areaTrends({ baseline: { ...base.baseline!, births_series: [] } })
    expect(mountTables({ tab: 'births', trends: noSeries }).get('.empty-note').text()).toBe('本校 3 公里內沒有里的資料。')
  })
})

describe('完整表格：參觀來源', () => {
  it('行政區排行、里排行、距離分布三張表；里排行依參觀人數多到少', () => {
    const wrapper = mountTables({ tab: 'visits' })
    expect(titles(wrapper)).toEqual(['行政區排行', '里排行', '距離分布'])
    expect(bodyRows(block(wrapper, '行政區排行'))[0]!.slice(0, 3)).toEqual(['1', '三民區', '5'])
    expect(bodyRows(block(wrapper, '里排行')).map((row) => row[1])).toEqual(['三民區本揚里', '三民區寶業里', '鼓山區龍子里'])
    expect(bodyRows(block(wrapper, '距離分布')).map((row) => row[0])).toEqual(['1 公里內', '1–3 公里', '3–6 公里', '6 公里以上', '無距離'])
  })

  it('行政區與里的「查看明細」emit open-records（area 三民區／三民區/本揚里）；距離分布沒有明細鈕', async () => {
    const wrapper = mountTables({ tab: 'visits' })
    await block(wrapper, '行政區排行').get('tbody tr .stats-table__action button').trigger('click')
    await block(wrapper, '里排行').get('tbody tr .stats-table__action button').trigger('click')
    expect(wrapper.emitted('open-records')).toEqual([
      [{ area: areaQuery({ kind: 'place', district: '三民區', village: null }) }],
      [{ area: areaQuery({ kind: 'place', district: '三民區', village: '本揚里' }) }],
    ])
    expect(wrapper.emitted('open-records')![1]).toEqual([{ area: '三民區/本揚里' }])
    expect(block(wrapper, '距離分布').find('.stats-table__action').exists()).toBe(false)
  })

  it('CSV 檔名走 csvName；里排行與距離分布保留原本一行說明', async () => {
    const wrapper = mountTables({ tab: 'visits' })
    await block(wrapper, '里排行').get('[data-test="stats-csv"]').trigger('click')
    expect(vi.mocked(downloadCsv).mock.calls.at(-1)![0]).toBe('招生統計-里排行.csv')
    expect(block(wrapper, '里排行').get('.stats-block__caption').text()).toBe('里以門牌資料為準；只到區、未定位的訪視不在這張表。')
    expect(block(wrapper, '距離分布').get('.stats-block__caption').text()).toContain('從家長地址的門牌量到本校的直線距離')
  })

  it('本校沒座標：距離分布不列距離帶，寫原因', () => {
    const area = areaStats({ campus: { ...areaStats().campus, lat: null, lng: null, locate_error: 'pending' } })
    const wrapper = mountTables({ tab: 'visits', area })
    const section = block(wrapper, '距離分布')
    expect(section.get('.stats-block__empty').text()).toBe('門牌資料尚未匯入，無法計算距離。')
    expect(section.find('.stats-block__caption').exists()).toBe(false)
  })

  it('還沒有招生訪視（D14）：三張表換成 emptyText', () => {
    const area = areaStats({ totals: { ...areaStats().totals, visit: 0, with_address: 0 } })
    const wrapper = mountTables({ tab: 'visits', area })
    expect(wrapper.get('.empty-note').text()).toBe(EMPTY_TEXT)
    expect(wrapper.find('.stats-block').exists()).toBe(false)
    expect(tabLabels(wrapper)[5]).toBe('參觀來源0')
  })
})

describe('完整表格：樣式與標記', () => {
  const rule = (selector: string) => new RegExp(`${selector.replace('.', '\\.')} \\{([^}]*)\\}`).exec(tablesSource)![1]!

  it('標題 --text-xl、數字淺色走 token、不寫色碼字面值', () => {
    expect(rule('.area-tables__title')).toContain('font-size: var(--text-xl)')
    expect(rule('.area-tables__count')).toContain('color: var(--ink-3)')
    const style = /<style scoped>([\s\S]*)<\/style>/.exec(tablesSource)![1]!
    expect(style).not.toMatch(/rgba?\(|oklch\(|hsla?\(|#[0-9a-fA-F]{3,8}\b/)
  })

  // 里排行加「可能範圍」「查看明細」欄 1440 實測約 562px，一欄至少 36rem 才不會把欄擠出表框（2026-10-12）。
  it('參觀來源三張表：一欄至少 36rem、窄螢幕靠 min(100%, …) 變單欄', () => {
    const body = rule('.area-tables__visits')
    expect(body).toContain('grid-template-columns: repeat(auto-fit, minmax(min(100%, 36rem), 1fr))')
    expect(body).not.toContain('300px')
  })

  it('「查看明細」事件拿到的就是那一列的型別，不用 as 轉型', () => {
    expect(tablesSource).not.toMatch(/\bas Area(District|Village)Row\b/)
    expect(tablesSource).not.toContain('as unknown as')
  })
})
