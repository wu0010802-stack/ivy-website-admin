// 常春藤環境頁（/environment）的手繪線條：用 Rough.js 畫在各元素的 svg.rough 疊層上。
// 2026-09-28 使用者選定 mock C（design/environment-rough-mockup-20260928/，A 老師的聯絡簿＋B 蠟筆佈告欄）：
// 點格紙、紅筆圈註與箭頭、蠟筆色紙、照片貼在彩色底紙上、黃色便利貼、貼紙按鈕，線條粗細介於鋼筆與蠟筆之間。
// 線條全是裝飾（aria-hidden），內容與排版不依賴它；沒有 JS 時頁面照常可讀，只是沒有手繪線。
// 元素用 data-rough="種類" 指定要畫什麼，data-seed 固定亂數，同一個元素每次重畫形狀一樣（滑過去時換種子「抖一下」）。
// 2026-09-28 起小路、太陽與小路上的便條可以交給 GSAP 動態層（utils/environment-motion.ts，傳 motion 進來）；
// 沒傳或 GSAP 載入失敗時，照原本的虛線小路與跟著捲動的太陽。
import type { Options } from 'roughjs/bin/core'
import type { RoughSVG } from 'roughjs/bin/svg'

type RoughStatic = { svg: (svg: SVGSVGElement) => RoughSVG }
type Point = [number, number]
export interface Box { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }
/** 小路的版面：跟其他宿主同一批量好（寬高、各站號碼的位置、頁面座標、視窗寬高），動態層不必再讀版面。 */
export interface TrailGeometry extends Size { stops: Box[]; top: number; vw: number; vh: number }

const NS = 'http://www.w3.org/2000/svg'

// 筆觸（mock C 的 medium 筆）
const PEN = { rough: 1.7, bow: 1.3, line: 2, frame: 2.2, hand: 2.4 }
// 會「一筆一筆畫出來」的種類；其餘（色紙、膠帶、按鈕、小路、太陽）直接出現
const ANIMATED = new Set(['frame', 'heart', 'circle', 'highlight', 'note', 'stop', 'clothesline', 'check', 'bookarrow'])

/** 餐點的太陽弧（桌機）：t＝0 早餐、1 點心；兩端低、中午最高。 */
export function mealArcPoint(t: number, width: number): Point {
  const pad = Math.min(120, width * 0.09)
  const base = 250
  const peak = 96
  return [pad + t * (width - 2 * pad), base - (base - peak) * (1 - (2 * t - 1) ** 2)]
}

/** 曬衣繩在 x 處往下垂的高度（兩端 8px，中間最低）。 */
export function clotheslineY(x: number, width: number): number {
  const sag = Math.min(46, width * 0.03)
  return 8 + sag * 4 * (x / width) * (1 - x / width)
}

function seeded(seed: number) {
  let s = seed * 9301 + 49297
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280) - 0.5
}

type SketchColor = 'ink' | 'pen' | 'note' | 'tape' | 'yellow' | 'yellowDeep' | 'sky' | 'skyDeep' | 'leaf' | 'leafDeep' | 'peach' | 'peachDeep'

/** 交給動態層的畫具：和這支畫線用的是同一套疊層、座標與顏色。 */
export interface SketchTools {
  rough: RoughStatic
  colors: Record<SketchColor, string>
  /** size 是事先量好的宿主寬高；有給就不再讀版面（批次渲染時一定會給）。 */
  layer: (host: HTMLElement, key: string, bleed?: number, under?: boolean, size?: Size) => { svg: SVGSVGElement; rc: RoughSVG; w: number; h: number }
  rel: (el: Element, host: Element) => Box
  /** 這張照片底紙的顏色（和 frame 同一個算法，用原始種子；滑過去重畫時底紙會換色，這裡不跟著變）。 */
  paperColor: (el: HTMLElement) => string
}

/** 動態層可以接手的部分；每一項都可以不給，不給就照原本的畫法。 */
export interface SketchMotion {
  /** 接手小路（不畫虛線）；每次重畫都會呼叫，geo 是這一批量好的版面。 */
  trail?: (el: HTMLElement, tools: SketchTools, geo: TrailGeometry) => void
  /** 接手太陽：p 是這一刻的捲動進度；place(p, spin) 把太陽放到 p、光芒轉 spin 度，回傳剛亮起的圓點。減少動態時不會呼叫。 */
  sun?: (p: number, place: (p: number, spin?: number) => SVGGElement[]) => void
  /** 這個元素的進場由動態層負責：這裡不先藏線、不描線。 */
  owns?: (el: HTMLElement) => boolean
}

export interface SketchHandle {
  /** 重畫 scope 內的所有線條（分頁切換後呼叫）；進場描線照常。 */
  refresh: (scope?: ParentNode) => void
  /** 首次渲染分批畫完（或中途 destroy）時 resolve；動態層等這個才開始接手小路上的便條。 */
  ready: Promise<void>
  destroy: () => void
}

