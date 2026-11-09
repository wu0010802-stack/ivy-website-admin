// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 2026-11-05 前台流暢度：30 週年頁（/anniversary）。畫面是 canvas／WebGL，happy-dom 不會真的畫，
// 這裡用記錄呼叫的假 context 驗行為（上傳了什麼、哪一幀畫了、什麼時候停）；
// 像素逐位元組相同另用 Playwright 對照基準 build 驗過（貼圖讀回、卡片／校徽／蠟筆線／結尾 30、蛋糕 SVG）。

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

// computed style 讀到的 token（實際值前面常帶空白，程式要 trim）
const TOKENS: Record<string, string> = {
  '--green': ' oklch(37% .057 157)', '--deep': 'oklch(28% .04 162)', '--white': 'oklch(99.7% .003 100)', '--paper': 'oklch(99% .008 95)',
  '--muted': 'oklch(47% .025 155)', '--gold': ' oklch(82% .14 84)', '--trail': 'oklch(64% .055 155)', '--font-head': 'LINE Seed TW',
  '--anni-crayon': 'rgb(108 162 112)',
  '--ivy-paint-sun-rgb': ' 246 204 98', '--ivy-paint-mint-rgb': '128 194 160', '--ivy-paint-orange-rgb': '236 150 90',
  '--ivy-paint-sky-rgb': '134 184 222', '--ivy-paint-leaf-rgb': '108 162 112'
}
const PAD = ['var(--green)', 'rgb(var(--ivy-paint-leaf-rgb))', 'rgb(var(--ivy-paint-sun-rgb))', 'rgb(var(--ivy-paint-orange-rgb))', 'rgb(var(--ivy-paint-sky-rgb))', 'rgb(var(--ivy-paint-mint-rgb))']

// ── 假的 2D／WebGL context ──
interface Op { op: string; args: unknown[] }
interface Fake2D { canvas: HTMLCanvasElement; ops: Op[] }
interface GLCall { op: string; args: unknown[]; closed?: boolean }
interface FakeGL { canvas: HTMLCanvasElement; calls: GLCall[] }
interface FakeBitmap { url: string; opts: unknown; width: number; height: number; closed: boolean; close(): void }

const parseRGB = (css: unknown) => {
  const m = /^rgb\((\d+)[ ,]+(\d+)[ ,]+(\d+)\)$/.exec(String(css))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), 255] : [1, 2, 3, 255]
}
function fake2d(canvas: HTMLCanvasElement): Fake2D {
  const ops: Op[] = []
  const state: Record<string, unknown> = { fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, lineWidth: 1, font: '10px sans-serif' }
  const own: Record<string | symbol, unknown> = {
    canvas, ops,
    // 讀回的顏色就是 fillStyle（只認 rgb(r g b)），其他一律不透明
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      ops.push({ op: 'getImageData', args: [w, h] })
      const px = parseRGB(state.fillStyle), data = new Uint8ClampedArray(w * h * 4)
      for (let i = 0; i < data.length; i += 4) data.set(px, i)
      return { data }
    },
    measureText: () => ({ width: 100 }),
    createRadialGradient: (...args: unknown[]) => { ops.push({ op: 'createRadialGradient', args }); return { addColorStop: (...s: unknown[]) => ops.push({ op: 'addColorStop', args: s }) } }
  }
  return new Proxy(own, {
    get: (t, k) => (k in t ? t[k] : typeof k === 'string' && k in state ? state[k] : (...args: unknown[]) => { ops.push({ op: String(k), args }) }),
    set: (_t, k, v) => { ops.push({ op: `${String(k)}=`, args: [v] }); state[String(k)] = v; return true }
  }) as unknown as Fake2D
}
function fakeGL(canvas: HTMLCanvasElement): FakeGL {
  const calls: GLCall[] = []
  let n = 0
  const own: Record<string | symbol, unknown> = {
    canvas, calls,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_p: unknown, name: string) => ({ name }),
    getExtension: () => null,
    // 記下上傳那一刻來源是不是已經 close 了
    texImage2D: (...args: unknown[]) => { const src = args.at(-1) as { closed?: boolean } | null; calls.push({ op: 'texImage2D', args, closed: src?.closed }) }
  }
  return new Proxy(own, {
    get: (t, k) => {
      if (k in t) return t[k]
      if (typeof k !== 'string') return undefined
      if (/^[A-Z][A-Z0-9_]*$/.test(k)) return k
      if (k.startsWith('create')) return () => ({ id: ++n })
      return (...args: unknown[]) => { calls.push({ op: k, args }) }
    }
  }) as unknown as FakeGL
}

