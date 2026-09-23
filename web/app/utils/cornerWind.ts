/**
 * 「孩子的一天」拍立得翻面暗示 A「角落捲起」（2026-09-23 定案；比稿 design/flip-wind-20260923/、
 * design/flip-corner-turn-20260923/，取代同日的 B 捲動飄角與右下折角）。
 *
 * 沒有折角：平常是完整平貼的相紙。捲動時觀者看到的右下角被風從牆上掀起，捲得越快掀得越大，
 * 強風時翻過 90° 露出背面橫線紙；停下時落回牆面、輕輕彈一下，整張也順著捲動方向微擺。
 * 點下去翻面時，同一個角先捲起再照現行方式翻（printFlip.ts 不變）；顯影完成後輕掀一次。
 * 只回應使用者的捲動與點擊；減少動態不做（由卡片元件判斷，不訂閱）。
 *
 * 六張卡片感受到的捲動速度相同：只算一組風與彈簧（一個 scroll 監聽＋一個 rAF 時鐘），
 * 畫面附近的卡片訂閱後，各自用自己的種子加上陣風起伏與顫動（cornerPose），六張不會同步抖。
 * 這支不 import three，卡片元件可以靜態引用。
 */
import { FLIP_MS } from './printFlip'

/** 風滿時角落最多轉幾度（弧度）：超過 π/2 就翻過來露出背面。 */
export const WIND_HINGE_MAX = 2.7
/** 整張紙最多擺動的角度（deg）。 */
export const WIND_SWAY_MAX = 0.4
/** 被掀起的範圍（px，以 460px 寬的卡片為準、依紙寬等比）：[微風, 風滿時再加]。 */
export const WIND_REACH = [50, 80] as const
export const REACH_REFERENCE_WIDTH = 460

const FULL_WIND_PX_PER_S = 2100 // 約 2100 px/s 風滿
const RISE_S = 0.07 // 風起得快
const FALL_S = 0.6 // 收得慢，紙多飄一下才貼回去
const FALL_LINEAR = 0.1 // 收風時每秒再多減 0.1：風大時手感不變，只把最後幾秒看不出來的長尾切掉
// 角落 ζ≈0.36：落回牆面前晃一下；碰到牆（角度 0）反彈 25%
const HINGE_STIFFNESS = 45
const HINGE_DAMPING = 4.8
const HINGE_BOUNCE = 0.25
const REACH_STIFFNESS = 40
const REACH_DAMPING = 9
const SWAY_STIFFNESS = 22
const SWAY_DAMPING = 3
const MEAN_GUST = 0.82 // 陣風起伏的平均值；各卡在 cornerPose 再乘自己的起伏
const FLUTTER = 0.16 // 顫動（弧度）：不經彈簧，直接疊在輸出（紙很輕，8–10Hz 會被彈簧濾掉）
const HOLD_MS = 60 // 超過這段時間沒有 scroll 事件，才開始把速度衰減
const DECAY_PER_S = 0.02
const MIN_EVENT_MS = 16

export interface WindState {
  /** 風力 0–1 */
  level: number
  /** 角落轉角（弧度），各卡再加起伏與顫動 */
  hinge: number
  hingeV: number
  /** 被掀起的範圍 0–1（對應 WIND_REACH） */
  reach: number
  reachV: number
  /** 整張紙擺動的 deg */
  sway: number
  swayV: number
}

export const WIND_REST: Readonly<WindState> = Object.freeze({ level: 0, hinge: 0, hingeV: 0, reach: 0, reachV: 0, sway: 0, swayV: 0 })

/** 一張卡這一刻的角落：角度（弧度）、末端回彎、範圍 0–1、折線偏斜（弧度）。 */
export interface CornerPose {
  hinge: number
  tip: number
  reach: number
  tilt: number
}

export const CORNER_REST: Readonly<CornerPose> = Object.freeze({ hinge: 0, tip: 0, reach: 0, tilt: 0 })

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
/** 0 → rise 升到 1，rise → fall 降回 0。 */
const envelope = (p: number, rise: number, fall: number) => smooth(0, rise, p) * (1 - smooth(rise, fall, p))

