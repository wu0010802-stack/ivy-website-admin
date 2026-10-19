// 常春藤環境頁（/environment）的蠟筆塗鴉層，疊在 utils/rough-sketch.ts 的手繪線條上。
// 2026-10-19 使用者看過 design/environment-playful-directions-20261019/ 四個方向後選 A「蠟筆塗鴉」：
// 老師的聯絡簿被孩子拿去，用蠟筆在空白處畫了東西。捲到哪裡就一筆一筆畫出來，點一下會動一下。
//  首屏：角落太陽（躲在照片後面）／01 曬衣繩上的小鳥（捲得快時跳一下）／02 遊樂區的彩虹、戶外廣場的風箏、
//  洗手台的泡泡、可愛動物區抱紅蘿蔔的兔子／03 香蕉與蘋果（每日兩蔬果）／04 選到的學校把校舍塗上顏色／結尾的手印。
// 位置都在 EnvironmentContent.vue 的模板裡（空的 [data-doodle]，aria-hidden，CSS 定位）；這支只負責畫和動。
// 塗鴉是可有可無的裝飾：不可聚焦、只回應滑鼠與觸控；沒有 JS 時是空的。減少動態：直接畫好、不動。
// 線條都是固定種子算出來的（下面的純函式可以直接測）；顏色只給名字，實際色票在 environment.css 的 --renv-crayon-*。
import { clotheslineY } from './rough-sketch'

type Point = [number, number]
export type DoodleColor = 'red' | 'orange' | 'yellow' | 'gold' | 'green' | 'sky' | 'blue' | 'pink' | 'lilac' | 'gray' | 'brown' | 'leaf' | 'peach' | 'note' | 'ink' | 'string'
/** w 有值是蠟筆線（會一筆一筆畫出來）；沒有是塗滿的小色塊（眼睛、打底）。clip 給了就只畫在這個形狀裡（塗色）。 */
export interface DoodleMark { d: string; c: DoodleColor; w?: number; clip?: string; part?: string }
export interface DoodleArt { w: number; h: number; marks: DoodleMark[] }
export type DoodleName = 'sun' | 'bird' | 'rainbow' | 'kite' | 'bubbles' | 'bunny' | 'banana' | 'apple' | 'hand'

const NS = 'http://www.w3.org/2000/svg'
const f = (n: number) => Math.round(n * 10) / 10
const rad = (deg: number) => (deg * Math.PI) / 180

/** 固定種子的亂數（mulberry32）：同一個種子每次畫出一樣的線。 */
export function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Catmull-Rom 轉三次貝茲；closed 時頭尾接起來。 */
export function smooth(points: Point[], closed = false): string {
  const P = closed ? [points.at(-1)!, ...points, points[0]!, points[1]!] : [points[0]!, ...points, points.at(-1)!]
  let d = `M${f(P[1]![0])},${f(P[1]![1])}`
  for (let i = 1; i < P.length - 2; i++) {
    const [a, b, c, e] = [P[i - 1]!, P[i]!, P[i + 1]!, P[i + 2]!]
    d += `C${f(b[0] + (c[0] - a[0]) / 6)},${f(b[1] + (c[1] - a[1]) / 6)} ${f(c[0] - (e[0] - b[0]) / 6)},${f(c[1] - (e[1] - b[1]) / 6)} ${f(c[0])},${f(c[1])}`
  }
  return closed ? `${d}Z` : d
}

const polyline = (points: Point[]) => `M${points.map(([x, y]) => `${f(x)},${f(y)}`).join('L')}`

/** 橢圓（給 clip 用的乾淨形狀）。 */
export function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0): string {
  const points: Point[] = []
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry
    points.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)])
  }
  return smooth(points, true)
}

/** 小孩畫的圈：繞超過一圈、半徑抖一點、頭尾沒接好。 */
export function kidLoop(cx: number, cy: number, rx: number, ry: number, rnd: () => number, { turns = 1.08, amp = 0.07, rot = 0 } = {}): string {
  const n = 16, points: Point[] = []
  for (let i = 0; i <= Math.round(n * turns); i++) {
    const a = -2 + (i / n) * Math.PI * 2, k = 1 + (rnd() - 0.5) * amp * 2
    const x = Math.cos(a) * rx * k, y = Math.sin(a) * ry * k
    points.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)])
  }
  return smooth(points)
}

