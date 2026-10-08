// 區域分析「查看明細」帶到訪視明細的篩選（2026-10-08 規格 8.4、9.6）。網址 query `area`：
// 「三民區」＝整個行政區、「三民區/本揚里」＝某一里、「no_village」＝未定位到里（只到區、查無門牌、
// 非高雄市地址、待比對）。對到明細 API 的 district／village／geo 三個參數。
export type AreaFilter = { kind: 'place'; district: string; village: string | null } | { kind: 'no_village' }

const NO_VILLAGE = 'no_village'
// 高雄 38 區都叫「○○區」、里都叫「○○里」；其他寫法（手改的網址）當成沒篩。
const DISTRICT = /^\p{Script=Han}{1,6}區$/u
const VILLAGE = /^\p{Script=Han}{1,8}里$/u

export function parseAreaQuery(value: unknown): AreaFilter | null {
  if (typeof value !== 'string' || !value) return null
  if (value === NO_VILLAGE) return { kind: 'no_village' }
  const [district = '', village, ...rest] = value.split('/')
  if (rest.length || !DISTRICT.test(district)) return null
  if (village === undefined) return { kind: 'place', district, village: null }
  return VILLAGE.test(village) ? { kind: 'place', district, village } : null
}

export function areaQuery(filter: AreaFilter): string {
  if (filter.kind === 'no_village') return NO_VILLAGE
  return filter.village ? `${filter.district}/${filter.village}` : filter.district
}

/** 訪視明細上方的提示句（比照「只顯示這筆官網預約建立的招生訪視。」）。 */
export function areaNotice(filter: AreaFilter): string {
  return filter.kind === 'no_village'
    ? '只顯示未定位到里的訪視（只到區、查無門牌、非高雄市地址或待比對）。'
    : `只顯示${filter.district}${filter.village ?? ''}的訪視。`
}

export function areaApiParams(filter: AreaFilter | null): { district: string | null; village: string | null; geo: 'no_village' | null } {
  if (!filter) return { district: null, village: null, geo: null }
  if (filter.kind === 'no_village') return { district: null, village: null, geo: 'no_village' }
  return { district: filter.district, village: filter.village, geo: null }
}
