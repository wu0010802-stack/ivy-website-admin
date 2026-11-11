// @vitest-environment happy-dom
// 2026-11-11 首頁「孩子的一天」拍立得：共用的 WebGL context 遺失時退回 CSS 版（README 同日段落、DESIGN.md 同日章節）。
// 整頁只有一個 WebGL context（utils/paperPrints.ts 的共用 renderer），每張卡 render 完再把它的畫布 drawImage 到自己的 2D 畫布。
// 手機切到背景、記憶體吃緊時 context 會被系統收走：three 的 render 什麼都不畫，共用畫布留著最後一張成功畫出的卡，
// 原本照樣複製——WebKit（iPhone）之後每張卡都變成那一張、點了不翻、還原後也不重畫；Chromium 則整張卡消失。
// three 換成假的（可以指定 context 遺失、建不出 context），2D canvas 換成記錄 drawImage 的假 context；happy-dom 沒有 WebGL 與 canvas。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, onMounted, onUnmounted, ref, shallowRef, watch, type App, type Component } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { DayExperienceContent } from '../app/types/site-content'
import type { PaperHandle } from '../app/utils/paperPrints'
import DayMomentCard from '../app/components/DayMomentCard.vue'
import ResponsivePicture from '../app/components/ResponsivePicture.vue'

vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('shallowRef', shallowRef)
vi.stubGlobal('watch', watch)
vi.stubGlobal('nextTick', nextTick)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onUnmounted', onUnmounted)

interface FakeRenderer {
  domElement: HTMLCanvasElement
  /** 測試把它設成 true＝context 被系統收走（事件另外派發，瀏覽器也是晚一拍才通知） */
  lost: boolean
  renders: number
  disposed: boolean
}
const three = vi.hoisted(() => ({ renderers: [] as FakeRenderer[], failCreate: false }))
vi.mock('../app/utils/three-lite', () => {
  class V3 {
    x = 0
    y = 0
    z = 0
    set(x: number, y: number, z: number) {
      this.x = x
      this.y = y
      this.z = z
      return this
    }
    length() {
      return Math.hypot(this.x, this.y, this.z)
    }
  }
  class Obj {
    position = new V3()
    rotation = new V3()
    children: Obj[] = []
    castShadow = false
    receiveShadow = false
    renderOrder = 0
    add(...items: Obj[]) {
      this.children.push(...items)
      return this
    }
    traverse(fn: (obj: Obj) => void) {
      fn(this)
      for (const child of this.children) child.traverse(fn)
    }
  }
  class PlaneGeometry {
    attributes: Record<string, { array: Float32Array; count: number; needsUpdate: boolean }>
    index: { array: Uint16Array }
    constructor(_w = 1, _h = 1, sx = 1, sy = 1) {
      const n = (sx + 1) * (sy + 1)
      this.attributes = {
        position: { array: new Float32Array(n * 3), count: n, needsUpdate: false },
        normal: { array: new Float32Array(n * 3), count: n, needsUpdate: false }
      }
      this.index = { array: new Uint16Array(sx * sy * 6) }
    }
    translate() {
      return this
    }
    dispose() {}
  }
  class Material {
    constructor(options: Record<string, unknown> = {}) {
      Object.assign(this, options)
    }
    dispose() {}
  }
  class Light extends Obj {
    intensity: number
    constructor(_color?: number, intensity = 1) {
      super()
      this.intensity = intensity
    }
  }
  class DirectionalLight extends Light {
    isDirectionalLight = true
    shadow = { mapSize: { set() {} }, camera: {}, radius: 0, dispose() {} }
  }
  class Mesh extends Obj {
    isMesh = true
    constructor(public geometry: PlaneGeometry, public material: Material) {
      super()
    }
  }
  class WebGLRenderer {
    domElement = document.createElement('canvas')
    shadowMap: Record<string, unknown> = {}
    width = 0
    height = 0
    lost = false
    renders = 0
    disposed = false
    constructor() {
      if (three.failCreate) throw new Error('Error creating WebGL context.')
      three.renderers.push(this)
    }
    getContext() {
      return { isContextLost: () => this.lost }
    }
    setPixelRatio() {}
    compileAsync() {
      return Promise.resolve()
    }
    getSize(v: { x: number; y: number }) {
      v.x = this.width
      v.y = this.height
      return v
    }
    setSize(width: number, height: number) {
      this.width = width
      this.height = height
    }
    // 跟 three 一樣：context 遺失時 render 直接回來，畫布留著上一次畫的東西
    render() {
      if (!this.lost) this.renders += 1
    }
    dispose() {
      this.disposed = true
    }
  }
  class CanvasTexture {
    colorSpace = ''
    anisotropy = 1
    needsUpdate = false
    constructor(public image: HTMLCanvasElement) {}
    dispose() {}
  }
  return {
    WebGLRenderer,
    CanvasTexture,
    Scene: Obj,
    Group: Obj,
    PerspectiveCamera: Obj,
    Mesh,
    PlaneGeometry,
    MeshStandardMaterial: Material,
    ShadowMaterial: Material,
    AmbientLight: Light,
    PointLight: Light,
    DirectionalLight,
    Vector2: class { x = 0; y = 0 },
    MathUtils: { degToRad: (deg: number) => (deg * Math.PI) / 180 },
    SRGBColorSpace: 'srgb',
    PCFShadowMap: 1,
    CustomBlending: 5,
    SrcAlphaFactor: 204,
    OneMinusSrcAlphaFactor: 205,
    OneFactor: 201
  }
})
vi.mock('../app/utils/paper-warm', () => ({ warmPaper: () => {}, warmPaperWhenIdle: () => {} }))

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