// ── 測試環境：觀察者、rAF、時鐘、圖片載入 ──
class FakeObserver {
  targets: Element[] = []
  constructor(public cb: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void, public opts?: unknown) {}
  observe(el: Element) { this.targets.push(el) }
  unobserve() {}
  disconnect() {}
}
let ios: FakeObserver[] = []
let ros: FakeObserver[] = []
let frames = new Map<number, FrameRequestCallback>()
let frameId = 0
const clock = { now: 1000 }
let contexts = new WeakMap<HTMLCanvasElement, Fake2D | FakeGL>()
let gls: FakeGL[] = []
let bitmaps: FakeBitmap[] = []
let failImages = new Set<string>()
let propReads: string[] = []

const ctx2d = (c: Element) => contexts.get(c as HTMLCanvasElement) as Fake2D
const glOf = (c: Element) => contexts.get(c as HTMLCanvasElement) as FakeGL
/** 跑一幀：只跑這一幀之前排進來的回呼，回呼裡再排的算下一幀 */
const runFrame = (dt = 16) => {
  clock.now += dt
  const due = [...frames.values()]
  frames.clear()
  for (const cb of due) cb(clock.now)
}
const settle = () => new Promise((r) => setTimeout(r, 0))

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  decoding = ''
  naturalWidth = 1200
  naturalHeight = 800
  private url = ''
  set src(v: string) { this.url = v; queueMicrotask(() => (failImages.has(v) ? this.onerror?.() : this.onload?.())) }
  get src() { return this.url }
}

