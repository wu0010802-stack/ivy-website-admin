import { NO_VALUE, formatRate } from '../../../admissions/statsFormat'
import type {
  AdmissionsArea, AreaEnrolled, AreaKindergartens, AreaOpportunity, AreaOpportunityRow, AreaTrends, AreaTrendsVillage,
  EnrolledGrade, VillageBoundaries,
} from '../../../api/types'
import {
  KIDS_LEVEL_LABELS, campusUnlocatedNote, expectedText, formatCount, formatDistance, homesCount, incomeText,
  kidsNetText, kindLabel, opportunityUnavailable, pointCount, shortName, signalText, signedCount, villageKey, villageSchoolsText,
  type RadiusKm,
} from './areaFormat'

// 區域分析工作台右欄「里卡片」（2026-10-16 規格 §2.4）的資料組合：把頁面已經載入的里界、參觀、招生機會、
// 里的變化、在籍學生、幼兒園名單，依一個里代碼 join 成畫面要的結構。純函式，不碰 Vue／Leaflet／API，
// 地圖的 async chunk 載入失敗時卡片也照常可用。

export { NOT_JUDGED_NOTE } from './areaFormat'

type Feature = VillageBoundaries['features'][number]
interface LatLng {
  lat: number
  lng: number
}

// ---- 里界幾何 ----

type Ring = number[][]
const EARTH_RADIUS_M = 6371000
const radians = (degrees: number): number => (degrees * Math.PI) / 180

/** 兩點的直線距離（公尺），球半徑 6,371,000 m，和後端 haversine_m 同一個算法。 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const h =
    Math.sin(radians(b.lat - a.lat) / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lng - a.lng) / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 外環的面積（度²，只拿來比大小）。 */
function ringArea(ring: Ring): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j]![0]! * ring[i]![1]! - ring[i]![0]! * ring[j]![1]!
  return Math.abs(sum) / 2
}

/**
 * 里的幾何中心：面積最大那個多邊形外環的頂點平均（去掉和第一點重複的收尾點）。
 * MultiPolygon 取最大塊，外島不會把中心拉出里外；頂點平均不是質心，但卡片只拿它算 500 m、半徑邊界，誤差可接受。
 */
export function featureCentroid(feature: Feature): LatLng {
  const { geometry } = feature
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  let ring: Ring = []
  let largest = -1
  for (const polygon of polygons) {
    const outer = polygon[0] ?? []
    const area = ringArea(outer)
    if (area > largest) {
      ring = outer
      largest = area
    }
  }
  const first = ring[0]
  const last = ring[ring.length - 1]
  const closed = ring.length > 1 && first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1]
  const points = closed ? ring.slice(0, -1) : ring
  const mean = (axis: 0 | 1): number => points.reduce((sum, point) => sum + point[axis]!, 0) / points.length
  return { lat: mean(1), lng: mean(0) }
}

/** 里代碼對里界（VILLCODE）；沒有回 undefined。 */
export const findFeature = (boundaries: VillageBoundaries, code: string): Feature | undefined =>
  boundaries.features.find((feature) => feature.properties.VILLCODE === code)

/** 區＋里名對里代碼（排行／表格的列沒有代碼時用）；對不到回 null。 */
export function featureCode(boundaries: VillageBoundaries, district: string, village: string): string | null {
  const feature = boundaries.features.find((item) => item.properties.TOWNNAME === district && item.properties.VILLNAME === village)
  return feature?.properties.VILLCODE ?? null
}

// ---- 卡片資料 ----

export interface FactsSources {
  boundaries: VillageBoundaries
  area: AdmissionsArea
  opportunity: AreaOpportunity | null
  opportunityFailed: boolean
  trends: AreaTrends | null
  trendsFailed: boolean
  enrolled: AreaEnrolled | null
  enrolledFailed: boolean
  kindergartens: AreaKindergartens | null
  radiusKm: RadiusKm
}

