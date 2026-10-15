// 附近同業收費區塊（2026-10-15 規格 7.1）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import PeerFeesPanel from '../components/admissions/area/PeerFeesPanel.vue'
import { areaPeerFees, areaStats } from './admissionsTestKit'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { CSV_BOM, downloadCsv } from '../utils/csv'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
})
function mountPanel(changes: Record<string, unknown> = {}): VueWrapper {
  const wrapper = mount(PeerFeesPanel as never, {
    props: { data: areaPeerFees(), failed: false, age: 3, csvName: (title: string) => `招生統計-${title}.csv`, ...changes },
    attachTo: document.body,
    global: { plugins: [ElementPlus] },
  } as never)
  wrappers.push(wrapper)
  return wrapper
}

describe('附近同業收費', () => {
  it('標題、學年、總結、落點條、兩張表與註記', () => {
    const wrapper = mountPanel({ data: areaPeerFees() })
    expect(wrapper.get('.peer-fees__title').text()).toBe('附近同業收費')
    expect(wrapper.get('.peer-fees__subtitle').text()).toBe('114 學年・全日班・一學期公告收費 目前是 115 學年，最新公開收費是 114 學年。')
    expect(wrapper.get('.peer-fees__summary').text()).toBe('3 公里內私立幼兒園（不含準公共）有 3 所公布收費，3 歲班一學期中位數 75,000 元；本校 89,750 元，第 2 高。')
    expect(wrapper.get('.peer-strip').attributes('aria-hidden')).toBe('true')
    expect(wrapper.findAll('.peer-strip__dot')).toHaveLength(4)
    expect(wrapper.findAll('.peer-strip__dot.is-own')).toHaveLength(1)
    const tables = wrapper.findAll('table.peer-table')
    expect(tables).toHaveLength(2)
    expect(tables[0].findAll('tbody tr')[0].text().replace(/\s+/g, '')).toBe('私立一般4375,000元40,200–93,000元')
    expect(tables[1].findAll('tbody tr')[2].text().replace(/\s+/g, '')).toBe('材料費24,750元11,000元+13,750元')
    expect(wrapper.text()).toContain('準公共、公立、非營利的家長另有政府補助，這裡是園所公告收費，不是家長實付。')
    expect(wrapper.text()).toContain('各園項目歸類不一，總價比較較準。')
    expect(wrapper.find('.stats-block__title').text()).toBe('各所收費')
  })

  it('切換年齡發出 update:age', async () => {
    const wrapper = mountPanel()
    await wrapper.findAll('.el-radio-button__original-radio, .el-radio-button input')[2].setValue(true)
    expect(wrapper.emitted('update:age')?.at(-1)).toEqual([4])
  })

  it('本校沒有收費時不顯示項目對照表', () => {
    const wrapper = mountPanel({ data: { ...areaPeerFees(), own: null, own_missing: 'no_fee' } })
    expect(wrapper.findAll('table.peer-table')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('各園項目歸類不一')
  })

  it('私立一般少於 3 所：不畫落點條', () => {
    const data = areaPeerFees()
    const wrapper = mountPanel({ data: { ...data, groups: data.groups.map((group) => (group.kind === 'private' ? { ...group, with_fee: 2, median: null } : group)) } })
    expect(wrapper.find('.peer-strip').exists()).toBe(false)
  })

  it('骨架、失敗重試、尚未匯入、本校沒座標', async () => {
    expect(mountPanel({ data: null }).find('.el-skeleton').exists()).toBe(true)
    const failed = mountPanel({ data: null, failed: true })
    expect(failed.text()).toContain('無法讀取附近同業收費。')
    await failed.get('.el-alert .el-button').trigger('click')
    expect(failed.emitted('retry')).toHaveLength(1)
    expect(mountPanel({ data: { ...areaPeerFees(), synced_at: null } }).get('.peer-fees__empty').text()).toBe('收費資料尚未匯入。')
    const campus = { ...areaStats().campus, lat: null, lng: null, locate_error: 'no_address' }
    expect(mountPanel({ data: { ...areaPeerFees(), campus } }).get('.peer-fees__empty').text()).toContain('無法比較附近同業收費。')
  })

  it('各所收費表：先列 10 列；匯出 CSV 含逐項', async () => {
    const wrapper = mountPanel()
    await wrapper.get('[data-test="stats-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('招生統計-附近同業收費.csv')
    expect(csv).toContain('學費（元）')
    expect(csv).toContain('乙幼兒園')
    // 丙幼兒園沒有月均：CSV 那格是空白（不是 0、不是「—」）；學期總收費寫原始數字。
    const line = csv.split('\r\n').find((row) => row.includes('丙幼兒園'))!
    const cells = line.split(',')
    const header = csv.replace(CSV_BOM, '').split('\r\n')[0]!.split(',')
    expect(cells[header.indexOf('學期總收費（元）')]).toBe('40200')
    expect(cells[header.indexOf('月均（元）')]).toBe('')
  })
})
