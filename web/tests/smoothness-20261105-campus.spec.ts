// @vitest-environment happy-dom
// 首頁五校淡彩速寫的流暢度（2026-11-05）：畫出來的每一幀和之前逐位元相同，只是少做重複的工。
// 瀏覽器上的逐幀雜湊比對記在 README；這裡用假的 2D context 錄下繪圖指令，鎖住「指令與座標不變、少做的部分真的沒做」。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  drawImage(...args: unknown[]) { this.log.push(['drawImage', this.globalCompositeOperation, ...args]) }
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

interface FakeBitmap { width: number, height: number, close: () => void }
const bitmap = (): FakeBitmap => ({ width: 120, height: 80, close() { this.width = 0; this.height = 0 } })

let contexts: Map<HTMLCanvasElement, FakeContext>
let rafQueue: Map<number, FrameRequestCallback>
let created: number
const ctxOf = (canvas: HTMLCanvasElement) => contexts.get(canvas)!

beforeEach(() => {
  contexts = new Map()
  rafQueue = new Map()
  created = 0
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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** 每個測試一份新的模組（快取都是模組層的） */
async function freshSketch(images: Record<string, () => FakeBitmap | null> = {}) {
  vi.resetModules()
  const fetches: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (src: string) => { fetches.push(src); return { ok: true, blob: async () => new Blob([src]) } }))
  vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => {
    const src = await blob.text()
    return (images[src] ?? bitmap)()
  }))
  const mod = await import('../app/utils/campusSketch')
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
function card() {
  document.body.innerHTML = '<div class="photo-card"><canvas class="sketch-canvas"></canvas><img alt=""></div>'
  const el = document.querySelector<HTMLElement>('.photo-card')!
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
    // 換校後在閒置時間先準備新的左右鄰卡
    expect(script).toMatch(/else if \(!automatic\) void runDevelop\(selected\)\n\s+prepareNearby\(\)/)
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
