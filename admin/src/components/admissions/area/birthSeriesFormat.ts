import type { AreaTrendsBirthPeriod } from '../../../api/types'
import { NO_VALUE } from '../../../admissions/statsFormat'
import type { CsvCell } from '../../../utils/csv'
import { formatCount, populationVersionLabel, signedPercent } from './areaFormat'

// 近幾年的出生數（2026-10-14 出生走勢規格 §4.3）：本校半徑每 12 個月一期的出生數。只呈現後端算好的數字，
// 不另外推估；缺月寫出來，不補值。

export const BIRTH_SERIES_NOTE = '每 12 個月一期，加總本校半徑內各里的出生數；和前一期只比兩期都有資料的月份；出生依出生登記的戶籍里。資料來源：內政部戶政司。'

export interface BirthSeriesRow {
  key: string
  label: string
  missing_text: string
  births: number
  births_text: string
  change_text: string
}

/** 「114 年 10 月～115 年 9 月」。 */
export function birthPeriodLabel(period: Pick<AreaTrendsBirthPeriod, 'starts' | 'ends'>): string {
  return `${populationVersionLabel(period.starts)}～${populationVersionLabel(period.ends)}`
}

/** 「缺 111 年 3 月」；沒有缺月是空字串。 */
export function birthMissingText(period: Pick<AreaTrendsBirthPeriod, 'missing'>): string {
  return period.missing.length ? `缺 ${period.missing.map(populationVersionLabel).join('、')}` : ''
}

/** 和前一期的增減：「−19.0%」「+12.3%」；算不出來寫「—」。 */
export function birthChangeText(pct: number | null): string {
  return pct === null ? NO_VALUE : signedPercent(pct)
}

export function birthSeriesRows(periods: readonly AreaTrendsBirthPeriod[]): BirthSeriesRow[] {
  return periods.map((period) => ({
    key: period.ends,
    label: birthPeriodLabel(period),
    missing_text: birthMissingText(period),
    births: period.births,
    births_text: formatCount(period.births),
    change_text: birthChangeText(period.change_pct),
  }))
}

/** CSV：期間起訖寫文字（「114 年 10 月」，試算表不會當日期轉）、缺的月份用頓號、增減寫數字（沒有值寫空白）。 */
export function birthSeriesCsv(periods: readonly AreaTrendsBirthPeriod[]): { header: string[]; rows: CsvCell[][] } {
  return {
    header: ['期間起', '期間迄', '有資料月數', '缺的月份', '出生數', '和前一期增減（%）'],
    rows: periods.map((period) => [
      populationVersionLabel(period.starts),
      populationVersionLabel(period.ends),
      period.months,
      period.missing.map(populationVersionLabel).join('、'),
      period.births,
      period.change_pct ?? '',
    ]),
  }
}
