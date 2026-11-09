// @vitest-environment happy-dom
// 首頁五校淡彩速寫的流暢度（2026-11-05）：畫出來的每一幀和之前逐位元相同，只是少做重複的工。
// 瀏覽器上的逐幀雜湊比對記在 README；這裡用假的 2D context 錄下繪圖指令，鎖住「指令與座標不變、少做的部分真的沒做」。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type App, type Component } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { SKETCH_REGISTRATION, sketchLayout } from '../app/utils/campusSketch'
import { seededRandom, washPolygons, type Point } from '../app/utils/watercolor'

const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')

type Call = [string, ...unknown[]]
/** 只錄指令的 2D context（happy-dom 沒有 canvas） */
class FakeContext {
  log: Call[] = []
  globalCompositeOperation = 'source-over'
  globalAlpha = 1
  fillStyle: unknown = '#000'
  strokeStyle: unknown = '#000'
  lineWidth = 1
  #filter = 'none'
  constructor(readonly canvas: HTMLCanvasElement) {}
  get filter() { return this.#filter }
  set filter(value: string) { this.#filter = value; this.log.push(['filter', value]) }
  drawImage(...args: unknown[]) {
    // 同瀏覽器：已 close() 的 ImageBitmap 不能畫
    if ((args[0] as Partial<FakeBitmap> | undefined)?.closed) throw new DOMException('The image source is detached', 'InvalidStateError')
    this.log.push(['drawImage', this.globalCompositeOperation, ...args])
    if (this.#filter !== 'none') onFilterDraw()
  }
  fillRect(...args: number[]) { this.log.push(['fillRect', this.globalCompositeOperation, this.fillStyle, ...args]) }
  clearRect(...args: number[]) { this.log.push(['clearRect', ...args]) }
  beginPath() { this.log.push(['beginPath']) }
  moveTo(x: number, y: number) { this.log.push(['moveTo', x, y]) }
  lineTo(x: number, y: number) { this.log.push(['lineTo', x, y]) }
  closePath() { this.log.push(['closePath']) }
  arc() {}
  rect(...args: number[]) { this.log.push(['rect', ...args]) }
  clip() { this.log.push(['clip']) }
  save() { this.log.push(['save']) }
  restore() { this.log.push(['restore']) }
  fill() { this.log.push(['fill', this.fillStyle]) }
  stroke() { this.log.push(['stroke', this.strokeStyle, this.lineWidth]) }
  createPattern() { return { pattern: true } }
  createLinearGradient() { return { addColorStop() {} } }
  createImageData(w: number, h: number) { return { data: new Uint8ClampedArray(w * h * 4) } }
  putImageData() {}
}

interface FakeBitmap { width: number, height: number, closed: boolean, close: () => void }
const bitmap = (): FakeBitmap => ({ width: 120, height: 80, closed: false, close() { this.closed = true; this.width = 0; this.height = 0 } })
// 濾鏡圖層 drawImage 時呼叫（預算測試拿來推進假時鐘）
let onFilterDraw = () => {}

let contexts: Map<HTMLCanvasElement, FakeContext>
let rafQueue: Map<number, FrameRequestCallback>
let created: number
const ctxOf = (canvas: HTMLCanvasElement) => contexts.get(canvas)!
// 最近一個 freshSketch 載入的模組（afterEach 放掉它留下的工作）
let lastSketch: Partial<typeof import('../app/utils/campusSketch')> | null = null

beforeEach(() => {
  contexts = new Map()
  rafQueue = new Map()
  created = 0
  onFilterDraw = () => {}
  document.body.innerHTML = ''
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (!contexts.has(this)) contexts.set(this, new FakeContext(this))
    return contexts.get(this) as unknown as CanvasRenderingContext2D
  } as never)
  // bloomCanvas 的 toBlob：沒有 blob 時遮罩網址是空字串（照常跑）
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback: BlobCallback) { callback(null) })
  const createElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
    if (tag === 'canvas') created++
    return createElement(tag, options)
  }) as typeof document.createElement)
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { rafQueue.set(++id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => { rafQueue.delete(handle) })
  vi.stubGlobal('scheduler', { yield: () => Promise.resolve() })
  vi.stubGlobal('requestIdleCallback', () => 0)
  vi.spyOn(performance, 'now').mockReturnValue(1000)
})
afterEach(() => {
  // 上一個測試的模組還在等圖、排了閒置工作的話，會在下一個測試裡畫到新的假 context：先放掉（實際網頁只有一份模組）
  lastSketch?.releaseSketches?.()
  lastSketch = null
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.doUnmock('../app/utils/watercolor')
})

/**
 * 每個測試一份新的模組（快取都是模組層的）。delay：fetch 晚幾 ms 回（讓兩個呼叫端確實同時在等同一張圖）；
 * onWash：每產生一團水彩多邊形（washPolygons）時呼叫，預算測試拿來推進假時鐘、數算了幾團。
 */
async function freshSketch(images: Record<string, () => FakeBitmap | null> = {}, options: { delay?: number, onWash?: () => void } = {}) {
  vi.resetModules()
  const { delay, onWash } = options
  if (onWash) {
    vi.doMock('../app/utils/watercolor', async (importOriginal) => {
      const real = await importOriginal<typeof import('../app/utils/watercolor')>()
      return { ...real, washPolygons: (...args: Parameters<typeof real.washPolygons>) => { onWash(); return real.washPolygons(...args) } }
    })
  }
  const fetches: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (src: string) => {
    fetches.push(src)
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    return { ok: true, blob: async () => new Blob([src]) }
  }))
  vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => {
    const src = await blob.text()
    return (images[src] ?? bitmap)()
  }))
  const mod = await import('../app/utils/campusSketch')
  lastSketch = mod
  return { ...mod, fetches }
}
const flush = async (times = 20) => { for (let i = 0; i < times; i++) await Promise.resolve() }
function step(now: number) {
  const queued = [...rafQueue.values()]
  rafQueue.clear()
  queued.forEach((callback) => callback(now))
}

