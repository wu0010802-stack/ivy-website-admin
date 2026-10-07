import { describe, expect, it } from 'vitest'
import { daysBetween, relativeVisitTime, taipeiDay } from '../utils/visitSchedule'

// 台北 = UTC+8；寫成 UTC 的時間點，確認不吃瀏覽器時區。
const taipei = (local: string) => Date.parse(`${local}+08:00`)
const slot = { slot_date: '2026-10-06', start_time: '10:00:00', end_time: '11:00:00' }

describe('台北日期', () => {
  it('UTC 還是前一天、台北已經過午夜：算台北那一天', () => {
    expect(taipeiDay(Date.parse('2026-10-06T16:30:00Z'))).toBe('2026-10-07')
    expect(taipeiDay(Date.parse('2026-10-06T15:59:00Z'))).toBe('2026-10-06')
  })
  it('daysBetween 以日期算，跨月也對', () => {
    expect(daysBetween('2026-09-30', '2026-10-02')).toBe(2)
    expect(daysBetween('2026-10-06', '2026-10-05')).toBe(-1)
  })
})

describe('頁首的相對時間', () => {
  it.each([
    ['2026-10-03T10:00:00', '還有 3 天', ''],
    ['2026-10-05T10:00:00', '明天', ''],
    ['2026-10-06T00:30:00', '還有 9 小時', ''],
    ['2026-10-06T09:20:00', '還有 40 分鐘', ''],
    ['2026-10-06T10:30:00', '進行中', 'live'],
    ['2026-10-06T11:00:30', '剛結束', 'ended'],
    ['2026-10-06T11:40:00', '結束了 40 分鐘', 'ended'],
    ['2026-10-06T13:05:00', '結束了 2 小時', 'ended'],
    ['2026-10-08T09:00:00', '結束了 2 天', 'ended'],
  ])('台北 %s → %s', (local, text, tone) => {
    expect(relativeVisitTime(slot, taipei(local))).toEqual({ text, tone })
  })
  it('沒有結束時間的舊資料當一小時', () => {
    expect(relativeVisitTime({ slot_date: '2026-10-06', start_time: '10:00:00' }, taipei('2026-10-06T10:59:00')).text).toBe('進行中')
  })
})
