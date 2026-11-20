import type { AreaPoint, AreaPointRow } from '../../../api/types'
import { campusLabel } from '../../../api/labels'
import { NO_VALUE } from '../../../admissions/statsFormat'
import { campusNotLocatedReason, formatCount, formatDistance, housingPriceText, housingRentText, kidsUnavailableReason, signedCount } from './areaFormat'
import { formatYuan } from './peerFeesFormat'

// 區域分析「地點卡片」的文字（2026-11-20 規格 §5.1）。純函式，不碰 Vue／API；格子寫法和五校比較表一致。

export interface PointTableRow {
  label: string
  point: string
  campus: string
}

const count = (value: number | null | undefined): string => (value === null || value === undefined ? NO_VALUE : formatCount(value))

/** 不到 5 筆中位數是 null：有筆數寫「—（N 筆）」，沒有筆數就只寫「—」。 */
function medianText(text: string, median: number | null, n: number): string {
  return median === null && n > 0 ? `${text}（${n} 筆）` : text
}

function enrolledText(row: AreaPointRow): string {
  if (!row.enrolled.length) return '尚未匯入清冊'
  const positive = row.enrolled.filter((item) => item.count > 0)
  const hasZero = row.enrolled.some((item) => item.count === 0)
  const listed = positive.map((item) => `${campusLabel(item.campus_key)} ${formatCount(item.count)}`).join('・')
  if (!hasZero) return listed
  return listed ? `${listed}，其他已匯入的校 0 位` : '已匯入的校 0 位'
}

function cells(row: AreaPointRow): string[] {
  if (row.unavailable !== null) return Array(11).fill(NO_VALUE)
  const kg = row.kindergartens
  return [
    count(row.children),
    count(row.infants),
    signedCount(row.kids_net),
    kg ? `${kg.private}／${kg.quasi_public}／${kg.public}／${kg.nonprofit}` : NO_VALUE,
    count(row.babycare),
    formatYuan(row.fee_median),
    count(row.presale_households),
    count(row.changes_12m),
    row.housing ? medianText(housingPriceText(row.housing.sale_median, row.housing.sale_count), row.housing.sale_median, row.housing.sale_count) : NO_VALUE,
    row.housing ? medianText(housingRentText(row.housing.rent_median, row.housing.rent_count), row.housing.rent_median, row.housing.rent_count) : NO_VALUE,
    enrolledText(row),
  ]
}

const LABELS = [
  '2–5 歲孩子', '0–1 歲', '這一年淨增', '幼兒園（私立／準公共／公立／非營利）', '托嬰', '私立一般 3 歲一學期中位',
  '在建預售（戶）', '近 12 個月園所異動', '房價中位數（萬元／坪）', '整戶月租中位數（元）', '常春藤在籍住在圈內',
]

/** 表格列（順序照規格示意）。campusName 不影響內容，留給呼叫端對齊欄頭。 */
export function pointRows(data: AreaPoint): PointTableRow[] {
  const point = cells(data.rows.point)
  const campus = data.rows.campus ? cells(data.rows.campus) : Array(LABELS.length).fill(NO_VALUE)
  return LABELS.map((label, index) => ({ label, point: point[index], campus: campus[index] }))
}

/** 第二欄欄頭：本校沒座標或算失敗時在校名後註明原因。 */
export function pointCampusHeader(data: AreaPoint, campusName: string): string {
  const row = data.rows.campus
  if (!row) return campusName
  if (row.unavailable === 'error') return `${campusName}（讀取失敗）`
  if (row.unavailable === 'no_campus_point') {
    const reason = campusNotLocatedReason(row.locate_error)
    return `${campusName}（位置未標示${reason ? `：${reason}` : ''}）`
  }
  return campusName
}

/** 卡片副標：「三民區寶興里・最近的校區 義華 1.8 公里」。 */
export function pointPlace(data: AreaPoint): string {
  const { district, village } = data.point
  const place = village ? `${district ?? ''}${village}` : '不在任何里界內'
  const near = data.nearest_campus
  return near ? `${place}・最近的校區 ${near.name} ${formatDistance(near.distance_m).replace(' km', ' 公里').replace(' m', ' 公尺')}` : place
}

/** 資料來源一行：「人口 115-10・收費 114 學年・實價 115S3（近 4 季）」，缺的那段省略。 */
export function pointSources(data: AreaPoint): string {
  const { population_version, fee_school_year, housing } = data.sources
  const parts: string[] = []
  if (population_version) parts.push(`人口 ${population_version}`)
  if (fee_school_year !== null) parts.push(`收費 ${fee_school_year} 學年`)
  if (housing.latest) parts.push(`實價 ${housing.latest}（近 ${housing.seasons.length} 季）`)
  return parts.join('・')
}

/** 「這一年淨增」算不出來的原因，兩欄同一個原因只寫一次。 */
export function pointFootnotes(data: AreaPoint): string[] {
  const reasons = [data.rows.point, data.rows.campus]
    .map((row) => (row && row.unavailable === null ? kidsUnavailableReason(row.kids_unavailable) : ''))
    .filter(Boolean)
  return [...new Set(reasons)]
}
