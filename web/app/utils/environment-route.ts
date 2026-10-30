// 常春藤環境頁（/environment）2026-10-30 木頭積木版的「圓點小路」：02 校園環境把六張照片串起來、03 幼兒餐點把五個時間站串起來。
// 比稿 design/environment-style-directions-20261030/（使用者選 D，要求校園環境與餐點照 A 用線串起來）。
// 圓點是 <svg class="renv-route"> 裡的 circle，純裝飾（aria-hidden）；沒有 JS 時版面與文字照常，只是沒有圓點。
// 位置用 offset 累加量：不受進場動畫的 transform 影響。捲到視窗 80% 的線才一顆顆亮起；減少動態時一次全亮。

type Point = [number, number]
export interface RouteSegment { d: string; color: string }
/** 照片框在小路宿主（<ol>）裡的水平中心與上下緣 */
export interface FrameBox { x: number; top: number; bottom: number }

const NS = 'http://www.w3.org/2000/svg'
const f1 = (v: number) => v.toFixed(1)
export const polyline = (points: Point[]) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(x)} ${f1(y)}`).join(' ')

/**
 * 校園環境（桌機）：從第一張照片上方進來，每一段從這張照片的底部彎到下一張的頂部（中間經過的照片會蓋住小路），
 * 最後從最後一張底部再走一小段出去。每段用「要去的那一站」的顏色。
 */
export function mapSegments(frames: FrameBox[], colors: string[]): RouteSegment[] {
  if (!frames.length) return []
  const first = frames[0]!
  const segs: RouteSegment[] = [{ d: polyline([[first.x, first.top - 130], [first.x, first.top]]), color: colors[0]! }]
  frames.forEach((m, i) => {
    const n = frames[i + 1]
    if (!n) return
    const k = (n.top - m.bottom) * 0.95 + 30
    segs.push({ d: `M${f1(m.x)} ${f1(m.bottom)} C${f1(m.x)} ${f1(m.bottom + k)} ${f1(n.x)} ${f1(n.top - k)} ${f1(n.x)} ${f1(n.top)}`, color: colors[i + 1]! })
  })
  const last = frames.at(-1)!
  segs.push({ d: polyline([[last.x, last.bottom], [last.x, last.bottom + 80]]), color: colors.at(-1)! })
  return segs
}

/** 校園環境（手機）：左邊一條直線，依序經過每一站的編號 */
export function mapSegmentsNarrow(numbers: Point[], colors: string[]): RouteSegment[] {
  if (!numbers.length) return []
  const segs = numbers.map((p, i): RouteSegment => ({ d: polyline([i ? numbers[i - 1]! : [p[0], p[1] - 90], p]), color: colors[i]! }))
  const last = numbers.at(-1)!
  segs.push({ d: polyline([last, [last[0], last[1] + 110]]), color: colors.at(-1)! })
  return segs
}

/** 幼兒餐點：直線串起五個時間站，頭尾各多走一段（桌機橫向、手機直向） */
export function daySegments(stations: Point[], color: string, narrow: boolean): RouteSegment[] {
  if (!stations.length) return []
  const [a, z] = [stations[0]!, stations.at(-1)!]
  const ends: [Point, Point] = narrow ? [[a[0], a[1] - 44], [z[0], z[1] + 44]] : [[a[0] - 110, a[1]], [z[0] + 110, z[1]]]
  return [{ d: polyline([ends[0], ...stations, ends[1]]), color }]
}

/** 每段等距撒點；段與段在照片上接起來，每段的最後一點讓給下一段，不重疊 */
export function dotCount(length: number, gap: number): number {
  return Math.max(1, Math.round(length / gap))
}

export interface EnvironmentRoutes {
  /** 版面變了（預覽換內容、換校）之後重算 */
  refresh: () => void
  destroy: () => void
}

function offsetIn(el: HTMLElement, host: HTMLElement) {
  let x = 0
  let y = 0
  let e: HTMLElement | null = el
  while (e && e !== host) {
    x += e.offsetLeft
    y += e.offsetTop
    e = e.offsetParent as HTMLElement | null
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight }
}
const center = (el: HTMLElement, host: HTMLElement): Point => {
  const r = offsetIn(el, host)
  return [r.x + r.w / 2, r.y + r.h / 2]
}

export function createEnvironmentRoutes(root: HTMLElement, { reducedMotion }: { reducedMotion: boolean }): EnvironmentRoutes {
  const narrowQuery = matchMedia('(width <= 900px)')
  interface Route { svg: SVGSVGElement; host: HTMLElement; kind: string; dots: { el: SVGCircleElement; y: number }[]; shown: number }
  let routes: Route[] = []
  const style = getComputedStyle(root)

  const build = (r: Route): RouteSegment[] => {
    const narrow = narrowQuery.matches
    if (r.kind === 'map') {
      const stops = [...r.host.querySelectorAll<HTMLElement>('.renv-stop')]
      const colors = stops.map((stop) => stop.dataset.routeColor ?? '')
      if (narrow) return mapSegmentsNarrow(stops.map((stop) => center(stop.querySelector<HTMLElement>('.renv-stop-no')!, r.host)), colors)
      return mapSegments(stops.map((stop) => {
        const box = offsetIn(stop.querySelector<HTMLElement>('.renv-frame')!, r.host)
        return { x: box.x + box.w / 2, top: box.y, bottom: box.y + box.h }
      }), colors)
    }
    const stations = [...r.host.querySelectorAll<HTMLElement>('.renv-stn')].map((el) => center(el, r.host))
    return daySegments(stations, style.getPropertyValue('--renv-terra').trim(), narrow)
  }

  const lay = (r: Route) => {
    if (!r.host.offsetWidth) return
    const narrow = narrowQuery.matches
    const gap = narrow ? 15 : 18
    const radius = narrow ? 3 : 4
    const guide = document.createElementNS(NS, 'path')
    r.svg.replaceChildren(guide)
    const frag = document.createDocumentFragment()
    r.dots = []
    for (const seg of build(r)) {
      guide.setAttribute('d', seg.d)
      const len = guide.getTotalLength()
      const n = dotCount(len, gap)
      for (let i = 0; i < n; i++) {
        const p = guide.getPointAtLength((i * len) / n)
        const c = document.createElementNS(NS, 'circle')
        c.setAttribute('cx', f1(p.x))
        c.setAttribute('cy', f1(p.y))
        c.setAttribute('r', String(radius))
        c.style.fill = seg.color
        frag.append(c)
        r.dots.push({ el: c, y: p.y })
      }
    }
    guide.remove()
    r.svg.append(frag)
    r.shown = reducedMotion ? r.dots.length : Math.min(r.shown, r.dots.length)
    r.dots.forEach((dot, i) => dot.el.classList.toggle('is-on', i < r.shown))
    tick()
  }

  let raf = 0
  const tick = () => {
    if (reducedMotion || raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const line = innerHeight * 0.8
      for (const r of routes) {
        if (!r.dots.length) continue
        const top = r.host.getBoundingClientRect().top
        let target = 0
        for (let i = r.dots.length - 1; i >= 0; i--) if (top + r.dots[i]!.y < line) { target = i + 1; break }
        if (target <= r.shown) continue
        for (let k = r.shown; k < target; k++) {
          const dot = r.dots[k]!.el
          dot.style.transitionDelay = `${Math.min(k - r.shown, 90) * 14}ms`
          dot.classList.add('is-on')
        }
        r.shown = target
      }
    })
  }

  const ro = 'ResizeObserver' in window ? new ResizeObserver((entries) => entries.forEach((e) => routes.filter((r) => r.host === e.target).forEach(lay))) : null
  const collect = () => {
    ro?.disconnect()
    routes = [...root.querySelectorAll<SVGSVGElement>('svg.renv-route')].map((svg) => ({ svg, host: svg.parentElement!, kind: svg.dataset.route ?? '', dots: [], shown: 0 }))
    routes.forEach((r) => { ro?.observe(r.host); lay(r) })
  }
  collect()
  document.fonts?.ready.then(() => routes.forEach(lay))
  const onScroll = () => tick()
  const onResize = () => { if (!ro) routes.forEach(lay); tick() }
  addEventListener('scroll', onScroll, { passive: true })
  addEventListener('resize', onResize)

  return {
    refresh: collect,
    destroy() {
      ro?.disconnect()
      cancelAnimationFrame(raf)
      removeEventListener('scroll', onScroll)
      removeEventListener('resize', onResize)
    }
  }
}
