// 招生統計表匯出（2026-10-03）：欄名同畫面；比率沒有值寫空白（不寫「—」）、計數缺值寫 0。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import StatsDimensionTable from '../components/admissions/StatsDimensionTable.vue'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { downloadCsv } from '../utils/csv'

afterEach(() => vi.mocked(downloadCsv).mockClear())

const base = {
  title: '來源排名明細',
  rows: [{ source: '=親友', visit: 3, rate: null }, { source: '網路', rate: 40 }],
  columns: [
    { key: 'source', label: '來源', sticky: true },
    { key: 'visit', label: '參觀', kind: 'bar' as const },
    { key: 'rate', label: '預繳率', kind: 'rate' as const },
  ],
  rowKey: 'source',
  emptyText: '此區間尚無來源資料',
}

describe('StatsDimensionTable 匯出 CSV', () => {
  it('給了檔名才有按鈕；匯出的欄名、編號與數字同畫面', async () => {
    const wrapper = mount(StatsDimensionTable, { props: { ...base, numbered: true, exportFilename: '招生統計-來源排名明細.csv' }, global: { plugins: [ElementPlus] } })
    await wrapper.get('[data-test="stats-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('招生統計-來源排名明細.csv')
    expect(csv.split('\r\n')).toEqual(['﻿#,來源,參觀,預繳率', "1,'=親友,3,", '2,網路,0,40.0%', ''])
    wrapper.unmount()
  })

  it('沒給檔名、或沒有資料時不顯示按鈕', () => {
    const noName = mount(StatsDimensionTable, { props: base, global: { plugins: [ElementPlus] } })
    expect(noName.find('[data-test="stats-csv"]').exists()).toBe(false)
    const empty = mount(StatsDimensionTable, { props: { ...base, rows: [], exportFilename: 'x.csv' }, global: { plugins: [ElementPlus] } })
    expect(empty.find('[data-test="stats-csv"]').exists()).toBe(false)
    noName.unmount()
    empty.unmount()
  })

  it('文字欄裡畫面寫「—」的缺值，匯出寫空白；有值的文字（含比率組成的文字）照寫', async () => {
    const wrapper = mount(StatsDimensionTable, {
      props: {
        title: '接待人員 × 各年級預繳率',
        rows: [{ guide: '林老師', 'g:小班': '5人 / 60.0%', 'g:中班': '—' }, { guide: '張老師', 'g:小班': '—', 'g:中班': '2人 / 100.0%' }],
        columns: [
          { key: 'guide', label: '接待人員', sticky: true },
          { key: 'g:小班', label: '小班' },
          { key: 'g:中班', label: '中班' },
        ],
        rowKey: 'guide',
        emptyText: '尚無資料',
        exportFilename: 'x.csv',
      },
      global: { plugins: [ElementPlus] },
    })
    expect(wrapper.text()).toContain('—')
    await wrapper.get('[data-test="stats-csv"]').trigger('click')
    const [, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(csv.split('\r\n')).toEqual(['﻿接待人員,小班,中班', '林老師,5人 / 60.0%,', '張老師,,2人 / 100.0%', ''])
    wrapper.unmount()
  })

  it('按鈕不影響表格本身：標題還在、按鈕寫明是哪張表', () => {
    const wrapper = mount(StatsDimensionTable, { props: { ...base, exportFilename: 'x.csv' }, global: { plugins: [ElementPlus] } })
    expect(wrapper.get('.stats-block__title').text()).toBe('來源排名明細')
    expect(wrapper.get('[data-test="stats-csv"]').attributes('aria-label')).toBe('把「來源排名明細」匯出 CSV')
    expect(wrapper.get('[data-test="stats-csv"]').text()).toBe('匯出 CSV')
    wrapper.unmount()
  })
})
