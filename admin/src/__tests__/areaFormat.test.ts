import { describe, expect, it } from 'vitest'
import {
  bandLabel, campusNotLocatedReason, districtBounds, doorplateVersionLabel, formatDistance, kindLabel, legendRanges, levelOf, reasonLabel, shortDay, shortName,
  visitGeoText,
} from '../components/admissions/area/areaFormat'
import { areaKindergartens, areaStats, villageBoundaries } from './admissionsTestKit'

const geo = (changes: Record<string, unknown> = {}) => ({ village: null, match_level: 'exact', unlocated_reason: null, distance_m: null, ...changes }) as never

describe('區域分析格式（2026-10-08）', () => {
  it('里界 5 級：0 筆是 0 級；其餘依最多的那一里等分；圖例和分級一致', () => {
    expect([0, 1, 2, 3].map((count) => levelOf(count, 3))).toEqual([0, 2, 4, 5])
    expect(levelOf(5, 0)).toBe(0)
    expect(legendRanges(3)).toEqual([{ level: 2, label: '1' }, { level: 4, label: '2' }, { level: 5, label: '3' }])
    expect(legendRanges(12)).toEqual([
      { level: 1, label: '1–2' }, { level: 2, label: '3–4' }, { level: 3, label: '5–7' }, { level: 4, label: '8–9' }, { level: 5, label: '10–12' },
    ])
    expect(legendRanges(0)).toEqual([])
    for (const max of [1, 3, 7, 12, 40]) {
      for (const { level, label } of legendRanges(max)) {
        const [low, high = low] = label.split('–').map(Number)
        expect(levelOf(low!, max)).toBe(level)
        expect(levelOf(high!, max)).toBe(level)
      }
    }
  })

  it('類型、距離分組、原因、門牌版本、日期、距離、園名', () => {
    expect(['public', 'nonprofit', 'quasi_public', 'private', 'other'].map(kindLabel)).toEqual(['公立', '非營利', '準公共', '私立', 'other'])
    expect(['0-1', '1-3', '3-6', '6+', 'none'].map(bandLabel)).toEqual(['1 公里內', '1–3 公里', '3–6 公里', '6 公里以上', '無距離'])
    expect(['no_address', 'outside_kaohsiung', 'no_doorplate', 'ambiguous_village', 'anonymized'].map(reasonLabel))
      .toEqual(['沒填地址', '非高雄市地址', '查無門牌', '里有歧義', '已匿名化'])
    expect(doorplateVersionLabel('115-10')).toBe('115 年 10 月')
    expect(doorplateVersionLabel('115-09')).toBe('115 年 9 月')
    expect(doorplateVersionLabel('local')).toBe('local')
    expect(shortDay('2026-10-07T18:30:00Z')).toBe('10/08')
    expect(shortDay(null)).toBe('—')
    expect([0, 34, 420, 999, 1000, 1240, null].map(formatDistance)).toEqual(['0 m', '30 m', '420 m', '1000 m', '1.0 km', '1.2 km', '—'])
    expect(shortName('高雄市私立小樹幼兒園')).toBe('小樹幼兒園')
    expect(shortName('高雄市立大樹幼兒園')).toBe('大樹幼兒園')
    expect(shortName('高雄市三民區某某國小附設幼兒園')).toBe('三民區某某國小附設幼兒園')
    expect(shortName('臺南市私立某幼兒園')).toBe('臺南市私立某幼兒園')
  })

  it('本校沒有座標的原因（R8）：三種對照文案；不認得的值與沒有原因回 undefined，由呼叫端兜底', () => {
    expect(['no_address', 'pending', 'no_doorplate'].map((reason) => campusNotLocatedReason(reason)))
      .toEqual(['找不到本校地址', '門牌資料尚未匯入', '本校地址比對不到門牌'])
    expect(campusNotLocatedReason('mystery')).toBeUndefined()
    expect(campusNotLocatedReason('constructor')).toBeUndefined()
    expect(campusNotLocatedReason(null)).toBeUndefined()
  })

  it('行政區範圍（本校沒座標時地圖框住這一區）：同區所有里的外框，Polygon 與 MultiPolygon 都算；GeoJSON 是經度在前', () => {
    const multi = {
      type: 'FeatureCollection' as const,
      features: [
        ...villageBoundaries().features,
        {
          type: 'Feature' as const,
          properties: { TOWNNAME: '鼓山區', VILLNAME: '登山里', VILLCODE: '' },
          geometry: {
            type: 'MultiPolygon',
            coordinates: [[[[120.26, 22.62], [120.27, 22.62], [120.27, 22.63], [120.26, 22.62]]], [[[120.25, 22.61], [120.255, 22.61], [120.25, 22.615], [120.25, 22.61]]]],
          },
        },
      ],
    }
    expect(districtBounds(multi as never, '三民區')).toEqual([[22.64, 120.34], [22.65, 120.35]])
    expect(districtBounds(multi as never, '鼓山區')).toEqual([[22.61, 120.25], [22.65, 120.35]])
    expect(districtBounds(multi as never, '旗津區')).toBeNull()
    expect(districtBounds(multi as never, null)).toBeNull()
  })

  it('訪視明細的比對結果：到里帶距離；只到區寫原因；未定位寫原因；沒有比對紀錄、沒填地址、已匿名化不列', () => {
    expect(visitGeoText(geo({ village: '本揚里', distance_m: 1200 }), '三民區')).toBe('三民區本揚里・距本校 1.2 km')
    expect(visitGeoText(geo({ village: '本揚里', match_level: 'street' }), '三民區')).toBe('三民區本揚里')
    expect(visitGeoText(geo({ match_level: 'district', unlocated_reason: 'ambiguous_village' }), '三民區')).toBe('三民區（里有歧義）')
    expect(visitGeoText(geo({ match_level: 'district' }), '三民區')).toBe('三民區（只到區）')
    expect(visitGeoText(geo({ match_level: 'unlocated', unlocated_reason: 'no_doorplate' }), null)).toBe('未定位：查無門牌')
    expect(visitGeoText(geo({ match_level: 'unlocated', unlocated_reason: 'outside_kaohsiung' }), null)).toBe('非高雄市地址')
    expect(visitGeoText(geo({ match_level: 'pending' }), null)).toBe('待比對')
    expect(visitGeoText(geo({ match_level: 'unlocated', unlocated_reason: 'no_address' }), null)).toBe('')
    expect(visitGeoText(geo({ match_level: 'unlocated', unlocated_reason: 'anonymized' }), '三民區')).toBe('')
    expect(visitGeoText(geo({ match_level: 'district', unlocated_reason: 'anonymized' }), '三民區')).toBe('')
    expect(visitGeoText(null, '三民區')).toBe('')
  })
})

