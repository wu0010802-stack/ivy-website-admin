// 附近預售建案清單（2026-10-20 預售建案規格 P12、P13）：欄位、排序（後端給的順序）、預計交屋只寫到半年、已過預計時間、
// 定位方式、點案名選取所在的里、匯出 CSV、沒匯入／沒座標／沒有在建案的空狀態、讀取失敗與重試、窄螢幕卡片。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import PresalePanel from '../components/admissions/area/PresalePanel.vue'
import { PRESALE_COLUMNS, PRESALE_CSV_COLUMNS, presaleCsv, presaleCsvCell, presaleRows } from '../components/admissions/area/presaleTable'
import { areaPresale, presaleItem } from './admissionsTestKit'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { CSV_BOM, downloadCsv } from '../utils/csv'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  document.body.innerHTML = ''
  vi.mocked(downloadCsv).mockClear()
  vi.unstubAllGlobals()
})

const csvName = (title: string) => `${title}.csv`
function mountPanel(props: Record<string, unknown> = {}, narrow = false): VueWrapper {
  if (narrow) {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  }
  const wrapper = mount(PresalePanel as never, {
    props: { data: areaPresale(), failed: false, csvName, ...props },
    attachTo: document.body,
    global: { plugins: [ElementPlus] },
  } as never)
  wrappers.push(wrapper)
  return wrapper
}
const bodyRows = (wrapper: VueWrapper) => wrapper.findAll('tbody tr').map((row) => row.findAll('th, td').map((cell) => cell.text()))

describe('列與欄', () => {
  it('列照後端給的順序（預計交屋由近到遠）；預計交屋只寫到半年、已過預計時間寫尚未登記；定位方式分依地號與依門牌', () => {
    const rows = presaleRows(areaPresale())
    expect(rows.map((row) => row.name)).toEqual(['乙案', '甲案', '丙案'])
    expect(rows.map((row) => row.delivery)).toEqual(['已過預計時間（尚未登記）', '約 2028 上半年', '約 2029 上半年'])
    expect(rows.map((row) => row.locate)).toEqual(['依門牌', '依門牌', '依地號'])
    expect(rows[0]).toMatchObject({
      key: '三民區/乙案', place: '三民區本揚里', households: 36, permit: '2023/06/01', distance: '300 m', village_code: '64000050015',
    })
  })

  it('畫面欄與 CSV 欄：CSV 多定位方式；戶數寫數字；含 # 欄', () => {
    expect(PRESALE_COLUMNS.map((column) => column.label)).toEqual(['案名', '區／里', '戶數', '建照日', '預計交屋（粗估）', '距本校'])
    expect(PRESALE_COLUMNS[0]).toMatchObject({ key: 'name', sticky: true })
    expect(PRESALE_CSV_COLUMNS.map((column) => column.label)).toEqual([...PRESALE_COLUMNS.map((column) => column.label), '定位方式'])
    const rows = presaleRows(areaPresale())
    expect(presaleCsvCell(rows[0]!, PRESALE_CSV_COLUMNS[2]!)).toBe(36)
    expect(presaleCsvCell(rows[0]!, PRESALE_CSV_COLUMNS[0]!)).toBeUndefined()
    const { header, rows: body } = presaleCsv(rows)
    expect(header).toEqual(['#', '案名', '區／里', '戶數', '建照日', '預計交屋（粗估）', '距本校', '定位方式'])
    expect(body[1]).toEqual([2, '甲案', '三民區本揚里', 120, '2024/03/10', '約 2028 上半年', '0 m', '依門牌'])
  })
})