const SIZE = { width: 400, height: 200 }
const reg = SKETCH_REGISTRATION.yihua!
function geometry() {
  const scale = 0.85
  const box = sketchLayout(reg, SIZE.width, SIZE.height, 'center 55%')
  return { scale, W: Math.round(SIZE.width * scale), H: Math.round(SIZE.height * scale), lx: box.x * scale, ly: box.y * scale, lw: box.width * scale, lh: box.height * scale }
}
/** 一張卡（每個測試開始時 body 清空；同一個測試可以建好幾張） */
function card() {
  const el = document.createElement('div')
  el.className = 'photo-card'
  el.innerHTML = '<canvas class="sketch-canvas"></canvas><img alt="">'
  document.body.append(el)
  return { card: el, img: el.querySelector('img')!, canvas: el.querySelector('canvas')! }
}
const still = (sketch: Awaited<ReturnType<typeof freshSketch>>, parts: ReturnType<typeof card>, extra: Record<string, unknown> = {}) => sketch.paintSketchStill({
  ...parts, campusKey: 'yihua', registration: reg, lineSrc: '/line.webp', objectPosition: 'center 55%',
  wanted: () => true, size: () => SIZE, paper: 'oklch(99% .006 95)', ...extra
})
const develop = (sketch: Awaited<ReturnType<typeof freshSketch>>, parts: ReturnType<typeof card>, extra: Record<string, unknown> = {}) => sketch.developSketch({
  ...parts, campusKey: 'yihua', registration: reg, lineSrc: '/line.webp', colourSrc: '/colour.webp', objectPosition: 'center 55%',
  skyRgb: '134 184 222', from: 'sketch', wash: true, size: () => SIZE, paper: 'oklch(99% .006 95)', ...extra
})
/** 原本 developSketch 裡的寫法：先 40 個參數、排序後依序產生每團、最後天空 */
function referencePolys(campusKey: string, hasSky: boolean) {
  const { lx, ly, lw, lh } = geometry()
  const random = seededRandom(campusKey.length * 977 + campusKey.charCodeAt(0))
  const cx = lx + lw * 0.5, cy = ly + lh * 0.55
  const blobs = Array.from({ length: 10 }, () => {
    const x = lx + lw * (0.1 + random() * 0.8), y = ly + lh * (0.22 + random() * 0.62)
    const rx = lw * (0.12 + random() * 0.13)
    return { x, y, rx, ry: rx * (0.55 + random() * 0.3) }
  }).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
    .map((blob) => washPolygons(random, blob.x, blob.y, blob.rx, blob.ry, 22))
  const skies = (hasSky ? [0.3, 0.72] : []).map((fx) => washPolygons(random, lx + lw * fx, ly + lh * 0.14, lw * 0.26, lh * 0.12, 18))
  return { blobs, skies }
}
/** 從某張 canvas 的指令錄下來的多邊形（依 fill 的顏色分） */
function tracedPolygons(ctx: FakeContext, fill: string) {
  const polys: Point[][] = []
  let current: Point[] = []
  for (const [name, ...args] of ctx.log) {
    if (name === 'beginPath') current = []
    else if (name === 'moveTo' || name === 'lineTo') current.push([args[0] as number, args[1] as number])
    else if (name === 'fill' && args[0] === fill) polys.push(current)
  }
  return polys
}
const sameDoubles = (a: Point[][], b: Point[][]) => a.length === b.length && a.every((poly, i) => poly.length === b[i]!.length && poly.every(([x, y], k) => Object.is(x, b[i]![k]![0]) && Object.is(y, b[i]![k]![1])))
const maskCtx = () => [...contexts.values()].find((c) => c.log.some(([name, style]) => name === 'fill' && style === 'rgb(0 0 0 / .085)'))!
const skyCtx = () => [...contexts.values()].find((c) => c.log.some(([name, style]) => name === 'fill' && style === 'rgb(134 184 222 / .045)'))!
/** 主畫布上一次合成：鋪紙（source-over 的 fillRect） */
const composites = (ctx: FakeContext) => ctx.log.filter(([name, op, style]) => name === 'fillRect' && op === 'source-over' && typeof style === 'string').length

