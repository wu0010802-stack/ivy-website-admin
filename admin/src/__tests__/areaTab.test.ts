// 區域分析子分頁（2026-10-08 規格 9）。地圖元件換成 stub（地圖本身見 areaMap.test.ts）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isReactive } from 'vue'
import { flushPromises, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import AreaTab from '../components/admissions/area/AreaTab.vue'
import areaTabSource from '../components/admissions/area/AreaTab.vue?raw'
import NearbyKindergartens from '../components/admissions/area/NearbyKindergartens.vue'
import {
  areaKindergartens, areaStats, button, cleanup, deferred, mockGet, mountWith, pathsTo, queryOf, villageBoundaries,
} from './admissionsTestKit'

const mapStub = vi.hoisted(() => ({ focus: vi.fn() }))
vi.mock('../components/admissions/area/AreaMap.vue', async () => {
  const { defineComponent, h } = await import('vue')
  // __esModule：AreaTab 用 defineAsyncComponent 載入，Vue 靠它判斷要取 default（真的模組是 ES module namespace，mock 工廠的回傳值不是）。
  return {
    __esModule: true,
    default: defineComponent({
      name: 'AreaMap',
      props: ['boundaries', 'villages', 'campus', 'campusName', 'kindergartens', 'radiusKm', 'narrow'],
      emits: ['open-area'],
      setup(_, { expose }) {
        expose({ focusKindergarten: mapStub.focus })
        return () => h('div', { class: 'area-map-stub' })
      },
    }),
  }
})
vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { downloadCsv } from '../utils/csv'

afterEach(() => {
  mapStub.focus.mockClear()
  cleanup()
})

const EMPTY_TEXT = '義華在 115 學年還沒有招生訪視。新增訪視，或在參觀案件標記家長已到場後，這裡就會有統計。'
const props = (changes: Record<string, unknown> = {}) => ({
  campusKey: 'yihua', schoolYear: 115, semester: null, csvName: (title: string) => `招生統計-${title}.csv`, emptyText: EMPTY_TEXT, ...changes,
})
const routes = (area: unknown = areaStats()) => ({
  '/admin/admissions/area/boundaries': villageBoundaries(),
  '/admin/admissions/area/kindergartens': areaKindergartens(),
  '/admin/admissions/area': area,
})
async function mountTab(changes: Record<string, unknown> = {}, area: unknown = areaStats()) {
  const get = mockGet(routes(area))
  const mounted = await mountWith(AreaTab, { props: props(changes) })
  await vi.waitFor(() => expect(mounted.wrapper.find('.area-map-stub').exists() || mounted.wrapper.find('.area-map-error').exists()).toBe(true))
  return { ...mounted, get }
}
type Dom = Omit<DOMWrapper<Element>, 'exists'>
const block = (wrapper: VueWrapper, title: string): Dom =>
  wrapper.findAll('.stats-block').find((section) => section.get('.stats-block__title').text() === title)!
const bodyRows = (section: Dom) => section.findAll('tbody tr').map((row) => row.findAll('th, td').map((cell) => cell.text()))
const squash = (text: string) => text.replace(/\s+/g, '')
const totals = (changes: Record<string, unknown>) => ({ ...areaStats().totals, ...changes })

describe('區域分析：讀取與三張表', () => {
  it('依頁首校區與學期讀區域、里界、附近幼兒園（半徑預設 3 公里）；狀態列寫資料版本', async () => {
    const { wrapper, get } = await mountTab()
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area?')[0]!))).toEqual({ campus_key: 'yihua', school_year: '115' })
    expect(pathsTo(get, '/admin/admissions/area/boundaries')).toHaveLength(1)
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/kindergartens')[0]!))).toEqual({ campus_key: 'yihua', radius_km: '3' })
    expect(wrapper.get('.area-status').text()).toBe('門牌資料 115 年 10 月・幼兒園 10/08 更新')
  })

  it('狀態列以有地址為母數：到里、未定位到里（只到區、查無門牌）、「查看」、另有沒填地址', async () => {
    const { wrapper } = await mountTab()
    expect(squash(wrapper.get('.area-summary').text())).toBe('有地址7筆：到里5筆、未定位到里2筆（只到區1、查無門牌1）查看；另有2筆沒填地址')
    expect(wrapper.find('.area-reasons').exists()).toBe(false)
  })

  it('狀態列的「查看」有說清楚是看什麼的名稱（讀屏不會只聽到「查看」）', async () => {
    const { wrapper } = await mountTab()
    const view = button(wrapper, '查看')!
    expect(view.attributes('aria-label')).toBe('查看未定位到里的訪視明細')
  })

  it('括號只列非零項（只到區、查無門牌、非高雄市、待比對）；「只到區」用 district_level，不從原因推', async () => {
    const area = areaStats({
      totals: totals({
        visit: 9, with_address: 9, village_level: 4, district_level: 2, unlocated: 2, pending: 1, no_address: 0, anonymized: 0,
        unlocated_reasons: [{ reason: 'outside_kaohsiung', count: 2 }],
      }),
    })
    const { wrapper } = await mountTab({}, area)
    expect(squash(wrapper.get('.area-summary').text())).toBe('有地址9筆：到里4筆、未定位到里5筆（只到區2、非高雄市2、待比對1）查看')
  })

  it('全部到里：不寫未定位、沒有「查看」；沒有沒填地址的就不寫「另有」；已匿名化不在狀態列', async () => {
    const area = areaStats({
      totals: totals({
        visit: 7, with_address: 5, village_level: 5, district_level: 0, unlocated: 0, pending: 0, no_address: 0, anonymized: 2, unlocated_reasons: [],
      }),
    })
    const { wrapper } = await mountTab({}, area)
    expect(squash(wrapper.get('.area-summary').text())).toBe('有地址5筆：到里5筆')
    expect(button(wrapper, '查看')).toBeUndefined()
    expect(wrapper.get('.area-head').text()).not.toContain('匿名')
  })

  it('行政區、里（依參觀人數排）、距離三張表；表頭同其他子分頁；距離表沒有「查看明細」欄', async () => {
    const { wrapper } = await mountTab()
    expect(block(wrapper, '行政區排行').findAll('thead th').map((th) => th.text())).toEqual(['#', '行政區', '參觀人數', '預繳人數', '預繳率', '可能範圍', '操作'])
    expect(bodyRows(block(wrapper, '行政區排行'))).toEqual([
      ['1', '三民區', '5', '2', '40.0%', '17–47%', '查看明細'],
      ['2', '鼓山區', '1', '0', '0.0%', '10–42%', '查看明細'],
    ])
    expect(bodyRows(block(wrapper, '里排行'))).toEqual([
      ['1', '三民區本揚里', '3', '1', '33.3%', '14–45%', '查看明細'],
      ['2', '三民區寶業里', '1', '1', '100.0%', '17–53%', '查看明細'],
      ['3', '鼓山區龍子里', '1', '0', '0.0%', '10–42%', '查看明細'],
    ])
    expect(block(wrapper, '距離分布').findAll('thead th').map((th) => th.text())).toEqual(['距本校', '參觀人數', '預繳人數', '預繳率', '可能範圍'])
    expect(bodyRows(block(wrapper, '距離分布'))).toEqual([
      ['1 公里內', '4', '2', '50.0%', '18–50%'],
      ['1–3 公里', '0', '0', '—', '—'],
      ['3–6 公里', '1', '0', '0.0%', '10–42%'],
      ['6 公里以上', '0', '0', '—', '—'],
      ['無距離', '4', '0', '0.0%', '8–34%'],
    ])
    expect(block(wrapper, '距離分布').find('tbody button').exists()).toBe(false)
  })

  it('里依參觀人數多到少排；同數保留後端的順序', async () => {
    const area = areaStats({
      villages: [
        { district: '三民區', village: '本揚里', village_code: '64000050015', visit: 1, deposit: 0, visit_to_deposit_rate: 0 },
        { district: '三民區', village: '寶業里', village_code: '64000050025', visit: 4, deposit: 1, visit_to_deposit_rate: 25 },
        { district: '鼓山區', village: '龍子里', village_code: null, visit: 1, deposit: 0, visit_to_deposit_rate: 0 },
      ],
    })
    const { wrapper } = await mountTab({}, area)
    expect(bodyRows(block(wrapper, '里排行')).map((row) => row[1])).toEqual(['三民區寶業里', '三民區本揚里', '鼓山區龍子里'])
  })

  it('「查看明細」與「查看」交給頁面帶區域（里一定帶行政區）；地圖點里同樣', async () => {
    const { wrapper } = await mountTab()
    await block(wrapper, '行政區排行').findAll('tbody button')[0]!.trigger('click')
    await block(wrapper, '里排行').findAll('tbody button')[0]!.trigger('click')
    await button(wrapper, '查看')!.trigger('click')
    wrapper.findComponent({ name: 'AreaMap' }).vm.$emit('open-area', { district: '三民區', village: '寶業里' })
    expect(wrapper.emitted('open-records')).toEqual([
      [{ area: '三民區' }], [{ area: '三民區/本揚里' }], [{ area: 'no_village' }], [{ area: '三民區/寶業里' }],
    ])
  })

  it('地圖拿到里界、各里數字、本校、幼兒園與半徑；清單點一列地圖跟著移過去', async () => {
    const { wrapper } = await mountTab()
    const map = wrapper.findComponent({ name: 'AreaMap' })
    expect(map.props()).toMatchObject({ campusName: '義華', radiusKm: 3, narrow: false, boundaries: villageBoundaries(), villages: areaStats().villages })
    expect(map.props('kindergartens')).toHaveLength(4)
    wrapper.findComponent(NearbyKindergartens).vm.$emit('select', 'kg-public')
    expect(mapStub.focus).toHaveBeenCalledWith('kg-public')
  })

  it('里界 GeoJSON 不被包成響應式（893 個 feature 逐層包 Proxy 會拖慢地圖）', async () => {
    const { wrapper } = await mountTab()
    const boundaries = wrapper.findComponent({ name: 'AreaMap' }).props('boundaries') as ReturnType<typeof villageBoundaries>
    expect(isReactive(boundaries)).toBe(false)
    expect(isReactive(boundaries.features)).toBe(false)
    expect(isReactive(boundaries.features[0])).toBe(false)
  })

  it('換半徑：先清空清單（骨架）再重讀帶 radius_km，地圖半徑跟著變；回來後才有資料', async () => {
    const slow = deferred<unknown>()
    let first = true
    mockGet({
      ...routes(),
      '/admin/admissions/area/kindergartens': () => {
        if (first) { first = false; return areaKindergartens() }
        return slow.promise
      },
    })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await vi.waitFor(() => expect(wrapper.findComponent(NearbyKindergartens).props('data')).not.toBeNull())
    wrapper.findComponent(NearbyKindergartens).vm.$emit('update:radiusKm', 6)
    await flushPromises()
    expect(wrapper.findComponent(NearbyKindergartens).props('data')).toBeNull()
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('kindergartens')).toEqual([])
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('radiusKm')).toBe(6)
    slow.resolve(areaKindergartens(undefined, { radius_km: 6 }))
    await flushPromises()
    expect(wrapper.findComponent(NearbyKindergartens).props('data')).toMatchObject({ radius_km: 6 })
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('kindergartens')).toHaveLength(4)
  })

  it('換半徑會重讀幼兒園並帶 radius_km', async () => {
    const { wrapper, get } = await mountTab()
    wrapper.findComponent(NearbyKindergartens).vm.$emit('update:radiusKm', 6)
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/area/kindergartens').at(-1)!).get('radius_km')).toBe('6')
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('radiusKm')).toBe(6)
  })

  it('匯出 CSV：檔名用頁面給的格式；不含「查看明細」欄', async () => {
    const { wrapper } = await mountTab()
    await block(wrapper, '行政區排行').get('[data-test="stats-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('招生統計-行政區排行.csv')
    expect(csv.slice(1).split('\r\n')[0]).toBe('#,行政區,參觀人數,預繳人數,預繳率,可能範圍下限,可能範圍上限')
  })
})

