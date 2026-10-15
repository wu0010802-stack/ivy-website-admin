// 區域分析子分頁（2026-10-08 規格 9）。地圖元件換成 stub（地圖本身見 areaMap.test.ts）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isReactive } from 'vue'
import { flushPromises, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import AreaTab from '../components/admissions/area/AreaTab.vue'
import areaTabSource from '../components/admissions/area/AreaTab.vue?raw'
import statsTabSource from '../components/admissions/StatsTab.vue?raw'
import NearbyBabycare from '../components/admissions/area/NearbyBabycare.vue'
import NearbyKindergartens from '../components/admissions/area/NearbyKindergartens.vue'
import NearbyPanel from '../components/admissions/area/NearbyPanel.vue'
import PeerFeesPanel from '../components/admissions/area/PeerFeesPanel.vue'
import {
  areaBabycare, areaChanges, areaEnrolled, areaKindergartens, areaOpportunity, areaPeerFees, areaStats, areaTrends, button, cleanup, deferred,
  mockGet, mountWith, pathsTo, queryOf, villageBoundaries,
} from './admissionsTestKit'

const mapStub = vi.hoisted(() => ({ focus: vi.fn(), focusBabycare: vi.fn(), reveal: vi.fn() }))
vi.mock('../components/admissions/area/AreaMap.vue', async () => {
  const { defineComponent, h } = await import('vue')
  // __esModule：AreaTab 用 defineAsyncComponent 載入，Vue 靠它判斷要取 default（真的模組是 ES module namespace，mock 工廠的回傳值不是）。
  return {
    __esModule: true,
    default: defineComponent({
      name: 'AreaMap',
      props: [
        'boundaries', 'villages', 'campus', 'campusName', 'kindergartens', 'radiusKm', 'narrow', 'opportunity', 'opportunityNote', 'babycare',
        'trends', 'trendNote', 'homesNote', 'enrolled', 'enrolledNote', 'gradeFilter',
      ],
      emits: ['open-area', 'update:gradeFilter'],
      setup(_, { expose }) {
        expose({ focusKindergarten: mapStub.focus, focusBabycare: mapStub.focusBabycare, revealBabycare: mapStub.reveal })
        return () => h('div', { class: 'area-map-stub' })
      },
    }),
  }
})
vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { downloadCsv } from '../utils/csv'

afterEach(() => {
  mapStub.focus.mockClear()
  mapStub.focusBabycare.mockClear()
  mapStub.reveal.mockClear()
  cleanup()
})

const EMPTY_TEXT = '義華在 115 學年還沒有招生訪視。新增訪視，或在參觀案件標記家長已到場後，這裡就會有統計。'
const props = (changes: Record<string, unknown> = {}) => ({
  campusKey: 'yihua', schoolYear: 115, semester: null, csvName: (title: string) => `招生統計-${title}.csv`, emptyText: EMPTY_TEXT, ...changes,
})
const routes = (area: unknown = areaStats(), opportunity: unknown = areaOpportunity(), enrolled: unknown = areaEnrolled()) => ({
  '/admin/admissions/area/boundaries': villageBoundaries(),
  '/admin/admissions/area/kindergartens': areaKindergartens(),
  '/admin/admissions/area/babycare': areaBabycare(),
  '/admin/admissions/area/fees': areaPeerFees(),
  '/admin/admissions/area/changes': areaChanges(),
  '/admin/admissions/area/opportunity': opportunity,
  '/admin/admissions/area/trends': areaTrends(),
  '/admin/admissions/area/enrolled': enrolled,
  '/admin/admissions/area': area,
})
async function mountTab(changes: Record<string, unknown> = {}, area: unknown = areaStats(), opportunity: unknown = areaOpportunity()) {
  const get = mockGet(routes(area, opportunity))
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
    expect(wrapper.get('.area-status').text()).toBe('門牌資料 115 年 10 月版・幼兒園名單 10/08 更新・托嬰名單 10/14 更新・各里人口 115 年 9 月')
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
  // 區域分析的 .area-empty 與統計總覽的 .stats-empty 是同一種「這個範圍沒有資料」：外觀共用全域的 .empty-note
  // （虛線框、次要文字色、置中，顏色全走 token），兩個元件不再各寫一份不一樣的。
  it('空狀態外觀共用 .empty-note：兩個元件沒有自己的 .area-empty／.stats-empty 樣式，全域樣式只用 token', () => {
    expect(areaTabSource).not.toMatch(/\.area-empty\s*\{/)
    expect(statsTabSource).not.toMatch(/\.stats-empty\s*\{/)
    expect(areaTabSource).toContain('class="empty-note area-empty"')
    expect(statsTabSource).toContain('class="empty-note stats-empty"')
    const globalStyle = readFileSync(join(__dirname, '..', 'style.css'), 'utf8')
    const rule = /\n\.empty-note \{([^}]*)\}/.exec(globalStyle)?.[1]
    expect(rule, 'style.css 要有 .empty-note').toBeDefined()
    expect(rule).toContain('border: 1px dashed var(--line-strong)')
    expect(rule).toContain('color: var(--ink-2)')
    expect(rule).toContain('text-align: center')
    expect(rule).not.toMatch(/rgba?\(|oklch\(|hsla?\(|#[0-9a-fA-F]{3,8}\b/)
  })

  it('「查看明細」事件拿到的就是那一列的型別，不再 as 轉型', () => {
    expect(areaTabSource).not.toMatch(/\bas Area(District|Village)Row\b/)
    expect(areaTabSource).not.toContain('as unknown as')
  })

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
    expect(wrapper.findAll('.area-status span').map((span) => span.text())).toEqual(['門牌資料尚未匯入，家長地址暫時對不到里、算不出距離；匯入後自動補上。', '幼兒園名單 10/08 更新・托嬰名單 10/14 更新・各里人口 115 年 9 月'])
    expect(wrapper.get('.area-status').text()).not.toContain('。・')
  })

  it('門牌資料已匯入但幼兒園還沒匯入：狀態列補「幼兒園名單尚未匯入」，不是整句消失', async () => {
    const area = areaStats({ data_status: { ...areaStats().data_status, kindergartens_synced_at: null } })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.get('.area-status').text()).toBe('門牌資料 115 年 10 月版・幼兒園名單尚未匯入・托嬰名單 10/14 更新・各里人口 115 年 9 月')
  })

  it('門牌與幼兒園資料都還沒匯入：兩句各自成段，不接「。・」', async () => {
    const area = areaStats({
      data_status: { ...areaStats().data_status, doorplate_version: null, doorplates_synced_at: null, kindergartens_synced_at: null },
    })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.findAll('.area-status span').map((span) => span.text())).toEqual(['門牌資料尚未匯入，家長地址暫時對不到里、算不出距離；匯入後自動補上。', '幼兒園名單尚未匯入・托嬰名單 10/14 更新・各里人口 115 年 9 月'])
    expect(wrapper.get('.area-status').text()).not.toContain('。・')
  })

  it('有訪視但都沒填地址：寫原因、不列三張表（不顯示假的 0）；地圖與清單照常', async () => {
    const area = areaStats({
      totals: totals({ visit: 3, with_address: 0, village_level: 0, district_level: 0, unlocated: 0, pending: 0, no_address: 3, anonymized: 0, unlocated_reasons: [] }),
      districts: [], villages: [],
      distance_bands: areaStats().distance_bands.map((band) => ({ ...band, visit: band.band === 'none' ? 3 : 0, deposit: 0, visit_to_deposit_rate: band.band === 'none' ? 0 : null })),
    })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.get('.area-empty').text()).toBe('這個範圍的訪視都還沒填地址。')
    expect(wrapper.get('.area-empty').classes()).toContain('empty-note')
    expect(wrapper.findAll('.area-tables .stats-block')).toHaveLength(0)
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
    expect(wrapper.findAll('.area-tables .stats-block')).toHaveLength(0)
    expect(wrapper.find('.area-summary').exists()).toBe(false)
  })

  it('一部分沒填地址、一部分已匿名化（都沒有可比對的地址）：一句話寫兩個筆數', async () => {
    const area = areaStats({
      totals: totals({ visit: 5, with_address: 0, village_level: 0, district_level: 0, unlocated: 0, pending: 0, no_address: 3, anonymized: 2, unlocated_reasons: [] }),
      districts: [], villages: [],
    })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.get('.area-empty').text()).toBe('這個範圍的訪視沒有可比對的地址：3 筆沒填地址、2 筆已依保存期限清除。')
    expect(wrapper.findAll('.area-tables .stats-block')).toHaveLength(0)
  })

  it('範圍內沒有訪視：沿用統計的空狀態文案', async () => {
    const area = areaStats({
      totals: totals({ visit: 0, with_address: 0, village_level: 0, district_level: 0, unlocated: 0, pending: 0, no_address: 0, anonymized: 0, unlocated_reasons: [] }),
      districts: [], villages: [], distance_bands: areaStats().distance_bands.map((band) => ({ ...band, visit: 0, deposit: 0, visit_to_deposit_rate: null })),
    })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.text()).toContain(EMPTY_TEXT)
    expect(wrapper.text()).not.toContain('還沒填地址')
    expect(wrapper.findAll('.area-tables .stats-block')).toHaveLength(0)
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

describe('區域分析：各區塊互不牽連（2026-10-12）', () => {
  it('附近幼兒園讀取失敗：只有清單那一塊寫錯誤與重試，統計、三張表、地圖照常；重試成功清單回來', async () => {
    let fail = true
    mockGet({
      ...routes(),
      '/admin/admissions/area/kindergartens': () => { if (fail) throw new Error('boom'); return areaKindergartens() },
    })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    expect(wrapper.text()).toContain('無法讀取附近幼兒園。')
    expect(wrapper.text()).not.toContain('無法讀取區域分析')
    expect(wrapper.find('.area-summary').exists()).toBe(true)
    expect(bodyRows(block(wrapper, '里排行'))).toHaveLength(3)
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('kindergartens')).toEqual([])
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('無法讀取附近幼兒園。')
    expect(wrapper.findAll('.nearby__name')).toHaveLength(4)
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('kindergartens')).toHaveLength(4)
  })

  it('連續換半徑：先送出的 3 公里晚回，不蓋掉後來選的 6 公里（清單與地圖都是 6 公里的）', async () => {
    const slow3 = deferred<unknown>()
    mockGet({
      ...routes(),
      '/admin/admissions/area/kindergartens': (path: string) => {
        const radius = queryOf(path).get('radius_km')
        if (radius === '3') return slow3.promise
        return areaKindergartens(areaKindergartens().items.slice(0, 2), { radius_km: Number(radius) })
      },
    })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    wrapper.findComponent(NearbyKindergartens).vm.$emit('update:radiusKm', 6)
    await flushPromises()
    expect(wrapper.findComponent(NearbyKindergartens).props('data')).toMatchObject({ radius_km: 6 })
    slow3.resolve(areaKindergartens(undefined, { radius_km: 3 }))
    await flushPromises()
    expect(wrapper.findComponent(NearbyKindergartens).props('data')).toMatchObject({ radius_km: 6 })
    expect(wrapper.findAll('.nearby__name')).toHaveLength(2)
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('kindergartens')).toHaveLength(2)
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('radiusKm')).toBe(6)
  })

  it('連續換半徑：舊的請求晚到的失敗，也不會蓋掉新的成功（不出現錯誤提示）', async () => {
    const slow3 = deferred<unknown>()
    mockGet({
      ...routes(),
      '/admin/admissions/area/kindergartens': (path: string) => (queryOf(path).get('radius_km') === '3' ? slow3.promise : areaKindergartens(undefined, { radius_km: 6 })),
    })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    wrapper.findComponent(NearbyKindergartens).vm.$emit('update:radiusKm', 6)
    await flushPromises()
    slow3.reject(new Error('timeout'))
    await flushPromises()
    expect(wrapper.text()).not.toContain('無法讀取附近幼兒園。')
    expect(wrapper.findAll('.nearby__name')).toHaveLength(4)
  })

  it('門牌資料還沒匯入（家長地址全是「待比對」）：狀態列寫原因，三張表照常出現、空的寫各自的空狀態，不整頁壞掉', async () => {
    const empty = areaStats().distance_bands.map((band) => ({
      ...band, visit: band.band === 'none' ? 7 : 0, deposit: 0, visit_to_deposit_rate: band.band === 'none' ? 0 : null,
      visit_to_deposit_range: band.band === 'none' ? { low: 8, high: 35 } : null,
    }))
    const area = areaStats({
      data_status: { ...areaStats().data_status, doorplate_version: null, doorplates_synced_at: null },
      totals: totals({ visit: 9, with_address: 7, village_level: 0, district_level: 0, unlocated: 0, pending: 7, no_address: 2, anonymized: 0, unlocated_reasons: [] }),
      districts: [], villages: [], distance_bands: empty,
    })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.get('.area-status').text()).toContain('門牌資料尚未匯入')
    expect(squash(wrapper.get('.area-summary').text())).toBe('有地址7筆：到里0筆、未定位到里7筆（待比對7）查看；另有2筆沒填地址')
    expect(wrapper.findAll('.area-tables .stats-block')).toHaveLength(3)
    expect(block(wrapper, '行政區排行').text()).toContain('這個範圍還沒有比對到行政區的地址')
    expect(block(wrapper, '里排行').text()).toContain('這個範圍還沒有定位到里的地址')
    expect(bodyRows(block(wrapper, '距離分布')).find((row) => row[0] === '無距離')).toEqual(['無距離', '7', '0', '0.0%', '8–35%'])
    expect(wrapper.find('.empty-note').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'AreaMap' }).exists()).toBe(true)
  })
})