describe('campus-arrival-sync-decode-duplicate：原圖在 worker 解碼，抵達時不重畫預覽線稿', () => {
  it('線稿用 fetch → createImageBitmap 的點陣圖畫成濾鏡層，建好就 close()', async () => {
    const made: FakeBitmap[] = []
    const sketch = await freshSketch({ '/line.webp': () => { const b = bitmap(); made.push(b); return b } })
    const parts = card()
    await expect(still(sketch, parts)).resolves.toBe(true)
    expect(sketch.fetches).toEqual(['/line.webp'])
    const lineLayer = [...contexts.values()].find((c) => c.log.some(([name, value]) => name === 'filter' && value === 'grayscale(1) brightness(.8) contrast(2.4)'))!
    expect(lineLayer.log.find(([name]) => name === 'drawImage')?.[2]).toBe(made[0])
    expect(made[0]!.width).toBe(0)
    // 預覽線稿：紙、線稿層、紙紋
    const main = ctxOf(parts.canvas)
    expect(main.log.filter(([name]) => name === 'drawImage').map((call) => call[2])).toEqual([lineLayer.canvas])
  })
  it('createImageBitmap 不能用時退回 <img>（不 close）', async () => {
    class LoadedImage { onload: (() => void) | null = null; onerror: (() => void) | null = null; decoding = ''; set src(_: string) { queueMicrotask(() => this.onload?.()) } }
    vi.stubGlobal('Image', LoadedImage)
    const sketch = await freshSketch()
    vi.stubGlobal('createImageBitmap', undefined)
    const parts = card()
    await expect(still(sketch, parts)).resolves.toBe(true)
    const lineLayer = [...contexts.values()].find((c) => c.log.some(([name]) => name === 'filter'))!
    expect(lineLayer.log.find(([name]) => name === 'drawImage')?.[2]).toBeInstanceOf(LoadedImage)
  })
  it('線稿載好時這張已經換到中央（wanted 不成立）：不碰卡片的 canvas', async () => {
    const sketch = await freshSketch()
    const parts = card()
    await expect(still(sketch, parts, { wanted: () => false })).resolves.toBe(false)
    expect(contexts.has(parts.canvas)).toBe(false)
  })
  it('第一次抵達：預覽線稿已經是目前尺寸就不再畫一次，交給 developSketch 整張重畫', () => {
    const board = read('../app/components/CampusBoard.vue')
    expect(board).toContain("if (!sketchIsCurrent(i) && !await showLineArt(i)) { showPhoto(); return }")
    expect(board).toMatch(/function sketchIsCurrent\(i: number\) \{[\s\S]*?lineArt\.value\.has\(campus\.key\)[\s\S]*?canvas\.width === Math\.round\(size\.width \* sketchScale\(\)\)/)
  })
})

describe('campus-develop-start-longtask：多邊形、濾鏡層、暫存 canvas 不再每次在點擊的 task 裡重做', () => {
  it('水彩多邊形的座標和原本的寫法逐位元相同（含天空，random 取用順序不變）', async () => {
    const sketch = await freshSketch()
    const parts = card()
    const handle = develop(sketch, parts)
    await flush()
    step(1000 + 10000)
    const ref = referencePolys('yihua', true)
    expect(sameDoubles(tracedPolygons(maskCtx(), 'rgb(0 0 0 / .085)'), ref.blobs.flat())).toBe(true)
    expect(sameDoubles(tracedPolygons(skyCtx(), 'rgb(134 184 222 / .045)'), ref.skies.flat())).toBe(true)
    // 外圈描邊照舊每 5 層一次、線寬 2·scale
    expect(maskCtx().log.filter(([name]) => name === 'stroke')).toHaveLength(10 * 5)
    expect(maskCtx().log.find(([name]) => name === 'stroke')?.[2]).toBe(2 * 0.85)
    handle.cancel()
  })
  it('閒置時間先算一部分（prepareSketch），上色時同步補完：座標一樣', async () => {
    const idle: (() => void)[] = []
    const sketch = await freshSketch()
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => { idle.push(callback); return idle.length })
    let clock = 1000
    vi.mocked(performance.now).mockImplementation(() => (clock += 5))
    sketch.prepareSketch({ campusKey: 'yihua', registration: reg, lineSrc: '/line.webp', objectPosition: 'center 55%', size: SIZE, skyRgb: '134 184 222' })
    idle.shift()!()
    vi.mocked(performance.now).mockReturnValue(1000)
    const parts = card()
    const handle = develop(sketch, parts)
    await flush()
    step(1000 + 10000)
    const ref = referencePolys('yihua', true)
    expect(sameDoubles(tracedPolygons(maskCtx(), 'rgb(0 0 0 / .085)'), ref.blobs.flat())).toBe(true)
    expect(sameDoubles(tracedPolygons(skyCtx(), 'rgb(134 184 222 / .045)'), ref.skies.flat())).toBe(true)
    handle.cancel()
  })
  it('讀不到天空色就沒有那兩筆，顏料團不受影響', async () => {
    const sketch = await freshSketch()
    const parts = card()
    const handle = develop(sketch, parts, { skyRgb: '' })
    await flush()
    step(1000 + 10000)
    const ref = referencePolys('yihua', false)
    expect(sameDoubles(tracedPolygons(maskCtx(), 'rgb(0 0 0 / .085)'), ref.blobs.flat())).toBe(true)
    expect(ref.skies).toEqual([])
    handle.cancel()
  })
  it('換回同一校：線稿層、淡彩層、暫存 canvas、多邊形都重用，不新建 canvas、不重跑濾鏡', async () => {
    const sketch = await freshSketch()
    const parts = card()
    const first = develop(sketch, parts)
    await flush()
    step(1000 + 10000)
    first.cancel()
    const before = created
    const filters = [...contexts.values()].reduce((n, c) => n + c.log.filter(([name]) => name === 'filter').length, 0)
    const fetches = sketch.fetches.length
    const mask = maskCtx()
    const maskCalls = mask.log.length
    const second = develop(sketch, parts)
    await flush()
    expect(created).toBe(before)
    expect([...contexts.values()].reduce((n, c) => n + c.log.filter(([name]) => name === 'filter').length, 0)).toBe(filters)
    expect(sketch.fetches.length).toBe(fetches)
    // 拿出來重用的遮罩先整張清空（和新建的一樣全透明）
    const { W, H } = geometry()
    expect(mask.log.slice(maskCalls)[0]).toEqual(['clearRect', 0, 0, W, H])
    second.cancel()
  })
  it('keepSketches 以外的學校：圖層畫完就丟，下次從 HTTP 快取重取', async () => {
    const sketch = await freshSketch()
    sketch.keepSketches(['minghua'])
    const parts = card()
    await still(sketch, parts)
    await still(sketch, parts)
    expect(sketch.fetches).toEqual(['/line.webp', '/line.webp'])
    sketch.keepSketches(['yihua'])
    await still(sketch, parts)
    await still(sketch, parts)
    expect(sketch.fetches).toEqual(['/line.webp', '/line.webp', '/line.webp'])
  })
  it('同尺寸重畫不重設 canvas 的 width／height；讀不到紙色時照舊重設', async () => {
    const sketch = await freshSketch()
    const parts = card()
    await still(sketch, parts)
    const writes: string[] = []
    new MutationObserver((list) => list.forEach((r) => writes.push(r.attributeName!))).observe(parts.canvas, { attributes: true })
    await still(sketch, parts)
    const handle = develop(sketch, parts, { wash: false })
    await flush()
    await Promise.resolve()
    expect(writes).toEqual([])
    handle.cancel()
    await still(sketch, parts, { paper: '' })
    await Promise.resolve()
    expect(writes).toEqual(['width', 'height'])
  })
  it('先讓出一幀才建畫布、畫第一幀；from sketch 時 is-sketch 照舊同步掛上', async () => {
    let release = () => {}
    const sketch = await freshSketch()
    vi.stubGlobal('scheduler', { yield: () => new Promise<void>((resolve) => { release = resolve }) })
    const parts = card()
    const handle = develop(sketch, parts)
    expect(parts.card.classList.contains('is-sketch')).toBe(true)
    await flush()
    expect(contexts.has(parts.canvas)).toBe(false)
    release()
    await flush()
    expect(composites(ctxOf(parts.canvas))).toBe(1)
    handle.cancel()
  })
  it('沒有 scheduler.yield：等下一幀畫完（rAF 再接 setTimeout）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const sketch = await freshSketch()
    vi.stubGlobal('scheduler', undefined)
    const parts = card()
    const handle = develop(sketch, parts)
    await flush()
    expect(rafQueue.size).toBe(1)
    step(1000)
    await flush()
    expect(contexts.has(parts.canvas)).toBe(false)
    vi.advanceTimersByTime(0)
    await flush()
    expect(composites(ctxOf(parts.canvas))).toBe(1)
    handle.cancel()
    vi.useRealTimers()
  })
  it('CampusBoard：卡片尺寸記在 ResizeObserver、紙色與天空色掛載時讀一次，換校 task 中途不讀 clientWidth／getComputedStyle', () => {
    const board = read('../app/components/CampusBoard.vue')
    const script = board.slice(0, board.indexOf('</script>'))
    const sources = script.slice(script.indexOf('function sketchSources'), script.indexOf('function nearbyCampuses'))
    expect(sources).not.toContain('clientWidth')
    expect(sources).toContain('currentCardSize()')
    expect(script).toContain('new ResizeObserver(() => { measureCard() })')
    expect(script).toMatch(/onMounted\(\(\) => \{[\s\S]*?paperColour = root\.value \? getComputedStyle\(root\.value\)\.getPropertyValue\('--paper'\)\.trim\(\) : ''/)
    const runDevelop = script.slice(script.indexOf('async function runDevelop'), script.indexOf('const canAuto'))
    expect(runDevelop).not.toContain('getComputedStyle')
    expect(runDevelop).toContain('size: currentCardSize, paper: paperColour')
    // 換校後在閒置時間先準備新的左右鄰卡（自動輪播只預建線稿層，見下面 CampusBoard 的掛載測試）
    expect(script).toMatch(/else if \(!automatic\) void runDevelop\(selected\)\n(\s+\/\/.*\n)?\s+prepareNearby\(!automatic\)/)
  })
})

describe('campus-render-full-recomposite：沒有新筆觸的幀不合成，有新筆觸只重畫碰到的整列', () => {
  it('從線稿接手：第一幀整張；沒新筆觸的幀不合成；之後只在 clip 的整列裡重畫', async () => {
    const sketch = await freshSketch()
    const parts = card()
    const handle = develop(sketch, parts)
    await flush()
    const main = ctxOf(parts.canvas)
    expect(composites(main)).toBe(1)
    expect(main.log.some(([name]) => name === 'clip')).toBe(false)
    // t = 250 + 16：第一團 450ms 才開始
    step(1016)
    expect(composites(main)).toBe(1)
    // t = 500：第一團的第一層
    step(1250)
    expect(composites(main)).toBe(2)
    const { W, H, scale } = geometry()
    const poly = referencePolys('yihua', true).blobs[0]![0]!
    const margin = Math.ceil(10 * scale) + 2
    const y0 = Math.max(0, Math.floor(Math.min(...poly.map((p) => p[1])) - margin))
    const y1 = Math.min(H, Math.ceil(Math.max(...poly.map((p) => p[1])) + margin))
    const last = main.log.slice(main.log.findLastIndex(([name]) => name === 'save'))
    expect(last.slice(0, 4)).toEqual([['save'], ['beginPath'], ['rect', 0, y0, W, y1 - y0], ['clip']])
    expect(last.at(-1)).toEqual(['restore'])
    handle.cancel()
  })
  it('從照片畫起：描線那 1.1 秒每幀整張合成（不 clip）', async () => {
    const sketch = await freshSketch()
    const parts = card()
    const handle = develop(sketch, parts, { from: 'photo' })
    await flush()
    const main = ctxOf(parts.canvas)
    for (let t = 16; t < 1100; t += 16) step(1000 + t)
    expect(composites(main)).toBe(1 + Math.floor(1099 / 16))
    expect(main.log.some(([name]) => name === 'clip')).toBe(false)
    handle.cancel()
  })
})

describe('campus-auto-switch-redundant-repaint：只做得到「不重配置」', () => {
  it('自動輪播換到中央（wash:false）照舊畫第一幀：經 scratch 中轉的線稿和預覽線稿實測最多差 14/255，不能沿用預覽線稿', async () => {
    const sketch = await freshSketch()
    const parts = card()
    await still(sketch, parts)
    const main = ctxOf(parts.canvas)
    const before = composites(main)
    const handle = develop(sketch, parts, { wash: false })
    await flush()
    expect(composites(main)).toBe(before + 1)
    // 線稿層經 scratch 合成（不是直接畫上主畫布）
    expect(main.log.at(-3)?.[0]).toBe('drawImage')
    expect((main.log.at(-3)?.[2] as HTMLCanvasElement).width).toBe(geometry().W)
    handle.cancel()
  })
})

describe('照片暈開切短（選做）：遮罩蓋滿就停，收尾照舊在 1.7 秒', () => {
  const bezier = (u: number, a: number, b: number) => 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u * u * b + u ** 3
  it('是原曲線 (.33,.12,.3,1) 到 90%（468%）那一段，控制點與時長用完整的值', async () => {
    const { BLOOM_TRANSITION } = await freshSketch()
    let lo = 0, hi = 1
    for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (bezier(m, 0.12, 1) < 0.9) lo = m; else hi = m }
    const u = (lo + hi) / 2, X = bezier(u, 0.33, 0.3), Y = bezier(u, 0.12, 1)
    const expected = [u * 0.33 / X, u * 0.12 / Y, (2 * u * (1 - u) * 0.33 + u * u * 0.3) / X, (2 * u * (1 - u) * 0.12 + u * u * 1) / Y]
    const [, ms, ease] = BLOOM_TRANSITION.match(/^-webkit-mask-size ([\d.]+)ms cubic-bezier\(([^)]+)\),mask-size \1ms cubic-bezier\(\2\)$/)!
    expect(Number(ms)).toBeCloseTo(1700 * X, 9)
    ease!.split(',').map(Number).forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 14))
    // 至少 8 位小數（只留 6 位有效數字時暈開中段實測像素不同）
    expect(ease!.split(',').every((value) => value.replace(/^0?\./, '').length >= 8)).toBe(true)
  })
  it('468% 時卡片四角還在 bloomCanvas 的實心核心裡，至少留 1.5 texel', () => {
    const watercolor = read('../app/utils/watercolor.ts')
    const bloom = watercolor.slice(watercolor.indexOf('export function bloomCanvas'), watercolor.indexOf('export function revealMaskCanvas'))
    expect(bloom).toContain('const S = 128')
    expect(bloom).toContain('ctx.arc(S / 2, S / 2, S * 0.17, 0, Math.PI * 2)')
    const core = 128 * 0.17, corner = Math.SQRT2 * 64 / 4.68
    expect(core - corner).toBeGreaterThanOrEqual(1.5)
  })
  it('CSS 的終點是 468%；轉場和 BLOOM_TRANSITION 同一串（CSS 那份會被 build 壓短，只是備援）', async () => {
    const { BLOOM_TRANSITION } = await freshSketch()
    const board = read('../app/components/CampusBoard.vue')
    expect(board).toContain('.photo-card.is-sketch.is-developed img{--develop:468%}')
    expect(board).toContain(`.photo-card.is-sketch.is-develop img{opacity:1;transition:${BLOOM_TRANSITION};`)
  })
  it('暈開時 inline 掛上完整的轉場；轉場提早結束後，收尾照舊等到 PHOTO_MS（輪播才開始算四秒）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const sketch = await freshSketch()
    const parts = card()
    const handle = develop(sketch, parts, { wash: false })
    let finished = false
    void handle.done.then(() => { finished = true })
    await flush()
    vi.advanceTimersByTime(450)
    expect(parts.card.classList.contains('is-developed')).toBe(true)
    expect(parts.img.style.transition).toBe(sketch.BLOOM_TRANSITION)
    const end = new Event('transitionend')
    Object.defineProperties(end, { propertyName: { value: 'mask-size' }, elapsedTime: { value: 1.1004567274385 } })
    parts.img.dispatchEvent(end)
    vi.advanceTimersByTime(599)
    await flush()
    expect(finished).toBe(false)
    expect(parts.card.classList.contains('is-sketch')).toBe(true)
    vi.advanceTimersByTime(1)
    await flush()
    expect(finished).toBe(true)
    expect(parts.card.classList.contains('is-sketch')).toBe(false)
    expect(parts.img.style.transition).toBe('')
    vi.useRealTimers()
  })
})

