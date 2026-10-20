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
}

/** 預設畫面；凍結，要新值（model 預設、重設）一律 `{ ...DEFAULT_AREA_VIEW }`。 */
export const DEFAULT_AREA_VIEW: Readonly<AreaView> = Object.freeze({ map: null, village: '', table: 'village' })

// VILLCODE：縣市 2 碼＋鄉鎮 3 碼＋里 6 碼，例 64000050015。
const VILLAGE_CODE = /^\d{11}$/

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

/** 讀網址：認得的值照收，認不得的當沒帶（退回預設）。 */
export function parseAreaViewQuery(query: LocationQuery): AreaView {
  const map = text(query.map)
  const village = text(query.village)
  const table = text(query.table)
  return {
    map: isMapMode(map) ? map : DEFAULT_AREA_VIEW.map,
    village: VILLAGE_CODE.test(village) ? village : DEFAULT_AREA_VIEW.village,
    table: isTableTab(table) ? table : DEFAULT_AREA_VIEW.table,
  }
}

/** 寫網址：預設值（map 為 null、沒選里、table 為 village）不寫。 */
export function areaViewQuery(view: AreaView): Record<string, string> {
  const query: Record<string, string> = {}
  if (view.map !== null) query.map = view.map
  if (view.village !== DEFAULT_AREA_VIEW.village) query.village = view.village
  if (view.table !== DEFAULT_AREA_VIEW.table) query.table = view.table
  return query
}
