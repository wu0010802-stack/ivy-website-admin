import { describe, expect, it } from 'vitest'
import { sessionLabel, slotRange, slotWhen } from '../app/utils/visit-session'

describe('場次名稱', () => {
  it('12:00 以前是上午場，12:00 起是下午場', () => {
    expect(sessionLabel('09:59:00')).toBe('上午場 09:59')
    expect(sessionLabel('12:00:00')).toBe('下午場 12:00')
    expect(sessionLabel('14:30')).toBe('下午場 14:30')
  })

  it('時段文字帶場次名稱與起訖', () => {
    expect(slotRange({ start_time: '10:00:00', end_time: '11:00:00' })).toBe('上午場 10:00–11:00')
    expect(slotWhen({ slot_date: '2026-10-02', start_time: '14:30:00', end_time: '15:30:00' })).toMatch(/2026\/10\/2.*週五.* 下午場 14:30–15:30$/)
  })
})