beforeEach(() => {
  vi.resetModules()
  ios = []; ros = []; frames = new Map(); frameId = 0; bitmaps = []; failImages = new Set(); propReads = []
  clock.now = 1000
  contexts = new WeakMap()
  gls = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, type: string) {
    let c = contexts.get(this)
    if (!c) { c = type === 'webgl2' ? fakeGL(this) : fake2d(this); contexts.set(this, c); if (type === 'webgl2') gls.push(c as FakeGL) }
    return c
  } as never)
  vi.stubGlobal('getComputedStyle', vi.fn(() => ({
    color: 'rgb(9, 9, 9)',
    getPropertyValue: (n: string) => { propReads.push(n); return TOKENS[n] ?? '' }
  })))
  vi.stubGlobal('IntersectionObserver', class extends FakeObserver { constructor(cb: FakeObserver['cb'], opts?: unknown) { super(cb, opts); ios.push(this) } })
  vi.stubGlobal('ResizeObserver', class extends FakeObserver { constructor(cb: FakeObserver['cb'], opts?: unknown) { super(cb, opts); ros.push(this) } })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++frameId, cb); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, blob: async () => ({ url }) })))
  vi.stubGlobal('createImageBitmap', vi.fn(async (blob: { url: string }, opts: unknown) => {
    const b: FakeBitmap = { url: blob.url, opts, width: 1536, height: 1024, closed: false, close() { this.closed = true; this.width = 0; this.height = 0 } }
    bitmaps.push(b)
    return b
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('A2 貼圖改在 worker 解碼（paperGL、畫板紙紋）', () => {
  const GL_BITMAP = { premultiplyAlpha: 'none', colorSpaceConversion: 'default' }

  it('紙紋、卡片三張、校徽兩張都用 ImageBitmap 上傳，上傳時還沒 close、上傳後就 close；比例在 close 前讀', async () => {
    const { PaperGL } = await import('../app/utils/anniversary/paperGL')
    const gl = PaperGL.create('oklch(99% .008 95)')!
    await gl.loadPaper('/p.webp')
    const tex = await gl.loadCard('/l.webp', '/c.webp', '/f.webp')
    await gl.loadCrest('/cr.webp', '/cf.webp')
    const uploads = glOf(gl.canvas).calls.filter((c) => c.op === 'texImage2D')
    expect(uploads.map((u) => (u.args.at(-1) as FakeBitmap).url)).toEqual(['/p.webp', '/l.webp', '/c.webp', '/f.webp', '/cr.webp', '/cf.webp'])
    expect(uploads.every((u) => u.closed === false)).toBe(true)
    expect(bitmaps).toHaveLength(6)
    expect(bitmaps.every((b) => b.closed)).toBe(true)
    // ImageBitmap 不吃 pixelStorei：預乘與色彩空間要在解碼時講好，與 UNPACK_PREMULTIPLY_ALPHA_WEBGL=false 一致
    expect(bitmaps.every((b) => JSON.stringify(b.opts) === JSON.stringify(GL_BITMAP))).toBe(true)
    expect(glOf(gl.canvas).calls).toContainEqual({ op: 'pixelStorei', args: ['UNPACK_PREMULTIPLY_ALPHA_WEBGL', false] })
    expect(tex.aspect).toBe(1.5)
    // 背景貼圖照原本 new Image() 的 Low 優先權抓，不跟首屏海報、開場影片搶頻寬（fetch 預設是 High）
    expect(vi.mocked(fetch).mock.calls.map((c) => c[1])).toEqual(Array(6).fill({ credentials: 'same-origin', priority: 'low' }))
  })

  it('不支援 createImageBitmap 時退回 <img>；有一張載不到就丟錯，已解好的點陣圖照樣釋放', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const { PaperGL } = await import('../app/utils/anniversary/paperGL')
    const gl = PaperGL.create('oklch(99% .008 95)')!
    const tex = await gl.loadCard('/l.webp', '/c.webp', '/f.webp')
    const uploads = glOf(gl.canvas).calls.filter((c) => c.op === 'texImage2D')
    expect(uploads.every((u) => u.args.at(-1) instanceof FakeImage)).toBe(true)
    expect(tex.aspect).toBe(1.5)

    vi.stubGlobal('createImageBitmap', vi.fn(async (blob: { url: string }) => {
      if (blob.url === '/bad.webp') throw new Error('decode')
      const b: FakeBitmap = { url: blob.url, opts: null, width: 10, height: 10, closed: false, close() { this.closed = true } }
      bitmaps.push(b)
      return b
    }))
    failImages.add('/bad.webp')
    await expect(gl.loadCard('/ok1.webp', '/bad.webp', '/ok2.webp')).rejects.toThrow('/bad.webp')
    await settle()
    expect(bitmaps.map((b) => [b.url, b.closed])).toEqual([['/ok1.webp', true], ['/ok2.webp', true]])
  })

  it('畫板的紙紋也走 ImageBitmap，上傳後釋放', async () => {
    const box = document.createElement('div')
    const canvas = document.createElement('canvas')
    box.append(canvas)
    document.body.append(box)
    const { mountCrayonPad } = await import('../app/utils/anniversary/crayonPad')
    const pad = (await mountCrayonPad(canvas, { color: PAD[0]!, colors: PAD, guide: true }))!
    const paper = glOf(canvas).calls.find((c) => c.op === 'texImage2D' && c.args.at(-1) !== null)!
    expect((paper.args.at(-1) as FakeBitmap).url).toMatch(/\/assets\/anniversary\/paper-[0-9a-f]+\.webp$/)
    expect(paper.closed).toBe(false)
    expect(bitmaps).toHaveLength(1)
    expect(bitmaps[0]!.closed).toBe(true)
    pad.destroy()
  })
})

describe('A5 解析 var() 不再插探針到 DOM', () => {
  it('cssColorRGB：代入 body 上的 token 再交給 1×1 canvas，同一個顏色只讀一次', async () => {
    const append = vi.spyOn(document.body, 'appendChild')
    const { cssColorRGB } = await import('../app/utils/anniversary/paperGL')
    expect(cssColorRGB('rgb(var(--ivy-paint-sun-rgb))')).toEqual([246 / 255, 204 / 255, 98 / 255])
    expect(append).not.toHaveBeenCalled()
    const created = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.calls.length
    expect(cssColorRGB('rgb(var(--ivy-paint-sun-rgb))')).toEqual([246 / 255, 204 / 255, 98 / 255])
    expect(vi.mocked(HTMLCanvasElement.prototype.getContext).mock.calls.length).toBe(created)
    // 不含 var() 的照舊直接解析
    expect(cssColorRGB('rgb(108 162 112)')).toEqual([108 / 255, 162 / 255, 112 / 255])
  })

  it('帶預設值或沒定義的 var() 才退回探針（插在 body，讀完就移除）', async () => {
    const append = vi.spyOn(document.body, 'appendChild')
    const { cssColorRGB, substituteVars } = await import('../app/utils/anniversary/paperGL')
    const style = getComputedStyle(document.body)
    expect(substituteVars('var(--green)', style)).toBe('oklch(37% .057 157)')
    expect(substituteVars('var(--nope)', style)).toBeNull()
    expect(substituteVars('var(--green, red)', style)).toBeNull()
    expect(cssColorRGB('var(--green, red)')).toEqual([9 / 255, 9 / 255, 9 / 255])
    expect(append).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector('span')).toBeNull()
  })

  it('蛋糕的 resolveColor：直接代入舞台上的 token，不插探針', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const append = vi.spyOn(host, 'appendChild')
    const { resolveColor } = await import('../app/utils/anniversary/cake')
    expect(resolveColor('rgb(var(--ivy-paint-sun-rgb))', host)).toBe('rgb(246 204 98)')
    expect(resolveColor('var(--green)', host)).toBe('oklch(37% .057 157)')
    expect(append).not.toHaveBeenCalled()
    expect(resolveColor('var(--nope)', host)).toBe('rgb(9, 9, 9)')
    expect(append).toHaveBeenCalledTimes(1)
  })

  it('畫板：六支蠟筆掛載時就解好，選顏色時只查表（不讀 computed style、不建 canvas），沉積用的就是那支的顏色', async () => {
    const box = document.createElement('div')
    const canvas = document.createElement('canvas')
    canvas.setPointerCapture = () => {}
    box.append(canvas)
    document.body.append(box)
    const { mountCrayonPad } = await import('../app/utils/anniversary/crayonPad')
    const pad = (await mountCrayonPad(canvas, { color: PAD[0]!, colors: PAD, guide: true }))!
    const gcs = vi.mocked(getComputedStyle).mock.calls.length
    const ctxs = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.calls.length
    const append = vi.spyOn(document.body, 'appendChild')
    pad.setColor(PAD[2]!)
    expect(vi.mocked(getComputedStyle).mock.calls.length).toBe(gcs)
    expect(vi.mocked(HTMLCanvasElement.prototype.getContext).mock.calls.length).toBe(ctxs)
    expect(append).not.toHaveBeenCalled()
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    const uColor = glOf(canvas).calls.filter((c) => c.op === 'uniform3fv' && (c.args[0] as { name: string }).name === 'uColor')
    expect(uColor.length).toBeGreaterThan(0)
    expect(uColor.at(-1)!.args[1]).toEqual([246 / 255, 204 / 255, 98 / 255])
    pad.destroy()
  })

  it('AnniversaryContent 把六支蠟筆的顏色交給畫板', () => {
    expect(read('../app/components/AnniversaryContent.vue')).toContain('colors: PAD_COLORS.map((c) => c.css)')
  })
})