// ---------- 2026-11-05 審查後的修正（87342e9／f6fbbd7 的後續） ----------

describe('審查後：原圖點陣圖等最後一個呼叫端用完才 close（計數）', () => {
  it('不在 keepSketches 的學校：兩張預覽線稿同時在等同一張圖，兩張都畫成功，共用一次下載，最後才 close', async () => {
    const made: FakeBitmap[] = []
    const sketch = await freshSketch({ '/line.webp': () => { const b = bitmap(); made.push(b); return b } }, { delay: 5 })
    sketch.keepSketches(['minghua'])
    const a = card(), b = card()
    // 原本：先建好的那個就 close，後到的拿已關閉的點陣圖 drawImage 丟 InvalidStateError → [true, false]
    await expect(Promise.all([still(sketch, a), still(sketch, b)])).resolves.toEqual([true, true])
    expect(sketch.fetches).toEqual(['/line.webp'])
    expect(made).toHaveLength(1)
    expect(made[0]!.closed).toBe(true)
    for (const parts of [a, b]) expect(ctxOf(parts.canvas).log.filter(([name]) => name === 'drawImage')).toHaveLength(1)
    // 不在 keep：圖層沒有留，下次照舊從 HTTP 快取重取（不是拿那張已關閉的）
    await expect(still(sketch, card())).resolves.toBe(true)
    expect(sketch.fetches).toEqual(['/line.webp', '/line.webp'])
  })
  it('同一張線稿兩種尺寸同時在等（載入中卡片變大小）：預覽線稿和 developSketch 都畫成功，淡彩速寫照常播', async () => {
    const sketch = await freshSketch({}, { delay: 5 })
    const a = card(), b = card()
    let size = SIZE
    const painted = still(sketch, a, { size: () => size })
    size = { width: 480, height: 240 }
    const handle = develop(sketch, b, { size: () => size })
    let finished = false
    void handle.done.then(() => { finished = true })
    await expect(painted).resolves.toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 30))
    await flush()
    // 原本：developSketch 那份拿到已關閉的點陣圖，line 變 null → cleanup，done 提早 resolve、is-sketch 被拿掉
    expect(finished).toBe(false)
    expect(b.card.classList.contains('is-sketch')).toBe(true)
    expect(composites(ctxOf(b.canvas))).toBe(1)
    expect(b.canvas.width).toBe(Math.round(480 * 0.85))
    // 預覽線稿量到新尺寸，照新尺寸畫
    expect(a.canvas.width).toBe(Math.round(480 * 0.85))
    handle.cancel()
  })
  it('等圖失敗：計數照樣還回去，之後同一網址不再重試（同原本）', async () => {
    const sketch = await freshSketch()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('decode') }))
    class BrokenImage { onload: (() => void) | null = null; onerror: ((error: unknown) => void) | null = null; decoding = ''; set src(_: string) { queueMicrotask(() => this.onerror?.(new Error('404'))) } }
    vi.stubGlobal('Image', BrokenImage)
    await expect(still(sketch, card())).resolves.toBe(false)
    await expect(still(sketch, card())).resolves.toBe(false)
    expect(sketch.fetches).toEqual(['/line.webp'])
  })
})

