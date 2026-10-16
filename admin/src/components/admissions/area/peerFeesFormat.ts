import { NO_VALUE, type StatsColumn } from '../../../admissions/statsFormat'
import type { AreaFeeItems, AreaPeerFees } from '../../../api/types'
import type { CsvCell } from '../../../utils/csv'
import { formatCount, formatDistance, kindLabel, shortName, signedCount } from './areaFormat'

// 附近同業收費（2026-10-15 規格 7.1、7.2）：排名、中位數、項目對照只和私立一般比（規格 F2）。

export type PeerAge = 2 | 3 | 4 | 5
export const PEER_AGES: readonly PeerAge[] = [2, 3, 4, 5]
export const DEFAULT_PEER_AGE: PeerAge = 3

export const FEE_ITEM_KEYS = ['tuition', 'misc_fee', 'materials', 'activities', 'lunch', 'snack', 'after_care_monthly'] as const
export const FEE_ITEM_LABELS: Record<keyof AreaFeeItems, string> = {
  tuition: '學費', misc_fee: '雜費', materials: '材料費', activities: '活動費', lunch: '午餐費', snack: '點心費',
  after_care_monthly: '課後延托（每月）',
}
export const GROUP_LABELS: Record<string, string> = { private: '私立一般', quasi_public: '準公共', public: '公立', nonprofit: '非營利' }

export const formatYuan = (value: number | null | undefined): string =>
  value === null || value === undefined ? NO_VALUE : `${formatCount(value)} 元`

export function feeLagNote(schoolYear: number | null, currentSchoolYear: number): string {
  return schoolYear !== null && schoolYear < currentSchoolYear ? `目前是 ${currentSchoolYear} 學年，最新公開收費是 ${schoolYear} 學年。` : ''
}

export function peerFeesSubtitle(data: AreaPeerFees): string {
  return data.school_year === null ? '' : `${data.school_year} 學年・全日班・一學期公告收費`
}

const privateGroup = (data: AreaPeerFees) => data.groups.find((group) => group.kind === 'private')

function ownClause(data: AreaPeerFees, withRank: boolean): string {
  if (data.own) {
    const rank = withRank ? privateGroup(data)?.own_rank : null
    return rank ? `本校 ${formatYuan(data.own.semester_total)}，第 ${rank} 高。` : `本校 ${formatYuan(data.own.semester_total)}。`
  }
  if (data.own_missing === 'no_fee') return `本校沒有公布 ${data.age} 歲班收費。`
  if (data.own_missing === 'not_found') return '找不到本校在全國教保資訊網的資料。'
  return ''
}

/** 區塊最上面一句（規格 7.1）。 */
export function peerSummaryText(data: AreaPeerFees): string {
  const group = privateGroup(data)
  const lead = `${data.radius_km} 公里內`
  if (!group || group.schools === 0) return `${lead}沒有其他私立幼兒園（不含準公共）。${ownClause(data, false)}`
  if (group.with_fee === 0) return `${lead}私立幼兒園（不含準公共）都沒有公布收費。${ownClause(data, false)}`
  if (group.median === null) {
    return `${lead}私立幼兒園（不含準公共）只有 ${group.with_fee} 所公布收費，不算中位數。${ownClause(data, false)}`
  }
  const head = `${lead}私立幼兒園（不含準公共）有 ${group.with_fee} 所公布收費，${data.age} 歲班一學期中位數 ${formatYuan(group.median)}`
  const own = ownClause(data, true)
  return own ? `${head}；${own}` : `${head}。`
}

function rangeText(lowest: number | null, highest: number | null): string {
  if (lowest === null || highest === null) return NO_VALUE
  return lowest === highest ? formatYuan(lowest) : `${formatCount(lowest)}–${formatCount(highest)} 元`
}

export function groupRows(data: AreaPeerFees) {
  return data.groups.map((group) => ({
    kind: group.kind,
    label: GROUP_LABELS[group.kind] ?? group.kind,
    schools: formatCount(group.schools),
    withFee: formatCount(group.with_fee),
    median: formatYuan(group.median),
    range: rangeText(group.lowest, group.highest),
  }))
}