/** 來回塗滿一個方框：旋轉後的鋸齒線，要配 clip 剪成形狀（剪的形狀比線稿大一點，就像塗出界）。 */
export function scribble(x: number, y: number, w: number, h: number, rnd: () => number, { angle = -0.6, gap = 5 } = {}): string {
  const cx = x + w / 2, cy = y + h / 2, D = Math.hypot(w, h) / 2 + 3
  const ca = Math.cos(angle), sa = Math.sin(angle), points: Point[] = []
  for (let u = -D, i = 0; u <= D; u += gap, i++) {
    const v = (i % 2 ? 1 : -1) * D * (0.92 + rnd() * 0.08), ju = u + (rnd() - 0.5) * gap * 0.6
    points.push([cx + ju * ca - v * sa, cy + ju * sa + v * ca])
  }
  return polyline(points)
}

const jiggle = (points: Point[], rnd: () => number, amount = 1.4): Point[] => points.map(([x, y]) => [x + (rnd() - 0.5) * amount, y + (rnd() - 0.5) * amount])
const fillIn = (shape: string, box: [number, number, number, number], c: DoodleColor, rnd: () => number, angle: number, gap: number, part?: string): DoodleMark =>
  ({ d: scribble(...box, rnd, { angle, gap }), c, w: gap * 1.25, clip: shape, part })

