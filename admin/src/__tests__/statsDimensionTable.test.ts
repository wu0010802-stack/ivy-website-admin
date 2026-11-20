// StatsDimensionTable 的 2026-11-20 新功能：排序（sortable）、固定在最後的列（pinLast）、可能範圍的區間條與圖例、
// 兩行的 split 格；匯出 CSV 不受排序影響。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import StatsDimensionTable from '../components/admissions/StatsDimensionTable.vue'
import type { StatsColumn } from '../admissions/statsFormat'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { downloadCsv } from '../utils/csv'

const CSV_BOM = String.fromCharCode(0xfeff)
const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.mocked(downloadCsv).mockClear()
})

const columns: StatsColumn[] = [
  { key: 'name', label: '來源', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'rate', label: '預繳率', kind: 'rate' },
  { key: 'range', label: '可能範圍', kind: 'range', rangeOf: 'rate' },
]
const rows = [
  { name: 'Facebook', visit: 5, deposit: 4, rate: 80, range: { low: 47, high: 78 } },
  { name: '未填寫', visit: 9, deposit: 0, rate: 0, range: { low: 30, high: 69 } },
  { name: '親友介紹', visit: 2, deposit: 1, rate: 50, range: { low: 35, high: 72 } },
  { name: '網路', visit: 1, deposit: 0, rate: null, range: null },
]

function mountTable(props: Record<string, unknown> = {}) {
  const wrapper = mount(StatsDimensionTable, {
    props: { title: '來源排名明細', rows, columns, rowKey: 'name', emptyText: '尚無資料', ...props },
    global: { plugins: [ElementPlus] },
  })
  wrappers.push(wrapper)
  return wrapper
}
const names = (wrapper: VueWrapper) => wrapper.findAll('tbody tr').map((row) => row.get('th').text())
const sortButton = (wrapper: VueWrapper, label: string) => wrapper.findAll('thead button.stats-sort').find((button) => button.text() === label)!
const headerOf = (wrapper: VueWrapper, label: string) => wrapper.findAll('thead th').find((th) => th.text() === label)!

describe('排序（sortable）', () => {
  it('沒開 sortable：表頭不是按鈕、沒有 aria-sort，列照呼叫端的順序', () => {
    const wrapper = mountTable()
    expect(wrapper.findAll('button.stats-sort')).toHaveLength(0)
    expect(wrapper.findAll('thead th[aria-sort]')).toHaveLength(0)
    expect(names(wrapper)).toEqual(['Facebook', '未填寫', '親友介紹', '網路'])
  })

  it('只有數字欄（count、bar、rate）有排序鈕；名稱欄與可能範圍欄沒有', () => {
    const wrapper = mountTable({ sortable: true })
    expect(wrapper.findAll('thead button.stats-sort').map((button) => button.text())).toEqual(['參觀人數', '預繳人數', '預繳率'])
    expect(headerOf(wrapper, '來源').find('button').exists()).toBe(false)
    expect(headerOf(wrapper, '可能範圍').find('button').exists()).toBe(false)
  })

  it('點一下由大到小、再點由小到大、再點取消；th 的 aria-sort 跟著變', async () => {
    const wrapper = mountTable({ sortable: true })
    expect(headerOf(wrapper, '參觀人數').attributes('aria-sort')).toBeUndefined()

    await sortButton(wrapper, '參觀人數').trigger('click')
    expect(names(wrapper)).toEqual(['未填寫', 'Facebook', '親友介紹', '網路'])
    expect(headerOf(wrapper, '參觀人數').attributes('aria-sort')).toBe('descending')

    await sortButton(wrapper, '參觀人數').trigger('click')
    expect(names(wrapper)).toEqual(['網路', '親友介紹', 'Facebook', '未填寫'])
    expect(headerOf(wrapper, '參觀人數').attributes('aria-sort')).toBe('ascending')

    await sortButton(wrapper, '參觀人數').trigger('click')
    expect(names(wrapper)).toEqual(['Facebook', '未填寫', '親友介紹', '網路'])
    expect(wrapper.findAll('thead th[aria-sort]')).toHaveLength(0)
  })

  it('換一欄排序：上一欄的 aria-sort 拿掉，新的一欄從由大到小開始', async () => {
    const wrapper = mountTable({ sortable: true })
    await sortButton(wrapper, '參觀人數').trigger('click')
    await sortButton(wrapper, '預繳人數').trigger('click')
    expect(headerOf(wrapper, '參觀人數').attributes('aria-sort')).toBeUndefined()
    expect(headerOf(wrapper, '預繳人數').attributes('aria-sort')).toBe('descending')
    expect(names(wrapper)[0]).toBe('Facebook')
  })

  it('比率沒有值（分母 0）的列不論由大到小或由小到大都排在有值的後面', async () => {
    const wrapper = mountTable({ sortable: true })
    await sortButton(wrapper, '預繳率').trigger('click')
    expect(names(wrapper)).toEqual(['Facebook', '親友介紹', '未填寫', '網路'])
    await sortButton(wrapper, '預繳率').trigger('click')
    expect(names(wrapper)).toEqual(['未填寫', '親友介紹', 'Facebook', '網路'])
  })

  it('排序鈕的 title 說明下一次點會怎樣', async () => {
    const wrapper = mountTable({ sortable: true })
    expect(sortButton(wrapper, '預繳率').attributes('title')).toContain('按一下由大到小排序')
    await sortButton(wrapper, '預繳率').trigger('click')
    expect(sortButton(wrapper, '預繳率').attributes('title')).toContain('目前由大到小，按一下改成由小到大')
    await sortButton(wrapper, '預繳率').trigger('click')
    expect(sortButton(wrapper, '預繳率').attributes('title')).toContain('目前由小到大，按一下取消排序')
  })

  it('匯出 CSV 不受排序影響：仍是呼叫端給的順序', async () => {
    const wrapper = mountTable({ sortable: true, exportFilename: '來源.csv' })
    await sortButton(wrapper, '參觀人數').trigger('click')
    expect(names(wrapper)[0]).toBe('未填寫')
    await wrapper.get('[data-test="stats-csv"]').trigger('click')
    const csv = vi.mocked(downloadCsv).mock.calls.at(-1)![1]
    expect(csv.split('\r\n').slice(1, -1).map((line) => line.split(',')[0])).toEqual(['Facebook', '未填寫', '親友介紹', '網路'])
  })
})

