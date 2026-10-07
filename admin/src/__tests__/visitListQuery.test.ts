import { describe, expect, it } from 'vitest'
import type { LocationQuery } from 'vue-router'
import { listApiOrder, listApiParams, listStateQuery, parseListQuery, searchTerm, tabFromQuery, type ListState } from '../api/visitListQuery'

const scope = { campusKeys: ['yihua', 'minghua'], multiCampus: true }
const query = (raw: string): LocationQuery => Object.fromEntries(new URLSearchParams(raw))
const state = (changes: Partial<ListState> = {}): ListState => ({
  tab: 'upcoming', attendanceOnly: false, q: '', campus: '', open: false, source: '', created: null,
  due: false, attention: false, order: 'visit', page: 1, ...changes,
})

describe('舊連結落在哪個頁籤（2026-10-06 方向 B）', () => {
  it.each([
    ['', 'upcoming', false, '側欄、總覽「補登案件」'],
    ['group=upcoming', 'upcoming', false, '總覽今天有幾組參觀'],
    ['group=upcoming&order=oldest', 'upcoming', false, '改版前的總覽連結'],
    ['group=past&status=confirmed', 'past', true, '總覽、成效統計、招生看板「還沒標記到場」'],
    ['campus=yihua&group=past&status=confirmed', 'past', true, '成效統計帶校區'],
    ['group=past', 'past', false, '舊的時間已過'],
    ['group=cancelled', 'cancelled', false, '舊的已取消'],
    ['due=1', 'all', false, '總覽到期待追蹤'],
    ['campus=yihua&due=1', 'all', false, '成效統計到期待追蹤'],
    ['attention=1&campus=yihua', 'all', false, '待人工處理'],
    ['assignee=inactive&open=1', 'all', false, '拿掉承辦人前的舊連結'],
    ['open=1', 'all', false, '個資保存政策頁「逾期未結案」'],
    ['status=confirmed&order=oldest', 'upcoming', false, '舊書籤 ?status='],
    ['status=completed', 'arrived', false, '舊書籤已到場'],
    ['status=no_show', 'past', false, '舊書籤未到場'],
    ['status=new', 'all', false, '舊流程狀態'],
    ['group=pending', 'all', false, '拿掉的待處理分組'],
    ['q=%E9%99%B3', 'all', false, '改版前在「全部」搜尋的書籤'],
    ['group=arrived', 'arrived', false, '新的已到場'],
    ['group=all&due=1', 'all', false, '新的全部'],
  ])('?%s → %s（%s）', (raw, tab, attendanceOnly) => {
    const parsed = parseListQuery(query(raw), scope)
    expect(parsed.tab).toBe(tab)
    expect(parsed.attendanceOnly).toBe(attendanceOnly)
  })

  it('?open=1（個資保存政策頁）落在「全部」並打開「只看未結案」', () => {
    expect(parseListQuery(query('open=1'), scope)).toMatchObject({ tab: 'all', open: true })
    expect(listApiParams(parseListQuery(query('open=1'), scope)).get('open')).toBe('true')
    expect(listApiParams(parseListQuery(query('open=1'), scope)).has('view')).toBe(false)
  })

  it('tabFromQuery 只看 group／status 與有沒有其他條件', () => {
    expect(tabFromQuery({})).toBe('upcoming')
    expect(tabFromQuery({ page: '2' })).toBe('all')
  })

  it('其他條件照舊讀：校區要在可見範圍、日期要成對、排序只收 newest／oldest', () => {
    const parsed = parseListQuery(query('group=upcoming&campus=chongde&created_from=2026-10-01&order=visit&page=3&source=phone'), scope)
    expect(parsed).toMatchObject({ campus: '', created: null, order: 'visit', page: 3, source: 'phone' })
  })
})

describe('寫回網址', () => {
  it('只有「接下來＋沒有其他條件」省略 group', () => {
    expect(listStateQuery(state())).toEqual({})
    expect(listStateQuery(state({ q: '陳' }))).toEqual({ group: 'upcoming', q: '陳' })
    expect(listStateQuery(state({ tab: 'all', due: true }))).toEqual({ group: 'all', due: '1' })
    expect(listStateQuery(state({ tab: 'past', attendanceOnly: true, campus: 'yihua' }))).toEqual({ group: 'past', status: 'confirmed', campus: 'yihua' })
    expect(listStateQuery(state({ order: 'oldest', page: 2 }))).toEqual({ group: 'upcoming', order: 'oldest', page: '2' })
  })

  it('讀回自己寫的網址得到同一個狀態', () => {
    for (const s of [state(), state({ q: '陳' }), state({ tab: 'all', due: true }), state({ tab: 'cancelled', page: 2 }), state({ tab: 'past', attendanceOnly: true })]) {
      expect(parseListQuery(listStateQuery(s), scope)).toEqual(s)
    }
  })
})

describe('API 參數', () => {
  it('頁籤送 view、全部不送；只看尚未確認到場加 status=confirmed；件數不帶頁籤與狀態', () => {
    expect(listApiParams(state()).get('view')).toBe('upcoming')
    expect(listApiParams(state({ tab: 'all' })).has('view')).toBe(false)
    const attendance = listApiParams(state({ tab: 'past', attendanceOnly: true, campus: 'yihua', due: true }))
    expect(attendance.toString()).toBe('campus_key=yihua&view=past&status=confirmed&follow_up_due=true')
    expect(listApiParams(state({ tab: 'past', attendanceOnly: true }), { counts: true }).toString()).toBe('')
  })

  it('排序：接下來由近到遠、其他頁籤往回；選了送出時間就照送出時間', () => {
    expect(listApiOrder(state())).toBe('visit_asc')
    expect(listApiOrder(state({ tab: 'past' }))).toBe('visit_desc')
    expect(listApiOrder(state({ tab: 'all' }))).toBe('visit_desc')
    expect(listApiOrder(state({ order: 'oldest' }))).toBe('oldest')
  })

  it('搜尋字像電話就去掉符號與國碼（規則同改版前）', () => {
    expect(searchTerm('0912-345-678')).toBe('0912345678')
    expect(searchTerm('+886 912 345 678')).toBe('0912345678')
    expect(searchTerm('09')).toBe('09')
    expect(searchTerm('陳媽媽')).toBe('陳媽媽')
  })
})
