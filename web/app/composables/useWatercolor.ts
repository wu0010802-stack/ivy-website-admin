import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { PIGMENTS, type Pigment, type Point, blotCanvas, bloomCanvas, deckleCanvas, grainCanvas, parseWash, seededRandom, tracePolygon, washEllipse, washPolygons } from '~/utils/watercolor'

/**
 * 特色教學頁的水彩層（2026-09-28）。HTML 只標位置，這裡負責畫：
 * - `data-wash="…"`（格式見 utils/watercolor.ts 的 parseWash）：在所屬段落的 `.cur-wash` canvas 上、
 *   以元素框為基準畫顏料；段落接近視窗才開始畫，一層一層疊，看得到染開。
 *   `data-wash-mobile` 是 760px 以下的替代；在橫滑清單裡的元素不對位（捲動後會錯開），改由清單本身鋪一片。
 * - `data-blot="顏料"`：依元素大小生成一團顏料當背景圖（年齡、章節編號、引言、理念）。
 * - `.cur-frame`：照片撕紙毛邊＋進場從中間暈開（兩層 mask，第二層 mask-size 從 0 放大）。
 * - `data-reveal`：捲到才淡入；掛上時已經在視窗內的直接顯示，不閃。
 * - 首屏：滑鼠滑過滴下淡淡的顏料（最多 26 滴，只認滑鼠）。
 * - `data-reveal-group`（手機的橫滑清單）：真的能橫向捲動時才加 tabindex="0"，讓只用鍵盤的人也捲得動
 *   （axe scrollable-region-focusable）；桌機不捲動就不多一個 Tab 停點。
 * 顏料色讀 tokens.css 的 `--ivy-paint-<顏料>-rgb`。減少動態：一次畫完、不暈開、不滴顏料。強制色彩：整層不畫（CSS 也會藏）。
 *
 * 效能（2026-09-28 實測，390 寬、4 倍 CPU 節流）：一開始在掛上時同步產生全部顏料團與遮罩，多出一個約 840ms 的長任務。
 * 現在的做法：顏料團與遮罩只在元素離視窗 800px 內才產生；所有產生工作排進閒置時間、每塊不超過 8ms；
 * 圖片用 toBlob 非同步編碼；段落顏料的多邊形在要畫的那一幀才算。
 */
export function useWatercolor(root: Ref<HTMLElement | null>) {
  let stop: (() => void) | undefined
  onMounted(() => { if (root.value) stop = start(root.value) })
  onBeforeUnmount(() => stop?.())
}

interface Job { ctx: CanvasRenderingContext2D, make: () => Point[][], polys?: Point[][], rgb: string, alpha: number, i: number, per: number }
interface Painted { width: number, height: number, mobile: boolean, ctx: CanvasRenderingContext2D }
type IdleHandle = number | ReturnType<typeof setTimeout>

const TASK_BUDGET = 8