// ---------- 九張塗鴉（座標是各自 viewBox 的單位） ----------
const ART: Record<DoodleName, () => DoodleArt> = {
  // 小孩畫圖必有的「角落太陽」：圓心在右上角，只露出左下四分之一
  sun() {
    const rnd = seeded(3), marks: DoodleMark[] = []
    marks.push(fillIn('M200,0 L84,0 A116,116 0 0 0 200,116 Z', [76, 0, 124, 124], 'yellow', rnd, -0.9, 6.5))
    const arc: Point[] = []
    for (let a = 184; a >= 84; a -= 8) { const r = 102 + (rnd() - 0.5) * 6; arc.push([200 + Math.cos(rad(a)) * r, Math.sin(rad(a)) * r]) }
    marks.push({ d: smooth(arc), c: 'orange', w: 5 })
    ;[104, 122, 140, 158, 175].forEach((a, i) => {
      const r1 = 120 + rnd() * 6, r2 = 150 + rnd() * 26, bend = (rnd() - 0.5) * 8, m = (r1 + r2) / 2
      marks.push({ d: `M${f(200 + Math.cos(rad(a)) * r1)},${f(Math.sin(rad(a)) * r1)} Q${f(200 + Math.cos(rad(a)) * m + bend)},${f(Math.sin(rad(a)) * m - bend)} ${f(200 + Math.cos(rad(a)) * r2)},${f(Math.sin(rad(a)) * r2)}`, c: i % 2 ? 'yellow' : 'orange', w: 5.5, part: 'rays' })
    })
    return { w: 200, h: 200, marks }
  },
  // 站在曬衣繩上的小鳥；腳踩在 y＝60
  bird() {
    const rnd = seeded(8)
    return {
      w: 70, h: 64,
      marks: [
        fillIn(`${ellipse(30, 38, 19, 14, -0.12)} ${ellipse(48, 24, 10.5, 10)}`, [8, 10, 54, 46], 'sky', rnd, -0.5, 4.6),
        { d: kidLoop(30, 38, 19, 14, rnd, { rot: -0.12 }), c: 'blue', w: 3.4 },
        { d: kidLoop(48, 24, 10.5, 10, rnd), c: 'blue', w: 3.4 },
        { d: 'M20,37 Q30,48 41,36', c: 'blue', w: 3 },
        { d: 'M12,34 L2,27 M12,38 L1,37 M13,42 L4,47', c: 'blue', w: 3 },
        { d: 'M57.5,21 L67,24.5 L57.5,28', c: 'orange', w: 3.4 },
        { d: 'M27,51 L26,60 M34,51 L35,60 M21,60.5 L30,60 M31,60 L40,60.5', c: 'orange', w: 3 },
        { d: ellipse(50.5, 21.5, 2, 2), c: 'ink' }
      ]
    }
  },
  // 彩虹＋兩端的雲
  rainbow() {
    const rnd = seeded(21), marks: DoodleMark[] = []
    const bands: DoodleColor[] = ['red', 'yellow', 'green', 'blue']
    ;[128, 112, 96, 80].forEach((r, i) => {
      const points: Point[] = []
      for (let a = 188; a >= -8; a -= 12) { const k = r + (rnd() - 0.5) * 4; points.push([150 + Math.cos(rad(a)) * k, 160 - Math.sin(rad(a)) * k]) }
      marks.push({ d: smooth(points), c: bands[i]!, w: 14 })
    })
    for (const cx of [32, 268]) {
      const points: Point[] = []
      for (let i = 0; i <= 26; i++) { const a = Math.PI + (i / 26) * Math.PI * 2.05, bump = 1 + 0.22 * Math.abs(Math.sin(a * 2.5)); points.push([cx + Math.cos(a) * 30 * bump, 150 + Math.sin(a) * 15 * bump]) }
      marks.push({ d: ellipse(cx, 150, 34, 17), c: 'note' }, { d: smooth(points), c: 'blue', w: 3.4 })
    }
    return { w: 300, h: 170, marks }
  },
  // 戶外廣場上空的風箏；線從風箏中心拉到左下角（貼在照片上緣）
  kite() {
    const rnd = seeded(26), marks: DoodleMark[] = []
    const T: Point = [62, 6], R: Point = [96, 38], B: Point = [62, 80], L: Point = [28, 38], C: Point = [62, 38]
    marks.push({ d: 'M62,38 Q30,96 8,150', c: 'string', w: 1.6 })
    const quarters: [Point, Point, DoodleColor][] = [[T, R, 'yellow'], [R, B, 'green'], [B, L, 'sky'], [L, T, 'red']]
    quarters.forEach(([a, b, c], i) => {
      const xs = [a[0], b[0], C[0]], ys = [a[1], b[1], C[1]]
      marks.push(fillIn(polyline([C, a, b]) + 'Z', [Math.min(...xs) - 2, Math.min(...ys) - 2, 40, 46], c, seeded(27 + i), 0.5 + rnd() * 0.6, 3.6))
    })
    marks.push({ d: polyline(jiggle([T, R, B, L, T], rnd)), c: 'red', w: 3.2 }, { d: polyline([T, B]) + polyline([L, R]), c: 'brown', w: 2.2 })
    const tail: Point[] = Array.from({ length: 11 }, (_, i) => [62 + Math.sin(i * 1.1) * 9, 80 + i * 6.4])
    marks.push({ d: smooth(tail), c: 'blue', w: 2.6 })
    ;[2, 5, 8].forEach((i) => {
      const [x, y] = tail[i]!
      marks.push({ d: `M${f(x - 7)},${f(y - 4)}L${f(x + 7)},${f(y + 4)}L${f(x + 7)},${f(y - 4)}L${f(x - 7)},${f(y + 4)}Z`, c: i === 5 ? 'orange' : 'pink', w: 2.6 })
    })
    return { w: 120, h: 150, marks }
  },
  // 洗手台冒出來的泡泡；每顆是一個 part，點了各自破掉
  bubbles() {
    const spec: [number, number, number][] = [[30, 108, 13], [60, 84, 9], [44, 56, 15], [86, 50, 8], [74, 18, 12], [108, 34, 7]]
    const marks = spec.flatMap(([cx, cy, r], i): DoodleMark[] => [
      { d: kidLoop(cx, cy, r, r, seeded(140 + i), { turns: 1.05, amp: 0.05 }), c: i % 2 ? 'lilac' : 'sky', w: 2.6, part: `bubble-${i}` },
      { d: `M${f(cx - r * 0.55)},${f(cy - r * 0.2)} Q${f(cx - r * 0.5)},${f(cy - r * 0.6)} ${f(cx - r * 0.15)},${f(cy - r * 0.62)}`, c: 'note', w: 2.2, part: `bubble-${i}` }
    ])
    return { w: 150, h: 130, marks }
  },
  // 可愛動物區照片上緣坐著抱紅蘿蔔的兔子（照片裡孩子正在餵兔子吃紅蘿蔔）；腳踩在 y≈115
  bunny() {
    const rnd = seeded(31)
    return {
      w: 110, h: 122,
      marks: [
        fillIn(`${ellipse(41, 26, 3.8, 14, -0.22)} ${ellipse(60, 24, 3.8, 15, 0.2)}`, [32, 6, 38, 38], 'pink', rnd, 1.2, 3.2, 'ears'),
        { d: kidLoop(41, 24, 8, 21, rnd, { rot: -0.22 }), c: 'gray', w: 3.2, part: 'ears' },
        { d: kidLoop(60, 22, 8, 22, rnd, { rot: 0.2 }), c: 'gray', w: 3.2, part: 'ears' },
        { d: kidLoop(50, 86, 23, 22, rnd), c: 'gray', w: 3.2 },
        { d: kidLoop(51, 54, 19, 17, rnd), c: 'gray', w: 3.2 },
        { d: 'M69,57 L81,54 M69,61 L81,62 M33,57 L21,54 M33,61 L21,62', c: 'gray', w: 1.8 },
        { d: kidLoop(39, 110, 9, 5, rnd, { turns: 1 }), c: 'gray', w: 3 },
        { d: kidLoop(62, 110, 9, 5, rnd, { turns: 1 }), c: 'gray', w: 3 },
        fillIn('M66,76 L88,84 L60,108 Z', [56, 72, 34, 38], 'orange', rnd, 0.6, 3.2),
        { d: 'M66,76 L88,84 L60,108 Z', c: 'orange', w: 3 },
        { d: 'M70,86 L75,88 M66,93 L71,95', c: 'brown', w: 1.8 },
        { d: 'M80,80 L84,66 M80,80 L94,72 M80,80 L90,68', c: 'green', w: 3 },
        { d: 'M33,82 Q46,96 64,90 M70,98 Q80,96 82,90', c: 'gray', w: 3 },
        { d: ellipse(45, 51, 2, 2), c: 'ink' },
        { d: ellipse(57, 51, 2, 2), c: 'ink' },
        { d: 'M48.5,57 L53.5,57 L51,60.5 Z', c: 'pink' }
      ]
    }
  },
  // 03 每日兩蔬果之一。黃色紙上塗黃色看不見：先用米白蠟筆打底再塗黃
  banana() {
    const rnd = seeded(41), shape = 'M5,12 C7,40 48,50 60,9 C53,28 22,32 5,12 Z'
    return {
      w: 64, h: 52,
      marks: [
        { d: shape, c: 'note' },
        fillIn(shape, [4, 8, 58, 40], 'gold', rnd, 0.25, 3.6),
        { d: 'M5,12 C7,40 48,50 60,9 C53,28 22,33 4,13', c: 'brown', w: 3.2 },
        { d: 'M13,21 C24,33 42,34 54,21', c: 'brown', w: 1.6 },
        { d: 'M60,9 L63,3', c: 'brown', w: 3.6 }
      ]
    }
  },
  // 03 每日兩蔬果之二
  apple() {
    const rnd = seeded(43), shape = 'M30,18 C22,11 6,14 7,30 C8,44 20,50 30,45 C40,50 52,44 53,30 C54,14 38,11 30,18 Z'
    return {
      w: 64, h: 52,
      marks: [
        fillIn(shape, [6, 12, 48, 38], 'red', rnd, -0.7, 4),
        { d: 'M30,18 C22,11 6,14 7,30 C8,44 20,50 30,45 C40,50 52,44 53,30 C54,14 37,10 29,17', c: 'red', w: 3 },
        { d: 'M30,18 Q30,11 34,6', c: 'brown', w: 3 },
        { d: kidLoop(42, 10, 7, 3.4, rnd, { rot: -0.4, turns: 1 }), c: 'green', w: 3 }
      ]
    }
  },
  // 結尾：描出來的手印，手心畫一顆愛心
  hand() {
    const rnd = seeded(71)
    const outline: Point[] = [[30, 112], [27, 92], [22, 80], [12, 64], [5, 54], [6, 47], [12, 46], [20, 54], [27, 62], [28, 44], [26, 26], [27, 17], [33, 14], [38, 19], [40, 36], [42, 50], [43, 30], [44, 12], [49, 6], [55, 9], [57, 28], [57, 49], [60, 32], [63, 18], [69, 15], [73, 21], [72, 38], [71, 54], [75, 44], [80, 36], [86, 36], [88, 43], [83, 58], [80, 72], [78, 90], [74, 112]]
    const heart = 'M50,86 C40,80 37,74 39,69 C41,64 47,64 50,69 C53,64 59,64 61,69 C63,74 60,80 50,86 Z'
    return {
      w: 100, h: 116,
      marks: [
        { d: smooth(jiggle(outline, rnd, 1.6)), c: 'green', w: 3.8 },
        fillIn(heart, [36, 62, 28, 26], 'pink', rnd, -0.6, 3.2),
        { d: heart, c: 'red', w: 2.6 }
      ]
    }
  }
}

