// 常春藤環境頁（/environment）2026-10-30 木頭積木版的「圓點小路」：02 校園環境把六張照片串起來、03 幼兒餐點把五個時間站串起來。
// 比稿 design/environment-style-directions-20261030/（使用者選 D，要求校園環境與餐點照 A 用線串起來）。
// 圓點是 <svg class="renv-route"> 裡的 circle，純裝飾（aria-hidden）；沒有 JS 時版面與文字照常，只是沒有圓點。
// 位置用 offset 累加量：不受進場動畫的 transform 影響。捲到視窗 80% 的線才一顆顆亮起；減少動態時一次全亮。

import { cancelScrollFrame, requestScrollFrame, type ScrollFrameTask } from './scrollFrame'

type Point = [number, number]
/** centered：圓點在這一段裡置中排（兩端各留半個間距），不從起點開始排；餐點時間軸兩個盤子之間用 */
export interface RouteSegment { d: string; color: string; centered?: boolean }
/** 照片框在小路宿主（<ol>）裡的水平中心與上下緣 */
export interface FrameBox { x: number; top: number; bottom: number }

const NS = 'http://www.w3.org/2000/svg'
const f1 = (v: number) => v.toFixed(1)
export const polyline = (points: Point[]) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(x)} ${f1(y)}`).join(' ')

/**
 * 校園環境（桌機、平板）：每一段從這張照片的底部彎到下一張的頂部（中間經過的照片會蓋住小路），從第一張走到最後一張。
 * 每段用「要去的那一站」的顏色。
 * 2026-11-13 前頭尾各多走一段：起點是第一張上方 130px 憑空冒出的幾顆圓點，終點從最後一張底部再走 80px、懸在章節底部的留白裡，
 * 兩頭都沒有接任何東西，拿掉。
 */
export function mapSegments(frames: FrameBox[], colors: string[]): RouteSegment[] {
  const segs: RouteSegment[] = []
  frames.forEach((m, i) => {
    const n = frames[i + 1]
    if (!n) return
    const k = (n.top - m.bottom) * 0.95 + 30
    segs.push({ d: `M${f1(m.x)} ${f1(m.bottom)} C${f1(m.x)} ${f1(m.bottom + k)} ${f1(n.x)} ${f1(n.top - k)} ${f1(n.x)} ${f1(n.top)}`, color: colors[i + 1]! })
  })
  return segs
}

/** 校園環境（手機）：左邊一條直線，從第一站的編號依序走到最後一站的編號（原本頭尾各多走 90、110px） */
export function mapSegmentsNarrow(numbers: Point[], colors: string[]): RouteSegment[] {
  return numbers.slice(1).map((p, i): RouteSegment => ({ d: polyline([numbers[i]!, p]), color: colors[i + 1]! }))
}

/**
 * 幼兒餐點：五個時間站（圓盤）之間各一小段圓點，桌機、平板橫向，手機直向。
 * 每一小段從這個盤子的邊緣走到下一個盤子的邊緣（兩邊各留 pad），圓點在段內置中：每個盤子左右（上下）露出來的圓點都一樣，
 * 不會有圓點被盤子切掉一半。2026-11-13 前是一條穿過所有圓心的線，盤子蓋住哪幾顆要看運氣。
 * radius＝盤子的半徑；直向時盤子底下還有 side px 的積木側面，要再讓開。
 * 橫向的頭尾各多走一小段 stub（不夠放一顆圓點就不畫）；直向不畫頭尾（手機上孤零零一顆像髒點）。
 */
export function daySegments(stations: Point[], color: string, narrow: boolean, { radius = 56, pad = 10, side = 7, stub = 44 } = {}): RouteSegment[] {
  if (!stations.length) return []
  const segs: RouteSegment[] = []
  const add = (a: Point, b: Point) => segs.push({ d: polyline([a, b]), color, centered: true })
  if (!narrow && stub >= 12) add([stations[0]![0] - radius - pad - stub, stations[0]![1]], [stations[0]![0] - radius - pad, stations[0]![1]])
  stations.slice(1).forEach((b, i) => {
    const a = stations[i]!
    if (narrow) { if (b[1] - radius - pad > a[1] + radius + side + pad) add([a[0], a[1] + radius + side + pad], [b[0], b[1] - radius - pad]) }
    else if (b[0] - radius - pad > a[0] + radius + pad) add([a[0] + radius + pad, a[1]], [b[0] - radius - pad, b[1]])
  })
  const last = stations.at(-1)!
  if (!narrow && stub >= 12) add([last[0] + radius + pad, last[1]], [last[0] + radius + pad + stub, last[1]])
  return segs
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
  // 640 以下是手機單欄（同 environment.css）：校園環境走左邊的直線、餐點時間軸直向；641 以上（含平板）用彎的小路與橫向時間軸。
  // 不寫成 (width <= 640px)：Safari 16.4 以前不認得範圍寫法，會當成永遠不成立（2026-11-13，tests/legacy-safari-20261113.spec.ts）。
  const narrowQuery = matchMedia('(max-width: 640px)')
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
    const plates = [...r.host.querySelectorAll<HTMLElement>('.renv-stn')]
    const stations = plates.map((el) => center(el, r.host))
    const radius = (plates[0]?.offsetWidth ?? 0) / 2
    // 頭尾多走的那一小段不超出時間軸本身（第一個盤子左緣到時間軸左緣的距離），最長 44px
    const pad = narrow ? 7 : 10
    return daySegments(stations, style.getPropertyValue('--renv-terra').trim(), narrow, { radius, pad, stub: Math.min(44, (stations[0]?.[0] ?? 0) - radius - pad) })
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
        // 盤子之間的小段比間距短時也至少放得下的顆數：長度 ÷ 間距四捨五入，至少一顆
        const n = dotCount(len, seg.centered ? gap * 0.72 : gap)
        const shift = seg.centered ? 0.5 : 0
        for (let i = 0; i < n; i++) {
          const p = guide.getPointAtLength(((i + shift) * len) / n)
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

  // 讀寫分開排進共用的捲動幀（utils/scrollFrame.ts，2026-11-10）：先量完每條路線的位置，再一起點亮。
  // 原本逐條「量一條、亮一條」，第二條起每次量都要先把上一條剛加的 class 算進樣式（手機 4 倍降速一幀 48ms）。
  let tops = new Map<Route, number>()
  const frameTask: ScrollFrameTask = {
    read() {
      tops = new Map(routes.filter((r) => r.dots.length).map((r) => [r, r.host.getBoundingClientRect().top]))
    },
    write() {
      const line = innerHeight * 0.8
      for (const [r, top] of tops) {
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
    }
  }
  const tick = () => {
    if (!reducedMotion) requestScrollFrame(frameTask)
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
      cancelScrollFrame(frameTask)
      removeEventListener('scroll', onScroll)
      removeEventListener('resize', onResize)
    }
  }
}