// 強制色彩（Windows 對比佈景主題）時，原本探針 span 的 computed color 會被換成系統色，蠟燭、彩帶、畫板蠟筆都是那個顏色；
// 直接代入 token 會變回六色，所以這時要照舊走探針。這裡的探針讀回 'rgb(9, 9, 9)'（beforeEach 的 getComputedStyle）當作系統色。
describe('A5 強制色彩：var() 顏色照原本插探針，讀到系統色', () => {
  const SYSTEM = [9 / 255, 9 / 255, 9 / 255]
  const SUN = [246 / 255, 204 / 255, 98 / 255]
  let forced = true
  let queries: string[] = []
  const spans = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((c) => c[0] instanceof HTMLSpanElement).length

  beforeEach(() => {
    forced = true
    queries = []
    vi.stubGlobal('matchMedia', vi.fn((q: string) => {
      queries.push(q)
      return { matches: q === '(forced-colors: active)' && forced, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
    }))
  })

  it('cssColorRGB：強制色彩時插探針到 body、讀完就移除；切回一般模式就代入 token', async () => {
    const append = vi.spyOn(document.body, 'appendChild')
    const { cssColorRGB } = await import('../app/utils/anniversary/paperGL')
    expect(cssColorRGB('rgb(var(--ivy-paint-sun-rgb))')).toEqual(SYSTEM)
    expect(queries).toContain('(forced-colors: active)')
    expect(spans(append)).toBe(1)
    expect(document.body.querySelector('span')).toBeNull()
    // 不含 var() 的顏色原本就不插探針
    expect(cssColorRGB('rgb(108 162 112)')).toEqual([108 / 255, 162 / 255, 112 / 255])
    expect(spans(append)).toBe(1)
    // 同一個 var() 字串在切回一般模式後不沿用強制時的結果
    forced = false
    expect(cssColorRGB('rgb(var(--ivy-paint-sun-rgb))')).toEqual(SUN)
    expect(spans(append)).toBe(1)
  })

  it('蛋糕的 resolveColor：強制色彩時插探針到舞台，蠟燭的 SVG fill 都是系統色', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const append = vi.spyOn(host, 'appendChild')
    const { resolveColor } = await import('../app/utils/anniversary/cake')
    expect(resolveColor('rgb(var(--ivy-paint-sun-rgb))', host)).toBe('rgb(9, 9, 9)')
    expect(resolveColor('var(--green)', host)).toBe('rgb(9, 9, 9)')
    expect(spans(append)).toBe(2)
    expect(host.querySelector('span')).toBeNull()

    const stage = document.createElement('div')
    stage.innerHTML = '<svg class="anni-cake-art"></svg><canvas class="anni-cake-fx"></canvas>'
    document.body.append(stage)
    const stageAppend = vi.spyOn(stage, 'appendChild')
    const { mountCake } = await import('../app/utils/anniversary/cake')
    const ctl = await mountCake(stage, { reduce: true, colors: PAD, onChange: () => {}, onAllOut: () => {} })
    // 六支蠟筆各插一次探針，跟改前一樣
    expect(spans(stageAppend)).toBe(PAD.length)
    const tips = [...stage.querySelectorAll<SVGPathElement>('path.anni-cake-tip')].map((p) => p.style.fill).filter((f) => f !== 'none')
    expect(tips).toHaveLength(30)
    expect(new Set(tips)).toEqual(new Set(['rgb(9, 9, 9)']))
    ctl.destroy()
  })

  it('畫板：強制色彩時不查掛載時的表，每次選顏色照原本現讀；主題中途切換也跟著換', async () => {
    const box = document.createElement('div')
    const canvas = document.createElement('canvas')
    canvas.setPointerCapture = () => {}
    box.append(canvas)
    document.body.append(box)
    const append = vi.spyOn(document.body, 'appendChild')
    const { mountCrayonPad } = await import('../app/utils/anniversary/crayonPad')
    const lastColor = () => {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 }))
      canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
      return glOf(canvas).calls.filter((c) => c.op === 'uniform3fv' && (c.args[0] as { name: string }).name === 'uColor').at(-1)!.args[1]
    }

    // 掛載時是強制色彩：只為起始顏色插一次探針（改前也是一次），不先把六支都探一遍
    const pad = (await mountCrayonPad(canvas, { color: PAD[0]!, colors: PAD, guide: true }))!
    expect(spans(append)).toBe(1)
    pad.setColor(PAD[2]!)
    expect(spans(append)).toBe(2)
    expect(lastColor()).toEqual(SYSTEM)
    // 關掉對比主題後選同一支：回到實際的 token 色，不是掛載時的系統色
    forced = false
    pad.setColor(PAD[2]!)
    expect(lastColor()).toEqual(SUN)
    expect(spans(append)).toBe(2)
    pad.destroy()

    // 掛載時是一般模式、之後才開對比主題：選顏色要讀系統色，不能查掛載時的六色表
    const canvas2 = document.createElement('canvas')
    canvas2.setPointerCapture = () => {}
    const box2 = document.createElement('div')
    box2.append(canvas2)
    document.body.append(box2)
    const pad2 = (await mountCrayonPad(canvas2, { color: PAD[0]!, colors: PAD, guide: true }))!
    const before = spans(append)
    forced = true
    pad2.setColor(PAD[2]!)
    expect(spans(append)).toBe(before + 1)
    canvas2.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 2, clientX: 10, clientY: 10 }))
    canvas2.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2 }))
    const u2 = glOf(canvas2).calls.filter((c) => c.op === 'uniform3fv' && (c.args[0] as { name: string }).name === 'uColor').at(-1)!.args[1]
    expect(u2).toEqual(SYSTEM)
    pad2.destroy()
  })
})

