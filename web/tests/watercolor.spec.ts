import { describe, expect, it } from 'vitest'
import { PIGMENTS, parseWash, seededRandom, washEllipse, washPolygons } from '../app/utils/watercolor'

// 特色教學頁的水彩（2026-09-28）：演算法是純函式，canvas 只負責把多邊形畫出來。
describe('seededRandom', () => {
  it('同一個種子每次畫出同一張圖，值落在 [0, 1)', () => {
    const a = seededRandom(42), b = seededRandom(42)
    const xs = Array.from({ length: 200 }, () => a())
    expect(xs).toEqual(Array.from({ length: 200 }, () => b()))
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
    expect(seededRandom(43)()).not.toBe(xs[0])
  })
  it('種子 0 不會卡在固定值', () => {
    const r = seededRandom(0)
    expect(new Set(Array.from({ length: 20 }, () => r())).size).toBe(20)
  })
})

describe('washPolygons', () => {
  it('一團顏料＝同一個基底變形出 layers 層，每層 12 × 2² × 2³ 個點', () => {
    const polys = washPolygons(seededRandom(7), 200, 100, 80, 50, 30)
    expect(polys).toHaveLength(30)
    for (const poly of polys) {
      expect(poly).toHaveLength(12 * 4 * 8)
      expect(poly.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true)
    }
  })
  it('顏料集中在指定的中心附近', () => {
    const points = washPolygons(seededRandom(9), 300, 200, 100, 60, 10).flat()
    const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length
    const cy = points.reduce((sum, [, y]) => sum + y, 0) / points.length
    expect(Math.abs(cx - 300)).toBeLessThan(25)
    expect(Math.abs(cy - 200)).toBeLessThan(25)
  })
})

describe('parseWash', () => {
  it('顏料,中心x,中心y,半徑x,半徑y[,每層透明度,層數]，多團用 | 分隔；省略的用預設值', () => {
    expect(parseWash('sun,.3,.44,.6,.5,.024,42|orange,.04,.96,.12,.1')).toEqual([
      { pigment: 'sun', fx: 0.3, fy: 0.44, frx: 0.6, fry: 0.5, alpha: 0.024, layers: 42 },
      { pigment: 'orange', fx: 0.04, fy: 0.96, frx: 0.12, fry: 0.1, alpha: 0.028, layers: 36 }
    ])
  })
  it('不認得的顏料或壞掉的數字整團略過，不讓畫面壞掉', () => {
    expect(parseWash('purple,.5,.5,.5,.5|sun,.5,x,.5,.5|mint,.5,.5,.5,.5')).toEqual([
      { pigment: 'mint', fx: 0.5, fy: 0.5, frx: 0.5, fry: 0.5, alpha: 0.028, layers: 36 }
    ])
    expect(parseWash('')).toEqual([])
    expect(parseWash(undefined)).toEqual([])
  })
  it('顏料只有品牌四色加草綠', () => {
    expect([...PIGMENTS]).toEqual(['mint', 'sky', 'sun', 'orange', 'leaf'])
  })
})

describe('washEllipse', () => {
  const spec = { pigment: 'sun' as const, fx: 0.5, fy: 0.5, frx: 0.6, fry: 0.6, alpha: 0.028, layers: 36 }
  it('以元素框換算中心與半徑', () => {
    expect(washEllipse(spec, { x: 100, y: 200, w: 400, h: 300 }, 2000)).toEqual({ cx: 300, cy: 350, rx: 240, ry: 180 })
  })
  it('碰到段落上下緣就收半徑，顏料不會被下一段或頁尾切一刀', () => {
    // 元素中心在 700、段落只到 900：半徑 240 收成 184，剛好停在離下緣 16px
    const e = washEllipse(spec, { x: 0, y: 500, w: 400, h: 400 }, 900)
    expect(e.ry).toBe(184)
    expect(e.cy + e.ry).toBe(900 - 16)
    // 貼著上緣的元素：半徑收到下限 30，不會整團跑出段落
    const top = washEllipse({ ...spec, fy: 0 }, { x: 0, y: 20, w: 400, h: 400 }, 2000)
    expect(top.ry).toBe(30)
  })
  it('再小的元素也至少有一團看得見的顏料', () => {
    const e = washEllipse(spec, { x: 0, y: 500, w: 10, h: 10 }, 2000)
    expect(e.rx).toBe(40)
    expect(e.ry).toBe(34)
  })
})
