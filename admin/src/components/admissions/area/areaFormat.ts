import { NO_VALUE } from '../../../admissions/statsFormat'
import type { VillageBoundaries, VisitGeo } from '../../../api/types'

// 區域分析的顯示格式與地圖用的小工具（2026-10-08 規格 9）。

export type RadiusKm = 1 | 3 | 6
export const RADIUS_OPTIONS: readonly RadiusKm[] = [1, 3, 6]

/** 里的鍵：後端 villages 列（district＋village）與里界屬性（TOWNNAME＋VILLNAME）用同一個。 */
export const villageKey = (district: string, village: string): string => `${district}/${village}`

/** 南西角、東北角（[緯度, 經度]），Leaflet fitBounds 直接吃。 */
export type LatLngBox = [[number, number], [number, number]]

/**
 * 某個行政區所有里的外框；里界檔裡沒有這個區（或沒給區）回 null。本校沒有座標時地圖先框住校址
 * 所在的區，不退到整個高雄（含山區，一打開是半個南台灣）。GeoJSON 座標是 [經度, 緯度]，
 * Polygon 與 MultiPolygon 巢狀層數不同，遞迴找到數字對為止。
 */
export function districtBounds(boundaries: VillageBoundaries, district: string | null | undefined): LatLngBox | null {
  if (!district) return null
  let south = Infinity
  let west = Infinity
  let north = -Infinity
  let east = -Infinity
  const visit = (node: unknown): void => {
    if (!Array.isArray(node)) return
    const [lng, lat] = node
    if (typeof lng === 'number' && typeof lat === 'number') {
      south = Math.min(south, lat)
      north = Math.max(north, lat)
      west = Math.min(west, lng)
      east = Math.max(east, lng)
      return
    }
    node.forEach(visit)
  }
  for (const feature of boundaries.features) {
    if (feature.properties.TOWNNAME === district) visit(feature.geometry.coordinates)
  }
  return south === Infinity ? null : [[south, west], [north, east]]
}

/** 里界著色 5 級：0 筆是 0 級（不上色），其餘依該範圍參觀人數最多的那一里等分。 */
export function levelOf(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  return Math.min(5, Math.max(1, Math.ceil((count / max) * 5)))
}

/** 圖例：每一級涵蓋的人數（整數）；沒有整數落在裡面的級數不列。和 levelOf 同一個切法。 */
export function legendRanges(max: number): { level: number; label: string }[] {
  const ranges: { level: number; label: string }[] = []
  for (let level = 1; level <= 5; level++) {
    const low = Math.floor(((level - 1) * max) / 5) + 1
    const high = Math.floor((level * max) / 5)
    if (low > high) continue
    ranges.push({ level, label: low === high ? `${low}` : `${low}–${high}` })
  }
  return ranges
}

export const KIND_ORDER = ['public', 'nonprofit', 'quasi_public', 'private'] as const
export const KIND_LABELS: Record<string, string> = { public: '公立', nonprofit: '非營利', quasi_public: '準公共', private: '私立' }
export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind

export const BAND_LABELS: Record<string, string> = {
  '0-1': '1 公里內', '1-3': '1–3 公里', '3-6': '3–6 公里', '6+': '6 公里以上', none: '無距離',
}
export const bandLabel = (band: string): string => BAND_LABELS[band] ?? band

// 單筆訪視的比對原因五種都會出現（VisitGeoOut.unlocated_reason）；區域分析合計的原因清單只有
// 外縣市、查無門牌、里有歧義三種（沒填地址、已匿名化各有自己的筆數）。
export const REASON_LABELS: Record<string, string> = {
  no_address: '沒填地址',
  outside_kaohsiung: '非高雄市地址',
  no_doorplate: '查無門牌',
  ambiguous_village: '里有歧義',
  anonymized: '已匿名化',
}
export const reasonLabel = (reason: string): string => REASON_LABELS[reason] ?? reason