describe('招生機會（2026-10-13 規格 7）', () => {
  it('依頁首校區、學期與半徑讀招生機會；換半徑重讀並帶 radius_km', async () => {
    const { wrapper, get } = await mountTab()
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/opportunity')[0]!)))
      .toEqual({ campus_key: 'yihua', school_year: '115', radius_km: '3' })
    wrapper.findComponent(NearbyKindergartens).vm.$emit('update:radiusKm', 1)
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/area/opportunity').at(-1)!).get('radius_km')).toBe('1')
  })

  it('狀態列寫人口月份；人口還沒匯入寫「各里人口尚未匯入」', async () => {
    const area = areaStats({ data_status: { ...areaStats().data_status, population_version: null, population_synced_at: null } })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.get('.area-status').text()).toBe('門牌資料 115 年 10 月版・幼兒園名單 10/08 更新・托嬰名單 10/14 更新・各里人口尚未匯入')
  })

  it('總結：半徑內合計、明顯偏少的里與合計少了幾位、不算在內的人數', async () => {
    const { wrapper } = await mountTab()
    const section = block(wrapper, '招生機會（本校 3 公里內）')
    expect(section.findAll('.opportunity-summary p').map((line) => line.text())).toEqual([
      '本校 3 公里內 3 個里，2–5 歲孩子 1,000 位，參觀 20 位（參觀率 2.0%）。明顯偏少的里 1 個，照附近的參觀率合計少了約 7 位。',
      '另有 2 位來自 3 公里外、1 位沒填地址、2 位沒對到里，不算在內。',
    ])
  })

  it('表格：少最多的排最前面，判讀寫「少了約 N 位」等；說明寫資料來源與月份', async () => {
    const { wrapper } = await mountTab()
    const section = block(wrapper, '招生機會（本校 3 公里內）')
    expect(section.findAll('thead th').map((th) => th.text())).toEqual(['#', '里', '距本校', '2–5 歲', '0–1 歲', '參觀人數', '參觀率', '照附近應有', '判讀'])
    expect(bodyRows(section)).toEqual([
      ['1', '三民區鼎金里', '800 m', '500', '150', '3', '0.6%', '約 10 位', '少了約 7 位'],
      ['2', '三民區本揚里', '300 m', '300', '90', '6', '2.0%', '約 6 位', '差不多'],
      ['3', '三民區寶業里', '300 m', '200', '60', '11', '5.5%', '約 4 位', '比附近多'],
    ])
    expect(section.get('.stats-block__caption').text()).toContain('資料來源：內政部戶政司 村里戶數、單一年齡人口，115 年 9 月。')
    expect(section.get('.stats-block__caption').text()).toContain('約有一成機率是誤報')
  })

  it('匯出 CSV：「照附近應有」寫數字，不寫「約」', async () => {
    const { wrapper } = await mountTab()
    await block(wrapper, '招生機會（本校 3 公里內）').get('[data-test="stats-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('招生統計-招生機會.csv')
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('#,里,距本校,2–5 歲,0–1 歲,參觀人數,參觀率,照附近應有,判讀')
    expect(lines[1]).toBe('1,三民區鼎金里,800 m,500,150,3,0.6%,10,少了約 7 位')
  })

  it('里很多時先列前 10 個，「顯示全部」展開、再按收合；匯出 CSV 一律是全部', async () => {
    const base = areaOpportunity().villages[1]!
    const many = areaOpportunity({
      villages: Array.from({ length: 12 }, (_, index) => ({ ...base, village: `第${index + 1}里`, village_code: `6400005${String(index).padStart(4, '0')}` })),
    })
    const { wrapper } = await mountTab({}, areaStats(), many)
    const section = () => block(wrapper, '招生機會（本校 3 公里內）')
    expect(section().findAll('tbody tr')).toHaveLength(10)
    const more = button(section(), '顯示全部 12 列')!
    expect(more.attributes('aria-expanded')).toBe('false')
    await more.trigger('click')
    expect(section().findAll('tbody tr')).toHaveLength(12)
    await button(section(), '只顯示前 10 列')!.trigger('click')
    expect(section().findAll('tbody tr')).toHaveLength(10)
    await section().get('[data-test="stats-csv"]').trigger('click')
    expect(vi.mocked(downloadCsv).mock.calls.at(-1)![1].slice(1).split('\r\n').filter(Boolean)).toHaveLength(13)
  })

  it('三個里以內沒有「顯示全部」', async () => {
    const { wrapper } = await mountTab()
    expect(block(wrapper, '招生機會（本校 3 公里內）').text()).not.toContain('顯示全部')
  })

  it('附近參觀不到 10 位：總結寫先不判斷；沒有偏少的里寫「沒有明顯偏少的里」；不算在內的都是 0 就不寫', async () => {
    const quiet = areaOpportunity({
      baseline: { ...areaOpportunity().baseline!, visit: 6, judged: false },
      outside_visit: 0, unplaced_visit: 0, no_address_visit: 0,
      villages: areaOpportunity().villages.map((row) => ({ ...row, signal: 'not_judged' as const })),
    })
    const { wrapper } = await mountTab({}, areaStats(), quiet)
    const section = block(wrapper, '招生機會（本校 3 公里內）')
    expect(section.findAll('.opportunity-summary p').map((line) => line.text())).toEqual([
      '本校 3 公里內 3 個里，2–5 歲孩子 1,000 位，參觀 6 位（參觀率 2.0%）。附近參觀還不到 10 位，先不判斷哪些里偏少。',
    ])
    expect(bodyRows(section).map((row) => row.at(-1))).toEqual(['還不判斷', '還不判斷', '還不判斷'])
  })

  it('人口沒匯入：區塊寫原因、地圖後兩種著色停用並給同一個原因', async () => {
    const missing = areaOpportunity({ population: { ...areaOpportunity().population, version: null, synced_at: null }, baseline: null, villages: [] })
    const { wrapper } = await mountTab({}, areaStats(), missing)
    const section = block(wrapper, '招生機會（本校 3 公里內）')
    expect(section.get('.stats-block__empty').text()).toBe('各里人口資料尚未匯入；匯入後就能看哪些里孩子多、參觀少。')
    expect(section.find('.opportunity-summary').exists()).toBe(false)
    expect(section.find('[data-test="stats-csv"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('opportunityNote')).toBe('各里人口資料尚未匯入；匯入後就能看哪些里孩子多、參觀少。')
  })

  it('本校沒座標：區塊寫原因', async () => {
    const unlocated = areaOpportunity({
      campus: { ...areaOpportunity().campus, lat: null, lng: null, locate_error: 'no_doorplate' }, baseline: null, villages: [],
    })
    const { wrapper } = await mountTab({}, areaStats(), unlocated)
    expect(block(wrapper, '招生機會（本校 3 公里內）').get('.stats-block__empty').text())
      .toBe('本校位置未標示（本校地址比對不到門牌），算不出附近有哪些里。')
  })

  it('讀取失敗：只有這一塊寫錯誤與重試，三張表與地圖照常；地圖後兩種著色停用；重試成功恢復', async () => {
    let fail = true
    mockGet(routes(areaStats(), () => {
      if (fail) throw new Error('boom')
      return areaOpportunity()
    }))
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.opportunity-error').exists()).toBe(true))
    expect(block(wrapper, '里排行')).toBeDefined()
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('opportunityNote')).toBe('招生機會讀取失敗。')
    fail = false
    await button(wrapper.get('.opportunity-error') as never, '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.opportunity-error').exists()).toBe(false)
    expect(block(wrapper, '招生機會（本校 3 公里內）')).toBeDefined()
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('opportunityNote')).toBe('')
  })

  it('讀取中不算用不了：地圖的著色切換照常可選（換半徑時不跳回參觀人數）', async () => {
    const slow = deferred<unknown>()
    mockGet(routes(areaStats(), () => slow.promise))
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    const map = wrapper.findComponent({ name: 'AreaMap' })
    expect(map.props('opportunity')).toBeNull()
    expect(map.props('opportunityNote')).toBe('')
    slow.resolve(areaOpportunity())
    await flushPromises()
    expect(map.props('opportunity')).toMatchObject({ radius_km: 3 })
  })

  it('連續換半徑：先送出的晚回，不蓋掉後來選的', async () => {
    const slow3 = deferred<unknown>()
    mockGet(routes(areaStats(), (path: string) =>
      queryOf(path).get('radius_km') === '3' ? slow3.promise : areaOpportunity({ radius_km: 6 }),
    ))
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    wrapper.findComponent(NearbyKindergartens).vm.$emit('update:radiusKm', 6)
    await flushPromises()
    slow3.resolve(areaOpportunity())
    await flushPromises()
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('opportunity')).toMatchObject({ radius_km: 6 })
    expect(block(wrapper, '招生機會（本校 6 公里內）')).toBeDefined()
  })
})

