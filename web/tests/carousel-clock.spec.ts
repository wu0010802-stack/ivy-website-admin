import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCarouselClock } from '../app/utils/carouselClock'

describe('分校自動輪播時鐘', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] }))
  afterEach(() => vi.useRealTimers())
  function setup() {
    const advance = vi.fn()
    let progress = 0
    const clock = createCarouselClock({ duration: 6000, onAdvance: advance, onProgress: value => { progress = value } })
    return { clock, advance, progress: () => progress }
  }
  it('未開始時不計時，每滿六秒才前往下一校，重複啟動不加速', () => {
    const { clock, advance, progress } = setup()
    vi.advanceTimersByTime(8000)
    expect(advance).not.toHaveBeenCalled()
    clock.start(); clock.start()
    vi.advanceTimersByTime(3000)
    expect(progress()).toBeCloseTo(.5)
    expect(advance).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3000)
    expect(advance).toHaveBeenCalledTimes(1)
    expect(progress()).toBe(0)
    vi.advanceTimersByTime(6000)
    expect(advance).toHaveBeenCalledTimes(2)
    clock.destroy()
  })
  it('閱讀／離開畫面暫停後保留剩餘時間', () => {
    const { clock, advance, progress } = setup()
    clock.start(); vi.advanceTimersByTime(2500); clock.pause()
    vi.advanceTimersByTime(20000)
    expect(progress()).toBeCloseTo(2500 / 6000)
    expect(advance).not.toHaveBeenCalled()
    clock.start(); vi.advanceTimersByTime(3450)
    expect(advance).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(advance).toHaveBeenCalledTimes(1)
    clock.destroy()
  })
  it('手動選校從新的六秒重新開始，暫停狀態不被解除', () => {
    const { clock, advance, progress } = setup()
    clock.start(); vi.advanceTimersByTime(4000); clock.pause(); clock.reset()
    expect(progress()).toBe(0)
    vi.advanceTimersByTime(8000)
    expect(advance).not.toHaveBeenCalled()
    clock.start(); vi.advanceTimersByTime(5950)
    expect(advance).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(advance).toHaveBeenCalledTimes(1)
    clock.destroy()
  })
  it('卸載後沒有計時器、切校或進度更新', () => {
    const { clock, advance, progress } = setup()
    clock.start(); vi.advanceTimersByTime(1000); clock.destroy()
    const stoppedAt = progress()
    vi.advanceTimersByTime(18000)
    expect(advance).not.toHaveBeenCalled()
    expect(progress()).toBe(stoppedAt)
    expect(vi.getTimerCount()).toBe(0)
  })
})
