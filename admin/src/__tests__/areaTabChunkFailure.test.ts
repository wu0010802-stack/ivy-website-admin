// 區域分析：地圖元件的 chunk 下載失敗（剛部署完，舊的 hash 檔已不存在）。
// 這個檔把 AreaMap.vue 換成「載入就丟錯」的 mock，其他測試檔的 mock 是正常載入的。
// 模式狀態在 AreaTab（規格 D1），所以地圖壞了，工具列、右欄、表格仍要能用（規格 §4、Review Focus 5）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import AreaTab from '../components/admissions/area/AreaTab.vue'
import {
  areaBabycare, areaChanges, areaEnrolled, areaKindergartens, areaOpportunity, areaPeerFees, areaStats, areaTrends, button, cleanup, mockGet,
  mountWith, villageBoundaries,
} from './admissionsTestKit'

vi.mock('../components/admissions/area/AreaMap.vue', () => {
  throw new Error('Failed to fetch dynamically imported module: https://example.test/admin/assets/AreaMap-old.js')
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

const props = () => ({
  campusKey: 'yihua', schoolYear: 115, semester: null, csvName: (title: string) => `招生統計-${title}.csv`, emptyText: '還沒有招生訪視',
})
function mockRoutes() {
  mockGet({
    '/admin/admissions/area/boundaries': villageBoundaries(),
    '/admin/admissions/area/kindergartens': areaKindergartens(),
    '/admin/admissions/area/fees': areaPeerFees(),
    '/admin/admissions/area/babycare': areaBabycare(),
    '/admin/admissions/area/changes': areaChanges(),
    '/admin/admissions/area/opportunity': areaOpportunity(),
    '/admin/admissions/area/trends': areaTrends(),
    '/admin/admissions/area/enrolled': areaEnrolled(),
    '/admin/admissions/area': areaStats(),
  })
}
async function mountBroken(): Promise<VueWrapper> {
  mockRoutes()
  const { wrapper } = await mountWith(AreaTab, { props: props() })
  await vi.waitFor(() => expect(wrapper.find('.area-map-error').exists()).toBe(true))
  await flushPromises()
  return wrapper
}
const side = (wrapper: VueWrapper) => wrapper.get('.area-workbench__side')

describe('區域分析：地圖元件載入失敗', () => {
  it('地圖區寫原因並給「重新整理」整頁重載；參觀來源三張表與同業清單照常', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const reload = vi.fn()
    vi.stubGlobal('location', { href: 'https://example.test/admin/admissions', reload })
    const wrapper = await mountBroken()

    const notice = wrapper.get('.area-map-error')
    expect(notice.text()).toContain('地圖沒有載入成功，請重新整理這一頁。')
    expect(wrapper.text()).not.toContain('里界載入失敗')
    expect(logged).toHaveBeenCalledWith('[AreaTab] 地圖元件載入失敗', expect.any(Error))

    await wrapper.get('.area-full-tables #tab-visits').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.area-full-tables .stats-block__title').map((title) => title.text())).toEqual(['行政區排行', '里排行', '距離分布'])
    expect(wrapper.findAll('.area-full-tables .stats-block')[0]!.findAll('tbody tr')).toHaveLength(2)
    await wrapper.get('.area-toolbar [aria-label="看什麼"]').findAll('.el-radio-button').find((item) => item.text() === '同業')!.get('input').setValue()
    await flushPromises()
    expect(wrapper.findAll('.nearby__name')).toHaveLength(4)

    await button(notice, '重新整理')!.trigger('click')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('工具列與右欄照常；從排行選里卡片照開、焦點到卡片標題，沒有呼叫不存在的地圖、沒有未捕獲的錯誤', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const wrapper = await mountBroken()

    const modes = wrapper.get('.area-toolbar [aria-label="看什麼"]').findAll('.el-radio-button')
    expect(modes.map((item) => item.text())).toEqual(['在籍學生', '2–5 歲孩子', '孩子增減', '新屋交屋', '參觀', '招生機會', '同業'])
    expect(side(wrapper).get('h2').text()).toBe('在籍學生')
    const items = side(wrapper).findAll('.area-ranking__item')
    expect(items.map((item) => item.get('.area-ranking__name').text())).toEqual(['三民區本揚里', '三民區寶業里', '左營區新上里'])

    await items[0]!.trigger('click')
    await flushPromises()
    const title = side(wrapper).get('.village-card__title')
    expect(title.text()).toBe('三民區本揚里')
    expect(document.activeElement).toBe(title.element)
    expect(wrapper.emitted('update:view')!.at(-1)).toEqual([{ map: null, village: '64000050015', table: 'village' }])
    // 各里表點里名也一樣能選。
    await side(wrapper).get('button[aria-label="關閉里卡片"]').trigger('click')
    await flushPromises()
    await wrapper.get('.area-full-tables .stats-table__name-link').trigger('click')
    await flushPromises()
    expect(side(wrapper).get('.village-card__title').text()).toBe('三民區鼎金里')

    // 唯一的錯誤紀錄是地圖 chunk 本身；Vue 沒有回報任何事件處理的未捕獲錯誤。
    expect(logged.mock.calls).toEqual([['[AreaTab] 地圖元件載入失敗', expect.any(Error)]])
    expect(warned.mock.calls.filter(([message]) => String(message).includes('Unhandled error'))).toEqual([])
  })
})