// ---- 雜訊：陣風的強弱起伏與紙的顫動都不是正弦波 ----

function hash(n: number): number {
  n = Math.imul(n ^ 0x27d4eb2d, 0x165667b1)
  n ^= n >>> 15
  n = Math.imul(n, 0x85ebca6b)
  n ^= n >>> 13
  return ((n >>> 0) / 4294967295) * 2 - 1
}

function noise(x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hash(i) * (1 - u) + hash(i + 1) * u
}

/** 約 -1–1 的平滑雜訊。 */
export const fbm = (x: number) => 0.6 * noise(x) + 0.28 * noise(x * 2.13 + 17.1) + 0.12 * noise(x * 4.37 + 31.7)

// ---- 風 ----

/** 捲動速度（px/s）→ 風力 0–1，上下捲一樣。 */
export function windTarget(velocity: number): number {
  return Math.min(1, Math.abs(velocity) / FULL_WIND_PX_PER_S)
}

/** 由一筆 scroll 事件更新速度（px/s），與上一筆各半平滑。 */
export function sampleVelocity(previous: number, dy: number, dtMs: number): number {
  return previous * 0.5 + (dy / Math.max(MIN_EVENT_MS, dtMs)) * 1000 * 0.5
}

/** 停止捲動後的速度衰減，dt 秒。 */
export function decayVelocity(velocity: number, dt: number): number {
  return velocity * DECAY_PER_S ** dt
}

/** 走一步（半隱式 Euler），dt 秒。 */
export function stepWind(state: WindState, velocity: number, dt: number): WindState {
  const target = windTarget(velocity)
  const level =
    target > state.level
      ? state.level + (target - state.level) * (1 - Math.exp(-dt / RISE_S))
      : Math.max(target, target + (state.level - target) * Math.exp(-dt / FALL_S) - FALL_LINEAR * dt)
  const hingeV = state.hingeV + (HINGE_STIFFNESS * (WIND_HINGE_MAX * MEAN_GUST * level - state.hinge) - HINGE_DAMPING * state.hingeV) * dt
  let hinge = state.hinge + hingeV * dt
  let bounced = hingeV
  if (hinge < 0) {
    hinge = 0
    if (hingeV < 0) bounced = -hingeV * HINGE_BOUNCE
  }
  const reachV = state.reachV + (REACH_STIFFNESS * (level - state.reach) - REACH_DAMPING * state.reachV) * dt
  const swayTarget = Math.sign(velocity) * WIND_SWAY_MAX * level
  const swayV = state.swayV + (SWAY_STIFFNESS * (swayTarget - state.sway) - SWAY_DAMPING * state.swayV) * dt
  return { level, hinge, hingeV: bounced, reach: state.reach + reachV * dt, reachV, sway: state.sway + swayV * dt, swayV }
}

/** 沒在捲、而且角落與擺動都小到看不出來（角度 <0.7°）：時鐘停下、直接歸零。 */
export function windSettled(state: WindState, velocity: number): boolean {
  return (
    Math.abs(velocity) <= 4 &&
    state.level < 0.012 &&
    state.hinge < 0.012 &&
    Math.abs(state.hingeV) < 0.05 &&
    Math.abs(state.sway) < 0.01 &&
    Math.abs(state.swayV) < 0.03
  )
}

/** 一張卡這一刻的角落：共用的風，乘上自己的陣風起伏，再疊顫動。t 秒、seed 每張不同。 */
export function cornerPose(state: Readonly<WindState>, t: number, seed: number): CornerPose {
  if (state.hinge <= 0 && state.level <= 0) return CORNER_REST
  const gust = (0.8 + 0.35 * fbm(t * 1.1 + seed)) / MEAN_GUST
  const hinge = Math.max(0, state.hinge * gust + 0.4 * FLUTTER * state.level * fbm(t * 7.1 + seed))
  return {
    hinge,
    // 末端逆風往回彎，翻得越快彎得越多，再加一點高頻顫動
    tip: -0.28 * hinge - 0.004 * state.hingeV + FLUTTER * state.level * fbm(t * 10.3 + seed * 3),
    reach: clamp(state.reach, 0, 1),
    tilt: 0.2 * fbm(t * 0.6 + seed * 5) * Math.min(1, state.level * 2)
  }
}

