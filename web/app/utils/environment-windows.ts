// 常春藤環境頁（/environment）2026-11-17「拱窗打開」的捲動敘事。只在瀏覽器動態載入（EnvironmentContent.vue 的 onMounted），
// 載入失敗、沒有 JS、偏好減少動態時，頁面就是 environment.css 預設的完成畫面（每扇窗都打開）。
//
// 兩個層級（各加一個 class 在 <html> 上，樣式在 environment.css）：
// - renv-fx：可以有動態（沒開減少動態）。窗捲到才打開、五顆心長成一張照片、遊樂區的窗拉開、一天五餐沿圓點小路上桌。
// - renv-pin：桌機釘住敘事（寬 ≥1100、高 ≥600，後台即時預覽不做）。首屏的拱窗打開成整幕、六個空間在同一扇窗裡變形。
//
// 守的規則：
// - 不攔截捲動：只讀捲動位置（scroll 監聽 passive）、用 requestAnimationFrame 寫 CSS 變數；釘住靠 position: sticky。
// - hydrate 前後第一個畫面一樣：桌機首屏「拱窗關著＋大標」由 CSS 媒體查詢成立，這裡只加釘住的額外高度與進度；
//   其餘「還沒打開」的狀態只套在啟動當下在視窗下方的東西（已經在畫面裡或捲過去的維持完成的樣子）。
// - 加了釘住的高度後，下面的內容會往下移：啟動時記住使用者正在看的那一塊，換完版面把捲動位置補回去。
// - 後台即時預覽的 props 會一直變：元件呼叫 refresh() 重新找元素、重量。IntersectionObserver 的 root 指定 document
//   （在 iframe 裡不指定會量到外層視窗）。
// - destroy() 全部拆乾淨：監聽、observer、計時器、<html> 上的 class、寫在元素上的 inline 樣式。

export interface EnvironmentWindows {
  /** 內容或版面變了（後台即時預覽）：重新找元素、重量、依目前的捲動位置重畫 */
  refresh: () => void
  /** 這個範圍裡的窗關上再打開（換校、換大窗的照片） */
  replay: (scope: HTMLElement) => void
  destroy: () => void
}
export interface EnvironmentWindowsOptions {
  /** false＝不做釘住的敘事（後台即時預覽）；其餘照常 */
  pin?: boolean
}

// ---------- 純函式（單元測試用） ----------
export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

/** 釘住的條件（不用範圍寫法：Safari 16.4 以前不認得） */
export const PIN_QUERY = '(min-width: 1100px) and (min-height: 600px)'
export const MOTION_QUERY = '(prefers-reduced-motion: no-preference)'
/** 換版面時找「正在看的那一塊」：頂端過了頁首線（scroll-padding）幾 px 內都算（WebKit 整數捲動的小數誤差） */
export const ANCHOR_SLACK = 4

/**
 * 首屏：標題收了多少（t，0→1）與捲動進度（w，0→1）→ 還沒打開多少（qt：標題、q：拱窗；1＝起始、0＝完成）。
 * 標題先收到上面一列，拱窗再打開：標題收到六成以前窗不動，兩者不會疊在一起；窗在進度 14%–84% 之間打開，前後各留一段。
 */
export function heroProgress(t: number, w: number): { qt: number; q: number; open: number } {
  const open = easeInOut(clamp((w - 0.14) / 0.7)) * clamp((t - 0.6) / 0.4)
  return { qt: 1 - easeInOut(clamp(t)), q: 1 - open, open }
}

/**
 * 標題從兩三行的大字收成上面一列：每一行要移到哪裡、縮多少。
 * lines＝每一行在起始畫面的位置與寬（px，相對舞台）；big／small＝起始與收好之後的字級；rowTop＝標題列的頂；room＝一列最寬（版心）。
 * 行與行之間空半個字。全部排成一列比版心寬時（後台把標題寫到三行九個字）再縮小到放得下。
 */
export function titleRow(lines: { x: number; y: number; w: number }[], big: number, small: number, rowTop: number, room: number): { scale: number; moves: { x: number; y: number }[] } {
  if (!lines.length || big <= 0) return { scale: 1, moves: [] }
  const gap = 0.5
  const natural = lines.reduce((sum, line) => sum + line.w, 0) / big + gap * (lines.length - 1)
  const size = Math.min(small, room / Math.max(natural, 0.001))
  const scale = size / big
  let cursor = 0
  const moves = lines.map((line) => {
    const move = { x: cursor - line.x, y: rowTop - line.y }
    cursor += line.w * scale + gap * size
    return move
  })
  return { scale, moves }
}

