import { describe, expect, it } from 'vitest'
import {
  MAP_MODES, NEARBY_KINDS, babycareFeeText, babycareKindLabel, babycareMeta, babycareShortName, babycareStatusText, babycareSummaryText, bandLabel, campusNotLocatedReason,
  changeDateText, changeLabel, changesEmptyText, changesSubtitle, districtBounds, doorplateVersionLabel, enrolledBandRows, enrolledLegendText, enrolledMapNote,
  enrolledVillageRows, expectedText, formatDistance, gradeOptions,
  homesCount, homesMapNote, homesMax, homesText, incomeText, kidsLevelTone, kidsNetText, kindChangeText, kindLabel, legendRanges, levelOf, opportunitySummary, opportunityUnavailable,
  pointCount, pointPopupText, providerLabel, reasonLabel, schoolKidsNetText, schoolVillagesText, seasonRange, shortName, signalText, signalTone, signedCount, taipeiMonthDay,
  trackingNote, trendMapNote, trendsPlaceName, trendsSummary, villageSchoolsText, visitGeoText,
  NO_CHILDREN_DATA_TEXT, NO_LOCATED_VISITS_TEXT, NO_NEW_HOMES_TEXT,
} from '../components/admissions/area/areaFormat'
import type { VillageBoundaries, VillageFeature, VisitGeo } from '../api/types'
import {
  areaBabycare, areaEnrolled, areaKindergartens, areaOpportunity, areaStats, areaTrends, babycareItem, providerChange, villageBoundaries,
} from './admissionsTestKit'

const OWN_CAMPUS_RADIUS_M = 50
/** 兩點的直線距離（公尺），球半徑 6371000 m，和後端 haversine_m 同一個算法。 */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(a))
}

const geo = (changes: Partial<VisitGeo> = {}): VisitGeo => ({ village: null, match_level: 'exact', unlocated_reason: null, distance_m: null, ...changes })

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
    expect(taipeiMonthDay('2026-10-07T18:30:00Z')).toBe('10/08')
    expect(taipeiMonthDay(null)).toBe('—')
    expect(taipeiMonthDay('not a date')).toBe('—')
    expect(shortName('高雄市私立小樹幼兒園')).toBe('小樹幼兒園')
    expect(shortName('高雄市立大樹幼兒園')).toBe('大樹幼兒園')
    expect(shortName('高雄市三民區某某國小附設幼兒園')).toBe('三民區某某國小附設幼兒園')
    expect(shortName('臺南市私立某幼兒園')).toBe('臺南市私立某幼兒園')
  })

  // 規則：不滿 1000 m 寫整數公尺（四捨五入到 1 m）；四捨五入後達 1000 m 起改寫公里、一位小數。
  // 以前取整到 10 m，994 m 以上會顯示成「1000 m」，同一頁又有「1.0 km」，單位在 995–999 m 之間跳不過去。
  it('距離：不滿 1000 m 寫整數公尺，995–999 m 不會變成「1000 m」；1000 m 起寫公里一位小數', () => {
    expect([0, 34, 420, 994, 995, 999, 999.4, 999.6, 1000, 1240, null, undefined].map(formatDistance))
      .toEqual(['0 m', '34 m', '420 m', '994 m', '995 m', '999 m', '999 m', '1.0 km', '1.0 km', '1.2 km', '—', '—'])
    for (let meters = 0; meters < 1000; meters++) expect(formatDistance(meters)).toBe(`${meters} m`)
    expect(formatDistance(0.4)).toBe('0 m')
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
    // 原因清單只列外縣市、查無門牌、里有歧義三種：沒填地址、已匿名化各有自己的筆數。清單合計不保證等於
    // district_level＋unlocated（只到區或未定位但沒有原因的列不會進清單），後端也沒有這條不變式，所以不在這裡守。
    expect(totals.unlocated_reasons.map((item) => item.reason).sort()).toEqual(['ambiguous_village', 'no_doorplate'])
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

  it('幼兒園的座標和 distance_m 對得上（到本校的直線距離，誤差 1 m 內）；本機構在校區 50 m 內、其他園所在 50 m 外', () => {
    const { campus } = areaKindergartens()
    const items = areaKindergartens().items as { source_id: string; lat: number; lng: number; distance_m: number; is_own: boolean }[]
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      const meters = haversineMeters(campus.lat!, campus.lng!, item.lat, item.lng)
      expect(Math.abs(meters - item.distance_m), `${item.source_id} 的座標離校區 ${meters.toFixed(1)} m，distance_m 寫 ${item.distance_m}`).toBeLessThanOrEqual(1)
      // 後端 OWN_CAMPUS_RADIUS_M（backend/app/admissions/area.py）：距任一校區 50 m 內才算本機構。
      expect(meters <= OWN_CAMPUS_RADIUS_M, item.source_id).toBe(item.is_own)
    }
    expect(items.some((item) => item.is_own)).toBe(true)
  })

  it('假資料有核定人數未知（null）的園所，介面寫得出來', () => {
    expect((areaKindergartens().items as { approved_capacity: number | null }[]).some((item) => item.approved_capacity === null)).toBe(true)
  })
})

