import type { StatsColumn } from '../../../admissions/statsFormat'
import type { AreaPresale } from '../../../api/types'
import type { CsvCell } from '../../../utils/csv'
import { formatDistance, presaleDeliveryText, presaleLocateText, presalePermitText } from './areaFormat'

// 區域分析「預售建案」清單（2026-10-20 規格 P12）：把附近預售建案 API 的列整理成表格與手機卡片共用的列。
// 純函式，不碰 Vue／API。後端已依預計交屋由近到遠排好（已過預計時間的在最前），這裡不重排。

export interface PresaleRow extends Record<string, unknown> {
  /** 列鍵：區＋案名（後端的唯一鍵）。 */
  key: string
  name: string
  /** 地圖選取用的里代碼。 */
  village_code: string
  district: string
  village: string
  /** 「三民區本揚里」。 */
  place: string
  households: number
  /** 建照日「2024/03/10」。 */
  permit: string
  /** 預計交屋（粗估）：「約 2028 上半年」或「已過預計時間（尚未登記）」。 */
  delivery: string
  overdue: boolean
  distance: string
  distance_m: number
  /** 定位方式：依地號／依門牌。 */
  locate: string
}

export function presaleRows(data: AreaPresale): PresaleRow[] {
  return data.items.map((item) => ({
    key: `${item.district}/${item.name}`,
    name: item.name,
    village_code: item.village_code,
    district: item.district,
    village: item.village,
    place: `${item.district}${item.village}`,
    households: item.households,
    permit: presalePermitText(item),
    delivery: presaleDeliveryText(item),
    overdue: item.overdue,
    distance: formatDistance(item.distance_m),
    distance_m: item.distance_m,
    locate: presaleLocateText(item.match_level),
  }))
}

export const PRESALE_COLUMNS: readonly StatsColumn[] = [
  { key: 'name', label: '案名', sticky: true },
  { key: 'place', label: '區／里' },
  { key: 'households', label: '戶數', kind: 'count' },
  { key: 'permit', label: '建照日' },
  { key: 'delivery', label: '預計交屋（粗估）' },
  { key: 'distance', label: '距本校' },
]

/** 匯出的欄：畫面欄＋定位方式（依地號／依門牌）。 */
export const PRESALE_CSV_COLUMNS: readonly StatsColumn[] = [...PRESALE_COLUMNS, { key: 'locate', label: '定位方式' }]

/** CSV 的格值：戶數寫數字，其餘同畫面（回 undefined＝照 StatsDimensionTable 的欄位規則）。 */
export function presaleCsvCell(row: PresaleRow, column: StatsColumn): CsvCell | undefined {
  return column.key === 'households' ? row.households : undefined
}

/** 手機卡片的匯出：和表格匯出同樣的欄與格值（含 # 欄）。 */
export function presaleCsv(rows: readonly PresaleRow[]): { header: string[]; rows: CsvCell[][] } {
  return {
    header: ['#', ...PRESALE_CSV_COLUMNS.map((column) => column.label)],
    rows: rows.map((row, index) => [
      index + 1,
      ...PRESALE_CSV_COLUMNS.map((column) => presaleCsvCell(row, column) ?? String(row[column.key] ?? '')),
    ]),
  }
}
