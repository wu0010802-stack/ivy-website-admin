// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, ref } from 'vue'
import { BLOOM_EASE, useWatercolor } from '../app/composables/useWatercolor'
import { bloomCanvas } from '../app/utils/watercolor'

// 2026-11-05 前台流暢度：特色教學頁與進入特色教學頁的轉場遮罩（README 同日段落、DESIGN.md 同日章節）。
// 每一條都是「畫面不變、少做事」：照片暈開在蓋滿處截斷、段落淡出改紙色蓋層、pump 只重合成改到的外框、
// 轉場遮罩的網址到暈開那一步才寫到 <html>、三張遮罩跨頁快取。
const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const css = stripComments(read('../app/assets/css/curriculum.css'))
/** 從 start（@media 開頭）切出整個區塊，大括號配對 */
const block = (source: string, start: string) => {
  const from = source.indexOf(start)
  if (from < 0) return ''
  let depth = 0
  for (let i = source.indexOf('{', from); i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(from, i + 1)
  }
  return source.slice(from)
}
const printBlock = block(css, '@media print')
const forcedBlock = block(css, '@media (forced-colors: active)')
const reducedBlock = block(css, '@media (prefers-reduced-motion: reduce)')
const screenCss = [...css.matchAll(/@media[^{]*\{/g)].reduce((rest, m) => rest.replace(block(rest, m[0]), ''), css)

// ---------------------------------------------------------------------------
// cur-bloom-truncate：照片暈開的 mask-size 轉場在遮罩已蓋滿處精確截斷
// ---------------------------------------------------------------------------
type Bezier = [number, number, number, number]
const cubic = (t: number, p1: number, p2: number) => 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3
/** CSS cubic-bezier 在時間進度 x 的輸出（先以二分法解 X(t)=x） */
const ease = (x: number, [x1, y1, x2, y2]: Bezier) => {
  let lo = 0, hi = 1
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (cubic(mid, x1, x2) < x) lo = mid; else hi = mid }
  return cubic((lo + hi) / 2, y1, y2)
}
/** 在輸出達到 yc 的地方用 de Casteljau 切開，前段正規化成新的 cubic-bezier；回傳切點的時間進度 xc。 */
const splitAt = ([x1, y1, x2, y2]: Bezier, yc: number) => {
  let lo = 0, hi = 1
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (cubic(mid, y1, y2) < yc) lo = mid; else hi = mid }
  const u = (lo + hi) / 2
  const lerp = (a: number[], b: number[]) => [a[0]! + (b[0]! - a[0]!) * u, a[1]! + (b[1]! - a[1]!) * u]
  const p0 = [0, 0], p1 = [x1, y1], p2 = [x2, y2], p3 = [1, 1]
  const a = lerp(p0, p1), b = lerp(p1, p2), c = lerp(p2, p3)
  const d = lerp(a, b), e = lerp(b, c), f = lerp(d, e)
  const xc = f[0]!
  return { xc, curve: [a[0]! / xc, a[1]! / yc, d[0]! / xc, d[1]! / yc] as Bezier }
}

// 定案（DESIGN.md「特色教學頁水彩版」照片從中間暈開）：2.2 秒、var(--cur-ease)、放大到 520%
const ORIGINAL_MS = 2200
const ORIGINAL_BLOOM = 520
const CUT = 0.9

