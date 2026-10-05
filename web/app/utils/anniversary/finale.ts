// 30 週年分頁的結尾：時間軸的蠟筆線接進來，畫出影片最後那個「30」，孩子跳進 0 的中間，校徽印上去。
// 這裡只放幾何（純函式）：字形單位與畫板導引、開場影片同一組（thirtyStrokes），y 往上。
import { thirtyStrokes } from './thirty'

export interface FinalePath {
  /** 折線點，字形單位（y 往上） */
  pts: Array<[number, number]>
  /** 每一點的累積長度 */
  cum: number[]
  total: number
  /** 3 畫完、0 開始、0 畫完時的進度（0–1，以長度算）；3 畫完到 0 開始之間孩子跳過去，不畫線 */
  marks: { threeEnd: number; zeroStart: number; zeroEnd: number }
}

/** 0 的中心與半徑（和 thirtyStrokes 的 0 相同） */
export const ZERO = { cx: 29, cy: -4, rx: 27, ry: 37.5 } as const

function cubic(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], n: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
    ])
  }
  return out
}

/**
 * 從 entry（軌道末端，字形單位）出發的一整筆：接線 → 3 → 小弧線 → 0（多繞一點點，像手畫的收尾）。
 */
export function buildFinalePath(entry: [number, number]): FinalePath {
  // 3 的尾巴原本往左上捲回去（-135°），這裡收在 -105°（底部偏左），跳到 0 的時候才不會穿過 3 的下半圈
  const full = thirtyStrokes()[0]!
  const three = full.slice(0, full.length - 12)
  const t0 = three[0]!, t1 = three.at(-1)!
  // 3 的起點在左上，順時針往右上走；接線從上方垂直下來，再轉進 3 的方向
  const drop = Math.max(12, (entry[1] - t0[1]) * 0.6)
  const lead = cubic(entry, [entry[0], entry[1] - drop], [t0[0] - 16, t0[1] - 4], t0, 40)
  // 3 畫完，蠟筆提起來，孩子跳一個弧線到 0 的最底下（0 從底部逆時針畫）
  const z0: [number, number] = [ZERO.cx, ZERO.cy - ZERO.ry]
  const bridge = cubic(t1, [t1[0] + 12, t1[1] + 40], [z0[0] - 16, z0[1] + 40], z0, 36)
  const zero: Array<[number, number]> = []
  const turns = Math.PI * 2 + 0.16
  for (let i = 1; i <= 140; i++) {
    const a = -Math.PI / 2 + turns * i / 140
    // 收尾往內偏一點，看起來是同一筆畫回起點
    const shrink = 1 - 0.035 * Math.max(0, (i - 128) / 12)
    zero.push([ZERO.cx + Math.cos(a) * ZERO.rx * shrink, ZERO.cy + Math.sin(a) * ZERO.ry * shrink])
  }
  const pts: Array<[number, number]> = [entry, ...lead, ...three.slice(1), ...bridge, ...zero]
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]))
  const total = cum.at(-1)!
  const lenAt = (n: number) => cum[n]! / total
  const threeEndIdx = lead.length + three.length - 1
  const zeroStartIdx = threeEndIdx + bridge.length
  return { pts, cum, total, marks: { threeEnd: lenAt(threeEndIdx), zeroStart: lenAt(zeroStartIdx), zeroEnd: 1 } }
}

/** 進度 s（0–1，以長度算）在路徑上的點與前進方向（弧度，字形座標） */
export function pointAt(fp: FinalePath, s: number): { x: number; y: number; angle: number } {
  const d = Math.min(1, Math.max(0, s)) * fp.total
  let lo = 0, hi = fp.cum.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fp.cum[mid]! <= d) lo = mid; else hi = mid }
  const a = fp.pts[lo]!, b = fp.pts[hi]!
  const seg = fp.cum[hi]! - fp.cum[lo]! || 1
  const t = (d - fp.cum[lo]!) / seg
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) }
}

/** 字形在舞台上的大小與位置：X = ox + x·k，Y = oy − y·k（舞台像素，y 往下） */
export function finaleLayout(w: number, h: number): { k: number; ox: number; oy: number } {
  const narrow = w < 640
  const k = narrow ? Math.min(w * 0.9 / 105.7, h * 0.42 / 75) : Math.min(w * 0.6 / 105.7, h * 0.56 / 75)
  // 字形範圍 x∈[-49.7,56]、y∈[-41.5,33.5]：水平置中，垂直放在偏上（下面留給文字）
  const ox = w / 2 - ((56 - 49.7) / 2) * k
  const oy = h * (narrow ? 0.42 : 0.45) + ((33.5 - 41.5) / 2) * k
  return { k, ox, oy }
}

/**
 * 捲動進度 u（0–1）分成三段：畫線、孩子跳進 0、印校徽。
 * 回傳畫到哪（s）、跳了多少（jump，0–1）、該不該開始印校徽。
 */
export const FINALE_DRAW_END = 0.8
export const FINALE_JUMP_END = 0.9
export function finalePhase(u: number): { s: number; jump: number; print: boolean } {
  const c = Math.min(1, Math.max(0, u))
  return {
    s: Math.min(1, c / FINALE_DRAW_END),
    jump: Math.min(1, Math.max(0, (c - FINALE_DRAW_END) / (FINALE_JUMP_END - FINALE_DRAW_END))),
    print: c >= FINALE_JUMP_END - 0.02
  }
}