export function doodleArt(name: DoodleName): DoodleArt {
  return ART[name]()
}
export const DOODLE_NAMES = Object.keys(ART) as DoodleName[]

// ---------- 04 五所校園：校舍塗色 ----------
// 遮罩是照校舍線稿算出來的輪廓（scripts/environment-tour-paint.py → /assets/tour-paint-<校>.png 與 -roof.png），
// 牆一色、屋頂沿建築上緣另一色。選中時底卡是黃（義華、仁武）、藍（明華）、綠（崇德）、桃（國際），塗色避開同色。
export const TOUR_PAINT: Record<string, [wall: DoodleColor, roof: DoodleColor]> = {
  yihua: ['sky', 'red'],
  minghua: ['peach', 'blue'],
  chongde: ['pink', 'orange'],
  international: ['leaf', 'red'],
  renwu: ['lilac', 'orange']
}
export const tourPaintSrc = (key: string, part: '' | '-roof') => `/assets/tour-paint-${key}${part}.png`

/** 小鳥站在曬衣繩的哪裡：桌機第 2、3 張照片之間，手機（橫滑）第 1、2 張之間；回傳軌道內的 x 與繩子在那裡的高度。 */
export function birdPerch(width: number, items: { left: number; width: number }[], wide: boolean): { x: number; y: number } | null {
  const i = wide ? 1 : 0
  const a = items[i], b = items[i + 1]
  if (!a || !b) return null
  const x = (a.left + a.width + b.left) / 2
  return { x, y: clotheslineY(x, width) }
}

