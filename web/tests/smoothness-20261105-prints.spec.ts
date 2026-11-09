// @vitest-environment happy-dom
// 2026-11-05 前台流暢度：首頁「孩子的一天」拍立得（README 同日段落、DESIGN.md 同日章節）。
// 外觀、節奏、時機都不變，只拿掉看不見的工作：
// - P1 取色不再插拔探針 span（用已在卡片裡的 canvas.paper-view 改 inline color）
// - P2 掛載時不再多畫一幀一模一樣的畫面、不再整張正面重傳（active 建場就讀、mountPaper 不 kick、卡片先收 CSS 傾斜再交給 paper）
// - P4 WebGL 接手後，藏起來的 DOM 照片不再跑顯影轉場
// - X2 --word-fade 寫在兩個讀它的元素上，不寫整個 section
// three 換成假的（只記 render 次數與貼圖上傳），2D canvas 換成記錄呼叫的假 context；happy-dom 沒有 WebGL 與 canvas。
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onMounted, onUnmounted, ref, shallowRef, watch, type App, type Component } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { DayExperienceContent } from '../app/types/site-content'
import { mountPaper, resolveColorOn, type PaperHandle } from '../app/utils/paperPrints'
import DayMomentCard from '../app/components/DayMomentCard.vue'
import DayExperience from '../app/components/DayExperience.vue'
import ResponsivePicture from '../app/components/ResponsivePicture.vue'

vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('shallowRef', shallowRef)
vi.stubGlobal('watch', watch)
vi.stubGlobal('nextTick', nextTick)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onUnmounted', onUnmounted)
vi.stubGlobal('useWatercolorSeep', () => shallowRef(null))

const three = vi.hoisted(() => ({ renders: 0, uploads: new Map<HTMLCanvasElement, number>() }))
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
    rotation = { y: 0, set() {} }
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
    render() {
      three.renders += 1
    }
    dispose() {}
  }
  // 建好之後每次要求重傳（needsUpdate = true）記一次；建構時那次上傳不算
  class CanvasTexture {
    colorSpace = ''
    anisotropy = 1
    constructor(public image: HTMLCanvasElement) {
      three.uploads.set(image, 0)
    }
    set needsUpdate(value: boolean) {
      if (value) three.uploads.set(this.image, (three.uploads.get(this.image) ?? 0) + 1)
    }
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
vi.mock('../app/composables/useCurtain', () => ({ useCurtain: () => {} }))
vi.mock('../app/utils/motionViewport', () => ({ readMotionViewport: () => ({ width: 1440, height: 1000 }) }))

/** 貼圖建好之後被要求重傳的次數（暖身場景與背面不會重傳，合計就是正面的） */
const reuploads = () => [...three.uploads.values()].reduce((sum, n) => sum + n, 0)
// happy-dom 走瀏覽器端轉換：new URL 的第一個參數寫成樣板字串會被 Vite 當成資源 glob，所以直接傳 '../app/…'
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

// 假的 2D context：記下畫時間戳那一刻的 globalAlpha
let stampAlphas: number[] = []
function fake2d(canvas: HTMLCanvasElement) {
  const state: Record<string | symbol, unknown> = { canvas, globalAlpha: 1, textAlign: 'left' }
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key]
      if (key === 'measureText') return (text: string) => ({ width: text.length * 10, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 })
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (key === 'fillText') return (text: string) => {
        if (text === '09:10') stampAlphas.push(target.globalAlpha as number)
      }
      return () => {}
    },
    set(target, key, value) {
      target[key] = value
      return true
    }
  })
}

const originals = new Map<string, PropertyDescriptor | undefined>()
function override(proto: object, name: string, descriptor: PropertyDescriptor) {
  const key = `${proto.constructor.name}.${name}`
  if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(proto, name))
  Object.defineProperty(proto, name, { configurable: true, ...descriptor })
}