// 型別守門：@ts-expect-error 底下那行若哪天不再報錯，vue-tsc 會把「多餘的 expect-error」當錯誤。
describe('區域分析的窄型別', () => {
  const matchLevel = (value: VisitGeo['match_level']) => value
  const reason = (value: NonNullable<VisitGeo['unlocated_reason']>) => value
  const geometry = (value: VillageFeature['geometry']) => value

  it('比對層級與未定位原因只收後端的列舉值；里界只收 Polygon／MultiPolygon', () => {
    expect(matchLevel('exact')).toBe('exact')
    // @ts-expect-error 不是後端的 match_level
    matchLevel('exactly')
    expect(reason('no_doorplate')).toBe('no_doorplate')
    // @ts-expect-error 不是後端的 unlocated_reason
    reason('far_away')
    expect(geometry({ type: 'Polygon', coordinates: [[[120.3, 22.6]]] }).type).toBe('Polygon')
    expect(geometry({ type: 'MultiPolygon', coordinates: [[[[120.3, 22.6]]]] }).type).toBe('MultiPolygon')
    // @ts-expect-error 里界沒有 Point
    geometry({ type: 'Point', coordinates: [120.3, 22.6] })
    // @ts-expect-error 座標是三層（Polygon）或四層（MultiPolygon）的 [經度, 緯度]
    geometry({ type: 'Polygon', coordinates: 'oops' })
    const collection: VillageBoundaries = villageBoundaries()
    expect(collection.features.length).toBeGreaterThan(0)
  })
})

describe('招生機會的文字（2026-10-13 規格 7）', () => {
  it('照附近應有：四捨五入成整數「約 N 位」，0 寫「不到 1 位」，沒有附近平均寫「—」；千分位', () => {
    expect([6.4, 6.5, 0.4, 0, null, 1234.2].map(expectedText)).toEqual(['約 6 位', '約 7 位', '不到 1 位', '不到 1 位', '—', '約 1,234 位'])
  })

  it('判讀：明顯偏少寫少了幾位（至少 1 位），其餘各一句', () => {
    expect(signalText({ signal: 'below', shortfall: 6.7 })).toBe('少了約 7 位')
    expect(signalText({ signal: 'below', shortfall: 0.3 })).toBe('少了約 1 位')
    expect(signalText({ signal: 'above', shortfall: -5 })).toBe('比附近多')
    expect(signalText({ signal: 'typical', shortfall: 1 })).toBe('差不多')
    expect(signalText({ signal: 'few_children', shortfall: 0.6 })).toBe('孩子少，看不出來')
    expect(signalText({ signal: 'not_judged', shortfall: 3 })).toBe('還不判斷')
  })

  it('地圖色階：偏少、比附近多、差不多各一色，其餘不上色', () => {
    expect((['below', 'above', 'typical', 'few_children', 'not_judged'] as const).map(signalTone))
      .toEqual(['chance', 'strong', 'typical', 'none', 'none'])
  })

  it('用不了的原因：人口沒匯入優先，其次本校沒座標（帶原因）；可以用回 null', () => {
    expect(opportunityUnavailable(areaOpportunity())).toBeNull()
    const noPopulation = areaOpportunity({ population: { ...areaOpportunity().population, version: null }, campus: { ...areaOpportunity().campus, lat: null } })
    expect(opportunityUnavailable(noPopulation)).toBe('各里人口資料尚未匯入；匯入後就能看哪些里孩子多、參觀少。')
    const unlocated = areaOpportunity({ campus: { ...areaOpportunity().campus, lat: null, lng: null, locate_error: 'pending' } })
    expect(opportunityUnavailable(unlocated)).toBe('本校位置未標示（門牌資料尚未匯入），算不出附近有哪些里。')
    const unknown = areaOpportunity({ campus: { ...areaOpportunity().campus, lat: null, lng: null, locate_error: 'weird' } })
    expect(opportunityUnavailable(unknown)).toBe('本校位置未標示，算不出附近有哪些里。')
  })

  it('總結：合計句、判讀句（合計少了幾位四捨五入、至少 1 位）、不算在內的人數只寫非零項、沒填地址分開寫', () => {
    expect(opportunitySummary(areaOpportunity({ baseline: null }))).toBeNull()
    expect(opportunitySummary(areaOpportunity())).toEqual({
      lead: '本校 3 公里內 3 個里，2–5 歲孩子 1,000 位，參觀 20 位（參觀率 2.0%）。',
      verdict: '明顯偏少的里 1 個，照附近的參觀率合計少了約 7 位。',
      note: '另有 2 位來自 3 公里外、1 位沒填地址、2 位沒對到里，不算在內。',
    })
    const rows = areaOpportunity().villages
    const twoSmall = areaOpportunity({
      villages: [{ ...rows[0]!, shortfall: 0.2 }, { ...rows[1]!, signal: 'below', shortfall: 0.1 }, rows[2]!],
      outside_visit: 0,
    })
    expect(opportunitySummary(twoSmall)).toMatchObject({ verdict: '明顯偏少的里 2 個，照附近的參觀率合計少了約 1 位。', note: '另有 1 位沒填地址、2 位沒對到里，不算在內。' })
    // 沒對到里的全是沒填地址（10-15 義華正式站：3 位都沒填地址，原本寫成「3 位沒對到里」）。
    const allNoAddress = areaOpportunity({ outside_visit: 0, unplaced_visit: 3, no_address_visit: 3 })
    expect(opportunitySummary(allNoAddress)!.note).toBe('另有 3 位沒填地址，不算在內。')
    const none = areaOpportunity({ villages: rows.map((row) => ({ ...row, signal: 'typical' as const })), unplaced_visit: 0, no_address_visit: 0 })
    expect(opportunitySummary(none)).toMatchObject({ verdict: '沒有明顯偏少的里。', note: '另有 2 位來自 3 公里外，不算在內。' })
  })

  it('總結：有參觀但參觀率四捨五入到 0.0% 時寫「不到 0.1%」；沒有參觀照寫 0.0%', () => {
    const base = areaOpportunity().baseline!
    // 10-15 義華正式站：1 位 ÷ 9,788 位＝0.01%，後端回 0.0。
    const tiny = areaOpportunity({ baseline: { ...base, children: 9788, visit: 1, rate: 0, judged: false } })
    expect(opportunitySummary(tiny)!.lead).toBe('本校 3 公里內 3 個里，2–5 歲孩子 9,788 位，參觀 1 位（參觀率不到 0.1%）。')
    const zero = areaOpportunity({ baseline: { ...base, visit: 0, rate: 0, judged: false } })
    expect(opportunitySummary(zero)!.lead).toBe('本校 3 公里內 3 個里，2–5 歲孩子 1,000 位，參觀 0 位（參觀率 0.0%）。')
  })

  it('總結：附近的里沒有人口資料時多寫一句（不是半徑外）：有參觀寫人數、沒有只寫孩子數、超過 3 個里只列前 3 個', () => {
    const missing = (village: string, visit: number) => ({ district: '三民區', village, village_code: `code-${village}`, distance_m: 300, visit })
    const only = areaOpportunity({ outside_visit: 0, unplaced_visit: 0, no_address_visit: 0, no_population_villages: [missing('本揚里', 20)] })
    expect(opportunitySummary(only)!.note).toBe('三民區本揚里沒有人口資料，孩子數與其中的 20 位參觀都沒算進去。')
    // 和既有的「不算在內」並存：先寫半徑外與沒對到里，再寫缺人口的里。
    const both = areaOpportunity({ unplaced_visit: 0, no_address_visit: 0, no_population_villages: [missing('本揚里', 20)] })
    expect(opportunitySummary(both)!.note).toBe('另有 2 位來自 3 公里外，不算在內。三民區本揚里沒有人口資料，孩子數與其中的 20 位參觀都沒算進去。')
    const noVisit = areaOpportunity({ outside_visit: 0, unplaced_visit: 0, no_address_visit: 0, no_population_villages: [missing('本揚里', 0)] })
    expect(opportunitySummary(noVisit)!.note).toBe('三民區本揚里沒有人口資料，孩子數沒算進去。')
    const many = areaOpportunity({
      outside_visit: 0, unplaced_visit: 0, no_address_visit: 0,
      no_population_villages: ['本揚里', '寶業里', '鼎金里', '寶國里', '本上里'].map((village, index) => missing(village, 10 - index)),
    })
    expect(opportunitySummary(many)!.note).toBe(
      '三民區本揚里、三民區寶業里、三民區鼎金里等 5 個里沒有人口資料，孩子數與其中的 40 位參觀都沒算進去。',
    )
  })
})

