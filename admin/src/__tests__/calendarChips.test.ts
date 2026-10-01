import { describe, expect, it } from 'vitest'
import { dayAriaLabel, dayChips, type CalendarSlot } from '../utils/calendarChips'

const NOW = new Date('2026-10-05T09:00:00+08:00').getTime()
const slot = (changes: Partial<CalendarSlot> = {}): CalendarSlot => ({
  id: 's1', campus_key: 'yihua', slot_date: '2026-10-06', start_time: '10:00:00', end_time: '11:00:00',
  capacity: 2, closed: false, closed_source: null, version: 1, booked_count: 0, visits: [], ...changes,
})
const visit = (id: string, parent_name: string, status = 'confirmed') =>
  ({ id, status, parent_name, child_name: null, phone: '0911222333', source: 'web', assigned_staff_id: null })

describe('月曆格子的色塊（參考義華行事曆）', () => {
  it('有預約：每位一塊，寫場次名稱與家長', () => {
    const chips = dayChips([slot({ booked_count: 1, visits: [visit('v1', '王小明')] })], NOW)
    expect(chips).toEqual([{ key: 'v1', kind: 'visit', text: '上午場 王小明', ended: false, status: 'confirmed' }])
  })

  it('停止申請：紅色；已約的家長仍列出', () => {
    const chips = dayChips([slot({ closed: true, closed_source: 'manual', booked_count: 1, visits: [visit('v1', '王小明')] })], NOW)
    expect(chips.map(c => [c.kind, c.text])).toEqual([['visit', '上午場 王小明'], ['stopped', '上午場停止申請']])
  })

  it('開放中沒人約：寫可約幾組；休假日關閉的場次不另外畫', () => {
    expect(dayChips([slot({ start_time: '14:30:00', end_time: '15:30:00' })], NOW)).toEqual([{ key: 's1-open', kind: 'open', text: '下午場 可約 2', ended: false }])
    expect(dayChips([slot({ closed: true, closed_source: 'exception' })], NOW)).toEqual([])
  })

  it('已結束的場次標 ended，不再寫可約', () => {
    const chips = dayChips([slot({ slot_date: '2026-10-04' })], NOW)
    expect(chips).toEqual([])
    expect(dayChips([slot({ slot_date: '2026-10-04', booked_count: 1, visits: [visit('v1', '王小明', 'completed')] })], NOW)[0]!.ended).toBe(true)
  })

  it('朗讀文字說出預約、停止申請與休假', () => {
    expect(dayAriaLabel('2026-10-06', [slot({ booked_count: 1, visits: [visit('v1', '王小明')] })], null, NOW)).toContain('排入 1 組，可約 1 組')
    expect(dayAriaLabel('2026-10-06', [slot({ closed: true, closed_source: 'manual' })], null, NOW)).toContain('1 場停止申請')
    expect(dayAriaLabel('2026-10-06', [], '教師研習', NOW)).toContain('休假：教師研習')
  })

  it('休假日關閉的場次仍有家長預約時，預約色塊照畫（待人工處理）', () => {
    const chips = dayChips([slot({ closed: true, closed_source: 'exception', booked_count: 1, visits: [visit('v1', '王小明')] })], NOW)
    expect(chips.map(c => [c.kind, c.text])).toEqual([['visit', '上午場 王小明']])
  })
})