function start(main: HTMLElement) {
  if (matchMedia('(forced-colors: active)').matches) return undefined
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const mobileQuery = matchMedia('(max-width: 760px)')
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  // 顏料本來就是軟的，canvas 用 0.6 倍解析度畫再放大，省記憶體也更像暈開
  const washScale = Math.min(1, dpr) * 0.6
  const rootStyle = getComputedStyle(document.documentElement)
  const rgb = Object.fromEntries(PIGMENTS.map((p) => [p, rootStyle.getPropertyValue(`--ivy-paint-${p}-rgb`).trim()])) as Record<Pigment, string>
  const cleanups: (() => void)[] = []
  const objectUrls: string[] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let stopped = false
  const later = (fn: () => void, ms: number) => { const t = setTimeout(() => { timers.delete(t); fn() }, ms); timers.add(t) }

  // ---------- 閒置時間的工作佇列：每塊不超過 8ms ----------
  const tasks: (() => void)[] = []
  let idle: IdleHandle | undefined
  const requestIdle = (fn: () => void): IdleHandle => window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 16)
  const cancelIdle = (handle: IdleHandle) => { if (window.cancelIdleCallback && typeof handle === 'number') window.cancelIdleCallback(handle); else clearTimeout(handle) }
  const runTasks = () => {
    idle = undefined
    const t0 = performance.now()
    while (tasks.length && performance.now() - t0 < TASK_BUDGET) tasks.shift()!()
    if (tasks.length && !stopped) idle = requestIdle(runTasks)
  }
  const enqueue = (task: () => void) => { tasks.push(task); if (idle === undefined) idle = requestIdle(runTasks) }
  cleanups.push(() => { if (idle !== undefined) cancelIdle(idle); tasks.length = 0 })

  // canvas → 網址（非同步編碼；卸載時一起釋放）
  const toUrl = (canvas: HTMLCanvasElement) => new Promise<string>((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve(canvas.toDataURL())
      const url = URL.createObjectURL(blob)
      objectUrls.push(url)
      resolve(url)
    })
  })
  const inView = (el: Element) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight }

  // ---------- 紙紋與暈開遮罩：一張就好 ----------
  const grain = main.querySelector<HTMLElement>('.cur-grain')
  if (grain) enqueue(() => { void toUrl(grainCanvas()).then((url) => { if (!stopped) grain.style.backgroundImage = `url(${url})` }) })
  let bloomUrl: Promise<string> | undefined
  const bloom = () => (bloomUrl ??= toUrl(bloomCanvas()))

  // ---------- 顏料團與照片遮罩：接近視窗才產生 ----------
  const frames = [...main.querySelectorAll<HTMLElement>('.cur-frame')]
  const blots = [...main.querySelectorAll<HTMLElement>('[data-blot]')]
  const decorated = new Set<HTMLElement>()
  const revealedWithin = (frame: HTMLElement) => { const reveal = frame.closest('[data-reveal]'); return !reveal || reveal.classList.contains('is-in') }

  const decorateBlot = (el: HTMLElement) => {
    const w = el.offsetWidth, h = el.offsetHeight, color = rgb[el.dataset.blot as Pigment]
    if (!w || !h || !color || el.dataset.blotSize === `${w}x${h}`) return
    el.dataset.blotSize = `${w}x${h}`
    void toUrl(blotCanvas(60 + blots.indexOf(el) * 7, color, w, h, dpr)).then((url) => {
      if (stopped) return
      el.style.backgroundImage = `url(${url})`
      requestAnimationFrame(() => el.classList.add('is-painted'))
    })
  }
  const decorateFrame = (frame: HTMLElement) => {
    const w = frame.offsetWidth, h = frame.offsetHeight
    if (!w || !h || frame.dataset.maskSize === `${w}x${h}`) return
    frame.dataset.maskSize = `${w}x${h}`
    void Promise.all([toUrl(deckleCanvas(w, h, 100 + frames.indexOf(frame))), bloom()]).then(([edge, center]) => {
      if (stopped) return
      const mask = `url(${edge}), url(${center})`
      frame.style.setProperty('-webkit-mask-image', mask)
      frame.style.maskImage = mask
      // 已經看得到的照片直接換上毛邊，不先藏起來再暈開（會像閃了一下）；還沒捲到的等進場再暈開
      if (reduce || frame.classList.contains('is-bloomed') || (revealedWithin(frame) && inView(frame))) frame.classList.add('is-bloomed')
      else if (revealedWithin(frame)) later(() => frame.classList.add('is-bloomed'), 160)
      frame.classList.add('has-mask')
    })
  }
  const decorate = (el: HTMLElement) => { decorated.add(el); if (el.matches('.cur-frame')) decorateFrame(el); else decorateBlot(el) }
  // 以段落為單位：段落離視窗 800px 內就把裡面的遮罩與顏料團排進佇列。
  // 不逐一觀察元素：手機橫滑清單裡還沒滑到的卡片會被捲動容器裁掉，IntersectionObserver 等不到它們。
  const decorObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (!entry.isIntersecting) return
    decorObserver.unobserve(entry.target)
    entry.target.querySelectorAll<HTMLElement>('.cur-frame, [data-blot]').forEach((el) => enqueue(() => decorate(el)))
  }), { rootMargin: '800px 0px' })
  main.querySelectorAll('.cur-hero, .cur-sec').forEach((section) => decorObserver.observe(section))
  cleanups.push(() => decorObserver.disconnect())

  // ---------- 進場 ----------
  const bloomWithin = (el: Element) => {
    if (reduce) return
    const inside = el.matches('.cur-frame') ? [el] : [...el.querySelectorAll('.cur-frame')]
    inside.forEach((frame, i) => later(() => frame.classList.add('is-bloomed'), 120 + i * 140))
  }
  const reveal = (el: Element) => { el.classList.add('is-in'); bloomWithin(el) }
  const revealObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (!entry.isIntersecting) return
    revealObserver.unobserve(entry.target)
    // 手機的橫滑清單：清單進到視窗就整排顯示，不然還沒滑到的卡片要等使用者滑過去才淡入，會先看到一片空白
    if (entry.target.matches('[data-reveal-group]')) entry.target.querySelectorAll('[data-reveal]:not(.is-in)').forEach(reveal)
    else reveal(entry.target)
  }), { rootMargin: '0px 0px -8% 0px', threshold: 0.01 })
  const groups = new Set<HTMLElement>()
  for (const el of main.querySelectorAll<HTMLElement>('[data-reveal]')) {
    const group = el.parentElement?.closest<HTMLElement>('[data-reveal-group]')
    if (reduce || inView(el)) el.classList.add('is-in')
    else if (group && group.scrollWidth > group.clientWidth + 2) groups.add(group)
    else revealObserver.observe(el)
  }
  groups.forEach((group) => revealObserver.observe(group))
  const scrollers = [...main.querySelectorAll<HTMLElement>('[data-reveal-group]')]
  const syncScrollers = () => scrollers.forEach((list) => {
    if (list.scrollWidth > list.clientWidth + 2) list.tabIndex = 0
    else list.removeAttribute('tabindex')
  })
  syncScrollers()
  main.classList.add('is-live')
  cleanups.push(() => revealObserver.disconnect())

  // ---------- 段落顏料：逐層畫，一幀最多 7ms；多邊形在要畫的那一幀才算 ----------
  const jobs: Job[] = []
  let pumpFrame = 0
  const pump = () => {
    pumpFrame = 0
    const t0 = performance.now()
    let n = 0
    while (jobs.length && performance.now() - t0 < 7) {
      const job = jobs[n % jobs.length]!
      const polys = (job.polys ??= job.make())
      const end = Math.min(polys.length, job.i + (reduce ? Infinity : job.per))
      job.ctx.fillStyle = `rgb(${job.rgb} / ${job.alpha})`
      job.ctx.strokeStyle = `rgb(${job.rgb} / ${Math.min(0.06, job.alpha * 1.6)})`
      job.ctx.lineWidth = 1
      for (; job.i < end; job.i++) {
        tracePolygon(job.ctx, polys[job.i]!)
        job.ctx.fill()
        if (job.i % 4 === 0) job.ctx.stroke()
      }
      if (job.i >= polys.length) jobs.splice(jobs.indexOf(job), 1)
      n++
      if (!reduce && n >= jobs.length + 1) break
    }
    if (jobs.length && !stopped) pumpFrame = requestAnimationFrame(pump)
  }
  const queue = (job: Job) => { jobs.push(job); if (!pumpFrame) pumpFrame = requestAnimationFrame(pump) }
  cleanups.push(() => { cancelAnimationFrame(pumpFrame); jobs.length = 0 })

  const sections = [...main.querySelectorAll<HTMLElement>('.cur-hero, .cur-sec')]
  const painted = new Map<HTMLElement, Painted>()
  const offsetBox = (el: HTMLElement, section: HTMLElement) => {
    let x = 0, y = 0, node: HTMLElement | null = el
    while (node && node !== section) { x += node.offsetLeft; y += node.offsetTop; node = node.offsetParent as HTMLElement | null }
    if (node === section) return { x, y, w: el.offsetWidth, h: el.offsetHeight }
    const r = el.getBoundingClientRect(), s = section.getBoundingClientRect()
    return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height }
  }
  const inScroller = (el: HTMLElement, section: HTMLElement) => {
    for (let a = el.parentElement; a && a !== section; a = a.parentElement) {
      const overflow = getComputedStyle(a).overflowX
      if ((overflow === 'auto' || overflow === 'scroll') && a.scrollWidth > a.clientWidth + 2) return true
    }
    return false
  }
  const paintSection = (section: HTMLElement, animate: boolean) => {
    const canvas = section.querySelector<HTMLCanvasElement>(':scope > .cur-wash')
    if (!canvas) return
    const width = section.clientWidth, height = section.clientHeight
    canvas.width = Math.max(1, Math.round(width * washScale))
    canvas.height = Math.max(1, Math.round(height * washScale))
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(washScale, 0, 0, washScale, 0, 0)
    for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i]!.ctx === ctx) jobs.splice(i, 1)
    const mobile = mobileQuery.matches
    const random = seededRandom((section.id || 'hero').length * 131)
    section.querySelectorAll<HTMLElement>('[data-wash],[data-wash-mobile]').forEach((el) => {
      const definition = mobile ? (el.dataset.washMobile ?? el.dataset.wash) : el.dataset.wash
      if (!definition || !el.offsetWidth || inScroller(el, section)) return
      const box = offsetBox(el, section)
      for (const spec of parseWash(definition)) {
        const color = rgb[spec.pigment]
        if (!color) continue
        const { cx, cy, rx, ry } = washEllipse(spec, box, height)
        queue({ ctx, make: () => washPolygons(random, cx, cy, rx, ry, Math.round(spec.layers * 1.3)), rgb: color, alpha: spec.alpha * 0.55, i: 0, per: animate ? 3 : Infinity })
      }
    })
    painted.set(section, { width, height, mobile, ctx })
  }
  const nearObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
    const section = entry.target as HTMLElement
    if (entry.isIntersecting && !painted.has(section)) paintSection(section, !reduce)
  }), { rootMargin: '200px 0px' })
  sections.forEach((section) => nearObserver.observe(section))
  cleanups.push(() => nearObserver.disconnect())

  // ---------- 首屏：滑鼠滴顏料 ----------
  const hero = main.querySelector<HTMLElement>('.cur-hero')
  if (hero && !reduce) {
    let drops = 0, travel = 0, lastX = 0, lastY = 0
    const order: Pigment[] = ['mint', 'sky', 'sun', 'orange']
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || drops >= 26) return
      travel += Math.hypot(event.clientX - lastX, event.clientY - lastY)
      lastX = event.clientX; lastY = event.clientY
      const state = painted.get(hero)
      if (travel < 120 || !state) return
      travel = 0
      const r = hero.getBoundingClientRect(), random = seededRandom(900 + drops), size = 16 + random() * 26
      const x = event.clientX - r.left, y = event.clientY - r.top
      queue({ ctx: state.ctx, make: () => washPolygons(random, x, y, size, size * 0.85, 14), rgb: rgb[order[drops % 4]!], alpha: 0.04, i: 0, per: 1 })
      drops++
    }
    hero.addEventListener('pointermove', onMove, { passive: true })
    cleanups.push(() => hero.removeEventListener('pointermove', onMove))
  }

  // ---------- 版面變動：字型載入、視窗寬度、斷點 ----------
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  const refresh = (force: boolean) => {
    if (stopped) return
    syncScrollers()
    decorated.forEach((el) => enqueue(() => decorate(el)))
    for (const [section, state] of painted) {
      if (force || state.mobile !== mobileQuery.matches || Math.abs(section.clientWidth - state.width) > 2 || Math.abs(section.clientHeight - state.height) > 40) paintSection(section, false)
    }
  }
  const schedule = (force: boolean) => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh(force), 150) }
  const resizeObserver = new ResizeObserver(() => schedule(false))
  resizeObserver.observe(main)
  document.fonts?.ready.then(() => schedule(true))
  cleanups.push(() => { resizeObserver.disconnect(); clearTimeout(refreshTimer) })

  return () => {
    stopped = true
    cleanups.forEach((fn) => fn())
    timers.forEach(clearTimeout)
    objectUrls.forEach((url) => URL.revokeObjectURL(url))
  }
}