export type SectionState = 'ok' | 'loading' | 'failed'
export interface FactRow {
  label: string
  value: string
  detail?: string
  tone?: 'up' | 'down'
}
export interface NearbyKindergarten {
  name: string
  kind: string
  kindLabel: string
  /** 本機構（後端 is_own）：卡片的色點用它判斷，不比對 kindLabel 的字串。 */
  isOwn: boolean
  distance: string
}
export interface VillageFacts {
  code: string
  title: string
  subtitle: string
  kids: { state: SectionState | 'outside' | 'no-population' | 'unavailable'; rows: FactRow[]; note: string; mergeNote: string }
  /** state 是在籍名冊的讀取狀態；參觀來自頁面一開始就載入的區域分析，rows 裡隨時有。 */
  ours: { state: SectionState; rows: FactRow[]; openRecordsArea: string | null }
  /** null＝不顯示這一段（幼兒園名單沒到、本校沒座標、里在半徑外或靠近邊界）；[] 是查過、500 m 內沒有。 */
  nearby: NearbyKindergarten[] | null
}

const NEARBY_MAX_M = 500
const NEARBY_MAX_COUNT = 5
const NO_POPULATION_NOTE = '這個里沒有人口資料。'

/**
 * 半徑外的里，孩子段改寫的那一句（D20）。centroidDistanceM 是里界幾何中心到本校的距離，只拿來選文案，畫面不寫。
 * 範圍 1 且中心在 3 公里內：改成 3 公里；中心在 6 公里內：改成 6 公里；範圍已是 6、或中心超過 6 公里：沒有孩子數。
 */
export function outsideRadiusText(centroidDistanceM: number, radiusKm: RadiusKm): string {
  if (radiusKm === 6 || centroidDistanceM > 6000) return '在本校 6 公里外，沒有孩子數。'
  const target = radiusKm === 1 && centroidDistanceM <= 3000 ? 3 : 6
  return `在本校 ${radiusKm} 公里外，孩子數只算範圍內的里；把範圍改成 ${target} 公里就看得到。`
}

const factRow = (label: string, value: string, detail?: string, tone?: 'up' | 'down'): FactRow => ({
  label, value, ...(detail ? { detail } : {}), ...(tone ? { tone } : {}),
})
const toneOf = (value: number | null | undefined): 'up' | 'down' | undefined => (!value ? undefined : value > 0 ? 'up' : 'down')
const countText = (value: number | null | undefined, unit: string): string =>
  value === null || value === undefined ? NO_VALUE : `${formatCount(value)} ${unit}`

/** 合併組寫「和○○里合併計算」：組內其他里的名稱（組名「寶業里、龍子里」依「、」拆開，去掉這個里）。 */
function mergeNote(group: AreaTrendsVillage, village: string): string {
  const others = group.village.split('、').filter((name) => name && name !== village)
  return others.length ? `里界調整，和${others.join('、')}合併計算` : '里界調整，合併計算'
}

/** 招生機會那一列（只在 judged 為 true 且有列時出現）。合併組：組內各里加總，參觀率＝加總參觀 ÷ 組的 2–5 歲，不寫判讀（D16）。 */
function opportunityRow(rows: AreaOpportunityRow[], group: AreaTrendsVillage | undefined): FactRow | null {
  if (!rows.length) return null
  if (!group?.merged) {
    const row = rows[0]!
    const detail = [row.expected === null ? '' : `照附近應有${expectedText(row.expected)}`, signalText(row)].filter(Boolean).join('・')
    return factRow('招生機會', `參觀 ${formatCount(row.visit)} 位（${formatRate(row.rate)}）`, detail)
  }
  const visit = rows.reduce((sum, row) => sum + row.visit, 0)
  // 參觀與照附近應有要涵蓋同一批里：有一個里沒有附近平均就整句不寫，不拿缺一塊的加總去對全組的參觀。
  const expected = rows.every((row) => row.expected !== null) ? rows.reduce((sum, row) => sum + row.expected!, 0) : null
  const rate = group.children ? (visit / group.children) * 100 : null
  return factRow('招生機會', `參觀 ${formatCount(visit)} 位（${formatRate(rate)}）`, expected === null ? undefined : `照附近應有${expectedText(expected)}`)
}

interface KidsContext {
  code: string
  village: string
  sources: FactsSources
  group: AreaTrendsVillage | undefined
  oppRows: AreaOpportunityRow[]
  noPopulation: boolean
  campus: LatLng | null
  centroid: LatLng
}