export function createRoughSketch(root: HTMLElement, rough: RoughStatic, { reducedMotion, motion }: { reducedMotion: boolean; motion?: SketchMotion }): SketchHandle {
  const style = getComputedStyle(root)
  const token = (name: string) => style.getPropertyValue(name).trim()
  const C = {
    ink: token('--renv-ink'), pen: token('--renv-pen'), note: token('--renv-note'), tape: token('--renv-tape'),
    yellow: token('--renv-yellow'), yellowDeep: token('--renv-yellow-deep'), sky: token('--renv-sky'), skyDeep: token('--renv-sky-deep'),
    leaf: token('--renv-leaf'), leafDeep: token('--renv-leaf-deep'), peach: token('--renv-peach'), peachDeep: token('--renv-peach-deep')
  } satisfies Record<SketchColor, string>
  const CRAYONS = [C.yellow, C.sky, C.leaf, C.peach]
  // 各章節的色紙（沒列的章節是點格紙底）；照片底紙會避開所在章節的色紙顏色
  const SHEETS: Record<string, [string, string]> = { care: [C.sky, C.skyDeep], meals: [C.yellow, C.yellowDeep] }
  const paperColor = (el: HTMLElement, seed = Number(el.dataset.seed) || 1) => {
    const sheet = SHEETS[el.closest('.renv-section')?.id ?? '']?.[0]
    const palette = CRAYONS.filter((color) => color !== sheet)
    return palette[seed % palette.length]!
  }
  const cleanups: (() => void)[] = []
  const on = <K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void) => {
    target.addEventListener(type, fn, { passive: true })
    cleanups.push(() => target.removeEventListener(type, fn))
  }

  // ---------- 疊層：每個宿主元素可以有好幾張 svg（用 key 區分） ----------
  // 量尺寸只在批次渲染的量測段做（見下面 renderList）；這裡只寫 DOM。沒給 size 才自己量（動態層以外的舊呼叫）。
  const size = (el: HTMLElement): Size => ({ w: el.offsetWidth, h: el.offsetHeight })
  function layer(host: HTMLElement, key: string, bleed = 24, under = false, measured?: Size) {
    const { w, h } = measured ?? size(host)
    let svg = host.querySelector<SVGSVGElement>(`:scope > svg.rough[data-key="${key}"]`)
    if (!svg) {
      svg = document.createElementNS(NS, 'svg')
      svg.classList.add('rough')
      svg.dataset.key = key
      svg.setAttribute('aria-hidden', 'true')
      svg.setAttribute('focusable', 'false')
      // 墊在字後面的層放最前面：同一個堆疊內 z-index:-1 依文件順序畫，先插的在最底
      if (under) host.prepend(svg)
      else host.appendChild(svg)
    }
    svg.classList.toggle('is-under', under)
    svg.setAttribute('width', String(w + bleed * 2))
    svg.setAttribute('height', String(h + bleed * 2))
    svg.setAttribute('viewBox', `${-bleed} ${-bleed} ${w + bleed * 2} ${h + bleed * 2}`)
    svg.style.left = svg.style.top = `${-bleed}px`
    svg.replaceChildren()
    return { svg, rc: rough.svg(svg), w, h }
  }
  const rel = (el: Element, host: Element): Box => {
    const a = el.getBoundingClientRect()
    const b = host.getBoundingClientRect()
    return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height }
  }
  const sticker = (rc: RoughSVG, w: number, h: number, fill: string, seed: number) => [
    rc.rectangle(6, 7, w, h, { fill: C.ink, fillStyle: 'solid', stroke: 'none', roughness: 1.6, seed: seed + 9 }),
    rc.rectangle(0, 0, w, h, { fill, fillStyle: 'solid', stroke: C.ink, strokeWidth: 2.6, roughness: 1.8, bowing: 1.2, seed })
  ]

  // 紅筆箭頭：從便條最靠近目標的一邊，彎彎地指到照片裡的細節（tx、ty 是照片寬高的比例）
  function arrowTo(fig: HTMLElement, figSize: Size, box: Box, im: Box, tx: number, ty: number, seed: number) {
    const to: Point = [im.x + tx * im.w, im.y + ty * im.h]
    const sides: Point[] = [[box.x + box.w / 2, box.y - 4], [box.x + box.w / 2, box.y + box.h + 4], [box.x - 4, box.y + box.h / 2], [box.x + box.w + 4, box.y + box.h / 2]]
    const from = sides.sort((a, b) => Math.hypot(a[0] - to[0], a[1] - to[1]) - Math.hypot(b[0] - to[0], b[1] - to[1]))[0]!
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const len = Math.hypot(dx, dy) || 1
    const bend = (seed % 2 ? 1 : -1) * Math.min(40, len * 0.22)
    const mid: Point = [(from[0] + to[0]) / 2 - (dy / len) * bend, (from[1] + to[1]) / 2 + (dx / len) * bend]
    const a = Math.atan2(to[1] - mid[1], to[0] - mid[0])
    const head = (s: number): Point => [to[0] - 14 * Math.cos(a + s), to[1] - 14 * Math.sin(a + s)]
    const { svg, rc } = layer(fig, `arrow-${seed}`, 40, false, figSize)
    // 先畫一道紙色的粗線墊底，紅線在照片上才看得清楚
    for (const o of [{ stroke: C.note, strokeWidth: PEN.hand + 4 }, { stroke: C.pen, strokeWidth: PEN.hand }] as Options[]) {
      svg.append(rc.curve([from, mid, to], { ...o, roughness: 0.9, seed }), rc.linearPath([head(0.5), to, head(-0.5)], { ...o, roughness: 0.9, seed }))
    }
    svg.style.zIndex = '3'
  }

  // 每一種線條分三段：prepare 先調整會動到版面的樣式（曬衣繩照片高度、太陽軌跡弧線／直線），
  // measure 只讀版面（回傳這次要畫的幾何，也拿來判斷字型換上後有沒有變），paint 只寫 DOM。
  // vw 是這一批開頭讀一次的 innerWidth：手機上讀 innerWidth 也會強制重排，不在 paint 裡讀。
  interface Kind<M = unknown> {
    prepare?: (el: HTMLElement, vw: number) => void
    measure: (el: HTMLElement, vw: number) => M
    paint: (el: HTMLElement, seed: number, m: M) => void
  }
  const kind = <M>(k: Kind<M>) => k as unknown as Kind
  const sized = (paint: (el: HTMLElement, seed: number, s: Size) => void) => kind<Size>({ measure: size, paint })

  const draw: Record<string, Kind> = {
    frame: kind({
      measure: (el) => {
        const img = el.querySelector(':scope > img')
        return { s: size(el), box: img ? rel(img, el) : null }
      },
      paint(el, seed, { s, box }) {
        const { svg, rc } = layer(el, 'frame', 18, false, s)
        // 照片沒有白邊，直接貼在一張蠟筆底紙上；框只框照片本身，圖說留在底紙外
        const { x, y, w, h } = box ?? { x: 0, y: 0, w: s.w, h: s.h }
        svg.append(rc.rectangle(x + 2, y + 2, w - 4, h - 4, { stroke: C.ink, strokeWidth: PEN.frame, roughness: PEN.rough, bowing: PEN.bow, seed }))
        const { svg: back, rc: rb } = layer(el, 'backing', 30, true, s)
        const r = seeded(seed)
        const pad = el.matches('.renv-hang-photo') ? 9 : 16
        const pts: Point[] = [[x - pad + r() * 8, y - pad + r() * 8], [x + w + pad + r() * 8, y - pad * 0.6 + r() * 8], [x + w + pad * 1.2 + r() * 8, y + h + pad + r() * 8], [x - pad * 0.8 + r() * 8, y + h + pad * 1.1 + r() * 8]]
        back.append(rb.polygon(pts, { fill: paperColor(el, seed), fillStyle: 'solid', stroke: 'none', roughness: 2.2, seed }))
        const grain = rb.polygon(pts, { fill: C.ink, fillStyle: 'hachure', hachureGap: 9, fillWeight: 0.6, stroke: C.ink, strokeWidth: 1.6, roughness: 2.4, seed: seed + 1 })
        grain.style.opacity = '0.16'
        back.append(grain)
      }
    }),
    tape: sized((el, seed, s) => {
      const { svg, rc, w, h } = layer(el, 'tape', 6, false, s)
      const r = seeded(seed)
      const pts: Point[] = [[0, 1], [w * 0.25, r() * 3], [w * 0.55, 1 + r() * 2], [w, 0], [w - 4, h * 0.3], [w, h * 0.55], [w - 3, h], [w * 0.5, h - 1 + r() * 2], [0, h], [3, h * 0.66], [0, h * 0.33]]
      svg.append(rc.polygon(pts, { fill: C.tape, fillStyle: 'solid', stroke: 'none', roughness: 0.6, seed }))
      const grain = rc.polygon(pts, { fill: C.yellowDeep, fillStyle: 'hachure', hachureGap: 5, fillWeight: 0.5, hachureAngle: 60, stroke: 'none', roughness: 1, seed: seed + 3 })
      grain.style.opacity = '0.35'
      svg.append(grain)
    }),
    highlight: sized((el, seed, s) => {
      const { svg, rc, w, h } = layer(el, 'mark', 14, true, s)
      svg.append(rc.rectangle(-6, h * 0.5, w + 12, h * 0.42, { fill: C.yellow, fillStyle: 'zigzag', hachureGap: 5, fillWeight: 4.5, hachureAngle: -18, stroke: 'none', roughness: 2.6, seed }))
    }),
    button: sized((el, seed, s) => {
      const { svg, rc, w, h } = layer(el, 'btn', 12, true, s)
      svg.append(...sticker(rc, w, h, el.closest('.renv-meals') ? C.note : C.yellow, seed))
    }),
    check: sized((el, seed, s) => {
      const { svg, rc, w, h } = layer(el, 'check', 14, false, s)
      svg.append(rc.rectangle(1, 1, w - 2, h - 2, { stroke: C.ink, strokeWidth: PEN.line, roughness: 1.3, fill: C.note, fillStyle: 'solid', seed }))
      if (el.dataset.checked) {
        const tick = rc.linearPath([[3, h * 0.5], [w * 0.4, h - 1], [w + 8, -9]], { stroke: C.pen, strokeWidth: PEN.hand + 1, roughness: 0.9, seed: seed + 5 })
        tick.classList.add('renv-tick')
        svg.append(tick)
      }
    }),
    circle: sized((el, seed, s) => {
      const big = el.matches('.renv-circle')
      const { svg, rc, w, h } = layer(el, 'circle', 22, true, s)
      if (!big) svg.append(rc.circle(w / 2, h / 2, Math.max(w, h) + 10, { fill: CRAYONS[seed % 4], fillStyle: 'solid', stroke: 'none', roughness: 1.6, seed: seed + 3 }))
      svg.append(rc.ellipse(w / 2, h / 2 + (big ? 2 : 0), w + (big ? 26 : 16), h + (big ? 14 : 10), { stroke: C.pen, strokeWidth: big ? PEN.hand + 0.6 : PEN.hand * 0.8, roughness: big ? 2 : 1.3, seed }))
    }),
    heart: sized((el, seed, s) => {
      const { svg, rc, w, h } = layer(el, 'heart', 8, false, s)
      const P = (x: number, y: number) => `${((x * w) / 56).toFixed(1)} ${((y * h) / 52).toFixed(1)}`
      const d = `M${P(28, 48)} C${P(10, 36)} ${P(2, 24)} ${P(6, 14)} C${P(10, 4)} ${P(24, 4)} ${P(28, 16)} C${P(32, 4)} ${P(46, 4)} ${P(50, 14)} C${P(54, 24)} ${P(46, 36)} ${P(28, 48)} Z`
      svg.append(rc.path(d, { fill: CRAYONS[seed % 4], fillStyle: 'solid', stroke: 'none', roughness: 1.4, seed: seed + 1 }))
      svg.append(rc.path(d, { fill: C.ink, fillStyle: 'zigzag', hachureGap: 7, fillWeight: 0.7, hachureAngle: -50, stroke: C.pen, strokeWidth: PEN.hand * 0.8, roughness: 1.2, seed }))
    }),
    note: kind({
      measure: (el) => {
        const fig = el.parentElement!
        const img = fig.querySelector('img')
        return { s: size(el), fig: size(fig), box: rel(el, fig), im: img ? rel(img, fig) : null }
      },
      paint(el, seed, { s, fig, box, im }) {
        const { svg, rc, w, h } = layer(el, 'note', 8, false, s)
        svg.append(rc.rectangle(0, 0, w, h, { stroke: C.ink, strokeWidth: PEN.frame * 0.7, roughness: 1.4, seed }))
        const [tx = 0, ty = 0] = (el.dataset.to ?? '').split(',').map(Number)
        if (im) arrowTo(el.parentElement!, fig, box, im, tx, ty, seed)
      }
    }),
    tab: sized((el, seed, s) => {
      const { svg, rc, w, h } = layer(el, 'tab', 12, true, s)
      if (el.getAttribute('aria-selected') !== 'true') return
      const i = [...el.parentElement!.children].indexOf(el)
      svg.append(...sticker(rc, w, h, CRAYONS[i % CRAYONS.length]!, seed))
    }),
    card: sized((el, seed, s) => {
      const { svg, rc, w, h } = layer(el, 'card', 14, true, s)
      const i = [...el.closest('ul')!.children].indexOf(el.parentElement!)
      svg.append(...sticker(rc, w, h, CRAYONS[i % CRAYONS.length]!, seed))
    }),
    clothesline: kind({
      // 曬衣繩：先依每張照片的中心算繩子下垂的高度（先量完五張再一起寫，不逐張重排）。
      // 繩長用軌道本身的寬（手機是 max-content）：scrollWidth 會把繩子自己那張 svg 的出血算進去，重畫一次長 30px。
      prepare(el) {
        const W = el.offsetWidth
        const items = [...el.querySelectorAll<HTMLElement>(':scope > li')]
        const wants = items.map((li) => Math.round(clotheslineY(li.offsetLeft + li.offsetWidth / 2, W) + 14))
        items.forEach((li, i) => { if (Math.abs(parseFloat(li.style.marginTop || '0') - wants[i]!) > 0.5) li.style.marginTop = `${wants[i]}px` })
      },
      measure: (el) => ({ s: size(el), xs: [...el.querySelectorAll<HTMLElement>(':scope > li')].map((li) => li.offsetLeft + li.offsetWidth / 2) }),
      paint(el, seed, { s, xs }) {
        const W = s.w
        const { svg, rc } = layer(el, 'line', 30, false, s)
        const pts: Point[] = Array.from({ length: 17 }, (_, i) => [(W * i) / 16, clotheslineY((W * i) / 16, W)])
        svg.append(rc.curve(pts, { stroke: C.pen, strokeWidth: PEN.line + 0.6, roughness: 0.8, seed }))
        xs.forEach((cx, i) => {
          svg.append(rc.rectangle(cx - 7, clotheslineY(cx, W) - 12, 14, 30, { fill: CRAYONS[i % 4], fillStyle: 'solid', stroke: C.ink, strokeWidth: 1.4, roughness: 1, seed: seed + i }))
        })
        svg.style.zIndex = '6'
      }
    }),
    trail: kind<TrailGeometry>({
      measure: (el, vw) => ({ ...size(el), stops: [...el.querySelectorAll('.renv-stop-no')].map((n) => rel(n, el)), top: el.getBoundingClientRect().top + scrollY, vw, vh: innerHeight }),
      paint(el, seed, geo) {
        if (motion?.trail) { motion.trail(el, tools, geo); return }
        const { svg, rc, w, h } = layer(el, 'trail', 40, true, geo)
        const vertical = geo.vw <= 760
        const stops = geo.stops.map((b): Point => [b.x + b.w / 2, b.y + b.h / 2])
        if (!stops.length) return
        const pts: Point[] = vertical ? [[stops[0]![0], -60], ...stops, [stops.at(-1)![0], h + 20]] : [[w / 2, -64], ...stops, [w / 2, h + 30]]
        // 在兩站之間補一個中途點，讓小路走在中間走道、不穿過照片
        const path: Point[] = [pts[0]!]
        for (let i = 1; i < pts.length; i++) {
          if (!vertical) path.push([w / 2 + (i % 2 ? -1 : 1) * 12, (pts[i - 1]![1] + pts[i]![1]) / 2])
          path.push(pts[i]!)
        }
        const g = rc.curve(path, { stroke: C.pen, strokeWidth: 2.6, roughness: 0.5, strokeLineDash: [2, 12], disableMultiStroke: true, seed })
        g.querySelectorAll('path').forEach((p) => p.setAttribute('stroke-linecap', 'round'))
        // 捲到哪、小路就畫到哪（clipPath 的高度跟著捲動）
        const clip = document.createElementNS(NS, 'clipPath')
        clip.id = 'renv-trail-clip'
        const rect = document.createElementNS(NS, 'rect')
        rect.setAttribute('x', '-40')
        rect.setAttribute('y', '-80')
        rect.setAttribute('width', String(w + 80))
        rect.setAttribute('height', String(reducedMotion ? h + 160 : 0))
        clip.append(rect)
        const defs = document.createElementNS(NS, 'defs')
        defs.append(clip)
        g.setAttribute('clip-path', 'url(#renv-trail-clip)')
        svg.append(defs, g)
        trailRect = rect
        trailHost = el
      }
    }),
    stop: sized((el, seed, s) => {
      const { svg, rc, w, h } = layer(el, 'stop', 8, false, s)
      svg.append(rc.circle(w / 2, h / 2, w, { fill: CRAYONS[seed % 4], fillStyle: 'solid', stroke: C.pen, strokeWidth: PEN.hand, roughness: 1.3, seed }))
      svg.style.zIndex = '-1'
    }),
    tagfill: sized((el, seed, s) => {
      const { svg, rc, w, h } = layer(el, 'tag', 8, true, s)
      svg.append(rc.rectangle(0, 0, w, h, { fill: el.matches('.renv-campus') ? C.note : C.yellow, fillStyle: 'solid', stroke: C.ink, strokeWidth: PEN.frame * 0.75, roughness: 1.4, seed }))
    }),
    sheet: sized((el, seed, s) => {
      const colors = SHEETS[el.dataset.sheet ?? '']
      if (!colors) return
      const { svg, rc, w, h } = layer(el, 'sheet', 0, false, s)
      const r = seeded(seed)
      const inset = Math.min(32, Math.max(10, w * 0.02))
      // 色紙：四角不正、邊緣有幾個小轉折，像手剪下來的
      const pts: Point[] = []
      const edge = (x0: number, y0: number, x1: number, y1: number, n: number) => {
        for (let i = 0; i < n; i++) pts.push([x0 + ((x1 - x0) * i) / n + r() * 10, y0 + ((y1 - y0) * i) / n + r() * 10])
      }
      edge(inset, inset + 6, w - inset, inset, 6)
      edge(w - inset, inset, w - inset - 4, h - inset, 8)
      edge(w - inset - 4, h - inset, inset + 4, h - inset - 6, 6)
      edge(inset + 4, h - inset - 6, inset, inset + 6, 8)
      svg.append(rc.polygon(pts, { fill: colors[0], fillStyle: 'solid', stroke: 'none', roughness: 1, seed }))
      const grain = rc.polygon(pts, { fill: colors[1], fillStyle: 'hachure', hachureGap: 10, fillWeight: 0.9, hachureAngle: -32, stroke: C.ink, strokeWidth: 1.2, roughness: 1.8, seed: seed + 1 })
      grain.style.opacity = '0.4'
      svg.append(grain)
    }),
    scribble: sized((el, seed, s) => {
      const { svg, rc, w, h } = layer(el, 'scribble', 16, false, s)
      svg.append(rc.curve([[0, h + 2], [w * 0.35, h - 1], [w * 0.7, h + 3], [w, h]], { stroke: C.pen, strokeWidth: PEN.hand * 0.75, roughness: 0.8, seed }))
    }),
    bookarrow: kind({
      measure: (el, vw) => {
        const host = el.parentElement!
        const cover = host.querySelector('.renv-book-cover')
        return cover ? { host: size(host), n: rel(el, host), c: rel(cover, host), narrow: vw <= 900 } : null
      },
      paint(el, seed, m) {
        if (!m) return
        const { n, c, narrow } = m
        const from: Point = narrow ? [n.x - 8, n.y + n.h * 0.4] : [n.x + n.w * 0.7, n.y - 8]
        const to: Point = narrow ? [c.x + c.w + 10, c.y + c.h * 0.62] : [c.x + c.w * 0.08, c.y + c.h * 0.6]
        const mid: Point = narrow ? [(from[0] + to[0]) / 2, from[1] + 30] : [from[0] + 6, to[1] + 6]
        const a = Math.atan2(to[1] - mid[1], to[0] - mid[0])
        const head = (s: number): Point => [to[0] - 15 * Math.cos(a + s), to[1] - 15 * Math.sin(a + s)]
        const { svg, rc } = layer(el.parentElement!, 'bookarrow', 40, false, m.host)
        const o: Options = { stroke: C.pen, strokeWidth: PEN.hand, roughness: 0.9, seed }
        svg.append(rc.curve([from, mid, to], o), rc.linearPath([head(0.5), to, head(-0.5)], o))
        svg.style.zIndex = '5'
      }
    }),
    sunpath: kind({
      // 太陽軌跡：桌機是一道弧，窄螢幕是往下走的直線；太陽跟著捲動從早餐走到點心
      prepare(el, vw) {
        const items = [...el.querySelectorAll<HTMLElement>('.renv-meal')]
        const vertical = vw <= 900
        el.classList.toggle('is-arc', !vertical)
        if (vertical) { items.forEach((li) => { li.style.left = li.style.top = '' }); return }
        const w = el.offsetWidth
        items.forEach((li) => { const [x, y] = mealArcPoint(Number(li.dataset.t), w); li.style.left = `${x}px`; li.style.top = `${y + 30}px` })
      },
      measure: (el, vw) => ({ s: size(el), vertical: vw <= 900, ys: vw <= 900 ? [...el.querySelectorAll<HTMLElement>('.renv-meal')].map((li) => li.offsetTop + 14) : [] }),
      paint(el, seed, { s, vertical, ys }) {
        const items = [...el.querySelectorAll<HTMLElement>('.renv-meal')]
        const { svg, rc, w } = layer(el, 'sun', 40, false, s)
        let pos: (t: number) => Point
        const ts = items.map((li, i) => (vertical ? (items.length > 1 ? i / (items.length - 1) : 0) : Number(li.dataset.t)))
        if (!vertical) {
          pos = (t) => mealArcPoint(t, w)
          svg.append(rc.curve(Array.from({ length: 29 }, (_, i) => pos((i - 2) / 24)), { stroke: C.ink, strokeWidth: PEN.line, roughness: 0.9, seed }))
        } else {
          const first = ys[0] ?? 0
          const last = ys.at(-1) ?? first
          pos = (t) => [24, first + t * (last - first)]
          svg.append(rc.curve(Array.from({ length: 21 }, (_, i): Point => [24 + Math.sin(i * 1.3) * 3, first - 20 + (i / 20) * (last - first + 40)]), { stroke: C.ink, strokeWidth: PEN.line, roughness: 0.9, seed }))
        }
        dots = items.map((li, i) => {
          const [x, y] = pos(ts[i]!)
          const g = document.createElementNS(NS, 'g')
          g.append(rc.circle(x, y, 20, { fill: C.note, fillStyle: 'solid', stroke: C.ink, strokeWidth: 1.6, roughness: 1, seed: seed + i }))
          const lit = rc.circle(x, y, 20, { fill: C.pen, fillStyle: 'solid', stroke: C.ink, strokeWidth: 1.6, roughness: 1, seed: seed + i })
          lit.classList.add('renv-dot-on')
          g.append(lit)
          svg.append(g)
          return { g, li, t: ts[i]! }
        })
        sun = document.createElementNS(NS, 'g')
        svg.append(sun)
        sunPos = pos
        sunNarrow = vertical
        dayHost = el
        drawSun(seed)
        // 新的太陽還沒定位：清掉上一次的進度，這一批畫完後一定會放（renderList 最後的 sunScroll）
        lastSunP = NaN
      }
    })
  }

  // ---------- 小路、太陽的捲動狀態 ----------
  let trailRect: SVGRectElement | null = null
  let trailHost: HTMLElement | null = null
  let dayHost: HTMLElement | null = null
  let sun: SVGGElement | null = null
  let sunPos: ((t: number) => Point) | null = null
  // 太陽軌跡是不是窄螢幕的直線（sunpath 重畫時決定）；placeSun 每幀用這個，不再讀 innerWidth 強制重排
  let sunNarrow = false
  // 上一次捲動算出的太陽進度：值沒變就不再起補間、不寫 transform（畫面外時一直停在 0 或 1）
  let lastSunP = NaN
  let dots: { g: SVGGElement; li: HTMLElement; t: number }[] = []

  function drawSun(seed: number) {
    if (!sun?.ownerSVGElement) return
    const rc = rough.svg(sun.ownerSVGElement)
    const r = 22
    const parts: SVGGElement[] = [
      rc.circle(0, 0, r * 2, { fill: C.yellow, fillStyle: 'solid', stroke: 'none', roughness: 1.4, seed }),
      rc.circle(0, 0, r * 2, { fill: C.yellowDeep, fillStyle: 'hachure', hachureGap: 4, fillWeight: 1.2, stroke: C.pen, strokeWidth: PEN.hand, roughness: 1.4, seed: seed + 1 })
    ]
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2
      parts.push(rc.line(Math.cos(a) * (r + 7), Math.sin(a) * (r + 7), Math.cos(a) * (r + 17), Math.sin(a) * (r + 17), { stroke: C.pen, strokeWidth: PEN.hand, roughness: 0.9, seed: seed + i + 2 }))
    }
    sun.replaceChildren(...parts)
  }
  function trailScroll() {
    if (!trailRect || !trailHost || reducedMotion) return
    trailRect.setAttribute('height', String(Math.max(0, innerHeight * 0.72 - trailHost.getBoundingClientRect().top + 80)))
  }
  /** 把太陽放到進度 p（光芒轉 spin 度），回傳這一次剛亮起的圓點。 */
  function placeSun(p: number, spin = 0): SVGGElement[] {
    if (!sun || !sunPos) return []
    const [x, y] = sunPos(reducedMotion ? 0.5 : p)
    const turn = spin ? ` rotate(${spin.toFixed(1)})` : ''
    // 太陽走在弧線上方一點，不蓋住時間與圓點；窄螢幕縮小貼著直線走
    sun.setAttribute('transform', sunNarrow ? `translate(${x} ${y}) scale(.62)${turn}` : `translate(${x} ${y - 44})${turn}`)
    const lit: SVGGElement[] = []
    for (const { g, li, t } of dots) {
      const on = p >= t - 0.02
      // 狀態真的改變才寫 class（sunpath 重畫後圓點是新的、li 沿用舊的，兩個分開比）
      if (g.classList.contains('is-lit') !== on) {
        if (on) lit.push(g)
        g.classList.toggle('is-lit', on)
      }
      if (li.classList.contains('is-lit') !== on) li.classList.toggle('is-lit', on)
    }
    return lit
  }
  function sunScroll() {
    if (!dayHost || !sun || !sunPos) return
    const r = dayHost.getBoundingClientRect()
    const p = reducedMotion ? 1 : Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.3)))
    dayHost.classList.toggle('is-live', !reducedMotion)
    if (p === lastSunP) return
    lastSunP = p
    if (motion?.sun && !reducedMotion) motion.sun(p, placeSun)
    else placeSun(p)
  }
  on(window, 'scroll', () => { trailScroll(); sunScroll() })

  // ---------- 渲染與進場描線 ----------
  const shown = new WeakSet<Element>()
  const boil = new WeakMap<Element, number>()
  const hosts = (scope: ParentNode) => [...scope.querySelectorAll<HTMLElement>('[data-rough]')]

  function strokes(el: HTMLElement) {
    const svgs: (SVGSVGElement | null)[] = [...el.querySelectorAll<SVGSVGElement>(':scope > svg.rough')]
    if (el.dataset.rough === 'note') svgs.push(el.parentElement!.querySelector<SVGSVGElement>(`:scope > svg.rough[data-key="arrow-${el.dataset.seed}"]`))
    if (el.dataset.rough === 'bookarrow') svgs.push(el.parentElement!.querySelector<SVGSVGElement>(':scope > svg.rough[data-key="bookarrow"]'))
    return svgs.filter((s): s is SVGSVGElement => !!s).flatMap((s) => [...s.querySelectorAll('path')])
  }
  /** 進場描線前先把線藏起來：一整批的路徑長度先量完再一起寫（getTotalLength 在寫過樣式後也會強制重排）。 */
  function hide(els: HTMLElement[]) {
    const paths = els.flatMap(strokes)
    const lengths = paths.map((p) => (p.getAttribute('stroke') === 'none' || p.getAttribute('stroke-dasharray') ? -1 : p.getTotalLength()))
    paths.forEach((p, i) => {
      const len = lengths[i]!
      if (len < 0) { p.style.opacity = '0'; return }
      p.style.strokeDasharray = `${len} ${len}`
      p.style.strokeDashoffset = String(len)
    })
  }
  function reveal(el: HTMLElement) {
    shown.add(el)
    strokes(el).forEach((p, i) => {
      const delay = Math.min(i * 40, 600)
      p.style.transition = `stroke-dashoffset .9s cubic-bezier(.22,1,.36,1) ${delay}ms, opacity .5s ease ${delay}ms`
      requestAnimationFrame(() => { p.style.strokeDashoffset = '0'; p.style.opacity = '' })
    })
  }
  // 2026-09-30 手機效能掃描（output/playwright/mobile-perf-deep-20260930）：原本每個宿主「插 svg、寫屬性 → 讀 offsetWidth」
  // 交錯，一百多張疊層各強制重排一次，CPU 4× 的手機整頁要 1.4 秒，fonts.ready 後又整批重畫一次，載入中點選單要等 2.6–3.2 秒。
  // 改成一批三段：prepare（會動到版面的先調）→ measure（只讀）→ paint（只寫），藏線的路徑長度也集中量。
  // 量到的幾何記在 drawn：onlyChanged 時（字型換上、視窗改寬）只重畫幾何真的變了的宿主。
  const drawn = new WeakMap<Element, string>()
  function renderList(els: HTMLElement[], onlyChanged = false) {
    const list = els.filter((el) => draw[el.dataset.rough ?? ''] && !el.closest('[hidden]'))
    if (!list.length) return
    const vw = innerWidth
    for (const el of list) draw[el.dataset.rough!]!.prepare?.(el, vw)
    const jobs = list.map((el) => {
      const m = draw[el.dataset.rough!]!.measure(el, vw)
      return { el, m, key: JSON.stringify(m) }
    }).filter(({ el, key }) => !onlyChanged || drawn.get(el) !== key)
    for (const { el, m, key } of jobs) {
      drawn.set(el, key)
      draw[el.dataset.rough!]!.paint(el, (Number(el.dataset.seed) || 1) + (boil.get(el) ?? 0), m)
    }
    if (!reducedMotion) hide(jobs.map(({ el }) => el).filter((el) => !shown.has(el) && ANIMATED.has(el.dataset.rough!) && !motion?.owns?.(el)))
    // 依視窗位置算的小路與太陽，等這一批都寫完再放
    if (jobs.some(({ el }) => el.dataset.rough === 'trail')) trailScroll()
    if (jobs.some(({ el }) => el.dataset.rough === 'sunpath')) sunScroll()
  }
  const render = (el: HTMLElement) => renderList([el])
  const renderAll = (scope: ParentNode = root) => renderList(hosts(scope))

  const revealIo = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && !shown.has(e.target)) { reveal(e.target as HTMLElement); revealIo.unobserve(e.target) }
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 })
  const watch = (els: HTMLElement[]) => {
    for (const el of els) {
      if (!ANIMATED.has(el.dataset.rough ?? '') || el.closest('[hidden]')) continue
      if (reducedMotion || motion?.owns?.(el)) shown.add(el)
      else if (!shown.has(el)) revealIo.observe(el)
    }
  }

  // 看完打個勾：章節上緣過了視窗 45% 的線，就把首屏目錄與章節小標的格子勾起來
  // （用視窗線判斷：校園環境那段比兩個視窗還高，用比例門檻永遠勾不到）
  const chapterIo = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      for (const box of root.querySelectorAll<HTMLElement>(`[data-chapter="${e.target.id}"] .renv-box, [data-chapter-check="${e.target.id}"]`)) {
        if (box.dataset.checked) continue
        box.dataset.checked = '1'
        render(box)
        const tick = box.querySelector<SVGPathElement>('.renv-tick path')
        if (tick && !reducedMotion) {
          const len = tick.getTotalLength()
          tick.style.strokeDasharray = `${len} ${len}`
          tick.style.strokeDashoffset = String(len)
          requestAnimationFrame(() => requestAnimationFrame(() => { tick.style.transition = 'stroke-dashoffset .6s cubic-bezier(.22,1,.36,1) .25s'; tick.style.strokeDashoffset = '0' }))
        }
      }
      chapterIo.unobserve(e.target)
    }
  }, { rootMargin: '0px 0px -55% 0px' })
  root.querySelectorAll('section[id]').forEach((section) => chapterIo.observe(section))

  // 太陽慢慢「沸騰」：看得到時每 0.32 秒換一次筆觸
  let sunVisible = false
  let sunTick = 0
  const sunIo = new IntersectionObserver(([e]) => { sunVisible = !!e?.isIntersecting })
  const day = root.querySelector('.renv-day')
  if (day) sunIo.observe(day)
  const boilTimer = reducedMotion ? 0 : window.setInterval(() => { if (sunVisible) drawSun(400 + (sunTick++ % 4)) }, 320)

  // 滑過去就重畫一次（手繪的「抖一下」）
  if (!reducedMotion && matchMedia('(hover: hover)').matches) {
    const onEnter = (e: Event) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.renv-stop-photo, .renv-hang-photo, .renv-book-cover, .renv-scene-photo, [data-rough="button"], [data-rough="card"]')
      if (!el || !root.contains(el) || el.contains((e as PointerEvent).relatedTarget as Node | null)) return
      boil.set(el, (boil.get(el) ?? 0) + 1)
      render(el)
    }
    root.addEventListener('pointerover', onEnter)
    cleanups.push(() => root.removeEventListener('pointerover', onEnter))
  }

  let frame = 0
  let alive = true
  // 字型換上、視窗改寬之後：整批量一次，只重畫幾何變了的宿主（多數照片框、色紙不受字型影響）；
  // 首次渲染還沒輪到的宿主留給分批那邊畫（輪到時才量，量到的就是最新版面）
  const again = () => { cancelAnimationFrame(frame); if (alive) frame = requestAnimationFrame(() => renderList(hosts(root).filter((el) => drawn.has(el)), true)) }
  let resizeTimer = 0
  // 手機網址列伸縮只改視窗高度：線條只依寬度排版，整批重畫結果一樣，卻會卡住主執行緒 1 秒以上（390 寬實測）。
  // 觸控裝置同寬的高度變動保留本次閱讀基準（DESIGN.md「手機捲動穩定與紙張載入」），只更新依視窗高度算的小路與太陽；
  // 寬度改變（轉向、桌機縮放）與非觸控裝置照舊整批量過、幾何變了的重畫。寬度用 clientWidth：iOS 雙指縮放時 innerWidth 會變。
  let lastWidth = document.documentElement.clientWidth
  const coarse = matchMedia('(pointer: coarse)')
  on(window, 'resize', () => {
    const width = document.documentElement.clientWidth
    if (width === lastWidth && coarse.matches) { trailScroll(); sunScroll(); return }
    lastWidth = width
    clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(again, 120)
  })
  // 首屏時字型多半已經好了（ready 立刻 resolve）：照舊量一次，但只重畫字寬真的改變的宿主。
  // 不接 loadingdone：捲動中才載到的分片會在曬衣繩擺動時觸發重畫，量到旋轉後放大的外框（2026-09-30 實測）。
  document.fonts?.ready.then(again)
  // 圖片都帶寬高，晚到不會推動版面；只有後台素材庫的圖可能沒有尺寸，載入後重畫那張照片的框與上面的便條。
  // 帶寬高的圖直接略過：換校發牌時 li 還在縮放，這時重畫會量到縮小的尺寸（框與便條擠到照片左上角），捲動中也會一再長任務。
  const onLoad = (e: Event) => {
    const img = e.target as Element
    if (img.tagName !== 'IMG' || (img.getAttribute('width') && img.getAttribute('height'))) return
    const host = img.closest<HTMLElement>('[data-rough]')
    if (host && root.contains(host)) renderList([host, ...hosts(host)])
  }
  root.addEventListener('load', onLoad, true)
  cleanups.push(() => root.removeEventListener('load', onLoad, true))

  const tools: SketchTools = { rough, colors: C, layer, rel, paperColor: (el) => paperColor(el) }

  // ---------- 首次渲染：跟視窗重疊的章節先畫，其餘依離視窗遠近一批批畫 ----------
  // 批次量測之後，CPU 4× 的手機整頁一百多張疊層一次畫完仍是 0.2 秒以上的長任務（多半是 Rough.js 產生路徑），載入中點擊要等它。
  // 會動到版面的先全部調好（後面每批量到的才是最終位置）；章節內照文件順序（照片框在便條前、小路在站點前），
  // 每批之間等下一個畫面畫完才繼續：點擊的回饋先畫出來（scheduler.yield 的接續優先權高，實測會連跑好幾批才輪到畫面，
  // 載入中點選單仍要 264 ms）。refresh 或滑過去已經畫過的宿主，輪到時略過。
  const CHUNK = 8
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
  async function drawFirst() {
    const all = hosts(root).filter((el) => draw[el.dataset.rough ?? ''] && !el.closest('[hidden]'))
    const vw = innerWidth
    for (const el of all) draw[el.dataset.rough!]!.prepare?.(el, vw)
    const vh = innerHeight
    const gaps = new Map<Element, number>()
    const gap = (el: HTMLElement) => {
      const section = el.closest('section') ?? root
      if (!gaps.has(section)) {
        const r = section.getBoundingClientRect()
        gaps.set(section, r.bottom < 0 ? -r.bottom : Math.max(0, r.top - vh))
      }
      return gaps.get(section)!
    }
    const order = all.map((el, i) => ({ el, i, d: gap(el) })).sort((a, b) => a.d - b.d || a.i - b.i)
    const now = order.filter(({ d }) => d === 0).map(({ el }) => el)
    const later = order.filter(({ d }) => d > 0).map(({ el }) => el)
    renderList(now)
    watch(now)
    for (let i = 0; i < later.length; i += CHUNK) {
      await nextFrame()
      if (!alive) return
      const group = later.slice(i, i + CHUNK).filter((el) => !drawn.has(el))
      renderList(group)
      watch(group)
    }
  }
  const ready = drawFirst()

  return {
    ready,
    refresh(scope = root) {
      renderAll(scope)
      watch(hosts(scope))
    },
    destroy() {
      alive = false
      cleanups.forEach((fn) => fn())
      revealIo.disconnect()
      chapterIo.disconnect()
      sunIo.disconnect()
      clearInterval(boilTimer)
      clearTimeout(resizeTimer)
      cancelAnimationFrame(frame)
    }
  }
}
