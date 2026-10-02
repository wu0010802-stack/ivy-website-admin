import { describe, expect, it } from 'vitest'
import { monthCells, monthOf, monthTitle, shiftMonth, shortDateLabel, slotCountsByDate } from '../app/utils/visit-month'

describe('預約日期月曆', () => {
  it('月份前後移動會跨年', () => {
    expect(monthOf('2026-10-05')).toBe('2026-10')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(monthTitle('2026-10')).toBe('2026 年 10 月')
    expect(shortDateLabel('2026-10-07')).toBe('10 月 7 日（週三）')
    expect(shortDateLabel('2027-01-03')).toBe('1 月 3 日（週日）')
  })

  it('1 號對齊星期（週日起算），之後是當月每一天', () => {
    // 2026-10-01 是週四：前面補四格。
    const october = monthCells('2026-10')
    expect(october.slice(0, 5)).toEqual([null, null, null, null, '2026-10-01'])
    expect(october.filter(Boolean)).toHaveLength(31)
    expect(october.at(-1)).toBe('2026-10-31')
    // 2026-02 從週日開始、只有 28 天。
    const february = monthCells('2026-02')
    expect(february[0]).toBe('2026-02-01')
    expect(february).toHaveLength(28)
  })

  it('依日期數出可選的場次數', () => {
    expect(slotCountsByDate([{ slot_date: '2026-10-05' }, { slot_date: '2026-10-05' }, { slot_date: '2026-10-06' }]))
      .toEqual({ '2026-10-05': 2, '2026-10-06': 1 })
  })
})