describe('固定在最後的列（pinLast）', () => {
  it('名稱等於 pinLast 的列永遠最後、淡一階（stats-table__row--muted）；沒排序時也一樣', () => {
    const wrapper = mountTable({ pinLast: '未填寫' })
    expect(names(wrapper)).toEqual(['Facebook', '親友介紹', '網路', '未填寫'])
    const trs = wrapper.findAll('tbody tr')
    expect(trs.map((tr) => tr.classes().includes('stats-table__row--muted'))).toEqual([false, false, false, true])
  })

  it('不論由大到小或由小到大，它都不跟著跑', async () => {
    const wrapper = mountTable({ pinLast: '未填寫', sortable: true })
    await sortButton(wrapper, '參觀人數').trigger('click')
    expect(names(wrapper)).toEqual(['Facebook', '親友介紹', '網路', '未填寫'])
    await sortButton(wrapper, '參觀人數').trigger('click')
    expect(names(wrapper)).toEqual(['網路', '親友介紹', 'Facebook', '未填寫'])
  })

  it('有序號時那一列的序號留空，其他列依顯示順序編號', async () => {
    const wrapper = mountTable({ pinLast: '未填寫', numbered: true })
    expect(wrapper.findAll('tbody tr').map((tr) => tr.get('td.stats-table__index').text())).toEqual(['1', '2', '3', ''])
  })

  it('匯出 CSV 的順序與序號不受 pinLast 影響', async () => {
    const wrapper = mountTable({ pinLast: '未填寫', numbered: true, exportFilename: '來源.csv' })
    await wrapper.get('[data-test="stats-csv"]').trigger('click')
    const csv = vi.mocked(downloadCsv).mock.calls.at(-1)![1]
    expect(csv.split('\r\n').slice(1, -1).map((line) => line.split(',').slice(0, 2))).toEqual([['1', 'Facebook'], ['2', '未填寫'], ['3', '親友介紹'], ['4', '網路']])
  })

  it('沒給 pinLast 時沒有固定的列、也沒有淡色列', () => {
    const wrapper = mountTable()
    expect(wrapper.findAll('tr.stats-table__row--muted')).toHaveLength(0)
  })
})

