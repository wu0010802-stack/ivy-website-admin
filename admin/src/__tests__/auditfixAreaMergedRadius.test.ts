// 2026-10-20 稽核 #12：里界調整合併組跨過半徑時，參觀率的分子分母、總結句的里數、里卡片的距離要對同一批里。
import { describe, expect, it } from 'vitest'
import { villageFacts, type FactsSources } from '../components/admissions/area/villageFacts'
import { villageTableRows } from '../components/admissions/area/villageTable'
import { trendsSummary } from '../components/admissions/area/areaFormat'
import type { AdmissionsArea, VillageFeature } from '../api/types'
import { areaEnrolled, areaKindergartens, areaOpportunity, areaStats, areaTrends, villageBoundaries } from './admissionsTestKit'

const GROUP = '三民區寶業里、龍子里（里界調整，合併）'
const CAMPUS = { lat: 22.642456, lng: 120.343713 }
const METERS_PER_DEGREE_LAT = (Math.PI / 180) * 6371000
const FAR = '64000050099'

/** 校區正北 meters 公尺處的小三角形里界（里中心就在那裡）。 */
const northVillage = (code: string, meters: number): VillageFeature => {
  const lat = CAMPUS.lat + meters / METERS_PER_DEGREE_LAT
  const lng = CAMPUS.lng
  return {
    type: 'Feature',
    properties: { TOWNNAME: '三民區', VILLNAME: '北遠里', VILLCODE: code },
    geometry: { type: 'Polygon', coordinates: [[[lng - 0.001, lat - 0.0005], [lng + 0.001, lat - 0.0005], [lng, lat + 0.001], [lng - 0.001, lat - 0.0005]]] },
  }
}

const sources = (changes: Partial<FactsSources> = {}): FactsSources => ({
  boundaries: villageBoundaries(),
  area: areaStats() as AdmissionsArea,
  opportunity: areaOpportunity(),
  opportunityFailed: false,
  trends: areaTrends(),
  trendsFailed: false,
  enrolled: areaEnrolled(),
  enrolledFailed: false,
  kindergartens: areaKindergartens(),
  radiusKm: 3,
  ...changes,
})

describe('合併組的參觀率只除半徑內組員的孩子數', () => {
  it('各里表：組內只有寶業里在半徑內（11 位、200 位），參觀率 5.5%，不是 11 ÷ 整組 583', () => {
    const group = villageTableRows(areaTrends(), areaOpportunity(), null).find((row) => row.place === GROUP)!
    expect(group.visit).toBe(11)
    expect(group.rate).toBeCloseTo(5.5, 6)
  })

  it('里卡片：招生機會那列同樣是 11 ÷ 200', () => {
    const f = villageFacts('64000050025', sources())!
    expect(f.kids.rows.find((row) => row.label === '招生機會')?.value).toBe('參觀 11 位（5.5%）')
  })
})

describe('里卡片：合併組裡在半徑外的里', () => {
  it('副標寫在半徑外，不沿用組裡最近那個里的距離', () => {
    const boundaries = villageBoundaries()
    boundaries.features.push(northVillage(FAR, 5000))
    const trends = areaTrends()
    trends.villages.find((row) => row.merged)!.codes.push(FAR)
    const f = villageFacts(FAR, sources({ boundaries, trends }))!
    expect(f.subtitle).toBe('在本校 3 公里外')
    expect(f.kids.mergeNote).toContain('合併計算')
  })

  it('半徑內的組員照用自己的距離', () => {
    const f = villageFacts('64000050025', sources())!
    expect(f.subtitle.startsWith('距本校 300 m')).toBe(true)
  })
})

describe('總結句寫明合併組帶進來的半徑外里數', () => {
  it('villages_outside 大於 0 時補一句', () => {
    const trends = areaTrends()
    trends.baseline = { ...trends.baseline!, villages_outside: 2 } as typeof trends.baseline
    expect(trendsSummary(trends)!.kids[0]).toMatch(
      /^本校 3 公里內 4 個里（另含里界調整合併進來、在 3 公里外的 2 個里），2–5 歲孩子 1,400 位/,
    )
  })

  it('沒有（0 或舊回應沒有這欄）時句子不變', () => {
    expect(trendsSummary(areaTrends())!.kids[0]).toMatch(/^本校 3 公里內 4 個里，2–5 歲孩子 1,400 位/)
  })
})