describe('托嬰與園所異動的文字（2026-10-14）', () => {
  it('名單種類切換：幼兒園在前、托嬰中心在後', () => {
    expect(NEARBY_KINDS).toEqual([
      { value: 'kindergarten', label: '幼兒園' },
      { value: 'babycare', label: '托嬰中心' },
    ])
  })

  it('托嬰類型標籤', () => {
    expect([babycareKindLabel('center'), babycareKindLabel('home'), babycareKindLabel('other')]).toEqual(['托嬰中心', '托育家園', 'other'])
  })

  it('托嬰機構短名：取「辦理」「附設」之後的機構名；取不出像樣的名稱就維持原名', () => {
    expect(babycareShortName('高雄市私立頂尖小子托嬰中心')).toBe('頂尖小子托嬰中心')
    expect(babycareShortName('高雄市政府社會局委託財團法人靖娟兒童安全文教基金會辦理高雄市三民公共托嬰中心')).toBe('三民公共托嬰中心')
    expect(babycareShortName('長庚醫療財團法人高雄長庚紀念醫院附設高雄市私立長庚托嬰中心')).toBe('長庚托嬰中心')
    expect(babycareShortName('高雄市政府社會局委託嘉藥學校辦理高雄市苓雅社區公共托育家園')).toBe('苓雅社區公共托育家園')
    // 括號收尾的「…辦理)」：尾巴沒有托嬰字樣，維持原名（只去掉「高雄市」前綴）。
    expect(babycareShortName('高雄市政府員工子女托嬰中心(委託社團法人高雄市社區教育協會辦理)')).toBe('政府員工子女托嬰中心(委託社團法人高雄市社區教育協會辦理)')
  })

  it('托嬰清單的總結：核定與實際收托合計；未知的不計入；沒有托嬰中心寫沒有', () => {
    const data = areaBabycare()
    expect(babycareSummaryText(data.summary, 3)).toBe('3 公里內托嬰中心 3 所，核定 92 位，實際收托 84 位。')
    expect(babycareSummaryText({ count: 0, approved_total: 0, enrolled_total: 0, fee_count: 0 }, 1)).toBe('1 公里內沒有托嬰中心。')
    expect(babycareSummaryText({ count: 1200, approved_total: 31000, enrolled_total: 29500, fee_count: 0 }, 6)).toBe('6 公里內托嬰中心 1,200 所，核定 31,000 位，實際收托 29,500 位。')
  })

  it('每列第二行：距離・核定・實際收托；未知寫「—」不寫 0', () => {
    expect(babycareMeta(babycareItem({ distance_m: 520 }))).toBe('520 m・核定 40 人・實際收托 32 人')
    expect(babycareMeta(babycareItem({ distance_m: 1297, approved_capacity: null, enrolled: null }))).toBe('1.3 km・核定 — 人・實際收托 — 人')
    expect(babycareMeta(babycareItem({ approved_capacity: 12, enrolled: 0 }))).toContain('實際收托 0 人') // 真的是 0 就寫 0
  })

  it('每列第二行：有月費就接「・月費 N」；沒有（null 或沒送）就不寫', () => {
    expect(babycareMeta(babycareItem({ distance_m: 165, monthly_fee: 17900 }))).toBe('165 m・核定 40 人・實際收托 32 人・月費 17,900')
    expect(babycareMeta(babycareItem({ distance_m: 165, monthly_fee: null }))).toBe('165 m・核定 40 人・實際收托 32 人')
    expect(babycareMeta({ distance_m: 165, approved_capacity: 40, enrolled: 32 })).toBe('165 m・核定 40 人・實際收托 32 人')
  })

  it('babycareFeeText：中位數與範圍，有本校 2 歲班才接後半句；少於 3 所回空字串', () => {
    const summary = { ...areaBabycare().summary, fee_count: 3, fee_median: 17900, fee_min: 15000, fee_max: 21000, own_age2_monthly: null }
    expect(babycareFeeText(summary)).toBe('日間托育月費中位數 17,900 元（15,000–21,000）。')
    expect(babycareFeeText({ ...summary, own_age2_monthly: 19264 })).toBe('日間托育月費中位數 17,900 元（15,000–21,000）；本校 2 歲班月均 19,264 元。')
    expect(babycareFeeText({ ...summary, fee_median: null })).toBe('')
    // 型別允許沒送這幾個鍵：undefined 當 null。
    const bare = { ...summary } as Record<string, unknown>
    delete bare.fee_median
    delete bare.fee_min
    delete bare.fee_max
    delete bare.own_age2_monthly
    expect(babycareFeeText(bare as never)).toBe('')
  })

  it('變化的種類與對象標籤', () => {
    expect([changeLabel('opened'), changeLabel('closed'), changeLabel('kind_changed')]).toEqual(['新設', '停辦', '類型變動'])
    expect([providerLabel('kindergarten'), providerLabel('babycare')]).toEqual(['幼兒園', '托嬰'])
  })

  it('日期依據：設立日、同步到的日期各寫各的', () => {
    expect(changeDateText(providerChange({ change: 'opened', date: '2026-09-03', date_basis: 'registered' }))).toBe('設立日 2026/09')
    expect(changeDateText(providerChange({ change: 'opened', date: '2026-10-21', date_basis: 'observed' }))).toBe('2026/10 起出現在名單')
    expect(changeDateText(providerChange({ change: 'closed', date: '2026-10-09', date_basis: 'observed' }))).toBe('2026/10 起不在名單')
    expect(changeDateText(providerChange({ change: 'kind_changed', date: '2026-01-05', date_basis: 'observed' }))).toBe('2026/01 起')
  })

  it('類型變動多寫「私立 → 準公共」，其他種類不寫', () => {
    expect(kindChangeText(providerChange({ change: 'kind_changed', old_kind: 'private', new_kind: 'quasi_public' }))).toBe('私立 → 準公共')
    expect(kindChangeText(providerChange({ change: 'closed' }))).toBe('')
    expect(kindChangeText(providerChange({ change: 'kind_changed', old_kind: null, new_kind: null }))).toBe('')
  })

  it('變化區塊的副標與空狀態跟著半徑與視窗走', () => {
    expect(changesSubtitle(3, 12)).toBe('近 12 個月・3 公里內')
    expect(changesEmptyText(1, 12)).toBe('近 12 個月，1 公里內沒有新設、停辦或類型變動的園所。')
  })

  describe('記錄起點的說明（trackingNote）', () => {
    const now = new Date(2026, 9, 14) // 2026/10/14
    it('兩邊都還沒開始記錄', () => {
      expect(trackingNote({ kindergarten: null, babycare: null }, 12, now)).toBe('尚未開始記錄。')
    })
    it('基準日同一天、不到 12 個月：只說類型變動與托嬰從哪天起記錄（2026-10-15 規格 §6 逐字）', () => {
      expect(trackingNote({ kindergarten: '2026-10-14', babycare: '2026-10-14' }, 12, now)).toBe(
        '幼兒園的類型變動與托嬰從 10 月 14 日起記錄。',
      )
    })
    it('基準日不同天：分開寫', () => {
      expect(trackingNote({ kindergarten: '2026-10-14', babycare: '2026-10-20' }, 12, now)).toBe(
        '幼兒園的類型變動從 10 月 14 日起記錄；托嬰從 10 月 20 日起記錄。',
      )
    })
    it('只有一邊開始記錄', () => {
      expect(trackingNote({ kindergarten: '2026-10-14', babycare: null }, 12, now)).toBe(
        '幼兒園的類型變動從 10 月 14 日起記錄；托嬰尚未開始記錄。',
      )
    })
    it('幼兒園已滿 12 個月、托嬰從未匯入：仍要說托嬰尚未開始記錄', () => {
      expect(trackingNote({ kindergarten: '2025-10-14', babycare: null }, 12, now)).toBe('托嬰尚未開始記錄。')
    })
    it('幼兒園從未同步（沒有回補）、托嬰已滿 12 個月：停辦與類型變動都還沒開始記錄', () => {
      expect(trackingNote({ kindergarten: null, babycare: '2025-10-14' }, 12, now)).toBe(
        '幼兒園的停辦與類型變動尚未開始記錄。',
      )
    })
    it('一邊已滿 12 個月、另一邊還近：已滿那一側不印日期（一年後讀起來會像今年）', () => {
      expect(trackingNote({ kindergarten: '2025-10-14', babycare: '2026-10-20' }, 12, now)).toBe(
        '托嬰從 10 月 20 日起記錄。',
      )
      expect(trackingNote({ kindergarten: '2026-10-20', babycare: '2025-10-14' }, 12, now)).toBe(
        '幼兒園的類型變動從 10 月 20 日起記錄。',
      )
    })
    it('不再寫「新設以設立日為準」：幼兒園的新設與停辦都涵蓋整個視窗', () => {
      const all = [
        trackingNote({ kindergarten: '2026-10-14', babycare: '2026-10-14' }, 12, now),
        trackingNote({ kindergarten: '2026-10-14', babycare: '2026-10-20' }, 12, now),
        trackingNote({ kindergarten: null, babycare: '2026-10-20' }, 12, now),
      ]
      for (const text of all) expect(text).not.toContain('設立日')
    })
    it('基準日已滿 12 個月（剛好 12 個月前那天也算滿）：不需要說明', () => {
      expect(trackingNote({ kindergarten: '2025-10-14', babycare: '2025-09-01' }, 12, now)).toBe('')
      expect(trackingNote({ kindergarten: '2025-10-15', babycare: '2025-09-01' }, 12, now)).not.toBe('')
    })
  })

  it('頁首狀態列：托嬰名單更新日與尚未匯入', () => {
    expect(babycareStatusText('2026-10-13T18:30:00Z')).toBe('托嬰名單 10/14 更新')
    expect(babycareStatusText(null)).toBe('托嬰名單尚未匯入')
  })
})

