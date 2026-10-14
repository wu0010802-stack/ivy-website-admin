import { describe, expect, it } from 'vitest'
import {
  NEARBY_KINDS, babycareKindLabel, babycareMeta, babycareShortName, babycareStatusText, babycareSummaryText, bandLabel, campusNotLocatedReason,
  changeDateText, changeLabel, changesEmptyText, changesSubtitle, districtBounds, doorplateVersionLabel, expectedText, formatDistance,
  kindChangeText, kindLabel, legendRanges, levelOf, opportunitySummary, opportunityUnavailable, providerLabel, reasonLabel, shortName,
  signalText, signalTone, taipeiMonthDay, trackingNote, visitGeoText,
} from '../components/admissions/area/areaFormat'
import type { VillageBoundaries, VillageFeature, VisitGeo } from '../api/types'
import {
  areaBabycare, areaKindergartens, areaOpportunity, areaStats, babycareItem, providerChange, villageBoundaries,
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

  it('總結：合計句、判讀句（合計少了幾位四捨五入、至少 1 位）、不算在內的人數只寫非零項', () => {
    expect(opportunitySummary(areaOpportunity({ baseline: null }))).toBeNull()
    expect(opportunitySummary(areaOpportunity())).toEqual({
      lead: '本校 3 公里內 3 個里，2–5 歲孩子 1,000 位，參觀 20 位（參觀率 2.0%）。',
      verdict: '明顯偏少的里 1 個，照附近的參觀率合計少了約 7 位。',
      note: '另有 2 位來自 3 公里外、3 位沒對到里，不算在內。',
    })
    const rows = areaOpportunity().villages
    const twoSmall = areaOpportunity({
      villages: [{ ...rows[0]!, shortfall: 0.2 }, { ...rows[1]!, signal: 'below', shortfall: 0.1 }, rows[2]!],
      outside_visit: 0,
    })
    expect(opportunitySummary(twoSmall)).toMatchObject({ verdict: '明顯偏少的里 2 個，照附近的參觀率合計少了約 1 位。', note: '另有 3 位沒對到里，不算在內。' })
    const none = areaOpportunity({ villages: rows.map((row) => ({ ...row, signal: 'typical' as const })), unplaced_visit: 0 })
    expect(opportunitySummary(none)).toMatchObject({ verdict: '沒有明顯偏少的里。', note: '另有 2 位來自 3 公里外，不算在內。' })
  })

  it('總結：附近的里沒有人口資料時多寫一句（不是半徑外）：有參觀寫人數、沒有只寫孩子數、超過 3 個里只列前 3 個', () => {
    const missing = (village: string, visit: number) => ({ district: '三民區', village, village_code: `code-${village}`, distance_m: 300, visit })
    const only = areaOpportunity({ outside_visit: 0, unplaced_visit: 0, no_population_villages: [missing('本揚里', 20)] })
    expect(opportunitySummary(only)!.note).toBe('三民區本揚里沒有人口資料，孩子數與其中的 20 位參觀都沒算進去。')
    // 和既有的「不算在內」並存：先寫半徑外與沒對到里，再寫缺人口的里。
    const both = areaOpportunity({ unplaced_visit: 0, no_population_villages: [missing('本揚里', 20)] })
    expect(opportunitySummary(both)!.note).toBe('另有 2 位來自 3 公里外，不算在內。三民區本揚里沒有人口資料，孩子數與其中的 20 位參觀都沒算進去。')
    const noVisit = areaOpportunity({ outside_visit: 0, unplaced_visit: 0, no_population_villages: [missing('本揚里', 0)] })
    expect(opportunitySummary(noVisit)!.note).toBe('三民區本揚里沒有人口資料，孩子數沒算進去。')
    const many = areaOpportunity({
      outside_visit: 0, unplaced_visit: 0,
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
    expect(babycareSummaryText({ count: 0, approved_total: 0, enrolled_total: 0 }, 1)).toBe('1 公里內沒有托嬰中心。')
    expect(babycareSummaryText({ count: 1200, approved_total: 31000, enrolled_total: 29500 }, 6)).toBe('6 公里內托嬰中心 1,200 所，核定 31,000 位，實際收托 29,500 位。')
  })

  it('每列第二行：距離・核定・實際收托；未知寫「—」不寫 0', () => {
    expect(babycareMeta(babycareItem({ distance_m: 520 }))).toBe('520 m・核定 40 人・實際收托 32 人')
    expect(babycareMeta(babycareItem({ distance_m: 1297, approved_capacity: null, enrolled: null }))).toBe('1.3 km・核定 — 人・實際收托 — 人')
    expect(babycareMeta(babycareItem({ approved_capacity: 12, enrolled: 0 }))).toContain('實際收托 0 人') // 真的是 0 就寫 0
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
    it('基準日同一天、不到 12 個月：說從哪天起記錄，新設以設立日為準', () => {
      expect(trackingNote({ kindergarten: '2026-10-14', babycare: '2026-10-14' }, 12, now)).toBe(
        '停辦與類型變動從 10 月 14 日起記錄；新設的幼兒園以設立日為準。',
      )
    })
    it('基準日不同天：分開寫', () => {
      expect(trackingNote({ kindergarten: '2026-10-14', babycare: '2026-10-20' }, 12, now)).toBe(
        '幼兒園的停辦與類型變動從 10 月 14 日起記錄；托嬰從 10 月 20 日起記錄；新設的幼兒園以設立日為準。',
      )
    })
    it('只有一邊開始記錄', () => {
      expect(trackingNote({ kindergarten: '2026-10-14', babycare: null }, 12, now)).toBe(
        '幼兒園的停辦與類型變動從 10 月 14 日起記錄；托嬰尚未開始記錄；新設的幼兒園以設立日為準。',
      )
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