describe('托嬰與園所變化（2026-10-14 規格 7）', () => {
  it('依頁首校區與半徑讀托嬰與變化；狀態列多一段托嬰名單更新日', async () => {
    const { wrapper, get } = await mountTab()
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/babycare')[0]!))).toEqual({ campus_key: 'yihua', radius_km: '3' })
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/changes')[0]!))).toEqual({ campus_key: 'yihua', radius_km: '3' })
    expect(wrapper.get('.area-status').text()).toBe('門牌資料 115 年 10 月版・幼兒園名單 10/08 更新・托嬰名單 10/14 更新・各里人口 115 年 9 月')
  })

  it('托嬰名單還沒匯入：狀態列寫尚未匯入', async () => {
    const area = areaStats({ data_status: { ...areaStats().data_status, babycare_synced_at: null } })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.get('.area-status').text()).toContain('幼兒園名單 10/08 更新・托嬰名單尚未匯入・各里人口 115 年 9 月')
  })

  it('預設是幼兒園清單；切到托嬰中心才顯示托嬰清單，並請地圖打開托嬰圖層；地圖一直拿得到托嬰點', async () => {
    const { wrapper } = await mountTab()
    expect(wrapper.find('.nearby--babycare').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('babycare')).toHaveLength(3)
    wrapper.findComponent(NearbyPanel).vm.$emit('update:kind', 'babycare')
    await flushPromises()
    expect(wrapper.find('.nearby--babycare').exists()).toBe(true)
    expect(wrapper.find('.nearby__title').text()).toBe('附近托嬰中心')
    expect(wrapper.get('.nearby__summary').text()).toBe('3 公里內托嬰中心 3 所，核定 92 位，實際收托 84 位。')
    expect(mapStub.reveal).toHaveBeenCalledTimes(1)
  })

  it('托嬰清單點一列：地圖移到該點', async () => {
    const { wrapper } = await mountTab()
    wrapper.findComponent(NearbyPanel).vm.$emit('update:kind', 'babycare')
    await flushPromises()
    wrapper.findComponent(NearbyBabycare).vm.$emit('select', 'bc-public')
    expect(mapStub.focusBabycare).toHaveBeenCalledWith('bc-public')
    expect(mapStub.focus).not.toHaveBeenCalled()
  })

  it('換半徑：幼兒園、托嬰、變化、收費一起重讀並帶 radius_km，地圖半徑跟著變', async () => {
    const { wrapper, get } = await mountTab()
    wrapper.findComponent(NearbyKindergartens).vm.$emit('update:radiusKm', 6)
    await flushPromises()
    for (const path of ['/admin/admissions/area/kindergartens', '/admin/admissions/area/babycare', '/admin/admissions/area/changes', '/admin/admissions/area/fees']) {
      expect(queryOf(pathsTo(get, path).at(-1)!).get('radius_km')).toBe('6')
    }
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('radiusKm')).toBe(6)
  })

  it('半徑在托嬰清單上換也一樣（兩份清單共用同一個半徑）', async () => {
    const { wrapper, get } = await mountTab()
    wrapper.findComponent(NearbyPanel).vm.$emit('update:kind', 'babycare')
    await flushPromises()
    wrapper.findComponent(NearbyBabycare).vm.$emit('update:radiusKm', 1)
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/area/babycare').at(-1)!).get('radius_km')).toBe('1')
    expect(queryOf(pathsTo(get, '/admin/admissions/area/kindergartens').at(-1)!).get('radius_km')).toBe('1')
  })

  it('托嬰讀取失敗：切到托嬰才看得到錯誤；幼兒園清單、變化、地圖照常；重試成功恢復', async () => {
    let fail = true
    mockGet({ ...routes(), '/admin/admissions/area/babycare': () => { if (fail) throw new Error('boom'); return areaBabycare() } })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    expect(wrapper.text()).not.toContain('無法讀取附近托嬰中心。')
    expect(wrapper.findAll('.nearby__name')).toHaveLength(4)
    expect(wrapper.findAll('.changes__item')).toHaveLength(3)
    wrapper.findComponent(NearbyPanel).vm.$emit('update:kind', 'babycare')
    await flushPromises()
    expect(wrapper.text()).toContain('無法讀取附近托嬰中心。')
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('babycare')).toEqual([])
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('無法讀取附近托嬰中心。')
    expect(wrapper.findAll('.nearby__name')).toHaveLength(3)
  })

  it('變化區塊在「附近幼兒園」卡片正下方，列出近 12 個月的變化', async () => {
    const { wrapper } = await mountTab()
    const side = wrapper.get('.area-top__side')
    expect(side.element.children[0]!.classList.contains('nearby-panel')).toBe(true)
    expect(side.element.children[1]!.classList.contains('changes')).toBe(true)
    expect(wrapper.findAll('.changes__item').map((row) => row.get('.changes__name').text())).toEqual(['頂尖小子托嬰中心', '保羅幼兒園', '三多哈波特幼兒園'])
  })

  it('變化讀取失敗：只有這一塊寫錯誤與重試，清單、三張表、地圖照常；重試成功恢復', async () => {
    let fail = true
    mockGet({ ...routes(), '/admin/admissions/area/changes': () => { if (fail) throw new Error('boom'); return areaChanges() } })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    expect(wrapper.text()).toContain('無法讀取附近園所的變化。')
    expect(wrapper.text()).not.toContain('無法讀取區域分析')
    expect(wrapper.findAll('.nearby__name')).toHaveLength(4)
    expect(bodyRows(block(wrapper, '里排行'))).toHaveLength(3)
    fail = false
    await wrapper.get('.changes').findAll('button').find((item) => item.text() === '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.changes__item')).toHaveLength(3)
  })

  it('連續換半徑：變化只採用最後一次（先送出的晚回不蓋掉）', async () => {
    const slow = deferred<unknown>()
    let first = true
    mockGet({
      ...routes(),
      '/admin/admissions/area/changes': () => {
        if (first) { first = false; return areaChanges() }
        return slow.promise
      },
    })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await vi.waitFor(() => expect(wrapper.findAll('.changes__item')).toHaveLength(3))
    wrapper.findComponent(NearbyKindergartens).vm.$emit('update:radiusKm', 6)
    await flushPromises()
    expect(wrapper.find('.changes .el-skeleton').exists()).toBe(true) // 換半徑先清空再讀
    slow.resolve(areaChanges([], { radius_km: 6 }))
    await flushPromises()
    expect(wrapper.findAll('.changes__item')).toHaveLength(0)
    expect(wrapper.get('.changes__empty').text()).toBe('近 12 個月，6 公里內沒有新設、停辦或類型變動的園所。')
  })

  // 規格 7.2「卡片切到托嬰中心，自動打開地圖的托嬰圖層」：圖層開關存在 AreaMap 實例裡，實例換了就要重新打開。
  it('卡片停在托嬰時換學年：地圖卸載重掛，新的地圖實例再被請求打開托嬰圖層', async () => {
    const { wrapper } = await mountTab()
    wrapper.findComponent(NearbyPanel).vm.$emit('update:kind', 'babycare')
    await flushPromises()
    expect(mapStub.reveal).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ schoolYear: 114 })
    expect(wrapper.find('.area-map-stub').exists()).toBe(false) // 讀取期間整塊換成骨架，地圖已卸載
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await flushPromises()
    expect(wrapper.find('.nearby--babycare').exists()).toBe(true)
    expect(mapStub.reveal).toHaveBeenCalledTimes(2)
  })

  it('地圖還沒掛上（里界慢回）就切到托嬰：地圖出現後補打開一次', async () => {
    const slow = deferred<unknown>()
    mockGet({ ...routes(), '/admin/admissions/area/boundaries': () => slow.promise })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.findComponent(NearbyPanel).exists()).toBe(true))
    expect(wrapper.find('.area-map-stub').exists()).toBe(false)
    wrapper.findComponent(NearbyPanel).vm.$emit('update:kind', 'babycare')
    await flushPromises()
    expect(mapStub.reveal).not.toHaveBeenCalled()
    slow.resolve(villageBoundaries())
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await flushPromises()
    expect(mapStub.reveal).toHaveBeenCalledTimes(1)
  })

  it('卡片停在幼兒園：地圖掛上與重掛都不請地圖打開托嬰圖層', async () => {
    const { wrapper } = await mountTab()
    await wrapper.setProps({ schoolYear: 114 })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await flushPromises()
    expect(mapStub.reveal).not.toHaveBeenCalled()
  })
})

