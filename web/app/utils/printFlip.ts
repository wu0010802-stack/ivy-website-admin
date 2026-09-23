/**
 * 「孩子的一天」拍立得翻面的共用節奏與方向（2026-09-23）。
 *
 * WebGL 紙張版（paperPrints.ts）與 CSS 3D 版（DayMomentCard.vue）共用：
 * 右下角落捲起與首張偷看都是「右緣掀起往左」，所以翻面永遠往左翻；
 * 翻到一半再點就原路翻回。位置以半圈為單位：0 正面、-1 背面、-2 又是正面。
 * 這支不 import three，卡片元件可以靜態引用。
 */

/** 翻面時長（ms）；WebGL 版另有約 0.2 秒紙張回彈收尾。 */
export const FLIP_MS = 950

/** 點下去立刻起步、約三分之一時間立起、後段慢慢放平。CSS 版 transition 用同一條。 */
export const FLIP_BEZIER = [0.28, 0.1, 0.38, 1] as const

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx
  return (t: number) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    // 先用牛頓法，斜率太小再退回二分法（與瀏覽器解 cubic-bezier 的做法相同）
    let s = t
    for (let i = 0; i < 8; i++) {
      const error = sampleX(s) - t
      if (Math.abs(error) < 1e-7) return sampleY(s)
      const slope = slopeX(s)
      if (Math.abs(slope) < 1e-6) break
      s -= error / slope
    }
    let lo = 0
    let hi = 1
    s = t
    for (let i = 0; i < 40; i++) {
      const x = sampleX(s)
      if (Math.abs(x - t) < 1e-7) break
      if (x < t) lo = s
      else hi = s
      s = (lo + hi) / 2
    }
    return sampleY(s)
  }
}

export const flipEase = cubicBezier(...FLIP_BEZIER)

const nearInteger = (value: number) => Math.abs(value - Math.round(value)) < 1e-6
const isBack = (turn: number) => Math.abs(turn) % 2 === 1

/**
 * 依目前位置與想要的正反面決定目標：靜止時往左翻一格；
 * 夾在兩格之間（翻到一半）時，選同側兩格中面向正確的那一格，也就是原路翻回。
 */
export function turnTarget(position: number, flipped: boolean): number {
  const [near, far] = nearInteger(position)
    ? [Math.round(position), Math.round(position) - 1]
    : [Math.ceil(position), Math.floor(position)]
  // + 0 把 Math.ceil(-0.4) 的 -0 收成 0
  return (isBack(near) === flipped ? near : far) + 0
}

/** 靜止後收回 0／-1：旋轉等價，數字不會越翻越大。 */
export function restTurn(turn: number): number {
  return isBack(Math.round(turn)) ? -1 : 0
}

/**
 * 懸臂彎曲的形狀（0–1）：手捏那一側（grip：1＝紙的 +x 邊，-1＝-x 邊）平直，
 * 越往遠端越彎。x 是紙面上的局部座標，halfW 是半寬。
 */
export function cantilever(x: number, halfW: number, grip: 1 | -1): number {
  const u = (halfW - grip * x) / (2 * halfW)
  return u * u
}

export interface FlexState {
  value: number
  velocity: number
}

// 相紙厚、偏硬：約 2.6Hz、略欠阻尼，停下時遠端只輕輕回彈一次。
const FLEX_OMEGA = 2 * Math.PI * 2.6
const FLEX_DAMPING = 0.55

/** 紙張彎曲的彈簧：跟著 aim（由轉速換算的延遲量）走，固定 1/240 秒小步積分避免大 dt 發散。 */
export function stepFlex(state: FlexState, aim: number, dt: number): FlexState {
  let { value, velocity } = state
  let remaining = Math.max(0, dt)
  while (remaining > 1e-9) {
    const h = Math.min(remaining, 1 / 240)
    const acceleration = FLEX_OMEGA * FLEX_OMEGA * (aim - value) - 2 * FLEX_DAMPING * FLEX_OMEGA * velocity
    velocity += acceleration * h
    value += velocity * h
    remaining -= h
  }
  return { value, velocity }
}