describe('里的變化的文字（2026-10-14 規格 7）', () => {
  const MINUS = '\u2212'

  it('有正負號的人數：正數加「+」、負數用減號、0 不加；null 寫「—」', () => {
    expect([signedCount(1234), signedCount(-46), signedCount(0), signedCount(null)]).toEqual(['+1,234', `${MINUS}46`, '0', '—'])
  })

  it('這一年淨增：人數加比例（小數一位）；一年前是 0 只寫人數；算不出來寫「—」', () => {
    expect(kidsNetText({ kids_net: 139, kids_base: 674 })).toBe('+139（+20.6%）')
    expect(kidsNetText({ kids_net: -46, kids_base: 545 })).toBe(`${MINUS}46（${MINUS}8.4%）`)
    expect(kidsNetText({ kids_net: 0, kids_base: 100 })).toBe('0（0.0%）')
    expect(kidsNetText({ kids_net: 3, kids_base: 0 })).toBe('+3')
    expect(kidsNetText({ kids_net: null, kids_base: null })).toBe('—')
  })

  it('所得中位數：千元換成萬（小數一位），界線在所得年度後調整加「*」，沒有寫「—」', () => {
    expect(incomeText({ income_median: 458, income_boundary_changed: false })).toBe('45.8 萬')
    expect(incomeText({ income_median: 952, income_boundary_changed: true })).toBe('95.2 萬*')
    expect(incomeText({ income_median: 300, income_boundary_changed: false })).toBe('30.0 萬')
    expect(incomeText({ income_median: null, income_boundary_changed: false })).toBe('—')
  })

  it('國小學區：部分、自由學區加註；學校在別區的加區名；沒有寫「—」', () => {
    const school = (name: string, district: string, partial: boolean, free_zone: boolean) => ({ code: name, name, district, partial, free_zone })
    expect(villageSchoolsText({ district: '三民區', schools: [school('東光國小', '三民區', false, false)] })).toBe('東光國小')
    expect(villageSchoolsText({
      district: '仁武區', schools: [school('八卦國小', '仁武區', false, true), school('福山國小', '左營區', true, true)],
    })).toBe('八卦國小（自由學區）、左營區福山國小（部分，自由學區）')
    expect(villageSchoolsText({ district: '三民區', schools: [school('A', '三民區', true, false), school('B', '三民區', false, false)] }, '；'))
      .toBe('A（部分）；B')
    expect(villageSchoolsText({ district: '三民區', schools: [] })).toBe('—')
  })

  it('學區里數與學區的淨增', () => {
    expect([schoolVillagesText({ villages_full: 12, villages_partial: 3 }), schoolVillagesText({ villages_full: 3, villages_partial: 0 }),
      schoolVillagesText({ villages_full: 0, villages_partial: 2 })]).toEqual(['12 里＋部分 3 里', '3 里', '部分 2 里'])
    expect([schoolKidsNetText({ kids_net: 20, kids_partial: true }), schoolKidsNetText({ kids_net: -3, kids_partial: false }),
      schoolKidsNetText({ kids_net: null, kids_partial: false })]).toEqual(['+20*', `${MINUS}3`, '—'])
  })

  it('地圖色階：孩子少與算不出來不上色', () => {
    expect((['up2', 'up1', 'flat', 'down1', 'down2', 'few', 'unknown'] as const).map(kidsLevelTone))
      .toEqual(['up2', 'up1', 'flat', 'down1', 'down2', 'none', 'none'])
  })

  it('合併組的名稱：三個以內全列，超過寫「等 N 個里」，後面註明合併', () => {
    expect(trendsPlaceName({ district: '三民區', village: '本揚里', merged: false })).toBe('三民區本揚里')
    expect(trendsPlaceName({ district: '仁武區', village: '八卦里、八德里', merged: true })).toBe('仁武區八卦里、八德里（里界調整，合併）')
    expect(trendsPlaceName({ district: '左營區', village: '中北里、尾南里、屏山里、聖后里、埤東里', merged: true }))
      .toBe('左營區中北里、尾南里、屏山里等 5 個里（里界調整，合併）')
  })

  it('總結：淨減寫「淨減」；出生不滿 12 個月寫有幾個月；沒有比較就不寫比較；淨遷入是正的寫「淨遷入」', () => {
    const base = areaTrends()
    const summary = trendsSummary(areaTrends({
      baseline: { ...base.baseline!, kids_net: -86, kids_base: 12000, births_months: 9, births_change_pct: null, migration_net_12m: 1234 },
      villages: base.villages.filter((row) => !row.merged),
    }))!
    expect(summary.lines).toEqual([
      `本校 3 公里內 4 個里，2–5 歲孩子 1,400 位；和一年前同一批孩子比，淨減 86 位（${MINUS}0.7%）。`,
      '近 12 個月出生 180 位（有 9 個月的資料）。',
      '近 12 個月全年齡淨遷入 1,234 人。',
      '近 4 季新屋交屋 130 筆，最多的是三民區鼎金里（106 筆）、三民區本揚里（24 筆）。',
    ])
    expect(summary.note).toBe('範圍內的區另有 7 筆新屋交屋只到區、沒對到里，沒算進去。')
    expect(trendsSummary(areaTrends({ baseline: null }))).toBeNull()
  })

  it('地圖停用的原因：本校沒座標優先，其次是淨增算不出來；都可以用回空字串', () => {
    expect(trendMapNote(areaTrends())).toBe('')
    expect(trendMapNote(areaTrends({ kids_unavailable: 'no_migration' })))
      .toBe('遷入遷出資料不到 10 個月，看不出里界有沒有調整，這一年淨增先不算。')
    const unlocated = areaTrends({ campus: { ...areaTrends().campus, lat: null, lng: null, locate_error: 'no_address' }, kids_unavailable: 'no_year_ago' })
    expect(trendMapNote(unlocated)).toBe('本校位置未標示（找不到本校地址），算不出附近有哪些里。')
  })
})


