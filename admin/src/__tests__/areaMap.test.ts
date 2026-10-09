// 區域分析地圖（2026-10-08 規格 9.3）：Leaflet 整個 mock 掉，驗呼叫與參數；
// 元件用動態 import 載入 Leaflet，所以掛載後要等 import 完成才看得到地圖。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { areaKindergartens, areaStats, button, villageBoundaries } from './admissionsTestKit'

// any 只出現在 Leaflet 的 mock 物件上。
const leaflet = vi.hoisted(() => {
  type Handler = (payload?: unknown) => void
  const created: Record<string, any[]> = {}
  function layer(kind: string, extra: Record<string, unknown> = {}): any {
    const handlers: Record<string, Handler[]> = {}
    const self: any = {
      kind,
      fire: (event: string, payload?: unknown) => (handlers[event] ?? []).forEach((fn) => fn(payload)),
      on: vi.fn((event: string, fn: Handler) => { (handlers[event] ??= []).push(fn); return self }),
      addTo: vi.fn(() => self),
      remove: vi.fn(() => self),
      bindPopup: vi.fn(() => self),
      bindTooltip: vi.fn(() => self),
      openPopup: vi.fn(() => self),
      setRadius: vi.fn(() => self),
      redraw: vi.fn(() => self),
      bringToBack: vi.fn(() => self),
      addLayer: vi.fn(() => self),
      removeLayer: vi.fn(() => self),
      clearLayers: vi.fn(() => self),
      getBounds: vi.fn(() => ({ bounds: kind })),
      getLatLng: vi.fn(() => ({ lat: 22.6, lng: 120.3 })),
      ...extra,
    }
    ;(created[kind] ??= []).push(self)
    return self
  }
  const handler = () => ({ enable: vi.fn(), disable: vi.fn() })
  const module = {
    map: vi.fn((element: HTMLElement, options: Record<string, unknown>) => layer('map', {
      element, options, fitBounds: vi.fn(), setView: vi.fn(), getZoom: vi.fn(() => 13), invalidateSize: vi.fn(),
      dragging: handler(), touchZoom: handler(), attributionControl: { setPrefix: vi.fn() },
    })),
    tileLayer: vi.fn((url: string, options: Record<string, unknown>) => layer('tileLayer', { url, options })),
    geoJSON: vi.fn((data: unknown, options: Record<string, any>) => layer('geoJSON', { data, options })),
    marker: vi.fn((latlng: unknown, options: Record<string, unknown>) => layer('marker', { latlng, options })),
    circle: vi.fn((latlng: unknown, options: Record<string, unknown>) => layer('circle', { latlng, options })),
    circleMarker: vi.fn((latlng: unknown, options: Record<string, unknown>) => layer('circleMarker', { latlng, options })),
    layerGroup: vi.fn(() => layer('layerGroup')),
    divIcon: vi.fn((options: Record<string, unknown>) => ({ divIcon: options })),
    latLng: vi.fn((lat: number, lng: number) => ({ lat, lng, toBounds: (meters: number) => ({ center: [lat, lng], meters }) })),
  }
  return { created, module, reset: () => { for (const key of Object.keys(created)) delete created[key] } }
})
vi.mock('leaflet', () => leaflet.module)
vi.mock('leaflet/dist/leaflet.css', () => ({}))
// 模擬「Leaflet 的程式碼檔載不下來」：動態載入樣式檔時丟錯（vi.doMock 會換掉已快取的結果）。
// 每次換完都先 import 一次讓登記生效：連續兩次 doMock 同一個路徑時，後登記的不一定後生效。
let chunkBroken = false
async function chunkFails() {
  chunkBroken = true
  vi.doMock('leaflet/dist/leaflet.css', () => { throw new Error('Failed to fetch dynamically imported module') })
  await import('leaflet/dist/leaflet.css').catch(() => undefined)
}
async function chunkLoads() {
  chunkBroken = false
  vi.doMock('leaflet/dist/leaflet.css', () => ({}))
  await import('leaflet/dist/leaflet.css')
}
import AreaMap from '../components/admissions/area/AreaMap.vue'