describe('審查後：閒置時間看 deadline.timeRemaining()，濾鏡層同步畫、算進預算', () => {
  let clock: number
  let idle: ((deadline?: IdleDeadline) => void)[]
  /** 從現在起還有 ms 的閒置時間（照假時鐘遞減） */
  const deadline = (ms: number, didTimeout = false) => {
    const start = clock
    return { didTimeout, timeRemaining: () => Math.max(0, ms - (clock - start)) } as IdleDeadline
  }
  const captureIdle = () => vi.stubGlobal('requestIdleCallback', (callback: (deadline?: IdleDeadline) => void) => { idle.push(callback); return idle.length })
  // 每團水彩多邊形假裝花 3ms
  async function idleSketch() {
    const sketch = await freshSketch({}, { onWash: () => { clock += 3 } })
    captureIdle()
    return sketch
  }
  const prepare = (sketch: Awaited<ReturnType<typeof freshSketch>>, extra: Record<string, unknown> = {}) => sketch.prepareSketch({
    campusKey: 'yihua', registration: reg, lineSrc: '/line.webp', objectPosition: 'center 55%', size: SIZE, skyRgb: '134 184 222', ...extra
  })
  const filterDraws = () => [...contexts.values()].filter((c) => c.log.some(([name]) => name === 'filter') && c.log.some(([name]) => name === 'drawImage')).length
  beforeEach(() => {
    clock = 1000
    idle = []
    vi.mocked(performance.now).mockImplementation(() => clock)
  })

  it('timeout 逼出來的那次（timeRemaining 0）只做一步就讓出；一步一塊算完，座標照舊逐位元相同', async () => {
    const sketch = await idleSketch()
    prepare(sketch)
    let blocks = 0
    // 原本不看 deadline：一塊做到 8ms（四步）才停，4 塊就算完
    while (idle.length) { idle.shift()!(deadline(0, true)); blocks++ }
    // 先 40 個參數、10 團、2 筆天空，最後一步收尾
    expect(blocks).toBe(13)
    const parts = card()
    const handle = develop(sketch, parts)
    await flush()
    step(clock + 10000)
    const ref = referencePolys('yihua', true)
    expect(sameDoubles(tracedPolygons(maskCtx(), 'rgb(0 0 0 / .085)'), ref.blobs.flat())).toBe(true)
    expect(sameDoubles(tracedPolygons(skyCtx(), 'rgb(134 184 222 / .045)'), ref.skies.flat())).toBe(true)
    handle.cancel()
  })
  it('閒置時間夠：一塊不超過 8ms，下一步估計和上一步一樣久、剩下的不夠就不開', async () => {
    const sketch = await idleSketch()
    prepare(sketch)
    idle.shift()!(deadline(50))
    // 原本「還沒到 8ms 就再開一步」：0、3、6ms 各開一步，做到 9ms
    expect(clock - 1000).toBeLessThanOrEqual(8)
    expect(idle).toHaveLength(1)
  })
  it('瀏覽器給的閒置時間比 8ms 少：照它給的', async () => {
    const sketch = await idleSketch()
    prepare(sketch)
    idle.shift()!(deadline(4))
    expect(clock - 1000).toBeLessThanOrEqual(4)
  })
  it('預建濾鏡層：等到圖才排一個同步步驟，閒置回呼裡就畫完，花的時間算進那一塊（一層超過預算，另一層留到下一塊）', async () => {
    const sketch = await idleSketch()
    onFilterDraw = () => { clock += 20 }
    prepare(sketch, { colourSrc: '/colour.webp', wash: false })
    await flush(60)
    // 下載與解碼在閒置時間外等；wash:false 不排多邊形
    expect(filterDraws()).toBe(0)
    expect(idle).toHaveLength(1)
    idle.shift()!(deadline(50))
    // 原本閒置步驟只是 void sketchLayer(...)：回呼結束時還沒畫，之後兩層在同一個 microtask checkpoint 連著畫
    expect(filterDraws()).toBe(1)
    await flush(60)
    expect(filterDraws()).toBe(1)
    expect(idle).toHaveLength(1)
    idle.shift()!(deadline(50))
    expect(filterDraws()).toBe(2)
    // 預建好的圖層上色時直接用，不再取圖、不再跑濾鏡
    const fetches = sketch.fetches.length
    const handle = develop(sketch, card())
    await flush()
    expect(sketch.fetches.length).toBe(fetches)
    expect(filterDraws()).toBe(2)
    handle.cancel()
  })
  it('wash:false 不算水彩多邊形（自動輪播換進來的鄰卡）；上色時照舊同步補完', async () => {
    let washes = 0
    const sketch = await freshSketch({}, { onWash: () => { washes++ } })
    captureIdle()
    prepare(sketch, { wash: false })
    await flush(60)
    while (idle.length) idle.shift()!(deadline(50))
    expect(washes).toBe(0)
    const handle = develop(sketch, card())
    await flush()
    expect(washes).toBe(12)
    handle.cancel()
  })
  it('被 keepSketches 逐出的那份多邊形，閒置時間不再往下算', async () => {
    let washes = 0
    const sketch = await freshSketch({}, { onWash: () => { washes++ } })
    captureIdle()
    sketch.keepSketches(['yihua'])
    prepare(sketch)
    idle.shift()!(deadline(0, true))
    idle.shift()!(deadline(0, true))
    expect(washes).toBe(1)
    sketch.keepSketches(['minghua'])
    while (idle.length) idle.shift()!(deadline(50))
    expect(washes).toBe(1)
  })
  it('沒有 requestIdleCallback：照舊用 setTimeout 退路（不帶 deadline，只看 8ms）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    let washes = 0
    const sketch = await freshSketch({}, { onWash: () => { washes++ } })
    vi.stubGlobal('requestIdleCallback', undefined)
    prepare(sketch)
    vi.advanceTimersByTime(31)
    expect(washes).toBe(0)
    vi.advanceTimersByTime(1)
    expect(washes).toBe(12)
    vi.useRealTimers()
  })
})