// ---------- 掛到頁面上 ----------
export interface EnvironmentDoodles {
  /** 版面改了之後（後台即時預覽換內容、手繪層重畫完）：小鳥踩回曬衣繩、選中的學校補塗色。 */
  refresh: () => void
  destroy: () => void
}

let uid = 0

function render(art: DoodleArt) {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${art.w} ${art.h}`)
  svg.setAttribute('class', 'renv-doodle-art')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const defs = document.createElementNS(NS, 'defs')
  const crayon = document.createElementNS(NS, 'g')
  crayon.setAttribute('filter', 'url(#renv-crayon)')
  svg.append(defs, crayon)
  const parts = new Map<string, SVGGElement>()
  const lines: SVGPathElement[] = []
  const solids: SVGPathElement[] = []
  for (const mark of art.marks) {
    let target: SVGGElement = crayon
    if (mark.part) {
      if (!parts.has(mark.part)) { const g = document.createElementNS(NS, 'g'); g.dataset.part = mark.part; crayon.append(g); parts.set(mark.part, g) }
      target = parts.get(mark.part)!
    }
    const path = document.createElementNS(NS, 'path')
    path.setAttribute('d', mark.d)
    path.setAttribute('class', `is-${mark.c} ${mark.w ? 'is-line' : 'is-solid'}`)
    if (mark.w) path.setAttribute('stroke-width', String(mark.w))
    if (mark.clip) {
      const id = `renv-doodle-${++uid}`
      const clip = document.createElementNS(NS, 'clipPath')
      clip.id = id
      const shape = document.createElementNS(NS, 'path')
      shape.setAttribute('d', mark.clip)
      clip.append(shape)
      defs.append(clip)
      path.setAttribute('clip-path', `url(#${id})`)
    }
    target.append(path)
    ;(mark.w ? lines : solids).push(path)
  }
  return { svg, lines, solids, parts }
}