describe('A3 蛋糕：全部吹熄、彩帶落完就停 rAF', () => {
  it('點著時每幀都畫；吹熄、慶祝完停下，最後一格是空白；再點一次會回來。光暈顏色不在每幀讀 computed style', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const stage = document.createElement('div')
    stage.innerHTML = '<svg class="anni-cake-art"></svg><canvas class="anni-cake-fx"></canvas>'
    document.body.append(stage)
    const append = vi.spyOn(stage, 'appendChild')
    const { mountCake } = await import('../app/utils/anniversary/cake')
    const changes: number[] = []
    let allOut = 0
    const ctl = await mountCake(stage, { reduce: false, colors: PAD, onChange: (n) => changes.push(n), onAllOut: () => { allOut++ } })
    // A5：六支蠟筆的顏色不再插探針
    expect(append).not.toHaveBeenCalled()
    const fills = [...stage.querySelectorAll('path')].map((p) => p.style.fill)
    expect(fills).toContain('rgb(246 204 98)')
    expect(fills).toContain('oklch(37% .057 157)')

    const tick = (ms = 16) => { vi.advanceTimersByTime(ms); runFrame(ms) }
    ios.at(-1)!.cb([{ target: stage, isIntersecting: true }])
    for (let i = 0; i < 400 && changes.at(-1) !== 30; i++) tick()
    expect(changes.at(-1)).toBe(30)
    const sunReads = () => propReads.filter((n) => n === '--ivy-paint-sun-rgb').length
    const reads = sunReads()
    for (let i = 0; i < 20; i++) tick()
    expect(frames.size).toBe(1)
    expect(sunReads()).toBe(reads)

    ctl.setHold(true)
    for (let i = 0; i < 2000 && !allOut; i++) tick()
    ctl.setHold(false)
    expect(allOut).toBe(1)
    for (let i = 0; i < 2000 && frames.size; i++) tick()
    expect(frames.size).toBe(0)
    const ops = ctx2d(stage.querySelector('canvas')!).ops
    const lastClear = ops.map((o) => o.op).lastIndexOf('clearRect')
    expect(ops.slice(lastClear + 1).filter((o) => ['fill', 'stroke', 'fillRect'].includes(o.op))).toEqual([])
    // 停了之後就真的不再排幀
    for (let i = 0; i < 10; i++) tick()
    expect(frames.size).toBe(0)

    ctl.relightAll()
    tick(50)
    expect(frames.size).toBe(1)
    ctl.destroy()
  })
})