/** 近 4 季新屋交屋：合併組寫這個里自己的筆數，小字補整組的筆數（同地圖彈出框）；新成屋還沒匯入寫「—」。 */
function homesRow(group: AreaTrendsVillage | undefined, code: string): FactRow {
  if (!group || group.new_homes === null) return factRow('近 4 季新屋交屋', NO_VALUE)
  return factRow('近 4 季新屋交屋', `${formatCount(homesCount(group, code))} 筆`, group.merged ? `整組 ${formatCount(group.new_homes)} 筆` : undefined)
}

function kidsRows({ code, sources, group, oppRows }: KidsContext): FactRow[] {
  const children = group?.children ?? (group?.merged ? null : (oppRows[0]?.children ?? null))
  const infants = oppRows.length ? oppRows.reduce((sum, row) => sum + row.infants, 0) : null
  const moves = group?.migration_net_12m ?? null
  const rows: FactRow[] = [
    factRow('2–5 歲', countText(children, '位')),
    factRow('0–1 歲', countText(infants, '位')),
    factRow(
      '這一年淨增',
      group ? kidsNetText(group) : NO_VALUE,
      group && group.kids_net !== null && group.kids_level !== 'unknown' ? KIDS_LEVEL_LABELS[group.kids_level] : undefined,
      toneOf(group?.kids_net),
    ),
    factRow('近 12 個月出生', countText(group?.births_12m, '位')),
    factRow('近 12 個月淨遷入', moves === null ? NO_VALUE : `${signedCount(moves)} 人`, undefined, toneOf(moves)),
    homesRow(group, code),
    factRow('所得中位數', group ? incomeText(group) : NO_VALUE),
  ]
  if (sources.opportunity?.baseline?.judged === true) {
    const row = opportunityRow(oppRows, group)
    if (row) rows.push(row)
  }
  return rows
}

/**
 * 孩子段的狀態：opportunity 或 trends 任何一份還在讀 → loading；沒有在讀、但有一份失敗 → failed；
 * 兩份都載入了才判斷 unavailable／no-population／outside／ok。只有一份到時不能判半徑外
 * （半徑內的里可能只出現在還沒到的那一份），所以不拿單邊資料湊數。
 */
function kidsFacts(ctx: KidsContext): VillageFacts['kids'] {
  const { sources, group, oppRows, village, noPopulation, campus, centroid } = ctx
  const { opportunity, trends, area } = sources
  const empty = { rows: [], note: '', mergeNote: '' }
  if (!opportunity || !trends) {
    const loading = (!opportunity && !sources.opportunityFailed) || (!trends && !sources.trendsFailed)
    return { ...empty, state: loading ? 'loading' : 'failed' }
  }
  const unavailable = opportunityUnavailable(opportunity)
  if (unavailable) return { ...empty, state: 'unavailable', note: unavailable }
  if (noPopulation) return { ...empty, state: 'no-population', note: NO_POPULATION_NOTE }
  if (!group && !oppRows.length) {
    // 兩份都沒有這個里＝半徑外；本校座標以 area 為準，它沒有（和 opportunity 不一致）就算不出距離，不能寫成半徑外。
    if (!campus) return { ...empty, state: 'unavailable', note: campusUnlocatedNote(area.campus.locate_error) }
    return { ...empty, state: 'outside', note: outsideRadiusText(distanceMeters(centroid, campus), sources.radiusKm) }
  }
  return { state: 'ok', rows: kidsRows(ctx), note: '', mergeNote: group?.merged ? mergeNote(group, village) : '' }
}

/** 在籍一列：先比里代碼，對不到（後端對不到里界時 village_code 是 null）再比區＋里名，同地圖彈出框。 */
function enrolledRow(enrolled: AreaEnrolled, code: string, district: string, village: string): FactRow {
  const match =
    enrolled.villages.find((item) => item.village_code === code) ??
    enrolled.villages.find((item) => item.district === district && item.village === village)
  const total = match ? pointCount(match.counts, 'all') : 0
  if (!match || !total) return factRow('在籍', '0 位')
  const count = (grade: EnrolledGrade): number => match.counts[grade] ?? 0
  const grades = `幼幼 ${count('幼幼班')}・小 ${count('小班')}・中 ${count('中班')}・大 ${count('大班')}`
  return factRow('在籍', `${formatCount(total)} 位`, count('其他') > 0 ? `${grades}・其他 ${count('其他')}` : grades)
}

