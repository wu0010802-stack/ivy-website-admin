import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FLIP_MS } from '../app/utils/printFlip'
import * as cornerWind from '../app/utils/cornerWind'
import { CORNER_REST, LEAD_HINGE, PUFF_MS, leadPose, puffPose, strongest } from '../app/utils/cornerWind'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('捲動時拍立得不動（2026-10-03 拿掉捲動起風）', () => {
  it('沒有捲動的風可以訂閱，卡片也不聽 scroll', () => {
    expect(cornerWind).not.toHaveProperty('subscribeCornerWind')
    const card = read('../app/components/DayMomentCard.vue')
    expect(card).not.toMatch(/subscribeCornerWind|addEventListener\(\s*'scroll'/)
  })

  it('整張不再順風微擺：.print-card 只有自己的傾角', () => {
    const css = read('../app/assets/css/styles.css')
    expect(css).not.toMatch(/@property --sway|var\(--sway/)
    expect(css).toMatch(/\.print-card\{[^}]*rotate:var\(--card-tilt\)/)
  })
})

describe('角落來源', () => {
  it('取掀得比較大的那個', () => {
    const small = { hinge: 0.2, tip: 0, reach: 0.5 }
    const big = { hinge: 1, tip: -0.3, reach: 0.9 }
    expect(strongest(small, big)).toBe(big)
    expect(strongest(big, small)).toBe(big)
    expect(strongest(CORNER_REST, big)).toBe(big)
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