describe('A4／A7 時間軸', () => {
  interface Box { top: number; left: number; w: number; h: number }
  let scroll = 0
  const setScroll = (y: number) => { scroll = y; vi.stubGlobal('scrollY', y) }

  async function mount(log?: string[]) {
    document.body.innerHTML = `<main class="anni">
      <div class="anni-track">
        <div class="anni-rail"><canvas class="anni-ink"></canvas><canvas class="anni-kids"></canvas></div>
        <ol class="anni-years">
          <li data-year="1997"><span class="anni-year">1997</span><article class="anni-campus" data-campus="yihua"><div class="anni-card"><canvas class="anni-card-canvas"></canvas></div></article></li>
          <li data-year="2010"><span class="anni-year">2010</span><article class="anni-campus" data-campus="minghua"><div class="anni-card"><canvas class="anni-card-canvas"></canvas></div></article></li>
          <li data-year="2027"><span class="anni-year">2027</span></li>
        </ol>
      </div>
      <section class="anni-finale"><div class="anni-finale-box"><canvas class="anni-finale-ink"></canvas><canvas class="anni-finale-kids"></canvas><canvas class="anni-crest-canvas"></canvas></div></section>
    </main>`
    const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s) as T
    const $$ = (s: string) => [...document.querySelectorAll<HTMLElement>(s)]
    const el = {
      track: $('.anni-track'), rail: $('.anni-rail'), ink: $('.anni-ink'), kids: $('.anni-kids'), finale: $('.anni-finale'),
      fBox: $('.anni-finale-box'), fInk: $('.anni-finale-ink'), fKids: $('.anni-finale-kids'),
      cards: $$('.anni-campus'), cardCanvases: $$('.anni-card-canvas')
    }
    // 文件座標：軌道 1000–5000、兩張卡 1100–1500／2600–3000、結尾舞台 5200–7200
    const geo = new Map<Element, Box>([
      [el.track, { top: 1000, left: 100, w: 1100, h: 4000 }],
      [el.rail, { top: 1000, left: 100, w: 150, h: 4000 }],
      [el.cards[0]!, { top: 1100, left: 278, w: 600, h: 400 }],
      [el.cards[1]!, { top: 2600, left: 278, w: 600, h: 400 }],
      [el.finale, { top: 5200, left: 100, w: 1100, h: 2000 }]
    ])
    $$('.anni-year').forEach((label, i) => geo.set(label, { top: [1020, 2500, 4900][i]!, left: 100, w: 60, h: 20 }))
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const g = geo.get(this) ?? { top: 0, left: 0, w: 0, h: 0 }
      log?.push('read')
      return { top: g.top - scroll, bottom: g.top + g.h - scroll, left: g.left, right: g.left + g.w, width: g.w, height: g.h, x: g.left, y: g.top - scroll, toJSON() {} } as DOMRect
    })
    const size = (node: Element, prop: string, value: () => number) => Object.defineProperty(node, prop, { configurable: true, get: () => { log?.push('read'); return value() } })
    size(el.track, 'offsetHeight', () => geo.get(el.track)!.h)
    size(el.rail, 'offsetWidth', () => 150)
    size(el.finale, 'offsetHeight', () => 2000)
    size(el.fBox, 'clientWidth', () => 1100)
    size(el.fBox, 'clientHeight', () => 900)
    for (const c of el.cardCanvases) { size(c, 'offsetWidth', () => 356); size(c, 'offsetHeight', () => 238) }
    // 只記軌道與結尾裡的畫布改尺寸（不算離屏 WebGL 與取色用的小 canvas）
    const sets: string[] = []
    for (const prop of ['width', 'height'] as const) {
      const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, prop)!
      vi.spyOn(HTMLCanvasElement.prototype, prop, 'set').mockImplementation(function (this: HTMLCanvasElement, v: number) {
        if (this.closest('.anni')) { log?.push('write'); sets.push(`${this.className}.${prop}`) }
        d.set!.call(this, v)
      })
    }
    const setProperty = el.fBox.style.setProperty.bind(el.fBox.style)
    el.fBox.style.setProperty = (...a: Parameters<CSSStyleDeclaration['setProperty']>) => { log?.push('write'); setProperty(...a) }

    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('devicePixelRatio', 1)
    setScroll(0)
    const { mountTrack } = await import('../app/utils/anniversary/track')
    const dispose = await mountTrack(el.track, { reduce: false, onYear: () => {}, onProgress: () => {} })
    ios.at(-1)!.cb([{ target: el.track, isIntersecting: true }])
    await settle()
    const scrollTo = async (y: number) => { setScroll(y); window.dispatchEvent(new Event('scroll')); await settle() }
    const cardDraws = (i: number) => ctx2d(el.cardCanvases[i]!)?.ops.filter((o) => o.op === 'drawImage').length ?? 0
    return { el, geo, sets, dispose, scrollTo, cardDraws }
  }

  it('A4：看得到的卡片每一幀都畫', async () => {
    const t = await mount()
    await t.scrollTo(700) // 線頭 164px，碰到第一張卡（110px），卡片就在視窗裡
    for (let i = 0; i < 10; i++) runFrame()
    expect(t.cardDraws(0)).toBe(10)
    t.dispose()
  })

  it('A4：畫面外的卡片不畫但時間照走，畫完那一格照樣畫上去；結尾時藏起來的紙偶不畫，回到時間軸的那一幀就畫', async () => {
    const t = await mount()
    await t.scrollTo(5000) // 直接跳到結尾：兩張卡都立起來，但都在視窗上下半個視窗高以外
    for (let i = 0; i < 160; i++) runFrame() // 約 2.6 秒，描線 1 秒＋水彩 1.2 秒都走完
    expect([t.cardDraws(0), t.cardDraws(1)]).toEqual([1, 1])
    // 兩次都是畫完的那一格（共用的離屏 WebGL 只有一個）
    expect(gls).toHaveLength(1)
    const uniforms = gls[0]!.calls.filter((c) => c.op === 'uniform1f' && /^u(Draw|Wash)$/.test((c.args[0] as { name: string }).name)).map((c) => `${(c.args[0] as { name: string }).name}=${c.args[1]}`)
    expect(uniforms).toEqual(['uDraw=1', 'uWash=1', 'uDraw=1', 'uWash=1'])
    // 卡片立起的 CSS 照樣在立起那一幀觸發
    expect(t.el.cards.map((c) => c.querySelector<HTMLElement>('.anni-card')!.dataset.state)).toEqual(['pop', 'pop'])
    // 結尾（u>0）：時間軸的紙偶藏著，不擺位置也不畫
    const kidsDraws = () => ctx2d(t.el.kids)?.ops.filter((o) => o.op === 'drawImage').length ?? 0
    expect(t.el.kids.style.visibility).toBe('hidden')
    expect(kidsDraws()).toBe(0)
    expect(t.el.kids.style.transform).toBe('')
    // 捲回時間軸：同一幀擺好、畫好、顯示
    await t.scrollTo(1200)
    runFrame()
    expect(t.el.kids.style.visibility).toBe('')
    expect(kidsDraws()).toBe(2)
    expect(t.el.kids.style.transform).toMatch(/^translate\(/)
    t.dispose()
  })

  it('A7：measure 先量完再寫；尺寸與輸入沒變、畫布上只有一段時不重配也不重畫，畫過兩段就照原本重配重畫', async () => {
    const log: string[] = []
    const t = await mount(log)
    // 掛載時的 measure：所有讀取（rect、offset／client 尺寸）都在第一個寫入（畫布尺寸、CSS 變數）之前
    const readsBeforeWrites = () => { const w = log.indexOf('write'); return w > 0 && !log.slice(w).includes('read') }
    expect(readsBeforeWrites()).toBe(true)
    expect(t.sets.filter((s) => /anni-(ink|finale-ink|kids|finale-kids)\./.test(s))).toHaveLength(8)

    const ro = ros.at(-1)!
    const inkOps = ctx2d(t.el.ink).ops
    const stamps = () => inkOps.filter((o) => o.op === 'fillRect').length
    await t.scrollTo(700)
    runFrame() // 線畫第一段（0→164px）
    expect(stamps()).toBeGreaterThan(0)
    // RO 回呼（例如 observe 的第一次）：輸入沒變、只有一段 → 不重配、不重畫
    t.sets.length = 0
    log.length = 0
    const before = stamps()
    ro.cb([])
    runFrame()
    expect(t.sets).toEqual([])
    expect(stamps()).toBe(before)
    expect(readsBeforeWrites()).toBe(true) // 這次只寫 CSS 變數（同值），一樣先量完再寫

    // 再畫第二段，之後的 RO 回呼照原本重配、從 0 一次畫到線頭
    await t.scrollTo(900)
    runFrame()
    t.sets.length = 0
    inkOps.length = 0
    ro.cb([])
    runFrame()
    expect(t.sets).toEqual(expect.arrayContaining(['anni-ink.width', 'anni-ink.height']))
    const firstY = inkOps.find((o) => o.op === 'fillRect')!.args[1] as number
    expect(firstY).toBeLessThan(0) // 第一顆點在 y=0（減掉半徑）

    // 軌道高度變了：照原本重配重畫
    t.geo.get(t.el.track)!.h = 4100
    t.sets.length = 0
    ro.cb([])
    runFrame()
    expect(t.sets).toEqual(expect.arrayContaining(['anni-ink.width', 'anni-ink.height', 'anni-finale-ink.width', 'anni-finale-ink.height']))
    // 紙偶畫布大小沒變，不重配（每一幀都會整張重畫）
    expect(t.sets.filter((s) => s.includes('kids'))).toEqual([])
    t.dispose()
  })
})