// ---- 瀏覽器替身：媒體查詢、rAF、觀察器、canvas、圖片尺寸 ----

const media: Record<string, boolean> = {}
function matchMedia(query: string) {
  return { matches: media[query] ?? false, media: query, addEventListener() {}, removeEventListener() {} }
}

let frames: Array<{ id: number; cb: FrameRequestCallback }> = []
let frameId = 0
let clock = 1000
function runFrame() {
  const due = frames
  frames = []
  clock += 16
  for (const frame of due) frame.cb(clock)
}
/** 讓 await 往下走，每輪跑一次 rAF（mountPaper 中間要等一幀）。 */
async function pump(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    runFrame()
  }
}

const observers: Array<{ callback: IntersectionObserverCallback; options?: IntersectionObserverInit; targets: Element[] }> = []

// 假的 2D context：記下誰被 drawImage 到哪一張畫布上
let copies: Array<{ target: HTMLCanvasElement; source: unknown }> = []
function fake2d(canvas: HTMLCanvasElement) {
  const state: Record<string | symbol, unknown> = { canvas, globalAlpha: 1, textAlign: 'left' }
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key]
      if (key === 'measureText') return (text: string) => ({ width: text.length * 10, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 })
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (key === 'drawImage') return (source: unknown) => {
        copies.push({ target: canvas, source })
      }
      return () => {}
    },
    set(target, key, value) {
      target[key] = value
      return true
    }
  })
}
/** 共用 renderer 的畫布被複製到這張卡的顯示畫布幾次 */
const copiesTo = (view: Element | null) => copies.filter((c) => c.target === view && three.renderers.some((r) => r.domElement === c.source)).length
const viewOf = (wrap: HTMLElement) => wrap.querySelector<HTMLCanvasElement>('canvas.paper-view')

function loseContext(renderer: FakeRenderer, notify = true) {
  renderer.lost = true
  if (notify) renderer.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
}

const originals = new Map<string, PropertyDescriptor | undefined>()
function override(proto: object, name: string, descriptor: PropertyDescriptor) {
  const key = `${proto.constructor.name}.${name}`
  if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(proto, name))
  Object.defineProperty(proto, name, { configurable: true, ...descriptor })
}

