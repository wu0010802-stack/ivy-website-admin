// 常春藤環境頁（/environment）的 GSAP 動態層，疊在 utils/rough-sketch.ts 的手繪線條上。
// 2026-09-28 使用者看過 design/environment-gsap-mockup-20260928/ 後同意上線（小腳印版；紅筆版只留在比稿）：
//  02 校園環境：小路改成孩子沾顏料踩出來的腳印，一步一個蓋下去；走到每一站停下、兩腳並排面向照片，
//     號碼彈一下、那張照片的便條貼上去、箭頭畫出來。腳印顏色跟著下一站照片的底紙走。
//  01 曬衣繩：捲動起風，五張照片順風擺，停下後各自晃幾下才靜止；手機橫向滑曬衣繩也會甩。
//  03 太陽：帶慣性追上捲動，光芒跟著轉，經過每一餐那顆點彈一下。
//  04 五所校園：換校時照片從校名那格一張張發到桌上。
// gsap、ScrollTrigger、MotionPathPlugin 由 EnvironmentContent.vue 動態 import 後傳進來（只有這頁載入）；
// 這支只 import 型別，上面的純函式可以直接測。減少動態：小路一次畫完、便條直接顯示，其餘三個效果不做。
import type { gsap as Gsap } from 'gsap'
import type { ScrollTrigger as ScrollTriggerStatic } from 'gsap/ScrollTrigger'
import type { MotionPathPlugin as MotionPathStatic } from 'gsap/MotionPathPlugin'
import type { SketchMotion, SketchTools } from './rough-sketch'

type Point = [number, number]
type RawPath = ReturnType<typeof MotionPathStatic.getRawPath>

const NS = 'http://www.w3.org/2000/svg'
/** 號碼中心捲到視窗這個高度時走到那一站、捲到 LEAVE 才離開（中間這段捲動拿來看照片）。 */
export const ARRIVE = 0.62
export const LEAVE = 0.46
/** 小路只在這個寬度以下改成沿左側號碼直走（與 rough-sketch 的小路同一個斷點）。 */
const NARROW = 760

/** Catmull-Rom 轉三次貝茲：曲線經過每一個點，轉彎圓順。 */
export function smoothPath(points: Point[]): string {
  const f = (n: number) => n.toFixed(1)
  let d = `M${f(points[0]![0])},${f(points[0]![1])}`
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i - 1] ?? points[i]!
    const b = points[i]!
    const c = points[i + 1]!
    const e = points[i + 2] ?? c
    d += ` C${f(b[0] + (c[0] - a[0]) / 6)},${f(b[1] + (c[1] - a[1]) / 6)} ${f(c[0] - (e[0] - b[0]) / 6)},${f(c[1] - (e[1] - b[1]) / 6)} ${f(c[0])},${f(c[1])}`
  }
  return d
}

export interface WalkAnchor { y: number; s: number }

/**
 * 捲動位置（scrollY）→ 走到小路第幾 px 的錨點表。小路頂端捲到視窗 80% 時出發；
 * 每一站號碼中心捲到 ARRIVE 時剛好走到、捲到 LEAVE 才離開；小路底端捲到視窗一半時走完。y 一定遞增。
 */
export function walkAnchors({ top, height, vh, stops, total }: { top: number; height: number; vh: number; stops: { cy: number; length: number }[]; total: number }): WalkAnchor[] {
  const anchors: WalkAnchor[] = [{ y: top - vh * 0.8, s: 0 }]
  const push = (y: number, s: number) => anchors.push({ y: Math.max(anchors.at(-1)!.y + 1, y), s })
  for (const stop of stops) {
    push(top + stop.cy - vh * ARRIVE, stop.length)
    push(top + stop.cy - vh * LEAVE, stop.length)
  }
  push(top + height - vh * 0.5, total)
  return anchors
}

/** 錨點之間線性內插；所以捲多快都不會走過頭，走的人跟著讀者停在同一站。 */
export function walkedLength(anchors: WalkAnchor[], y: number): number {
  if (!anchors.length) return 0
  if (y <= anchors[0]!.y) return anchors[0]!.s
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1]!
    const b = anchors[i]!
    if (y <= b.y) return a.s + ((y - a.y) / (b.y - a.y)) * (b.s - a.s)
  }
  return anchors.at(-1)!.s
}

/** 走路的腳印：每 stride 一步、左右輪流；站點前後 gap 內不踩（桌機留給停下來的那一對，手機留給號碼）。 */
export function footstepLengths(total: number, stride: number, stopLengths: number[], gap: number): { length: number; left: boolean }[] {
  const steps: { length: number; left: boolean }[] = []
  let left = true
  for (let length = stride * 0.6; length < total; length += stride) {
    if (stopLengths.some((stop) => Math.abs(length - stop) < gap)) continue
    steps.push({ length, left })
    left = !left
  }
  return steps
}

