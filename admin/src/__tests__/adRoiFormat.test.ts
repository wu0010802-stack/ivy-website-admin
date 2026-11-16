import { describe, expect, it } from 'vitest'
import { AD_ROW_LABELS, costText, defaultMonthRange, pendingText, spendText } from '../admissions/adRoiFormat'
import type { AdRoiRow } from '../api/types'

const row = (changes: Partial<AdRoiRow> = {}): AdRoiRow => ({
  key: 'google', spend: 9000, spend_state: 'ok', missing_months: 0, clicks: 310, cases: 6, completed: 4, no_show: 0, deposited: 1,
  cost_per_case: 1500, cost_per_completed: 2250, cost_per_deposit: 9000, ...changes,
})

describe('AD_ROW_LABELS', () => {
  it('每一列的標籤', () => {
    expect(AD_ROW_LABELS).toEqual({
      google: 'Google', openai: 'ChatGPT', meta: 'Meta', line: 'LINE', other: '其他網路廣告',
      unknown: '廣告（平台不明）', offline: '離線花費', organic: '非廣告來源', unrecorded: '沒有來源紀錄',
    })
  })
})

describe('spendText', () => {
  it('未設定、讀取失敗、未填、沒有', () => {
    expect(spendText(row({ spend: null, spend_state: 'not_configured' }), null)).toBe('未設定')
    expect(spendText(row({ spend: null, spend_state: 'error' }), 'TWD')).toBe('讀取失敗')
    expect(spendText(row({ key: 'openai', spend: null, spend_state: 'unset' }), null)).toBe('未填')
    expect(spendText(row({ key: 'organic', spend: null, spend_state: 'none' }), null)).toBe('—')
  })
  it('千分位；缺月與非台幣幣別加註', () => {
    expect(spendText(row({ spend: 12345 }), 'TWD')).toBe('12,345')
    expect(spendText(row({ spend: 3000, missing_months: 2 }), 'TWD')).toBe('3,000（缺 2 個月）')
    expect(spendText(row({ spend: 300 }), 'USD')).toBe('300（USD）')
    expect(spendText(row({ spend: 300, missing_months: 1 }), 'USD')).toBe('300（缺 1 個月）（USD）')
  })
})

describe('costText', () => {
  it('null 是破折號，其他千分位', () => {
    expect(costText(null)).toBe('—')
    expect(costText(1500)).toBe('1,500')
    expect(costText(2249.6)).toBe('2,250')
  })
})

describe('pendingText', () => {
  it('0 的項目省略', () => {
    expect(pendingText({ upcoming: 3, awaiting_attendance: 0, considering: 2 })).toBe('另有 3 筆還沒到參觀日、2 筆到場後還在考慮。')
    expect(pendingText({ upcoming: 1, awaiting_attendance: 2, considering: 3 })).toBe('另有 1 筆還沒到參觀日、2 筆還沒標記到場、3 筆到場後還在考慮。')
  })
  it('全 0 回空字串', () => {
    expect(pendingText({ upcoming: 0, awaiting_attendance: 0, considering: 0 })).toBe('')
  })
})

describe('defaultMonthRange', () => {
  it('往前 11 個月，但不早於 2026-11', () => {
    expect(defaultMonthRange('2026-11-16')).toEqual({ from: '2026-11', to: '2026-11' })
    expect(defaultMonthRange('2027-03-01')).toEqual({ from: '2026-11', to: '2027-03' })
    expect(defaultMonthRange('2028-01-31')).toEqual({ from: '2027-02', to: '2028-01' })
  })
})
