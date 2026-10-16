// 區域分析地圖（2026-10-08 規格 9.3）：Leaflet 整個 mock 掉，驗呼叫與參數；
// 元件用動態 import 載入 Leaflet，所以掛載後要等 import 完成才看得到地圖。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import {
  areaBabycare, areaEnrolled, areaKindergartens, areaOpportunity, areaStats, areaTrends, babycareItem, button, villageBoundaries,
} from './admissionsTestKit'

// any 只出現在 Leaflet 的 mock 物件上。
const leaflet = vi.hoisted(() => {
  type Handler = (payload?: unknown) => void
  const created: Record<string, any[]> = {}
  function layer(kind: string, extra: Record<string, unknown> = {}): any {
    const handlers: Record<string, Handler[]> = {}
    const self: any = {
      kind,
      handlers,
      fire: (event: string, payload?: unknown) => (handlers[event] ?? []).forEach((fn) => fn(payload)),
      on: vi.fn((event: string, fn: Handler) => { (handlers[event] ??= []).push(fn); return self }),
      off: vi.fn((event: string, fn: Handler) => { handlers[event] = (handlers[event] ?? []).filter((item) => item !== fn); return self }),
      addTo: vi.fn(() => self),
      remove: vi.fn(() => self),
      bindPopup: vi.fn(() => self),
      bindTooltip: vi.fn(() => self),
      openPopup: vi.fn(() => self),
      setRadius: vi.fn(() => self),
      redraw: vi.fn(() => self),
      bringToBack: vi.fn(() => self),
      bringToFront: vi.fn(() => self),
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
  // 真 Leaflet 把 _leaflet_id 記在容器上、remove() 才清掉；容器上還有 id 時再建地圖會丟 "Map container is already initialized."。
  let containerCounter = 0
  const module = {
    map: vi.fn((element: HTMLElement & { _leaflet_id?: number }, options: Record<string, unknown>) => {
      if (element._leaflet_id) throw new Error('Map container is already initialized.')
      element._leaflet_id = ++containerCounter
      // createPane 回傳的就是真 Leaflet 的 pane 元素：測試只看 style 與建立順序，記在 panes 上。
      const panes: Record<string, { style: Record<string, string> }> = {}
      return layer('map', {
        element, options, fitBounds: vi.fn(), setView: vi.fn(), getZoom: vi.fn(() => 13), invalidateSize: vi.fn(),
        dragging: handler(), touchZoom: handler(), attributionControl: { setPrefix: vi.fn() },
        panes,
        createPane: vi.fn((name: string) => (panes[name] = { style: {} })),
        // 可視範圍：預設什麼都不在裡面（focusVillage 要 panTo）；測試用 mockReturnValue 換成包含。
        getBounds: vi.fn(() => ({ contains: vi.fn(() => false) })),
        panTo: vi.fn(),
        remove: vi.fn(() => { delete element._leaflet_id }),
      })
    }),
    tileLayer: vi.fn((url: string, options: Record<string, unknown>) => layer('tileLayer', { url, options })),
    // 里界圖層：每個 feature 一個子圖形，像真 Leaflet 的 SVG renderer 一樣在建立時把 className 與 leaflet-interactive
    // 掛到 <path> 上（之後 setStyle 不會再動 class），eachLayer 逐一走過。
    // style 可以是函式（里界：每個 feature 一個 class）或物件（選取外框）；單一 Feature（外框）沒有子圖形。
    geoJSON: vi.fn((data: { features?: unknown[] } | undefined, options: Record<string, any>) => {
      const children = (data?.features ?? []).map((feature: any) => {
        const style = typeof options.style === 'function' ? options.style(feature) : options.style
        const className: string = style?.className ?? ''
        const element = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        element.setAttribute('class', `${className} leaflet-interactive`)
        const handlers: Record<string, Handler[]> = {}
        return {
          feature,
          options: { className },
          getElement: () => element,
          handlers,
          on: vi.fn((event: string, fn: Handler) => { (handlers[event] ??= []).push(fn) }),
          // 每個里一個範圍；getCenter 讓 panTo 的參數看得出是哪個里。
          getBounds: vi.fn(() => ({ village: feature.properties.VILLCODE, getCenter: () => ({ centerOf: feature.properties.VILLCODE }) })),
        }
      })
      return layer('geoJSON', { data, options, children, eachLayer: vi.fn((fn: (child: unknown) => void) => children.forEach(fn)) })
    }),
    marker: vi.fn((latlng: unknown, options: Record<string, unknown>) => layer('marker', { latlng, options })),
    circle: vi.fn((latlng: unknown, options: Record<string, unknown>) => layer('circle', { latlng, options })),
    circleMarker: vi.fn((latlng: unknown, options: Record<string, unknown>) => layer('circleMarker', { latlng, options })),
    // 圖層群組記住加進來的子圖層（eachLayer 逐一走過），clearLayers 清空；呼叫次數照舊記在 vi.fn 上。
    layerGroup: vi.fn(() => {
      const group = layer('layerGroup')
      const members: unknown[] = []
      group.addLayer = vi.fn((child: unknown) => { members.push(child); return group })
      group.clearLayers = vi.fn(() => { members.length = 0; return group })
      group.eachLayer = vi.fn((fn: (child: unknown) => void) => { members.forEach(fn); return group })
      return group
    }),
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
  mode: 'visits',
})
async function mountMap(changes: Record<string, unknown> = {}): Promise<VueWrapper> {
  const wrapper = mount(AreaMap, { props: { ...baseProps(), ...changes } as never, attachTo: document.body, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  await settle()
  return wrapper
}
const one = (kind: string): any => leaflet.created[kind]![0]
const feature = (town: string, village: string, code = '') => ({ properties: { TOWNNAME: town, VILLNAME: village, VILLCODE: code } })
// onEachFeature 收到的圖層：記下 click 處理函式，測試手動觸發（真 Leaflet 的點擊走 layer.on('click')）。
function villageLayerStub() {
  const handlers: Record<string, Array<() => void>> = {}
  return {
    bindPopup: vi.fn(),
    bindTooltip: vi.fn(),
    on: vi.fn((event: string, fn: () => void) => { (handlers[event] ??= []).push(fn) }),
    click: () => (handlers.click ?? []).forEach((fn) => fn()),
  }
}

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

  it('初始視野：本校為中心、剛好框住半徑圈（留邊）；換半徑時視野跟著框住新的圈', async () => {
    const wrapper = await mountMap()
    const map = one('map')
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    expect(map.fitBounds).toHaveBeenCalledWith({ center: [22.642456, 120.343713], meters: 6000 }, { padding: [24, 24] })
    await wrapper.setProps({ radiusKm: 1 })
    expect(map.fitBounds).toHaveBeenLastCalledWith({ center: [22.642456, 120.343713], meters: 2000 }, { padding: [24, 24] })
    await wrapper.setProps({ radiusKm: 6 })
    expect(map.fitBounds).toHaveBeenLastCalledWith({ center: [22.642456, 120.343713], meters: 12000 }, { padding: [24, 24] })
    expect(map.fitBounds).toHaveBeenCalledTimes(3)
  })

  it('本校沒座標：框住校址所在的行政區（先取視野再加圖層），不畫星號與半徑；換半徑不動視野', async () => {
    const wrapper = await mountMap({ campus: { key: 'yihua', name: '義華', lat: null, lng: null, locate_error: 'pending', district: '三民區' } })
    const map = one('map')
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    expect(map.fitBounds).toHaveBeenCalledWith([[22.64, 120.34], [22.65, 120.35]])
    expect(leaflet.module.geoJSON.mock.invocationCallOrder[0]).toBeGreaterThan(map.fitBounds.mock.invocationCallOrder[0])
    expect(leaflet.created.marker).toBeUndefined()
    expect(leaflet.created.circle).toBeUndefined()
    await wrapper.setProps({ radiusKm: 6 })
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['沒有行政區', null],
    ['行政區不在里界檔裡', '旗津區'],
  ])('本校沒座標、%s：才退回整個里界', async (_label, district) => {
    await mountMap({ campus: { key: 'yihua', name: '義華', lat: null, lng: null, locate_error: 'no_address', district } })
    expect(one('map').fitBounds).toHaveBeenCalledTimes(1)
    expect(one('map').fitBounds).toHaveBeenCalledWith({ bounds: 'geoJSON' })
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

  it('點里：發出 select-village（代碼、區名、里名），不綁 popup；桌機 hover 顯示里名', async () => {
    const wrapper = await mountMap()
    const village = villageLayerStub()
    one('geoJSON').options.onEachFeature(feature('三民區', '本揚里', '64000050015'), village)
    expect(village.bindPopup).not.toHaveBeenCalled()
    expect(wrapper.emitted('select-village')).toBeUndefined()
    village.click()
    expect(village.on).toHaveBeenCalledWith('click', expect.any(Function))
    expect(wrapper.emitted('select-village')).toEqual([[{ code: '64000050015', district: '三民區', village: '本揚里' }]])
    // 已選取的里再點一次不取消：照樣發出同一個事件。
    village.click()
    expect(wrapper.emitted('select-village')).toHaveLength(2)
    // Leaflet 的字串內容走 innerHTML，所以里名要給文字節點。
    const tooltip = village.bindTooltip.mock.calls[0]![0] as HTMLElement
    expect(tooltip).toBeInstanceOf(HTMLElement)
    expect(tooltip.textContent).toBe('三民區本揚里')
    expect(village.bindTooltip.mock.calls[0]![1]).toMatchObject({ sticky: true })
  })

  it('里名含標籤字樣：提示當文字，不變成標記', async () => {
    await mountMap()
    const hostile = feature('<img src=x onerror=alert(1)>區', '<b>里</b>')
    const village = villageLayerStub()
    one('geoJSON').options.onEachFeature(hostile, village)
    const tooltip = village.bindTooltip.mock.calls[0]![0] as HTMLElement
    expect(tooltip.textContent).toBe('<img src=x onerror=alert(1)>區<b>里</b>')
    expect(tooltip.querySelector('img, b')).toBeNull()
  })

  // 圖形的 class：子圖形的 <path> 上除了 leaflet-interactive 以外的 class。
  const pathClass = (town: string, village: string) => {
    const child = one('geoJSON').children.find((item: any) => item.feature.properties.TOWNNAME === town && item.feature.properties.VILLNAME === village)
    return [...child.getElement().classList].filter((name: string) => name !== 'leaflet-interactive').join(' ')
  }

  it('里的參觀人數變了：不重建圖層，只換各里圖形的 class（保留 leaflet-interactive，options 一起改）', async () => {
    const wrapper = await mountMap()
    expect(pathClass('三民區', '本揚里')).toBe('area-village area-village--l5')
    await wrapper.setProps({ villages: [] })
    expect(leaflet.created.geoJSON).toHaveLength(1)
    expect(one('geoJSON').remove).not.toHaveBeenCalled()
    expect(pathClass('三民區', '本揚里')).toBe('area-village area-village--l0')
    expect(pathClass('三民區', '寶業里')).toBe('area-village area-village--l0')
    const benyang = one('geoJSON').children.find((item: any) => item.feature.properties.VILLNAME === '本揚里')
    expect(benyang.getElement().classList).toContain('leaflet-interactive')
    expect(benyang.options.className).toBe('area-village area-village--l0')
  })

  it('里界換了（重新讀到不同的里界檔）才整層重建', async () => {
    const wrapper = await mountMap()
    await wrapper.setProps({ boundaries: villageBoundaries() })
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
    const village = villageLayerStub()
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
    expect(map.fitBounds).toHaveBeenLastCalledWith({ center: [22.663189, 120.306301], meters: 6000 }, { padding: [24, 24] })
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
      expect(map.fitBounds).toHaveBeenLastCalledWith({ center: [22.642456, 120.343713], meters: 6000 }, { padding: [24, 24] })

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

  it('卸載時圖磚的 tileload／tileerror 監聽拿掉（跟登記的是同一個函式），之後再來的事件不會動到狀態', async () => {
    const wrapper = await mountMap()
    const tiles = one('tileLayer')
    expect(tiles.handlers.tileload).toHaveLength(1)
    expect(tiles.handlers.tileerror).toHaveLength(1)
    const [onLoad] = tiles.on.mock.calls.find((call: unknown[]) => call[0] === 'tileload')!.slice(1)
    const [onError] = tiles.on.mock.calls.find((call: unknown[]) => call[0] === 'tileerror')!.slice(1)
    wrapper.unmount()
    wrappers.length = 0
    expect(tiles.off).toHaveBeenCalledWith('tileload', onLoad)
    expect(tiles.off).toHaveBeenCalledWith('tileerror', onError)
    expect(tiles.handlers.tileload).toEqual([])
    expect(tiles.handlers.tileerror).toEqual([])
  })

  it('建圖失敗後清半成品：同樣拿掉圖磚監聽', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      leaflet.module.geoJSON.mockImplementationOnce(() => { throw new Error('geoJSON failed') })
      await mountMap()
      const tiles = one('tileLayer')
      expect(tiles.off).toHaveBeenCalledWith('tileload', expect.any(Function))
      expect(tiles.off).toHaveBeenCalledWith('tileerror', expect.any(Function))
      expect(tiles.handlers.tileload).toEqual([])
    } finally {
      logged.mockRestore()
    }
  })

  it('地圖容器有名稱（讀屏知道這是什麼地圖、資料在哪看）；載入中的提示是常駐的 status 區域，載完只是清空', async () => {
    const wrapper = mount(AreaMap, { props: baseProps() as never, attachTo: document.body, global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    const canvas = wrapper.get('.area-map__canvas')
    expect(canvas.attributes('role')).toBe('group')
    expect(canvas.attributes('aria-label')).toBe('義華周邊里界地圖（依參觀著色）；同樣的資料在下方的參觀來源表與幼兒園清單')
    const status = wrapper.get('[role="status"]')
    expect(status.text()).toBe('地圖載入中…')
    const element = status.element
    await settle()
    expect(wrapper.get('[role="status"]').element).toBe(element)
    expect(wrapper.get('[role="status"]').text()).toBe('')
    expect(wrapper.text()).not.toContain('地圖載入中')
  })

  it('手機的「完成」鈕有語境：讀屏唸「完成移動地圖」，看到的字仍是「完成」', async () => {
    const wrapper = await mountMap({ narrow: true })
    expect(button(wrapper, '移動地圖')!.attributes('aria-label')).toBeUndefined()
    await button(wrapper, '移動地圖')!.trigger('click')
    const done = button(wrapper, '完成')!
    expect(done.attributes('aria-label')).toBe('完成移動地圖')
    expect(done.text()).toBe('完成')
  })

  it('版面在手機與桌機之間切換：里界整層重畫（hover 里名只在桌機綁）、拖曳與雙指縮放跟著開關', async () => {
    const wrapper = await mountMap()
    const map = one('map')
    const bindTooltip = () => {
      const village = villageLayerStub()
      leaflet.created.geoJSON!.at(-1)!.options.onEachFeature(feature('三民區', '本揚里'), village)
      return village.bindTooltip
    }
    expect(bindTooltip()).toHaveBeenCalled()
    await wrapper.setProps({ narrow: true })
    expect(leaflet.created.geoJSON).toHaveLength(2)
    expect(leaflet.created.geoJSON![0].remove).toHaveBeenCalled()
    expect(bindTooltip()).not.toHaveBeenCalled()
    expect(map.dragging.disable).toHaveBeenCalled()
    expect(map.touchZoom.disable).toHaveBeenCalled()
    expect(button(wrapper, '移動地圖')).toBeDefined()
    await wrapper.setProps({ narrow: false })
    expect(leaflet.created.geoJSON).toHaveLength(3)
    expect(bindTooltip()).toHaveBeenCalled()
    expect(map.dragging.enable).toHaveBeenCalled()
    expect(map.touchZoom.enable).toHaveBeenCalled()
    expect(button(wrapper, '移動地圖')).toBeUndefined()
  })

  it('幼兒園的彈出框：核定人數未知（null）就不寫「核定」；距離照 formatDistance', async () => {
    await mountMap()
    const popup = (index: number) => (leaflet.created.circleMarker![index].bindPopup.mock.calls[0]![0] as () => HTMLElement)()
    expect(popup(1).textContent).toBe('大樹幼兒園公立・380 m・核定 90 人')
    const quasi = popup(2)
    expect(quasi.textContent).toBe('小草幼兒園準公共・950 m')
    expect(quasi.textContent).not.toContain('核定')
    expect(popup(0).textContent).toBe('常春藤幼兒園本機構・0 m・核定 210 人')
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
    try {
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
    } finally {
      logged.mockRestore()
    }
  })

  it('手機：Leaflet 本身載不下來時沒有「移動地圖」鈕（沒有地圖可移動）', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await chunkFails()
      const wrapper = await mountMap({ narrow: true })
      expect(wrapper.text()).toContain('地圖載入失敗')
      expect(button(wrapper, '移動地圖')).toBeUndefined()
      expect(button(wrapper, '完成')).toBeUndefined()
    } finally {
      logged.mockRestore()
    }
  })

  it('建到一半丟錯（地圖已建出來）：移除半成品、記錄錯誤、顯示失敗，重試後只剩一張活的地圖', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
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
    } finally {
      logged.mockRestore()
    }
  })

  it('清半成品時也丟錯：照樣顯示失敗、可重試', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
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
    } finally {
      logged.mockRestore()
    }
  })

  // 真 Leaflet 的 remove() 做到一半丟錯時容器上的 _leaflet_id 還在，重試再建地圖會丟 "Map container is already initialized."
  // （上面那個測試的假 Leaflet 也照這個規則）。清掉 id 和半拆的圖層，重試才建得出來，也不會有兩張地圖疊在同一個容器。
  it('remove() 丟錯後：清掉容器上的 _leaflet_id 與殘留的圖層節點，重試能建出新地圖', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      leaflet.module.tileLayer.mockImplementationOnce(() => {
        const [broken] = leaflet.created.map!
        broken.element.append(document.createElement('div'))
        broken.remove.mockImplementationOnce(() => { throw new Error('remove failed') })
        throw new Error('tile layer failed')
      })
      const wrapper = await mountMap()
      const canvas = wrapper.get('.area-map__canvas').element as HTMLElement & { _leaflet_id?: number }
      expect(canvas._leaflet_id).toBeUndefined()
      expect(canvas.childElementCount).toBe(0)
      await button(wrapper, '重試')!.trigger('click')
      await settle()
      expect(leaflet.created.map).toHaveLength(2)
      expect(logged).not.toHaveBeenCalledWith('[AreaMap] 地圖建立失敗', expect.objectContaining({ message: 'Map container is already initialized.' }))
      expect(wrapper.text()).not.toContain('地圖載入失敗')
    } finally {
      logged.mockRestore()
    }
  })

  it('卸載時 remove() 丟錯：照樣清掉容器上的 _leaflet_id', async () => {
    const wrapper = await mountMap()
    const canvas = wrapper.get('.area-map__canvas').element as HTMLElement & { _leaflet_id?: number }
    one('map').remove.mockImplementationOnce(() => { throw new Error('remove failed') })
    expect(canvas._leaflet_id).toBeDefined()
    expect(() => wrapper.unmount()).toThrow()
    wrappers.length = 0
    expect(canvas._leaflet_id).toBeUndefined()
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
  const lost = (locate_error: string | null, district: string | null = null) => ({
    campus: { key: 'yihua', name: '義華', lat: null, lng: null, locate_error, district },
  })

  it.each([
    ['no_address', '找不到本校地址'],
    ['pending', '門牌資料尚未匯入'],
    ['no_doorplate', '本校地址比對不到門牌'],
  ])('%s → %s', async (error, text) => {
    const wrapper = await mountMap(lost(error))
    expect(wrapper.get('.area-map__campus-note').text()).toContain(text)
  })

  it('知道校址所在的行政區：補一句地圖先顯示哪一區', async () => {
    const wrapper = await mountMap(lost('pending', '三民區'))
    expect(wrapper.get('.area-map__campus-note').text()).toBe('本校位置未標示（門牌資料尚未匯入），地圖先顯示三民區。')
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

describe('招生機會著色（2026-10-13 規格 7.2）', () => {
  // 里界屬性帶代碼：招生機會的列以 village_code 對（同 villageBoundaries 的真值）。
  const coded = (town: string, village: string, code: string) => ({ properties: { TOWNNAME: town, VILLNAME: village, VILLCODE: code } })
  const DINGJIN = coded('三民區', '鼎金里', '64000050001')
  const BENYANG = coded('三民區', '本揚里', '64000050015')
  const BAOYE = coded('三民區', '寶業里', '64000050025')
  const LONGZI = coded('鼓山區', '龍子里', '64000020015')
  const latest = (): any => leaflet.created.geoJSON!.at(-1)
  const classOf = (item: ReturnType<typeof coded>) => latest().options.style(item).className
  // 著色模式由外層（AreaTab）決定，AreaMap 只吃 mode prop。
  async function choose(wrapper: VueWrapper, mode: string) {
    await wrapper.setProps({ mode })
    await flushPromises()
  }

  // 子圖形 <path> 上實際掛的 class（換模式不重建圖層，畫面靠這個換色）。
  const pathOf = (item: ReturnType<typeof coded>) => {
    const child = latest().children.find((entry: any) => entry.feature.properties.VILLCODE === item.properties.VILLCODE)
    return child ? [...child.getElement().classList].filter((name: string) => name !== 'leaflet-interactive').join(' ') : undefined
  }

  it('換著色模式不重建圖層：各里圖形的 class 直接換掉，換回來也一樣', async () => {
    const wrapper = await mountMap({ opportunity: areaOpportunity() })
    expect(pathOf(BENYANG)).toBe(classOf(BENYANG))
    await choose(wrapper, 'opportunity')
    expect(leaflet.created.geoJSON).toHaveLength(1)
    expect([DINGJIN, BENYANG, BAOYE, LONGZI].map(pathOf)).toEqual([DINGJIN, BENYANG, BAOYE, LONGZI].map(classOf))
    expect(pathOf(DINGJIN)).toBe('area-village area-village--chance')
    await choose(wrapper, 'visits')
    expect(leaflet.created.geoJSON).toHaveLength(1)
    expect([DINGJIN, BENYANG, BAOYE, LONGZI].map(pathOf)).toEqual([DINGJIN, BENYANG, BAOYE, LONGZI].map(classOf))
  })

  it('2–5 歲孩子：半徑內依孩子數分 5 級，半徑外不上色；圖例寫「位」；地圖名稱跟著換', async () => {
    const wrapper = await mountMap({ opportunity: areaOpportunity(), mode: 'children' })
    expect([DINGJIN, BENYANG, BAOYE, LONGZI].map(classOf)).toEqual([
      'area-village area-village--l5', 'area-village area-village--l3', 'area-village area-village--l2', 'area-village area-village--l0',
    ])
    expect(wrapper.findAll('.area-legend--levels li')[0]!.text()).toBe('1–100 位')
    expect(wrapper.get('.area-map__canvas').attributes('aria-label')).toContain('依2–5 歲孩子著色')
  })

  it('招生機會：明顯偏少、差不多、比附近多三色，其餘不上色；圖例', async () => {
    const wrapper = await mountMap({ opportunity: areaOpportunity(), mode: 'opportunity' })
    expect([DINGJIN, BENYANG, BAOYE, LONGZI].map(classOf)).toEqual([
      'area-village area-village--chance', 'area-village area-village--typical', 'area-village area-village--strong',
      'area-village area-village--l0',
    ])
    expect(wrapper.findAll('.area-legend--signals li').map((item) => item.text()))
      .toEqual(['明顯偏少', '差不多', '比附近多', '孩子少、還不判斷、在半徑外或沒有人口資料'])
  })

  it('半徑內但人口表沒有的里：不上色（不是半徑外，但也沒有可比的孩子數）', async () => {
    const base = areaOpportunity()
    await mountMap({
      mode: 'opportunity',
      opportunity: {
        ...base,
        villages: base.villages.filter((row) => row.village_code !== BENYANG.properties.VILLCODE),
        no_population_villages: [{ district: '三民區', village: '本揚里', village_code: BENYANG.properties.VILLCODE, distance_m: 300, visit: 6 }],
      },
    })
    expect(classOf(BENYANG)).toBe('area-village area-village--l0')
    expect(classOf(DINGJIN)).toBe('area-village area-village--chance')
  })

  it('換半徑重讀中（opportunity 變 null）：先不上色、不重建圖層；資料回來再上色', async () => {
    const wrapper = await mountMap({ opportunity: areaOpportunity(), mode: 'opportunity' })
    await wrapper.setProps({ opportunity: null })
    await flushPromises()
    expect(classOf(DINGJIN)).toBe('area-village area-village--l0')
    expect(pathOf(DINGJIN)).toBe('area-village area-village--l0')
    await wrapper.setProps({ opportunity: areaOpportunity() })
    await flushPromises()
    expect(pathOf(DINGJIN)).toBe('area-village area-village--chance')
    expect(leaflet.created.geoJSON).toHaveLength(1)
  })

  it('招生機會的顏色走 token（style.css 的 --area-chance），元件裡不寫色碼', () => {
    const source = readFileSync(join(__dirname, '..', 'components', 'admissions', 'area', 'AreaMap.vue'), 'utf8')
    expect(source).toContain('fill: var(--area-chance)')
    const style = readFileSync(join(__dirname, '..', 'style.css'), 'utf8')
    expect(style).toMatch(/--area-chance: oklch\(/)
  })
})

describe('托嬰中心圖層（2026-10-14）', () => {
  const items = () => areaBabycare().items
  // 第一個 marker 是本校星號。
  const babycareMarkers = () => leaflet.created.marker!.slice(1)

  it('標點用菱形（divIcon）、帶機構名稱；圖層預設不勾，所以沒有加到地圖上', async () => {
    const wrapper = await mountMap({ babycare: items() })
    expect(babycareMarkers().map((marker) => marker.options.title)).toEqual(items().map((item) => item.name))
    expect(leaflet.module.divIcon).toHaveBeenCalledWith(expect.objectContaining({ className: 'area-bc', iconSize: [16, 16] }))
    const group = leaflet.created.layerGroup![1]
    expect(group.addLayer).toHaveBeenCalledTimes(3)
    expect(group.addTo).not.toHaveBeenCalled()
    expect(wrapper.find('[aria-label="在地圖上顯示托嬰中心"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('托嬰中心與托育家園')
  })

  it('勾選打開圖層、取消收起；圖例跟著出現與收起；幼兒園的開關不受影響', async () => {
    const wrapper = await mountMap({ babycare: items() })
    const group = leaflet.created.layerGroup![1]
    const switches = wrapper.findAllComponents({ name: 'ElSwitch' })
    switches[1]!.vm.$emit('update:modelValue', true)
    await flushPromises()
    expect(one('map').addLayer).toHaveBeenCalledWith(group)
    expect(wrapper.text()).toContain('托嬰中心與托育家園')
    switches[1]!.vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(one('map').removeLayer).toHaveBeenCalledWith(group)
    expect(wrapper.text()).not.toContain('托嬰中心與托育家園')
    expect(wrapper.text()).toContain('非營利') // 幼兒園的類型圖例還在
  })

  it('focusBabycare：圖層沒開就先打開，地圖移到該點並打開資訊；已經開著不重複加', async () => {
    const wrapper = await mountMap({ babycare: items() })
    const vm = wrapper.vm as unknown as { focusBabycare: (id: string) => void; revealBabycare: () => void }
    vm.focusBabycare('bc-center')
    await flushPromises()
    const group = leaflet.created.layerGroup![1]
    expect(one('map').addLayer).toHaveBeenCalledWith(group)
    expect(one('map').setView).toHaveBeenCalledWith({ lat: 22.6, lng: 120.3 }, 15)
    expect(babycareMarkers()[1]!.openPopup).toHaveBeenCalled()
    one('map').addLayer.mockClear()
    vm.focusBabycare('bc-public')
    vm.revealBabycare()
    expect(one('map').addLayer).not.toHaveBeenCalled()
    vm.focusBabycare('不存在的代碼') // 找不到就什麼都不做
  })

  it('revealBabycare：卡片切到托嬰中心時打開圖層', async () => {
    const wrapper = await mountMap({ babycare: items() })
    ;(wrapper.vm as unknown as { revealBabycare: () => void }).revealBabycare()
    await flushPromises()
    expect(one('map').addLayer).toHaveBeenCalledWith(leaflet.created.layerGroup![1])
    expect(wrapper.text()).toContain('托嬰中心與托育家園')
  })

  it('資訊框：簡稱、類型、距離、核定、實際收托與電話；名稱當文字不當標籤', async () => {
    await mountMap({ babycare: [babycareItem({ name: '<b>高雄市私立怪名字托嬰中心</b>' })] })
    const content = babycareMarkers()[0]!.bindPopup.mock.calls[0]![0]() as HTMLElement
    expect(content.textContent).toContain('托嬰中心・520 m・核定 40 人・實際收托 32 人')
    expect(content.textContent).toContain('07-3801000')
    expect(content.querySelector('b')).toBeNull()
  })

  it('換了托嬰清單整組重畫；沒有托嬰時只有本校星號', async () => {
    const wrapper = await mountMap()
    expect(leaflet.created.marker).toHaveLength(1)
    await wrapper.setProps({ babycare: items().slice(0, 2) })
    expect(leaflet.created.layerGroup![1].clearLayers).toHaveBeenCalled()
    expect(babycareMarkers()).toHaveLength(2)
  })
})

describe('孩子增減著色（2026-10-14 里的變化規格 7.1）', () => {
  const coded = (town: string, village: string, code: string) => ({ properties: { TOWNNAME: town, VILLNAME: village, VILLCODE: code } })
  const DINGJIN = coded('三民區', '鼎金里', '64000050001')
  const BENYANG = coded('三民區', '本揚里', '64000050015')
  const BAOYE = coded('三民區', '寶業里', '64000050025')
  const LONGZI = coded('鼓山區', '龍子里', '64000020015')
  const OUTSIDE = coded('小港區', '青島里', '64000110001')
  const latest = (): any => leaflet.created.geoJSON!.at(-1)
  const classOf = (item: ReturnType<typeof coded>) => latest().options.style(item).className

  it('增加多、減少依分級上色；里界調整合併的組、半徑外不上色；圖例；地圖名稱跟著換', async () => {
    const wrapper = await mountMap({ trends: areaTrends(), mode: 'trend' })
    expect([BENYANG, DINGJIN, BAOYE, LONGZI, OUTSIDE].map(classOf)).toEqual([
      'area-village area-village--up2', 'area-village area-village--down1',
      // 寶業里、龍子里是同一個合併組：數字是整組的，不替組內各里上色。
      'area-village area-village--l0', 'area-village area-village--l0', 'area-village area-village--l0',
    ])
    expect(wrapper.findAll('.area-legend--signals li').map((item) => item.text()))
      .toEqual(['增加多', '增加', '差不多', '減少', '減少多', '孩子少、里界調整、在半徑外或沒有資料'])
    expect(wrapper.get('.area-map__canvas').attributes('aria-label')).toContain('依孩子增減著色）；同樣的資料在下方的各里表')
  })

  it('讀取中（換半徑，trends 變 null）：先不上色，資料回來再上色，不重建圖層', async () => {
    const wrapper = await mountMap({ trends: areaTrends(), mode: 'trend' })
    await wrapper.setProps({ trends: null })
    await flushPromises()
    expect(classOf(BENYANG)).toBe('area-village area-village--l0')
    await wrapper.setProps({ trends: areaTrends() })
    await flushPromises()
    expect(classOf(BENYANG)).toBe('area-village area-village--up2')
    expect(leaflet.created.geoJSON).toHaveLength(1)
  })

  it('減少的顏色走 token（style.css 的 --area-down-*），元件裡不寫色碼', () => {
    const source = readFileSync(join(__dirname, '..', 'components', 'admissions', 'area', 'AreaMap.vue'), 'utf8')
    expect(source).toContain('fill: var(--area-down-2)')
    const style = readFileSync(join(__dirname, '..', 'style.css'), 'utf8')
    expect(style).toMatch(/--area-down-1: color-mix\(/)
  })
})

describe('新屋交屋著色（2026-10-14 里的變化 B2 段）', () => {
  const coded = (town: string, village: string, code: string) => ({ properties: { TOWNNAME: town, VILLNAME: village, VILLCODE: code } })
  const DINGJIN = coded('三民區', '鼎金里', '64000050001')
  const BENYANG = coded('三民區', '本揚里', '64000050015')
  const BAOYE = coded('三民區', '寶業里', '64000050025')
  const LONGZI = coded('鼓山區', '龍子里', '64000020015')
  const OUTSIDE = coded('小港區', '青島里', '64000110001')
  const latest = (): any => leaflet.created.geoJSON!.at(-1)
  const classOf = (item: ReturnType<typeof coded>) => latest().options.style(item).className

  it('近 4 季筆數依半徑內最多的里分 5 級（同參觀人數的切法）；0 筆、半徑外不上色；圖例寫「筆」；地圖名稱跟著換', async () => {
    const wrapper = await mountMap({ trends: areaTrends(), mode: 'homes' })
    // 本揚里 24 筆、鼎金里 106 筆（最多）；寶業里、龍子里是同一個合併組，組內沒有交屋（0 筆）：不上色。
    expect([BENYANG, DINGJIN, BAOYE, LONGZI, OUTSIDE].map(classOf)).toEqual([
      'area-village area-village--l2', 'area-village area-village--l5',
      'area-village area-village--l0', 'area-village area-village--l0', 'area-village area-village--l0',
    ])
    expect(wrapper.findAll('.area-legend--levels li').map((item) => item.text()))
      .toEqual(['1–21 筆', '22–42 筆', '43–63 筆', '64–84 筆', '85–106 筆', '0 筆或在半徑外'])
    expect(wrapper.get('.area-map__canvas').attributes('aria-label')).toContain('依新屋交屋著色）；同樣的資料在下方的各里表')
  })

  it('里界調整合併的組：列上是整組的數字，組內各里依自己的筆數上色', async () => {
    const base = areaTrends()
    // 寶業里 8 筆、龍子里 4 筆，整組 12 筆（分級的最大值仍是鼎金里的 106 筆）。
    const trends = areaTrends({
      villages: base.villages.map((row) =>
        row.merged ? { ...row, new_homes: 12, new_homes_latest: 5, new_homes_by_code: { '64000050025': 8, '64000020015': 4 } } : row),
    })
    await mountMap({ trends, mode: 'homes' })
    expect([BAOYE, LONGZI].map(classOf)).toEqual(['area-village area-village--l1', 'area-village area-village--l1'])
  })

  it('合併組比任何一個單獨的里都多時，分級以組內最多的那一里為最大值（不是整組）', async () => {
    const base = areaTrends()
    const trends = areaTrends({
      villages: base.villages.map((row) =>
        row.merged
          ? { ...row, new_homes: 639, new_homes_latest: 100, new_homes_by_code: { '64000050025': 500, '64000020015': 139 } }
          : { ...row, new_homes: 24, new_homes_by_code: row.new_homes_by_code }),
    })
    await mountMap({ trends, mode: 'homes' })
    // 最大值是組內寶業里的 500：寶業里最深（l5），龍子里 139（l2）；鼎金里 24（l1）。
    expect([BAOYE, LONGZI, BENYANG].map(classOf)).toEqual([
      'area-village area-village--l5', 'area-village area-village--l2', 'area-village area-village--l1',
    ])
  })

  it('半徑內都沒有交屋：圖例換成一句話，不留空圖例', async () => {
    const base = areaTrends()
    const wrapper = await mountMap({
      trends: areaTrends({ villages: base.villages.map((row) => ({ ...row, new_homes: 0, new_homes_latest: 0 })) }),
      mode: 'homes',
    })
    expect(wrapper.find('.area-legend--levels').exists()).toBe(false)
    expect(wrapper.get('.area-map__none').text()).toBe('半徑內近 4 季沒有新屋交屋。')
  })

  it('讀取中（換半徑，trends 變 null）：先不上色，資料回來再上色，不重建圖層', async () => {
    const wrapper = await mountMap({ trends: areaTrends(), mode: 'homes' })
    await wrapper.setProps({ trends: null })
    await flushPromises()
    expect(classOf(BENYANG)).toBe('area-village area-village--l0')
    await wrapper.setProps({ trends: areaTrends() })
    await flushPromises()
    expect(classOf(BENYANG)).toBe('area-village area-village--l2')
    expect(leaflet.created.geoJSON).toHaveLength(1)
  })
})

describe('在籍學生（2026-10-15 規格 §6）', () => {
  const enrolledGroup = (): any => leaflet.created.layerGroup![2]
  const enrolledMarkers = (): any[] => (leaflet.created.circleMarker ?? []).filter((marker) => String(marker.options.className).startsWith('area-enrolled'))
  async function choose(wrapper: VueWrapper, mode: string) {
    await wrapper.setProps({ mode })
    await flushPromises()
  }

  it('切到在籍學生：里不上色、點圖層加到地圖；兩位以上的格畫大一級；切走就收起', async () => {
    const wrapper = await mountMap({ enrolled: areaEnrolled() })
    expect(one('map').addLayer).not.toHaveBeenCalledWith(enrolledGroup())
    // buildMap 在參觀人數模式下就呼叫過一次 removeLayer：清掉再看，才分得出是「切模式」造成的呼叫。
    one('map').addLayer.mockClear()
    one('map').removeLayer.mockClear()
    await choose(wrapper, 'enrolled')
    const latest: any = leaflet.created.geoJSON!.at(-1)
    expect(latest.options.style(feature('三民區', '本揚里')).className).toBe('area-village area-village--l0')
    expect(one('map').addLayer).toHaveBeenCalledWith(enrolledGroup())
    expect(enrolledMarkers().map((marker) => [marker.latlng, marker.options.className, marker.options.radius])).toEqual([
      [[22.642, 120.344], 'area-enrolled area-enrolled--multi', 7],
      [[22.65, 120.35], 'area-enrolled', 5],
      [[22.7, 120.3], 'area-enrolled', 5],
    ])
    expect(one('map').removeLayer).not.toHaveBeenCalledWith(enrolledGroup())
    one('map').removeLayer.mockClear()
    await choose(wrapper, 'visits')
    expect(one('map').removeLayer).toHaveBeenCalledWith(enrolledGroup())
  })

  it('地圖在「在籍學生」模式下重建（程式碼檔載入失敗後重試）：新地圖加上新的點圖層並畫好點', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await chunkFails()
      // 沒有地圖時模式照常由外層決定：先是在籍學生，再重試。
      const wrapper = await mountMap({ enrolled: areaEnrolled(), mode: 'enrolled' })
      expect(leaflet.created.map).toBeUndefined()
      await chunkLoads()
      await button(wrapper, '重試')!.trigger('click')
      await settle()
      expect(leaflet.created.map).toHaveLength(1)
      expect(leaflet.created.layerGroup).toHaveLength(3)
      expect(one('map').addLayer).toHaveBeenCalledWith(enrolledGroup())
      expect(enrolledMarkers()).toHaveLength(3)
    } finally {
      logged.mockRestore()
    }
  })

  it('班別篩選：只畫有那班的格；0 人的班別地圖上沒有點、圖例寫 0 位', async () => {
    const wrapper = await mountMap({ enrolled: areaEnrolled(), gradeFilter: '小班' })
    await choose(wrapper, 'enrolled')
    expect(enrolledMarkers().map((marker) => marker.options.className)).toEqual(['area-enrolled'])
    // buildMap 的第一次畫點已經清過一次：記下次數，換班別後要再增加。
    const cleared = enrolledGroup().clearLayers.mock.calls.length
    await wrapper.setProps({ gradeFilter: '其他' })
    await flushPromises()
    expect(enrolledGroup().clearLayers.mock.calls.length).toBeGreaterThan(cleared)
    expect(enrolledMarkers()).toHaveLength(1) // 先前畫的那一個；其他沒有新增
    expect(wrapper.get('.area-legend--enrolled').text()).toContain('地圖上 0 位')
  })

  it('換班別或換了在籍資料就整組重畫：新畫的點正好是有那班的格，彈出框也照新的篩選', async () => {
    const wrapper = await mountMap({ enrolled: areaEnrolled(), gradeFilter: 'all' })
    await choose(wrapper, 'enrolled')
    const drawn = enrolledMarkers().length
    expect(drawn).toBe(3)
    await wrapper.setProps({ gradeFilter: '小班' })
    await flushPromises()
    const afterFilter = enrolledMarkers().slice(drawn)
    expect(afterFilter.map((marker) => [marker.latlng, marker.options.className])).toEqual([[[22.642, 120.344], 'area-enrolled']])
    expect((afterFilter[0].bindPopup.mock.calls[0]![0]() as HTMLElement).textContent).toBe('這附近 1 位：小班 1')
    const base = areaEnrolled()
    await wrapper.setProps({ enrolled: areaEnrolled({ points: base.points.slice(0, 1).map((point) => ({ ...point, counts: { ...point.counts, 小班: 3 } })) }) })
    await flushPromises()
    expect(enrolledMarkers().slice(drawn + afterFilter.length).map((marker) => [marker.options.className, marker.options.radius])).toEqual([
      ['area-enrolled area-enrolled--multi', 7],
    ])
  })

  it('學生的點在最上層：在籍學生模式下，幼兒園重畫或開關重新加回地圖，點都再拉到最前面；別的模式不動', async () => {
    const wrapper = await mountMap({ enrolled: areaEnrolled() })
    const frontCalls = () => enrolledMarkers().map((marker) => marker.bringToFront.mock.calls.length)
    await wrapper.setProps({ kindergartens: areaKindergartens().items.slice(0, 2) })
    expect(frontCalls()).toEqual([0, 0, 0])

    await choose(wrapper, 'enrolled')
    expect(frontCalls()).toEqual([1, 1, 1]) // 切進來時圖層加到地圖後也拉一次
    enrolledMarkers().forEach((marker) => marker.bringToFront.mockClear())
    await wrapper.setProps({ kindergartens: areaKindergartens().items.slice(0, 3) })
    expect(frontCalls()).toEqual([1, 1, 1])

    enrolledMarkers().forEach((marker) => marker.bringToFront.mockClear())
    const kindergartenSwitch = wrapper.findAllComponents({ name: 'ElSwitch' })[0]!
    kindergartenSwitch.vm.$emit('update:modelValue', false)
    await flushPromises()
    kindergartenSwitch.vm.$emit('update:modelValue', true)
    await flushPromises()
    expect(one('map').addLayer).toHaveBeenLastCalledWith(one('layerGroup'))
    expect(frontCalls()).toEqual([2, 2, 2])
  })

  it('圖例寫清冊日期與沒有點的人數；班別篩選不在地圖上（移到右欄，規格 D13），地圖也不再發 update:gradeFilter', async () => {
    const wrapper = await mountMap({ enrolled: areaEnrolled(), mode: 'enrolled' })
    expect(wrapper.findAllComponents({ name: 'ElRadioGroup' })).toHaveLength(0)
    const legend = wrapper.get('.area-legend--enrolled').text()
    expect(legend).toContain('清冊 2026/10/15・115 學年班別・門牌 115 年 10 月版・地圖上 4 位')
    expect(legend).toContain('沒有點 1 位（只對到里 1）')
    expect(wrapper.emitted('update:gradeFilter')).toBeUndefined()
  })

  it('點的彈出框寫這附近幾位、各班；點里不開彈出框（在籍數寫在右欄的卡片）', async () => {
    const wrapper = await mountMap({ enrolled: areaEnrolled(), mode: 'enrolled' })
    const marker = enrolledMarkers()[0]
    expect((marker.bindPopup.mock.calls[0]![0]() as HTMLElement).textContent).toBe('這附近 2 位：小班 1、中班 1')
    const village = villageLayerStub()
    one('geoJSON').options.onEachFeature(feature('三民區', '本揚里', '64000050015'), village)
    expect(village.bindPopup).not.toHaveBeenCalled()
    expect(wrapper.find('.leaflet-popup').exists()).toBe(false)
  })

  it('顏色走 token（style.css 的 --area-enrolled），元件裡不寫色碼', () => {
    const source = readFileSync(join(__dirname, '..', 'components', 'admissions', 'area', 'AreaMap.vue'), 'utf8')
    expect(source).toContain('fill: var(--area-enrolled)')
    const style = readFileSync(join(__dirname, '..', 'style.css'), 'utf8')
    expect(style).toMatch(/--area-enrolled: var\(--admin-accent\)/)
  })
})

describe('地圖工作台：模式由外層決定、點里選取、選取外框（2026-10-16 規格 §2.2、D3、D6、D7）', () => {
  const BENYANG = '64000050015'
  const LONGZI = '64000020015'
  const DINGJIN = feature('三民區', '鼎金里', '64000050001')
  const villagesLayer = (): any => leaflet.created.geoJSON![0]
  const outlines = (): any[] => leaflet.created.geoJSON!.filter((layer) => layer.options.pane === 'area-selected')
  const pathClasses = () =>
    villagesLayer().children.map((child: any) => [...child.getElement().classList].filter((name: string) => name !== 'leaflet-interactive').join(' '))

  it('mode 是 prop：children 時鼎金里 l5；peers 時全部 l0，也不畫里的圖例', async () => {
    const wrapper = await mountMap({ opportunity: areaOpportunity(), mode: 'children' })
    expect(villagesLayer().options.style(DINGJIN).className).toBe('area-village area-village--l5')
    await wrapper.setProps({ mode: 'peers' })
    expect(pathClasses()).toEqual(Array(4).fill('area-village area-village--l0'))
    expect(villagesLayer().options.style(feature('三民區', '本揚里', BENYANG)).className).toBe('area-village area-village--l0')
    expect(leaflet.created.geoJSON).toHaveLength(1) // 換模式不重建里界
    expect(wrapper.find('.area-legend--levels').exists()).toBe(false)
    expect(wrapper.find('.area-map__none').exists()).toBe(false)
    expect(wrapper.find('.area-legend--signals').exists()).toBe(false)
  })

  it('peers：幼兒園圖層強制顯示、開關鎖住並寫「同業模式一律顯示」；離開 peers 回到使用者自己的選擇', async () => {
    const wrapper = await mountMap()
    const group = one('layerGroup')
    const map = one('map')
    const kindergartenSwitch = () => wrapper.findAll('.el-switch')[0]!
    expect(kindergartenSwitch().classes()).not.toContain('is-disabled')
    expect(wrapper.find('.area-legend--kinds .hint').exists()).toBe(false)
    // 使用者先把幼兒園關掉。
    wrapper.findComponent({ name: 'ElSwitch' }).vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(map.removeLayer).toHaveBeenCalledWith(group)
    expect(wrapper.text()).not.toContain('非營利')
    map.addLayer.mockClear()
    map.removeLayer.mockClear()

    await wrapper.setProps({ mode: 'peers' })
    expect(map.addLayer).toHaveBeenCalledWith(group)
    expect(kindergartenSwitch().classes()).toEqual(expect.arrayContaining(['is-disabled', 'is-checked']))
    expect(wrapper.get('.area-legend--kinds .hint').text()).toBe('同業模式一律顯示')
    expect(wrapper.find('[aria-label="在地圖上顯示幼兒園"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('非營利') // 類型圖例跟著出現
    map.removeLayer.mockClear()

    await wrapper.setProps({ mode: 'visits' })
    expect(map.removeLayer).toHaveBeenCalledWith(group)
    expect(kindergartenSwitch().classes()).not.toContain('is-disabled')
    expect(kindergartenSwitch().classes()).not.toContain('is-checked')
    expect(wrapper.find('.area-legend--kinds .hint').exists()).toBe(false)
  })

  it('一進來就是 peers（網址 map=peers）：幼兒園圖層建圖時就加上；使用者開著的圖層離開 peers 後不動', async () => {
    const wrapper = await mountMap({ mode: 'peers' })
    expect(one('layerGroup').addTo).toHaveBeenCalledWith(one('map'))
    one('map').removeLayer.mockClear()
    await wrapper.setProps({ mode: 'visits' })
    expect(one('map').removeLayer).not.toHaveBeenCalledWith(one('layerGroup'))
  })

  it('建圖後、加任何圖層之前先建兩個 pane：area-selected（410、不收滑鼠事件）與 area-points（420）', async () => {
    await mountMap()
    const map = one('map')
    expect(map.createPane).toHaveBeenCalledTimes(2)
    expect(map.panes['area-selected'].style).toEqual({ zIndex: '410', pointerEvents: 'none' })
    expect(map.panes['area-points'].style).toEqual({ zIndex: '420' })
    const lastPane = Math.max(...map.createPane.mock.invocationCallOrder)
    expect(lastPane).toBeGreaterThan(leaflet.module.map.mock.invocationCallOrder[0]!)
    for (const draw of [leaflet.module.tileLayer, leaflet.module.layerGroup, leaflet.module.geoJSON, leaflet.module.circle, leaflet.module.circleMarker]) {
      expect(draw.mock.invocationCallOrder[0], '圖層在 pane 建好之前就加了').toBeGreaterThan(lastPane)
    }
  })

  it('幼兒園與在籍點的圓點都畫在 area-points pane；托嬰菱形與本校星號留在預設的 marker pane', async () => {
    await mountMap({ enrolled: areaEnrolled(), babycare: areaBabycare().items })
    const dots = leaflet.created.circleMarker!
    expect(dots).toHaveLength(7) // 幼兒園 4＋在籍 3 格
    expect(dots.map((marker) => marker.options.pane)).toEqual(Array(7).fill('area-points'))
    for (const marker of leaflet.created.marker!) expect(marker.options.pane).toBeUndefined()
    // 里界與半徑圓留在預設的 overlay pane：里界不指定 pane。
    expect(villagesLayer().options.pane).toBeUndefined()
  })

  it('selectedCode 改變：外框畫在 area-selected pane（不可點、只有線），不重建里界、不重畫 class', async () => {
    const wrapper = await mountMap()
    const classesBefore = pathClasses()
    await wrapper.setProps({ selectedCode: BENYANG })
    expect(leaflet.created.geoJSON).toHaveLength(2) // 里界 1＋外框 1
    const [outline] = outlines()
    expect(outline.options).toMatchObject({
      pane: 'area-selected', interactive: false, style: { className: 'area-village-selected', fill: false, weight: 2.5 },
    })
    // 只框選到的那一個里（單一 feature，不是整個 FeatureCollection）。
    expect(outline.data.type).toBe('Feature')
    expect(outline.data.properties).toMatchObject({ VILLCODE: BENYANG, VILLNAME: '本揚里' })
    expect(outline.addTo).toHaveBeenCalledWith(one('map'))
    expect(villagesLayer().remove).not.toHaveBeenCalled()
    expect(villagesLayer().bringToBack).toHaveBeenCalledTimes(1)
    expect(pathClasses()).toEqual(classesBefore)
  })

  it('換選取：舊外框移除、畫新的（合併組裡的里也只框自己）；清掉選取就移除外框', async () => {
    const wrapper = await mountMap({ selectedCode: BENYANG })
    expect(outlines()).toHaveLength(1)
    const first = outlines()[0]
    await wrapper.setProps({ selectedCode: LONGZI })
    expect(first.remove).toHaveBeenCalledTimes(1)
    expect(outlines()).toHaveLength(2)
    expect(outlines()[1].data.properties).toMatchObject({ VILLCODE: LONGZI, VILLNAME: '龍子里' })
    const second = outlines()[1]
    await wrapper.setProps({ selectedCode: '' })
    expect(second.remove).toHaveBeenCalledTimes(1)
    expect(outlines()).toHaveLength(2) // 沒有再畫新的
    expect(villagesLayer().remove).not.toHaveBeenCalled()
    expect(leaflet.created.geoJSON).toHaveLength(3)
  })

  it('selectedCode 在里界裡找不到：不畫外框也不丟錯（舊的外框要清掉）', async () => {
    const wrapper = await mountMap({ selectedCode: BENYANG })
    const first = outlines()[0]
    await wrapper.setProps({ selectedCode: '64000099999' })
    expect(first.remove).toHaveBeenCalledTimes(1)
    expect(outlines()).toHaveLength(1)
  })

  it('一開始就帶著 selectedCode（網址有 village）：建圖時畫外框，且在取視野與里界之後', async () => {
    await mountMap({ selectedCode: BENYANG })
    const [outline] = outlines()
    expect(outline.data.properties.VILLCODE).toBe(BENYANG)
    expect(outline.addTo.mock.invocationCallOrder[0]).toBeGreaterThan(one('map').fitBounds.mock.invocationCallOrder[0])
    expect(outline.addTo.mock.invocationCallOrder[0]).toBeGreaterThan(villagesLayer().addTo.mock.invocationCallOrder[0])
  })

  it('里界整層重畫（換版面、換里界檔）：外框跟著重畫在新里界之後，舊的移除', async () => {
    const wrapper = await mountMap({ selectedCode: BENYANG })
    const first = outlines()[0]
    await wrapper.setProps({ narrow: true })
    expect(villagesLayer().remove).toHaveBeenCalled()
    expect(first.remove).toHaveBeenCalledTimes(1)
    expect(outlines()).toHaveLength(2)
    const redrawn = leaflet.created.geoJSON!.filter((layer) => layer.options.pane !== 'area-selected')[1]
    expect(outlines()[1].addTo.mock.invocationCallOrder[0]).toBeGreaterThan(redrawn.addTo.mock.invocationCallOrder[0])
    await wrapper.setProps({ boundaries: villageBoundaries() })
    expect(outlines()).toHaveLength(3)
    expect(outlines()[1].remove).toHaveBeenCalledTimes(1)
  })

  it('換模式或換資料只換各里 class，不動選取外框', async () => {
    const wrapper = await mountMap({ selectedCode: BENYANG, opportunity: areaOpportunity() })
    const outline = outlines()[0]
    await wrapper.setProps({ mode: 'opportunity' })
    await wrapper.setProps({ villages: [] })
    expect(outline.remove).not.toHaveBeenCalled()
    expect(leaflet.created.geoJSON).toHaveLength(2)
  })

  it('外框的顏色走 token（--ink），元件裡不寫色碼；建圖失敗清半成品時外框不會殘留引用', () => {
    const source = readFileSync(join(__dirname, '..', 'components', 'admissions', 'area', 'AreaMap.vue'), 'utf8')
    expect(source).toMatch(/\.area-map :deep\(\.area-village-selected\)\s*\{\s*stroke: var\(--ink\);\s*\}/)
    expect(source.slice(source.indexOf('<style'))).not.toMatch(/rgba?\(|oklch\(|hsla?\(|#[0-9a-f]{3,8}\b/i)
  })

  it('focusVillage：里不在視野才 panTo 該里的中心，不改縮放；已在視野或找不到代碼就不動', async () => {
    const wrapper = await mountMap()
    const vm = wrapper.vm as unknown as { focusVillage: (code: string) => void }
    const map = one('map')
    vm.focusVillage(LONGZI)
    expect(map.panTo).toHaveBeenCalledTimes(1)
    expect(map.panTo).toHaveBeenCalledWith({ centerOf: LONGZI })
    expect(map.setView).not.toHaveBeenCalled()
    expect(map.fitBounds).toHaveBeenCalledTimes(1) // 只有建圖時那次
    map.panTo.mockClear()
    map.getBounds.mockReturnValue({ contains: () => true })
    vm.focusVillage(BENYANG)
    expect(map.panTo).not.toHaveBeenCalled()
    map.getBounds.mockReturnValue({ contains: () => false })
    vm.focusVillage('64000099999')
    expect(map.panTo).not.toHaveBeenCalled()
  })

  it('focusVillage：地圖沒建起來（Leaflet 載入失敗）時什麼都不做、不丟錯', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await chunkFails()
      const wrapper = await mountMap()
      expect(leaflet.created.map).toBeUndefined()
      expect(() => (wrapper.vm as unknown as { focusVillage: (code: string) => void }).focusVillage(BENYANG)).not.toThrow()
    } finally {
      logged.mockRestore()
    }
  })

  it.each([
    ['visits', '義華周邊里界地圖（依參觀著色）；同樣的資料在下方的參觀來源表與幼兒園清單'],
    ['children', '義華周邊里界地圖（依2–5 歲孩子著色）；同樣的資料在下方的各里表與幼兒園清單'],
    ['trend', '義華周邊里界地圖（依孩子增減著色）；同樣的資料在下方的各里表與幼兒園清單'],
    ['homes', '義華周邊里界地圖（依新屋交屋著色）；同樣的資料在下方的各里表與幼兒園清單'],
    ['opportunity', '義華周邊里界地圖（依招生機會著色）；同樣的資料在下方的各里表與幼兒園清單'],
    ['enrolled', '義華周邊在籍學生住處地圖（每格約 100 公尺標一點）；同樣的資料在下方的在籍學生表'],
    ['peers', '義華周邊里界地圖（里不上色，標出附近的幼兒園）；同樣的資料在下方的同業收費表與幼兒園清單'],
  ])('地圖名稱：%s 模式指到對應的表格分頁', async (mode, label) => {
    const wrapper = await mountMap({ mode })
    expect(wrapper.get('.area-map__canvas').attributes('aria-label')).toBe(label)
  })

  it('地圖不再有著色模式鈕與停用原因（搬到 AreaTab 的工具列）', async () => {
    const wrapper = await mountMap({ mode: 'opportunity' })
    expect(wrapper.find('.area-map__modes').exists()).toBe(false)
    expect(wrapper.find('.area-map__mode-note').exists()).toBe(false)
    expect(wrapper.find('[aria-label="地圖著色"]').exists()).toBe(false)
  })
})