describe('寬螢幕：表格', () => {
  it('標題、說明、總結、來源與沒對到里的小字', () => {
    const wrapper = mountPanel()
    expect(wrapper.get('.stats-block__title').text()).toBe('附近預售建案（本校 3 公里內）')
    expect(wrapper.get('.presale__summary').text()).toBe('在建 3 案、376 戶。')
    expect(wrapper.get('.stats-block__caption').text()).toBe(
      '預售建案是內政部預售屋備查資料（110 年 7 月起）；戶數是備查的總戶數（可能含店面），不等於已售出或已入住；預計交屋依建照日與規模粗估，誤差約半年到一年。',
    )
    const notes = wrapper.findAll('.presale__note').map((note) => note.text())
    expect(notes).toEqual([
      '範圍內的區另有 2 案在建預售只到區、沒對到里，沒列出。',
      '資料來源：內政部實價登錄 預售屋建案備查；地號位置：國土測繪中心（115 年 10 月版）。',
    ])
  })

  it('表格欄位與內容', () => {
    const wrapper = mountPanel()
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual(['#', '案名', '區／里', '戶數', '建照日', '預計交屋（粗估）', '距本校'])
    expect(bodyRows(wrapper)).toEqual([
      ['1', '乙案', '三民區本揚里', '36', '2023/06/01', '已過預計時間（尚未登記）', '300 m'],
      ['2', '甲案', '三民區本揚里', '120', '2024/03/10', '約 2028 上半年', '0 m'],
      ['3', '丙案', '三民區鼎金里', '220', '2025/01/01', '約 2029 上半年', '800 m'],
    ])
  })

  it('點案名＝選取所在的里（emit select-village 帶里代碼）', async () => {
    const wrapper = mountPanel()
    const buttons = wrapper.findAll('.stats-table__name-link')
    expect(buttons.map((button) => button.attributes('aria-label'))).toEqual(['選取所在的里：乙案', '選取所在的里：甲案', '選取所在的里：丙案'])
    await buttons[2]!.trigger('click')
    expect(wrapper.emitted('select-village')).toEqual([['64000050001']])
  })

  it('匯出 CSV：檔名「附近預售建案」，欄與畫面相同再加定位方式', async () => {
    const wrapper = mountPanel()
    await wrapper.get('[data-test="stats-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('附近預售建案.csv')
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(`${CSV_BOM}#,案名,區／里,戶數,建照日,預計交屋（粗估）,距本校,定位方式`)
    expect(lines[1]).toBe('1,乙案,三民區本揚里,36,2023/06/01,已過預計時間（尚未登記）,300 m,依門牌')
    expect(lines[3]).toBe('3,丙案,三民區鼎金里,220,2025/01/01,約 2029 上半年,800 m,依地號')
  })

  it('超過 10 案先列 10 案，其餘按「顯示全部」', async () => {
    const items = Array.from({ length: 12 }, (_, index) => presaleItem({ name: `案${index}`, distance_m: index * 100 }))
    const wrapper = mountPanel({ data: areaPresale({ items, summary: { cases: 12, households: 1440 } }) })
    expect(bodyRows(wrapper)).toHaveLength(10)
    await wrapper.get('.stats-block__more').trigger('click')
    expect(bodyRows(wrapper)).toHaveLength(12)
  })
})

describe('空狀態與讀取', () => {
  it('讀取中是骨架；讀取失敗寫原因並可重試', async () => {
    expect(mountPanel({ data: null }).find('.el-skeleton').exists()).toBe(true)
    const failed = mountPanel({ data: null, failed: true })
    expect(failed.get('.el-alert').text()).toContain('無法讀取附近預售建案，請重新載入。')
    await failed.get('.el-alert button').trigger('click')
    expect(failed.emitted('retry')).toHaveLength(1)
  })

  it('預售建案沒匯入：寫尚未匯入，不寫「沒有」；本校沒座標寫原因', () => {
    const none = areaPresale({ source: { version: null, unplaced: 0, note: '' }, items: [], summary: { cases: 0, households: 0 } })
    expect(mountPanel({ data: none }).get('.empty-note').text()).toBe('預售建案資料尚未匯入。')
    const base = areaPresale()
    const unlocated = areaPresale({ campus: { ...base.campus, lat: null, lng: null, locate_error: 'no_address' }, items: [] })
    expect(mountPanel({ data: unlocated }).get('.empty-note').text()).toBe('本校位置未標示（找不到本校地址），算不出附近有哪些里。')
  })

  it('匯入了但半徑內沒有在建案：寫沒有，不給匯出鈕與總結', () => {
    const wrapper = mountPanel({ data: areaPresale({ items: [], summary: { cases: 0, households: 0 } }) })
    expect(wrapper.get('.stats-block__empty').text()).toBe('半徑內沒有在建的預售建案。')
    expect(wrapper.find('[data-test="stats-csv"]').exists()).toBe(false)
    expect(wrapper.find('.presale__summary').exists()).toBe(false)
  })

  it('沒有未對到里的案時不寫那句小字', () => {
    const base = areaPresale()
    const wrapper = mountPanel({ data: areaPresale({ source: { ...base.source, unplaced: 0 } }) })
    expect(wrapper.findAll('.presale__note').map((note) => note.text())).toEqual([
      '資料來源：內政部實價登錄 預售屋建案備查；地號位置：國土測繪中心（115 年 10 月版）。',
    ])
  })
})

describe('窄螢幕：卡片列表', () => {
  it('不畫表格，每案一張卡：案名（可選取）、區里・戶數・距離、預計交屋、建照日・定位方式', async () => {
    const wrapper = mountPanel({}, true)
    expect(wrapper.find('table').exists()).toBe(false)
    const cards = wrapper.findAll('.presale-cards__item')
    expect(cards.map((card) => card.text())).toEqual([
      '乙案三民區本揚里・36 戶・距本校 300 m預計交屋：已過預計時間（尚未登記）建照日 2023/06/01・依門牌',
      '甲案三民區本揚里・120 戶・距本校 0 m預計交屋：約 2028 上半年建照日 2024/03/10・依門牌',
      '丙案三民區鼎金里・220 戶・距本校 800 m預計交屋：約 2029 上半年建照日 2025/01/01・依地號',
    ])
    await cards[2]!.get('.presale-cards__name').trigger('click')
    expect(wrapper.emitted('select-village')).toEqual([['64000050001']])
    expect(wrapper.get('.presale-cards__caption').text()).toContain('預計交屋依建照日與規模粗估')
  })

  it('卡片也能匯出同樣的 CSV；超過 10 案先列 10 案', async () => {
    const wrapper = mountPanel({}, true)
    await wrapper.get('.presale-cards__head button').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('附近預售建案.csv')
    expect(csv.split('\r\n')[2]).toBe('2,甲案,三民區本揚里,120,2024/03/10,約 2028 上半年,0 m,依門牌')
    const items = Array.from({ length: 12 }, (_, index) => presaleItem({ name: `案${index}` }))
    const many = mountPanel({ data: areaPresale({ items, summary: { cases: 12, households: 1440 } }) }, true)
    expect(many.findAll('.presale-cards__item')).toHaveLength(10)
    await many.get('.presale-cards > button, .presale-cards .el-button--primary').trigger('click')
    expect(many.findAll('.presale-cards__item')).toHaveLength(12)
  })
})
