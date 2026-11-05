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
  /** sig：上次撒點用的版面（窄版與否、每段的 d 與顏色）；一樣的話撒出來的圓點逐點相同 */
  interface Route { svg: SVGSVGElement; host: HTMLElement; kind: string; dots: { el: SVGCircleElement; y: number }[]; shown: number; sig: string }
  let routes: Route[] = []
  const style = getComputedStyle(root)
  // 量路徑長度用的 path 常駐在小路的 svg 裡（fill:none、沒有 stroke，畫不出東西），之後每段只改 d（2026-11-05）。
  // 原本每次重建都先清空 svg、插一條新 path 量完再拿掉：文件裡插入、移除節點都要重算樣式，getTotalLength 又逼著當場算完；
  // 改屬性的失效只到這條 path 自己。不放在文件外量：Chromium 量得到，但 Safari 對文件外 path 的 getTotalLength 這裡沒辦法驗。
  const guides = new WeakMap<SVGSVGElement, SVGPathElement>()
  const guideOf = (svg: SVGSVGElement) => {
    let guide = guides.get(svg)
    if (!guide) {
      guide = document.createElementNS(NS, 'path')
      guide.setAttribute('fill', 'none')
      guides.set(svg, guide)
    }
    return guide
  }

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

  /**
   * 撒點（2026-11-05 起一次處理一批路線）：先把每條路線的版面都量完（build 只讀 offset 與計算後樣式），再量路徑長度算點，
   * 最後才寫進 DOM；兩條路線之間不再「寫完又讀」逼瀏覽器多算一次版面。圓點先在 fragment 裡建好、亮不亮也先設好
   * （新元素本來就沒有轉場，跟插進去之後再設一樣），每條路線只換一次子節點。
   * force=false（ResizeObserver 的通知、字型載好）時，版面跟上次一樣、而且還沒有任何圓點亮過就不重建：
   * 重建出來的圓點跟現在逐點相同（座標、顏色、都沒亮），原本載入時就這樣白建了三次。已經有圓點亮過照舊重建，
   * 直接連到 #spaces 這類一進來就亮的情況，維持原本「重建把剛開始逐顆亮的圓點換成直接亮好的新圓點」的樣子。
   * collect（載入、後台即時預覽的 refresh）一律重建。
   */
  const relayout = (list: Route[], force: boolean) => {
    const narrow = narrowQuery.matches
    const plans = list.filter((r) => r.host.offsetWidth).map((r) => {
      const segs = build(r)
      return { r, segs, sig: [narrow, ...segs.map((seg) => `${seg.d}|${seg.color}`)].join('\n') }
    })
    const gap = narrow ? 15 : 18
    const radius = String(narrow ? 3 : 4)
    const todo = plans.filter(({ r, sig }) => force || sig !== r.sig || r.shown > 0).map(({ r, segs, sig }) => {
      const guide = guideOf(r.svg)
      if (guide.parentNode !== r.svg) r.svg.prepend(guide)
      const points: { x: number; y: number; color: string }[] = []
      for (const seg of segs) {
        guide.setAttribute('d', seg.d)
        const len = guide.getTotalLength()
        const n = dotCount(len, gap)
        for (let i = 0; i < n; i++) {
          const p = guide.getPointAtLength((i * len) / n)
          points.push({ x: p.x, y: p.y, color: seg.color })
        }
      }
      return { r, sig, points }
    })
    for (const { r, sig, points } of todo) {
      const shown = reducedMotion ? points.length : Math.min(r.shown, points.length)
      const frag = document.createDocumentFragment()
      r.dots = points.map((p, i) => {
        const c = document.createElementNS(NS, 'circle')
        c.setAttribute('cx', f1(p.x))
        c.setAttribute('cy', f1(p.y))
        c.setAttribute('r', radius)
        c.style.fill = p.color
        if (i < shown) c.classList.add('is-on')
        frag.append(c)
        return { el: c, y: p.y }
      })
      r.svg.replaceChildren(guideOf(r.svg), frag)
      r.shown = shown
      r.sig = sig
    }
    if (plans.length) tick()
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

  // observe() 之後一定會先送一次初始通知；字型已就緒時 fonts.ready 也馬上回來。這兩次版面多半沒變，relayout 會略過。
  const ro = 'ResizeObserver' in window ? new ResizeObserver((entries) => relayout(routes.filter((r) => entries.some((e) => e.target === r.host)), false)) : null
  const collect = () => {
    ro?.disconnect()
    routes = [...root.querySelectorAll<SVGSVGElement>('svg.renv-route')].map((svg) => ({ svg, host: svg.parentElement!, kind: svg.dataset.route ?? '', dots: [], shown: 0, sig: '' }))
    routes.forEach((r) => ro?.observe(r.host))
    relayout(routes, true)
  }
  collect()
  document.fonts?.ready.then(() => relayout(routes, false))
  const onScroll = () => tick()
  const onResize = () => { if (!ro) relayout(routes, true); tick() }
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
