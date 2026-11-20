// 區域分析「五校版圖」（2026-11-20 規格 §6）：里著色級別、右欄兩段排行、圖例與說明。純函式。
import { describe, expect, it } from 'vitest'
import { campusClass, overlayLegend, overlayLevel, overlayNote, overlaySections } from '../components/admissions/area/campusOverlay'
import type { AreaEnrolledOverview } from '../api/types'

const NAMES: Record<string, string> = { yihua: '義華', minghua: '明華', chongde: '崇德', international: '國際', renwu: '仁武' }
const name = (key: string) => NAMES[key] ?? key

// API 的 name 是「義華校」（Campus.name）；畫面一律用 campusLabel 的「義華」，圖例與說明不能照搬 name。
const campus = (key: string, changes: Partial<AreaEnrolledOverview['campuses'][number]> = {}) => ({
  key, name: `${name(key)}校`, imported: false, roster_date: null, total: 0, placed: 0, lat: 22.64, lng: 120.3, ...changes,
})
const overview = (changes: Partial<AreaEnrolledOverview> = {}): AreaEnrolledOverview => ({
  campuses: [
    campus('yihua', { imported: true, roster_date: '2026-10-15', total: 40, placed: 38 }),
    campus('minghua', { imported: true, roster_date: '2026-10-16', total: 25, placed: 24 }),
    campus('chongde'), campus('international'), campus('renwu'),
  ],
  points: [],
  villages: [],
  overlap: [
    { village_code: '64000050001', district: '三民區', village: '鼎金里', counts: { yihua: 3, minghua: 2 }, total: 5 },
    { village_code: '64000050015', district: '三民區', village: '本揚里', counts: { yihua: 6, minghua: 1, renwu: 2 }, total: 9 },
  ],
  gaps: [
    { village_code: '64000050025', district: '三民區', village: '寶業里', children: 412, nearest_campus_key: 'yihua', distance_m: 2100 },
    { village_code: '64000050030', district: '三民區', village: '正興里', children: 120, nearest_campus_key: 'minghua', distance_m: 850 },
  ],
  population_version: '115-09',
  gap_radius_km: 6,
  ...changes,
})

describe('campusClass／overlayLevel', () => {
  it('class 帶校區 key', () => {
    expect(campusClass('yihua')).toBe('area-campus area-campus--yihua')
  })

  it('幾校有在籍：0／1／2 校 → 0／1／3，人數 0 的校不算', () => {
    expect(overlayLevel({ counts: {} })).toBe(0)
    expect(overlayLevel({ counts: { yihua: 0, minghua: 0 } })).toBe(0)
    expect(overlayLevel({ counts: { yihua: 4 } })).toBe(1)
    expect(overlayLevel({ counts: { yihua: 4, minghua: 0 } })).toBe(1)
    expect(overlayLevel({ counts: { yihua: 4, minghua: 1 } })).toBe(3)
    expect(overlayLevel({ counts: { yihua: 1, minghua: 1, renwu: 1 } })).toBe(3)
  })
})

describe('overlaySections', () => {
  it('兩段，標題照規格；兩校以上依合計降冪，細節是「義華 6・明華 1・仁武 2」（只列 > 0、照校區順序）', () => {
    const sections = overlaySections(overview(), name)
    expect(sections.map((section) => section.title)).toEqual(['兩校以上都在收的里', '孩子多、五校都沒有在籍的里'])
    expect(sections[0]!.items.map((item) => [item.code, item.name, item.value, item.detail])).toEqual([
      ['64000050015', '三民區本揚里', '9 位', '義華 6・明華 1・仁武 2'],
      ['64000050001', '三民區鼎金里', '5 位', '義華 3・明華 2'],
    ])
  })

  it('沒有在籍的里：孩子數「2–5 歲 412 位」、最近的校與距離「義華 2.1 公里」，不到 1 公里寫公尺', () => {
    const gaps = overlaySections(overview(), name)[1]!.items
    expect(gaps.map((item) => [item.code, item.name, item.value, item.distance])).toEqual([
      ['64000050025', '三民區寶業里', '2–5 歲 412 位', '義華 2.1 公里'],
      ['64000050030', '三民區正興里', '2–5 歲 120 位', '明華 850 公尺'],
    ])
  })

  it('空的段不列', () => {
    expect(overlaySections(overview({ overlap: [] }), name).map((section) => section.title)).toEqual(['孩子多、五校都沒有在籍的里'])
    expect(overlaySections(overview({ overlap: [], gaps: [] }), name)).toEqual([])
  })
})

describe('overlayLegend／overlayNote', () => {
  it('圖例五校各一列：已匯入寫人數，未匯入 imported=false 寫「尚未匯入」', () => {
    expect(overlayLegend(overview())).toEqual([
      { key: 'yihua', label: '義華', count: '40 位', imported: true },
      { key: 'minghua', label: '明華', count: '25 位', imported: true },
      { key: 'chongde', label: '崇德', count: '尚未匯入', imported: false },
      { key: 'international', label: '國際', count: '尚未匯入', imported: false },
      { key: 'renwu', label: '仁武', count: '尚未匯入', imported: false },
    ])
  })

  it('說明只列已匯入的校；全都沒匯入是另一句', () => {
    expect(overlayNote(overview())).toBe('只算已匯入清冊的校：義華、明華')
    expect(overlayNote(overview({ campuses: overview().campuses.map((item) => ({ ...item, imported: false })) })))
      .toBe('還沒有任何校區匯入在籍清冊')
  })
})