describe('照片暈開在遮罩蓋滿處截斷（cur-bloom-truncate）', () => {
  const ease0 = /--cur-ease: cubic-bezier\(([^)]+)\)/.exec(css)![1]!.split(',').map(Number) as Bezier
  const frame = /\.cur-frame\.has-mask \{[^}]*\}/.exec(screenCss)![0]
  // 曲線本身在 useWatercolor 的 BLOOM_EASE（CSS 裡的數字會被建置的 lightningcss 捨到 6 位有效數字）
  const bloomEase = /^cubic-bezier\(([^)]+)\)$/.exec(BLOOM_EASE)![1]!.split(',').map(Number) as Bezier
  const transitions = [...frame.matchAll(/(-webkit-mask-size|mask-size) ([\d.]+)ms var\(--cur-bloom-ease\)/g)]
    .map((m) => ({ property: m[1], ms: Number(m[2]), curve: bloomEase }))
  const bloom = Number(/\.cur-frame\.is-bloomed \{ --bloom: ([\d.]+)%; \}/.exec(screenCss)![1])
  const { xc, curve } = splitAt(ease0, CUT)

  it('定案曲線仍是 cubic-bezier(.16, 1, .3, 1)；截斷版的兩個前綴寫法一致、都讀 --cur-bloom-ease', () => {
    expect(ease0).toEqual([0.16, 1, 0.3, 1])
    expect(transitions.map((t) => t.property)).toEqual(['-webkit-mask-size', 'mask-size'])
    expect(transitions[1]).toEqual({ ...transitions[0], property: 'mask-size' })
    // 建置會捨位的地方不能出現截斷版的控制點
    expect(css).not.toContain('.26042411')
  })

  it('控制點等於由 (.16, 1, .3, 1) 在進度 0.9 切開的前段（8 位小數），時長與終點跟著縮', () => {
    const [{ ms, curve: written }] = transitions as [typeof transitions[number]]
    written.forEach((value, i) => expect(value).toBe(Number(curve[i]!.toFixed(8))))
    expect(ms).toBe(Number((ORIGINAL_MS * xc).toFixed(3)))
    expect(bloom).toBe(Math.round(ORIGINAL_BLOOM * CUT))
  })

  it('每個時間點的 mask-size 和原本 2.2s／520% 相同（差小於 1e-5 個百分點；只留 5 位小數會差到 2e-3，實測有 8 級像素差）', () => {
    const [{ ms, curve: written }] = transitions as [typeof transitions[number]]
    let worst = 0
    for (let i = 0; i <= 4000; i++) {
      const t = (i / 4000) * ms
      worst = Math.max(worst, Math.abs(ORIGINAL_BLOOM * ease(t / ORIGINAL_MS, ease0) - bloom * ease(t / ms, written)))
    }
    expect(worst).toBeLessThan(1e-5)
    // 截斷之後原本的曲線只會繼續放大（遮罩已蓋滿，畫面不變；蓋滿的檢查在下一條）
    for (let t = ms; t <= ORIGINAL_MS; t += 25) expect(ORIGINAL_BLOOM * ease(t / ORIGINAL_MS, ease0)).toBeGreaterThan(bloom - 1e-5)
  })

  it('bloomCanvas 的實心核心在 468% 時蓋到框的四角，還留 ≥1.5 texel（毛邊反鋸齒與放大取樣）', () => {
    // 錄下 bloomCanvas 的畫法：最後那個不透明的圓就是實心核心
    const calls: { name: string, args: unknown[], fillStyle: string }[] = []
    const recorder = (canvas: HTMLCanvasElement) => {
      const state = { canvas, fillStyle: '' }
      return new Proxy(state, {
        get: (target, key) => key in target ? target[key as keyof typeof target] : (...args: unknown[]) => { calls.push({ name: String(key), args, fillStyle: target.fillStyle }) },
        set: (target, key, value) => { (target as Record<string, unknown>)[key as string] = value; return true }
      })
    }
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) { return recorder(this) as never })
    const el = bloomCanvas()
    getContext.mockRestore()
    const arcAt = calls.findIndex((c) => c.name === 'arc')
    const [cx, cy, r] = calls[arcAt]!.args as number[]
    const fill = calls.slice(arcAt).find((c) => c.name === 'fill')!
    expect(fill.fillStyle).toBe('rgb(0 0 0)')
    expect([cx, cy]).toEqual([el.width / 2, el.height / 2])
    // mask-size 是相對框寬高的百分比：正規化後框的角距中心 √½，換成 bloom 圖上的 texel 是 √½ × 寬 ÷ 倍數
    const corner = Math.SQRT1_2 * el.width / (bloom / 100)
    expect(r! - corner).toBeGreaterThanOrEqual(1.5)
  })

  it('減少動態照舊不暈開（transition: none）', () => {
    expect(reducedBlock).toMatch(/\.cur-frame\.has-mask[^{]*\{ transition: none; \}/)
  })

  it('照片掛上遮罩（.has-mask）的同時就有暈開曲線 --cur-bloom-ease', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new Proxy({}, { get: () => () => {}, set: () => true }) as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => { setTimeout(() => cb(new Blob(['png'])), 0) })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mask')
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private readonly cb: IntersectionObserverCallback) {}
      observe(target: Element) { queueMicrotask(() => this.cb([{ target, isIntersecting: true } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver)) }
      unobserve() {}
      disconnect() {}
    })
    document.body.innerHTML = '<main class="cur"><section class="cur-sec"><canvas class="cur-wash"></canvas><div class="cur-wrap"><div class="cur-frame"><img alt=""></div></div></section></main>'
    const frame = document.querySelector<HTMLElement>('.cur-frame')!
    Object.defineProperties(frame, { offsetWidth: { value: 300 }, offsetHeight: { value: 200 } })
    const seen: string[] = []
    new MutationObserver(() => { if (frame.classList.contains('has-mask')) seen.push(frame.style.getPropertyValue('--cur-bloom-ease')) }).observe(frame, { attributes: true, attributeFilter: ['class'] })
    const app = createApp(defineComponent({ setup() { useWatercolor(ref(document.querySelector<HTMLElement>('main'))); return () => null } }))
    app.mount(document.createElement('div'))
    try {
      await vi.waitFor(() => expect(frame.classList.contains('has-mask')).toBe(true), { timeout: 2000 })
      expect(seen[0]).toBe(BLOOM_EASE)
    } finally {
      app.unmount()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
      document.body.innerHTML = ''
    }
  })
})

