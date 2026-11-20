import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import {
  PENDING_KINDS, SMALL_SAMPLE, getBookingOutcomes, getClassDistribution, getEventTrend, isSmallSample, pendingLink, rangeKey, rateText,
} from '../api/analytics'
import { formatCount, splitLabel, splitPrefix } from '../components/analytics/format'

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

  it('待處理兩種連到案件列表，參數和總覽一樣；順序是待標記到場、到期追蹤，沒有舊資料待處理', () => {
    expect(PENDING_KINDS).toEqual(['awaiting_attendance', 'follow_up_due'])
    expect(pendingLink('awaiting_attendance', 'yihua')).toBe('/visit-requests?campus=yihua&group=past&status=confirmed&excluded=hide')
    expect(pendingLink('follow_up_due', 'yihua')).toBe('/visit-requests?campus=yihua&due=1&excluded=hide')
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

// 2026-11-20 可讀性：畫面上的次數與名稱格式（匯出不經過這兩個函式）。
describe('成效統計畫面上的次數與名稱', () => {
  it('次數加千分位；沒有值寫「—」', () => {
    expect([0, 7, 999, 1000, 1617, 12345, 1234567].map(formatCount)).toEqual(['0', '7', '999', '1,000', '1,617', '12,345', '1,234,567'])
    expect([formatCount(null), formatCount(undefined)]).toEqual(['—', '—'])
  })

  it('名稱最後的括號拆成名稱與補充；沒有括號、括號不在最後的照原樣', () => {
    expect(splitLabel('直接進站（輸入網址、書籤、看不出來源）')).toEqual({ name: '直接進站', note: '輸入網址、書籤、看不出來源' })
    expect(splitLabel('搜尋引擎')).toEqual({ name: '搜尋引擎', note: '' })
    expect(splitLabel('首頁（選校）預約')).toEqual({ name: '首頁（選校）預約', note: '' })
  })

  it('「類別：內容」在第一個冒號拆成兩段；沒有冒號、冒號在頭尾的整串當內容', () => {
    expect(splitPrefix('孩子的一天：翻開「一起用餐」')).toEqual({ prefix: '孩子的一天：', name: '翻開「一起用餐」' })
    expect(splitPrefix('常見問題：補助：怎麼申請？')).toEqual({ prefix: '常見問題：', name: '補助：怎麼申請？' })
    expect(splitPrefix('入學資訊')).toEqual({ prefix: '', name: '入學資訊' })
    expect(splitPrefix('結尾是冒號：')).toEqual({ prefix: '', name: '結尾是冒號：' })
  })
})
