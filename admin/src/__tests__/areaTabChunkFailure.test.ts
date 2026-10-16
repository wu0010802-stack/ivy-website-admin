// 區域分析：地圖元件的 chunk 下載失敗（剛部署完，舊的 hash 檔已不存在）。
// 這個檔把 AreaMap.vue 換成「載入就丟錯」的 mock，其他測試檔的 mock 是正常載入的。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import AreaTab from '../components/admissions/area/AreaTab.vue'
import {
  areaBabycare, areaChanges, areaKindergartens, areaOpportunity, areaPeerFees, areaStats, areaTrends, button, cleanup, mockGet,
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

describe('區域分析：地圖元件載入失敗', () => {
  it('地圖區寫原因並給「重新整理」整頁重載；三張表與幼兒園清單照常', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const reload = vi.fn()
    vi.stubGlobal('location', { href: 'https://example.test/admin/admissions', reload })
    mockGet({
      '/admin/admissions/area/boundaries': villageBoundaries(),
      '/admin/admissions/area/kindergartens': areaKindergartens(),
      '/admin/admissions/area/fees': areaPeerFees(),
      '/admin/admissions/area/babycare': areaBabycare(),
      '/admin/admissions/area/changes': areaChanges(),
      '/admin/admissions/area/opportunity': areaOpportunity(),
      '/admin/admissions/area/trends': areaTrends(),
      '/admin/admissions/area': areaStats(),
    })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-error').exists()).toBe(true))
    await flushPromises()

    const notice = wrapper.get('.area-map-error')
    expect(notice.text()).toContain('地圖沒有載入成功，請重新整理這一頁。')
    expect(wrapper.text()).not.toContain('里界載入失敗')
    expect(logged).toHaveBeenCalledWith('[AreaTab] 地圖元件載入失敗', expect.any(Error))

    expect(wrapper.findAll('.area-tables .stats-block__title').map((title) => title.text())).toEqual(['行政區排行', '里排行', '距離分布'])
    expect(wrapper.findAll('.area-tables .stats-block')[0]!.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.findAll('.nearby__name')).toHaveLength(4)

    await button(notice, '重新整理')!.trigger('click')
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
