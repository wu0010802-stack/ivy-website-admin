// 近幾年的出生數（2026-10-14 出生走勢規格 §4.3）：期間標籤、缺月、增減、CSV 列。
import { describe, expect, it } from 'vitest'
import type { AreaTrendsBirthPeriod } from '../api/types'
import {
  birthChangeText, birthMissingText, birthPeriodLabel, birthSeriesCsv, birthSeriesRows,
} from '../components/admissions/area/birthSeriesFormat'

const period = (changes: Partial<AreaTrendsBirthPeriod> = {}): AreaTrendsBirthPeriod => ({
  starts: '114-10', ends: '115-09', months: 12, missing: [], births: 10929, change_pct: -19, ...changes,
})

describe('birthSeriesFormat', () => {
  it('期間標籤：跨年也寫完整年月', () => {
    expect(birthPeriodLabel(period())).toBe('114 年 10 月～115 年 9 月')
    expect(birthPeriodLabel(period({ starts: '109-10', ends: '110-09' }))).toBe('109 年 10 月～110 年 9 月')
  })

  it('缺月：寫出缺的月份；沒有缺月是空字串', () => {
    expect(birthMissingText(period())).toBe('')
    expect(birthMissingText(period({ missing: ['111-03'] }))).toBe('缺 111 年 3 月')
    expect(birthMissingText(period({ missing: ['113-10', '113-11'] }))).toBe('缺 113 年 10 月、113 年 11 月')
  })

  it('增減：有正負號、小數一位；算不出來寫「—」', () => {
    expect(birthChangeText(-19)).toBe('−19.0%')
    expect(birthChangeText(12.34)).toBe('+12.3%')
    expect(birthChangeText(0)).toBe('0.0%')
    expect(birthChangeText(null)).toBe('—')
  })

  it('列：最新在前（照後端順序），出生數加千分位', () => {
    const rows = birthSeriesRows([period(), period({ starts: '113-10', ends: '114-09', births: 13497, change_pct: null, missing: ['113-11'], months: 11 })])
    expect(rows).toEqual([
      {
        key: '115-09', label: '114 年 10 月～115 年 9 月', label_from: '114 年 10 月', label_to: '115 年 9 月',
        missing_text: '', births: 10929, births_text: '10,929', change_text: '−19.0%',
      },
      {
        key: '114-09', label: '113 年 10 月～114 年 9 月', label_from: '113 年 10 月', label_to: '114 年 9 月',
        missing_text: '缺 113 年 11 月', births: 13497, births_text: '13,497', change_text: '—',
      },
    ])
  })

  it('CSV：期間起訖用文字（不會被試算表當日期）、缺月用頓號、增減寫數字沒有值寫空白', () => {
    const { header, rows } = birthSeriesCsv([period({ missing: ['111-03', '111-04'], months: 10 }), period({ change_pct: null })])
    expect(header).toEqual(['期間起', '期間迄', '有資料月數', '缺的月份', '出生數', '和前一期增減（%）'])
    expect(rows).toEqual([
      ['114 年 10 月', '115 年 9 月', 10, '111 年 3 月、111 年 4 月', 10929, -19],
      ['114 年 10 月', '115 年 9 月', 12, '', 10929, ''],
    ])
  })
})