/** 幾何愛心（兩個圓＋一個轉 45° 的方塊），以 (cx, cy) 為中心、k 為大小（心寬約 k）；同 EnvironmentContent.vue 的 HEART */
export function heartPath(cx: number, cy: number, k: number): string {
  const n = (v: number) => v.toFixed(1)
  const r = n(0.293 * k)
  return `M${n(cx)} ${n(cy + 0.457 * k)}L${n(cx - 0.414 * k)} ${n(cy + 0.043 * k)}A${r} ${r} 0 0 1 ${n(cx)} ${n(cy - 0.371 * k)}A${r} ${r} 0 0 1 ${n(cx + 0.414 * k)} ${n(cy + 0.043 * k)}Z`
}

export interface HeartsGeometry { W: number; H: number; count: number; cy: number; s: number; small: number; kmax: number; yEnd: number; ny: number }
/**
 * 五顆心的尺寸：W×H＝照片窗；每顆心寬約窗寬的 15%（窄於 600px 時 16.5%），心的中心在窗高的 38%。
 * kmax＝心形窗要長到多大才蓋得住整張照片；yEnd＝蓋子最後落在照片下方多遠（名稱上面的小愛心）；ny＝名稱一開始往上移多少（在大愛心底下）。
 */
export function heartsGeometry(W: number, H: number, count = 5): HeartsGeometry {
  const narrow = W < 600
  const cy = 0.38
  const s = (narrow ? 0.165 : 0.15) * W * (5 / Math.max(count, 5))
  const small = narrow ? 24 : 30
  const kmax = ((W / (2 * count) + H * (1 - cy)) / 0.457 / s) * 1.1
  const yEnd = H + (narrow ? 32 : 42)
  const ny = cy * H + 0.517 * s + 12 - H - (narrow ? 50 : 64)
  return { W, H, count, cy, s, small, kmax, yEnd, ny }
}
/** p（0→1）時的樣子：名稱還要往上移幾成（names）、每顆蓋子的位置與大小、照片的 clip-path（完成時是 none） */
export function heartsFrame(g: HeartsGeometry, p: number): { names: number; lids: { x: number; y: number; k: number }[]; clip: string; tint: number } {
  // 名稱與愛心蓋子先一起落到照片下方（蓋子縮成小愛心停在名稱上面），心形窗再一起長大、連成整張照片
  const fall = easeOut(clamp((p - 0.02) / 0.4))
  const lids: { x: number; y: number; k: number }[] = []
  const windows: string[] = []
  for (let i = 0; i < g.count; i++) {
    const cx = ((i + 0.5) / g.count) * g.W
    lids.push({ x: cx, y: lerp(g.cy * g.H, g.yEnd, fall), k: lerp(g.s, g.small, fall) })
    const k = lerp(0.96, g.kmax, easeInOut(clamp((p - 0.1 - 0.02 * i) / 0.8)))
    windows.push(heartPath(cx, g.cy * g.H, k * g.s))
  }
  // 色片（2026-11-20）：蓋子落下去時窗裡還是那顆心的顏色，五扇窗長大相連（p≈.3）前後才褪成照片
  const tint = 1 - easeInOut(clamp((p - 0.16) / 0.3))
  return { names: 1 - fall, lids, clip: p >= 0.999 ? 'none' : `path('${windows.join('')}')`, tint }
}

/** 六個空間舞台上，窗在 w×h 裡的六種形狀：[上、右、下、左的內縮, 四個圓角]（px），依序對到 inset(… round …) */
export type StopShape = [number, number, number, number, number, number, number, number]
export function stopShapes(w: number, h: number): Record<string, StopShape> {
  const d = Math.min(w, h)
  const aw = Math.min(w, h * 0.78)
  const uw = Math.min(w, h)
  const dh = Math.min(h, w / 2)
  return {
    rect: [0, 0, 0, 0, 32, 32, 32, 32],
    circle: [(h - d) / 2, (w - d) / 2, (h - d) / 2, (w - d) / 2, d / 2, d / 2, d / 2, d / 2],
    arch: [0, (w - aw) / 2, 0, (w - aw) / 2, aw / 2, aw / 2, 22, 22],
    u: [0, (w - uw) / 2, 0, (w - uw) / 2, 22, 22, uw / 2, uw / 2],
    // 半圓貼著底（2026-11-20）：六個形狀的底邊都在同一條線上，換站時窗不會浮在半空
    dome: [h - dh, 0, 0, 0, w / 2, w / 2, 22, 22],
    leaf: [0, 0, 0, 0, Math.min(h * 0.44, w * 0.4), 32, 32, 32]
  }
}
export interface StopsFrame { clip: string; from: number; to: number; mix: number; active: number; items: { o: number; to: number; ty: number }[] }
/**
 * x＝目前在第幾站（0 到 N−1 的小數）。相鄰兩站之間：窗的形狀內插、照片交疊、前一站的文字先往上淡出、下一站的文字再從下面淡入。
 * shapes 依站的順序給。
 */