// ---------------------------------------------------------------------------
// cur-wash-mask-overlay：段落 canvas 的淡出改成蓋在上面的紙色漸層
// ---------------------------------------------------------------------------
describe('段落 canvas 的淡出改用紙色漸層蓋層（cur-wash-mask-overlay）', () => {
  it('螢幕上 canvas 不再掛 mask（合成層的 mask 每幀多一個離屏 surface），改由 ::after 蓋紙色漸層', () => {
    expect(screenCss).not.toMatch(/\.cur-wash[^{]*\{[^}]*mask/)
    expect(screenCss).toContain(".cur-hero::after, .cur-sec::after { content: ''; position: absolute; left: 0; right: 0; z-index: 0; pointer-events: none; }")
    // 範圍與高度和原本的 mask 一樣：首屏上緣 56px、段落下緣與段落留白同值
    expect(screenCss).toContain('.cur-hero::after { top: 0; height: 56px; background: linear-gradient(var(--paper), transparent); }')
    expect(screenCss).toContain('.cur-sec::after { bottom: 0; height: clamp(72px, 8.5vw, 124px); background: linear-gradient(to top, var(--paper), transparent); }')
    expect(screenCss).toContain('.cur-sec { padding-block: clamp(72px, 8.5vw, 124px); }')
  })

  it('疊放順序：canvas（z 0）＜ 蓋層（z 0、樹順序在後）＜ 內容（z 1）', () => {
    expect(screenCss).toMatch(/\.cur-wash \{[^}]*z-index: 0;/)
    expect(screenCss).toContain('.cur-hero > .cur-wrap, .cur-sec > .cur-wrap { position: relative; z-index: 1; }')
  })

  it('數學上等價的前提：canvas 底下只有 .cur 的紙色，段落沒有自己的背景，段落的直接子元素只有 canvas 與 .cur-wrap', () => {
    expect(screenCss).toMatch(/\.cur \{[^}]*background: var\(--paper\);/)
    const sectionRules = [...screenCss.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => m[1]!.split(',').some((s) => /^\s*\.cur-(hero|sec|years|directions|gallery|daily|belief)\s*$/.test(s)))
    expect(sectionRules.length).toBeGreaterThan(0)
    for (const rule of sectionRules) expect(rule[2]).not.toMatch(/background/)
    // Vue 模板裡的 <x /> 換成成對標籤，HTML 解析器才不會把後面的兄弟包進 canvas
    const component = read('../app/components/CurriculumContent.vue')
    const markup = component.slice(component.indexOf('<template>') + 10, component.lastIndexOf('</template>')).replace(/<([a-zA-Z][\w-]*)([^<>]*?)\s*\/>/g, '<$1$2></$1>')
    const doc = new DOMParser().parseFromString(`<body>${markup}</body>`, 'text/html')
    const sections = [...doc.querySelectorAll('section.cur-hero, section.cur-sec')]
    expect(sections).toHaveLength(6)
    for (const section of sections) {
      const [first, ...rest] = [...section.children]
      expect(first!.matches('canvas.cur-wash')).toBe(true)
      for (const child of rest) expect(child.classList.contains('cur-wrap')).toBe(true)
    }
  })

  it('「canvas 乘上 m」和「canvas 照畫、上面蓋透明度 1−m 的紙色」在紙色底上相等', () => {
    const paper = [0.99, 0.98, 0.95]
    for (let k = 0; k < 200; k++) {
      const a = (k % 17) / 16, m = (k % 13) / 12, color = [0.2, 0.5, 0.8].map((c) => c * a) // 預乘
      const masked = paper.map((p, i) => color[i]! * m + p * (1 - a * m))
      const overlaid = paper.map((p, i) => p * (1 - m) + (color[i]! + p * (1 - a)) * m)
      overlaid.forEach((v, i) => expect(v).toBeCloseTo(masked[i]!, 12))
    }
  })

  it('強制色彩藏起蓋層；列印不印背景，換回原本的 mask', () => {
    expect(forcedBlock).toContain('.cur-hero::after, .cur-sec::after { display: none; }')
    expect(printBlock).toContain('.cur-hero::after, .cur-sec::after { display: none; }')
    expect(printBlock).toContain('.cur-hero > .cur-wash { -webkit-mask-image: linear-gradient(transparent, rgb(var(--ink)) 56px); mask-image: linear-gradient(transparent, rgb(var(--ink)) 56px); }')
    expect(printBlock).toContain('.cur-sec > .cur-wash { -webkit-mask-image: linear-gradient(to top, transparent, rgb(var(--ink)) clamp(72px, 8.5vw, 124px)); mask-image: linear-gradient(to top, transparent, rgb(var(--ink)) clamp(72px, 8.5vw, 124px)); }')
  })
})

// ---------------------------------------------------------------------------
// cur-pump-dirty-rect：pump 只重合成當幀改到的團的外框，結果和整張重畫逐像素相同
// ---------------------------------------------------------------------------
// 用一個以浮點預乘 RGBA 記像素的假 2D context 跑真正的 useWatercolor：一次照實套用 clip（新的做法），
// 一次讓 clip() 什麼都不做（等於原本每幀整張複製 done 再疊所有團）。兩次每一幀的段落 canvas 都要完全相同。
type RGBA = [number, number, number, number]
const buffers = new WeakMap<HTMLCanvasElement, { w: number, h: number, px: Float64Array }>()
const pixels = (el: HTMLCanvasElement) => {
  let b = buffers.get(el)
  if (!b || b.w !== el.width || b.h !== el.height) { b = { w: el.width, h: el.height, px: new Float64Array(el.width * el.height * 4) }; buffers.set(el, b) }
  return b
}
const parseColor = (style: string): RGBA => {
  const m = /^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(style)
  if (!m) throw new Error(`unexpected color ${style}`)
  const a = m[4] === undefined ? 1 : Number(m[4])
  return [Number(m[1]) / 255 * a, Number(m[2]) / 255 * a, Number(m[3]) / 255 * a, a]
}
const harness = { honourClip: true, copied: 0 }

class FakeContext {
  globalCompositeOperation = 'source-over'
  fillStyle = 'rgb(0 0 0)'
  strokeStyle = 'rgb(0 0 0)'
  lineWidth = 1
  private m = [1, 0, 0, 1, 0, 0]
  private clipMask: Uint8Array | null = null
  private stack: { m: number[], op: string, fill: string, stroke: string, clip: Uint8Array | null }[] = []
  private path: { x: number, y: number }[] = []
  private rects: [number, number, number, number][] = []
  constructor(readonly canvas: HTMLCanvasElement) {}
  save() { this.stack.push({ m: [...this.m], op: this.globalCompositeOperation, fill: this.fillStyle, stroke: this.strokeStyle, clip: this.clipMask }) }
  restore() {
    const s = this.stack.pop()
    if (!s) return
    this.m = s.m; this.globalCompositeOperation = s.op; this.fillStyle = s.fill; this.strokeStyle = s.stroke; this.clipMask = s.clip
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { this.m = [a, b, c, d, e, f] }
  beginPath() { this.path = []; this.rects = [] }
  closePath() {}
  private point(x: number, y: number) { const [a, b, c, d, e, f] = this.m as [number, number, number, number, number, number]; return { x: a * x + c * y + e, y: b * x + d * y + f } }
  moveTo(x: number, y: number) { this.path.push(this.point(x, y)) }
  lineTo(x: number, y: number) { this.path.push(this.point(x, y)) }
  rect(x: number, y: number, w: number, h: number) {
    const p = this.point(x, y)
    this.rects.push([p.x, p.y, w * this.m[0]!, h * this.m[3]!])
  }
  clip() {
    if (!harness.honourClip) return
    const { w, h } = pixels(this.canvas)
    const mask = new Uint8Array(w * h)
    for (const [x, y, rw, rh] of this.rects) {
      // 外框必須是整數像素，不然 clip 會反鋸齒
      if (![x, y, rw, rh].every(Number.isInteger)) throw new Error(`non-integer clip rect ${[x, y, rw, rh]}`)
      for (let j = Math.max(0, y); j < Math.min(h, y + rh); j++) for (let i = Math.max(0, x); i < Math.min(w, x + rw); i++) mask[j * w + i] = 1
    }
    if (this.clipMask) for (let k = 0; k < mask.length; k++) mask[k]! &= this.clipMask[k]!
    this.clipMask = mask
  }
  stroke() {}
  fill() {
    if (!this.path.length) return
    const xs = this.path.map((p) => p.x), ys = this.path.map((p) => p.y)
    // 多邊形以外框近似：像素中心落在外框內就算蓋到
    const color = parseColor(this.fillStyle)
    this.paint(Math.ceil(Math.min(...xs) - 0.5), Math.ceil(Math.min(...ys) - 0.5), Math.ceil(Math.max(...xs) - 0.5), Math.ceil(Math.max(...ys) - 0.5), () => color)
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const p = this.point(x, y), color = parseColor(this.fillStyle)
    this.paint(Math.round(p.x), Math.round(p.y), Math.round(p.x + w * this.m[0]!), Math.round(p.y + h * this.m[3]!), () => color)
  }
  drawImage(image: HTMLCanvasElement, dx: number, dy: number) {
    if (this.m[0] !== 1 || this.m[3] !== 1 || this.m[1] || this.m[2]) throw new Error('drawImage only with a translation')
    const x0 = dx + this.m[4]!, y0 = dy + this.m[5]!
    if (!Number.isInteger(x0) || !Number.isInteger(y0)) throw new Error('drawImage at a fractional position')
    const src = pixels(image)
    this.paint(x0, y0, x0 + src.w, y0 + src.h, (x, y) => {
      const k = ((y - y0) * src.w + (x - x0)) * 4
      return [src.px[k]!, src.px[k + 1]!, src.px[k + 2]!, src.px[k + 3]!]
    })
  }
  /** 依目前的合成模式畫上 [x0,x1)×[y0,y1) 的來源；copy／source-in 在來源以外（clip 內）也要作用。 */
  private paint(x0: number, y0: number, x1: number, y1: number, source: (x: number, y: number) => RGBA) {
    const { w, h, px } = pixels(this.canvas)
    const op = this.globalCompositeOperation
    const whole = op !== 'source-over'
    const [ax0, ay0, ax1, ay1] = whole ? [0, 0, w, h] : [Math.max(0, x0), Math.max(0, y0), Math.min(w, x1), Math.min(h, y1)]
    const counted = op === 'copy' && this.canvas.classList.contains('cur-wash')
    for (let y = ay0; y < ay1; y++) {
      for (let x = ax0; x < ax1; x++) {
        if (this.clipMask && !this.clipMask[y * w + x]) continue
        const [r, g, b, a] = x >= x0 && x < x1 && y >= y0 && y < y1 ? source(x, y) : [0, 0, 0, 0]
        const i = (y * w + x) * 4
        if (op === 'source-over') { const k = 1 - a; px[i] = r + px[i]! * k; px[i + 1] = g + px[i + 1]! * k; px[i + 2] = b + px[i + 2]! * k; px[i + 3] = a + px[i + 3]! * k }
        else if (op === 'copy') { px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a }
        else if (op === 'source-in') { const k = px[i + 3]!; px[i] = r * k; px[i + 1] = g * k; px[i + 2] = b * k; px[i + 3] = a * k }
        else throw new Error(`unexpected composite ${op}`)
        if (counted) harness.copied++
      }
    }
  }
}

describe('pump 只重合成改到的團的外框（cur-pump-dirty-rect）', () => {
  const contexts = new WeakMap<HTMLCanvasElement, FakeContext>()
  const widthDesc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')!
  const heightDesc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height')!
  beforeAll(() => {
    // 設定寬高（即使同一個值）會清空 canvas，同瀏覽器
    Object.defineProperty(HTMLCanvasElement.prototype, 'width', { configurable: true, get: widthDesc.get, set(this: HTMLCanvasElement, v: number) { widthDesc.set!.call(this, v); buffers.delete(this) } })
    Object.defineProperty(HTMLCanvasElement.prototype, 'height', { configurable: true, get: heightDesc.get, set(this: HTMLCanvasElement, v: number) { heightDesc.set!.call(this, v); buffers.delete(this) } })
  })
  afterAll(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'width', widthDesc)
    Object.defineProperty(HTMLCanvasElement.prototype, 'height', heightDesc)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  const box = (el: HTMLElement, layout: Record<string, unknown>) => { for (const [key, value] of Object.entries(layout)) Object.defineProperty(el, key, { configurable: true, value }) }

  /** 跑一次：首屏與一個段落各畫幾團顏料，途中與畫完後各滴幾滴（滴在已經畫完、done 已釋放的層上）。回傳每一幀兩張 canvas 的像素。 */
  async function run(honourClip: boolean) {
    harness.honourClip = honourClip
    harness.copied = 0
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      let ctx = contexts.get(this)
      if (!ctx) { ctx = new FakeContext(this); contexts.set(this, ctx) }
      return ctx as never
    })
    vi.spyOn(performance, 'now').mockReturnValue(0) // 7ms 預算不會用完：每幀照輪流推進，兩次執行的節奏完全一樣
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private readonly cb: IntersectionObserverCallback) {}
      observe(target: Element) { queueMicrotask(() => this.cb([{ target, isIntersecting: true } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver)) }
      unobserve() {}
      disconnect() {}
    })
    const rgb = { mint: '120 200 170', sky: '110 170 230', sun: '250 210 100', orange: '240 150 80', leaf: '110 170 90' }
    for (const [name, value] of Object.entries(rgb)) document.documentElement.style.setProperty(`--ivy-paint-${name}-rgb`, value)

    document.body.innerHTML = `<main class="cur">
      <section class="cur-hero"><canvas class="cur-wash"></canvas><div class="cur-wrap">
        <div id="a" data-wash="mint,.3,.4,.5,.45,.03,14|sky,.75,.3,.35,.4,.03,8"></div>
        <div id="b" data-wash="sun,.5,.6,.6,.5,.025,11"></div>
      </div></section>
      <section id="daily" class="cur-sec"><canvas class="cur-wash"></canvas><div class="cur-wrap">
        <div id="c" data-wash="orange,.4,.5,.5,.5,.03,9|leaf,.6,.4,.3,.3,.03,12"></div>
      </div></section>
    </main>`
    const main = document.querySelector<HTMLElement>('main')!
    const [hero, daily] = [...document.querySelectorAll<HTMLElement>('section')] as [HTMLElement, HTMLElement]
    box(hero, { clientWidth: 220, clientHeight: 170 })
    box(daily, { clientWidth: 220, clientHeight: 150 })
    const wrapOf = (el: HTMLElement) => el.parentElement!
    for (const wrap of [wrapOf(document.getElementById('a')!), wrapOf(document.getElementById('c')!)]) box(wrap, { offsetLeft: 10, offsetTop: 8, offsetParent: wrap.parentElement, offsetWidth: 200, offsetHeight: 140 })
    box(document.getElementById('a')!, { offsetLeft: 0, offsetTop: 0, offsetWidth: 120, offsetHeight: 90, offsetParent: wrapOf(document.getElementById('a')!) })
    box(document.getElementById('b')!, { offsetLeft: 70, offsetTop: 50, offsetWidth: 120, offsetHeight: 80, offsetParent: wrapOf(document.getElementById('b')!) })
    box(document.getElementById('c')!, { offsetLeft: 20, offsetTop: 10, offsetWidth: 160, offsetHeight: 110, offsetParent: wrapOf(document.getElementById('c')!) })
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas.cur-wash')]

    const app = createApp(defineComponent({ setup() { useWatercolor(ref(main)); return () => null } }))
    app.mount(document.createElement('div'))
    await Promise.resolve(); await Promise.resolve()

    const shots: Float64Array[][] = []
    const drop = (x: number, y: number) => hero.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: x, clientY: y }))
    let frame = 0
    const drain = () => {
      while (frames.length && frame < 400) {
        frames.splice(0).forEach((cb) => cb(0))
        shots.push(canvases.map((c) => Float64Array.from(pixels(c).px)))
        if (++frame === 3) drop(130, 40) // 還在染開時滴一滴（done 還在）
      }
    }
    drain()
    drop(130, 170); drop(10, 60) // 都畫完、done 已釋放後再滴兩滴：要先把畫面複製回 done
    drain()
    app.unmount()
    return { shots, copied: harness.copied, size: canvases.map((c) => c.width * c.height) }
  }

  it('每一幀都和整張重畫逐像素相同，而且真的少複製', async () => {
    const dirty = await run(true)
    const full = await run(false)
    expect(dirty.shots.length).toBeGreaterThan(10)
    expect(dirty.shots.length).toBe(full.shots.length)
    dirty.shots.forEach((shot, f) => shot.forEach((px, c) => {
      const other = full.shots[f]![c]!
      expect(px.length).toBe(other.length)
      expect(px.every((v, i) => v === other[i])).toBe(true)
    }))
    // 有畫出東西（不是兩邊都空白）
    const last = dirty.shots.at(-1)!
    last.forEach((px) => expect(px.some((v, i) => i % 4 === 3 && v > 0)).toBe(true))
    expect(dirty.copied).toBeLessThan(full.copied)
  })
})