describe('審查後：releaseSketches 放掉模組層的快取與閒置工作（CampusBoard 卸載時呼叫）', () => {
  it('暫存 canvas 設成 0×0、圖層與多邊形清掉；之後上色從頭準備，畫出來一樣', async () => {
    const sketch = await freshSketch()
    const parts = card()
    const first = develop(sketch, parts)
    await flush()
    step(1000 + 10000)
    first.cancel()
    const { W, H } = geometry()
    const scratch = [...contexts.values()].map((c) => c.canvas).filter((el) => el !== parts.canvas && el.width === W && el.height === H)
    expect(scratch).toHaveLength(3)
    sketch.releaseSketches()
    for (const el of scratch) expect([el.width, el.height]).toEqual([0, 0])
    const before = { created, fetches: sketch.fetches.length }
    const second = develop(sketch, parts)
    await flush()
    // 新建三張暫存 canvas 與線稿、淡彩兩層（再取一次原圖），不拿 0×0 的那幾張
    expect(created - before.created).toBe(5)
    expect(sketch.fetches.length - before.fetches).toBe(2)
    step(1000 + 10000)
    const masks = [...contexts.values()].filter((c) => c.log.some(([name, style]) => name === 'fill' && style === 'rgb(0 0 0 / .085)'))
    expect(masks).toHaveLength(2)
    expect(masks[1]!.canvas.width).toBe(W)
    expect(sameDoubles(tracedPolygons(masks[1]!, 'rgb(0 0 0 / .085)'), referencePolys('yihua', true).blobs.flat())).toBe(true)
    second.cancel()
  })
  it('排好的閒置工作清掉、手上的原圖還回去；還在下載的回來也不再排工作、不存快取', async () => {
    const idle: (() => void)[] = []
    const made: FakeBitmap[] = []
    let washes = 0
    const sketch = await freshSketch({
      '/line.webp': () => { const b = bitmap(); made.push(b); return b },
      '/colour.webp': () => { const b = bitmap(); made.push(b); return b }
    }, { onWash: () => { washes++ } })
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => { idle.push(callback); return idle.length })
    const options = { campusKey: 'yihua', registration: reg, lineSrc: '/line.webp', objectPosition: 'center 55%', size: SIZE, skyRgb: '134 184 222' }
    sketch.prepareSketch(options)
    await flush(60)
    // 線稿已經拿到、預建步驟在佇列裡；再排一次（線稿共用同一份、淡彩剛開始下載）就卸載
    expect(made).toHaveLength(1)
    sketch.prepareSketch({ ...options, colourSrc: '/colour.webp' })
    sketch.releaseSketches()
    expect(made[0]!.closed).toBe(false)
    while (idle.length) idle.shift()!()
    await flush(60)
    // 佇列裡的步驟沒做就還回原圖，還在等的回來看到已卸載也還回去：最後一個還的把點陣圖關掉
    expect(made).toHaveLength(2)
    expect(made.every((b) => b.closed)).toBe(true)
    expect(idle).toHaveLength(0)
    expect(washes).toBe(0)
    expect([...contexts.values()].some((c) => c.log.some(([name]) => name === 'filter'))).toBe(false)
  })
  it('卸載前開始等圖的預覽線稿，回來時照樣畫但不存進快取', async () => {
    const sketch = await freshSketch({}, { delay: 5 })
    const painting = still(sketch, card())
    sketch.releaseSketches()
    await expect(painting).resolves.toBe(true)
    await still(sketch, card())
    expect(sketch.fetches).toEqual(['/line.webp', '/line.webp'])
  })
  it('keepSketches 回到「全部留」', async () => {
    const sketch = await freshSketch()
    sketch.keepSketches(['minghua'])
    sketch.releaseSketches()
    await still(sketch, card())
    await still(sketch, card())
    expect(sketch.fetches).toEqual(['/line.webp'])
  })
  it('releaseSketches 之後才收尾的淡彩速寫，暫存 canvas 不放回去', async () => {
    const sketch = await freshSketch()
    const first = develop(sketch, card())
    await flush()
    sketch.releaseSketches()
    first.cancel()
    const before = created
    const second = develop(sketch, card())
    await flush()
    // 三張暫存＋兩層圖層都新建
    expect(created - before).toBe(5)
    second.cancel()
  })
})

