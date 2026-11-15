// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch, type App, type Component } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { createEnvironmentRoutes, type EnvironmentRoutes } from '../app/utils/environment-route'
import { bandPaths, rosettePaths } from '../app/utils/guilloche'
import AdmissionContent from '../app/components/AdmissionContent.vue'

// 2026-11-05 前台流暢度：環境頁圓點小路（E1、E2）、入學頁防偽細紋（F6）。
// 外觀、節奏、觸發時機都不變，這裡守的是「少做的那些事」真的沒做，以及該做的照舊做。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

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

/** 手動推的 requestAnimationFrame */
const frames = new Map<number, FrameRequestCallback>()
let frameId = 0
let now = 0
function runFrame(ms = 16) {
  now += ms
  const callbacks = [...frames.values()]
  frames.clear()
  callbacks.forEach((callback) => callback(now))
}

beforeEach(() => {
  frames.clear()
  now = 1000
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
})
afterEach(() => {
  restores.splice(0).reverse().forEach((restore) => restore())
  vi.unstubAllGlobals()
  autoImports()
  document.body.innerHTML = ''
})

describe('E1 環境頁圓點小路：載入時每條路線只建一次（utils/environment-route.ts）', () => {
  // 手機版面（≤640px，2026-11-13 前是 ≤900px）：小路都是直線，假的 getTotalLength／getPointAtLength 照折線算就好。
  // data-box="x y 寬 高"（相對小路宿主），宿主自己的寬高也寫在 data-box。
  const box = (el: Element) => (el.getAttribute('data-box') ?? '0 0 0 0').split(' ').map(Number) as [number, number, number, number]
  const points = (d: string) => [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const)
  let log: string[]
  let measuredOutside: number
  let ro: { callback: ResizeObserverCallback; targets: Set<Element> } | null
  let tops: Map<Element, number>

  beforeEach(() => {
    log = []
    measuredOutside = 0
    ro = null
    tops = new Map()
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('640px'), addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback
      targets = new Set<Element>()
      constructor(callback: ResizeObserverCallback) { this.callback = callback; ro = this } // eslint-disable-line @typescript-eslint/no-this-alias
      observe(target: Element) { this.targets.add(target) }
      disconnect() { this.targets.clear() }
    })
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
    restores.push(() => { delete (document as unknown as Record<string, unknown>).fonts })
    const geometry = (index: number) => ({ get(this: HTMLElement) { log.push('read'); return box(this)[index] } })
    patch(HTMLElement.prototype, 'offsetLeft', geometry(0))
    patch(HTMLElement.prototype, 'offsetTop', geometry(1))
    patch(HTMLElement.prototype, 'offsetWidth', geometry(2))
    patch(HTMLElement.prototype, 'offsetHeight', geometry(3))
    patch(HTMLElement.prototype, 'offsetParent', { get(this: HTMLElement) { return this.parentElement?.closest('[data-host]') ?? null } })
    patch(HTMLElement.prototype, 'getBoundingClientRect', { value(this: HTMLElement) { return { top: tops.get(this) ?? 0 } } })
    patch(SVGPathElement.prototype, 'getTotalLength', {
      value(this: SVGPathElement) {
        log.push('measure')
        // Safari 對文件外 path 的 getTotalLength 沒驗過：一律在小路的 svg 裡量
        if (!this.isConnected || !(this.parentNode instanceof SVGSVGElement)) measuredOutside++
        const p = points(this.getAttribute('d') ?? '')
        let length = 0
        for (let i = 1; i < p.length; i++) length += Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1])
        return length
      }
    })
    patch(SVGPathElement.prototype, 'getPointAtLength', {
      value(this: SVGPathElement, at: number) {
        const p = points(this.getAttribute('d') ?? '')
        let rest = at
        for (let i = 1; i < p.length; i++) {
          const [[x0, y0], [x1, y1]] = [p[i - 1]!, p[i]!]
          const seg = Math.hypot(x1 - x0, y1 - y0)
          if (rest <= seg) return { x: x0 + ((x1 - x0) * rest) / seg, y: y0 + ((y1 - y0) * rest) / seg }
          rest -= seg
        }
        return { x: p.at(-1)![0], y: p.at(-1)![1] }
      }
    })
  })

  /** 兩站的校園環境＋三站的餐點；宿主都在視窗下方很遠（還沒有圓點會亮） */
  function mountRoutes() {
    const root = document.createElement('main')
    root.innerHTML = `
      <div class="renv-stops" data-host data-box="0 0 390 1200">
        <svg class="renv-route" data-route="map"></svg>
        <ol>
          <li class="renv-stop" data-route-color="var(--renv-mist-side)"><span class="renv-stop-no" data-box="20 100 40 40"></span></li>
          <li class="renv-stop" data-route-color="var(--renv-pink-side)"><span class="renv-stop-no" data-box="20 600 40 40"></span></li>
        </ol>
      </div>
      <div class="renv-day-track" data-host data-box="0 0 390 600">
        <svg class="renv-route" data-route="day"></svg>
        <ol><li class="renv-stn" data-box="10 40 64 64"></li><li class="renv-stn" data-box="10 240 64 64"></li><li class="renv-stn" data-box="10 440 64 64"></li></ol>
      </div>`
    document.body.append(root)
    const [mapSvg, daySvg] = [...root.querySelectorAll<SVGSVGElement>('svg.renv-route')] as [SVGSVGElement, SVGSVGElement]
    const hosts = [mapSvg.parentElement!, daySvg.parentElement!]
    hosts.forEach((host) => tops.set(host, 5000))
    const writes = new Map<SVGSVGElement, number>()
    for (const svg of [mapSvg, daySvg]) {
      const replace = svg.replaceChildren.bind(svg)
      writes.set(svg, 0)
      svg.replaceChildren = (...nodes: (Node | string)[]) => { log.push('write'); writes.set(svg, writes.get(svg)! + 1); replace(...nodes) }
    }
    return { root, mapSvg, daySvg, hosts, writes }
  }
  const circles = (svg: SVGSVGElement) => [...svg.querySelectorAll('circle')]
  const fireResize = () => ro!.callback([...ro!.targets].map((target) => ({ target })) as unknown as ResizeObserverEntry[], ro as unknown as ResizeObserver)
  /** 載入後原本會再重建的兩個時機：字型就緒（微任務）、ResizeObserver 的初次通知（下一幀量完版面之後） */
  async function settle() {
    await Promise.resolve()
    await Promise.resolve()
    runFrame()
    fireResize()
  }
  let routes: EnvironmentRoutes | null = null
  afterEach(() => { routes?.destroy(); routes = null })

  it('載入、字型就緒、ResizeObserver 初次通知：每條路線只換一次子節點，圓點還是同一批', async () => {
    const { root, mapSvg, daySvg, writes } = mountRoutes()
    routes = createEnvironmentRoutes(root, { reducedMotion: false })
    const first = [circles(mapSvg), circles(daySvg)]
    const measured = log.filter((entry) => entry === 'measure').length
    await settle()
    expect([writes.get(mapSvg), writes.get(daySvg)]).toEqual([1, 1])
    expect([circles(mapSvg), circles(daySvg)]).toEqual(first)
    expect(log.filter((entry) => entry === 'measure')).toHaveLength(measured)
    // 手機：左邊一條直線，從第一站的編號 (40,120) 走到第二站 (40,620)，頭尾不多走（2026-11-13），間距 15、半徑 3；用要去的那一站的顏色
    expect(first[0]).toHaveLength(33)
    expect(['cx', 'cy', 'r'].map((name) => first[0]![0]!.getAttribute(name))).toEqual(['40.0', '120.0', '3'])
    expect(first[0]!.map((c) => (c as SVGElement).style.fill)).toEqual(Array(33).fill('var(--renv-pink-side)'))
    expect(first[0]!.some((c) => c.hasAttribute('class'))).toBe(false)
    // 餐點：盤子（半徑 32）之間各一小段，從盤底（含 7px 側面）再讓 7px 到下一個盤頂前 7px：(42,118)→(42,233)、(42,318)→(42,433)，
    // 間距收成 15 × 0.72，圓點在段內置中
    const perGap = Math.round(115 / (15 * 0.72))
    expect(first[1]).toHaveLength(perGap * 2)
    expect(first[1]![0]!.getAttribute('cy')).toBe((118 + (0.5 * 115) / perGap).toFixed(1))
    expect(measuredOutside).toBe(0)
  })

  it('量長度的 path 常駐在 svg 第一個、不畫東西（fill:none），每次重建都是同一條', async () => {
    const { root, mapSvg, daySvg } = mountRoutes()
    routes = createEnvironmentRoutes(root, { reducedMotion: false })
    const guides = [mapSvg.firstElementChild, daySvg.firstElementChild]
    expect(guides.map((guide) => guide?.tagName.toLowerCase())).toEqual(['path', 'path'])
    expect(guides.map((guide) => guide?.getAttribute('fill'))).toEqual(['none', 'none'])
    routes.refresh()
    expect([mapSvg.firstElementChild, daySvg.firstElementChild]).toEqual(guides)
    expect([mapSvg, daySvg].map((svg) => svg.querySelectorAll('path').length)).toEqual([1, 1])
    expect(measuredOutside).toBe(0)
  })

  it('先把兩條路線的版面都量完、算好點，最後才寫進 DOM（中間不再寫完又讀）', () => {
    const { root } = mountRoutes()
    routes = createEnvironmentRoutes(root, { reducedMotion: false })
    log = []
    routes.refresh()
    expect(log.filter((entry) => entry === 'write')).toHaveLength(2)
    expect(log.lastIndexOf('read')).toBeLessThan(log.indexOf('measure'))
    expect(log.lastIndexOf('measure')).toBeLessThan(log.indexOf('write'))
  })

  it('後台即時預覽的 refresh 照舊整套重建（換成新的圓點）', () => {
    const { root, mapSvg, writes } = mountRoutes()
    routes = createEnvironmentRoutes(root, { reducedMotion: false })
    const before = circles(mapSvg)
    routes.refresh()
    expect(writes.get(mapSvg)).toBe(2)
    expect(circles(mapSvg)).toHaveLength(before.length)
    expect(circles(mapSvg)[0]).not.toBe(before[0])
  })

  it('版面變了（照片載好、改字）就照新版面重建', async () => {
    const { root, mapSvg, writes } = mountRoutes()
    routes = createEnvironmentRoutes(root, { reducedMotion: false })
    await settle()
    const written = writes.get(mapSvg)!
    root.querySelectorAll('.renv-stop-no')[1]!.setAttribute('data-box', '20 900 40 40')
    fireResize()
    expect(writes.get(mapSvg)).toBe(written + 1)
    // 整條變成 (40,120)→(40,920)，撒 53 顆，最後一顆在 120 + 52×800/53
    expect(circles(mapSvg).at(-1)!.getAttribute('cy')).toBe((120 + (52 * 800) / 53).toFixed(1))
  })

  it('已經有圓點亮過（直接連到 #spaces）時，ResizeObserver、字型就緒照舊重建：亮過的換成直接亮好的新圓點', async () => {
    const { root, mapSvg, hosts, writes } = mountRoutes()
    // 小路只到最後一站（y=620），宿主頂在 300 時先亮上半段，之後捲到 0 才有新的圓點要亮
    tops.set(hosts[0]!, 300)
    let fontsReady = () => {}
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise<void>((resolve) => { fontsReady = resolve }) } })
    routes = createEnvironmentRoutes(root, { reducedMotion: false })
    const expectRebuiltLit = async (rebuild: () => Promise<void>) => {
      runFrame()
      const before = circles(mapSvg)
      const lit = before.filter((c) => c.classList.contains('is-on')).length
      expect(lit).toBeGreaterThan(0)
      expect(before.some((c) => (c as SVGElement).style.transitionDelay)).toBe(true)
      const written = writes.get(mapSvg)!
      await rebuild()
      expect(writes.get(mapSvg)).toBe(written + 1)
      const rebuilt = circles(mapSvg)
      expect(rebuilt[0]).not.toBe(before[0])
      expect(rebuilt.filter((c) => c.classList.contains('is-on'))).toHaveLength(lit)
      expect(rebuilt.every((c) => !(c as SVGElement).style.transitionDelay)).toBe(true)
    }
    await expectRebuiltLit(async () => fireResize())
    // 字型這時才載好（版面沒變），再往下捲一點讓更多圓點正在亮：照舊重建
    tops.set(hosts[0]!, 0)
    await expectRebuiltLit(async () => {
      fontsReady()
      await Promise.resolve()
      await Promise.resolve()
    })
  })

  it('減少動態：一開始就全亮', () => {
    const { root, mapSvg } = mountRoutes()
    routes = createEnvironmentRoutes(root, { reducedMotion: true })
    expect(circles(mapSvg).every((c) => c.classList.contains('is-on'))).toBe(true)
  })
})

describe('E2 還沒亮的圓點不進重繪（environment.css）', () => {
  const css = read('../app/assets/css/environment.css')
  it('未亮 visibility:hidden、亮起與減少動態時 visible；轉場清單照舊只有 opacity 與 transform', () => {
    expect(css).toContain('.renv-route circle{opacity:0;transform:scale(.2);transform-box:fill-box;transform-origin:center;visibility:hidden;transition:opacity .35s var(--renv-ease),transform .5s var(--renv-ease)}')
    expect(css).toContain('.renv-route circle.is-on{opacity:1;transform:none;visibility:visible}')
    expect(css).toContain('@media (prefers-reduced-motion:reduce){.renv-route circle{opacity:1;transform:none;visibility:visible}}')
    // 積木（[data-drop]）裡有連結與照片 alt，不能用 visibility 藏
    expect(css).not.toMatch(/\[data-drop\][^{]*\{[^}]*visibility/)
  })
})

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