/** 兩個來源取掀得比較大的那個。 */
export function strongest(a: CornerPose, b: CornerPose): CornerPose {
  return b.hinge > a.hinge ? b : a
}

/** 風的角落乘上 0–1（翻面途中讓給起手捲曲）。 */
export function fadePose(pose: CornerPose, amount: number): CornerPose {
  if (amount >= 1) return pose
  if (amount <= 0) return CORNER_REST
  return { hinge: pose.hinge * amount, tip: pose.tip * amount, reach: pose.reach, tilt: pose.tilt * amount }
}

// ---- 翻面起手與進場輕掀 ----

/** 翻面起手：點下去約 0.1 秒內右下角先捲起，0.45 秒內收掉；翻面本身（時長、曲線、彎曲）不變。 */
export const LEAD_HINGE = 1.3
const LEAD_RISE = 0.1
const LEAD_FALL = 0.45

export function leadPose(elapsedMs: number): CornerPose {
  const hinge = LEAD_HINGE * envelope(elapsedMs / FLIP_MS, LEAD_RISE, LEAD_FALL)
  if (hinge <= 0) return CORNER_REST
  return { hinge, tip: -0.3 * hinge, reach: 0.9, tilt: 0 }
}

/** 顯影完成後輕掀一次（取代舊的折角掀角）：約半秒掀到 0.55 rad，再落回、輕彈一下。 */
export const PUFF_MS = 1100
const PUFF_HINGE = 0.55

export function puffPose(elapsedMs: number): CornerPose {
  const k = elapsedMs / PUFF_MS
  if (k <= 0 || k >= 1) return CORNER_REST
  const hinge = PUFF_HINGE * (smooth(0, 0.42, k) * (1 - smooth(0.42, 0.86, k)) + 0.12 * envelope((k - 0.86) / 0.14, 0.5, 1))
  return { hinge, tip: -0.25 * hinge, reach: 0.35, tilt: 0 }
}

// ---- 共用時鐘（瀏覽器端） ----

type WindListener = (state: Readonly<WindState>, t: number) => void
const listeners = new Set<WindListener>()
let state: Readonly<WindState> = WIND_REST
let velocity = 0
let lastY = 0
let lastScrollAt = 0
let lastFrameAt = 0
let frame = 0

function onScroll() {
  const now = performance.now()
  velocity = sampleVelocity(velocity, window.scrollY - lastY, now - lastScrollAt)
  lastY = window.scrollY
  lastScrollAt = now
  if (!frame) {
    lastFrameAt = now
    frame = requestAnimationFrame(tick)
  }
}

function tick(now: number) {
  // rAF 時間戳是影格開始時間，可能早於 scroll 事件的 performance.now()：dt 至少 1ms。
  // 背景分頁回來最多算 50ms，避免彈簧一步跳太遠。
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameAt) / 1000))
  lastFrameAt = now
  if (now - lastScrollAt > HOLD_MS) velocity = decayVelocity(velocity, dt)
  state = stepWind(state, velocity, dt)
  const settled = windSettled(state, velocity)
  if (settled) {
    state = WIND_REST
    velocity = 0
  }
  for (const listener of listeners) listener(state, now / 1000)
  frame = settled ? 0 : requestAnimationFrame(tick)
}

/** 訂閱捲動的風；回傳取消訂閱。最後一張取消時拆掉監聽與時鐘。 */
export function subscribeCornerWind(listener: WindListener): () => void {
  if (!listeners.size) {
    lastY = window.scrollY
    lastScrollAt = performance.now()
    window.addEventListener('scroll', onScroll, { passive: true })
  }
  listeners.add(listener)
  return () => {
    if (!listeners.delete(listener) || listeners.size) return
    window.removeEventListener('scroll', onScroll)
    cancelAnimationFrame(frame)
    frame = 0
    state = WIND_REST
    velocity = 0
  }
}