beforeEach(() => {
  three.renders = 0
  three.uploads.clear()
  frames = []
  clock = 1000
  stampAlphas = []
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

function buildCard(tapeShadow = '0 1px 2px rgb(1 2 3 / .15)') {
  const host = document.createElement('div')
  host.innerHTML = `<div class="print-card"><div class="print-wrap"><div class="print">
    <span class="print-tape" style="--tape-a: rgb(10, 20, 30); --tape-b: rgb(40, 50, 60); box-shadow: ${tapeShadow}"></span>
    <div class="print-face print-front"><figure class="print-figure"><img class="print-photo" src="/assets/day-a-800.webp" alt=""><time class="print-stamp">09:10</time></figure>
      <div class="print-foot"><p class="print-kicker">02 / 好奇探索</p><h3>今天</h3></div></div>
    <div class="print-face print-back"><p class="print-kicker">02 / 好奇探索</p><p class="print-story">故事</p>
      <div class="print-ask"><p class="print-question">問</p><p class="print-answer">答</p></div></div>
  </div></div></div>`
  document.body.append(host)
  return { host, wrap: host.querySelector<HTMLElement>('.print-wrap')! }
}

const copy = { kicker: '02 / 好奇探索', titleLines: ['今天'], time: '09:10', story: '故事', question: '問', answer: '答' }

async function mount(wrap: HTMLElement, initial: Parameters<typeof mountPaper>[2]) {
  const pending = mountPaper(wrap, copy, initial)
  let handle: PaperHandle | null | undefined
  void pending.then((value) => (handle = value))
  for (let i = 0; i < 40 && handle === undefined; i++) await pump(1)
  expect(handle).toBeTruthy()
  return handle!
}

// ---- P1 ----

describe('P1 取色不插拔節點：用已在卡片裡的 canvas.paper-view 改 inline color', () => {
  it('resolveColorOn 讀完就還原探針原本的 inline color，不新增子節點', () => {
    const probe = document.createElement('canvas')
    probe.style.setProperty('color', 'rgb(9, 9, 9)')
    probe.style.setProperty('left', '-70px')
    document.body.append(probe)
    const before = probe.getAttribute('style')
    expect(resolveColorOn(probe, 'rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)')
    expect(probe.getAttribute('style')).toBe(before)
    expect(probe.childNodes).toHaveLength(0)

    const bare = document.createElement('canvas')
    document.body.append(bare)
    resolveColorOn(bare, 'rgb(1, 2, 3)')
    expect(bare.style.getPropertyValue('color')).toBe('')
  })

  it('掛載時卡片裡只多一張 canvas.paper-view；所有取色都在它身上做，膠帶變數先在膠帶上代換', async () => {
    const { host, wrap } = buildCard()
    const added: Node[] = []
    const removed: Node[] = []
    // 改過 inline color 又還原的元素：還原那一筆 style 變動的舊值裡有 color
    const colorProbes: Node[] = []
    const watcher = new MutationObserver((records) => {
      for (const record of records) {
        added.push(...record.addedNodes)
        removed.push(...record.removedNodes)
        if (record.type === 'attributes' && /(?:^|;\s*)color:/.test(record.oldValue ?? '')) colorProbes.push(record.target)
      }
    })
    watcher.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true })
    const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')
    const handle = await mount(wrap, { developed: true, active: true })
    await Promise.resolve()
    watcher.disconnect()
    const view = wrap.querySelector<HTMLCanvasElement>('canvas.paper-view')!
    expect(added).toEqual([view])
    expect(removed).toEqual([])

    const values = setProperty.mock.calls.filter((args) => args[0] === 'color').map((args) => args[1])
    expect(values.length).toBeGreaterThan(0)
    expect(colorProbes).toHaveLength(values.length)
    expect(new Set(colorProbes)).toEqual(new Set([view]))
    expect(values).toContain('rgb(var(--ink) / .07)')
    expect(values).toContain('rgb(10, 20, 30)')
    expect(values).toContain('rgb(40, 50, 60)')
    // 膠帶有陰影色就不必解析 fallback
    expect(values).not.toContain('rgb(var(--ink) / .15)')
    expect(view.style.getPropertyValue('color')).toBe('')
    handle.dispose()
  })

  it('膠帶讀不到陰影色時才解析 fallback', async () => {
    const { wrap } = buildCard('none')
    const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')
    const handle = await mount(wrap, { developed: true })
    expect(setProperty.mock.calls.filter((args) => args[0] === 'color').map((args) => args[1])).toContain('rgb(var(--ink) / .15)')
    handle.dispose()
  })

  it('原始碼不再插入探針 span', () => {
    const paper = read('../app/utils/paperPrints.ts')
    expect(paper).not.toContain("document.createElement('span')")
    expect(paper).not.toMatch(/\bresolveColor\(/)
    expect(paper).toContain("tapeShadow: tapeEl ? shadowColorOf(tapeEl, () => resolveColorOn(view, 'rgb(var(--ink) / .15)')) : ''")
  })
})

// ---- P2 ----

describe('P2 掛載只畫一幀：建場就照目前的停留狀態畫，之後狀態沒變不重畫', () => {
  it('靜止的卡：掛載後只有 buildScene 那一次 render，正面不重傳', async () => {
    const { wrap } = buildCard()
    const handle = await mount(wrap, { developed: true, active: true })
    await pump(6)
    expect(three.renders).toBe(1)
    // 停留段落的時間戳建場時就是亮的那一階（1），不是先畫 .85 再重畫
    expect(stampAlphas).toEqual([1])
    expect(reuploads()).toBe(0)

    handle.setActive(true)
    await pump(3)
    expect(three.renders).toBe(1)

    handle.setActive(false)
    await pump(3)
    expect(three.renders).toBe(2)
    expect(stampAlphas.at(-1)).toBeCloseTo(0.85)
    expect(reuploads()).toBe(1)
    handle.dispose()
  })

  it('沒帶 active 時照舊用非停留的時間戳', async () => {
    const { wrap } = buildCard()
    const handle = await mount(wrap, { developed: true })
    expect(stampAlphas).toEqual([0.85])
    handle.dispose()
  })
})

// ---- P2：DayMomentCard 接手順序（真的 mountPaper＋假的 three） ----

describe('P2 卡片接手：先收 CSS 傾斜再交給 paper，掛載後不多畫一幀', () => {
  let app: App | null = null
  afterEach(() => {
    app?.unmount()
    app = null
  })

  it('桌機：游標停在卡上時接手，CSS 傾斜變數清掉、紙只 render 一次、正面不重傳', async () => {
    media['(hover: hover) and (pointer: fine)'] = true
    const day = fixture.dayExperience as unknown as DayExperienceContent
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp({ render: () => h(DayMomentCard as Component, { moment: day.moments[1], index: 1, active: true }) })
    app.component('ResponsivePicture', ResponsivePicture) // 照片 2026-11-05 起是 <ResponsivePicture>（AVIF），裸 createApp 沒有 Nuxt 的自動註冊
    app.mount(host)
    await nextTick()
    const wrap = host.querySelector<HTMLElement>('.print-wrap')!
    const print = host.querySelector<HTMLElement>('.print')!
    wrap.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, clientY: 60, bubbles: true }))
    runFrame()
    await nextTick()
    expect(print.style.getPropertyValue('--ry')).not.toBe('')
    expect(wrap.classList.contains('is-tilting')).toBe(true)

    const near = observers.find((entry) => entry.options?.rootMargin === '60% 0px')!
    near.callback([{ isIntersecting: true, target: near.targets[0]! } as IntersectionObserverEntry], {} as IntersectionObserver)
    for (let i = 0; i < 40 && !wrap.classList.contains('webgl-ready'); i++) await pump(1)
    expect(wrap.classList.contains('webgl-ready')).toBe(true)
    await pump(6)
    expect(three.renders).toBe(1)
    expect(reuploads()).toBe(0)
    expect(print.style.getPropertyValue('--ry')).toBe('')
    expect(print.style.getPropertyValue('--glare')).toBe('')
    expect(wrap.classList.contains('is-tilting')).toBe(false)
  })

  it('原始碼：initial 帶 active getter；onPointerLeave 在 paper = handle 之前；mountPaper 建完不 kick', () => {
    const card = read('../app/components/DayMomentCard.vue')
    expect(card).toContain('get active() { return Boolean(props.active) },')
    const attach = card.slice(card.indexOf('async function attachPaper()'), card.indexOf('watch(isFlipped'))
    expect(attach.indexOf('onPointerLeave()')).toBeGreaterThan(0)
    expect(attach.indexOf('onPointerLeave()')).toBeLessThan(attach.indexOf('paper = handle'))
    expect(attach.match(/onPointerLeave\(\)/g)).toHaveLength(1)
    const paper = read('../app/utils/paperPrints.ts')
    expect(paper).toContain('let active = initial.active ?? false')
    const tail = paper.slice(paper.indexOf('resizer.observe(front)'), paper.indexOf('  return {', paper.indexOf('resizer.observe(front)')))
    expect(tail).not.toContain('kick()')
  })
})

