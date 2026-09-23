import { describe, expect, it } from 'vitest'
import { GUST_EAR_MAX, GUST_REST, GUST_SWAY_MAX, decayVelocity, gustSettled, gustTargets, sampleVelocity, stepGust, type GustState } from '../app/utils/earGust'

// 模擬 dt 秒一步、共 seconds 秒；velocityAt 回傳當下捲動速度（px/s）
function run(seconds: number, velocityAt: (t: number) => number, dt = 1 / 60) {
  let state: GustState = GUST_REST
  const ears: number[] = []
  for (let t = 0; t < seconds; t += dt) {
    state = stepGust(state, velocityAt(t), dt)
    ears.push(state.ear)
  }
  return { state, ears }
}

describe('捲動速度 → 折角與擺動目標', () => {
  it('沒在捲就不掀', () => {
    expect(gustTargets(0)).toEqual({ ear: 0, sway: 0 })
  })

  it('捲得越快掀得越高，上下捲一樣；約 2200 px/s 掀滿 20px（32→52）', () => {
    expect(gustTargets(1100).ear).toBeCloseTo(10, 5)
    expect(gustTargets(-1100).ear).toBeCloseTo(10, 5)
    expect(gustTargets(2200).ear).toBe(GUST_EAR_MAX)
    expect(gustTargets(50000).ear).toBe(GUST_EAR_MAX)
    expect(GUST_EAR_MAX).toBe(20)
  })

  it('擺動跟著方向、有上限 0.7°', () => {
    expect(gustTargets(1300).sway).toBeGreaterThan(0)
    expect(gustTargets(-1300).sway).toBeLessThan(0)
    expect(gustTargets(50000).sway).toBe(GUST_SWAY_MAX)
    expect(gustTargets(-50000).sway).toBe(-GUST_SWAY_MAX)
    expect(GUST_SWAY_MAX).toBe(0.7)
  })
})

describe('捲動速度取樣與衰減', () => {
  it('以 px/s 計、和上一筆各半平滑', () => {
    expect(sampleVelocity(0, 20, 16)).toBeCloseTo(625, 5)
    expect(sampleVelocity(1000, 20, 16)).toBeCloseTo(1125, 5)
  })

  it('事件間隔過短時以 16ms 計，避免同幀兩筆事件算出暴衝速度', () => {
    expect(sampleVelocity(0, 20, 1)).toBeCloseTo(sampleVelocity(0, 20, 16), 5)
  })

  it('停止捲動後每秒剩 2%', () => {
    expect(decayVelocity(1000, 1)).toBeCloseTo(20, 5)
    expect(decayVelocity(1000, 0)).toBe(1000)
  })
})

describe('彈簧', () => {
  it('持續快速捲動會掀到頂並停在頂', () => {
    const { state } = run(1.5, () => 3000)
    expect(state.ear).toBeCloseTo(GUST_EAR_MAX, 1)
  })

  it('停下時回彈一次：會短暫低於靜止，但不低於 -6px（折角最小 26px）', () => {
    const { ears } = run(2, (t) => (t < 0.6 ? 3000 : 0))
    const after = ears.slice(Math.round(0.6 * 60))
    const lowest = Math.min(...after)
    expect(lowest).toBeLessThan(-0.5)
    expect(lowest).toBeGreaterThanOrEqual(-6)
  })

  it('約 1.5 秒內收回靜止', () => {
    const { state } = run(2.2, (t) => (t < 0.6 ? 3000 : 0))
    expect(gustSettled(state, 0)).toBe(true)
  })

  it('高更新率螢幕與 60Hz 走到同一個位置', () => {
    const at60 = run(0.5, () => 1500, 1 / 60).state.ear
    const at120 = run(0.5, () => 1500, 1 / 120).state.ear
    expect(Math.abs(at60 - at120)).toBeLessThan(0.6)
  })

  it('靜止且沒在捲就算停穩；還在動或還在捲都不算', () => {
    expect(gustSettled(GUST_REST, 0)).toBe(true)
    expect(gustSettled(GUST_REST, 800)).toBe(false)
    expect(gustSettled({ ...GUST_REST, earV: 5 }, 0)).toBe(false)
  })
})
