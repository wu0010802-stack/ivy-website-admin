import { describe, expect, it } from 'vitest'
import {
  NOT_JUDGED_NOTE, distanceMeters, featureCentroid, featureCode, findFeature, outsideRadiusText, villageFacts,
  type FactRow, type FactsSources,
} from '../components/admissions/area/villageFacts'
import { opportunitySummary } from '../components/admissions/area/areaFormat'
import type { AdmissionsArea, AreaKindergarten, AreaOpportunityRow, VillageFeature } from '../api/types'
import {
  areaEnrolled, areaKindergartens, areaOpportunity, areaStats, areaTrends, kindergarten, villageBoundaries,
} from './admissionsTestKit'

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

type Section = { rows: FactRow[] }
const rows = (section: Section) => section.rows.map((row) => (row.detail === undefined ? [row.label, row.value] : [row.label, row.value, row.detail]))
const find = (section: Section, label: string) => section.rows.find((row) => row.label === label)
const value = (section: Section, label: string) => find(section, label)?.value
const detail = (section: Section, label: string) => find(section, label)?.detail

const CAMPUS = { lat: 22.642456, lng: 120.343713 }
const METERS_PER_DEGREE_LAT = (Math.PI / 180) * 6371000

/** 以 (lat, lng) 為頂點平均的小三角形里界（外環收尾點與第一點相同）。 */
const triangle = (town: string, village: string, code: string, lat: number, lng: number): VillageFeature => ({
  type: 'Feature',
  properties: { TOWNNAME: town, VILLNAME: village, VILLCODE: code },
  geometry: {
    type: 'Polygon',
    coordinates: [[[lng - 0.001, lat - 0.0005], [lng + 0.001, lat - 0.0005], [lng, lat + 0.001], [lng - 0.001, lat - 0.0005]]],
  },
})
/** 校區正北 meters 公尺處的里（里中心就在那裡）。 */
const northVillage = (code: string, meters: number) => triangle('左營區', `北${meters}里`, code, CAMPUS.lat + meters / METERS_PER_DEGREE_LAT, CAMPUS.lng)
const withFeature = (feature: VillageFeature) => {
  const boundaries = villageBoundaries()
  boundaries.features.push(feature)
  return boundaries
}
/** 招生機會列多一個里，這個里就是「半徑內有資料」而不是半徑外。 */
const oppWithRow = (code: string, name: string, distance_m: number) => {
  const opportunity = areaOpportunity()
  opportunity.villages.push({ district: '左營區', village: name, village_code: code, distance_m, children: 100, infants: 30, visit: 1, rate: 1, expected: 1, shortfall: 0, signal: 'typical' })
  return opportunity
}

