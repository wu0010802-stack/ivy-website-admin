import { describe, expect, it } from 'vitest'
import { formatWeekday, slotStarted } from '../api/labels'
import { addDays, dayBucket, daysBetween, followUpDue, followUpTracked, groupVisitsByDay, nextInList, relativeVisitTime, shortDay, taipeiDay, visitPhase, weekStart } from '../utils/visitSchedule'

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
  // 午夜前後與滿一天的邊界（第二輪審查）：台北日期差決定「明天」，不是離開始還差幾小時。
  it('台北 10/05 23:50、場次 10/06 00:10：只差 20 分鐘，仍是「明天」', () => {
    const early = { slot_date: '2026-10-06', start_time: '00:10:00', end_time: '01:10:00' }
    expect(relativeVisitTime(early, taipei('2026-10-05T23:50:00'))).toEqual({ text: '明天', tone: '' })
  })
  it('場次 23:30 結束、台北已過午夜 00:10：結束了 40 分鐘，不是「1 天」', () => {
    const late = { slot_date: '2026-10-06', start_time: '22:30:00', end_time: '23:30:00' }
    expect(relativeVisitTime(late, taipei('2026-10-07T00:10:00'))).toEqual({ text: '結束了 40 分鐘', tone: 'ended' })
  })
  it('結束後剛好 24 小時：換成「結束了 1 天」（差一分鐘還是 23 小時）', () => {
    expect(relativeVisitTime(slot, taipei('2026-10-07T10:59:00'))).toEqual({ text: '結束了 23 小時', tone: 'ended' })
    expect(relativeVisitTime(slot, taipei('2026-10-07T11:00:00'))).toEqual({ text: '結束了 1 天', tone: 'ended' })
  })
  it('沒有結束時間的舊資料當一小時', () => {
    expect(relativeVisitTime({ slot_date: '2026-10-06', start_time: '10:00:00' }, taipei('2026-10-06T10:59:00')).text).toBe('進行中')
  })
})

describe('日期分組（台北、週一開始）', () => {
  const tue = '2026-10-06'
  it.each([
    ['2026-10-06', 'today'], ['2026-10-07', 'tomorrow'], ['2026-10-05', 'yesterday'],
    ['2026-10-08', 'this_week'], ['2026-10-11', 'this_week'], ['2026-10-12', 'later'],
    ['2026-10-04', 'earlier'], [null, 'none'],
  ])('今天週二，%s → %s', (day, bucket) => {
    expect(dayBucket(day, tue)).toBe(bucket)
  })
  it('今天週日：明天週一是下週，但仍叫「明天」；週二是之後；週二到週五是本週稍早', () => {
    expect(weekStart('2026-10-11')).toBe('2026-10-05')
    expect(dayBucket('2026-10-12', '2026-10-11')).toBe('tomorrow')
    expect(dayBucket('2026-10-13', '2026-10-11')).toBe('later')
    expect(dayBucket('2026-10-07', '2026-10-11')).toBe('earlier_this_week')
  })
  it('addDays 跨月、跨年都對', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })
  it('照清單順序切連續的組，今天／明天／昨天帶日期', () => {
    const row = (slot_date: string | null) => ({ id: String(slot_date), slot: slot_date ? { slot_date } : null })
    const groups = groupVisitsByDay([row('2026-10-06'), row('2026-10-06'), row('2026-10-07'), row('2026-10-09'), row('2026-10-13'), row(null)], tue)
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([
      ['今天 10/06（週二）', 2], ['明天 10/07（週三）', 1], ['本週', 1], ['之後', 1], ['沒有場次', 1],
    ])
    expect(groupVisitsByDay([row('2026-10-05'), row('2026-10-01')], tue).map((g) => g.label)).toEqual(['昨天 10/05（週一）', '更早'])
  })
  it('週名與 labels.formatWeekday 一致（visitSchedule 不能 import labels，會繞成圈）', () => {
    for (let i = 0; i < 7; i += 1) {
      const day = addDays('2026-10-05', i)
      expect(shortDay(day)).toBe(`${day.slice(5).replace('-', '/')}（${formatWeekday(day)}）`)
    }
  })
})

describe('列的接待狀態', () => {
  const slot = { slot_date: '2026-10-06', start_time: '10:00:00', end_time: '11:00:00' }
  const at = (local: string) => Date.parse(`${local}+08:00`)
  it.each([
    ['confirmed', '2026-10-06T09:00:00', 'upcoming'],
    ['confirmed', '2026-10-06T10:30:00', 'ongoing'],
    ['confirmed', '2026-10-06T11:30:00', 'ended'],
    ['completed', '2026-10-06T10:30:00', 'done'],
    ['no_show', '2026-10-06T12:00:00', 'no_show'],
    ['cancelled', '2026-10-06T09:00:00', 'cancelled'],
  ])('%s @ %s → %s', (status, local, phase) => {
    expect(visitPhase({ status, slot }, at(local))).toBe(phase)
  })
})

describe('預覽面板的下一筆', () => {
  it('清單裡的下一筆；最後一筆沒有下一筆', () => {
    expect(nextInList(['a', 'b', 'c'], 'a', 0)).toBe('b')
    expect(nextInList(['a', 'b', 'c'], 'c', 2)).toBeNull()
  })
  it('目前這筆離開清單（例如剛取消）：接手它位置的那筆就是下一筆', () => {
    expect(nextInList(['a', 'c'], 'b', 1)).toBe('c')
    expect(nextInList(['a'], 'b', 1)).toBe('a')
    expect(nextInList([], 'b', 0)).toBeNull()
  })
})

// 列與明細頁首共用同一條規則（預檢 D5），只留一份。
describe('到期待追蹤', () => {
  const now = Date.parse('2026-10-06T10:00:00+08:00')
  it('預定聯絡時間到了、案件還沒結案才算到期', () => {
    expect(followUpDue({ status: 'confirmed', follow_up_at: '2026-10-06T10:00:00+08:00' }, now)).toBe(true)
    expect(followUpDue({ status: 'no_show', follow_up_at: '2026-10-05T10:00:00+08:00' }, now)).toBe(true)
    expect(followUpDue({ status: 'confirmed', follow_up_at: '2026-10-06T10:00:01+08:00' }, now)).toBe(false)
    expect(followUpDue({ status: 'confirmed', follow_up_at: null }, now)).toBe(false)
  })
  it('已取消、已完成的不追蹤（結案不會清掉預定聯絡時間，所以不能只看時間）', () => {
    for (const status of ['cancelled', 'completed']) {
      expect(followUpTracked(status)).toBe(false)
      expect(followUpDue({ status, follow_up_at: '2026-10-01T00:00:00+08:00' }, now)).toBe(false)
    }
    expect(followUpTracked('confirmed')).toBe(true)
  })
})

describe('labels.slotStarted 與 visitSchedule 同一個開始時間', () => {
  it('場次開始那一刻起算已開始（+08:00 只在 visitSchedule 解析）', () => {
    const slot = { slot_date: '2026-09-26', start_time: '10:00:00' }
    expect(slotStarted(slot, Date.parse('2026-09-26T09:59:59+08:00'))).toBe(false)
    expect(slotStarted(slot, Date.parse('2026-09-26T10:00:00+08:00'))).toBe(true)
    expect(slotStarted({ slot_date: 'x', start_time: 'y' }, Date.now())).toBe(false)
  })
})