describe('區域分析：三張表的版面', () => {
  // 里排行加「可能範圍」「查看明細」欄 1440 實測約 562px，一欄至少 36rem 才不會把欄擠出表框（2026-10-12）。
  it('桌機自動換列：一欄至少 36rem、窄螢幕靠 min(100%, …) 變單欄，不再寫死 300px', () => {
    const rule = /\.area-tables \{([^}]*)\}/.exec(areaTabSource)![1]!
    expect(rule).toContain('grid-template-columns: repeat(auto-fit, minmax(min(100%, 36rem), 1fr))')
    expect(rule).not.toContain('300px')
  })
})

describe('區域分析：空狀態與錯誤（規格 9.5）', () => {
  it('門牌資料還沒匯入：狀態列寫出來；句號後的幼兒園更新日另成一段，不接「。・」', async () => {
    const area = areaStats({ data_status: { ...areaStats().data_status, doorplate_version: null, doorplates_synced_at: null } })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.findAll('.area-status span').map((span) => span.text())).toEqual(['門牌資料尚未匯入，匯入後會自動比對。', '幼兒園 10/08 更新'])
    expect(wrapper.get('.area-status').text()).not.toContain('。・')
    expect(wrapper.get('.area-status').text()).not.toContain('・')
  })

  it('門牌資料已匯入但幼兒園還沒匯入：狀態列補「幼兒園資料尚未匯入」，不是整句消失', async () => {
    const area = areaStats({ data_status: { ...areaStats().data_status, kindergartens_synced_at: null } })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.get('.area-status').text()).toBe('門牌資料 115 年 10 月・幼兒園資料尚未匯入')
  })

  it('門牌與幼兒園資料都還沒匯入：兩句各自成段，不接「。・」', async () => {
    const area = areaStats({
      data_status: { ...areaStats().data_status, doorplate_version: null, doorplates_synced_at: null, kindergartens_synced_at: null },
    })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.findAll('.area-status span').map((span) => span.text())).toEqual(['門牌資料尚未匯入，匯入後會自動比對。', '幼兒園資料尚未匯入'])
    expect(wrapper.get('.area-status').text()).not.toContain('。・')
    expect(wrapper.get('.area-status').text()).not.toContain('・')
  })

  it('有訪視但都沒填地址：寫原因、不列三張表（不顯示假的 0）；地圖與清單照常', async () => {
    const area = areaStats({
      totals: totals({ visit: 3, with_address: 0, village_level: 0, district_level: 0, unlocated: 0, pending: 0, no_address: 3, anonymized: 0, unlocated_reasons: [] }),
      districts: [], villages: [],
      distance_bands: areaStats().distance_bands.map((band) => ({ ...band, visit: band.band === 'none' ? 3 : 0, deposit: 0, visit_to_deposit_rate: band.band === 'none' ? 0 : null })),
    })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.get('.area-empty').text()).toBe('這個範圍的訪視都還沒填地址。')
    expect(wrapper.findAll('.stats-block')).toHaveLength(0)
    expect(wrapper.find('.area-map-stub').exists()).toBe(true)
    expect(wrapper.find('.area-summary').exists()).toBe(false)
  })

  it('範圍內的訪視地址都已匿名化（依保存期限清除）：不說成「沒填地址」，三張表仍不列', async () => {
    const area = areaStats({
      totals: totals({ visit: 4, with_address: 0, village_level: 0, district_level: 0, unlocated: 0, pending: 0, no_address: 0, anonymized: 4, unlocated_reasons: [] }),
      districts: [], villages: [],
    })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.get('.area-empty').text()).toBe('這個範圍的訪視地址都已依保存期限清除，無法比對。')
    expect(wrapper.text()).not.toContain('還沒填地址')
    expect(wrapper.findAll('.stats-block')).toHaveLength(0)
    expect(wrapper.find('.area-summary').exists()).toBe(false)
  })

  it('一部分沒填地址、一部分已匿名化（都沒有可比對的地址）：一句話寫兩個筆數', async () => {
    const area = areaStats({
      totals: totals({ visit: 5, with_address: 0, village_level: 0, district_level: 0, unlocated: 0, pending: 0, no_address: 3, anonymized: 2, unlocated_reasons: [] }),
      districts: [], villages: [],
    })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.get('.area-empty').text()).toBe('這個範圍的訪視沒有可比對的地址：3 筆沒填地址、2 筆已依保存期限清除。')
    expect(wrapper.findAll('.stats-block')).toHaveLength(0)
  })

  it('範圍內沒有訪視：沿用統計的空狀態文案', async () => {
    const area = areaStats({
      totals: totals({ visit: 0, with_address: 0, village_level: 0, district_level: 0, unlocated: 0, pending: 0, no_address: 0, anonymized: 0, unlocated_reasons: [] }),
      districts: [], villages: [], distance_bands: areaStats().distance_bands.map((band) => ({ ...band, visit: 0, deposit: 0, visit_to_deposit_rate: null })),
    })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.text()).toContain(EMPTY_TEXT)
    expect(wrapper.text()).not.toContain('還沒填地址')
    expect(wrapper.findAll('.stats-block')).toHaveLength(0)
  })

  it.each([
    ['no_doorplate', '本校地址比對不到門牌，無法計算距離。'],
    ['no_address', '找不到本校地址，無法計算距離。'],
    ['pending', '門牌資料尚未匯入，無法計算距離。'],
    ['mystery', '本校位置尚未確定，無法計算距離。'],
  ])('本校沒有座標（%s）：距離表不列數字，改寫原因', async (locate_error, text) => {
    const { wrapper } = await mountTab({}, areaStats({ campus: { key: 'yihua', name: '義華', lat: null, lng: null, locate_error } }))
    const distance = block(wrapper, '距離分布')
    expect(distance.text()).toContain(text)
    expect(distance.findAll('tbody tr')).toHaveLength(0)
    expect(distance.find('.stats-block__caption').exists()).toBe(false)
  })

  it('區域讀取失敗：錯誤與重新載入，重試成功恢復', async () => {
    let fail = true
    mockGet({ ...routes(), '/admin/admissions/area': () => { if (fail) throw new Error('boom'); return areaStats() } })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    expect(wrapper.text()).toContain('無法讀取區域分析，請重新載入。')
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.area-status').exists()).toBe(true)
  })

  it('里界讀取失敗：地圖區寫錯誤與重試，表格照常；重試成功出現地圖', async () => {
    let fail = true
    mockGet({ ...routes(), '/admin/admissions/area/boundaries': () => { if (fail) throw new Error('boom'); return villageBoundaries() } })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    expect(wrapper.get('.area-map-error').text()).toContain('里界載入失敗，地圖無法顯示。')
    expect(block(wrapper, '行政區排行')).toBeDefined()
    fail = false
    await button(wrapper, '重試')!.trigger('click')
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
  })

  it('快速切換校區只顯示最後一次（明華先回、義華晚回也不會蓋掉）', async () => {
    const slow = deferred<unknown>()
    mockGet({
      ...routes(),
      '/admin/admissions/area': (path: string) => (queryOf(path).get('campus_key') === 'yihua' ? slow.promise : areaStats({ campus: { key: 'minghua', name: '明華', lat: 22.663189, lng: 120.306301, locate_error: null } })),
    })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    slow.resolve(areaStats())
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.findComponent({ name: 'AreaMap' }).exists()).toBe(true))
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('campus')).toMatchObject({ key: 'minghua' })
  })
})
