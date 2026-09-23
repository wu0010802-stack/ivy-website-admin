import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FLIP_BEZIER, FLIP_MS, cantilever, cubicBezier, flipEase, restTurn, stepFlex, turnTarget } from '../app/utils/printFlip'

describe('拍立得翻面方向', () => {
  it('靜止時一律往左翻（右緣掀起，和折角、首張偷看同方向）', () => {
    expect(turnTarget(0, true)).toBe(-1)
    expect(turnTarget(-1, false)).toBe(-2)
    expect(turnTarget(-2, true)).toBe(-3)
  })

  it('狀態沒變就不動', () => {
    expect(turnTarget(0, false)).toBe(0)
    expect(turnTarget(-1, true)).toBe(-1)
  })

  it('翻到一半再點，原路翻回；翻回途中再點，繼續往左翻', () => {
    expect(turnTarget(-0.4, false)).toBe(0)
    expect(turnTarget(-1.3, true)).toBe(-1)
    expect(turnTarget(-0.6, true)).toBe(-1)
  })

  it('浮點誤差貼近整數時視為靜止', () => {
    expect(turnTarget(-0.9999999999, false)).toBe(-2)
  })

  it('靜止後收回 0／-1，旋轉等價且沒有 -0', () => {
    expect(Object.is(restTurn(-2), 0)).toBe(true)
    expect(restTurn(-4)).toBe(0)
    expect(restTurn(-3)).toBe(-1)
    expect(restTurn(-1)).toBe(-1)
    expect(Object.is(restTurn(0), 0)).toBe(true)
  })
})

describe('翻面緩動', () => {
  it('端點固定、全程單調', () => {
    expect(flipEase(0)).toBe(0)
    expect(flipEase(1)).toBe(1)
    let last = 0
    for (let i = 1; i <= 100; i++) {
      const value = flipEase(i / 100)
      expect(value).toBeGreaterThanOrEqual(last)
      last = value
    }
  })

  it('點下去立刻起步，約三分之一時間立起，後段慢慢放平', () => {
    // 舊的 easeInOutCubic 在 10% 時間只轉了 0.4%，點擊後像卡住
    expect(flipEase(0.1)).toBeGreaterThan(0.05)
    expect(flipEase(0.1)).toBeLessThan(0.15)
    expect(flipEase(1 / 3)).toBeCloseTo(0.48, 1)
    expect(flipEase(0.85)).toBeGreaterThan(0.96)
  })

  it('跟 CSS 版共用同一條 cubic-bezier 與時長', () => {
    expect(FLIP_BEZIER).toEqual([0.28, 0.1, 0.38, 1])
    expect(FLIP_MS).toBe(950)
    const linear = cubicBezier(0, 0, 1, 1)
    expect(linear(0.37)).toBeCloseTo(0.37, 4)
    const css = readFileSync(fileURLToPath(new URL('../app/assets/css/styles.css', import.meta.url)), 'utf8')
    const rule = /\n\.print\{[^}]*transition:transform ([\d.]+)s cubic-bezier\(([^)]*)\)/.exec(css)
    expect(rule).not.toBeNull()
    expect(Number(rule![1]) * 1000).toBe(FLIP_MS)
    expect(rule![2]!.split(',').map(Number)).toEqual([...FLIP_BEZIER])
  })
})

describe('紙張彎曲', () => {
  it('手捏的那一側平直，遠端彎最多', () => {
    const half = 230
    expect(cantilever(half, half, 1)).toBe(0)
    expect(cantilever(-half, half, 1)).toBe(1)
    expect(cantilever(0, half, 1)).toBeCloseTo(0.25, 6)
    // 從背面翻時手捏在另一側
    expect(cantilever(-half, half, -1)).toBe(0)
    expect(cantilever(half, half, -1)).toBe(1)
  })

  it('彎曲彈簧跟得上、停得下，大步長也不發散', () => {
    let state = { value: 0, velocity: 0 }
    for (let i = 0; i < 30; i++) state = stepFlex(state, 0.08, 1 / 60)
    expect(state.value).toBeGreaterThan(0.06)
    let peak = 0
    for (let i = 0; i < 60; i++) {
      state = stepFlex(state, 0, 1 / 60)
      peak = Math.min(peak, state.value)
    }
    // 放開後略微回彈（follow-through）但幅度小，一秒內歸零
    expect(peak).toBeLessThan(0)
    expect(peak).toBeGreaterThan(-0.03)
    expect(Math.abs(state.value)).toBeLessThan(0.002)
    let coarse = { value: 0, velocity: 0 }
    for (let i = 0; i < 40; i++) coarse = stepFlex(coarse, 0.08, 0.05)
    expect(coarse.value).toBeCloseTo(0.08, 2)
  })
})
