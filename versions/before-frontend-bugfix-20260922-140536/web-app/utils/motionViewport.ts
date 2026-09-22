export interface MotionViewport {
  width: number
  height: number
}

/** 手機網址列／鍵盤只改高度時，保留這次閱讀的軌道；旋轉、改寬仍重新量測。 */
export function resolveMotionViewport(
  previous: MotionViewport | undefined,
  current: MotionViewport,
  touch: boolean
): MotionViewport {
  if (previous?.width === current.width && (touch || previous.height === current.height)) return previous
  return current
}

const viewports = new WeakMap<HTMLElement, MotionViewport>()

export function readMotionViewport(element: HTMLElement): MotionViewport {
  const root = element.closest<HTMLElement>('.home-reveal') ?? element
  const previous = viewports.get(root)
  const next = resolveMotionViewport(previous, {
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight
  }, window.matchMedia('(hover: none) and (pointer: coarse)').matches)
  if (next !== previous) {
    viewports.set(root, next)
    // 所有相依的 sticky 高度、留白與接力文字共用同一個基準。
    root.style.setProperty('--reveal-height', `${next.height}px`)
    root.style.setProperty('--motion-vh', `${next.height / 100}px`)
  }
  return next
}