export function stopsFrame(shapes: StopShape[], x: number): StopsFrame {
  const count = shapes.length
  if (!count) return { clip: 'none', from: 0, to: 0, mix: 0, active: 0, items: [] }
  const pos = clamp(x, 0, count - 1)
  const i = Math.max(0, Math.min(count - 2, Math.floor(pos)))
  const t = count > 1 ? pos - i : 0
  const e = easeInOut(t)
  const a = shapes[i]!
  const b = shapes[Math.min(count - 1, i + 1)]!
  const v = a.map((value, k) => lerp(value, b[k]!, e).toFixed(1))
  const items = shapes.map((_, k) => {
    const o = k === i ? 1 : k === i + 1 ? e : 0
    const to = k === i ? 1 - clamp(t * 2) : k === i + 1 ? clamp(t * 2 - 1) : 0
    return { o, to, ty: (k === i ? -16 : 16) * (1 - to) }
  })
  return {
    clip: `inset(${v[0]}px ${v[1]}px ${v[2]}px ${v[3]}px round ${v[4]}px ${v[5]}px ${v[6]}px ${v[7]}px)`,
    from: i, to: Math.min(count - 1, i + 1), mix: e, active: t < 0.5 ? i : Math.min(count - 1, i + 1), items
  }
}

/** 一天五餐：p（0→1）時圓點小路亮到哪（rail）、第 i 盤上桌了多少（on） */
export function dayFrame(p: number, count: number): { rail: number; on: number[] } {
  const step = 1 / Math.max(count, 1)
  return { rail: clamp((p - 0.04) / 0.86), on: Array.from({ length: count }, (_, i) => easeOut(clamp((p - step * i) / 0.14))) }
}

// ---------- 點首屏章節連結：只在那一次跳轉暫時開平滑捲動 ----------
// 連結本身照舊是 <a href="#…">，由瀏覽器與 Vue Router 處理（歷史紀錄、hash、落點都不變）；只是在這一次跳轉期間把根元素的
// scroll-behavior 暫時改成 smooth——Nuxt 的同頁 hash 捲動用 behavior: 'auto'，會跟著根元素的 scroll-behavior 走。
// 捲完（scrollend，舊 Safari 用逾時）就拿掉，不影響換頁、還原捲動位置、頁內搜尋。偏好減少動態時不做（維持瞬間跳過去）。
// 跳轉還沒捲完就離開這一頁時，元件卸載要呼叫 endSmoothHashJump()：不然 Nuxt 換頁後捲到頁頂也會變成慢慢滑。
let endSmooth: (() => void) | null = null
export function smoothNextHashJump(): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  endSmooth?.()
  const html = document.documentElement
  html.style.scrollBehavior = 'smooth'
  let timer = 0
  let frame = 0
  const reset = () => {
    clearTimeout(timer)
    cancelAnimationFrame(frame)
    removeEventListener('scrollend', reset)
    html.style.scrollBehavior = ''
    if (endSmooth === reset) endSmooth = null
  }
  endSmooth = reset
  // 首屏釘住時要多捲一百多 vh，比一般的頁內跳轉久
  timer = window.setTimeout(reset, 2600)
  // 第一個 scrollend 會在跳轉捲完時才來（點下去當下頁面是靜止的）
  frame = requestAnimationFrame(() => addEventListener('scrollend', reset, { once: true }))
}
export function endSmoothHashJump(): void {
  endSmooth?.()
}

// ---------- 主體 ----------
interface ScrollFrame {
  tops: Map<Element, number>
  hero: number
  stops: number
}
interface Track {
  /** 這一段現在要不要跑 */
  on: () => boolean
  /** 目標值（依捲動位置） */
  calc: (frame: ScrollFrame) => number
  apply: (value: number) => void
  /** 關掉時（換模式、拆除）把寫過的樣式清掉 */
  off?: () => void
  /** 每一格往目標靠近多少（60fps 的一格）；沒給就用共用的（滑鼠 .17、觸控直接到位） */
  k?: number
  /** 只在一開始位於視窗下方時才啟動的那一段：回傳它的位置參考元素 */
  gate?: () => Element | null
  armed?: boolean
  cur: number
}

