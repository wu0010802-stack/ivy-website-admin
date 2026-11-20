import type { AreaPoint, AreaPointRow } from '../api/types'

// 地點卡片測試用的虛構資料。
export const pointRow = (changes: Partial<AreaPointRow> = {}): AreaPointRow => ({
  unavailable: null, locate_error: null, children: 8420, infants: 3100, kids_net: 36, kids_unavailable: null,
  kindergartens: { private: 9, quasi_public: 6, public: 2, nonprofit: 1 }, babycare: 14, fee_median: 41000,
  presale_households: 1230, changes_12m: 1,
  housing: { sale_median: 299000, sale_count: 42, rent_median: 18500, rent_count: 12 },
  enrolled: [{ campus_key: 'yihua', count: 40 }, { campus_key: 'minghua', count: 3 }],
  ...changes,
})
export const point = (point: Partial<AreaPointRow> = {}, campus: Partial<AreaPointRow> | null = {}, extra: Partial<AreaPoint> = {}): AreaPoint => ({
  as_of: '2026-11-20T00:00:00Z', radius_km: 3,
  point: { lat: 22.65, lng: 120.31, district: '三民區', village: '寶興里', village_code: '64000050001' },
  nearest_campus: { key: 'yihua', name: '義華', distance_m: 1800 },
  sources: { population_version: '115-10', fee_school_year: 114, housing: { latest: '115S3', seasons: ['a', 'b', 'c', 'd'], note: '' } },
  rows: { point: pointRow(point), campus: campus === null ? null : pointRow(campus) },
  ...extra,
})