/** 這一步屬於第幾站（顏色跟著下一站照片的底紙）：還沒走到的第一站；最後一站之後沿用最後一站。 */
export function stepStop(length: number, stopLengths: number[]): number {
  const i = stopLengths.findIndex((stop) => length <= stop + 1)
  return i < 0 ? stopLengths.length - 1 : i
}

// 腳印形狀：左腳、腳尖朝 −y、大拇趾在 +x（內側）；前掌寬、足弓內凹、腳跟窄，全長約 24。右腳用 scale(−1,1) 鏡像。
const SOLE = 'M4.6,-3.2 C5,-7.4 -3.4,-9.2 -5.4,-4.6 C-6.4,-2 -5.6,1.6 -5,4.2 C-4.4,7.4 -3.8,11 -0.6,11 C2.6,11 3.4,7.6 2.6,4.6 C2,2.4 1,1.2 1.6,-0.6 C2.2,-2.2 4.4,-1.6 4.6,-3.2 Z'
const TOES: [number, number, number, number][] = [[3.0, -10.4, 3.8, 4.4], [0.1, -11.4, 2.5, 2.9], [-2.3, -11.0, 2.2, 2.5], [-4.3, -9.8, 1.9, 2.2], [-5.9, -8.0, 1.6, 1.9]]

export interface MotionDeps { gsap: typeof Gsap; ScrollTrigger: typeof ScrollTriggerStatic; MotionPathPlugin: typeof MotionPathStatic }

export interface EnvironmentMotion extends SketchMotion {
  /** rough-sketch 第一次畫完之後呼叫：便條先收起來、建立捲動觸發、曬衣繩起風。 */
  start: (root: HTMLElement) => void
  /** 使用者換校時呼叫：新分頁的照片從校名那格一張張發到桌上。 */
  deal: (panel: HTMLElement, tab: HTMLElement) => void
  destroy: () => void
}

interface Stop { i: number; n: HTMLElement; cx: number; cy: number; stand: Point; photoLeft: boolean; length: number; note: HTMLElement | null }
interface Print { length: number; use: SVGUseElement }