// ---- P4 ----

describe('P4 WebGL 接手後，藏起來的 DOM 照片不跑顯影轉場', () => {
  const styles = read('../app/assets/css/styles.css')
  it('照片、時間戳、乳白覆蓋層在 .webgl-ready 底下 transition:none（特異度高於桌機與手機的轉場規則）', () => {
    expect(styles).toContain('.print-wrap.webgl-ready .print-photo,.print-wrap.webgl-ready .print-stamp,.print-wrap.webgl-ready .print-figure::after{transition:none}')
  })
  it('CSS 版的顯影轉場不動（時長、延遲、曲線）', () => {
    expect(styles).toContain('transition:filter 3s cubic-bezier(.25,.55,.3,1),opacity 3s cubic-bezier(.25,.55,.3,1)}')
    expect(styles).toContain('.print-figure::after{content:\'\';position:absolute;inset:0;pointer-events:none;background:linear-gradient(160deg,var(--ivy-print-glass-cool),var(--ivy-print-glass-warm) 55%,var(--ivy-print-glass-cool));transition:opacity 3.2s ease .3s}')
    expect(styles).toContain('transform:skewX(-6deg);opacity:0;transition:opacity 1.6s ease 1.8s}')
    expect(styles).toContain(' .print-stamp{font-size:var(--fs-lg);right:8px;bottom:7px;transition:opacity .8s ease .5s}')
    expect(styles).toContain(' .print-photo{transition-duration:.9s,.9s}\n .print-figure::after{transition:opacity .9s ease .1s}')
  })
})