export function createEnvironmentWindows(root: HTMLElement, options: EnvironmentWindowsOptions = {}): EnvironmentWindows {
  const html = document.documentElement
  const allowPin = options.pin !== false
  const mqPin = matchMedia(PIN_QUERY)
  const mqMotion = matchMedia(MOTION_QUERY)
  const mqCoarse = matchMedia('(pointer: coarse)')
  const canClipPath = typeof CSS !== 'undefined' && CSS.supports?.('clip-path', "path('M0 0L1 0L1 1Z')")
  const $ = <T extends Element = HTMLElement>(selector: string, scope: ParentNode = root) => scope.querySelector<T>(selector)
  const $$ = <T extends Element = HTMLElement>(selector: string, scope: ParentNode = root) => [...scope.querySelectorAll<T>(selector)]

  let FX = false
  let PIN = false
  let HH = 0
  let SH = 0
  let destroyed = false

  // 元素（refresh 時重找：後台即時預覽換內容後，清單裡的元素可能是新的）
  let el = collect()
  function collect() {
    return {
      hero: $('.renv-hero'), heroStage: $('.renv-hero-stage'), heroRow: $('.renv-hero-txt'), heroIn: $('.renv-hero-txt-in'), heroTitle: $('.renv-h-title'), heroLines: $$('.renv-h-line'),
      hearts: $('.renv-hearts'), hwin: $('.renv-hwin'), hph: $('.renv-hwin-ph'), lidsSvg: $<SVGSVGElement>('.renv-hlids'), lids: $$<SVGGElement>('.renv-lid'), hnames: $('.renv-hnames'),
      feat: $('.renv-feat-win'),
      stopsSec: $('.renv-stops-sec'), stopsStage: $('.renv-stops-stage'), stopsIn: $('.renv-stops-in'), stops: $$('.renv-stop'), stopsNav: $$<HTMLButtonElement>('.renv-sn'),
      dayTl: $('.renv-day-tl'), dayItems: $$('.renv-day-i'),
      tour: $('.renv-tour')
    }
  }
  const header = document.querySelector<HTMLElement>('.header')
  let heroTravel = 1
  let stopsTravel = 1
  let isWide = false
  // style 讀取不會觸發 layout；同值不重寫（六站裡多數透明度每幀都不變）。
  function style(target: HTMLElement | null, name: string, value: string) {
    if (target && target.style.getPropertyValue(name) !== value) target.style.setProperty(name, value)
  }

  // ---------- 首屏 ----------
  const HS = { t: 0, w: 0, open: 0 }
  function heroLayout() {
    const { heroStage, heroRow, heroIn, heroTitle, heroLines } = el
    if (!PIN || !heroStage || !heroRow || !heroIn || !heroTitle || !heroLines.length) return
    const big = parseFloat(getComputedStyle(heroTitle).fontSize)
    const small = heroRow.offsetHeight / 1.3
    // 每一行的 offsetParent 是絕對定位的 .renv-hero-txt-in（offset* 不受 transform 影響，量到的是起始畫面的位置）
    const lines = heroLines.map((line) => ({ x: heroIn.offsetLeft + line.offsetLeft, y: heroIn.offsetTop + line.offsetTop, w: line.offsetWidth }))
    const { scale, moves } = titleRow(lines, big, small, heroRow.offsetTop, heroStage.clientWidth)
    heroStage.style.setProperty('--ks', scale.toFixed(4))
    heroLines.forEach((line, i) => {
      line.style.setProperty('--lx', `${moves[i]!.x.toFixed(1)}px`)
      line.style.setProperty('--ly', `${moves[i]!.y.toFixed(1)}px`)
    })
  }
  function heroRender() {
    const { qt, q, open } = heroProgress(HS.t, HS.w)
    HS.open = open
    style(el.heroStage, '--qt', qt.toFixed(4))
    style(el.heroStage, '--q', q.toFixed(4))
  }
  function heroClear() {
    HS.t = 0; HS.w = 0; HS.open = 0
    for (const name of ['--qt', '--q', '--ks']) el.heroStage?.style.removeProperty(name)
    for (const line of el.heroLines) { line.style.removeProperty('--lx'); line.style.removeProperty('--ly') }
  }
  // 一幀只量一次各段的位置；兩條首屏軌道共用進度。高度只在 layout 更新。
  // 所有 calc / gate 都讀這份快照，後面的 apply 不再穿插 layout 讀取。
  function measure(): ScrollFrame {
    const tops = new Map<Element, number>()
    for (const target of [el.hero, el.stopsSec, el.hwin, el.feat, el.dayTl]) {
      if (target) tops.set(target, target.getBoundingClientRect().top)
    }
    return {
      tops,
      hero: el.hero ? clamp((HH - tops.get(el.hero)!) / heroTravel) : 0,
      stops: el.stopsSec ? clamp((HH - tops.get(el.stopsSec)!) / stopsTravel) : 0
    }
  }

  // ---------- 五顆心 ----------
  let HG: HeartsGeometry | null = null
  function heartsLayout() {
    const { hwin, lidsSvg, hnames } = el
    if (!hwin || !lidsSvg || !hnames) return
    const rect = hwin.getBoundingClientRect()
    if (!rect.width) return
    HG = heartsGeometry(rect.width, rect.height, Math.max(1, el.lids.length))
    lidsSvg.setAttribute('viewBox', `0 0 ${rect.width.toFixed(1)} ${rect.height.toFixed(1)}`)
    lidsSvg.style.height = `${rect.height}px`
    hnames.style.setProperty('--ny', `${HG.ny.toFixed(1)}px`)
  }
  function heartsApply(p: number) {
    const { hph, hnames, lids } = el
    if (!HG || !hph || !hnames) return
    const frame = heartsFrame(HG, p)
    style(hnames, '--np', frame.names.toFixed(4))
    lids.forEach((lid, i) => {
      const at = frame.lids[i]
      if (at) lid.setAttribute('transform', `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)}) scale(${at.k.toFixed(2)})`)
    })
    style(hph, '--ht', frame.tint.toFixed(3))
    hph.style.clipPath = frame.clip
    hph.style.setProperty('-webkit-clip-path', frame.clip)
  }
  function heartsCalc(frame: ScrollFrame) {
    if (!HG || !el.hwin) return 1
    const top = frame.tops.get(el.hwin)!
    const a = HH + SH * 0.7 - HG.H * HG.cy
    const b = HH + Math.max(16, (SH - HG.H - 110) / 2)
    return clamp((a - top) / Math.max(120, a - b))
  }
  function heartsClear() {
    const { hearts, hph, hnames, lidsSvg } = el
    hearts?.classList.remove('is-armed')
    if (hph) { hph.style.clipPath = ''; hph.style.removeProperty('-webkit-clip-path'); hph.style.removeProperty('--ht') }
    hnames?.style.removeProperty('--np'); hnames?.style.removeProperty('--ny')
    if (lidsSvg) { lidsSvg.style.height = ''; lidsSvg.removeAttribute('viewBox') }
    for (const lid of el.lids) lid.removeAttribute('transform')
  }

  // ---------- 遊樂區、一天五餐：依元素在視窗裡的位置算進度 ----------
  const viewProgress = (frame: ScrollFrame, target: Element | null, from: number, to: number) => (target ? clamp((HH + SH * from - frame.tops.get(target)!) / (SH * (from - to))) : 1)
  function dayApply(p: number) {
    const frame = dayFrame(p, el.dayItems.length)
    style(el.dayTl, '--dp', frame.rail.toFixed(4))
    el.dayItems.forEach((item, i) => style(item, '--on', frame.on[i]!.toFixed(3)))
  }
  function dayClear() {
    el.dayTl?.style.removeProperty('--dp')
    for (const item of el.dayItems) item.style.removeProperty('--on')
  }

  // ---------- 六個空間的舞台 ----------
  let shapes: StopShape[] = []
  let activeStop = -1
  function stopsLayout() {
    shapes = []
    const fig = el.stops[0]?.querySelector<HTMLElement>('.renv-win')
    if (!PIN || !fig) return
    const table = stopShapes(fig.offsetWidth, fig.offsetHeight)
    shapes = el.stops.map((stop) => table[stop.dataset.sh ?? 'rect'] ?? table.rect!)
  }
  function stopsApply(x: number) {
    const { stopsIn, stops, stopsNav } = el
    if (!shapes.length || !stopsIn) return
    const frame = stopsFrame(shapes, x)
    const side = (i: number) => `var(--renv-${stops[i]?.dataset.color ?? 'terra'}-side)`
    style(stopsIn, '--clip', frame.clip)
    style(stopsIn, '--ca', side(frame.from))
    style(stopsIn, '--cb', side(frame.to))
    style(stopsIn, '--mix', frame.mix.toFixed(3))
    stops.forEach((stop, i) => {
      const item = frame.items[i]!
      style(stop, '--o', item.o.toFixed(3))
      style(stop, '--to', item.to.toFixed(3))
      style(stop, '--ty', `${item.ty.toFixed(1)}px`)
    })
    if (frame.active !== activeStop) {
      activeStop = frame.active
      stopsNav.forEach((button, i) => button.setAttribute('aria-current', String(i === activeStop)))
    }
  }
  function stopsClear() {
    activeStop = -1
    for (const name of ['--clip', '--ca', '--cb', '--mix']) el.stopsIn?.style.removeProperty(name)
    for (const stop of el.stops) for (const name of ['--o', '--to', '--ty']) stop.style.removeProperty(name)
    for (const button of el.stopsNav) button.removeAttribute('aria-current')
  }
  // 進度的小積木：捲到那一站的正中間
  function onStopsNav(event: Event) {
    const button = (event.target as Element | null)?.closest?.('.renv-sn')
    const { stopsSec, stopsStage, stopsNav, stops } = el
    if (!PIN || !button || !stopsSec || !stopsStage) return
    const index = stopsNav.indexOf(button as HTMLButtonElement)
    if (index < 0) return
    const top = stopsSec.getBoundingClientRect().top + scrollY - HH
    const travel = stopsTravel
    scrollTo({ top: top + (travel * (index + 0.5)) / Math.max(1, stops.length), behavior: 'smooth' })
  }
  root.addEventListener('click', onStopsNav)

  // ---------- 各段的進度 ----------
  /** tracks 裡五顆心那一段的位置 */
  const HEARTS = 2
  const tracks: Track[] = [
    // 標題：捲一點就自己收到上面（不會停在半路）；窗已經打開一點時維持收著
    { on: () => PIN, calc: (frame) => (frame.hero > 0.06 || HS.open > 0.02 ? 1 : 0), apply: (v) => { HS.t = v }, off: heroClear, k: 0.1, cur: 0 },
    // 拱窗：跟著捲動一路打開
    { on: () => PIN, calc: (frame) => frame.hero, apply: (v) => { HS.w = v }, cur: 0 },
    { on: () => FX && Boolean(canClipPath), gate: () => el.hwin, calc: heartsCalc, apply: heartsApply, off: heartsClear, cur: 1 },
    { on: () => FX, gate: () => el.feat, calc: (frame) => (isWide ? viewProgress(frame, el.feat, 0.8, 0.2) : viewProgress(frame, el.feat, 0.88, 0.36)), apply: (p) => style(el.feat, '--fp', easeInOut(p).toFixed(4)), off: () => el.feat?.style.removeProperty('--fp'), cur: 1 },
    // 舞台：捲過一站的距離才換站，換站的過程自己走完，不會停在兩張照片疊在一起的樣子
    { on: () => PIN && shapes.length > 0, calc: (frame) => Math.min(el.stops.length - 1, Math.floor(frame.stops * el.stops.length)), apply: stopsApply, off: stopsClear, k: 0.1, cur: 0 },
    { on: () => FX, gate: () => el.dayTl, calc: (frame) => (isWide ? viewProgress(frame, el.dayTl, 0.8, 0.3) : viewProgress(frame, el.dayTl, 0.86, 0.2)), apply: dayApply, off: dayClear, cur: 1 }
  ]
  /** 「還沒打開」只套在現在位於視窗下方的那一段；一旦啟動就一路跟著捲動（往回捲會再關上） */
  function arm(track: Track, frame: ScrollFrame): boolean {
    if (!track.gate) return true
    if (track.armed) return true
    const target = track.gate()
    if (!target || (frame.tops.get(target) ?? 0) < innerHeight) return false
    track.armed = true
    if (track === tracks[HEARTS]) el.hearts?.classList.add('is-armed')
    return true
  }
  let raf = 0
  let last = 0
  function tick(now: number) {
    raf = 0
    // 以 60fps 的一格為準換算，120Hz 的螢幕不會快一倍
    const dt = last ? Math.min(4, (now - last) / 16.67) : 1
    last = now
    let more = false
    const follow = mqCoarse.matches ? 1 : 0.17
    const frame = measure()
    const goals = tracks.map((track) => track.on() && arm(track, frame) ? track.calc(frame) : null)
    for (const [index, track] of tracks.entries()) {
      const goal = goals[index]
      if (goal === null || goal === undefined) continue
      const diff = goal - track.cur
      if (Math.abs(diff) < 0.0008) {
        if (diff) { track.cur += diff; track.apply(track.cur) }
      } else {
        const k = track.k ?? follow
        track.cur += diff * (1 - Math.pow(1 - k, dt))
        track.apply(track.cur)
        more = true
      }
    }
    if (PIN) heroRender()
    if (more) request()
    else last = 0
  }
  function request() { if (!raf && !destroyed) raf = requestAnimationFrame(tick) }
  /** 直接到位（啟動、換模式、改版面之後）：不從上一個值滑過去 */
  function snap() {
    const frame = measure()
    const goals = tracks.map((track) => track.on() && arm(track, frame) ? track.calc(frame) : null)
    for (const [index, track] of tracks.entries()) {
      const goal = goals[index]
      if (goal !== null && goal !== undefined) { track.cur = goal; track.apply(goal) }
    }
    if (PIN) heroRender()
  }

  // ---------- 門：捲到才打開（只關一開始在視窗下方的） ----------
  const onDoor: IntersectionObserverCallback = (entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.remove('is-shut')
      observer.unobserve(entry.target)
    }
  }
  const observe = (callback: IntersectionObserverCallback, init: IntersectionObserverInit): IntersectionObserver | null => {
    if (!('IntersectionObserver' in window)) return null
    // root 指定 document：掛在後台即時預覽的 iframe 裡，不指定會量到外層視窗。很舊的瀏覽器不收 document 當 root，退回預設
    try { return new IntersectionObserver(callback, { ...init, root: document }) } catch { return new IntersectionObserver(callback, init) }
  }
  const doors = observe(onDoor, { threshold: 0.28 })
  function shutDoors() {
    if (!doors) return
    for (const door of $$('.renv-door')) {
      if (door.closest('[hidden]') || (PIN && door.closest('.renv-stop'))) continue
      if (door.getBoundingClientRect().top < innerHeight) continue
      door.classList.add('is-shut')
      doors.observe(door)
    }
  }
  function openDoors(scope: ParentNode = root) {
    for (const door of $$('.renv-door.is-shut', scope)) { door.classList.remove('is-shut'); doors?.unobserve(door) }
  }

  // ---------- 五所校園：快捲到時先載入沒打開的那幾校的照片，換校時窗一打開就有照片 ----------
  const warm = observe((entries, observer) => {
    if (!entries.some((entry) => entry.isIntersecting)) return
    observer.disconnect()
    for (const img of $$<HTMLImageElement>('.renv-tour-panel[hidden] .renv-scene img')) img.loading = 'eager'
  }, { rootMargin: '600px 0px' })
  if (el.tour) warm?.observe(el.tour)

  // ---------- 版面與模式 ----------
  function layout() {
    // 每次重量都重新找元素（很便宜）：後台即時預覽換內容後，標題的行、清單裡的項目可能是新的元素
    el = collect()
    if (tracks[HEARTS]!.armed) el.hearts?.classList.add('is-armed')
    HH = header?.offsetHeight ?? 0
    SH = Math.max(1, innerHeight - HH)
    isWide = innerWidth > 900
    heroTravel = Math.max(1, (el.hero?.offsetHeight ?? 0) - (el.heroStage?.offsetHeight ?? 0))
    stopsTravel = Math.max(1, (el.stopsSec?.offsetHeight ?? 0) - (el.stopsStage?.offsetHeight ?? 0))
    heroLayout(); heartsLayout(); stopsLayout()
  }
  /** 使用者正在看的那一塊（頂端在頁首以上、最靠下的一塊）與它現在的位置：換版面後把它放回原位。
   *  判斷線多留 ANCHOR_SLACK：WebKit 的捲動位置只能是整數，章節頂端會帶著小數誤差（實測 #meals 落在 113.4、線在 113），
   *  只留 1px 時會改挑上一塊（六個空間），換回釘住版面後那一塊長高 751px，正在看的章節就被推走（2026-11-20）。
   *  每一塊都高好幾百 px，多幾 px 不會挑錯。 */
  function anchor(): { target: Element; top: number } | null {
    let found: { target: Element; top: number } | null = null
    const edge = Math.max(HH, parseFloat(getComputedStyle(html).scrollPaddingTop) || 0) + ANCHOR_SLACK
    for (const target of $$(':scope > section, .renv-stops-sec')) {
      const top = target.getBoundingClientRect().top
      if (top <= edge) found = { target, top }
    }
    return found && found.target !== el.hero ? found : null
  }
  function landedOnHash(): boolean {
    if (location.hash.length < 2) return false
    const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined
    return nav?.type !== 'reload' && nav?.type !== 'back_forward'
  }
  function restore(saved: { target: Element; top: number } | null) {
    if (!saved || !saved.target.isConnected) return
    const shift = saved.target.getBoundingClientRect().top - saved.top
    if (Math.abs(shift) > 1) scrollBy({ top: shift, behavior: 'instant' as ScrollBehavior })
  }
  let started = false
  function mode() {
    if (destroyed) return
    const fx = mqMotion.matches
    const pin = fx && allowPin && mqPin.matches
    if (started && fx === FX && pin === PIN) return
    const first = !started
    // 啟動時只有「帶著 #章節 進來」才補位置（瀏覽器已經跳到那一章，加了釘住的高度後要把它放回原位）；
    // 重新整理、上一頁的絕對位置交給 Router 等版面就緒後還原，這裡不再補一遍。
    const saved = !first || landedOnHash() ? anchor() : null
    started = true
    FX = fx; PIN = pin
    html.classList.toggle('renv-fx', FX)
    html.classList.toggle('renv-pin', PIN)
    for (const track of tracks) {
      if (!track.on()) { track.off?.(); track.armed = false }
    }
    if (!FX) openDoors()
    else if (first) shutDoors()
    if (PIN && el.stopsSec) openDoors(el.stopsSec)
    layout()
    restore(saved)
    snap()
  }
  function relayout() { if (!destroyed) { layout(); snap() } }
  let resizeFrame = 0
  const onResize = () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(relayout) }
  const onChange = () => mode()

  // 非捲動造成的尺寸變化（字型、照片、後台內容）也要更新釘住距離。
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize)
  resizeObserver?.observe(root)
  if (header) resizeObserver?.observe(header)
  const replayFrames = new Set<number>()
  function replayFrame(callback: () => void) {
    const id = requestAnimationFrame(() => { replayFrames.delete(id); if (!destroyed) callback() })
    replayFrames.add(id)
  }
  // Nuxt 在首次導航後把 history.scrollRestoration 設回 auto，Vue Router 因而不存 scroll。
  // 釘住高度要等掛載後才有：只在離開文件時，把這個 history entry 的位置留下來給 router 還原。
  function savePosition() {
    const position = { path: location.pathname + location.search + location.hash, left: scrollX, top: scrollY }
    history.replaceState({ ...history.state, environmentScroll: position }, '')
    // WebKit 整頁返回有時丟失 history.state；只備援此分頁、此 URL，不影響新進站。
    try { sessionStorage.setItem(`ivy:environment-scroll:${position.path}`, JSON.stringify(position)) } catch { /* 儲存被停用時仍用 history */ }
  }
  mode()
  addEventListener('pagehide', savePosition)
  addEventListener('beforeunload', savePosition)
  addEventListener('scroll', request, { passive: true })
  addEventListener('resize', onResize)
  addEventListener('load', relayout)
  for (const query of [mqPin, mqMotion]) query.addEventListener?.('change', onChange)
  void document.fonts?.ready.then(() => { if (!destroyed) relayout() })

  return {
    refresh() {
      // 舊元素上寫過的樣式不用管（元素還在就會被重畫蓋掉，不在了就一起消失）：重新找元素、重量、依目前的捲動位置重畫
      if (!destroyed) relayout()
    },
    replay(scope) {
      if (!FX || destroyed) return
      const targets = $$('.renv-door', scope)
      for (const door of targets) { doors?.unobserve(door); door.classList.add('is-shut') }
      replayFrame(() => replayFrame(() => { for (const door of targets) door.classList.remove('is-shut') }))
    },
    destroy() {
      destroyed = true
      cancelAnimationFrame(raf)
      cancelAnimationFrame(resizeFrame)
      for (const id of replayFrames) cancelAnimationFrame(id)
      replayFrames.clear()
      resizeObserver?.disconnect()
      removeEventListener('pagehide', savePosition)
      removeEventListener('beforeunload', savePosition)
      removeEventListener('scroll', request)
      removeEventListener('resize', onResize)
      removeEventListener('load', relayout)
      for (const query of [mqPin, mqMotion]) query.removeEventListener?.('change', onChange)
      root.removeEventListener('click', onStopsNav)
      doors?.disconnect()
      warm?.disconnect()
      html.classList.remove('renv-fx', 'renv-pin')
      for (const track of tracks) track.off?.()
      for (const door of $$('.renv-door.is-shut')) door.classList.remove('is-shut')
    }
  }
}
