import { describe, expect, it } from 'vitest'
import { FLIP_MS } from '../app/utils/printFlip'
import {
  CORNER_REST,
  LEAD_HINGE,
  PUFF_MS,
  WIND_HINGE_MAX,
  WIND_REST,
  WIND_SWAY_MAX,
  cornerPose,
  decayVelocity,
  fadePose,
  leadPose,
  puffPose,
  sampleVelocity,
  stepWind,
  strongest,
  windSettled,
  windTarget,
  type WindState
} from '../app/utils/cornerWind'

// 模擬 dt 秒一步、共 seconds 秒；velocityAt 回傳當下捲動速度（px/s）
function run(seconds: number, velocityAt: (t: number) => number, dt = 1 / 60) {
  let state: WindState = WIND_REST
  const hinges: number[] = []
  for (let t = 0; t < seconds; t += dt) {
    state = stepWind(state, velocityAt(t), dt)
    hinges.push(state.hinge)
  }
  return { state, hinges }
}

describe('捲動速度 → 風力', () => {
  it('沒在捲就沒風，上下捲一樣，約 2100 px/s 風滿', () => {
    expect(windTarget(0)).toBe(0)
    expect(windTarget(1050)).toBeCloseTo(0.5, 5)
    expect(windTarget(-1050)).toBeCloseTo(0.5, 5)
    expect(windTarget(50000)).toBe(1)
  })

  it('以 px/s 計、和上一筆各半平滑；事件間隔過短時以 16ms 計', () => {
    expect(sampleVelocity(0, 20, 16)).toBeCloseTo(625, 5)
    expect(sampleVelocity(0, 20, 1)).toBeCloseTo(sampleVelocity(0, 20, 16), 5)
  })

  it('停止捲動後每秒剩 2%', () => {
    expect(decayVelocity(1000, 1)).toBeCloseTo(20, 5)
  })
})

describe('角落彈簧', () => {
  it('持續快速捲動：角落翻過 90° 露出背面，但不超過上限', () => {
    const { state, hinges } = run(1.5, () => 3000)
    expect(state.hinge).toBeGreaterThan(Math.PI / 2)
    expect(Math.max(...hinges)).toBeLessThan(WIND_HINGE_MAX * 1.2)
  })

  it('慢慢捲只掀一點：約 400 px/s 不到 45°', () => {
    const { state } = run(1.5, () => 400)
    expect(state.hinge).toBeGreaterThan(0.1)
    expect(state.hinge).toBeLessThan(Math.PI / 4)
  })

  it('停下時落回牆面：角度不會小於 0（紙不會穿進牆）', () => {
    const { hinges } = run(3, (t) => (t < 0.5 ? 3000 : 0))
    expect(Math.min(...hinges)).toBeGreaterThanOrEqual(0)
  })

  it('停下後約 3 秒內收回靜止', () => {
    const { state } = run(3.5, (t) => (t < 0.5 ? 3000 : 0))
    expect(windSettled(state, 0)).toBe(true)
  })

  it('高更新率螢幕與 60Hz 走到差不多的位置', () => {
    const at60 = run(0.5, () => 1500, 1 / 60).state.hinge
    const at120 = run(0.5, () => 1500, 1 / 120).state.hinge
    expect(Math.abs(at60 - at120)).toBeLessThan(0.08)
  })

  it('擺動跟著方向、有上限', () => {
    const down = run(1.5, () => 3000).state.sway
    const up = run(1.5, () => -3000).state.sway
    expect(down).toBeGreaterThan(0)
    expect(up).toBeLessThan(0)
    expect(Math.abs(down)).toBeLessThanOrEqual(WIND_SWAY_MAX * 1.2)
  })

  it('靜止且沒在捲就算停穩；還在動或還在捲都不算', () => {
    expect(windSettled(WIND_REST, 0)).toBe(true)
    expect(windSettled(WIND_REST, 800)).toBe(false)
    expect(windSettled({ ...WIND_REST, hingeV: 1 }, 0)).toBe(false)
  })
})

describe('每張卡的角落', () => {
  const windy = run(1, () => 2000).state

  it('沒有風就是平的', () => {
    expect(cornerPose(WIND_REST, 3.2, 7)).toEqual(CORNER_REST)
  })

  it('同一陣風，不同卡片起伏不同步', () => {
    const a = cornerPose(windy, 12.3, 3.7)
    const b = cornerPose(windy, 12.3, 11.01)
    expect(a.hinge).not.toBeCloseTo(b.hinge, 3)
  })

  it('末端逆風往回彎（tip 為負），角度不為負、範圍在 0–1', () => {
    for (let t = 0; t < 5; t += 0.37) {
      const pose = cornerPose(windy, t, 3.7)
      expect(pose.hinge).toBeGreaterThanOrEqual(0)
      expect(pose.tip).toBeLessThan(0.2)
      expect(pose.reach).toBeGreaterThanOrEqual(0)
      expect(pose.reach).toBeLessThanOrEqual(1)
    }
  })

  it('取掀得比較大的那個；風可以淡出到平', () => {
    const small = { hinge: 0.2, tip: 0, reach: 0.5, tilt: 0 }
    const big = { hinge: 1, tip: -0.3, reach: 0.9, tilt: 0 }
    expect(strongest(small, big)).toBe(big)
    expect(strongest(big, small)).toBe(big)
    expect(fadePose(big, 0)).toEqual(CORNER_REST)
    expect(fadePose(big, 0.5).hinge).toBeCloseTo(0.5, 5)
    expect(fadePose(big, 1)).toBe(big)
  })
})

describe('翻面起手與進場輕掀', () => {
  it('點下去約 0.1 秒內角先捲到最高，翻到 0.45 就收掉，之後翻面照舊', () => {
    expect(leadPose(0).hinge).toBe(0)
    expect(leadPose(FLIP_MS * 0.1).hinge).toBeCloseTo(LEAD_HINGE, 5)
    expect(leadPose(FLIP_MS * 0.45)).toEqual(CORNER_REST)
    expect(leadPose(FLIP_MS * 0.8)).toEqual(CORNER_REST)
    expect(leadPose(-5)).toEqual(CORNER_REST) // rAF 時間戳可能早於點擊
  })

  it('進場輕掀：不超過 0.6 rad、結束歸零', () => {
    let peak = 0
    for (let t = 0; t <= PUFF_MS; t += 10) peak = Math.max(peak, puffPose(t).hinge)
    expect(peak).toBeGreaterThan(0.4)
    expect(peak).toBeLessThanOrEqual(0.6)
    expect(puffPose(PUFF_MS)).toEqual(CORNER_REST)
    expect(puffPose(0)).toEqual(CORNER_REST)
  })
})
