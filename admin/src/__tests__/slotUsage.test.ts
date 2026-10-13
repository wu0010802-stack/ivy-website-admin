import { describe, expect, it } from 'vitest'
import {
  BUCKET_LABELS, lookupEmptyText, lookupSummaryText, signalText, slotLabel, slotsEmptyText, usageCsvFilename,
} from '../utils/slotUsage'
import type { SlotUsage } from '../utils/slotUsage'

const usage = (changes: Partial<SlotUsage> = {}, lookups: Partial<SlotUsage['lookups']> = {}, slots: Partial<SlotUsage['slots']> = {}): SlotUsage => ({
  campus_key: 'yihua', booking_mode: 'slots', today: '2026-10-13',
  lookups: {
    date_from: '2026-09-16', date_to: '2026-10-13', first_recorded_day: '2026-10-01', total: 10,
    buckets: [
      { key: 'within_1', count: 1 }, { key: 'days_2_3', count: 2 }, { key: 'days_4_7', count: 3 },
      { key: 'over_7', count: 3 }, { key: 'none', count: 1 },
    ],
    ...lookups,
  },
  slots: {
    weeks: 12, date_from: '2026-07-21', date_to: '2026-10-12',
    thresholds: { min_slots: 4, often_full_share: 0.5, rarely_booked_rate: 0.2 },
    rows: [{ weekday: 5, start_time: '10:00:00', end_time: '11:00:00', slot_count: 12, capacity_total: 36, booked: 33, fill_rate: 0.917, full_count: 9, signal: 'often_full' }],
    ...slots,
  },
  ...changes,
})

describe('場次使用情況：文字', () => {
  it('區間標籤五個，順序固定', () => {
    expect(Object.values(BUCKET_LABELS)).toEqual(['明天以前', '2–3 天', '4–7 天', '超過 7 天', '沒有場次'])
  })

  it('時段標籤：星期＋去掉秒的起訖', () => {
    expect(slotLabel(usage().slots.rows[0]!)).toBe('週六 10:00–11:00')
  })

  it('判讀文字', () => {
    expect(signalText('often_full', 4)).toBe('常額滿，可以考慮加開')
    expect(signalText('rarely_booked', 4)).toBe('很少人約，可以考慮收掉或縮短')
    expect(signalText('too_few', 4)).toBe('還不到 4 場，還不判斷')
    expect(signalText('normal', 4)).toBe('—')
  })

  it('總結句：7 天內約不到＝超過 7 天＋沒有場次，整段沒有場次單獨列', () => {
    expect(lookupSummaryText('義華校', usage().lookups)).toBe(
      '近 4 週家長打開義華校預約頁 10 次，其中 4 次 7 天內已經約不到，1 次整段沒有場次可選。',
    )
  })

  it('檔名', () => {
    expect(usageCsvFilename('義華校', 12, '2026-10-13')).toBe('場次使用情況-義華校-近12週-20261013.csv')
  })
})

describe('場次使用情況：空狀態（規格 §5.3）', () => {
  it('還沒有任何紀錄', () => {
    const empty = usage({}, { first_recorded_day: null, total: 0, buckets: usage().lookups.buckets.map(b => ({ ...b, count: 0 })) })
    expect(lookupEmptyText(empty)).toBe('還沒有家長打開預約頁的紀錄。')
  })

  it('以前記過、近 4 週沒有人打開', () => {
    const quiet = usage({}, { total: 0, buckets: usage().lookups.buckets.map(b => ({ ...b, count: 0 })) })
    expect(lookupEmptyText(quiet)).toBe('近 4 週沒有家長打開預約頁。')
  })

  it('不是自選場次、近 4 週也沒有紀錄', () => {
    const phone = usage({ booking_mode: 'phone' }, { first_recorded_day: null, total: 0 })
    expect(lookupEmptyText(phone)).toBe('目前的預約方式不是自選場次，家長看不到場次。')
  })

  it('以前是自選場次、後來改成電話：近 4 週沒有紀錄時也說明預約方式', () => {
    const switched = usage({ booking_mode: 'phone' }, { total: 0, buckets: usage().lookups.buckets.map(b => ({ ...b, count: 0 })) })
    expect(lookupEmptyText(switched)).toBe('目前的預約方式不是自選場次，家長看不到場次。')
  })

  it('有資料就沒有空狀態', () => {
    expect(lookupEmptyText(usage())).toBeNull()
  })

  it('範圍內沒有過去的場次', () => {
    expect(slotsEmptyText(usage({}, {}, { rows: [] }))).toBe('近 12 週沒有開放的場次。')
    expect(slotsEmptyText(usage())).toBeNull()
  })
})