describe('新屋交屋的文字（2026-10-14 里的變化 B2 段）', () => {
  it('筆數：匯入了沒有交屋是 0，還沒匯入（null）才寫「—」；千分位', () => {
    expect([homesText({ new_homes: 24 }), homesText({ new_homes: 0 }), homesText({ new_homes: 1234 }), homesText({ new_homes: null })])
      .toEqual(['24', '0', '1,234', '—'])
  })

  it('季別範圍：一季寫那一季、多季寫頭尾、沒有回空字串', () => {
    expect([seasonRange(['115S3']), seasonRange(['114S4', '115S1', '115S2', '115S3']), seasonRange([])]).toEqual(['115S3', '114S4–115S3', ''])
  })

  it('地圖上某個里的筆數：一般的里用那一列，合併組用組內各代碼自己的筆數（整組的數字不算給每個里）', () => {
    expect(homesCount({ merged: false, new_homes: 24, new_homes_by_code: { A: 24 } }, 'A')).toBe(24)
    expect(homesCount({ merged: false, new_homes: null, new_homes_by_code: {} }, 'A')).toBe(0)
    const group = { merged: true, new_homes: 639, new_homes_by_code: { A: 500, B: 139 } }
    expect([homesCount(group, 'A'), homesCount(group, 'B'), homesCount(group, 'C')]).toEqual([500, 139, 0])
  })

  it('地圖分級的最大值：每個里自己的筆數，合併組看組內各里、不看整組', () => {
    const rows: Parameters<typeof homesMax>[0] = [
      { merged: false, new_homes: 24, new_homes_by_code: { A: 24 } },
      { merged: true, new_homes: 639, new_homes_by_code: { B: 500, C: 139 } },
      { merged: false, new_homes: null, new_homes_by_code: {} },
    ]
    expect(homesMax(rows)).toBe(500)
    expect(homesMax([{ merged: true, new_homes: 0, new_homes_by_code: {} }])).toBe(0)
    expect(homesMax([])).toBe(0)
  })

  it('地圖停用的原因：本校沒座標優先，其次新成屋沒匯入；出生、遷入遷出沒匯入不影響', () => {
    const base = areaTrends()
    expect(homesMapNote(base)).toBe('')
    expect(homesMapNote(areaTrends({ sources: { ...base.sources, new_homes: { latest: null, seasons: [], unplaced: 0, note: '' } } })))
      .toBe('新成屋資料尚未匯入。')
    expect(homesMapNote(areaTrends({ kids_unavailable: 'no_population', sources: { ...base.sources, births: { latest: null, months: [], missing: [] } } }))).toBe('')
    const unlocated = areaTrends({
      campus: { ...base.campus, lat: null, lng: null, locate_error: 'no_address' },
      sources: { ...base.sources, new_homes: { latest: null, seasons: [], unplaced: 0, note: '' } },
    })
    expect(homesMapNote(unlocated)).toBe('本校位置未標示（找不到本校地址），算不出附近有哪些里。')
  })

  it('地圖著色轉出 areaView 的七種模式：在籍學生排第一、參觀改叫「參觀」、多一個「同業」（2026-10-16 工作台）', () => {
    expect(MAP_MODES.map((mode) => mode.value)).toEqual(['enrolled', 'children', 'trend', 'homes', 'visits', 'opportunity', 'peers'])
    expect(MAP_MODES[0]!.label).toBe('在籍學生')
    expect(MAP_MODES.find((mode) => mode.value === 'visits')!.label).toBe('參觀')
    expect(MAP_MODES.at(-1)!.label).toBe('同業')
  })

  it('總結：不滿 4 季寫有幾季的資料；沒有交屋不寫「最多的是」；沒對到里的筆數是 0 就不寫；沒匯入或沒有任何一季不寫這一句', () => {
    const base = areaTrends()
    const withHomes = (baseline: Partial<NonNullable<typeof base.baseline>>, unplaced = 0) =>
      trendsSummary(areaTrends({
        baseline: { ...base.baseline!, ...baseline },
        sources: { ...base.sources, new_homes: { ...base.sources.new_homes, unplaced } },
      }))!
    const partial = withHomes({ new_homes_seasons: 3 })
    expect(partial.lines.at(-1)).toBe('近 4 季新屋交屋 130 筆（有 3 季的資料），最多的是三民區鼎金里（106 筆）、三民區本揚里（24 筆）。')
    const none = trendsSummary(areaTrends({
      baseline: { ...base.baseline!, new_homes: 0, new_homes_latest: 0 },
      villages: base.villages.map((row) => ({ ...row, new_homes: 0, new_homes_latest: 0 })),
    }))!
    expect(none.lines.at(-1)).toBe('近 4 季新屋交屋 0 筆。')
    expect(withHomes({}, 0).note).not.toContain('新屋交屋')
    expect(withHomes({ new_homes: null, new_homes_latest: null }, 9).lines.join('')).not.toContain('新屋交屋')
    expect(withHomes({ new_homes_seasons: 0 }, 9).note).not.toContain('新屋交屋')
  })

  it('總結：同樣的句子依類別拆開（淨增、出生、新屋；note 的三段），lines 與 note 就是它們相接', () => {
    const summary = trendsSummary(areaTrends({ kids_unavailable: 'no_year_ago' }))!
    expect(summary.kids).toEqual(['本校 3 公里內 4 個里，2–5 歲孩子 1,400 位；和一年前同一批孩子比，淨增 26 位（+1.9%）。'])
    expect(summary.births).toEqual(['近 12 個月出生 180 位，比前一年同期少 20.7%（比 9 個月）。'])
    expect(summary.homes).toEqual(['近 4 季新屋交屋 130 筆，最多的是三民區鼎金里（106 筆）、三民區本揚里（24 筆）。'])
    expect(summary.notes).toEqual({
      merged: '三民區寶業里、龍子里的里界調整過，合併成一列計算。',
      kids: '一年前的各里人口還沒匯入，這一年淨增先不算。',
      homes: '範圍內的區另有 7 筆新屋交屋只到區、沒對到里，沒算進去。',
    })
    expect(summary.lines).toEqual([
      ...summary.kids, ...summary.births, '近 12 個月全年齡淨遷出 160 人。', ...summary.homes,
    ])
    expect(summary.note).toBe(summary.notes.merged + summary.notes.kids + summary.notes.homes)
    const bare = trendsSummary(areaTrends({ baseline: { ...areaTrends().baseline!, children: null, births_12m: null, new_homes_seasons: 0 } }))!
    expect([bare.kids, bare.births, bare.homes, bare.notes.homes]).toEqual([[], [], [], ''])
  })

  it('總結：最多的里只列前 3 個，合併組寫里名不寫「里界調整，合併」', () => {
    const base = areaTrends()
    const village = (key: string, name: string, homes: number, merged = false) =>
      ({ ...base.villages[0]!, key, district: '三民區', village: name, merged, new_homes: homes, new_homes_latest: homes })
    const summary = trendsSummary(areaTrends({
      villages: [village('a', '甲里', 5), village('b', '乙、丙里', 90, true), village('c', '丁里', 30), village('d', '戊里', 12)],
    }))!
    expect(summary.lines.at(-1)).toBe('近 4 季新屋交屋 130 筆，最多的是三民區乙、丙里（90 筆）、三民區丁里（30 筆）、三民區戊里（12 筆）。')
  })
})