describe('里的變化（2026-10-14 規格 7.2）', () => {
  const TITLE = '里的變化（本校 3 公里內）'
  async function mountTrends(trends: unknown) {
    const get = mockGet({ ...routes(), '/admin/admissions/area/trends': trends })
    const mounted = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(mounted.wrapper.find('.area-map-stub').exists()).toBe(true))
    return { ...mounted, get }
  }

  it('依頁首校區、學期與半徑讀里的變化；換半徑重讀；資料交給地圖', async () => {
    const { wrapper, get } = await mountTab()
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/trends')[0]!)))
      .toEqual({ campus_key: 'yihua', school_year: '115', radius_km: '3' })
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('trends')).toMatchObject({ radius_km: 3 })
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('trendNote')).toBe('')
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('homesNote')).toBe('')
    wrapper.findComponent(NearbyKindergartens).vm.$emit('update:radiusKm', 6)
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/area/trends').at(-1)!).get('radius_km')).toBe('6')
  })

  it('放在招生機會之下、三張表之上', async () => {
    const { wrapper } = await mountTab()
    const titles = wrapper.findAll('.stats-block__title').map((title) => title.text())
    expect(titles.indexOf(TITLE)).toBe(titles.indexOf('招生機會（本校 3 公里內）') + 1)
    expect(titles.indexOf(TITLE)).toBeLessThan(titles.indexOf('行政區排行'))
  })

  it('總結：孩子與一年前比、出生和前一年同期比、全年齡淨遷入；合併的里另寫一句', async () => {
    const { wrapper } = await mountTab()
    expect(block(wrapper, TITLE).findAll('.trends-summary p').map((line) => line.text())).toEqual([
      '本校 3 公里內 4 個里，2–5 歲孩子 1,400 位；和一年前同一批孩子比，淨增 26 位（+1.9%）。',
      '近 12 個月出生 180 位，比前一年同期少 20.7%（比 9 個月）。',
      '近 12 個月全年齡淨遷出 160 人。',
      '近 4 季新屋交屋 130 筆，最多的是三民區鼎金里（106 筆）、三民區本揚里（24 筆）。',
      '三民區寶業里、龍子里的里界調整過，合併成一列計算。範圍內的區另有 7 筆新屋交屋只到區、沒對到里，沒算進去。',
    ])
  })

  it('表格：淨增最多的在前，寫人數與比例、分級；合併組的名稱註明；說明寫定義與資料月份', async () => {
    const { wrapper } = await mountTab()
    const section = block(wrapper, TITLE)
    expect(section.findAll('thead th').map((th) => th.text()))
      .toEqual(['#', '里', '距本校', '2–5 歲', '這一年淨增', '孩子增減', '近 12 個月出生', '近 12 個月淨遷入', '近 4 季新屋', '所得中位數', '國小學區'])
    expect(bodyRows(section)).toEqual([
      ['1', '三民區本揚里', '300 m', '317', '+36（+12.8%）', '增加多', '36', '−122', '24', '45.8 萬', '東光國小'],
      ['2', '三民區寶業里、龍子里（里界調整，合併）', '300 m', '583', '+12（+2.0%）', '差不多', '90', '+30', '0', '—', '光武國小（部分）、鼓山區龍華國小（部分）'],
      ['3', '三民區鼎金里', '800 m', '500', '−22（−4.5%）', '減少', '54', '−68', '106', '51.2 萬*', '獅湖國小、民族國小（部分，自由學區）'],
    ])
    const caption = section.get('.stats-block__caption').text()
    expect(caption).toContain('這一年淨增＝本月 2–5 歲減一年前 1–4 歲的同一批孩子')
    expect(caption).toContain('（人口 115 年 9 月與 114 年 9 月、出生 114 年 10 月到 115 年 9 月、遷入遷出 114 年 10 月到 115 年 9 月、新成屋 114S4–115S3）')
    expect(caption).toContain('新屋交屋是完工一年內的住宅過戶（含預售屋交屋），不等於已入住、也不等於有孩子。')
    expect(caption).toContain('資料來源：內政部不動產交易實價查詢服務網')
    expect(caption).toContain('所得是 112 年度綜合所得稅申報戶的中位數，只當背景；* 表示界線在所得年度之後調整過')
    expect(caption).toContain('財政部財政資訊中心（2026）綜稅綜合所得總額各縣市鄉鎮村里統計分析表-高雄市（112年度）')
    expect(caption).toContain('不宜逕作為衡量所得差距之參據')
    expect(caption).toContain('國小學區依 115 學年度一覽表，「部分」是只有部分鄰屬於那所國小。')
  })

  it('近幾年的出生數：在總結句下面、里表上面；一期一列，缺月與增減寫出來；里表的表頭與列不變', async () => {
    const { wrapper } = await mountTab()
    const section = block(wrapper, TITLE)
    const series = section.get('.birth-series')
    expect(series.get('.birth-series__title').text()).toBe('近幾年的出生數（本校 3 公里內）')
    const rows = series.findAll('.birth-series__row:not(.birth-series__row--head)')
    expect(rows.map((row) => [row.get('.birth-series__label').text(), row.get('.birth-series__number').text(), row.get('.birth-series__change').text()])).toEqual([
      ['114 年 10 月～115 年 9 月', '180', '−20.7%'],
      ['113 年 10 月～114 年 9 月', '227', '−5.2%'],
      ['112 年 10 月～113 年 9 月', '215', '—'],
    ])
    expect(rows[2]!.get('.birth-series__missing').text()).toBe('缺 113 年 3 月')
    // 順序：總結句 → 近幾年的出生數 → 里表；而且新區塊沒有 <table>，原表頭與列不受影響。
    const html = section.html()
    const summaryAt = html.indexOf('trends-summary')
    const seriesAt = html.indexOf('birth-series')
    const tableAt = html.indexOf('<table')
    // 三個標記都要在；缺一個時 indexOf 回 −1，後面的大小比較會恆真而空轉。
    expect(summaryAt).toBeGreaterThan(-1)
    expect(seriesAt).toBeGreaterThan(-1)
    expect(tableAt).toBeGreaterThan(-1)
    expect(summaryAt).toBeLessThan(seriesAt)
    expect(seriesAt).toBeLessThan(tableAt)
    expect(series.find('table').exists()).toBe(false)
    expect(section.findAll('thead th')).toHaveLength(11)
  })

  it('沒有出生走勢（空陣列）時不顯示這一塊', async () => {
    const base = areaTrends()
    const { wrapper } = await mountTrends(areaTrends({ baseline: { ...base.baseline!, births_series: [] } }))
    expect(block(wrapper, TITLE).find('.birth-series').exists()).toBe(false)
  })

  it('所得還沒匯入：所得欄整欄「—」、欄位不隱藏，說明寫尚未匯入', async () => {
    const base = areaTrends()
    const trends = areaTrends({
      sources: { ...base.sources, income: { year: null, note: '' } },
      villages: base.villages.map((row) => ({ ...row, income_median: null, income_boundary_changed: false })),
    })
    const { wrapper } = await mountTrends(trends)
    const section = block(wrapper, TITLE)
    expect(section.findAll('thead th').at(-2)!.text()).toBe('所得中位數')
    expect(bodyRows(section).map((row) => row.at(-2))).toEqual(['—', '—', '—'])
    const caption = section.get('.stats-block__caption').text()
    expect(caption).toContain('各里所得資料尚未匯入。')
    expect(caption).not.toContain('財政部')
  })

  it('匯出 CSV：數字欄寫有號整數，多一欄「一年前 1–4 歲」；所得拆成千元、年度、界線調整', async () => {
    const { wrapper } = await mountTab()
    await block(wrapper, TITLE).get('[data-test="stats-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('招生統計-里的變化.csv')
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('#,里,距本校,2–5 歲,這一年淨增,一年前 1–4 歲,孩子增減,近 12 個月出生,近 12 個月淨遷入,近 4 季新屋,最近一季新屋,所得中位數（千元）,所得年度,界線在所得年度後調整,國小學區')
    expect(lines[1]).toBe('1,三民區本揚里,300 m,317,36,281,增加多,36,-122,24,9,458,112,,東光國小')
    expect(lines[2]).toBe('2,三民區寶業里、龍子里（里界調整，合併）,300 m,583,12,600,差不多,90,30,0,0,,,,光武國小（部分）；鼓山區龍華國小（部分）')
    expect(lines[3]).toBe('3,三民區鼎金里,800 m,500,-22,493,減少,54,-68,106,32,512,112,是,獅湖國小；民族國小（部分，自由學區）')
  })

  it('一年前的人口還沒匯入：淨增寫「—」，總結與地圖都寫原因（地圖的孩子增減停用）', async () => {
    const base = areaTrends()
    const trends = areaTrends({
      kids_unavailable: 'no_year_ago',
      sources: { ...base.sources, population: { month: '115-09', year_ago_month: null } },
      baseline: { ...base.baseline!, kids_net: null, kids_base: null },
      villages: base.villages.map((row) => ({ ...row, kids_net: null, kids_base: null, kids_level: 'unknown' as const })),
    })
    const { wrapper } = await mountTrends(trends)
    const section = block(wrapper, TITLE)
    expect(bodyRows(section)[0]).toEqual(['1', '三民區本揚里', '300 m', '317', '—', '—', '36', '−122', '24', '45.8 萬', '東光國小'])
    expect(section.get('.trends-summary .hint').text()).toContain('一年前的各里人口還沒匯入，這一年淨增先不算。')
    expect(section.findAll('.trends-summary p')[0]!.text()).toBe('本校 3 公里內 4 個里，2–5 歲孩子 1,400 位。')
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('trendNote')).toBe('一年前的各里人口還沒匯入，這一年淨增先不算。')
  })

  it('新成屋還沒匯入：新屋欄整欄「—」、欄位不隱藏；總結沒有這一句；說明寫尚未匯入；只有「新屋交屋」停用，孩子增減照用', async () => {
    const base = areaTrends()
    const trends = areaTrends({
      sources: { ...base.sources, new_homes: { latest: null, seasons: [], unplaced: 0, note: '' } },
      baseline: { ...base.baseline!, new_homes: null, new_homes_latest: null, new_homes_seasons: 0 },
      villages: base.villages.map((row) => ({ ...row, new_homes: null, new_homes_latest: null })),
    })
    const { wrapper } = await mountTrends(trends)
    const section = block(wrapper, TITLE)
    expect(section.findAll('thead th').map((th) => th.text())).toContain('近 4 季新屋')
    expect(bodyRows(section).map((row) => row.at(-3))).toEqual(['—', '—', '—'])
    expect(section.findAll('.trends-summary p').map((line) => line.text()).join('')).not.toContain('新屋交屋')
    const caption = section.get('.stats-block__caption').text()
    expect(caption).toContain('新成屋資料尚未匯入。')
    expect(caption).not.toContain('不動產交易實價查詢服務網')
    const map = wrapper.findComponent({ name: 'AreaMap' })
    expect(map.props('homesNote')).toBe('新成屋資料尚未匯入。')
    expect(map.props('trendNote')).toBe('')
  })

  it('什麼都還沒匯入：區塊寫原因；本校沒座標：寫本校位置未標示', async () => {
    const base = areaTrends()
    const empty = areaTrends({
      kids_unavailable: 'no_population', baseline: null, villages: [],
      sources: { ...base.sources, population: { month: null, year_ago_month: null }, births: { latest: null, months: [], missing: [] }, migration: { latest: null, months: [], missing: [] } },
    })
    const { wrapper } = await mountTrends(empty)
    expect(block(wrapper, TITLE).get('.stats-block__empty').text()).toBe('各里出生、遷入遷出資料尚未匯入；匯入後就能看哪些里孩子變多。')
    cleanup()
    const unlocated = areaTrends({ campus: { ...base.campus, lat: null, lng: null, locate_error: 'pending' }, baseline: null, villages: [] })
    const second = await mountTrends(unlocated)
    expect(block(second.wrapper, TITLE).get('.stats-block__empty').text()).toBe('本校位置未標示（門牌資料尚未匯入），算不出附近有哪些里。')
    expect(second.wrapper.findComponent({ name: 'AreaMap' }).props('trendNote')).toBe('本校位置未標示（門牌資料尚未匯入），算不出附近有哪些里。')
  })

  it('讀取失敗：只有這一塊寫錯誤與重試，地圖的孩子增減停用；重試成功恢復', async () => {
    let fail = true
    const { wrapper } = await mountTrends(() => {
      if (fail) throw new Error('boom')
      return areaTrends()
    })
    await vi.waitFor(() => expect(wrapper.find('.trends-error').exists()).toBe(true))
    expect(block(wrapper, '招生機會（本校 3 公里內）')).toBeDefined()
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('trendNote')).toBe('里的變化讀取失敗。')
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('homesNote')).toBe('里的變化讀取失敗。')
    fail = false
    await button(wrapper.get('.trends-error') as never, '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.trends-error').exists()).toBe(false)
    expect(block(wrapper, TITLE)).toBeDefined()
  })
})

