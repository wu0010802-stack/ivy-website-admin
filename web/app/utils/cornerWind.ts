/**
 * 「孩子的一天」拍立得翻面暗示 A「角落捲起」（2026-09-23 定案；比稿 design/flip-wind-20260923/、
 * design/flip-corner-turn-20260923/）。
 *
 * 沒有折角：平常是完整平貼的相紙。點下去翻面時，觀者看到的右下角先捲起再照現行方式翻
 * （printFlip.ts 不變）；顯影完成後輕掀一次。減少動態不做（由卡片元件判斷）。
 * 2026-10-03 起拿掉捲動起風與整張順風微擺：使用者要相紙靜靜貼著，翻面提示交給 F 第一張翻開進場。
 * 這支不 import three，卡片元件可以靜態引用。
 */
import { FLIP_MS } from './printFlip'

/** 被掀起的範圍（px，以 460px 寬的卡片為準、依紙寬等比）：[基本, reach=1 時再加]。 */
export const CORNER_REACH = [50, 80] as const
export const REACH_REFERENCE_WIDTH = 460

/** 一張卡這一刻的角落：角度（弧度）、末端回彎、範圍 0–1。 */
export interface CornerPose {
  hinge: number
  tip: number
  reach: number
}

export const CORNER_REST: Readonly<CornerPose> = Object.freeze({ hinge: 0, tip: 0, reach: 0 })

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
/** 0 → rise 升到 1，rise → fall 降回 0。 */
const envelope = (p: number, rise: number, fall: number) => smooth(0, rise, p) * (1 - smooth(rise, fall, p))

/** 兩個來源取掀得比較大的那個。 */
export function strongest(a: CornerPose, b: CornerPose): CornerPose {
  return b.hinge > a.hinge ? b : a
}

// ---- 翻面起手與進場輕掀 ----

/** 翻面起手：點下去約 0.1 秒內右下角先捲起，0.45 秒內收掉；翻面本身（時長、曲線、彎曲）不變。 */
export const LEAD_HINGE = 1.3
const LEAD_RISE = 0.1
const LEAD_FALL = 0.45

export function leadPose(elapsedMs: number): CornerPose {
  const hinge = LEAD_HINGE * envelope(elapsedMs / FLIP_MS, LEAD_RISE, LEAD_FALL)
  if (hinge <= 0) return CORNER_REST
  return { hinge, tip: -0.3 * hinge, reach: 0.9 }
}

/** 顯影完成後輕掀一次（取代舊的折角掀角）：約半秒掀到 0.55 rad，再落回、輕彈一下。 */
export const PUFF_MS = 1100
const PUFF_HINGE = 0.55

export function puffPose(elapsedMs: number): CornerPose {
  const k = elapsedMs / PUFF_MS
  if (k <= 0 || k >= 1) return CORNER_REST
  const hinge = PUFF_HINGE * (smooth(0, 0.42, k) * (1 - smooth(0.42, 0.86, k)) + 0.12 * envelope((k - 0.86) / 0.14, 0.5, 1))
  return { hinge, tip: -0.25 * hinge, reach: 0.35 }
}
