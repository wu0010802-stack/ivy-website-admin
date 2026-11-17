// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch, type App, type Component } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { bandPaths, rosettePaths } from '../app/utils/guilloche'
import AdmissionContent from '../app/components/AdmissionContent.vue'

// 2026-11-05 前台流暢度：入學頁防偽細紋（F6）。環境頁圓點小路（E1、E2）已隨 2026-11-17 改版拿掉，見下方說明。
// 外觀、節奏、觸發時機都不變，這裡守的是「少做的那些事」真的沒做，以及該做的照舊做。

// 元件測試：Nuxt 的自動匯入在單元測試裡沒有，這裡補上
const autoImports = () => {
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('nextTick', nextTick)
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
}
autoImports()

vi.mock('../app/utils/guilloche', async (importOriginal) => {
  const real = await importOriginal<typeof import('../app/utils/guilloche')>()
  return { ...real, bandPaths: vi.fn(real.bandPaths), rosettePaths: vi.fn(real.rosettePaths) }
})

/** 暫時改掉原型上的屬性（happy-dom 沒有版面），測完還原 */
const restores: (() => void)[] = []
function patch(proto: object, key: string, desc: PropertyDescriptor) {
  const previous = Object.getOwnPropertyDescriptor(proto, key)
  Object.defineProperty(proto, key, { configurable: true, ...desc })
  restores.push(() => (previous ? Object.defineProperty(proto, key, previous) : delete (proto as Record<string, unknown>)[key]))
}

/** requestAnimationFrame 換成不會自己跑的假排程（收著不執行） */
const frames = new Map<number, FrameRequestCallback>()
let frameId = 0

beforeEach(() => {
  frames.clear()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
})
afterEach(() => {
  restores.splice(0).reverse().forEach((restore) => restore())
  vi.unstubAllGlobals()
  autoImports()
  document.body.innerHTML = ''
})

// E1（環境頁圓點小路每條路線只建一次）、E2（還沒亮的圓點不進重繪）兩組在 2026-11-17 拿掉：環境頁改成「拱窗打開」版，
// 六個空間的圓點小路沒有了、一天五餐的圓點小路改成純 CSS，utils/environment-route.ts 整支刪除（見 DESIGN.md「環境頁拱窗打開」）。
// 新版捲動敘事的守門測試在 tests/environment-windows-20261117.spec.ts。

describe('F6 入學頁防偽細紋：寬度與尺寸都沒變的 resize 不重算（AdmissionContent.vue）', () => {
  const site = fixture as unknown as SiteContent
  const NuxtLink = defineComponent({
    props: { to: { type: String, required: true } },
    setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.())
  })
  let app: App | null = null
  let width = 800
  afterEach(() => { app?.unmount(); app = null })
  beforeEach(() => {
    width = 800
    // 減少動態：不載 gsap，印章直接出現（這裡換成空元件）
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
    patch(HTMLElement.prototype, 'clientWidth', { get(this: HTMLElement) { return this.matches('[data-band],[data-rosette]') ? width : 0 } })
  })
  const resize = async () => {
    window.dispatchEvent(new Event('resize'))
    await new Promise((resolve) => setTimeout(resolve, 200))
    await nextTick()
  }

  it('只有高度變（手機網址列收合）：不重算、畫面上的細紋還是同一批；寬度變了照舊重畫', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp({ render: () => h(AdmissionContent as Component, { admission: site.admission, campuses: site.campuses }) })
    app.component('NuxtLink', NuxtLink)
    app.component('PassportStamp', defineComponent({ render: () => null }))
    app.config.warnHandler = () => {}
    app.mount(host)
    await nextTick()
    const bands = vi.mocked(bandPaths)
    const rosettes = vi.mocked(rosettePaths)
    expect(bands.mock.calls.length).toBeGreaterThan(0)
    expect(rosettes.mock.calls.length).toBeGreaterThan(0)
    const drawn = [...document.querySelectorAll('.ap-band path, .ap-rosette path')]
    expect(drawn.length).toBeGreaterThan(0)
    bands.mockClear()
    rosettes.mockClear()

    await resize()
    expect(bands).not.toHaveBeenCalled()
    expect(rosettes).not.toHaveBeenCalled()
    expect([...document.querySelectorAll('.ap-band path, .ap-rosette path')]).toEqual(drawn)

    width = 700
    await resize()
    expect(bands).toHaveBeenCalledWith(700)
    expect(rosettes).toHaveBeenCalledWith('hero', 700)
    expect(document.querySelector('.ap-band')!.getAttribute('viewBox')).toBe('0 0 700 24')
  })
})