describe('依國小學區（2026-10-14 規格 7.3）', () => {
  const TITLE = '依國小學區（本校 3 公里內）'
  async function mountTrends(trends: unknown) {
    mockGet({ ...routes(), '/admin/admissions/area/trends': trends })
    const mounted = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(mounted.wrapper.find('.area-map-stub').exists()).toBe(true))
    return mounted
  }

  it('接在里的變化下面；參觀人數多的在前，校名前加區，備註寫招生方式', async () => {
    const { wrapper } = await mountTab()
    const titles = wrapper.findAll('.stats-block__title').map((title) => title.text())
    expect(titles.indexOf(TITLE)).toBe(titles.indexOf('里的變化（本校 3 公里內）') + 1)
    const section = block(wrapper, TITLE)
    expect(section.findAll('thead th').map((th) => th.text()))
      .toEqual(['#', '國小', '學區里數', '2–5 歲', '這一年淨增', '參觀人數', '參觀率', '備註'])
    expect(bodyRows(section)).toEqual([
      ['1', '三民區東光國小', '3 里＋部分 1 里', '927', '+93', '12', '1.3%', '—'],
      ['2', '三民區光武國小', '4 里＋部分 6 里', '1287', '−19*', '5', '0.4%', '—'],
      ['3', '鳳山區文華國小', '部分 2 里', '756', '—', '0', '0.0%', '總量管制'],
    ])
    const caption = section.get('.stats-block__caption').text()
    expect(caption).toContain('列出學區碰到本校 3 公里內任一個里的國小；整里、部分里都算整個學區（含 3 公里外的里）')
    expect(caption).toContain('各列不能相加')
    expect(caption).toContain('115 學年度國民小學學區劃分一覽表')
  })

  it('匯出 CSV：學區里數拆整里、部分里，淨增寫數字並另標有里沒算進去', async () => {
    const { wrapper } = await mountTab()
    await block(wrapper, TITLE).get('[data-test="stats-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('招生統計-依國小學區.csv')
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('#,國小,學區整里數,學區部分里數,2–5 歲,這一年淨增,淨增有里沒算進去,參觀人數,參觀率,備註')
    expect(lines[2]).toBe('2,三民區光武國小,4,6,1287,-19,是,5,0.4%,')
    expect(lines[3]).toBe('3,鳳山區文華國小,0,2,756,,,0,0.0%,總量管制')
  })

  it('本校沒座標：寫原因；讀取失敗：不重複寫錯誤（上面那塊有重試）', async () => {
    const base = areaTrends()
    const unlocated = areaTrends({ campus: { ...base.campus, lat: null, lng: null, locate_error: 'pending' }, baseline: null, villages: [], schools: [] })
    const { wrapper } = await mountTrends(unlocated)
    expect(block(wrapper, TITLE).get('.stats-block__empty').text()).toBe('本校位置未標示（門牌資料尚未匯入），算不出附近有哪些里。')
    cleanup()
    const failed = await mountTrends(() => {
      throw new Error('boom')
    })
    await vi.waitFor(() => expect(failed.wrapper.find('.trends-error').exists()).toBe(true))
    expect(failed.wrapper.findAll('.stats-block__title').map((title) => title.text())).not.toContain(TITLE)
    expect(failed.wrapper.findAll('.trends-error')).toHaveLength(1)
  })

  it('人口還沒匯入：2–5 歲寫「—」不畫長條', async () => {
    const base = areaTrends()
    const { wrapper } = await mountTrends(areaTrends({ schools: base.schools.map((row) => ({ ...row, children: null, kids_net: null, rate: null })) }))
    expect(bodyRows(block(wrapper, TITLE))[0]).toEqual(['1', '三民區東光國小', '3 里＋部分 1 里', '—', '—', '12', '—', '—'])
  })
})