const CAMPUS_NOT_LOCATED = new Map([
  ['no_address', '找不到本校地址'],
  ['pending', '門牌資料尚未匯入'],
  ['no_doorplate', '本校地址比對不到門牌'],
])
/** 本校沒有座標時的原因（AreaCampus.locate_error）；不認得的值回 undefined，由呼叫端用自己的兜底句。 */
export const campusNotLocatedReason = (locateError: string | null): string | undefined =>
  locateError === null ? undefined : CAMPUS_NOT_LOCATED.get(locateError)

/** 門牌資料版本「115-10」→「115 年 10 月」；其他寫法（手動匯入的版本名）照原文。 */
export function doorplateVersionLabel(version: string): string {
  const match = /^(\d{3})-(\d{2})$/.exec(version)
  return match ? `${match[1]} 年 ${Number(match[2])} 月` : version
}

const dayFormatter = new Intl.DateTimeFormat('en-CA', { month: '2-digit', day: '2-digit', timeZone: 'Asia/Taipei' })
/** ISO 時間 → 台北日期「10/08」（資料更新日用）。不是 utils/visitSchedule 的 shortDay（附週幾）或 admissions/followUp 的 shortDay。 */
export function taipeiMonthDay(value: string | null | undefined): string {
  if (!value) return NO_VALUE
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return NO_VALUE
  const parts = Object.fromEntries(dayFormatter.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.month}/${parts.day}`
}

/**
 * 距離顯示規則：四捨五入到整數公尺後不滿 1000 m 就寫「999 m」；到 1000 m 起改寫一位小數的公里「1.0 km」。
 * 先取整再判斷單位：999.6 m 取整成 1000 m，直接走公里，不會出現「1000 m」。以前取整到 10 m，
 * 995–999 m 會被進位成「1000 m」，同一頁又有「1.0 km」，單位對不上。
 */
export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return NO_VALUE
  const rounded = Math.round(meters)
  if (rounded < 1000) return `${rounded} m`
  return `${(meters / 1000).toFixed(1)} km`
}

/** 園所名稱去掉「高雄市私立／高雄市立／高雄市」前綴，清單一行放得下。 */
export function shortName(name: string): string {
  return name.replace(/^高雄市(?:私立|市立|立)?/, '') || name
}

const VILLAGE_LEVELS = new Set(['exact', 'nearby', 'street'])

/**
 * 訪視明細展開列「區域」那一行（規格 9.6）。回空字串＝該行不列：沒填地址、已匿名化，以及沒有
 * 比對紀錄（geo 為 null 的舊資料；有填地址的由呼叫端寫「待比對」，見 RecordsTab）。
 * 到里：「行政區＋里」，有距離再加「・距本校 ○ km」；
 * 只到區：「行政區（只到區）」，里有歧義時寫原因；比對還沒跑寫「待比對」；
 * 其餘未定位：外縣市寫「非高雄市地址」，其他寫「未定位：查無門牌」。
 */
export function visitGeoText(geo: VisitGeo | null | undefined, district: string | null | undefined): string {
  if (!geo) return ''
  if (VILLAGE_LEVELS.has(geo.match_level) && geo.village) {
    const distance = geo.distance_m === null || geo.distance_m === undefined ? '' : `・距本校 ${formatDistance(geo.distance_m)}`
    return `${district ?? ''}${geo.village}${distance}`
  }
  if (geo.match_level === 'pending') return '待比對'
  if (geo.match_level === 'district') {
    if (!district) return ''
    if (geo.unlocated_reason === 'ambiguous_village') return `${district}（里有歧義）`
    if (geo.unlocated_reason === 'anonymized') return ''
    return `${district}（只到區）`
  }
  if (geo.unlocated_reason === 'no_address' || geo.unlocated_reason === 'anonymized') return ''
  if (geo.unlocated_reason === 'outside_kaohsiung') return '非高雄市地址'
  return '未定位：查無門牌'
}
