import { describe, expect, it } from 'vitest'
import {
  AREA_TABLE_TABS, DEFAULT_AREA_VIEW, MAP_MODES, areaViewQuery, isMapMode, parseAreaViewQuery,
} from '../admissions/areaView'

describe('區域分析工作台的模式、表格分頁與網址（規格 §2.1、§5、D2）', () => {
  it('讀網址：認得的值照收，認不得的退回預設', () => {
    expect(parseAreaViewQuery({ map: 'trend', village: '64000050015', table: 'school' }))
      .toEqual({ map: 'trend', village: '64000050015', table: 'school' })
    expect(parseAreaViewQuery({ map: 'heat', village: 'abc', table: 'x' })).toEqual(DEFAULT_AREA_VIEW)
    expect(parseAreaViewQuery({ map: ['peers', 'visits'] })).toEqual({ ...DEFAULT_AREA_VIEW, map: 'peers' })
  })

  it('讀網址：沒帶、空字串、陣列開頭不是字串都當沒帶；里代碼必須剛好 11 位數字', () => {
    expect(parseAreaViewQuery({})).toEqual(DEFAULT_AREA_VIEW)
    expect(parseAreaViewQuery({ map: '', village: '', table: '' })).toEqual(DEFAULT_AREA_VIEW)
    expect(parseAreaViewQuery({ map: null, village: [null], table: [] })).toEqual(DEFAULT_AREA_VIEW)
    for (const village of ['6400005001', '640000500150', '6400005001a', ' 64000050015', '64000050015\n', '６４００００５００１５']) {
      expect(parseAreaViewQuery({ village }).village).toBe('')
    }
    expect(parseAreaViewQuery({ village: ['64000050015', 'x'] }).village).toBe('64000050015')
  })

  it('讀網址：每個模式與每個分頁都認得', () => {
    for (const mode of MAP_MODES) expect(parseAreaViewQuery({ map: mode.value }).map).toBe(mode.value)
    for (const tab of AREA_TABLE_TABS) expect(parseAreaViewQuery({ table: tab }).table).toBe(tab)
    // 繼承來的屬性名稱不是模式
    expect(parseAreaViewQuery({ map: 'constructor', table: 'toString' })).toEqual(DEFAULT_AREA_VIEW)
  })

  it('寫網址：預設值不寫', () => {
    expect(areaViewQuery(DEFAULT_AREA_VIEW)).toEqual({})
    expect(areaViewQuery({ map: 'peers', village: '64000050001', table: 'fees' }))
      .toEqual({ map: 'peers', village: '64000050001', table: 'fees' })
    expect(areaViewQuery({ map: null, village: '', table: 'village' })).toEqual({})
    expect(areaViewQuery({ map: 'visits', village: '', table: 'village' })).toEqual({ map: 'visits' })
  })

  it('寫了再讀回來是同一個畫面', () => {
    const view = { map: 'homes' as const, village: '64000020015', table: 'births' as const }
    expect(parseAreaViewQuery(areaViewQuery(view))).toEqual(view)
    expect(parseAreaViewQuery(areaViewQuery(DEFAULT_AREA_VIEW))).toEqual(DEFAULT_AREA_VIEW)
  })

  it('DEFAULT_AREA_VIEW 凍結，要新值一律展開複製', () => {
    expect(Object.isFrozen(DEFAULT_AREA_VIEW)).toBe(true)
    expect({ ...DEFAULT_AREA_VIEW }).toEqual({ map: null, village: '', table: 'village' })
  })

  it('isMapMode 只認七個模式值', () => {
    for (const mode of MAP_MODES) expect(isMapMode(mode.value)).toBe(true)
    for (const value of ['', 'heat', 'Peers', 'constructor', null, undefined, 1, ['peers']]) expect(isMapMode(value)).toBe(false)
  })

  it('模式順序與標籤（規格 §2.1、D2）', () => {
    expect(MAP_MODES.map((m) => m.value)).toEqual(['enrolled', 'children', 'trend', 'homes', 'visits', 'opportunity', 'peers'])
    expect(MAP_MODES.map((m) => m.label)).toEqual(['在籍學生', '2–5 歲孩子', '孩子增減', '新屋交屋', '參觀', '招生機會', '同業'])
    expect(AREA_TABLE_TABS).toEqual(['village', 'school', 'enrolled', 'fees', 'births', 'visits'])
  })
})