function oursFacts(sources: FactsSources, code: string, district: string, village: string): VillageFacts['ours'] {
  const { enrolled, enrolledFailed, area } = sources
  const rows: FactRow[] = []
  if (enrolled?.status === 'ready') rows.push(enrolledRow(enrolled, code, district, village))
  const key = villageKey(district, village)
  const visit = area.villages.find((row) => villageKey(row.district, row.village) === key)
  rows.push(
    visit && visit.visit > 0
      ? factRow('參觀', `${formatCount(visit.visit)} 位`, `預繳 ${formatCount(visit.deposit)}`)
      : factRow('參觀', '0 位'),
  )
  return {
    state: enrolled ? 'ok' : enrolledFailed ? 'failed' : 'loading',
    rows,
    openRecordsArea: visit && visit.visit > 0 ? key : null,
  }
}

/** 附近的幼兒園（D8）：里中心 500 m 內、近到遠最多 5 所；幼兒園 API 只回半徑內的園所，靠近邊界的里會漏算，寧可不列。 */
function nearbyKindergartens(
  kindergartens: AreaKindergartens | null,
  campus: LatLng | null,
  centroid: LatLng,
  radiusKm: RadiusKm,
): NearbyKindergarten[] | null {
  if (!kindergartens || !campus) return null
  if (distanceMeters(centroid, campus) > radiusKm * 1000 - NEARBY_MAX_M) return null
  return kindergartens.items
    .map((item) => ({ item, distance: distanceMeters(centroid, item) }))
    .filter(({ distance }) => distance <= NEARBY_MAX_M)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, NEARBY_MAX_COUNT)
    .map(({ item, distance }) => ({
      name: shortName(item.name),
      kind: item.kind,
      kindLabel: item.is_own ? '本機構' : kindLabel(item.kind),
      isOwn: item.is_own,
      distance: formatDistance(distance),
    }))
}

/**
 * 一個里的卡片內容。里界沒有這個代碼回 null。
 * 孩子段的來源是 opportunity（village_code 對）與 trends（codes[] 對），先看 trends 列（合併組用整組數字），
 * 兩份都沒有這個里才算半徑外；半徑外沒有後端算的距離，副標只寫「在本校 N 公里外」（D9）。
 */
export function villageFacts(code: string, sources: FactsSources): VillageFacts | null {
  const feature = findFeature(sources.boundaries, code)
  if (!feature) return null
  const { TOWNNAME: district, VILLNAME: village } = feature.properties
  const { area, opportunity, trends, radiusKm } = sources
  const campus = area.campus.lat !== null && area.campus.lng !== null ? { lat: area.campus.lat, lng: area.campus.lng } : null
  const centroid = featureCentroid(feature)

  const group = trends?.villages.find((row) => row.codes.includes(code))
  const memberCodes = group?.merged ? group.codes : [code]
  const oppRows = opportunity?.villages.filter((row) => memberCodes.includes(row.village_code)) ?? []
  const missing = opportunity?.no_population_villages.find((item) => item.village_code === code)

  const kids = kidsFacts({ code, village, sources, group, oppRows, noPopulation: missing !== undefined, campus, centroid })

  const distance = group?.distance_m ?? oppRows[0]?.distance_m ?? missing?.distance_m
  const schools = group?.schools.length ? `・${villageSchoolsText(group)}學區` : ''
  const subtitle =
    kids.state === 'outside' ? `在本校 ${radiusKm} 公里外` : distance === undefined ? '' : `距本校 ${formatDistance(distance)}${schools}`

  return {
    code,
    title: `${district}${village}`,
    subtitle,
    kids,
    ours: oursFacts(sources, code, district, village),
    nearby: kids.state === 'outside' ? null : nearbyKindergartens(sources.kindergartens, campus, centroid, radiusKm),
  }
}