beforeEach(() => {
  // paperPrints 的共用 renderer、遺失次數是模組狀態：每個測試拿一份新的
  vi.resetModules()
  three.renderers.length = 0
  three.failCreate = false
  frames = []
  clock = 1000
  copies = []
  observers.length = 0
  for (const key of Object.keys(media)) delete media[key]
  vi.stubGlobal('matchMedia', matchMedia)
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push({ id: ++frameId, cb })
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames = frames.filter((frame) => frame.id !== id)
  })
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.stubGlobal('IntersectionObserver', class {
    entry: (typeof observers)[number]
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.entry = { callback, options, targets: [] }
      observers.push(this.entry)
    }
    observe(el: Element) {
      this.entry.targets.push(el)
    }
    disconnect() {}
  })
  ;(window as unknown as Record<string, unknown>).WebGLRenderingContext = function WebGLRenderingContext() {}
  override(HTMLCanvasElement.prototype, 'getContext', {
    value(this: HTMLCanvasElement, type: string) {
      if (type === '2d') return fake2d(this)
      return /webgl/.test(type) ? { getExtension: () => null } : null
    }
  })
  override(HTMLElement.prototype, 'offsetWidth', {
    get(this: HTMLElement) {
      return this.classList.contains('print-front') ? 400 : 0
    }
  })
  override(HTMLElement.prototype, 'offsetHeight', {
    get(this: HTMLElement) {
      return this.classList.contains('print-front') ? 520 : 0
    }
  })
  override(HTMLImageElement.prototype, 'complete', { get: () => true })
  override(HTMLImageElement.prototype, 'naturalWidth', { get: () => 1200 })
  override(HTMLImageElement.prototype, 'naturalHeight', { get: () => 900 })
  override(Element.prototype, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON() {} })
  })
})