describe('區域分析測試假資料（主控裁定 R15）', () => {
  it('筆數守住兩條不變式：到里＋只到區＋未定位＋待比對＝有地址；有地址＋沒填＋匿名化＝參觀', () => {
    const { totals, districts, villages, distance_bands: bands } = areaStats()
    expect(totals.village_level + totals.district_level + totals.unlocated + totals.pending).toBe(totals.with_address)
    expect(totals.with_address + totals.no_address + totals.anonymized).toBe(totals.visit)
    expect(bands.reduce((sum, band) => sum + band.visit, 0)).toBe(totals.visit)
    expect(villages.reduce((sum, row) => sum + row.visit, 0)).toBe(totals.village_level)
    for (const district of districts) {
      expect(villages.filter((row) => row.district === district.district).reduce((sum, row) => sum + row.visit, 0)).toBeLessThanOrEqual(district.visit)
    }
    // 里界沒有 no_address／anonymized：它們各有自己的筆數，不重複列在原因裡。
    expect(totals.unlocated_reasons.map((item) => item.reason).sort()).toEqual(['ambiguous_village', 'no_doorplate'])
    expect(totals.unlocated_reasons.reduce((sum, item) => sum + item.count, 0)).toBe(totals.district_level + totals.unlocated)
  })

  it('里的代碼用真值：里界檔和里表對得上；幼兒園地址沒有郵遞區號前綴（照 parse_preschools 存的樣子）', () => {
    const codes = new Map(villageBoundaries().features.map((feature) => [`${feature.properties.TOWNNAME}/${feature.properties.VILLNAME}`, feature.properties.VILLCODE]))
    expect(codes.get('三民區/鼎金里')).toBe('64000050001')
    for (const row of areaStats().villages) {
      if (row.village_code) expect(codes.get(`${row.district}/${row.village}`)).toBe(row.village_code)
    }
    for (const item of areaKindergartens().items as { address: string }[]) {
      expect(item.address).not.toMatch(/^\[\d+\]/)
    }
  })
})