const wrappers: VueWrapper[] = []
beforeEach(() => leaflet.reset())
afterEach(async () => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  if (chunkBroken) await chunkLoads()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

// 等動態 import 完成，再讓元件跑完 onMounted 之後的更新。
async function settle() {
  await vi.dynamicImportSettled()
  await flushPromises()
}

const baseProps = () => ({
  boundaries: villageBoundaries(),
  villages: areaStats().villages,
  campus: areaStats().campus,
  campusName: '義華',
  kindergartens: areaKindergartens().items,
  radiusKm: 3,
  narrow: false,
})
async function mountMap(changes: Record<string, unknown> = {}): Promise<VueWrapper> {
  const wrapper = mount(AreaMap, { props: { ...baseProps(), ...changes } as never, attachTo: document.body, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  await settle()
  return wrapper
}
const one = (kind: string): any => leaflet.created[kind]![0]
const feature = (town: string, village: string) => ({ properties: { TOWNNAME: town, VILLNAME: village, VILLCODE: '' } })

describe('區域分析地圖（2026-10-08）', () => {
  it('底圖是國土測繪電子地圖並標出處；滾輪不縮放；里界依參觀人數分 5 級（0 筆是 0 級）', async () => {
    await mountMap()
    expect(one('map').options).toMatchObject({ scrollWheelZoom: false, dragging: true, touchZoom: true })
    expect(one('tileLayer').url).toBe('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}')
    expect(one('tileLayer').options.attribution).toBe('© 國土測繪中心')
    const { data, options } = one('geoJSON')
    expect(data).toEqual(villageBoundaries())
    const className = (town: string, village: string) => options.style(feature(town, village)).className
    expect(className('三民區', '本揚里')).toBe('area-village area-village--l5')
    expect(className('三民區', '寶業里')).toBe('area-village area-village--l2')
    expect(className('三民區', '鼎金里')).toBe('area-village area-village--l0')
    expect(one('geoJSON').bringToBack).toHaveBeenCalled()
  })

  it('圖例：每一級的人數，和分級一致', async () => {
    const wrapper = await mountMap()
    expect(wrapper.findAll('.area-legend--levels li').map((item) => item.text())).toEqual(['1 人', '2 人', '3 人'])
    expect(wrapper.findAll('.area-legend--levels .area-swatch').map((item) => item.classes().at(-1))).toEqual(['area-swatch--l2', 'area-swatch--l4', 'area-swatch--l5'])
  })

  it('初始視野：本校為中心 12 公里見方；本校沒定位時看整個里界、不畫星號與半徑', async () => {
    await mountMap()
    expect(one('map').fitBounds).toHaveBeenCalledWith({ center: [22.642456, 120.343713], meters: 12000 })
    leaflet.reset()
    await mountMap({ campus: { key: 'yihua', name: '義華', lat: null, lng: null, locate_error: 'no_doorplate' } })
    expect(one('map').fitBounds).toHaveBeenCalledWith({ bounds: 'geoJSON' })
    expect(leaflet.created.marker).toBeUndefined()
    expect(leaflet.created.circle).toBeUndefined()
  })

  it('本校有座標時先取視野、再加里界、半徑圓與幼兒園點（真 Leaflet 沒有視野時把加圖層排到 load，向量 renderer 還沒初始化會丟錯）', async () => {
    await mountMap()
    const viewAt = one('map').fitBounds.mock.invocationCallOrder[0]
    for (const draw of [leaflet.module.geoJSON, leaflet.module.circle, leaflet.module.circleMarker]) {
      expect(draw.mock.invocationCallOrder[0], '圖層在取視野之前就加了').toBeGreaterThan(viewAt)
    }
  })

  it('本校用星號（divIcon，不載預設圖示檔）；半徑虛線圓跟著清單的半徑', async () => {
    const wrapper = await mountMap()
    expect(one('marker').options).toMatchObject({ title: '義華', alt: '義華', keyboard: false })
    expect(leaflet.module.divIcon).toHaveBeenCalledWith(expect.objectContaining({ className: 'area-campus', iconSize: [28, 28] }))
    expect(one('circle').options).toMatchObject({ radius: 3000, className: 'area-radius', fill: false, interactive: false })
    await wrapper.setProps({ radiusKm: 6 })
    expect(one('circle').setRadius).toHaveBeenCalledWith(6000)
  })

  it('幼兒園依類型上色、本機構另一色；開關收起整組，類型圖例跟著收', async () => {
    const wrapper = await mountMap()
    expect(leaflet.created.circleMarker!.map((marker) => marker.options.className)).toEqual([
      'area-kg area-kg--own', 'area-kg area-kg--public', 'area-kg area-kg--quasi_public', 'area-kg area-kg--nonprofit',
    ])
    const group = one('layerGroup')
    expect(group.addLayer).toHaveBeenCalledTimes(4)
    expect(wrapper.text()).toContain('非營利')
    wrapper.findComponent({ name: 'ElSwitch' }).vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(one('map').removeLayer).toHaveBeenCalledWith(group)
    expect(wrapper.text()).not.toContain('非營利')
    expect(wrapper.find('[aria-label="在地圖上顯示幼兒園"]').exists()).toBe(true)
  })

  it('換了幼兒園清單（半徑變了）整組重畫', async () => {
    const wrapper = await mountMap()
    await wrapper.setProps({ kindergartens: areaKindergartens().items.slice(0, 2) })
    expect(one('layerGroup').clearLayers).toHaveBeenCalled()
    expect(leaflet.created.circleMarker).toHaveLength(6)
  })

  it('點里：彈出框寫參觀、預繳與預繳率，「查看明細」回報該里；沒有參觀的里不給連結；桌機 hover 顯示里名', async () => {
    const wrapper = await mountMap()
    const { options } = one('geoJSON')
    const village = { bindPopup: vi.fn(), bindTooltip: vi.fn() }
    options.onEachFeature(feature('三民區', '本揚里'), village)
    const content = village.bindPopup.mock.calls[0]![0]() as HTMLElement
    expect(content.textContent).toContain('三民區本揚里')
    expect(content.textContent).toContain('參觀 3・預繳 1（33.3%）')
    content.querySelector('button')!.click()
    expect(wrapper.emitted('open-area')).toEqual([[{ district: '三民區', village: '本揚里' }]])
    // Leaflet 的字串內容走 innerHTML，所以里名要給文字節點。
    const tooltip = village.bindTooltip.mock.calls[0]![0] as HTMLElement
    expect(tooltip).toBeInstanceOf(HTMLElement)
    expect(tooltip.textContent).toBe('三民區本揚里')
    expect(village.bindTooltip.mock.calls[0]![1]).toMatchObject({ sticky: true })
    const empty = { bindPopup: vi.fn(), bindTooltip: vi.fn() }
    options.onEachFeature(feature('三民區', '鼎金里'), empty)
    const emptyContent = empty.bindPopup.mock.calls[0]![0]() as HTMLElement
    expect(emptyContent.textContent).toContain('這個範圍沒有參觀')
    expect(emptyContent.querySelector('button')).toBeNull()
  })

  it('里名含標籤字樣：提示與彈出框都當文字，不變成標記', async () => {
    await mountMap()
    const hostile = feature('<img src=x onerror=alert(1)>區', '<b>里</b>')
    const village = { bindPopup: vi.fn(), bindTooltip: vi.fn() }
    one('geoJSON').options.onEachFeature(hostile, village)
    const tooltip = village.bindTooltip.mock.calls[0]![0] as HTMLElement
    expect(tooltip.textContent).toBe('<img src=x onerror=alert(1)>區<b>里</b>')
    expect(tooltip.querySelector('img, b')).toBeNull()
    const popup = village.bindPopup.mock.calls[0]![0]() as HTMLElement
    expect(popup.textContent).toContain('<img src=x onerror=alert(1)>區<b>里</b>')
    expect(popup.querySelector('img, b')).toBeNull()
  })

  it('里的參觀人數變了：整層重畫（class 只在建立時套用）', async () => {
    const wrapper = await mountMap()
    await wrapper.setProps({ villages: [] })
    expect(one('geoJSON').remove).toHaveBeenCalled()
    expect(leaflet.created.geoJSON).toHaveLength(2)
  })

  it('focusKindergarten：地圖移到該園並打開資訊；圖層收起時先打開', async () => {
    const wrapper = await mountMap()
    wrapper.findComponent({ name: 'ElSwitch' }).vm.$emit('update:modelValue', false)
    await flushPromises()
    ;(wrapper.vm as unknown as { focusKindergarten: (id: string) => void }).focusKindergarten('kg-public')
    const marker = leaflet.created.circleMarker![1]
    expect(one('map').addLayer).toHaveBeenCalledWith(one('layerGroup'))
    expect(one('map').setView).toHaveBeenCalledWith({ lat: 22.6, lng: 120.3 }, 15)
    expect(marker.openPopup).toHaveBeenCalled()
  })

  it('手機：預設不攔單指捲動（不能拖曳縮放、不綁 hover 里名），「移動地圖」才打開，「完成」收回', async () => {
    const wrapper = await mountMap({ narrow: true })
    expect(one('map').options).toMatchObject({ dragging: false, touchZoom: false })
    const village = { bindPopup: vi.fn(), bindTooltip: vi.fn() }
    one('geoJSON').options.onEachFeature(feature('三民區', '本揚里'), village)
    expect(village.bindTooltip).not.toHaveBeenCalled()
    await button(wrapper, '移動地圖')!.trigger('click')
    expect(one('map').dragging.enable).toHaveBeenCalled()
    expect(one('map').touchZoom.enable).toHaveBeenCalled()
    await button(wrapper, '完成')!.trigger('click')
    expect(one('map').dragging.disable).toHaveBeenCalled()
    expect(one('map').touchZoom.disable).toHaveBeenCalled()
  })

  it('手機：底圖圖磚失敗時「完成」還在，已經打開的拖曳可以收回', async () => {
    const wrapper = await mountMap({ narrow: true })
    await button(wrapper, '移動地圖')!.trigger('click')
    const tiles = one('tileLayer')
    for (let index = 0; index < 4; index++) tiles.fire('tileerror')
    await flushPromises()
    expect(wrapper.text()).toContain('底圖載入失敗。')
    await button(wrapper, '完成')!.trigger('click')
    expect(one('map').dragging.disable).toHaveBeenCalled()
    expect(one('map').touchZoom.disable).toHaveBeenCalled()
  })

  it('refetch 換了校區物件但座標沒動：不重設視野；座標動了才重設', async () => {
    const wrapper = await mountMap()
    const map = one('map')
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ campus: { ...areaStats().campus }, villages: [...areaStats().villages], kindergartens: [...areaKindergartens().items] })
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    expect(map.setView).not.toHaveBeenCalled()
    expect(leaflet.created.marker).toHaveLength(1)
    await wrapper.setProps({ campus: { ...areaStats().campus, lat: 22.663189, lng: 120.306301 } })
    expect(map.fitBounds).toHaveBeenCalledTimes(2)
    expect(map.fitBounds).toHaveBeenLastCalledWith({ center: [22.663189, 120.306301], meters: 12000 })
    expect(leaflet.created.marker).toHaveLength(2)
  })

  describe('容器尺寸（子分頁切走又切回）', () => {
    type Observed = { width: number; height: number }
    // 假的 ResizeObserver：記下 callback，測試手動餵 0×0 與有尺寸的 contentRect。
    function stubResizeObserver() {
      const state = { notify: (_box: Observed) => {}, disconnect: vi.fn<() => void>() }
      vi.stubGlobal('ResizeObserver', class {
        constructor(callback: (entries: { contentRect: Observed }[]) => void) {
          state.notify = (box) => callback([{ contentRect: box }])
        }
        observe() {}
        disconnect() { state.disconnect() }
      })
      return state
    }

    it('藏著的時候建圖（0×0）：容器變回有尺寸時重新取景；之後一般的縮放不重設使用者的視野', async () => {
      const observer = stubResizeObserver()
      await mountMap()
      const map = one('map')
      expect(map.fitBounds).toHaveBeenCalledTimes(1)

      observer.notify({ width: 640, height: 420 })
      expect(map.invalidateSize).toHaveBeenCalledTimes(1)
      expect(map.fitBounds).toHaveBeenCalledTimes(2)
      expect(map.fitBounds).toHaveBeenLastCalledWith({ center: [22.642456, 120.343713], meters: 12000 })

      observer.notify({ width: 800, height: 420 })
      expect(map.invalidateSize).toHaveBeenCalledTimes(2)
      expect(map.fitBounds).toHaveBeenCalledTimes(2)

      observer.notify({ width: 0, height: 0 })
      expect(map.fitBounds).toHaveBeenCalledTimes(2)
      observer.notify({ width: 640, height: 420 })
      expect(map.fitBounds).toHaveBeenCalledTimes(3)
    })

    it('建圖時容器已經有尺寸：第一次通知不重新取景', async () => {
      const observer = stubResizeObserver()
      const width = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(640)
      const height = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(420)
      try {
        await mountMap()
        const map = one('map')
        observer.notify({ width: 640, height: 420 })
        expect(map.invalidateSize).toHaveBeenCalledTimes(1)
        expect(map.fitBounds).toHaveBeenCalledTimes(1)
      } finally {
        width.mockRestore()
        height.mockRestore()
      }
    })

    it('卸載時停止觀察', async () => {
      const observer = stubResizeObserver()
      const wrapper = await mountMap()
      wrapper.unmount()
      wrappers.pop()
      expect(observer.disconnect).toHaveBeenCalledTimes(1)
    })
  })

  it('桌機沒有「移動地圖」鈕', async () => {
    const wrapper = await mountMap()
    expect(button(wrapper, '移動地圖')).toBeUndefined()
  })

  it('圖磚連續失敗且一張都沒載到：顯示「底圖載入失敗」與重試，重試重畫圖磚', async () => {
    const wrapper = await mountMap()
    const tiles = one('tileLayer')
    for (let index = 0; index < 4; index++) tiles.fire('tileerror')
    await flushPromises()
    expect(wrapper.text()).toContain('底圖載入失敗。')
    await button(wrapper, '重試')!.trigger('click')
    expect(tiles.redraw).toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('底圖載入失敗。')
  })

  it('載到過圖磚：偶發失敗不跳錯誤', async () => {
    const wrapper = await mountMap()
    const tiles = one('tileLayer')
    tiles.fire('tileload')
    for (let index = 0; index < 6; index++) tiles.fire('tileerror')
    await flushPromises()
    expect(wrapper.text()).not.toContain('底圖載入失敗。')
  })

  it('底圖壞掉之後又載到圖磚：提示自己消失', async () => {
    const wrapper = await mountMap()
    const tiles = one('tileLayer')
    for (let index = 0; index < 4; index++) tiles.fire('tileerror')
    await flushPromises()
    expect(wrapper.text()).toContain('底圖載入失敗。')
    tiles.fire('tileload')
    await flushPromises()
    expect(wrapper.text()).not.toContain('底圖載入失敗。')
  })

  it('卸載時移除地圖', async () => {
    const wrapper = await mountMap()
    const map = one('map')
    wrapper.unmount()
    wrappers.length = 0
    expect(map.remove).toHaveBeenCalled()
  })

  it('Leaflet 還在下載時就離開：載完也不建地圖', async () => {
    const wrapper = mount(AreaMap, { props: baseProps() as never, attachTo: document.body, global: { plugins: [ElementPlus] } })
    expect(wrapper.text()).toContain('地圖載入中')
    wrapper.unmount()
    await settle()
    expect(leaflet.created.map).toBeUndefined()
  })
})

describe('Leaflet 載入失敗（動態載入）', () => {
  it('程式碼檔載不下來：顯示「地圖載入失敗」與重試，重試成功就建出地圖', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await chunkFails()
    const wrapper = await mountMap()
    expect(leaflet.created.map).toBeUndefined()
    expect(logged).toHaveBeenCalledWith('[AreaMap] 地圖建立失敗', expect.any(Error))
    expect(wrapper.text()).toContain('地圖載入失敗')
    expect(wrapper.text()).not.toContain('地圖載入中')
    await chunkLoads()
    await button(wrapper, '重試')!.trigger('click')
    await settle()
    expect(one('map')).toBeDefined()
    expect(wrapper.text()).not.toContain('地圖載入失敗')
    expect(button(wrapper, '重試')).toBeUndefined()
    logged.mockRestore()
  })

  it('手機：Leaflet 本身載不下來時沒有「移動地圖」鈕（沒有地圖可移動）', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await chunkFails()
    const wrapper = await mountMap({ narrow: true })
    expect(wrapper.text()).toContain('地圖載入失敗')
    expect(button(wrapper, '移動地圖')).toBeUndefined()
    expect(button(wrapper, '完成')).toBeUndefined()
    logged.mockRestore()
  })

  it('建到一半丟錯（地圖已建出來）：移除半成品、記錄錯誤、顯示失敗，重試後只剩一張活的地圖', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = new Error('tile layer failed')
    leaflet.module.tileLayer.mockImplementationOnce(() => { throw boom })
    const wrapper = await mountMap()
    const [first] = leaflet.created.map!
    expect(first.remove).toHaveBeenCalledTimes(1)
    expect(logged).toHaveBeenCalledWith('[AreaMap] 地圖建立失敗', boom)
    expect(wrapper.text()).toContain('地圖載入失敗')
    await button(wrapper, '重試')!.trigger('click')
    await settle()
    const maps = leaflet.created.map!
    expect(maps).toHaveLength(2)
    expect(first.remove).toHaveBeenCalledTimes(1)
    expect(maps[1].remove).not.toHaveBeenCalled()
    expect(maps.filter((created: { remove: { mock: { calls: unknown[] } } }) => created.remove.mock.calls.length === 0)).toHaveLength(1)
    expect(wrapper.text()).not.toContain('地圖載入失敗')
    logged.mockRestore()
  })

  it('清半成品時也丟錯：照樣顯示失敗、可重試', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    leaflet.module.tileLayer.mockImplementationOnce(() => {
      leaflet.created.map![0].remove.mockImplementationOnce(() => { throw new Error('remove failed') })
      throw new Error('tile layer failed')
    })
    const wrapper = await mountMap()
    expect(wrapper.text()).toContain('地圖載入失敗')
    expect(logged).toHaveBeenCalledWith('[AreaMap] 清除未完成的地圖失敗', expect.any(Error))
    await button(wrapper, '重試')!.trigger('click')
    await settle()
    expect(leaflet.created.map).toHaveLength(2)
    expect(wrapper.text()).not.toContain('地圖載入失敗')
    logged.mockRestore()
  })

  it('原始碼：只用動態 import 載入 Leaflet 與它的樣式，不寫顏色字面值', () => {
    const source = readFileSync(join(__dirname, '../components/admissions/area/AreaMap.vue'), 'utf8')
    expect(source).toContain("import('leaflet')")
    expect(source).toContain("import('leaflet/dist/leaflet.css')")
    expect(source.match(/^\s*import\b[^\n]*['"]leaflet[^'"]*['"]/gm) ?? []).toEqual(["import type * as Leaflet from 'leaflet'"])
    const style = source.slice(source.indexOf('<style'))
    expect(style).not.toMatch(/rgba?\(|oklch\(|hsla?\(|#[0-9a-f]{3,8}\b/i)
  })
})

describe('本校沒標在地圖上的原因（主控裁定 R8）', () => {
  const lost = (locate_error: string | null) => ({ campus: { key: 'yihua', name: '義華', lat: null, lng: null, locate_error } })

  it.each([
    ['no_address', '找不到本校地址'],
    ['pending', '門牌資料尚未匯入'],
    ['no_doorplate', '本校地址比對不到門牌'],
  ])('%s → %s', async (error, text) => {
    const wrapper = await mountMap(lost(error))
    expect(wrapper.get('.area-map__campus-note').text()).toContain(text)
  })

  it('有定位就不寫', async () => {
    const wrapper = await mountMap()
    expect(wrapper.find('.area-map__campus-note').exists()).toBe(false)
  })

  it('校區之後才定位到：星號與半徑補畫、提示消失', async () => {
    const wrapper = await mountMap(lost('pending'))
    expect(leaflet.created.marker).toBeUndefined()
    await wrapper.setProps({ campus: areaStats().campus })
    expect(leaflet.created.marker).toHaveLength(1)
    expect(leaflet.created.circle).toHaveLength(1)
    expect(wrapper.find('.area-map__campus-note').exists()).toBe(false)
  })
})
