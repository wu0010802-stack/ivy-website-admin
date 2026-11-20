import { describe, expect, it } from 'vitest'
import {
  AREA_TABLE_TABS, DEFAULT_AREA_VIEW, MAP_MODES, areaViewQuery, isMapMode, parseAreaViewQuery, samePoint,
} from '../admissions/areaView'

describe('區域分析工作台的模式、表格分頁與網址（規格 §2.1、§5、D2）', () => {
  it('讀網址：認得的值照收，認不得的退回預設', () => {
    expect(parseAreaViewQuery({ map: 'trend', village: '64000050015', table: 'school' }))
      .toEqual({ map: 'trend', village: '64000050015', table: 'school', year: null, point: null })
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

  it('五校版圖：map=campuses 讀得進、寫得出來', () => {
    expect(parseAreaViewQuery({ map: 'campuses' }).map).toBe('campuses')
    expect(areaViewQuery({ ...DEFAULT_AREA_VIEW, map: 'campuses' })).toEqual({ map: 'campuses' })
    expect(isMapMode('campuses')).toBe(true)
  })

  it('讀網址：每個模式與每個分頁都認得', () => {
    for (const mode of MAP_MODES) expect(parseAreaViewQuery({ map: mode.value }).map).toBe(mode.value)
    for (const tab of AREA_TABLE_TABS) expect(parseAreaViewQuery({ table: tab }).table).toBe(tab)
    // 繼承來的屬性名稱不是模式
    expect(parseAreaViewQuery({ map: 'constructor', table: 'toString' })).toEqual(DEFAULT_AREA_VIEW)
  })

  it('寫網址：預設值不寫', () => {
    expect(areaViewQuery(DEFAULT_AREA_VIEW)).toEqual({})
    expect(areaViewQuery({ map: 'peers', village: '64000050001', table: 'fees', year: null, point: null }))
      .toEqual({ map: 'peers', village: '64000050001', table: 'fees' })
    expect(areaViewQuery({ map: null, village: '', table: 'village', year: null, point: null })).toEqual({})
    expect(areaViewQuery({ map: 'visits', village: '', table: 'village', year: null, point: null })).toEqual({ map: 'visits' })
  })

  it('寫了再讀回來是同一個畫面', () => {
    const view = { map: 'homes' as const, village: '64000020015', table: 'births' as const, year: 108, point: null }
    expect(parseAreaViewQuery(areaViewQuery(view))).toEqual(view)
    expect(parseAreaViewQuery(areaViewQuery(DEFAULT_AREA_VIEW))).toEqual(DEFAULT_AREA_VIEW)
  })

  it('年份：只收三位數字，其他當沒帶；有年份才寫網址（2026-11-16 規格 §5.3）', () => {
    expect(parseAreaViewQuery({ year: '108' }).year).toBe(108)
    for (const year of ['abc', '1080', '10', '', ' 108', '-10']) expect(parseAreaViewQuery({ year }).year).toBeNull()
    expect(areaViewQuery({ ...DEFAULT_AREA_VIEW, year: 108, point: null })).toEqual({ year: '108' })
    expect(areaViewQuery(DEFAULT_AREA_VIEW)).toEqual({})
  })

  it('DEFAULT_AREA_VIEW 凍結，要新值一律展開複製', () => {
    expect(Object.isFrozen(DEFAULT_AREA_VIEW)).toBe(true)
    expect({ ...DEFAULT_AREA_VIEW }).toEqual({ map: null, village: '', table: 'village', year: null, point: null })
  })

  it('isMapMode 只認八個模式值', () => {
    for (const mode of MAP_MODES) expect(isMapMode(mode.value)).toBe(true)
    for (const value of ['', 'heat', 'Peers', 'constructor', null, undefined, 1, ['peers']]) expect(isMapMode(value)).toBe(false)
  })

  it('模式順序與標籤（規格 §2.1、D2）', () => {
    expect(MAP_MODES.map((m) => m.value)).toEqual(['enrolled', 'campuses', 'children', 'trend', 'homes', 'presale', 'visits', 'opportunity', 'peers'])
    expect(MAP_MODES.map((m) => m.label)).toEqual(['在籍學生', '五校版圖', '2–5 歲孩子', '孩子增減', '新屋交屋', '在建預售', '參觀', '招生機會', '同業'])
    // 預售建案（2026-10-20）在各里之後、國小學區之前。
    expect(AREA_TABLE_TABS).toEqual(['village', 'presale', 'school', 'enrolled', 'fees', 'births', 'visits'])
  })

  it('pt 讀成四位小數的圖釘位置，超出高雄或格式不對當沒帶', () => {
    expect(parseAreaViewQuery({ pt: '22.627349,120.30142' }).point).toEqual({ lat: 22.6273, lng: 120.3014 })
    for (const pt of ['abc', '25.03,121.56', '22.6', '22.6,120.3,1', '22.6273491,120.3014', '']) {
      expect(parseAreaViewQuery({ pt }).point).toBeNull()
    }
    expect(parseAreaViewQuery({}).point).toBeNull()
    expect(parseAreaViewQuery({ pt: '22.627349,120.301412' }).point).toEqual({ lat: 22.6273, lng: 120.3014 })
  })

  it('圖釘寫了再讀回來是同一個點', () => {
    const view = { ...DEFAULT_AREA_VIEW, point: { lat: 22.6273, lng: 120.3014 } }
    expect(parseAreaViewQuery(areaViewQuery(view))).toEqual(view)
  })

  it('areaViewQuery 寫 pt（四位小數），沒有圖釘就不寫', () => {
    expect(areaViewQuery({ ...DEFAULT_AREA_VIEW, point: { lat: 22.6273, lng: 120.3014 } })).toEqual({ pt: '22.6273,120.3014' })
    expect(areaViewQuery({ ...DEFAULT_AREA_VIEW, point: null })).not.toHaveProperty('pt')
  })
})

describe('samePoint', () => {
  it('比座標不比參考；都沒有也算一樣', () => {
    expect(samePoint({ lat: 22.65, lng: 120.31 }, { lat: 22.65, lng: 120.31 })).toBe(true)
    expect(samePoint({ lat: 22.65, lng: 120.31 }, { lat: 22.65, lng: 120.3101 })).toBe(false)
    expect(samePoint(null, null)).toBe(true)
    expect(samePoint(null, { lat: 22.65, lng: 120.31 })).toBe(false)
  })
})