export function itemRows(data: AreaPeerFees) {
  return data.items.map((item) => {
    const own = data.own ? data.own.items[item.key] : item.own
    return {
      key: item.key,
      label: FEE_ITEM_LABELS[item.key],
      own: formatYuan(own),
      peer: formatYuan(item.peer_median),
      diff: own === null || item.peer_median === null ? NO_VALUE : `${signedCount(own - item.peer_median)} 元`,
    }
  })
}

/** 落點條（裝飾，aria-hidden）：私立一般同業每所一點加本校；中位數一條線。私立一般沒有中位數就不畫。 */
export function stripScale(data: AreaPeerFees) {
  const group = privateGroup(data)
  if (!group || group.median === null) return null
  const peers = data.schools.filter((school) => school.kind === 'private' && !school.is_own && school.semester_total !== null)
  const values = peers.map((school) => ({ id: school.source_id, value: school.semester_total!, own: false }))
  if (data.own) values.push({ id: data.own.source_id, value: data.own.semester_total, own: true })
  const lowest = Math.min(...values.map((point) => point.value))
  const highest = Math.max(...values.map((point) => point.value))
  const left = (value: number) => (highest === lowest ? 50 : Math.round(((value - lowest) / (highest - lowest)) * 1000) / 10)
  return {
    points: values.map((point) => ({ id: point.id, left: left(point.value), own: point.own })),
    median: left(group.median),
    lowestText: formatYuan(lowest),
    highestText: formatYuan(highest),
  }
}

export function schoolRows(data: AreaPeerFees) {
  return data.schools
    .filter((school) => (school.kind === 'private' || school.kind === 'quasi_public') && school.semester_total !== null)
    .sort((a, b) => b.semester_total! - a.semester_total! || a.distance_m - b.distance_m)
    .map((school) => ({
      source_id: school.source_id,
      name: shortName(school.name),
      kind: school.is_own ? '本機構' : kindLabel(school.kind),
      distance: formatDistance(school.distance_m),
      semester_total: school.semester_total,
      monthly_average: school.monthly_average,
      // 畫面用文字欄：沒有就寫「—」（StatsDimensionTable 的 count 欄會把 null 顯示成 0，也沒有千分位）。
      semester_total_text: school.semester_total === null ? NO_VALUE : formatCount(school.semester_total),
      monthly_average_text: school.monthly_average === null ? NO_VALUE : formatCount(school.monthly_average),
      ...school.items,
    }))
}

export type SchoolRow = ReturnType<typeof schoolRows>[number]

export const SCHOOL_COLUMNS: StatsColumn[] = [
  { key: 'name', label: '園所', sticky: true },
  { key: 'kind', label: '類型' },
  { key: 'distance', label: '距本校' },
  { key: 'semester_total_text', label: '學期總收費（元）' },
  { key: 'monthly_average_text', label: '月均（元）' },
]
export const SCHOOL_CSV_COLUMNS: StatsColumn[] = [
  ...SCHOOL_COLUMNS,
  ...FEE_ITEM_KEYS.map((key) => ({ key, label: `${FEE_ITEM_LABELS[key]}（元）` })),
]

/** 匯出 CSV 的收費格：寫原始數字，沒有就空白（不寫 0、不寫「—」）；其他欄回 undefined 照欄位規則。 */
export function schoolCsvCell(row: SchoolRow, column: StatsColumn): CsvCell | undefined {
  if (column.key === 'semester_total_text') return row.semester_total ?? ''
  if (column.key === 'monthly_average_text') return row.monthly_average ?? ''
  const itemKey = FEE_ITEM_KEYS.find((key) => key === column.key)
  return itemKey ? (row[itemKey] ?? '') : undefined
}

/** 附近幼兒園清單的來源小字（規格 7.2）：收費學年接在來源後面，學年落後再接一句。 */
export function feeSourceLine(sourceNote: string, updated: string, fees: AreaPeerFees | null): string {
  if (!fees || fees.school_year === null) return `${sourceNote}・${updated} 更新`
  const lag = feeLagNote(fees.school_year, fees.current_school_year)
  return `${sourceNote}・收費為 ${fees.school_year} 學年公告・${updated} 更新${lag ? `　${lag}` : ''}`
}