describe('里卡片的資料組合（2026-10-16 規格 §2.4）', () => {
  it('一般的里：本揚里的孩子、我們、附近幼兒園', () => {
    const f = villageFacts('64000050015', sources())!
    expect(f.code).toBe('64000050015')
    expect(f.title).toBe('三民區本揚里')
    expect(f.subtitle).toBe('距本校 300 m・東光國小學區')
    expect(f.kids.state).toBe('ok')
    expect(f.kids.mergeNote).toBe('')
    expect(rows(f.kids)).toEqual([
      ['2–5 歲', '317 位'], ['0–1 歲', '90 位'], ['這一年淨增', '+36（+12.8%）', '增加多'],
      ['近 12 個月出生', '36 位'], ['近 12 個月淨遷入', '−122 人'], ['近 4 季新屋交屋', '24 筆'], ['所得中位數', '45.8 萬'],
      ['招生機會', '參觀 6 位（2.0%）', '照附近應有約 6 位・差不多'],
    ])
    expect(find(f.kids, '這一年淨增')!.tone).toBe('up')
    expect(find(f.kids, '近 12 個月淨遷入')!.tone).toBe('down')
    expect(rows(f.ours)).toEqual([['在籍', '3 位', '幼幼 0・小 2・中 1・大 0'], ['參觀', '3 位', '預繳 1']])
    expect(f.ours.state).toBe('ok')
    expect(f.ours.openRecordsArea).toBe('三民區/本揚里')
    expect(f.nearby!.map((k) => k.name)).toEqual(['常春藤幼兒園', '大樹幼兒園'])
    expect(f.nearby![0]!.kindLabel).toBe('本機構')
    expect(f.nearby![1]!.kindLabel).toBe('公立')
    expect(f.nearby![0]!.kind).toBe('private')
    // 距離是到里中心（三角形頂點平均），不是到本校：本機構在本校 0 m，離里中心 318 m
    expect(f.nearby!.map((k) => k.distance)).toEqual(['318 m', '414 m'])
  })

  it('merged member picked on map：龍子里用整組數字、寫和寶業里合併', () => {
    const f = villageFacts('64000020015', sources())!
    expect(f.title).toBe('鼓山區龍子里')
    expect(f.kids.state).toBe('ok')
    expect(f.kids.mergeNote).toBe('里界調整，和寶業里合併計算')
    expect(value(f.kids, '2–5 歲')).toBe('583 位')
    expect(value(f.kids, '0–1 歲')).toBe('60 位')
    expect(value(f.kids, '這一年淨增')).toBe('+12（+2.0%）')
    expect(value(f.kids, '近 12 個月出生')).toBe('90 位')
    expect(value(f.kids, '近 12 個月淨遷入')).toBe('+30 人')
    expect(value(f.kids, '所得中位數')).toBe('—')
    expect(value(f.kids, '招生機會')).toBe('參觀 11 位（1.9%）') // 組內只有寶業里有列：11 ÷ 583
    expect(detail(f.kids, '招生機會')).toBe('照附近應有約 4 位') // 合併組不寫判讀
    // 副標用組的距離與學區
    expect(f.subtitle).toBe('距本校 300 m・光武國小（部分）、鼓山區龍華國小（部分）學區') // 學校在別的區前面加區名
    // 我們：龍子里在 area.villages 的 village_code 是 null，靠區＋里名對；沒有在籍
    expect(rows(f.ours)).toEqual([['在籍', '0 位'], ['參觀', '1 位', '預繳 0']])
    expect(f.ours.openRecordsArea).toBe('鼓山區/龍子里')
  })

  it('merged group 選另一個里：寶業里也寫和龍子里合併；新屋用這個里自己的筆數', () => {
    const trends = areaTrends()
    const group = trends.villages.find((row) => row.merged)!
    group.new_homes = 9
    group.new_homes_by_code = { '64000050025': 4, '64000020015': 5 }
    const f = villageFacts('64000050025', sources({ trends }))!
    expect(f.kids.mergeNote).toBe('里界調整，和龍子里合併計算')
    expect(value(f.kids, '近 4 季新屋交屋')).toBe('4 筆')
    expect(detail(f.kids, '近 4 季新屋交屋')).toBe('整組 9 筆')
    const other = villageFacts('64000020015', sources({ trends }))!
    expect(value(other.kids, '近 4 季新屋交屋')).toBe('5 筆')
    expect(detail(other.kids, '近 4 季新屋交屋')).toBe('整組 9 筆')
  })

  it('合併組新屋交屋：共用 fixture 整組 0 筆；一般的里與新成屋未匯入沒有小字', () => {
    const merged = villageFacts('64000020015', sources())!
    expect(value(merged.kids, '近 4 季新屋交屋')).toBe('0 筆')
    expect(detail(merged.kids, '近 4 季新屋交屋')).toBe('整組 0 筆')
    expect(detail(villageFacts('64000050015', sources())!.kids, '近 4 季新屋交屋')).toBeUndefined()
    const trends = areaTrends()
    for (const row of trends.villages) row.new_homes = null
    const notImported = villageFacts('64000020015', sources({ trends }))!
    expect(find(notImported.kids, '近 4 季新屋交屋')).toEqual({ label: '近 4 季新屋交屋', value: '—' })
  })

  it('合併組照附近應有：組內有一個里沒有附近平均就不寫，兩個都有才加總', () => {
    const opportunity = areaOpportunity()
    const member: AreaOpportunityRow = { district: '鼓山區', village: '龍子里', village_code: '64000020015', distance_m: 400, children: 150, infants: 40, visit: 2, rate: 1.3, expected: 3, shortfall: 1, signal: 'typical' }
    opportunity.villages.push(member)
    const both = villageFacts('64000020015', sources({ opportunity }))!
    expect(value(both.kids, '招生機會')).toBe('參觀 13 位（2.2%）') // 11 + 2 ÷ 583
    expect(detail(both.kids, '招生機會')).toBe('照附近應有約 7 位') // 4 + 3
    expect(value(both.kids, '0–1 歲')).toBe('100 位') // 60 + 40
    member.expected = null
    const partial = villageFacts('64000020015', sources({ opportunity }))!
    expect(value(partial.kids, '招生機會')).toBe('參觀 13 位（2.2%）')
    expect(detail(partial.kids, '招生機會')).toBeUndefined()
  })

  it('judged 為 false：卡片不列招生機會', () => {
    const opportunity = areaOpportunity()
    opportunity.baseline = { ...opportunity.baseline!, judged: false }
    const f = villageFacts('64000050015', sources({ opportunity }))!
    expect(f.kids.state).toBe('ok')
    expect(find(f.kids, '招生機會')).toBeUndefined()
    // 2–5 歲與其他孩子數不受參觀門檻影響
    expect(value(f.kids, '2–5 歲')).toBe('317 位')
    expect(value(f.kids, '0–1 歲')).toBe('90 位')
    // 合併組也一樣
    expect(find(villageFacts('64000020015', sources({ opportunity }))!.kids, '招生機會')).toBeUndefined()
  })

  it('判讀欄各種訊號：明顯偏少寫少了幾位、沒有附近平均就不寫應有', () => {
    const below = villageFacts('64000050001', sources())!
    expect(value(below.kids, '招生機會')).toBe('參觀 3 位（0.6%）')
    expect(detail(below.kids, '招生機會')).toBe('照附近應有約 10 位・少了約 7 位')
    const opportunity = areaOpportunity()
    opportunity.villages.find((row) => row.village_code === '64000050001')!.expected = null
    expect(detail(villageFacts('64000050001', sources({ opportunity }))!.kids, '招生機會')).toBe('少了約 7 位')
  })

  it('半徑外：三種文案（D20）', () => {
    expect(outsideRadiusText(2000, 1)).toBe('在本校 1 公里外，孩子數只算範圍內的里；把範圍改成 3 公里就看得到。')
    expect(outsideRadiusText(4000, 3)).toBe('在本校 3 公里外，孩子數只算範圍內的里；把範圍改成 6 公里就看得到。')
    expect(outsideRadiusText(8000, 3)).toBe('在本校 6 公里外，沒有孩子數。')
    expect(outsideRadiusText(8000, 6)).toBe('在本校 6 公里外，沒有孩子數。')
    // 範圍 1、中心在 3～6 公里：改成 3 公里還是看不到，直接寫 6 公里
    expect(outsideRadiusText(4000, 1)).toBe('在本校 1 公里外，孩子數只算範圍內的里；把範圍改成 6 公里就看得到。')
    // 邊界：3 公里整算 3 公里內；範圍 6 時中心落在 6 公里內（和後端中心的誤差）也不能叫人改成 6
    expect(outsideRadiusText(3000, 1)).toBe('在本校 1 公里外，孩子數只算範圍內的里；把範圍改成 3 公里就看得到。')
    expect(outsideRadiusText(5900, 6)).toBe('在本校 6 公里外，沒有孩子數。')
  })

  it('半徑外的里：只列在籍與參觀、副標不寫距離、不列附近幼兒園', () => {
    // 左營區新上里 64000030020 在本校東北約 8 km（座標 120.30, 22.70 附近）
    const boundaries = withFeature(triangle('左營區', '新上里', '64000030020', 22.7, 120.3))
    const f = villageFacts('64000030020', sources({ boundaries }))!
    expect(f.title).toBe('左營區新上里')
    expect(f.kids.state).toBe('outside')
    expect(f.kids.note).toBe('在本校 6 公里外，沒有孩子數。')
    expect(f.kids.rows).toEqual([])
    expect(f.subtitle).toBe('在本校 3 公里外')
    expect(rows(f.ours)).toEqual([['在籍', '1 位', '幼幼 0・小 0・中 0・大 1'], ['參觀', '0 位']])
    expect(f.ours.openRecordsArea).toBeNull()
    expect(f.nearby).toBeNull()
    expect(distanceMeters(featureCentroid(boundaries.features.at(-1)!), CAMPUS)).toBeGreaterThan(7000)
    // 範圍 6：同一句；範圍 1 的副標寫 1 公里
    expect(villageFacts('64000030020', sources({ boundaries, radiusKm: 1 }))!.subtitle).toBe('在本校 1 公里外')
  })

  it('半徑外的里：中心離本校 2～3 公里，範圍 1 時寫改成 3 公里就看得到', () => {
    const boundaries = withFeature(northVillage('64000030021', 2000))
    const f = villageFacts('64000030021', sources({ boundaries, radiusKm: 1 }))!
    expect(f.kids.state).toBe('outside')
    expect(f.kids.note).toBe('在本校 1 公里外，孩子數只算範圍內的里；把範圍改成 3 公里就看得到。')
    expect(f.nearby).toBeNull()
  })

  describe('讀取狀態分段', () => {
    it('opportunity 與 trends 都 null → kids loading；都失敗 → failed；一份失敗另一份還在讀仍是 loading', () => {
      const loading = villageFacts('64000050015', sources({ opportunity: null, trends: null }))!
      expect(loading.kids).toMatchObject({ state: 'loading', rows: [], note: '', mergeNote: '' })
      expect(loading.subtitle).toBe('')
      // 其他段不受影響
      expect(loading.ours.state).toBe('ok')
      expect(rows(loading.ours)).toHaveLength(2)
      expect(loading.nearby).not.toBeNull()
      expect(villageFacts('64000050015', sources({ opportunity: null, trends: null, opportunityFailed: true, trendsFailed: true }))!.kids.state).toBe('failed')
      expect(villageFacts('64000050015', sources({ opportunity: null, trends: null, opportunityFailed: true }))!.kids.state).toBe('loading')
      expect(villageFacts('64000050015', sources({ opportunity: null, trends: null, trendsFailed: true }))!.kids.state).toBe('loading')
    })

    it('只有一份載入：任何一份還在讀 → loading，沒有在讀但有一份失敗 → failed，都不能判成半徑外', () => {
      // trends 還在讀：龍子里不在 opportunity 的列裡，卻在 trends 的合併組裡，不能因此寫成半徑外
      for (const code of ['64000020015', '64000050015']) {
        const f = villageFacts(code, sources({ trends: null }))!
        expect(f.kids).toMatchObject({ state: 'loading', rows: [], note: '', mergeNote: '' })
        expect(f.subtitle).not.toContain('公里外')
      }
      const loadingMerged = villageFacts('64000020015', sources({ trends: null }))!
      expect(loadingMerged.subtitle).toBe('')
      expect(loadingMerged.nearby).not.toBeNull() // 里在半徑內，附近的幼兒園照列
      // opportunity 還在讀：之後才會知道這個里有沒有人口，現在不判
      expect(villageFacts('64000050015', sources({ opportunity: null }))!.kids.state).toBe('loading')
      const noPopulation = areaOpportunity()
      noPopulation.villages = noPopulation.villages.filter((row) => row.village_code !== '64000050015')
      noPopulation.no_population_villages = [{ district: '三民區', village: '本揚里', village_code: '64000050015', distance_m: 300, visit: 3 }]
      expect(villageFacts('64000050015', sources({ opportunity: noPopulation, trends: null }))!.kids.state).toBe('loading')
      // 一份載入、另一份還在讀，里在已載入的那份沒有：仍是 loading，不是 outside
      const far = withFeature(northVillage('64000030021', 2000))
      for (const changes of [{ trends: null }, { opportunity: null }]) {
        const f = villageFacts('64000030021', sources({ boundaries: far, ...changes }))!
        expect(f.kids.state).toBe('loading')
        expect(f.subtitle).toBe('')
        expect(f.nearby).not.toBeNull() // 中心離本校 2 km，在 3 km 減 0.5 km 的門檻內：沒判半徑外，園所照列
      }
      // 有一份失敗、另一份已載入或失敗：failed（不是 outside、不是 ok）
      for (const code of ['64000020015', '64000050015']) {
        expect(villageFacts(code, sources({ trends: null, trendsFailed: true }))!.kids).toMatchObject({ state: 'failed', rows: [], note: '' })
        expect(villageFacts(code, sources({ opportunity: null, opportunityFailed: true }))!.kids).toMatchObject({ state: 'failed', rows: [], note: '' })
      }
      expect(villageFacts('64000030021', sources({ boundaries: far, trends: null, trendsFailed: true }))!.kids.state).toBe('failed')
    })

    it('enrolled 讀取中／失敗只影響我們段', () => {
      const failed = villageFacts('64000050015', sources({ enrolled: null, enrolledFailed: true }))!
      expect(failed.ours.state).toBe('failed')
      expect(rows(failed.ours)).toEqual([['參觀', '3 位', '預繳 1']])
      expect(failed.ours.openRecordsArea).toBe('三民區/本揚里')
      expect(failed.kids.state).toBe('ok')
      expect(failed.nearby).not.toBeNull()
      expect(villageFacts('64000050015', sources({ enrolled: null }))!.ours.state).toBe('loading')
    })

    it('幼兒園名單還沒回來：附近的幼兒園是 null', () => {
      expect(villageFacts('64000050015', sources({ kindergartens: null }))!.nearby).toBeNull()
    })
  })

  describe('在籍', () => {
    it('清冊未匯入：不列在籍；ready 但這個里沒有人：寫 0 位', () => {
      const notImported = villageFacts('64000050015', sources({ enrolled: areaEnrolled({ status: 'not_imported', villages: [] }) }))!
      expect(notImported.ours.state).toBe('ok')
      expect(rows(notImported.ours)).toEqual([['參觀', '3 位', '預繳 1']])
      expect(rows(villageFacts('64000050001', sources())!.ours)).toEqual([['在籍', '0 位'], ['參觀', '0 位']])
    })

    it('在籍對不到代碼時用區＋里名回退；其他班大於 0 才接', () => {
      const enrolled = areaEnrolled()
      const row = enrolled.villages.find((item) => item.village === '本揚里')!
      row.village_code = null
      row.counts = { ...row.counts, 其他: 2 }
      const f = villageFacts('64000050015', sources({ enrolled }))!
      expect(rows(f.ours)[0]).toEqual(['在籍', '5 位', '幼幼 0・小 2・中 1・大 0・其他 2'])
    })
  })

  describe('沒有人口資料、人口未匯入、本校沒座標', () => {
    it('沒有人口資料的里：孩子段寫原因，其餘段照列', () => {
      const opportunity = areaOpportunity()
      opportunity.villages = opportunity.villages.filter((row) => row.village_code !== '64000050015')
      opportunity.no_population_villages = [{ district: '三民區', village: '本揚里', village_code: '64000050015', distance_m: 300, visit: 3 }]
      const f = villageFacts('64000050015', sources({ opportunity }))!
      expect(f.kids).toMatchObject({ state: 'no-population', rows: [], note: '這個里沒有人口資料。', mergeNote: '' })
      expect(f.subtitle).toBe('距本校 300 m・東光國小學區')
      expect(rows(f.ours)).toEqual([['在籍', '3 位', '幼幼 0・小 2・中 1・大 0'], ['參觀', '3 位', '預繳 1']])
    })

    it('人口未匯入：招生機會用不了，孩子段寫那句原因', () => {
      const opportunity = areaOpportunity({
        population: { ...areaOpportunity().population, version: null }, baseline: null, villages: [],
      })
      const f = villageFacts('64000050015', sources({ opportunity }))!
      expect(f.kids).toMatchObject({ state: 'unavailable', rows: [], note: '各里人口資料尚未匯入；匯入後就能看哪些里孩子多、參觀少。' })
      expect(f.ours.state).toBe('ok')
    })

    it('本校沒座標：孩子段寫原因、不列附近幼兒園', () => {
      const campus = { ...areaStats().campus, lat: null, lng: null, locate_error: 'no_address' }
      const f = villageFacts('64000050015', sources({
        area: areaStats({ campus }) as AdmissionsArea,
        opportunity: areaOpportunity({ campus, baseline: null, villages: [] }),
      }))!
      expect(f.kids).toMatchObject({ state: 'unavailable', note: '本校位置未標示（找不到本校地址），算不出附近有哪些里。' })
      expect(f.nearby).toBeNull()
      expect(f.ours.state).toBe('ok')
    })

    it('兩份都載入但 area 的本校沒座標（資料不一致）：算不出半徑外，孩子段寫共用的未標示句', () => {
      const campus = { ...areaStats().campus, lat: null, lng: null, locate_error: 'pending' }
      const boundaries = withFeature(northVillage('64000030021', 2000))
      const f = villageFacts('64000030021', sources({ boundaries, area: areaStats({ campus }) as AdmissionsArea }))!
      expect(f.kids).toMatchObject({ state: 'unavailable', note: '本校位置未標示（門牌資料尚未匯入），算不出附近有哪些里。' })
      expect(f.subtitle).toBe('')
      expect(f.nearby).toBeNull()
    })
  })

  describe('附近幼兒園（D8）', () => {
    const near = (distances: number[]): AreaKindergarten[] =>
      distances.map((distance_m) => kindergarten({ source_id: `kg-${distance_m}`, name: `高雄市私立K${distance_m}幼兒園`, distance_m }))

    it('里中心離本校超過半徑減 0.5 km 不列', () => {
      const kindergartens = areaKindergartens(near([2600, 2650]))
      const farOpp = oppWithRow('64000030022', '北2600里', 2600)
      const far = villageFacts('64000030022', sources({ boundaries: withFeature(northVillage('64000030022', 2600)), opportunity: farOpp, kindergartens }))!
      expect(far.kids.state).toBe('ok')
      expect(far.nearby).toBeNull()
      // 剛好在 2.3 km（< 2.5 km）就列
      const nearOpp = oppWithRow('64000030021', '北2300里', 2300)
      const ok = villageFacts('64000030021', sources({
        boundaries: withFeature(northVillage('64000030021', 2300)), opportunity: nearOpp, kindergartens: areaKindergartens(near([2300])),
      }))!
      expect(ok.nearby!.map((k) => k.name)).toEqual(['K2300幼兒園'])
    })

    it('範圍 1：門檻是 0.5 km，本揚里（中心約 320 m）仍列', () => {
      expect(villageFacts('64000050015', sources({ radiusKm: 1 }))!.nearby).toHaveLength(2)
    })

    it('500 m 內、依距離近到遠、最多 5 所、超過 500 m 不列', () => {
      const kindergartens = areaKindergartens(near([2900, 2750, 2650, 2400, 2300, 2250, 2100, 1700]))
      const f = villageFacts('64000030021', sources({
        boundaries: withFeature(northVillage('64000030021', 2300)), opportunity: oppWithRow('64000030021', '北2300里', 2300), kindergartens,
      }))!
      expect(f.nearby!.map((k) => k.name)).toEqual(['K2300幼兒園', 'K2250幼兒園', 'K2400幼兒園', 'K2100幼兒園', 'K2650幼兒園'])
      expect(f.nearby![0]!.distance).toBe('0 m')
      expect(f.nearby![1]!.distance).toBe('50 m')
    })

    it('沒有任何園所在 500 m 內：空陣列（有查過，沒有）', () => {
      const f = villageFacts('64000030021', sources({
        boundaries: withFeature(northVillage('64000030021', 2300)), opportunity: oppWithRow('64000030021', '北2300里', 2300),
        kindergartens: areaKindergartens(near([800])),
      }))!
      expect(f.nearby).toEqual([])
    })
  })

  it('里界沒有的代碼回 null', () => {
    expect(villageFacts('64000099999', sources())).toBeNull()
  })

  it('NOT_JUDGED_NOTE 就是招生機會總結的判讀句', () => {
    expect(NOT_JUDGED_NOTE).toBe('附近參觀還不到 10 位，先不判斷哪些里偏少。')
    const opportunity = areaOpportunity()
    opportunity.baseline = { ...opportunity.baseline!, judged: false }
    expect(opportunitySummary(opportunity)!.verdict).toBe(NOT_JUDGED_NOTE)
  })
})

