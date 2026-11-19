import { afterEach, describe, expect, it, vi } from 'vitest'
import AreaCompareTable from '../components/admissions/AreaCompareTable.vue'
import { downloadCsv } from '../utils/csv'
import { areaCompare, cleanup, mountWith } from './admissionsTestKit'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
afterEach(cleanup)

const COLUMNS = ['校區', '2–5 歲', '一年增減', '私立', '準公共', '公立', '非營利', '托嬰', '本校 3 歲收費', '私立一般中位數', '排名', '近 12 月異動']

async function mountTable() {
  return (await mountWith(AreaCompareTable, { props: { data: areaCompare(), exportFilename: '招生統計-五校周邊環境-3公里.csv' } })).wrapper
}

describe('五校周邊環境表', () => {
  it('五列、欄名順序', async () => {
    const wrapper = await mountTable()
    expect(wrapper.findAll('thead th').map((th) => th.text())).toEqual(COLUMNS)
    expect(wrapper.findAll('tbody tr')).toHaveLength(5)
    expect(wrapper.findAll('tbody tr')[0]!.text()).toContain('1,200')
  })

  it('點校區名按鈕：emit open-area 帶校區代碼', async () => {
    const wrapper = await mountTable()
    const buttons = wrapper.findAll('tbody button.stats-table__name-link')
    expect(buttons).toHaveLength(5)
    await buttons[1]!.trigger('click')
    expect(wrapper.emitted('open-area')).toEqual([['minghua']])
    expect(buttons[0]!.attributes('aria-label')).toContain('看區域分析')
  })

  it('匯出 CSV：欄同畫面', async () => {
    const wrapper = await mountTable()
    const exportButton = wrapper.findAll('button').find((b) => b.text().includes('匯出'))!
    await exportButton.trigger('click')
    const [, content] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(String(JSON.stringify(content))).toContain('第 2 高／共 15')
    expect(String(JSON.stringify(content))).toContain('近 12 月異動')
  })
})
