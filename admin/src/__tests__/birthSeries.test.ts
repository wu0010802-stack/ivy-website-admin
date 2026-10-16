// 「近幾年的出生數」區塊：一期一列、缺月與增減寫出來、長條以最大值為 100%、空資料不顯示、匯出 CSV。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import BirthSeries from '../components/admissions/area/BirthSeries.vue'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { downloadCsv } from '../utils/csv'
vi.mock('../composables/notify', () => ({ notifyError: vi.fn(), notifyWarning: vi.fn() }))

afterEach(() => vi.mocked(downloadCsv).mockClear())

const periods = [
  { starts: '114-10', ends: '115-09', months: 12, missing: [], births: 100, change_pct: -20 },
  { starts: '113-10', ends: '114-09', months: 11, missing: ['113-11'], births: 125, change_pct: null },
]
const mountIt = (props: Record<string, unknown> = {}) =>
  mount(BirthSeries, { props: { periods, radiusKm: 3, csvName: '招生統計-近幾年的出生數.csv', ...props }, global: { plugins: [ElementPlus] } })

describe('BirthSeries', () => {
  it('標題寫半徑（h3：出生走勢分頁裡直接接在「完整表格」h2 下面）；一期一列：期間、缺月小字、出生數、和前一期', () => {
    const wrapper = mountIt()
    expect(wrapper.get('.birth-series__title').text()).toBe('近幾年的出生數（本校 3 公里內）')
    expect(wrapper.get('.birth-series__title').element.tagName).toBe('H3')
    const rows = wrapper.findAll('.birth-series__row:not(.birth-series__row--head)')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.get('.birth-series__label').text()).toBe('114 年 10 月～115 年 9 月')
    expect(rows[0]!.find('.birth-series__missing').exists()).toBe(false)
    expect(rows[0]!.get('.birth-series__number').text()).toBe('100')
    expect(rows[0]!.get('.birth-series__change').text()).toBe('−20.0%')
    expect(rows[1]!.get('.birth-series__missing').text()).toBe('缺 113 年 11 月')
    expect(rows[1]!.get('.birth-series__change').text()).toBe('—')
    wrapper.unmount()
  })

  it('長條以最大值為 100%（長條只是輔助，數字一定寫出來）', () => {
    const wrapper = mountIt()
    const widths = wrapper.findAll('.birth-series__fill').map((fill) => (fill.element as HTMLElement).style.width)
    expect(widths).toEqual(['80%', '100%'])
    wrapper.unmount()
  })

  it('用 ARIA table 結構；不是 <table>（避免和「里的變化」表的選擇器互相干擾）', () => {
    const wrapper = mountIt()
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.get('[role="table"]').attributes('aria-label')).toBe('近幾年的出生數（本校 3 公里內）')
    expect(wrapper.findAll('[role="columnheader"]').map((cell) => cell.text())).toEqual(['期間', '出生數', '和前一期'])
    wrapper.unmount()
  })

  it('只有一期照列、和前一期寫「—」；沒有資料整塊不顯示', () => {
    const single = mountIt({ periods: [periods[1]] })
    expect(single.findAll('.birth-series__row:not(.birth-series__row--head)')).toHaveLength(1)
    single.unmount()
    const empty = mountIt({ periods: [] })
    expect(empty.find('.birth-series').exists()).toBe(false)
    empty.unmount()
  })

  it('匯出 CSV：檔名由呼叫端給，欄名與數字同 birthSeriesCsv', async () => {
    const wrapper = mountIt()
    await wrapper.get('[data-test="birth-series-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('招生統計-近幾年的出生數.csv')
    expect(csv.slice(1).split('\r\n')).toEqual([
      '期間起,期間迄,有資料月數,缺的月份,出生數,和前一期增減（%）',
      '114 年 10 月,115 年 9 月,12,,100,-20',
      '113 年 10 月,114 年 9 月,11,113 年 11 月,125,',
      '',
    ])
    wrapper.unmount()
  })
})
