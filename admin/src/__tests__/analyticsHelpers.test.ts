import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import {
  PENDING_KINDS, SMALL_SAMPLE, getBookingOutcomes, getClassDistribution, getEventTrend, isSmallSample, pendingLink, rangeKey, rateText,
} from '../api/analytics'

afterEach(() => vi.restoreAllMocks())

describe('成效統計的比率、樣本與連結', () => {
  it('比率附分子分母；分母 0 寫「—」不寫 0%', () => {
    expect(rateText({ value: 66.7, numerator: 2, denominator: 3 })).toBe('66.7%（2/3）')
    expect(rateText({ value: 25, numerator: 2, denominator: 8 })).toBe('25.0%（2/8）')
    expect(rateText({ value: null, numerator: 0, denominator: 0 })).toBe('—')
  })

  it('分母 1–19 提示樣本較少；0 與 20 以上不提示', () => {
    expect(isSmallSample({ value: 50, numerator: 1, denominator: 2 })).toBe(true)
    expect(isSmallSample({ value: 50, numerator: 9, denominator: SMALL_SAMPLE - 1 })).toBe(true)
    expect(isSmallSample({ value: 50, numerator: 10, denominator: SMALL_SAMPLE })).toBe(false)
    expect(isSmallSample({ value: null, numerator: 0, denominator: 0 })).toBe(false)
  })

  it('待處理三種連到案件列表，參數和總覽一樣；順序是待標記到場、到期追蹤、舊資料', () => {
    expect(PENDING_KINDS).toEqual(['awaiting_attendance', 'follow_up_due', 'legacy_pending'])
    expect(pendingLink('awaiting_attendance', 'yihua')).toBe('/visit-requests?campus=yihua&group=past&status=confirmed')
    expect(pendingLink('follow_up_due', 'yihua')).toBe('/visit-requests?campus=yihua&due=1')
    expect(pendingLink('legacy_pending', 'minghua')).toBe('/visit-requests?campus=minghua&group=pending')
  })

  it('rangeKey 把同一段期間算成同一個鍵，開站至今是 all', () => {
    expect(rangeKey(null)).toBe('all')
    expect(rangeKey({ from: '2026-09-01', to: '2026-09-30' })).toBe('2026-09-01~2026-09-30')
  })

  it('API 路徑帶校區、學年與期間；開站至今不帶期間', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({} as never)
    const range = { from: '2026-09-01', to: '2026-09-30' }
    await getBookingOutcomes(null)
    await getBookingOutcomes(range)
    await getEventTrend('yihua', range)
    await getClassDistribution('yihua', 115, null)
    expect(get.mock.calls.map((call) => call[0])).toEqual([
      '/admin/analytics/booking-outcomes',
      '/admin/analytics/booking-outcomes?from=2026-09-01&to=2026-09-30',
      '/admin/analytics/event-trend?campus_key=yihua&from=2026-09-01&to=2026-09-30',
      '/admin/analytics/class-distribution?campus_key=yihua&school_year=115',
    ])
  })
})