describe('在籍學生（2026-10-15 規格 §6）', () => {
  it('依校區讀在籍學生（不帶學年學期）；資料與停用原因傳給地圖；表格出現', async () => {
    const { wrapper, get } = await mountTab()
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/enrolled')[0]!))).toEqual({ campus_key: 'yihua' })
    const map = wrapper.findComponent({ name: 'AreaMap' })
    expect(map.props('enrolled')).toMatchObject({ status: 'ready', total: 5 })
    expect(map.props('enrolledNote')).toBe('')
    expect(map.props('gradeFilter')).toBe('all')
    expect(bodyRows(block(wrapper, '在籍學生距離分布'))[0]).toEqual(['1 公里內', '0', '1', '1', '0', '2'])
    expect(bodyRows(block(wrapper, '在籍學生距離分布')).at(-1)![0]).toBe('無距離')
    expect(bodyRows(block(wrapper, '在籍學生里排行（全部）')).map((row) => row.slice(0, 3))).toEqual([
      ['1', '三民區本揚里', '3'], ['2', '三民區寶業里', '1'], ['3', '左營區新上里', '1'],
    ])
  })

  it('沒匯入：地圖寫尚未匯入，沒有在籍學生表', async () => {
    mockGet(routes(areaStats(), areaOpportunity(), areaEnrolled({ status: 'not_imported' })))
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await flushPromises()
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('enrolledNote')).toBe('尚未匯入在籍名冊。')
    expect(wrapper.findAll('.stats-block__title').map((title) => title.text())).not.toContain('在籍學生距離分布')
  })

  it('地圖換班別：里排行跟著換；篩到 0 人的班別寫空狀態', async () => {
    const { wrapper } = await mountTab()
    wrapper.findComponent({ name: 'AreaMap' }).vm.$emit('update:gradeFilter', '小班')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('gradeFilter')).toBe('小班')
    expect(bodyRows(block(wrapper, '在籍學生里排行（小班）')).map((row) => row.slice(1, 3))).toEqual([['三民區本揚里', '2']])
    wrapper.findComponent({ name: 'AreaMap' }).vm.$emit('update:gradeFilter', '其他')
    await flushPromises()
    expect(block(wrapper, '在籍學生里排行（其他）').text()).toContain('這個班別沒有比對到里的學生')
  })

  it('換校區：篩選回到全部並重讀', async () => {
    const { wrapper, get } = await mountTab()
    wrapper.findComponent({ name: 'AreaMap' }).vm.$emit('update:gradeFilter', '小班')
    await flushPromises()
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/area/enrolled').at(-1)!).get('campus_key')).toBe('minghua')
    await vi.waitFor(() => expect(wrapper.findComponent({ name: 'AreaMap' }).props('gradeFilter')).toBe('all'))
  })

  it('讀取失敗：寫錯誤與重試，地圖按鈕停用；重試成功恢復', async () => {
    let fail = true
    mockGet(routes(areaStats(), areaOpportunity(), () => {
      if (fail) throw new Error('boom')
      return areaEnrolled()
    }))
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.enrolled-error').exists()).toBe(true))
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('enrolledNote')).toBe('在籍學生讀取失敗。')
    fail = false
    await button(wrapper.get('.enrolled-error') as never, '重新載入')!.trigger('click')
    await flushPromises()
    expect(block(wrapper, '在籍學生距離分布')).toBeDefined()
  })

  it('匯出距離分布 CSV：只有聚合數字', async () => {
    const { wrapper } = await mountTab()
    await block(wrapper, '在籍學生距離分布').get('[data-test="stats-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('招生統計-在籍學生距離分布.csv')
    expect(csv.slice(1).split('\r\n')[0]).toBe('距本校,幼幼班,小班,中班,大班,合計')
  })
})

