// 404 頁的立體書校徽（2026-10-03，比稿 design/logo-3d-directions-20261003/ 的 B，使用者選「404 × 立體書」）。
// 校徽拆成底板、麥穗、皇冠星星、兩個小孩、IVY KIDS 緞帶五張帶米白紙邊的紙片，用 CSS 3D 前後錯開（不載 three.js）。
// - 開書：CSS keyframes（CrestPopupHandle.vue），SSR 出來就開始播，不等 hydration；減少動態時直接攤開。
// - 這支只管互動：滑鼠靠近時整本轉向游標、紙片再撐開一點；點一下闔上再一層層打開。
//   只在有輸入時跑 rAF，停穩就停；寫進根元素的 --crest-yaw／--crest-pitch／--crest-spread。
// - 減少動態、強制色彩、沒有滑鼠懸停的裝置（手機）不掛游標傾斜；手機仍可點。
// 素材由 scripts/build-crest-popup.py 從開場布幕的高解析校徽產生。

export interface CrestLayer {
  name: 'base' | 'wreath' | 'top' | 'kids' | 'banner'
  /** 以 96px 徽章為準的前後距離（px），實際按尺寸等比。 */
  depth: number
}

/** 由後往前。 */
export const CREST_LAYERS: readonly CrestLayer[] = [
  { name: 'base', depth: 0 },
  { name: 'wreath', depth: 9 },
  { name: 'top', depth: 14 },
  { name: 'kids', depth: 20 },
  { name: 'banner', depth: 27 }
]

const REST_YAW = -0.4
const REST_PITCH = 0.12
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

export interface CrestPoint { x: number; y: number }
export interface CrestLook { x: number; y: number; w: number }

/** 游標相對徽章中心的方向（-1..1）與權重 w：貼近時 1，離開約 5.5 倍尺寸後歸 0。 */
export function crestLook(pointer: CrestPoint | null, center: CrestPoint, size: number): CrestLook {
  if (!pointer) return { x: 0, y: 0, w: 0 }
  const dx = pointer.x - center.x
  const dy = pointer.y - center.y
  const reach = size * 2.6
  return {
    x: clamp(dx / reach, -1, 1),
    y: clamp(dy / reach, -1, 1),
    w: 1 - smoothstep(size * 1.4, size * 5.5, Math.hypot(dx, dy))
  }
}

/** 看向權重 → 姿勢：沒有游標時略轉向頁面內側讓層次露出來；游標越近越轉向它、紙片越撐開。 */
export function crestPose(look: CrestLook) {
  return {
    yaw: REST_YAW + (look.x * 0.75 - REST_YAW) * look.w,
    pitch: REST_PITCH + (look.y * 0.5 - REST_PITCH) * look.w,
    spread: 1 + look.w * 0.35
  }
}

export interface CrestSpring { value: number; velocity: number }

/** 臨界阻尼彈簧的解析解：任何 dt 都穩定、不會衝過頭（不回彈）。 */
export function springStep({ value, velocity }: CrestSpring, target: number, omega: number, dt: number): CrestSpring {
  const x = value - target
  const e = Math.exp(-omega * dt)
  return {
    value: target + (x + (velocity + omega * x) * dt) * e,
    velocity: (velocity - omega * (velocity + omega * x) * dt) * e
  }
}

const settled = (s: CrestSpring, target: number) => Math.abs(s.velocity) < 1e-3 && Math.abs(s.value - target) < 1e-3

export interface CrestPopupHandle { destroy: () => void }

/** 掛上游標傾斜與點擊闔書。layers 依 CREST_LAYERS 的順序。 */
export function createCrestPopup(root: HTMLElement, rig: HTMLElement, layers: HTMLElement[], { hover }: { hover: boolean }): CrestPopupHandle {
  const rest = crestPose({ x: 0, y: 0, w: 0 })
  const state = { yaw: { value: rest.yaw, velocity: 0 }, pitch: { value: rest.pitch, velocity: 0 }, spread: { value: rest.spread, velocity: 0 } }
  let pointer: CrestPoint | null = null
  let frame = 0
  let last = 0

  const write = () => {
    root.style.setProperty('--crest-yaw', `${state.yaw.value.toFixed(4)}rad`)
    root.style.setProperty('--crest-pitch', `${state.pitch.value.toFixed(4)}rad`)
    root.style.setProperty('--crest-spread', state.spread.value.toFixed(4))
  }

  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, 1 / 20) || 1 / 60
    last = now
    const r = root.getBoundingClientRect()
    const pose = crestPose(crestLook(pointer, { x: r.left + r.width / 2, y: r.top + r.height / 2 }, r.width))
    state.yaw = springStep(state.yaw, pose.yaw, 7, dt)
    state.pitch = springStep(state.pitch, pose.pitch, 7, dt)
    state.spread = springStep(state.spread, pose.spread, 8, dt)
    write()
    frame = settled(state.yaw, pose.yaw) && settled(state.pitch, pose.pitch) && settled(state.spread, pose.spread) ? 0 : requestAnimationFrame(tick)
  }
  const kick = () => {
    if (frame) return
    last = performance.now()
    frame = requestAnimationFrame(tick)
  }
  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    pointer = { x: event.clientX, y: event.clientY }
    kick()
  }
  const onLeave = () => {
    pointer = null
    kick()
  }

  // 點一下：整本往前低頭、紙片依序壓平再站回來。用獨立的 translate／rotate 屬性，
  // 跟 CSS 的 transform（深度、轉向）疊加，不必在 JS 算目前的深度。
  let folding: Animation[] = []
  const onClick = () => {
    if (folding.some((a) => a.playState === 'running')) return
    const size = root.clientWidth
    const fold = 'cubic-bezier(.65,0,.35,1)' // 壓平：前後都慢一點
    const open = 'cubic-bezier(.16,1,.3,1)' // 站回來：起手快、收尾慢（不回彈）
    folding = layers.slice(1).map((el, i) => {
      const depth = (CREST_LAYERS[i + 1]!.depth * size) / 96 * state.spread.value
      return el.animate(
        [{ translate: '0 0 0', easing: fold }, { translate: `0 0 ${-depth}px`, offset: 0.24, easing: open }, { translate: '0 0 0' }],
        { duration: 1000, delay: i * 90 }
      )
    })
    folding.push(rig.animate([{ rotate: 'x 0deg', easing: fold }, { rotate: 'x 20deg', offset: 0.24, easing: open }, { rotate: 'x 0deg' }], { duration: 1100 }))
  }

  if (hover) {
    addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
  }
  root.addEventListener('click', onClick)

  return {
    destroy() {
      cancelAnimationFrame(frame)
      removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      root.removeEventListener('click', onClick)
      folding.forEach((a) => a.cancel())
    }
  }
}
