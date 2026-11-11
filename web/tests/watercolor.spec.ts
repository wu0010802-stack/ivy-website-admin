import { describe, expect, it } from 'vitest'
import { PIGMENTS, type Point, blotPolygons, BLOT_MAX_FOLD, fitInside, foldRatio, selfIntersects, washBase, parseWash, seededRandom, washEllipse, washPolygons } from '../app/utils/watercolor'

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

describe('blotPolygons（顏料團背景圖不被 canvas 切直線，2026-11-11）', () => {
  // 年段「一年一年學」的顏料團（正式站 1512 寬實測）：元素 552×138、第 6 團（種子 60＋5×7），blotCanvas 長邊縮到 384 → 384×96
  const W = 384, H = 96
  const reach = (polys: Point[][]) => polys.flat().reduce(([dx, dy], [x, y]) => [Math.max(dx, Math.abs(x - W / 2)), Math.max(dy, Math.abs(y - H / 2))], [0, 0])
  it('原本的做法：扁長框直接變形，上下推出框外（切線的來源）', () => {
    expect(reach(washPolygons(seededRandom(95), W / 2, H / 2, W * 0.34, H * 0.31, 26))[1]).toBeGreaterThan(H / 2)
  })
  it('每個點都落在框內，且寬度還保有原本的大半（不是被壓成一條線）', () => {
    const [dx, dy] = reach(blotPolygons(seededRandom(95), W, H))
    expect(dx).toBeLessThan(W / 2)
    expect(dy).toBeLessThan(H / 2)
    expect(dx).toBeGreaterThan(W * 0.34)
    expect(dy).toBeGreaterThan(H * 0.31)
  })
  it('理念清單那種更扁的框（手機 353×76）也一樣', () => {
    const w = 384, h = Math.round(76 * 384 / 353)
    const polys = blotPolygons(seededRandom(81), w, h)
    expect(polys.flat().every(([x, y]) => x > 0 && x < w && y > 0 && y < h)).toBe(true)
  })
  it('比例在範圍內的團（年齡、章節編號）和原本逐點相同', () => {
    expect(blotPolygons(seededRandom(7), 120, 100)).toEqual(washPolygons(seededRandom(7), 60, 50, 120 * 0.34, 100 * 0.31, 26))
  })
})

describe('顏料團基底反折就重抽（2026-11-11）', () => {
  it('selfIntersects：正方形不算、蝴蝶結算', () => {
    expect(selfIntersects([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(false)
    expect(selfIntersects([[0, 0], [10, 10], [10, 0], [0, 10]])).toBe(true)
  })
  it('foldRatio：沒交叉是 0；蝴蝶結兩半方向相反，各佔一半', () => {
    expect(foldRatio([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(0)
    expect(foldRatio([[0, 0], [10, 10], [10, 0], [0, 10]])).toBeCloseTo(0.5, 1)
  })
  it('年段「4 歲」（種子 116、323×323）原本的基底反折超過門檻，blotPolygons 換成不反折的基底', () => {
    expect(foldRatio(washBase(seededRandom(116), 161.5, 161.5, 323 * 0.34, 323 * 0.31))).toBeGreaterThan(BLOT_MAX_FOLD)
    expect(blotPolygons(seededRandom(116), 323, 323)).not.toEqual(washPolygons(seededRandom(116), 161.5, 161.5, 323 * 0.34, 323 * 0.31, 26))
  })
})

describe('fitInside', () => {
  it('各層共用基底的點：回傳新的點，不改到原本的多邊形', () => {
    const polys = washPolygons(seededRandom(3), 100, 50, 80, 20, 6)
    const before = JSON.stringify(polys)
    const fitted = fitInside(polys, 100, 50, 30, 10)
    expect(JSON.stringify(polys)).toBe(before)
    expect(fitted.flat().every(([x, y]) => Math.abs(x - 100) <= 30 + 1e-9 && Math.abs(y - 50) <= 10 + 1e-9)).toBe(true)
  })
  it('本來就在框內就原樣回傳', () => {
    const polys = washPolygons(seededRandom(7), 100, 100, 20, 20, 10)
    expect(fitInside(polys, 100, 100, 99, 99)).toBe(polys)
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