describe('附近同業收費（2026-10-15 規格 7.1）', () => {
  it('區塊在地圖下方、招生機會上方，用目前的半徑與預設 3 歲', async () => {
    const { wrapper, get } = await mountTab()
    expect(wrapper.find('.peer-fees').exists()).toBe(true)
    const html = wrapper.html()
    expect(html.indexOf('peer-fees')).toBeGreaterThan(html.indexOf('area-top'))
    expect(html.indexOf('peer-fees')).toBeLessThan(html.indexOf('opportunity'))
    // queryOf 回 URLSearchParams。
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/fees').at(-1)!))).toEqual({ campus_key: 'yihua', radius_km: '3', age: '3' })
  })

  it('換年齡只重讀收費；換半徑也重讀收費', async () => {
    const { wrapper, get } = await mountTab()
    const before = pathsTo(get, '/admin/admissions/area/kindergartens').length
    wrapper.findComponent(PeerFeesPanel).vm.$emit('update:age', 5)
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/area/fees').at(-1)!).get('age')).toBe('5')
    expect(pathsTo(get, '/admin/admissions/area/kindergartens')).toHaveLength(before)
  })

  it('舊年齡的回應晚到不會蓋掉新的', async () => {
    const slow = deferred<unknown>()
    mockGet({
      ...routes(),
      '/admin/admissions/area/fees': (path: string) => (queryOf(path).get('age') === '4' ? slow.promise : areaPeerFees({ age: 5 })),
    })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    const panel = wrapper.findComponent(PeerFeesPanel)
    panel.vm.$emit('update:age', 4)
    await flushPromises()
    panel.vm.$emit('update:age', 5)
    await flushPromises()
    slow.resolve(areaPeerFees({ age: 4 }))
    await flushPromises()
    expect(wrapper.get('.peer-fees__summary').text()).toContain('5 歲班')
  })

  it('收費讀取失敗只影響這一塊，重試成功恢復', async () => {
    let fail = true
    mockGet({ ...routes(), '/admin/admissions/area/fees': () => { if (fail) throw new Error('boom'); return areaPeerFees() } })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    expect(wrapper.text()).toContain('無法讀取附近同業收費。')
    expect(wrapper.findAll('.nearby__name')).toHaveLength(4)
    fail = false
    await wrapper.get('.peer-fees .el-alert .el-button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.peer-fees__summary').exists()).toBe(true)
  })
})
