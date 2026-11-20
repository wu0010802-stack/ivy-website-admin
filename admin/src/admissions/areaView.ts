import type { LocationQuery } from 'vue-router'

// 區域分析地圖工作台（2026-10-16 規格 §2.1、§5、D2）的畫面狀態：地圖看什麼、選哪個里、表格看哪一頁。
// 純函式，不碰 Vue／Leaflet／API，網址 map／village／table 三個參數的讀寫都在這裡。

/** 地圖著色：在籍學生、2–5 歲孩子、孩子增減、新屋交屋、在建預售、參觀、招生機會、同業（不上色）。 */
export type MapMode = 'enrolled' | 'children' | 'trend' | 'homes' | 'presale' | 'visits' | 'opportunity' | 'peers'
export const MAP_MODES: readonly { value: MapMode; label: string }[] = [
  { value: 'enrolled', label: '在籍學生' },
  { value: 'children', label: '2–5 歲孩子' },
  { value: 'trend', label: '孩子增減' },
  { value: 'homes', label: '新屋交屋' },
  { value: 'presale', label: '在建預售' },
  { value: 'visits', label: '參觀' },
  { value: 'opportunity', label: '招生機會' },
  { value: 'peers', label: '同業' },
]

/** 地圖下方的表格分頁：各里、預售建案（2026-10-20，放在各里之後、國小學區之前）、國小學區、在籍學生、同業收費、出生走勢、參觀來源。 */
export type AreaTableTab = 'village' | 'presale' | 'school' | 'enrolled' | 'fees' | 'births' | 'visits'
export const AREA_TABLE_TABS: readonly AreaTableTab[] = ['village', 'presale', 'school', 'enrolled', 'fees', 'births', 'visits']

export interface AreaView {
  /** null＝這個校區當下的預設模式（規格 §2.1，由 AreaTab 依資料狀況決定）。 */
  map: MapMode | null
  /** 里代碼（VILLCODE，11 位數字）；空字串＝沒選。 */
  village: string
  table: AreaTableTab
  /** 「2–5 歲孩子」模式的年份滑桿（2026-11-16 規格 §5.3）：民國年；null＝最新。只在這個模式有效，換模式就拿掉。 */
  year: number | null
  /** 圖釘位置（2026-11-20）：查「這個點附近」的座標，四捨五入到 4 位小數；null＝沒放圖釘。 */
  point: { lat: number; lng: number } | null
}

/** 預設畫面；凍結，要新值（model 預設、重設）一律 `{ ...DEFAULT_AREA_VIEW }`。 */
export const DEFAULT_AREA_VIEW: Readonly<AreaView> = Object.freeze({ map: null, village: '', table: 'village', year: null, point: null })

// VILLCODE：縣市 2 碼＋鄉鎮 3 碼＋里 6 碼，例 64000050015。
const VILLAGE_CODE = /^\d{11}$/
// 年份：民國三位數（107…）；實際有哪些年由後端的九月表決定，不在格子裡的年份由 AreaTab 退回最新。
const YEAR = /^\d{3}$/

// 網址參數重複時取第一個；非字串（null、巢狀）當沒帶。
const text = (value: unknown): string => {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first : ''
}

export function isMapMode(value: unknown): value is MapMode {
  return typeof value === 'string' && MAP_MODES.some((mode) => mode.value === value)
}

const isTableTab = (value: unknown): value is AreaTableTab =>
  typeof value === 'string' && (AREA_TABLE_TABS as readonly string[]).includes(value)

// 圖釘：`pt=<lat>,<lng>`，小數最多 6 位，限高雄範圍（同後端 KAOHSIUNG_LAT_RANGE／LNG_RANGE）。
const POINT = /^(\d{1,3}(?:\.\d{1,6})?),(\d{1,3}(?:\.\d{1,6})?)$/
const POINT_LAT_RANGE = [22.4, 23.5] as const
const POINT_LNG_RANGE = [120.1, 121.1] as const
export const round4 = (n: number) => Math.round(n * 10000) / 10000

function parsePoint(raw: string): AreaView['point'] {
  const m = POINT.exec(raw)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  if (lat < POINT_LAT_RANGE[0] || lat > POINT_LAT_RANGE[1] || lng < POINT_LNG_RANGE[0] || lng > POINT_LNG_RANGE[1]) return null
  return { lat: round4(lat), lng: round4(lng) }
}

/** 兩個圖釘座標一樣嗎（都沒有也算一樣）：patchView 用它，同座標的新物件不重寫網址。 */
export function samePoint(a: AreaView['point'], b: AreaView['point']): boolean {
  if (a === null || b === null) return a === b
  return a.lat === b.lat && a.lng === b.lng
}

/** 讀網址：認得的值照收，認不得的當沒帶（退回預設）。 */
export function parseAreaViewQuery(query: LocationQuery): AreaView {
  const map = text(query.map)
  const village = text(query.village)
  const table = text(query.table)
  const year = text(query.year)
  const pt = text(query.pt)
  return {
    map: isMapMode(map) ? map : DEFAULT_AREA_VIEW.map,
    village: VILLAGE_CODE.test(village) ? village : DEFAULT_AREA_VIEW.village,
    table: isTableTab(table) ? table : DEFAULT_AREA_VIEW.table,
    year: YEAR.test(year) ? Number(year) : DEFAULT_AREA_VIEW.year,
    point: parsePoint(pt),
  }
}

/** 寫網址：預設值（map 為 null、沒選里、table 為 village、year 為 null、沒有圖釘）不寫。 */
export function areaViewQuery(view: AreaView): Record<string, string> {
  const query: Record<string, string> = {}
  if (view.map !== null) query.map = view.map
  if (view.village !== DEFAULT_AREA_VIEW.village) query.village = view.village
  if (view.table !== DEFAULT_AREA_VIEW.table) query.table = view.table
  if (view.year !== null) query.year = String(view.year)
  if (view.point !== null) query.pt = `${view.point.lat.toFixed(4)},${view.point.lng.toFixed(4)}`
  return query
}