describe('里界幾何', () => {
  it('featureCentroid：Polygon 外環頂點平均，去掉和第一點重複的收尾點', () => {
    const square: VillageFeature = {
      type: 'Feature', properties: { TOWNNAME: 'A', VILLNAME: 'B', VILLCODE: '1' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]] },
    }
    expect(featureCentroid(square)).toEqual({ lat: 2, lng: 2 })
    // 收尾點若沒有重複就不能少算
    const open: VillageFeature = { ...square, geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4]]] } }
    expect(featureCentroid(open)).toEqual({ lat: 2, lng: 2 })
    // 洞不算：只看外環
    const holed: VillageFeature = {
      ...square,
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 1]]] },
    }
    expect(featureCentroid(holed)).toEqual({ lat: 2, lng: 2 })
  })

  it('featureCentroid：MultiPolygon 取面積最大的那個多邊形（外島不拉偏）', () => {
    const feature: VillageFeature = {
      type: 'Feature', properties: { TOWNNAME: 'A', VILLNAME: 'B', VILLCODE: '1' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[100, 100], [101, 100], [101, 101], [100, 100]]],
          [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]],
        ],
      },
    }
    expect(featureCentroid(feature)).toEqual({ lat: 2, lng: 2 })
  })

  it('distanceMeters：haversine（R = 6,371,000 m）', () => {
    expect(distanceMeters({ lat: 22, lng: 120 }, { lat: 22, lng: 120 })).toBe(0)
    // 緯度差 1 度＝ R × π / 180
    expect(distanceMeters({ lat: 22, lng: 120 }, { lat: 23, lng: 120 })).toBeCloseTo((6371000 * Math.PI) / 180, 3)
    expect(distanceMeters({ lat: 22.642456, lng: 120.343713 }, { lat: 22.642456 + 300 / METERS_PER_DEGREE_LAT, lng: 120.343713 })).toBeCloseTo(300, 3)
  })

  it('findFeature／featureCode：代碼找里界，區＋里名找代碼', () => {
    const boundaries = villageBoundaries()
    expect(findFeature(boundaries, '64000020015')!.properties.VILLNAME).toBe('龍子里')
    expect(findFeature(boundaries, '64000099999')).toBeUndefined()
    expect(featureCode(boundaries, '鼓山區', '龍子里')).toBe('64000020015')
    expect(featureCode(boundaries, '三民區', '龍子里')).toBeNull()
    expect(featureCode(boundaries, '三民區', '不存在里')).toBeNull()
  })
})