afterEach(() => {
  for (const [key, descriptor] of originals) {
    const [name, prop] = key.split('.') as [string, string]
    const proto = ({ HTMLCanvasElement, HTMLElement, HTMLImageElement, Element } as Record<string, { prototype: object }>)[name]!.prototype
    if (descriptor) Object.defineProperty(proto, prop, descriptor)
    else delete (proto as Record<string, unknown>)[prop]
  }
  originals.clear()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function buildCard() {
  const host = document.createElement('div')
  host.innerHTML = `<div class="print-card"><div class="print-wrap"><div class="print">
    <span class="print-tape" style="--tape-a: rgb(10, 20, 30); --tape-b: rgb(40, 50, 60); box-shadow: 0 1px 2px rgb(1 2 3 / .15)"></span>
    <div class="print-face print-front"><figure class="print-figure"><img class="print-photo" src="/assets/day-a-800.webp" alt=""><time class="print-stamp">09:10</time></figure>
      <div class="print-foot"><p class="print-kicker">02 / 好奇探索</p><h3>今天</h3></div></div>
    <div class="print-face print-back"><p class="print-kicker">02 / 好奇探索</p><p class="print-story">故事</p>
      <div class="print-ask"><p class="print-question">問</p><p class="print-answer">答</p></div></div>
  </div></div></div>`
  document.body.append(host)
  return host.querySelector<HTMLElement>('.print-wrap')!
}

const copy = { kicker: '02 / 好奇探索', titleLines: ['今天'], time: '09:10', story: '故事', question: '問', answer: '答' }
type Initial = { developed?: boolean; flipped?: boolean; active?: boolean; canMount?: () => boolean; onLost?: () => void }

/** 等 mountPaper 有結果（紙或 null）；丟例外就讓測試紅。 */
async function settle(wrap: HTMLElement, initial: Initial = { developed: true }): Promise<PaperHandle | null> {
  const { mountPaper } = await import('../app/utils/paperPrints')
  let result: PaperHandle | null | undefined
  let failure: unknown
  mountPaper(wrap, copy, initial).then(
    (value) => (result = value),
    (error) => (failure = error ?? new Error('mountPaper rejected'))
  )
  for (let i = 0; i < 40 && result === undefined && failure === undefined; i++) await pump(1)
  if (failure) throw failure
  expect(result).not.toBeUndefined()
  return result!
}

// ---- utils/paperPrints.ts ----

describe('共用 WebGL context 遺失：不把舊畫面複製到卡片上', () => {
  it('遺失後要重畫的那一幀（事件還沒到）：不複製共用畫布，通知卡片退回 CSS 版', async () => {
    const wrap = buildCard()
    const onLost = vi.fn()
    const handle = await settle(wrap, { developed: true, onLost })
    expect(handle).toBeTruthy()
    const view = viewOf(wrap)
    expect(copiesTo(view)).toBe(1)

    loseContext(three.renderers[0]!, false)
    handle!.setFlipped(true)
    await pump(4)
    // 原本每一幀都把共用畫布（還留著最後一張成功畫出的卡）複製過來
    expect(copiesTo(view)).toBe(1)
    expect(onLost).toHaveBeenCalledTimes(1)
    handle!.dispose()
  })

  it('收到 webglcontextlost：沒有在畫的卡也都通知到，各一次', async () => {
    const a = vi.fn()
    const b = vi.fn()
    const first = await settle(buildCard(), { developed: true, onLost: a })
    const second = await settle(buildCard(), { developed: true, onLost: b })
    expect(three.renderers).toHaveLength(1)

    loseContext(three.renderers[0]!)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    // 之後有人要重畫也不再重複通知
    first!.setFlipped(true)
    await pump(3)
    expect(a).toHaveBeenCalledTimes(1)
    first!.dispose()
    second!.dispose()
  })

  it('遺失之後才掛的卡：這個 renderer 不再用，另建一個，畫出來的是自己', async () => {
    const lostCard = await settle(buildCard(), { developed: true, onLost: () => lostCard?.dispose() })
    loseContext(three.renderers[0]!)

    const wrap = buildCard()
    const handle = await settle(wrap)
    expect(handle).toBeTruthy()
    expect(three.renderers).toHaveLength(2)
    expect(three.renderers[1]!.renders).toBe(1)
    expect(copies.filter((c) => c.target === viewOf(wrap) && c.source === three.renderers[1]!.domElement)).toHaveLength(1)
    expect(copies.filter((c) => c.target === viewOf(wrap) && c.source === three.renderers[0]!.domElement)).toHaveLength(0)
    // 遺失的那個在最後一張卡卸掉後釋放
    expect(three.renderers[0]!.disposed).toBe(true)
    handle!.dispose()
  })

  it('建場途中遺失：回 null、不留下顯示畫布', async () => {
    const first = await settle(buildCard())
    const wrap = buildCard()
    const { mountPaper } = await import('../app/utils/paperPrints')
    let result: PaperHandle | null | undefined
    void mountPaper(wrap, copy, { developed: true }).then((value) => (result = value))
    // 已經拿到共用 renderer、還在等下一幀建場景
    for (let i = 0; i < 20 && !viewOf(wrap); i++) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(viewOf(wrap)).toBeTruthy()
    loseContext(three.renderers[0]!, false)
    for (let i = 0; i < 40 && result === undefined; i++) await pump(1)
    expect(result).toBeNull()
    expect(viewOf(wrap)).toBeNull()
    expect(copies.filter((c) => c.source === three.renderers[0]!.domElement)).toHaveLength(1)
    first!.dispose()
  })

  it('同一頁遺失第二次就停用 WebGL：之後都回 null（維持 CSS 版），不再建 context', async () => {
    const first = await settle(buildCard(), { developed: true, onLost: () => first?.dispose() })
    loseContext(three.renderers[0]!)
    const second = await settle(buildCard(), { developed: true, onLost: () => second?.dispose() })
    expect(second).toBeTruthy()
    loseContext(three.renderers[1]!)

    const wrap = buildCard()
    expect(await settle(wrap)).toBeNull()
    expect(three.renderers).toHaveLength(2)
    expect(viewOf(wrap)).toBeNull()
  })

  it('建不出 context（記憶體不足時 new WebGLRenderer 會丟錯）：回 null、不丟例外，之後不再嘗試', async () => {
    three.failCreate = true
    const wrap = buildCard()
    expect(await settle(wrap)).toBeNull()
    expect(viewOf(wrap)).toBeNull()
    three.failCreate = false
    expect(await settle(buildCard())).toBeNull()
    expect(three.renderers).toHaveLength(0)
  })

  it('正常情況不變：掛載只畫一幀、複製一次', async () => {
    const wrap = buildCard()
    const handle = await settle(wrap, { developed: true, onLost: () => expect.unreachable() })
    await pump(6)
    expect(three.renderers[0]!.renders).toBe(1)
    expect(copiesTo(viewOf(wrap))).toBe(1)
    handle!.dispose()
    expect(three.renderers[0]!.disposed).toBe(true)
  })
})

// ---- DayMomentCard.vue（真的 mountPaper＋假的 three） ----

describe('卡片：context 遺失就退回 CSS 版，之後照平常重掛', () => {
  let app: App | null = null
  afterEach(() => {
    app?.unmount()
    app = null
  })

  async function mountCard(index: number) {
    const day = fixture.dayExperience as unknown as DayExperienceContent
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp({ render: () => h(DayMomentCard as Component, { moment: day.moments[index], index, active: false }) })
    app.component('ResponsivePicture', ResponsivePicture)
    app.mount(host)
    await nextTick()
    const wrap = host.querySelector<HTMLElement>('.print-wrap')!
    const near = observers.find((entry) => entry.options?.rootMargin === '60% 0px')!
    near.callback([{ isIntersecting: true, target: near.targets[0]! } as IntersectionObserverEntry], {} as IntersectionObserver)
    for (let i = 0; i < 40 && !wrap.classList.contains('webgl-ready'); i++) await pump(1)
    expect(wrap.classList.contains('webgl-ready')).toBe(true)
    return wrap
  }

  it('桌機：遺失時馬上露出 DOM 卡片（不播翻面轉場），過一會兒用新的 context 重掛', async () => {
    media['(hover: hover) and (pointer: fine)'] = true
    const wrap = await mountCard(1)
    expect(viewOf(wrap)).toBeTruthy()

    loseContext(three.renderers[0]!)
    await nextTick()
    // DOM 正反面在 .webgl-ready 底下是透明的；拿掉 class、收走畫布，讀者看到的就是 DOM（內容永遠是對的）
    expect(wrap.classList.contains('webgl-ready')).toBe(false)
    expect(viewOf(wrap)).toBeNull()
    // 已翻到背面的卡從 transform:none 回到 rotateY(-180deg) 不能播一次翻面
    expect(wrap.classList.contains('is-snapping')).toBe(true)

    const { REMOUNT_AFTER_LOSS_MS } = await import('../app/utils/paper-budget')
    await new Promise((resolve) => setTimeout(resolve, REMOUNT_AFTER_LOSS_MS + 50))
    for (let i = 0; i < 40 && !wrap.classList.contains('webgl-ready'); i++) await pump(1)
    expect(wrap.classList.contains('webgl-ready')).toBe(true)
    expect(three.renderers).toHaveLength(2)
    expect(copies.filter((c) => c.target === viewOf(wrap) && c.source === three.renderers[1]!.domElement)).toHaveLength(1)
    expect(wrap.classList.contains('is-snapping')).toBe(false)
  })

  it('卸載時收掉重掛的計時器', () => {
    const card = read('../app/components/DayMomentCard.vue')
    const unmount = card.slice(card.indexOf('onUnmounted(() => {'), card.indexOf('function toggleFlip'))
    expect(unmount).toContain('window.clearTimeout(remountTimer)')
  })
})