export function createEnvironmentMotion({ gsap, ScrollTrigger, MotionPathPlugin }: MotionDeps, { reducedMotion }: { reducedMotion: boolean }): EnvironmentMotion {
  gsap.registerPlugin(ScrollTrigger, MotionPathPlugin)
  // ScrollTrigger 與換校發牌收在同一個 context，離開頁面時一次還原；跟著捲動一直補的 tween（腳印、太陽、曬衣繩）
  // 不收進來（context 會一直累積），destroy 時另外 kill
  const ctx = gsap.context(() => {})
  const cleanups: (() => void)[] = []
  let started = false

  // ---------- 02 小路 ----------
  let host: HTMLElement | null = null
  let raw: RawPath | null = null
  let total = 0
  let stops: Stop[] = []
  let prints: Print[] = []
  let shown = 0
  let anchors: WalkAnchor[] = []
  const arrived = new Set<number>()
  const walker = { s: 0 }

  const at = (length: number) => MotionPathPlugin.getPositionOnPath(raw!, gsap.utils.clamp(0, 1, length / total), true) as { x: number; y: number; angle: number }
  function nearestLength([x, y]: Point) {
    let best = 0
    let dist = Infinity
    for (let l = 0; l <= total; l += 4) {
      const p = at(l)
      const d = (p.x - x) ** 2 + (p.y - y) ** 2
      if (d < dist) { dist = d; best = l }
    }
    return best
  }
  const arrowOf = (note: HTMLElement) => note.parentElement?.querySelector<SVGSVGElement>(`:scope > svg.rough[data-key="arrow-${note.dataset.seed}"]`) ?? null

  function footShape(tools: SketchTools, id: string, fill: string, edge: string, seed: number) {
    // 顏料腳丫：淺一點的填色、同色系深一階的邊（像水彩邊緣積色），不描墨線、不加紋理
    const rc = tools.rough.svg(document.createElementNS(NS, 'svg') as SVGSVGElement)
    const g = document.createElementNS(NS, 'g')
    g.id = id
    const o = { fill, fillStyle: 'solid', stroke: edge, strokeWidth: 0.7 }
    g.append(rc.path(SOLE, { ...o, roughness: 0.35, maxRandomnessOffset: 0.45, bowing: 0.3, seed }))
    TOES.forEach(([x, y, w, h], i) => g.append(rc.ellipse(x, y, w, h, { ...o, curveStepCount: 18, roughness: 0.15, maxRandomnessOffset: 0.2, seed: seed + i + 1 })))
    return g
  }

  function buildTrail(el: HTMLElement, tools: SketchTools) {
    const { svg, w, h } = tools.layer(el, 'trail', 40, true)
    const narrow = innerWidth <= NARROW
    stops = [...el.querySelectorAll<HTMLElement>('.renv-stop-no')].map((n, i) => {
      const b = tools.rel(n, el)
      const cx = b.x + b.w / 2
      const cy = b.y + b.h / 2
      const photoLeft = !narrow && i % 2 === 0
      // 桌機停在號碼靠走道那一側、面向照片；手機沿左側號碼那條線走，穿過號碼
      const stand: Point = narrow ? [cx, cy] : [cx + (photoLeft ? 42 : -42), cy]
      return { i, n, cx, cy, stand, photoLeft, length: 0, note: n.closest('.renv-stop')?.querySelector<HTMLElement>('.renv-note') ?? null }
    })
    if (!stops.length) return
    // 起點在提示字旁、終點在最後一站下方；兩站之間的中途點偏向一側，走起來像孩子邊走邊晃
    const x0 = narrow ? stops[0]!.cx : w / 2
    const points: Point[] = [[x0, narrow ? -56 : -72]]
    stops.forEach((stop, i) => {
      if (i > 0) {
        const prev = stops[i - 1]!
        const sway = narrow ? 5 : Math.min(44, w * 0.034)
        points.push([(narrow ? x0 : (prev.stand[0] + stop.stand[0]) / 2) + (i % 2 ? sway : -sway), (prev.stand[1] + stop.stand[1]) / 2])
      }
      points.push(stop.stand)
    })
    points.push([x0, h + 24])
    const probe = document.createElementNS(NS, 'path')
    probe.setAttribute('d', smoothPath(points))
    raw = MotionPathPlugin.cacheRawPathMeasurements(MotionPathPlugin.getRawPath(probe))
    total = (raw as RawPath & { totalLength: number }).totalLength
    for (const stop of stops) stop.length = nearestLength(stop.stand)

    // 每一站一組顏色（那張照片的底紙色＋深一階），各兩種筆觸輪流用；淺色在米白紙上太淡，填色取兩者中間
    const { colors } = tools
    const deep = new Map([[colors.yellow, colors.yellowDeep], [colors.sky, colors.skyDeep], [colors.leaf, colors.leafDeep], [colors.peach, colors.peachDeep]])
    const defs = document.createElementNS(NS, 'defs')
    stops.forEach((stop, i) => {
      const photo = stop.n.closest('.renv-stop')?.querySelector<HTMLElement>('.renv-stop-photo')
      const fill = photo ? tools.paperColor(photo) : colors.leaf
      const edge = deep.get(fill) ?? colors.ink
      for (const v of [0, 1]) defs.append(footShape(tools, `renv-foot-${i}-${v}`, `color-mix(in oklch, ${fill}, ${edge})`, edge, 11 + i * 7 + v * 3))
    })
    svg.append(defs)

    const stride = narrow ? 34 : 42
    const side = narrow ? 7.5 : 9.5
    const scale = narrow ? 1 : 1.15
    const stopLengths = stops.map((stop) => stop.length)
    const placed: { length: number; x: number; y: number; rot: number; left: boolean; color: number }[] = []
    for (const step of footstepLengths(total, stride, stopLengths, narrow ? 38 : 40)) {
      const p = at(step.length)
      const r = (p.angle * Math.PI) / 180
      const k = step.left ? 1 : -1
      // 前進方向 (cos, sin) 的左手邊是 (sin, −cos)（螢幕 y 朝下）：往下走時左腳在 +x
      placed.push({ length: step.length, x: p.x + Math.sin(r) * side * k, y: p.y - Math.cos(r) * side * k, rot: p.angle + 90, left: step.left, color: stepStop(step.length, stopLengths) })
    }
    if (!narrow) {
      // 每一站：兩腳並排、面向照片（到站那一刻兩隻一起出現）
      for (const stop of stops) {
        const face = stop.photoLeft ? 180 : 0
        const r = (face * Math.PI) / 180
        for (const left of [true, false]) {
          const k = left ? 1 : -1
          placed.push({ length: stop.length - (left ? 1.5 : 1), x: stop.stand[0] + Math.sin(r) * 10.5 * k, y: stop.stand[1] - Math.cos(r) * 10.5 * k, rot: face + 90, left, color: stop.i })
        }
      }
    }
    placed.sort((a, b) => a.length - b.length)
    const group = document.createElementNS(NS, 'g')
    prints = placed.map((p, i) => {
      // 腳尖微微朝外（左腳往左、右腳往右約 6°），再加一點不規則
      const turn = (p.left ? -6 : 6) + (((i * 37) % 7) - 3)
      const wrap = document.createElementNS(NS, 'g')
      wrap.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${(p.rot + turn).toFixed(1)}) scale(${p.left ? scale : -scale} ${scale})`)
      const use = document.createElementNS(NS, 'use')
      use.setAttribute('href', `#renv-foot-${p.color}-${i % 2}`)
      use.style.opacity = '0'
      wrap.append(use)
      group.append(wrap)
      return { length: p.length, use }
    })
    shown = 0
    svg.append(group)
  }

  function measure() {
    if (!host || !raw) return
    anchors = walkAnchors({
      top: host.getBoundingClientRect().top + scrollY,
      height: host.offsetHeight,
      vh: innerHeight,
      stops: stops.map((stop) => ({ cy: stop.cy, length: stop.length })),
      total
    })
  }

  function paint(instant = false) {
    const s = walker.s
    // 只處理跨過門檻的那幾個腳印：新踩的蓋下去（從稍大、透明壓到紙上），往回捲的收掉
    while (shown < prints.length && prints[shown]!.length <= s) {
      const { use } = prints[shown++]!
      if (instant) gsap.set(use, { opacity: 1, scale: 1 })
      else gsap.fromTo(use, { opacity: 0, scale: 1.35, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, duration: 0.24, ease: 'power2.in', overwrite: true })
    }
    while (shown > 0 && prints[shown - 1]!.length > s) {
      gsap.to(prints[--shown]!.use, { opacity: 0, scale: 0.7, duration: 0.2, overwrite: true })
    }
    for (const stop of stops) if (s >= stop.length - 2 && !arrived.has(stop.i)) arrive(stop, instant)
  }

  // 到站：號碼彈一下、便條貼上去、箭頭畫出來。到過就不收回，往回捲時便條不會被撕掉
  function arrive(stop: Stop, instant: boolean) {
    arrived.add(stop.i)
    const arrow = stop.note ? arrowOf(stop.note) : null
    const targets = [stop.note, arrow].filter((t): t is HTMLElement | SVGSVGElement => !!t)
    if (instant || reducedMotion) { gsap.set(targets, { autoAlpha: 1, '--renv-pop': 1 }); return }
    gsap.fromTo(stop.n, { '--renv-pop': 1 }, { keyframes: [{ '--renv-pop': 1.32, duration: 0.16, ease: 'power2.out' }, { '--renv-pop': 1, duration: 0.9, ease: 'elastic.out(1.2, 0.35)' }] })
    if (!stop.note) return
    const tl = gsap.timeline({ delay: 0.15 })
    tl.fromTo(stop.note, { autoAlpha: 0, '--renv-pop': 0.55 }, { autoAlpha: 1, '--renv-pop': 1, duration: 0.55, ease: 'back.out(2.4)' })
    if (arrow) {
      tl.set(arrow, { autoAlpha: 1 }, 0.1)
      for (const path of arrow.querySelectorAll('path')) {
        const len = path.getTotalLength()
        path.style.transition = 'none'
        tl.fromTo(path, { strokeDasharray: `${len} ${len}`, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 0.6, ease: 'power2.out' }, 0.15)
      }
    }
  }

  const walkTo = (s: number) => gsap.to(walker, { s, duration: 0.7, ease: 'power3.out', overwrite: true, onUpdate: () => paint() })

  // ---------- 03 太陽 ----------
  const sun = { p: 0 }

  // ---------- 01 曬衣繩起風 ----------
  const swingState: { a: number }[] = []
  function setupWind(root: HTMLElement) {
    const hang = root.querySelector<HTMLElement>('.renv-hang')
    const items = [...root.querySelectorAll<HTMLElement>('.renv-hang-item')]
    if (!hang || !items.length) return
    // 每張「重量」不同：擺幅與回彈的阻尼略有差異，五張不同步
    const swings = items.map((el, i) => ({ el, a: 0, amp: [1, 0.78, 1.14, 0.9, 1.05][i % 5]!, damp: [0.3, 0.26, 0.34, 0.28, 0.32][i % 5]! }))
    swingState.push(...swings)
    const write = (s: { el: HTMLElement; a: number }) => s.el.style.setProperty('--renv-swing', `${s.a.toFixed(2)}deg`)
    const push = (velocity: number) => {
      const target = gsap.utils.clamp(-7, 7, velocity / 320)
      for (const s of swings) gsap.to(s, { a: target * s.amp, duration: 0.5, ease: 'power2.out', overwrite: true, onUpdate: () => write(s) })
    }
    const settle = () => swings.forEach((s, i) => gsap.to(s, { a: 0, duration: 2 + i * 0.12, delay: i * 0.05, ease: `elastic.out(1, ${s.damp})`, overwrite: true, onUpdate: () => write(s) }))
    ctx.add(() => { ScrollTrigger.create({ trigger: hang, start: 'top bottom', end: 'bottom top', onUpdate: (self) => push(self.getVelocity()) }) })
    ScrollTrigger.addEventListener('scrollEnd', settle)
    cleanups.push(() => ScrollTrigger.removeEventListener('scrollEnd', settle))
    // 手機的曬衣繩是橫向滑動：往左滑，照片往右甩
    let lastX = hang.scrollLeft
    let lastT = performance.now()
    let idle = 0
    const onSwipe = () => {
      const now = performance.now()
      push(-((hang.scrollLeft - lastX) / Math.max(8, now - lastT)) * 800)
      lastX = hang.scrollLeft
      lastT = now
      clearTimeout(idle)
      idle = window.setTimeout(settle, 140)
    }
    hang.addEventListener('scroll', onSwipe, { passive: true })
    cleanups.push(() => { hang.removeEventListener('scroll', onSwipe); clearTimeout(idle) })
    root.classList.add('is-windy')
  }

  return {
    trail(el, tools) {
      host = el
      buildTrail(el, tools)
      measure()
      if (reducedMotion) {
        walker.s = total
        for (const { use } of prints) use.style.opacity = '1'
        shown = prints.length
      } else if (started) {
        paint(true)
      }
    },
    sun(p, place) {
      if (reducedMotion) { place(p); return }
      // 每次捲動都會補一段，不收進 context（會一直累積）；離開頁面時 destroy 統一 kill
      gsap.to(sun, {
        p,
        duration: 0.9,
        ease: 'power3.out',
        overwrite: true,
        onUpdate: () => {
          for (const dot of place(sun.p, sun.p * 150)) gsap.fromTo(dot, { scale: 0.3, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.7, ease: 'back.out(3.2)' })
        }
      })
    },
    owns(el) {
      // 小路上的便條等走到那一站才貼上，由這裡負責進場
      return !reducedMotion && el.matches('.renv-trail .renv-note')
    },
    start(root) {
      started = true
      if (reducedMotion) return
      setupWind(root)
      if (!host) return
      for (const stop of stops) {
        if (!stop.note || arrived.has(stop.i)) continue
        gsap.set([stop.note, arrowOf(stop.note)].filter(Boolean), { autoAlpha: 0 })
      }
      const trailHost = host
      ctx.add(() => {
        ScrollTrigger.create({
          trigger: trailHost,
          start: 'top bottom',
          end: 'bottom top',
          onRefresh: () => { measure(); walkTo(walkedLength(anchors, scrollY)) },
          onUpdate: (self) => walkTo(walkedLength(anchors, self.scroll()))
        })
      })
      walker.s = walkedLength(anchors, scrollY)
      paint(true)
    },
    deal(panel, tab) {
      if (reducedMotion || !started) return
      const scenes = [...panel.querySelectorAll<HTMLElement>('.renv-scene')]
      const more = panel.querySelector<HTMLElement>('.renv-link')
      const from = (tab.querySelector('img') ?? tab).getBoundingClientRect()
      const fx = from.left + from.width / 2
      const fy = from.top + from.height / 2
      gsap.killTweensOf([...scenes, more].filter(Boolean))
      ctx.add(() => {
        scenes.forEach((li, i) => {
          const r = li.getBoundingClientRect()
          gsap.fromTo(li,
            { x: fx - (r.left + r.width / 2), y: fy - (r.top + r.height / 2), scale: 0.16, rotation: i % 2 ? 18 : -15, autoAlpha: 0 },
            { x: 0, y: 0, scale: 1, rotation: 0, autoAlpha: 1, duration: 0.85, delay: i * 0.11, ease: 'back.out(1.1)', clearProps: 'transform,opacity,visibility' })
        })
        if (more) gsap.fromTo(more, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.4, delay: scenes.length * 0.11 + 0.5, clearProps: 'transform,opacity,visibility' })
      })
    },
    destroy() {
      cleanups.forEach((fn) => fn())
      ctx.revert()
      gsap.killTweensOf([walker, sun, ...swingState, ...prints.map((p) => p.use)])
    }
  }
}