const CRAYON_FILTER = `
  <filter id="renv-crayon" x="-15%" y="-15%" width="130%" height="130%">
    <feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="7" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G" result="w"/>
    <feTurbulence type="fractalNoise" baseFrequency="1.35" numOctaves="1" seed="3" result="g"/>
    <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.6 0 0 0 2.05" result="ga"/>
    <feComposite in="w" in2="ga" operator="in"/>
  </filter>`

export function createEnvironmentDoodles(root: HTMLElement, { reducedMotion }: { reducedMotion: boolean }): EnvironmentDoodles {
  const cleanups: (() => void)[] = []
  const ease = 'cubic-bezier(.22,1,.36,1)'
  // 蠟筆紋：紙紋雜訊當遮罩（蠟跳過紙的凹處）＋低頻雜訊手抖；整頁共用一個。用 DOM 建，不寫進 Vue 模板（vue-tsc 會比對 SVG 屬性型別出錯）
  const defs = document.createElementNS(NS, 'svg')
  defs.setAttribute('class', 'renv-doodle-defs')
  defs.setAttribute('aria-hidden', 'true')
  defs.innerHTML = CRAYON_FILTER
  root.append(defs)
  cleanups.push(() => defs.remove())

  /** 一筆一筆畫出來：照長度分配時間。減少動態或已經畫過就直接顯示。 */
  const drawOn = (lines: SVGPathElement[], solids: SVGPathElement[], total: number, delay = 0) => {
    if (reducedMotion) return
    const lengths = lines.map((p) => p.getTotalLength?.() || 60)
    const sum = lengths.reduce((a, b) => a + b, 0) || 1
    let t = delay
    solids.forEach((p) => p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay, fill: 'backwards' }))
    lines.forEach((p, i) => {
      p.setAttribute('pathLength', '1')
      const d = Math.max(90, (total * lengths[i]!) / sum)
      p.animate([{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }], { duration: d, delay: t, easing: 'cubic-bezier(.35,.4,.45,1)', fill: 'backwards' })
      t += d * 0.9
    })
  }
  const poke = (spot: HTMLElement, fn: () => void) => {
    spot.classList.add('is-poke')
    spot.addEventListener('click', fn)
    cleanups.push(() => { spot.removeEventListener('click', fn); spot.classList.remove('is-poke') })
  }
  const seen = (target: Element, fn: () => void, margin = '0px 0px -12% 0px') => {
    if (typeof IntersectionObserver === 'undefined') { fn(); return }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn() } }, { rootMargin: margin })
    io.observe(target)
    cleanups.push(() => io.disconnect())
  }
  const whileSeen = (target: Element, on: () => void, off: () => void) => {
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => entries.forEach((e) => (e.isIntersecting ? on() : off())))
    io.observe(target)
    cleanups.push(() => io.disconnect())
  }

  const TOTAL: Partial<Record<DoodleName, number>> = { sun: 1500, rainbow: 1400, kite: 1700, bubbles: 1300, bunny: 1600, hand: 1300, banana: 800, apple: 800 }
  const spots = [...root.querySelectorAll<HTMLElement>('[data-doodle]')].filter((spot) => spot.dataset.doodle! in ART)
  const drawn = new Map<HTMLElement, ReturnType<typeof render>>()
  const draw = (spot: HTMLElement) => {
    const name = spot.dataset.doodle as DoodleName
    const art = render(doodleArt(name))
    spot.replaceChildren(art.svg)
    drawn.set(spot, art)
    drawOn(art.lines, art.solids, TOTAL[name] ?? 1100, name === 'sun' ? 400 : 0)
    return art
  }

  // 小鳥：放在曬衣繩上（.renv-hang 裡、軌道外，曬衣繩的 <ol> 只能放 li，手繪層也會數 li）
  const placeBird = (spot: HTMLElement) => {
    const track = spot.parentElement?.querySelector<HTMLElement>('.renv-hang-track')
    if (!track) return
    const items = [...track.querySelectorAll<HTMLElement>(':scope > li')].map((li) => ({ left: li.offsetLeft, width: li.offsetWidth }))
    const perch = birdPerch(track.offsetWidth, items, innerWidth > 900)
    if (!perch) return
    // 腳在 viewBox 70×64 的 y＝60
    const w = spot.offsetWidth || 80
    spot.style.left = `${f(track.offsetLeft + perch.x - w / 2)}px`
    spot.style.top = `${f(track.offsetTop + perch.y - (w * 60) / 70 + 1)}px`
  }

  const hop = (spot: HTMLElement, height: number) => spot.animate([{ translate: '0 0' }, { translate: `0 -${height}px`, offset: 0.45 }, { translate: '0 0' }], { duration: 520, easing: 'cubic-bezier(.3,.7,.4,1)' })
  const behaviours: Partial<Record<DoodleName, (spot: HTMLElement, art: ReturnType<typeof render>) => void>> = {
    sun: (spot, art) => poke(spot, () => { const rays = art.parts.get('rays'); if (rays) drawOn([...rays.querySelectorAll('path')], [], 600) }),
    bird(spot, art) {
      let flipped = false, busy = false
      const jump = (h: number) => { if (reducedMotion || busy) return; busy = true; hop(spot, h).finished.then(() => { busy = false }, () => { busy = false }) }
      poke(spot, () => {
        flipped = !flipped
        art.svg.style.transform = flipped ? 'scaleX(-1)' : ''
        jump(22)
      })
      if (reducedMotion) return
      // 跟頁面原本的「曬衣繩起風」一起：捲得快時跳一小下，一陣風只跳一次
      let visible = false, calm = true, lastY = scrollY, lastT = performance.now()
      whileSeen(spot, () => { visible = true; lastY = scrollY }, () => { visible = false })
      const onScroll = () => {
        if (!visible) return
        const now = performance.now(), v = (Math.abs(scrollY - lastY) / Math.max(16, now - lastT)) * 16
        lastY = scrollY; lastT = now
        if (calm && v > 26) { calm = false; jump(12) }
        if (v < 6) calm = true
      }
      addEventListener('scroll', onScroll, { passive: true })
      cleanups.push(() => removeEventListener('scroll', onScroll))
    },
    rainbow: (spot, art) => poke(spot, () => drawOn(art.lines.filter((p) => p.classList.contains('is-line') && Number(p.getAttribute('stroke-width')) > 10), [], 800)),
    kite(spot) {
      poke(spot, () => { if (!reducedMotion) spot.animate([{ translate: '0 0' }, { translate: '6px -18px' }, { translate: '0 0' }], { duration: 1100, easing: 'ease-in-out' }) })
      if (reducedMotion) return
      // 風箏在風裡擺：轉整張 HTML 疊層（以線的下端為軸），不動 svg 裡面，蠟筆濾鏡不必每幀重算
      let sway: Animation | undefined
      whileSeen(spot, () => { sway ??= spot.animate([{ rotate: '-3deg' }, { rotate: '3deg' }], { duration: 2600, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out', composite: 'add' }); sway.play() }, () => sway?.pause())
    },
    bubbles: (spot, art) => poke(spot, () => {
      if (reducedMotion) return
      ;[...art.parts.values()].forEach((g, i) => {
        g.style.transformBox = 'fill-box'
        g.style.transformOrigin = 'center'
        g.animate([{ scale: 1, opacity: 1 }, { scale: 1.35, opacity: 0 }], { duration: 220, delay: i * 70, easing: 'ease-out', fill: 'forwards' })
          .finished.then(() => new Promise((resolve) => setTimeout(resolve, 700)))
          .then(() => {
            g.animate([{ scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1 }], { duration: 420, easing: ease, fill: 'forwards' })
            drawOn([...g.querySelectorAll<SVGPathElement>('path')], [], 400)
          }, () => {})
      })
    }),
    bunny: (spot, art) => poke(spot, () => {
      const ears = art.parts.get('ears')
      if (reducedMotion || !ears) return
      ears.style.transformOrigin = '50px 44px'
      ears.animate([{ rotate: '0deg' }, { rotate: '-8deg' }, { rotate: '6deg' }, { rotate: '0deg' }], { duration: 700, easing: 'ease-in-out' })
    }),
    banana: (spot, art) => poke(spot, () => drawOn(art.lines, [], 600)),
    apple: (spot, art) => poke(spot, () => drawOn(art.lines, [], 600)),
    hand: (spot) => poke(spot, () => { if (!reducedMotion) spot.animate([{ rotate: '0deg' }, { rotate: '-12deg' }, { rotate: '8deg' }, { rotate: '-10deg' }, { rotate: '0deg' }], { duration: 1000, easing: 'ease-in-out', composite: 'add' }) })
  }

  for (const spot of spots) {
    const name = spot.dataset.doodle as DoodleName
    if (name === 'bird') placeBird(spot)
    seen(spot, () => {
      const art = draw(spot)
      behaviours[name]?.(spot, art)
    }, name === 'sun' ? '0px' : undefined)
  }

  // 04 校舍塗色：選到哪一所就塗那一所，看過的都留著。點擊與方向鍵換校都會改 aria-selected，看屬性變化
  const painted = new Set<HTMLElement>()
  let tabsSeen = false
  const paint = (spot: HTMLElement) => {
    const key = spot.dataset.campus ?? ''
    const colors = TOUR_PAINT[key]
    if (!colors || painted.has(spot)) return
    painted.add(spot)
    const rnd = seeded(60 + key.length * 7)
    const layers = colors.map((c, i) => {
      const art = render({ w: 150, h: 100, marks: [{ d: scribble(0, 0, 150, 100, rnd, { angle: i ? 0.7 : -0.4 + rnd() * 0.2, gap: i ? 3 : 3.4 }), c, w: i ? 3.6 : 4.1 }] })
      art.svg.setAttribute('preserveAspectRatio', 'none')
      art.svg.style.setProperty('--paint-mask', `url(${tourPaintSrc(key, i ? '-roof' : '')})`)
      return art
    })
    spot.replaceChildren(...layers.map((layer) => layer.svg))
    drawOn(layers.flatMap((layer) => layer.lines), [], 1100)
  }
  const paintSelected = () => {
    if (!tabsSeen) return
    for (const tab of root.querySelectorAll<HTMLElement>('.renv-tour-tab[aria-selected="true"]')) {
      const spot = tab.querySelector<HTMLElement>('[data-tour-paint]')
      if (spot) paint(spot)
    }
  }
  const tabs = root.querySelector('.renv-tour-tabs')
  if (tabs) {
    const mo = new MutationObserver(paintSelected)
    mo.observe(tabs, { attributes: true, subtree: true, attributeFilter: ['aria-selected'] })
    cleanups.push(() => mo.disconnect())
    seen(tabs, () => { tabsSeen = true; paintSelected() })
  }

  // 視窗改寬：手繪層 120ms 後在下一幀重畫曬衣繩，這裡晚一點再把小鳥放回繩上
  let lastWidth = document.documentElement.clientWidth, timer = 0
  const onResize = () => {
    const width = document.documentElement.clientWidth
    if (width === lastWidth) return
    lastWidth = width
    clearTimeout(timer)
    timer = window.setTimeout(refresh, 300)
  }
  addEventListener('resize', onResize, { passive: true })
  cleanups.push(() => { removeEventListener('resize', onResize); clearTimeout(timer) })

  function refresh() {
    for (const spot of root.querySelectorAll<HTMLElement>('[data-doodle="bird"]')) placeBird(spot)
    // 後台預覽換了校園探索、分頁重建時，新的那格還沒塗
    for (const spot of painted) if (!spot.isConnected) painted.delete(spot)
    paintSelected()
  }

  return {
    refresh,
    destroy() {
      cleanups.forEach((fn) => fn())
      drawn.forEach((art, spot) => { if (spot.contains(art.svg)) spot.replaceChildren() })
      painted.forEach((spot) => spot.replaceChildren())
    }
  }
}