describe('可能範圍的區間條與圖例', () => {
  it('range 欄有 rangeOf：每列畫區間條（色條＝範圍、點＝實際比率），文字範圍仍寫出來；沒有範圍的列沒有色條', () => {
    const wrapper = mountTable()
    const first = wrapper.findAll('tbody tr')[0]!
    expect(first.find('.stats-interval').exists()).toBe(true)
    expect(first.get('.stats-interval__range').attributes('style')).toContain('left: 47%')
    expect(first.get('.stats-interval__range').attributes('style')).toContain('width: 31%')
    expect(first.get('.stats-interval__dot').attributes('style')).toContain('left: 80%')
    expect(first.get('.stats-interval__text').text()).toBe('47–78%')
    const last = wrapper.findAll('tbody tr')[3]!
    expect(last.find('.stats-interval__range').exists()).toBe(false)
    expect(last.find('.stats-interval__dot').exists()).toBe(false)
    expect(last.get('.stats-interval__text').text()).toBe('—')
  })

  it('圖例與「怎麼看可能範圍」說明有資料才出現；給了 average 才多一條全體平均與虛線', () => {
    const plain = mountTable()
    const legend = plain.get('[data-test="stats-interval-legend"]')
    expect(legend.text()).toContain('實際比率')
    expect(legend.text()).toContain('可能範圍')
    expect(legend.text()).not.toContain('全體平均')
    expect(plain.find('.stats-interval__avg').exists()).toBe(false)
    expect(plain.get('[data-test="stats-explainer"]').get('summary').text()).toBe('怎麼看可能範圍')

    const withAverage = mountTable({ average: 42.5 })
    expect(withAverage.get('[data-test="stats-interval-legend"]').text()).toContain('全體平均 42.5%')
    expect(withAverage.findAll('.stats-interval__avg')).toHaveLength(rows.length)
    expect(withAverage.get('.stats-interval__avg').attributes('style')).toContain('left: 42.5%')
  })

  it('沒有 rangeOf 的 range 欄、或沒有資料時：不畫區間條與圖例', () => {
    const legacy = mountTable({ columns: columns.map((column) => ({ ...column, rangeOf: undefined })) })
    expect(legacy.find('.stats-interval').exists()).toBe(false)
    expect(legacy.find('[data-test="stats-interval-legend"]').exists()).toBe(false)
    expect(legacy.findAll('tbody tr')[0]!.text()).toContain('47–78%')
    const empty = mountTable({ rows: [] })
    expect(empty.find('[data-test="stats-interval-legend"]').exists()).toBe(false)
    expect(empty.find('[data-test="stats-explainer"]').exists()).toBe(false)
  })
})

describe('split 格（接待人員 × 年級）', () => {
  const splitColumns: StatsColumn[] = [{ key: 'name', label: '接待人員', sticky: true }, { key: 'g', label: '小班', kind: 'split' }, { key: 'h', label: '中班', kind: 'split' }]
  const splitRows = [{ name: '林老師', g: '5人 / 60.0%', h: '—' }]

  it('「5人 / 60.0%」畫成兩行：上面比率、下面人數（small）；不是這個寫法就整格照寫', () => {
    const wrapper = mountTable({ columns: splitColumns, rows: splitRows, rowKey: 'name' })
    const [split, plain] = wrapper.findAll('tbody td')
    expect(split!.classes()).toContain('stats-table__split')
    expect(split!.findAll('span.num').map((item) => item.text())).toEqual(['60.0%'])
    expect(split!.get('small').text()).toBe('5人')
    expect(plain!.classes()).not.toContain('stats-table__split')
    expect(plain!.text()).toBe('—')
  })

  it('匯出 CSV 仍是原字串', async () => {
    const wrapper = mountTable({ columns: splitColumns, rows: splitRows, rowKey: 'name', exportFilename: '接待.csv' })
    await wrapper.get('[data-test="stats-csv"]').trigger('click')
    const csv = vi.mocked(downloadCsv).mock.calls.at(-1)![1]
    expect(csv.split('\r\n')).toEqual([CSV_BOM + '接待人員,小班,中班', '林老師,5人 / 60.0%,', ''])
  })
})

describe('compact', () => {
  it('compact 給了才有 stats-block--compact（欄數少的表限寬）', () => {
    expect(mountTable().get('.stats-block').classes()).not.toContain('stats-block--compact')
    expect(mountTable({ compact: true }).get('.stats-block').classes()).toContain('stats-block--compact')
  })
})
