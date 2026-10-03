import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CREST_LAYERS, crestLook, crestPose, springStep } from '../app/utils/crest-popup'

// 2026-10-03 404 頁的立體書校徽（比稿 design/logo-3d-directions-20261003/，使用者選「404 × 立體書」）。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('立體書圖層', () => {
  it('由後往前五層，深度遞增；每層都有素材', () => {
    expect(CREST_LAYERS.map((layer) => layer.name)).toEqual(['base', 'wreath', 'top', 'kids', 'banner'])
    const depths = CREST_LAYERS.map((layer) => layer.depth)
    expect(depths[0]).toBe(0)
    expect([...depths].sort((a, b) => a - b)).toEqual(depths)
    for (const { name } of CREST_LAYERS) {
      expect(existsSync(fileURLToPath(new URL(`../public/assets/crest-popup/${name}.webp`, import.meta.url)))).toBe(true)
    }
  })
})

describe('游標看向', () => {
  const center = { x: 500, y: 500 }
  it('沒有游標或離很遠時不轉', () => {
    expect(crestLook(null, center, 200).w).toBe(0)
    expect(crestLook({ x: 2500, y: 500 }, center, 200).w).toBe(0)
  })
  it('游標貼近時權重 1，方向依左右上下，超出範圍封頂在 ±1', () => {
    const near = crestLook({ x: 560, y: 470 }, center, 200)
    expect(near.w).toBe(1)
    expect(near.x).toBeGreaterThan(0)
    expect(near.y).toBeLessThan(0)
    const far = crestLook({ x: 5000, y: 500 }, center, 200)
    expect(far.x).toBe(1)
  })
  it('靜止姿勢略轉向頁面內側（左），游標在正右方時轉回右邊', () => {
    expect(crestPose({ x: 0, y: 0, w: 0 }).yaw).toBeLessThan(0)
    expect(crestPose({ x: 1, y: 0, w: 1 }).yaw).toBeGreaterThan(0)
    expect(crestPose({ x: 0, y: 0, w: 1 }).spread).toBeGreaterThan(crestPose({ x: 0, y: 0, w: 0 }).spread)
  })
})

describe('彈簧', () => {
  it('臨界阻尼：一路逼近目標、不衝過頭', () => {
    let state = { value: 0, velocity: 0 }
    let prev = 0
    for (let i = 0; i < 120; i++) {
      state = springStep(state, 1, 8, 1 / 60)
      expect(state.value).toBeGreaterThanOrEqual(prev)
      expect(state.value).toBeLessThanOrEqual(1)
      prev = state.value
    }
    expect(state.value).toBeGreaterThan(0.999)
  })
  it('一次跳很大的 dt 也不會爆掉', () => {
    const state = springStep({ value: 0, velocity: 0 }, 1, 8, 5)
    expect(Number.isFinite(state.value)).toBe(true)
    expect(Math.abs(state.value - 1)).toBeLessThan(0.01)
  })
})

describe('404 頁', () => {
  const page = read('../app/error.vue')
  it('只有找不到頁面（404）放立體書，503 不放', () => {
    expect(page).toContain('<CrestPopup v-if="notFound"')
  })
})

describe('立體書元件', () => {
  const component = () => read('../app/components/CrestPopup.vue')
  it('純裝飾：整塊對報讀器隱藏、圖片空 alt', () => {
    expect(component()).toContain('aria-hidden="true"')
    expect(component()).toMatch(/<img[^>]*alt=""/)
  })
  it('開書動畫是 CSS（SSR 就開始，不等 hydration），減少動態時直接攤開', () => {
    expect(component()).toMatch(/@keyframes crest-open/)
    expect(component()).toMatch(/@media \(prefers-reduced-motion: reduce\)[^}]*\{[^}]*animation: none/)
  })
  it('減少動態或強制色彩時不掛游標傾斜與點擊；強制色彩、列印時隱藏', () => {
    expect(component()).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    expect(component()).toContain("matchMedia('(forced-colors: active)')")
    expect(component()).toMatch(/@media \(forced-colors: active\)[^{]*\{[^}]*display: none/)
    expect(component()).toMatch(/@media print[^{]*\{[^}]*display: none/)
  })
})