describe('審查後：CampusBoard 只在有換校意圖時算多邊形、強制色彩不預載、卸載時放掉快取', () => {
  interface Prepared { campusKey: string, wash?: boolean, colourSrc?: string }
  const site = fixture as unknown as SiteContent
  let prepared: Prepared[]
  let events: string[]
  let advance: () => void
  let observers: { callback: IntersectionObserverCallback, options?: IntersectionObserverInit }[]
  let app: App | null = null
  afterEach(() => {
    app?.unmount()
    app = null
    for (const path of ['../app/utils/campusSketch', '../app/utils/carouselClock', '../app/composables/useCampusBooking']) vi.doUnmock(path)
  })
  /** 掛上 CampusBoard：淡彩速寫換成只記錄呼叫的假模組，輪播計時器換成手動推進（advance＝自動換下一校） */
  async function mountBoard(forcedColors = false) {
    vi.resetModules()
    prepared = []
    events = []
    observers = []
    advance = () => {}
    vi.doMock('../app/utils/campusSketch', async (importOriginal) => ({
      ...await importOriginal<typeof import('../app/utils/campusSketch')>(),
      prepareSketch: (options: Prepared) => { prepared.push({ campusKey: options.campusKey, wash: options.wash, colourSrc: options.colourSrc }) },
      keepSketches: () => {},
      releaseSketches: () => { events.push('release') },
      paintSketchStill: async () => true,
      developSketch: () => ({ done: new Promise<void>(() => {}), cancel: () => { events.push('cancel') } })
    }))
    vi.doMock('../app/utils/carouselClock', () => ({
      createCarouselClock: (options: { onAdvance: () => void }) => { advance = options.onAdvance; return { start() {}, pause() {}, reset() {}, destroy() {} } }
    }))
    vi.doMock('../app/composables/useCampusBooking', () => ({ loadCampusBooking: async () => { throw new Error('offline') } }))
    // Nuxt 的自動匯入
    for (const [name, value] of Object.entries({ computed, ref, shallowRef, watch, onMounted, onBeforeUnmount, nextTick })) vi.stubGlobal(name, value)
    vi.stubGlobal('useRoute', () => ({ query: {} }))
    vi.stubGlobal('useNuxtApp', () => ({ hook: () => () => {} }))
    vi.stubGlobal('navigateTo', async () => {})
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: forcedColors && query === '(forced-colors: active)', addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { observers.push({ callback, options }) }
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    const { default: CampusBoard } = await import('../app/components/CampusBoard.vue')
    // 照片 2026-11-05 起是 <ResponsivePicture>（AVIF）；Nuxt 的自動註冊在裸 createApp 裡沒有
    const { default: ResponsivePicture } = await import('../app/components/ResponsivePicture.vue')
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp({ render: () => h(CampusBoard as Component, { board: site.home.campusBoard, campuses: site.campuses }) })
    app.component('NuxtLink', defineComponent({ props: { to: { type: String, required: true } }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }))
    app.component('ResponsivePicture', ResponsivePicture)
    app.mount(host)
    await flush()
    // 區塊離視窗 800px 內：預載目前這校、畫左右預覽線稿
    observers.find((o) => o.options?.rootMargin === '800px 0px')!.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    await flush()
    return host
  }
  const tab = (host: HTMLElement, key: string) => host.querySelector<HTMLButtonElement>(`#campus-tab-${key}`)!

  it('抵達：目前這校連多邊形與淡彩一起準備；左右鄰卡只預建線稿層', async () => {
    await mountBoard()
    expect(prepared[0]).toEqual({ campusKey: 'yihua', wash: true, colourSrc: '/assets/campus-line-art-yihua-colour.webp' })
    expect(prepared.slice(1)).toEqual(['yihua', 'minghua', 'renwu'].map((campusKey) => ({ campusKey, wash: false, colourSrc: undefined })))
  })
  it('自動輪播換校：新的左右鄰卡只預建線稿層（不算多邊形）', async () => {
    await mountBoard()
    for (let round = 0; round < 5; round++) {
      prepared = []
      advance()
      await flush()
      expect(prepared).toHaveLength(3)
      // 原本 prepareNearby() 不分自動、手動，每輪都替新鄰卡算一份多邊形
      expect(prepared.every((p) => p.wash === false && !p.colourSrc)).toBe(true)
    }
  })
  it('手動換校：新的左右鄰卡連多邊形一起準備（淡彩層照舊不載）', async () => {
    const host = await mountBoard()
    prepared = []
    host.querySelectorAll<HTMLButtonElement>('.page-dot')[2]!.click()
    await flush()
    expect(prepared.map((p) => p.campusKey).sort()).toEqual(['chongde', 'international', 'minghua'])
    expect(prepared.every((p) => p.wash === true && !p.colourSrc)).toBe(true)
  })
  it('分頁 pointerenter／pointerdown／focus：那一校連淡彩層與多邊形一起準備', async () => {
    const host = await mountBoard()
    for (const type of ['pointerenter', 'pointerdown', 'focus']) {
      prepared = []
      tab(host, 'international').dispatchEvent(new Event(type))
      expect(prepared, type).toEqual([{ campusKey: 'international', wash: true, colourSrc: '/assets/campus-line-art-international-colour.webp' }])
    }
  })
  it('強制色彩：預載與滑到、按下、focus 分頁都不準備（畫布不顯示，準備了也白做）', async () => {
    const host = await mountBoard(true)
    for (const type of ['pointerenter', 'pointerdown', 'focus']) tab(host, 'international').dispatchEvent(new Event(type))
    expect(prepared).toEqual([])
  })
  it('卸載：先取消上色，再 releaseSketches 放掉模組層的快取', async () => {
    const host = await mountBoard()
    host.querySelectorAll<HTMLButtonElement>('.page-dot')[1]!.click()
    await flush()
    events = []
    app!.unmount()
    app = null
    expect(events).toEqual(['cancel', 'release'])
  })
})
