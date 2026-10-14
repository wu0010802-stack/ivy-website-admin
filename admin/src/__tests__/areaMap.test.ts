// 區域分析地圖（2026-10-08 規格 9.3）：Leaflet 整個 mock 掉，驗呼叫與參數；
// 元件用動態 import 載入 Leaflet，所以掛載後要等 import 完成才看得到地圖。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import {
  areaBabycare, areaKindergartens, areaOpportunity, areaStats, areaTrends, babycareItem, button, villageBoundaries,
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
      return layer('map', {
        element, options, fitBounds: vi.fn(), setView: vi.fn(), getZoom: vi.fn(() => 13), invalidateSize: vi.fn(),
        dragging: handler(), touchZoom: handler(), attributionControl: { setPrefix: vi.fn() },
        remove: vi.fn(() => { delete element._leaflet_id }),
      })
    }),
    tileLayer: vi.fn((url: string, options: Record<string, unknown>) => layer('tileLayer', { url, options })),
    // 里界圖層：每個 feature 一個子圖形，像真 Leaflet 的 SVG renderer 一樣在建立時把 className 與 leaflet-interactive
    // 掛到 <path> 上（之後 setStyle 不會再動 class），eachLayer 逐一走過。
    geoJSON: vi.fn((data: { features?: unknown[] } | undefined, options: Record<string, any>) => {
      const children = (data?.features ?? []).map((feature) => {
        const className: string = options.style(feature).className
        const element = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        element.setAttribute('class', `${className} leaflet-interactive`)
        return { feature, options: { className }, getElement: () => element }
      })
      return layer('geoJSON', { data, options, children, eachLayer: vi.fn((fn: (child: unknown) => void) => children.forEach(fn)) })
    }),
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
    expect(canvas.attributes('aria-label')).toBe('義華周邊里界地圖（依參觀人數著色）；同樣的資料在下方的里排行與幼兒園清單')
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
      const village = { bindPopup: vi.fn(), bindTooltip: vi.fn() }
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
  const popupOf = (item: ReturnType<typeof coded>) => {
    const village = { bindPopup: vi.fn(), bindTooltip: vi.fn() }
    latest().options.onEachFeature(item, village)
    return village.bindPopup.mock.calls[0]![0]() as HTMLElement
  }
  async function choose(wrapper: VueWrapper, mode: string) {
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', mode)
    await flushPromises()
  }

  it('五種著色，預設參觀人數；招生機會用不了時那兩種停用並寫原因', async () => {
    const ready = await mountMap({ opportunity: areaOpportunity(), opportunityNote: '' })
    expect(ready.findAll('.el-radio-button').map((item) => item.text())).toEqual(['參觀人數', '2–5 歲孩子', '招生機會', '孩子增減', '新屋交屋'])
    expect(ready.findAll('.el-radio-button.is-disabled')).toHaveLength(0)
    expect(ready.findAll('.el-radio-button')[0]!.classes()).toContain('is-active')
    expect(ready.find('.area-map__mode-note').exists()).toBe(false)

    const missing = await mountMap({ opportunity: null, opportunityNote: '各里人口資料尚未匯入；匯入後就能看哪些里孩子多、參觀少。' })
    expect(missing.findAll('.el-radio-button.is-disabled').map((item) => item.text())).toEqual(['2–5 歲孩子', '招生機會'])
    expect(missing.get('.area-map__mode-note').text()).toBe('各里人口資料尚未匯入；匯入後就能看哪些里孩子多、參觀少。')
  })

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
    const wrapper = await mountMap({ opportunity: areaOpportunity() })
    await choose(wrapper, 'children')
    expect([DINGJIN, BENYANG, BAOYE, LONGZI].map(classOf)).toEqual([
      'area-village area-village--l5', 'area-village area-village--l3', 'area-village area-village--l2', 'area-village area-village--l0',
    ])
    expect(wrapper.findAll('.area-legend--levels li')[0]!.text()).toBe('1–100 位')
    expect(wrapper.get('.area-map__canvas').attributes('aria-label')).toContain('依2–5 歲孩子著色')
  })

  it('招生機會：明顯偏少、差不多、比附近多三色，其餘不上色；圖例；彈出框寫孩子、參觀、應有與判讀', async () => {
    const wrapper = await mountMap({ opportunity: areaOpportunity() })
    await choose(wrapper, 'opportunity')
    expect([DINGJIN, BENYANG, BAOYE, LONGZI].map(classOf)).toEqual([
      'area-village area-village--chance', 'area-village area-village--typical', 'area-village area-village--strong',
      'area-village area-village--l0',
    ])
    expect(wrapper.findAll('.area-legend--signals li').map((item) => item.text()))
      .toEqual(['明顯偏少', '差不多', '比附近多', '孩子少、還不判斷、在半徑外或沒有人口資料'])
    expect([...popupOf(DINGJIN).children].map((node) => node.textContent)).toEqual([
      '三民區鼎金里', '2–5 歲 500 位・0–1 歲 150 位', '參觀 3 位（0.6%），照附近應有約 10 位', '少了約 7 位',
    ])
    // 有參觀的里照樣可以「查看明細」；不在半徑內的里寫出來，不留空白。
    expect(popupOf(BENYANG).querySelector('button')?.textContent).toBe('查看明細')
    expect([...popupOf(LONGZI).children].map((node) => node.textContent)).toEqual(['鼓山區龍子里', '不在本校 3 公里內', '查看明細'])
  })

  it('半徑內但人口表沒有的里：不上色，彈出框寫沒有人口資料與參觀人數，不寫成不在半徑內', async () => {
    const base = areaOpportunity()
    const wrapper = await mountMap({
      opportunity: {
        ...base,
        villages: base.villages.filter((row) => row.village_code !== BENYANG.properties.VILLCODE),
        no_population_villages: [{ district: '三民區', village: '本揚里', village_code: BENYANG.properties.VILLCODE, distance_m: 300, visit: 6 }],
      },
    })
    await choose(wrapper, 'opportunity')
    expect(classOf(BENYANG)).toBe('area-village area-village--l0')
    expect([...popupOf(BENYANG).children].map((node) => node.textContent)).toEqual([
      '三民區本揚里', '這個里沒有人口資料，沒有算進附近平均', '參觀 6 位', '查看明細',
    ])
    // 真的在半徑外的里照舊。
    expect([...popupOf(LONGZI).children].map((node) => node.textContent)).toEqual(['鼓山區龍子里', '不在本校 3 公里內', '查看明細'])
  })

  it('換半徑重讀中：留在招生機會、先不上色，彈出框寫讀取中；資料回來再上色', async () => {
    const wrapper = await mountMap({ opportunity: areaOpportunity() })
    await choose(wrapper, 'opportunity')
    await wrapper.setProps({ opportunity: null, opportunityNote: '' })
    await flushPromises()
    expect(wrapper.findAll('.el-radio-button')[2]!.classes()).toContain('is-active')
    expect(classOf(DINGJIN)).toBe('area-village area-village--l0')
    expect([...popupOf(DINGJIN).children].map((node) => node.textContent)).toEqual(['三民區鼎金里', '招生機會讀取中…'])
    await wrapper.setProps({ opportunity: areaOpportunity() })
    await flushPromises()
    expect(classOf(DINGJIN)).toBe('area-village area-village--chance')
    expect(leaflet.created.geoJSON).toHaveLength(1)
  })

  it('招生機會變得用不了（換校區後人口沒匯入、讀取失敗）：退回參觀人數著色', async () => {
    const wrapper = await mountMap({ opportunity: areaOpportunity() })
    await choose(wrapper, 'opportunity')
    await wrapper.setProps({ opportunity: null, opportunityNote: '招生機會讀取失敗。' })
    await flushPromises()
    expect(wrapper.findAll('.el-radio-button')[0]!.classes()).toContain('is-active')
    expect(classOf(BENYANG)).toBe('area-village area-village--l5')
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
  const popupLines = (item: ReturnType<typeof coded>) => {
    const village = { bindPopup: vi.fn(), bindTooltip: vi.fn() }
    latest().options.onEachFeature(item, village)
    return [...(village.bindPopup.mock.calls[0]![0]() as HTMLElement).children].map((node) => node.textContent)
  }
  async function choose(wrapper: VueWrapper, mode: string) {
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', mode)
    await flushPromises()
  }

  it('增加多、減少依分級上色；里界調整合併的組、半徑外不上色；圖例；地圖名稱跟著換', async () => {
    const wrapper = await mountMap({ trends: areaTrends() })
    await choose(wrapper, 'trend')
    expect([BENYANG, DINGJIN, BAOYE, LONGZI, OUTSIDE].map(classOf)).toEqual([
      'area-village area-village--up2', 'area-village area-village--down1',
      // 寶業里、龍子里是同一個合併組：數字是整組的，不替組內各里上色。
      'area-village area-village--l0', 'area-village area-village--l0', 'area-village area-village--l0',
    ])
    expect(wrapper.findAll('.area-legend--signals li').map((item) => item.text()))
      .toEqual(['增加多', '增加', '差不多', '減少', '減少多', '孩子少、里界調整、在半徑外或沒有資料'])
    expect(wrapper.get('.area-map__canvas').attributes('aria-label')).toContain('依孩子增減著色）；同樣的資料在下方的里的變化表')
  })

  it('彈出框：孩子與一年前、淨增與分級、出生與淨遷入；合併組先寫合併；半徑外寫不在範圍內', async () => {
    const wrapper = await mountMap({ trends: areaTrends() })
    await choose(wrapper, 'trend')
    expect(popupLines(BENYANG)).toEqual([
      '三民區本揚里', '2–5 歲 317 位（一年前 1–4 歲 281 位）', '這一年淨增 +36（+12.8%）・增加多', '近 12 個月出生 36 位・淨遷入 \u2212122 人', '查看明細',
    ])
    expect(popupLines(LONGZI)).toEqual([
      '鼓山區龍子里', '里界調整過，和同區的里合併計算：三民區寶業里、龍子里（里界調整，合併）',
      '2–5 歲 583 位（一年前 1–4 歲 600 位）', '這一年淨增 +12（+2.0%）・差不多', '近 12 個月出生 90 位・淨遷入 +30 人', '查看明細',
    ])
    expect(popupLines(OUTSIDE)).toEqual(['小港區青島里', '不在本校 3 公里內'])
  })

  it('孩子增減用不了時停用並寫原因；正在看的人退回參觀人數', async () => {
    const wrapper = await mountMap({ trends: areaTrends() })
    await choose(wrapper, 'trend')
    await wrapper.setProps({ trendNote: '一年前的各里人口還沒匯入，這一年淨增先不算。' })
    await flushPromises()
    expect(wrapper.findAll('.el-radio-button')[0]!.classes()).toContain('is-active')
    expect(wrapper.findAll('.el-radio-button.is-disabled').map((item) => item.text())).toEqual(['孩子增減'])
    expect(wrapper.get('.area-map__mode-note').text()).toBe('一年前的各里人口還沒匯入，這一年淨增先不算。')
  })

  it('讀取中（換半徑）：留在孩子增減、先不上色，彈出框寫讀取中', async () => {
    const wrapper = await mountMap({ trends: areaTrends() })
    await choose(wrapper, 'trend')
    await wrapper.setProps({ trends: null, trendNote: '' })
    await flushPromises()
    expect(wrapper.findAll('.el-radio-button')[3]!.classes()).toContain('is-active')
    expect(classOf(BENYANG)).toBe('area-village area-village--l0')
    expect(popupLines(DINGJIN)).toEqual(['三民區鼎金里', '里的變化讀取中…'])
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
  const popupLines = (item: ReturnType<typeof coded>) => {
    const village = { bindPopup: vi.fn(), bindTooltip: vi.fn() }
    latest().options.onEachFeature(item, village)
    return [...(village.bindPopup.mock.calls[0]![0]() as HTMLElement).children].map((node) => node.textContent)
  }
  async function choose(wrapper: VueWrapper, mode: string) {
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', mode)
    await flushPromises()
  }

  it('近 4 季筆數依半徑內最多的里分 5 級（同參觀人數的切法）；合併組、0 筆、半徑外不上色；圖例寫「筆」；地圖名稱跟著換', async () => {
    const wrapper = await mountMap({ trends: areaTrends() })
    await choose(wrapper, 'homes')
    // 本揚里 24 筆、鼎金里 106 筆（最多）；寶業里、龍子里是同一個合併組：數字是整組的，不替組內各里上色。
    expect([BENYANG, DINGJIN, BAOYE, LONGZI, OUTSIDE].map(classOf)).toEqual([
      'area-village area-village--l2', 'area-village area-village--l5',
      'area-village area-village--l0', 'area-village area-village--l0', 'area-village area-village--l0',
    ])
    expect(wrapper.findAll('.area-legend--levels li').map((item) => item.text()))
      .toEqual(['1–21 筆', '22–42 筆', '43–63 筆', '64–84 筆', '85–106 筆', '0 筆、里界調整、在半徑外'])
    expect(wrapper.get('.area-map__canvas').attributes('aria-label')).toContain('依新屋交屋著色）；同樣的資料在下方的里的變化表')
  })

  it('半徑內都沒有交屋：圖例換成一句話，不留空圖例', async () => {
    const base = areaTrends()
    const wrapper = await mountMap({ trends: areaTrends({ villages: base.villages.map((row) => ({ ...row, new_homes: 0, new_homes_latest: 0 })) }) })
    await choose(wrapper, 'homes')
    expect(wrapper.find('.area-legend--levels').exists()).toBe(false)
    expect(wrapper.get('.area-map__none').text()).toBe('半徑內近 4 季沒有新屋交屋。')
  })

  it('彈出框：近 4 季與最近一季；合併組先寫合併、數字是整組的；半徑外寫不在範圍內', async () => {
    const wrapper = await mountMap({ trends: areaTrends() })
    await choose(wrapper, 'homes')
    expect(popupLines(BENYANG)).toEqual(['三民區本揚里', '近 4 季新屋交屋 24 筆', '最近一季（115S3）9 筆', '查看明細'])
    expect(popupLines(LONGZI)).toEqual([
      '鼓山區龍子里', '里界調整過，和同區的里合併計算：三民區寶業里、龍子里（里界調整，合併）',
      '近 4 季新屋交屋 0 筆（整組）', '最近一季（115S3）0 筆', '查看明細',
    ])
    expect(popupLines(OUTSIDE)).toEqual(['小港區青島里', '不在本校 3 公里內'])
  })

  it('新屋交屋用不了時停用並寫原因（正在看的人退回參觀人數）；孩子增減停用不連帶它', async () => {
    const wrapper = await mountMap({ trends: areaTrends() })
    await choose(wrapper, 'homes')
    await wrapper.setProps({ homesNote: '新成屋資料尚未匯入。' })
    await flushPromises()
    expect(wrapper.findAll('.el-radio-button')[0]!.classes()).toContain('is-active')
    expect(wrapper.findAll('.el-radio-button.is-disabled').map((item) => item.text())).toEqual(['新屋交屋'])
    expect(wrapper.get('.area-map__mode-note').text()).toBe('新成屋資料尚未匯入。')

    const other = await mountMap({ trends: areaTrends(), trendNote: '一年前的各里人口還沒匯入，這一年淨增先不算。' })
    expect(other.findAll('.el-radio-button.is-disabled').map((item) => item.text())).toEqual(['孩子增減'])
  })

  it('讀取中（換半徑）：留在新屋交屋、先不上色，彈出框寫讀取中', async () => {
    const wrapper = await mountMap({ trends: areaTrends() })
    await choose(wrapper, 'homes')
    await wrapper.setProps({ trends: null, homesNote: '' })
    await flushPromises()
    expect(wrapper.findAll('.el-radio-button')[4]!.classes()).toContain('is-active')
    expect(classOf(BENYANG)).toBe('area-village area-village--l0')
    expect(popupLines(DINGJIN)).toEqual(['三民區鼎金里', '里的變化讀取中…'])
  })
})