describe('A9 拼圖：只在看得到時輪詢，--gold 掛載時取一次', () => {
  it('看不到時沒有計時器；看得到才每 120ms 檢查縮圖亮起的作品；亮格框色用掛載時取的 --gold', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: async () => [] } })
    const box = document.createElement('div')
    const canvas = document.createElement('canvas')
    box.append(canvas)
    document.body.append(box)
    Object.defineProperty(box, 'clientWidth', { configurable: true, value: 600 })
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 400 })
    const active = { art: -1 }
    const { mountMosaic } = await import('../app/utils/anniversary/mosaic')
    const dispose = await mountMosaic(canvas, { reduce: true, onHover: () => {}, onPick: () => {}, active: () => active.art })
    expect(vi.getTimerCount()).toBe(0)
    const io = ios.at(-1)!
    io.cb([{ target: canvas, isIntersecting: true }])
    expect(vi.getTimerCount()).toBe(1)
    io.cb([{ target: canvas, isIntersecting: true }])
    expect(vi.getTimerCount()).toBe(1)
    runFrame()
    expect(frames.size).toBe(0)
    const goldReads = propReads.filter((n) => n === '--gold').length
    expect(goldReads).toBe(1)
    // 縮圖亮起一件作品：下一次輪詢就重畫，框色是 --gold
    active.art = 3
    vi.advanceTimersByTime(120)
    expect(frames.size).toBe(1)
    runFrame()
    const strokes = ctx2d(canvas).ops.filter((o) => o.op === 'strokeStyle=').map((o) => o.args[0])
    expect(strokes.length).toBeGreaterThan(0)
    expect(new Set(strokes)).toEqual(new Set(['oklch(82% .14 84)']))
    expect(propReads.filter((n) => n === '--gold').length).toBe(goldReads)
    io.cb([{ target: canvas, isIntersecting: false }])
    expect(vi.getTimerCount()).toBe(0)
    dispose()
    delete (document as { fonts?: unknown }).fonts
  })
})
