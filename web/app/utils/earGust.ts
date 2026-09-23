/**
 * 「孩子的一天」拍立得 B「捲動飄角」（2026-09-23 選定，比稿 design/flip-hint-subtle-20260923/）。
 *
 * 紙膠帶只黏上緣，捲動時下緣的折角被風掀起：捲得越快掀得越高（靜止 32px，最多再多 20px），
 * 停下時以略欠阻尼的彈簧回彈一次；整張也順著捲動方向微擺 ≤0.7°。
 * 不自動播放，只回應使用者的捲動；減少動態不做（由卡片元件判斷，不訂閱）。
 *
 * 六張卡片感受到的捲動速度相同，所以只算一組彈簧：一個 scroll 監聽＋一個 rAF 時鐘，
 * 在畫面內的卡片訂閱並把數值疊加在自己的折角上。這支不 import three，卡片元件可以靜態引用。
 */

/** 折角最多比靜止多掀的 px（32→52）。 */
export const GUST_EAR_MAX = 20
/** 整張紙最多擺動的角度（deg）。 */
export const GUST_SWAY_MAX = 0.7

const PX_PER_S_PER_EAR = 110 // 每 110 px/s 多掀 1px，約 2200 px/s 掀滿
const SWAY_FULL_PX_PER_S = 2600
// 折角 ζ≈0.47、擺動 ζ≈0.41：停下時各回彈一次，約 1 秒內收回
const EAR_STIFFNESS = 190
const EAR_DAMPING = 13
const SWAY_STIFFNESS = 120
const SWAY_DAMPING = 9
const EAR_FLOOR = -6 // 回彈最多比靜止少 6px（折角最小 26px，與進場掀角起點相同）
const HOLD_MS = 60 // 超過這段時間沒有 scroll 事件，才開始把速度衰減
const DECAY_PER_S = 0.02
const MIN_EVENT_MS = 16

export interface GustState {
  /** 折角要疊加的 px（可為負，回彈時） */
  ear: number
  earV: number
  /** 整張紙擺動的 deg */
  sway: number
  swayV: number
}

export const GUST_REST: Readonly<GustState> = Object.freeze({ ear: 0, earV: 0, sway: 0, swayV: 0 })

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** 捲動速度（px/s，向下為正）→ 折角與擺動的目標。 */
export function gustTargets(velocity: number): { ear: number; sway: number } {
  return {
    ear: Math.min(GUST_EAR_MAX, Math.abs(velocity) / PX_PER_S_PER_EAR),
    sway: clamp(velocity / SWAY_FULL_PX_PER_S, -1, 1) * GUST_SWAY_MAX
  }
}

/** 由一筆 scroll 事件更新速度（px/s），與上一筆各半平滑。 */
export function sampleVelocity(previous: number, dy: number, dtMs: number): number {
  return previous * 0.5 + (dy / Math.max(MIN_EVENT_MS, dtMs)) * 1000 * 0.5
}

/** 停止捲動後的速度衰減，dt 秒。 */
export function decayVelocity(velocity: number, dt: number): number {
  return velocity * DECAY_PER_S ** dt
}

/** 半隱式 Euler 走一步，dt 秒。 */
export function stepGust(state: GustState, velocity: number, dt: number): GustState {
  const target = gustTargets(velocity)
  const earV = state.earV + (EAR_STIFFNESS * (target.ear - state.ear) - EAR_DAMPING * state.earV) * dt
  const swayV = state.swayV + (SWAY_STIFFNESS * (target.sway - state.sway) - SWAY_DAMPING * state.swayV) * dt
  return {
    ear: Math.max(EAR_FLOOR, state.ear + earV * dt),
    earV,
    sway: state.sway + swayV * dt,
    swayV
  }
}

/** 沒在捲、而且折角與擺動都回到靜止。 */
export function gustSettled(state: GustState, velocity: number): boolean {
  return (
    Math.abs(velocity) <= 4 &&
    Math.abs(state.ear) < 0.1 &&
    Math.abs(state.earV) < 0.4 &&
    Math.abs(state.sway) < 0.004 &&
    Math.abs(state.swayV) < 0.01
  )
}

// ---- 共用時鐘（瀏覽器端） ----

type GustListener = (state: Readonly<GustState>) => void
const listeners = new Set<GustListener>()
let state: Readonly<GustState> = GUST_REST
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
  // 背景分頁回來最多算 50ms，避免彈簧一步跳太遠
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameAt) / 1000))
  lastFrameAt = now
  if (now - lastScrollAt > HOLD_MS) velocity = decayVelocity(velocity, dt)
  state = stepGust(state, velocity, dt)
  const settled = gustSettled(state, velocity)
  if (settled) {
    state = GUST_REST
    velocity = 0
  }
  for (const listener of listeners) listener(state)
  frame = settled ? 0 : requestAnimationFrame(tick)
}

/** 訂閱捲動飄角；回傳取消訂閱。最後一張取消時拆掉監聽與時鐘。 */
export function subscribeEarGust(listener: GustListener): () => void {
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
    state = GUST_REST
    velocity = 0
  }
}
