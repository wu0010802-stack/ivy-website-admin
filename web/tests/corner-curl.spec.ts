import { describe, expect, it } from 'vitest'
import { CURL_LEVELS, CURL_SAMPLES, createCurl, curlAngle, curlPoint, setCurl } from '../app/utils/cornerCurl'

// 右下角沿 45° 對角線掀起：紙 400×500，y 朝上、原點在紙中心
const W = 400
const H = 500
function cornerCurl(hinge: number, tip = 0, reach = 100) {
  const curl = createCurl()
  const nx = Math.SQRT1_2
  const ny = -Math.SQRT1_2
  setCurl(curl, { hinge, tip, nx, ny, ox: W / 2 - nx * reach, oy: -H / 2 - ny * reach, reach })
  return curl
}
const bent = (curl: ReturnType<typeof createCurl>, x: number, y: number) => {
  const p = { x, y, z: 0 }
  curlPoint(p, curl)
  return p
}

describe('角落彎曲剖面', () => {
  it('轉角集中在折線附近：一半的範圍就轉了八成以上', () => {
    expect(curlAngle(1, 0, 0)).toBe(0)
    expect(curlAngle(1, 0, 0.5)).toBeCloseTo(0.875, 5)
    expect(curlAngle(1, 0, 1)).toBeCloseTo(1, 5)
    expect(curlAngle(1, -0.3, 1)).toBeCloseTo(0.7, 5)
  })

  it('沒有角度就不作用，紙上每一點都不動', () => {
    const curl = cornerCurl(0)
    expect(curl.active).toBe(false)
    expect(bent(curl, W / 2, -H / 2)).toEqual({ x: W / 2, y: -H / 2, z: 0 })
  })

  it('折線這側不動，只有右下角被掀起、往觀者（z 正）', () => {
    const curl = cornerCurl(1)
    expect(bent(curl, 0, 0)).toEqual({ x: 0, y: 0, z: 0 })
    expect(bent(curl, -W / 2, -H / 2)).toEqual({ x: -W / 2, y: -H / 2, z: 0 })
    expect(bent(curl, W / 2, -H / 2).z).toBeGreaterThan(20)
  })

  it('翻過 90° 時角尖越過折線、疊回紙面上方（露出背面）', () => {
    const corner = bent(cornerCurl(2.6), W / 2, -H / 2)
    // 角尖沿法線的位置跑到折線內側（往左上）
    const along = (corner.x - (W / 2 - Math.SQRT1_2 * 100)) * Math.SQRT1_2 - (corner.y - (-H / 2 + Math.SQRT1_2 * 100)) * Math.SQRT1_2
    expect(along).toBeLessThan(0)
    expect(corner.z).toBeGreaterThan(0)
  })

  it('紙不會被拉長：沿法線相隔 5px 的兩點，彎過去後仍相隔約 5px', () => {
    const curl = cornerCurl(2)
    const n = [Math.SQRT1_2, -Math.SQRT1_2] as const
    const o = [W / 2 - n[0] * 100, -H / 2 - n[1] * 100] as const
    for (const s of [10, 40, 80]) {
      const a = bent(curl, o[0] + n[0] * s, o[1] + n[1] * s)
      const b = bent(curl, o[0] + n[0] * (s + 5), o[1] + n[1] * (s + 5))
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeCloseTo(5, 0)
    }
  })

  it('沿邊緣的波讓同一條折線上的點掀得不一樣高', () => {
    const curl = createCurl()
    setCurl(curl, { hinge: 1, tip: 0, nx: Math.SQRT1_2, ny: -Math.SQRT1_2, ox: 100, oy: -180, reach: 100, ripple: 0.3, rippleK: 0.05, rippleW: 9 })
    const p1 = { x: 180, y: -230, z: 0 }
    const p2 = { x: 150, y: -260, z: 0 }
    curlPoint(p1, curl, 0.4)
    curlPoint(p2, curl, 0.4)
    expect(Math.abs(p1.z - p2.z)).toBeGreaterThan(0.1)
  })
})

// 2026-09-25 前的 setCurl：每個波紋層級都重算一次 curlAngle。現行版本只算一次基準角度再乘上層級倍率，積分表必須逐值相同。
function referenceTables(hinge: number, tip: number, ripple: number) {
  const n = CURL_SAMPLES
  const sub = 4
  return Array.from({ length: CURL_LEVELS }, (_, k) => {
    const m = 1 + ripple * ((2 * k) / (CURL_LEVELS - 1) - 1)
    const table = { x: new Float32Array(n + 1), z: new Float32Array(n + 1), angle: new Float32Array(n + 1) }
    let x = 0
    let z = 0
    for (let j = 1; j <= n; j++) {
      for (let q = 0; q < sub; q++) {
        const th = m * curlAngle(hinge, tip, (j - 1 + (q + 0.5) / sub) / n)
        x += Math.cos(th) / (n * sub)
        z += Math.sin(th) / (n * sub)
      }
      table.x[j] = x
      table.z[j] = z
      table.angle[j] = m * curlAngle(hinge, tip, j / n)
    }
    return table
  })
}

describe('積分表', () => {
  for (const [hinge, tip, ripple] of [[1, 0, 0], [2.7, -0.4, 0.12], [0.35, 0.8, 0.3]] as const) {
    it(`hinge ${hinge}、tip ${tip}、ripple ${ripple}：與逐層重算的舊算法逐值相同`, () => {
      const curl = createCurl()
      setCurl(curl, { hinge, tip, nx: 1, ny: 0, ox: 0, oy: 0, reach: 100, ripple })
      const expected = referenceTables(hinge, tip, ripple)
      curl.tables.forEach((table, k) => {
        expect(Array.from(table.x)).toEqual(Array.from(expected[k]!.x))
        expect(Array.from(table.z)).toEqual(Array.from(expected[k]!.z))
        expect(Array.from(table.angle)).toEqual(Array.from(expected[k]!.angle))
      })
    })
  }
})
