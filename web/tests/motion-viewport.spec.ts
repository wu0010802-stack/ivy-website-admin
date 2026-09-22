import { describe, expect, it } from 'vitest'
import { resolveMotionViewport } from '../app/utils/motionViewport'

describe('手機捲動的穩定高度', () => {
  it.each([[780, 720], [720, 780], [844, 420]])('高度 %i → %i 不重建觸控裝置的閱讀軌道', (height, nextHeight) => {
    const previous = { width: 390, height }
    expect(resolveMotionViewport(previous, { width: 390, height: nextHeight }, true)).toBe(previous)
  })

  it('旋轉或改變寬度時採用新的尺寸', () => {
    expect(resolveMotionViewport({ width: 390, height: 780 }, { width: 780, height: 390 }, true))
      .toEqual({ width: 780, height: 390 })
  })

  it('一般桌機視窗仍跟隨高度縮放', () => {
    expect(resolveMotionViewport({ width: 1440, height: 900 }, { width: 1440, height: 720 }, false))
      .toEqual({ width: 1440, height: 720 })
  })

  it('新頁面取得自己的初始尺寸，不沿用上一次閱讀', () => {
    expect(resolveMotionViewport(undefined, { width: 390, height: 720 }, true))
      .toEqual({ width: 390, height: 720 })
  })
})