describe('地圖與右欄的無資料句', () => {
  it('三句共用常數，字不改', () => {
    expect([NO_CHILDREN_DATA_TEXT, NO_NEW_HOMES_TEXT, NO_LOCATED_VISITS_TEXT]).toEqual([
      '半徑內的里沒有 2–5 歲孩子的資料。', '半徑內近 4 季沒有新屋交屋。', '這個範圍還沒有定位到里的參觀。',
    ])
  })
})

describe('在籍學生（2026-10-15 規格 §6）', () => {
  const counts = { 幼幼班: 0, 小班: 1, 中班: 1, 大班: 0, 其他: 0 }

  it('一格的人數：全部是各班加總，選一班只算那班', () => {
    expect(pointCount(counts, 'all')).toBe(2)
    expect(pointCount(counts, '小班')).toBe(1)
    expect(pointCount(counts, '大班')).toBe(0)
  })

  it('篩選選項：全部＋後端給的各班，標人數', () => {
    expect(gradeOptions(areaEnrolled()).map((option) => option.label)).toEqual(['全部 5', '幼幼班 1', '小班 2', '中班 1', '大班 1'])
    expect(gradeOptions(areaEnrolled())[0]!.value).toBe('all')
  })

  it('點的彈出框：只列大於 0 的班別；選一班只寫那班', () => {
    expect(pointPopupText(counts, 'all')).toBe('這附近 2 位：小班 1、中班 1')
    expect(pointPopupText(counts, '中班')).toBe('這附近 1 位：中班 1')
  })

  it('圖例：清冊日期、學年、門牌版本、地圖上幾位；沒有點的依篩選加總，0 就不寫', () => {
    expect(enrolledLegendText(areaEnrolled(), 'all')).toEqual({
      lead: '清冊 2026/10/15・115 學年班別・門牌 115 年 10 月版・地圖上 4 位', unplaced: '沒有點 1 位（只對到里 1）',
    })
    expect(enrolledLegendText(areaEnrolled(), '大班')).toEqual({
      lead: '清冊 2026/10/15・115 學年班別・門牌 115 年 10 月版・地圖上 1 位', unplaced: '',
    })
    expect(enrolledLegendText(areaEnrolled(), '其他').lead).toBe('清冊 2026/10/15・115 學年班別・門牌 115 年 10 月版・地圖上 0 位')
  })

  it('圖例：沒有門牌版本（null）就省略那一段', () => {
    expect(enrolledLegendText(areaEnrolled({ doorplate_version: null }), 'all').lead).toBe('清冊 2026/10/15・115 學年班別・地圖上 4 位')
  })

  it('停用原因：讀取失敗、尚未匯入；讀取中與有資料都可以用', () => {
    expect(enrolledMapNote(null, true)).toBe('在籍學生讀取失敗。')
    expect(enrolledMapNote(areaEnrolled({ status: 'not_imported' }), false)).toBe('尚未匯入在籍名冊。')
    expect(enrolledMapNote(null, false)).toBe('')
    expect(enrolledMapNote(areaEnrolled(), false)).toBe('')
  })

  it('距離分布列：每帶一列，各班與合計；沒有距離的那列叫「無距離」（本校沒座標時全部歸這列）', () => {
    const rows = enrolledBandRows(areaEnrolled())
    expect(rows.map((row) => row.band_label)).toEqual(['1 公里內', '1–3 公里', '3–6 公里', '6 公里以上', '無距離'])
    expect(rows[0]).toMatchObject({ 小班: 1, 中班: 1, total: 2 })
  })

  it('里排行列：依篩選算人數、0 人的里拿掉，多的排前面', () => {
    expect(enrolledVillageRows(areaEnrolled(), 'all').map((row) => [row.place, row.count])).toEqual([
      ['三民區本揚里', 3], ['三民區寶業里', 1], ['左營區新上里', 1],
    ])
    expect(enrolledVillageRows(areaEnrolled(), '小班').map((row) => [row.place, row.count])).toEqual([['三民區本揚里', 2]])
    expect(enrolledVillageRows(areaEnrolled(), '其他')).toEqual([])
  })

  it('里排行列帶著里代碼（可能是 null）、區與里名，排行才能點選', () => {
    const enrolled = areaEnrolled()
    enrolled.villages[1]!.village_code = null
    expect(enrolledVillageRows(enrolled, 'all').map((row) => [row.key, row.village_code, row.district, row.village])).toEqual([
      ['64000050015', '64000050015', '三民區', '本揚里'],
      ['三民區/寶業里', null, '三民區', '寶業里'],
      ['64000030020', '64000030020', '左營區', '新上里'],
    ])
  })
})