// ---- X2 ----

describe('X2 --word-fade 寫在讀它的 .day-intro 與 .day-film-shade 上，不寫整個 section', () => {
  let app: App | null = null
  afterEach(() => {
    app?.unmount()
    app = null
  })

  it('捲動淡出時只寫兩個讀者，值沒變不重寫', async () => {
    let listTop = 435
    override(Element.prototype, 'getBoundingClientRect', {
      value(this: Element) {
        const top = this.classList.contains('day-prints') ? listTop : 0
        return { left: 0, top, right: 100, bottom: top + 100, width: 100, height: 100, x: 0, y: top, toJSON() {} }
      }
    })
    const day = fixture.dayExperience as unknown as DayExperienceContent
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp({ render: () => h(DayExperience as Component, { day }) })
    app.component('ResponsivePicture', ResponsivePicture) // 照片 2026-11-05 起是 <ResponsivePicture>（AVIF），裸 createApp 沒有 Nuxt 的自動註冊
    app.component('DayMomentCard', defineComponent({ render: () => h('li', { class: 'day-print' }) }))
    app.config.warnHandler = () => {}
    app.mount(host)
    await nextTick()
    await nextTick()
    const section = host.querySelector<HTMLElement>('section.day-experience')!
    const intro = host.querySelector<HTMLElement>('.day-intro')!
    const shade = host.querySelector<HTMLElement>('.day-film-shade')!
    const watcher = observers.find((entry) => entry.targets.includes(section))!
    watcher.callback([{ isIntersecting: true, target: section } as IntersectionObserverEntry], {} as IntersectionObserver)
    runFrame()
    // 閱讀高度 1000：列表頂端 435 在 620→250 的正中間，淡到 1 − .5 × .84
    expect(intro.style.getPropertyValue('--word-fade')).toBe('0.580')
    expect(shade.style.getPropertyValue('--word-fade')).toBe('0.580')
    expect(section.style.getPropertyValue('--word-fade')).toBe('')

    const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')
    window.dispatchEvent(new Event('scroll'))
    runFrame()
    expect(setProperty.mock.calls.filter((args) => args[0] === '--word-fade')).toHaveLength(0)

    listTop = 250
    window.dispatchEvent(new Event('scroll'))
    runFrame()
    expect(intro.style.getPropertyValue('--word-fade')).toBe('0.160')
    expect(shade.style.getPropertyValue('--word-fade')).toBe('0.160')
    expect(section.style.getPropertyValue('--word-fade')).toBe('')
  })

  it('讀 --word-fade 的只有這兩條規則（從 .day-film-shade 自己、.day-intro 父層繼承）；新增讀者要一起寫進 paintFade', () => {
    // 遞迴掃整個 web/app（含 pages/news、pages/visit 等子目錄與 app.vue、error.vue）
    const appDir = fileURLToPath(import.meta.url).replace(/\/tests\/[^/]+$/, '/app')
    const names = readdirSync(appDir, { recursive: true }) as string[]
    const readers = names
      .filter((name) => /\.(css|vue)$/.test(name))
      .flatMap((name) => [...read(`../app/${name}`).matchAll(/[^{}]*\{[^{}]*var\(--word-fade/g)].map((m) => `${name.split('/').pop()}: ${m[0].trim().split('{')[0]}`))
    expect(readers).toEqual(['styles.css: .day-film-shade::before', 'styles.css: .day-intro>*'])
    expect(read('../app/components/DayExperience.vue')).not.toContain("section.style.setProperty('--word-fade'")
  })
})