// ---------------------------------------------------------------------------
// F4a／F4b：進入特色教學頁的轉場遮罩
// ---------------------------------------------------------------------------
type Guard = (to: { path: string }, from: { path: string, matched: unknown[] }) => unknown
type PluginSetup = (app: { hook: (name: string, fn: () => void) => void }) => void

/** 只有 open／keys／delete、match／put 的 Cache Storage */
function fakeCaches(seed: Record<string, Record<string, Blob>> = {}) {
  const stores = new Map(Object.entries(seed).map(([name, entries]) => [name, new Map(Object.entries(entries))]))
  const opened: string[] = []
  const api = {
    open: vi.fn(async (name: string) => {
      opened.push(name)
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      return {
        match: async (key: string) => store.has(key) ? new Response(store.get(key)!, { headers: { 'Content-Type': 'image/png' } }) : undefined,
        put: async (key: string, response: Response) => { store.set(key, await response.blob()) }
      }
    }),
    keys: async () => [...stores.keys()],
    delete: vi.fn(async (name: string) => stores.delete(name))
  }
  return { api, stores, opened }
}

describe('轉場遮罩（F4a 網址到暈開那一步才寫、F4b 跨頁快取）', () => {
  let plugin: PluginSetup
  const root = document.documentElement
  const removers: (() => void)[] = []
  beforeAll(async () => {
    vi.stubGlobal('defineNuxtPlugin', (setup: PluginSetup) => setup)
    plugin = (await import('../app/plugins/curriculum-enter.client')).default as unknown as PluginSetup
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    removers.splice(0).forEach((fn) => fn())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    root.removeAttribute('style')
    root.className = ''
    delete (document as { startViewTransition?: unknown }).startViewTransition
  })

  /** 掛上 plugin：回傳閒置佇列、畫了幾張遮罩、beforeResolve 守衛，以及每張網址對應的 blob */
  function mount(caches: unknown) {
    const idle: (() => void)[] = []
    vi.stubGlobal('requestIdleCallback', (fn: () => void) => idle.push(fn))
    vi.stubGlobal('caches', caches)
    vi.stubGlobal('useRouter', () => router)
    let drawn = 0
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new Proxy({}, { get: () => () => {}, set: () => true }) as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
      const n = ++drawn
      setTimeout(() => cb(new Blob([`drawn-${n}`], { type: 'image/png' })), 0)
    })
    const blobs = new Map<string, Blob>()
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { const url = `blob:mask-${blobs.size + 1}`; blobs.set(url, blob as Blob); return url })
    const transitions: { classed: boolean, vars: string[] }[] = []
    ;(document as { startViewTransition?: unknown }).startViewTransition = () => {
      transitions.push({ classed: root.classList.contains('curriculum-enter'), vars: [1, 2, 3].map((i) => root.style.getPropertyValue(`--cur-enter-blob-${i}`)) })
      return { finished: new Promise(() => {}) }
    }
    const guards: Guard[] = []
    const router = { beforeResolve: (fn: Guard) => guards.push(fn), afterEach: () => {}, currentRoute: { value: { path: '/about' } }, push: vi.fn() }
    const add = vi.spyOn(document, 'addEventListener')
    const addWindow = vi.spyOn(window, 'addEventListener')
    const hooks: Record<string, () => void> = {}
    plugin({ hook: (name, fn) => { hooks[name] = fn } })
    for (const [spy, target] of [[add, document], [addWindow, window]] as const) {
      for (const [type, listener] of spy.mock.calls) removers.push(() => target.removeEventListener(type, listener as EventListener))
    }
    hooks['app:mounted']!()
    const navigate = () => guards[0]!({ path: '/curriculum' }, { path: '/about', matched: [{}] })
    return { idle, drawn: () => drawn, navigate, transitions, blobs }
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  const runIdle = (idle: (() => void)[]) => idle.splice(0).forEach((fn) => fn())
  /** 閒置一次、等 toBlob 回來；重複到沒有閒置工作 */
  async function settle(idle: (() => void)[]) {
    for (let i = 0; i < 10; i++) { await tick(); runIdle(idle); await tick() }
  }

  it('F4a：遮罩做好時不寫 <html>（繼承屬性會整頁重算）；要暈開的那一步才和中心、大小一起寫，再加 class', async () => {
    const page = mount(undefined)
    await settle(page.idle)
    expect(page.drawn()).toBe(3)
    expect(root.getAttribute('style') ?? '').not.toContain('--cur-enter-blob')
    page.navigate()
    expect(page.transitions).toEqual([{ classed: true, vars: ['url(blob:mask-1)', 'url(blob:mask-2)', 'url(blob:mask-3)'] }])
    expect(root.style.getPropertyValue('--cur-enter-s')).toMatch(/px$/)
  })

  it('入口照舊是閒置：閒置之前就算快取全中也不暈開；沒命中時第一張就在那次閒置裡畫、一次閒置只畫一張', async () => {
    const { api } = fakeCaches()
    const page = mount(api)
    await tick(); await tick()
    expect(page.navigate()).toBeUndefined() // 還沒好：不攔、直接換頁
    expect(page.drawn()).toBe(0)
    runIdle(page.idle)
    await Promise.resolve()
    expect(page.drawn()).toBe(1)
    await tick()
    expect(page.idle).toHaveLength(1)
    runIdle(page.idle); await tick()
    expect(page.drawn()).toBe(2)
  })

  it('F4b 沒命中：照原本流程畫三張，存進 ivy-cur-enter-v1（PNG）', async () => {
    const { api, stores } = fakeCaches()
    const page = mount(api)
    await settle(page.idle)
    expect(page.drawn()).toBe(3)
    const store = stores.get('ivy-cur-enter-v1')!
    expect([...store.keys()]).toEqual(['/__cur-enter-mask/11-1024', '/__cur-enter-mask/23-1024', '/__cur-enter-mask/37-1024'])
    expect(await Promise.all([...store.values()].map((blob) => blob.text()))).toEqual(['drawn-1', 'drawn-2', 'drawn-3'])
    page.navigate()
    expect(page.transitions).toHaveLength(1)
  })

  it('F4b 三張都命中：不畫，直接用快取的 PNG；順手刪掉其他版本的 ivy-cur-enter-*', async () => {
    const png = (text: string) => new Blob([text], { type: 'image/png' })
    const { api, stores } = fakeCaches({
      'ivy-cur-enter-v1': { '/__cur-enter-mask/11-1024': png('m11'), '/__cur-enter-mask/23-1024': png('m23'), '/__cur-enter-mask/37-1024': png('m37') },
      'ivy-cur-enter-v0': { '/__cur-enter-mask/11-1024': png('old') },
      'someone-else': {}
    })
    const page = mount(api)
    await settle(page.idle)
    expect(page.drawn()).toBe(0)
    expect([...stores.keys()].sort()).toEqual(['ivy-cur-enter-v1', 'someone-else'])
    page.navigate()
    const [{ vars }] = page.transitions as [typeof page.transitions[number]]
    const used = await Promise.all(vars.map((v) => page.blobs.get(v.slice(4, -1))!.text()))
    expect(used).toEqual(['m11', 'm23', 'm37'])
  })

  it('F4b 只命中一部分：三張重畫並覆蓋', async () => {
    const { api, stores } = fakeCaches({ 'ivy-cur-enter-v1': { '/__cur-enter-mask/11-1024': new Blob(['m11']) } })
    const page = mount(api)
    await settle(page.idle)
    expect(page.drawn()).toBe(3)
    expect(await stores.get('ivy-cur-enter-v1')!.get('/__cur-enter-mask/11-1024')!.text()).toBe('drawn-1')
  })

  it.each([
    ['沒有 caches（非安全來源）', undefined],
    ['caches.open 拋錯（部分無痕模式）', { open: () => Promise.reject(new Error('SecurityError')), keys: async () => [], delete: async () => false }]
  ])('F4b %s：退回原本的做法，照樣畫三張、照樣暈開', async (_, caches) => {
    const page = mount(caches)
    await settle(page.idle)
    expect(page.drawn()).toBe(3)
    page.navigate()
    expect(page.transitions).toHaveLength(1)
  })

  it('減少動態：不查快取、不畫、不暈開', async () => {
    const { api } = fakeCaches()
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: query.includes('reduce') }) as MediaQueryList)
    const page = mount(api)
    await settle(page.idle)
    expect(api.open).not.toHaveBeenCalled()
    expect(page.drawn()).toBe(0)
    expect(page.navigate()).toBeUndefined()
  })

  it('改遮罩演算法要遞增版本：快取名稱帶版本、版本常數旁寫明', () => {
    const source = read('../app/plugins/curriculum-enter.client.ts')
    expect(source).toContain("const MASK_CACHE = 'ivy-cur-enter-v1'")
    expect(source).toMatch(/改 utils\/watercolor\.ts 的 revealMaskCanvas[^\n]*版本號加一/)
  })
})
