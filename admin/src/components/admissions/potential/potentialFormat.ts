import type { PotentialElementaryCheck, PotentialShareYear } from '../../../api/types'
import { NO_VALUE } from '../../../admissions/statsFormat'
import type { CsvCell } from '../../../utils/csv'
import { formatCount } from '../area/areaFormat'

// 招生潛力與市佔率（2026-10-20 規格 §5）：市佔率＝某學年上學期的註冊人數 ÷ 同學年九月底本校半徑內的 2–5 歲戶籍人數。
// 只呈現後端算好的數字與句子，不另外推估；那一年沒有九月底的孩子數時寫「—」，不寫 0。

export const POTENTIAL_SOURCE_NOTE = (radiusKm: number) =>
  `註冊人數取自園內目標執行統計表（各學期 9/15）；孩子數取自內政部戶政司各里 9 月底人口；國小一年級取自教育部國民小學校別資料。市佔率的分子含住在 ${radiusKm} 公里外的孩子。`
export const NOT_IMPORTED_TEXT = '尚未匯入歷年註冊。'
export const NO_CAMPUS_POINT_TEXT = (radiusKm: number) => `分校地址還沒對到門牌，算不出 ${radiusKm} 公里範圍。`
export const NO_CHILDREN_TEXT = '各學年都還沒有九月底的孩子數，算不出市佔率。'
export const WARN_SENTENCE = '戶籍和實際就學差得比往年多，市佔率的分母可能偏高或偏低。'

/** 0.0193 → 「1.93%」；沒有值寫「—」。 */
export function formatShare(value: number | null): string {
  return value === null ? NO_VALUE : `${(value * 100).toFixed(2)}%`
}

/** 「189 ÷ 9,788 位」：註冊人數 ÷ 半徑內 2–5 歲人數；那一年沒有孩子數，分母寫「—」。 */
export function shareSentence(year: Pick<PotentialShareYear, 'registered' | 'children'>): string {
  const children = year.children === null ? NO_VALUE : formatCount(year.children)
  return `${formatCount(year.registered)} ÷ ${children} 位`
}

/** 「歷年最高 1.94%（108 學年）」；最新一年就是最高寫「是歷年最高」；沒有最高回空字串。 */
export function bestSentence(best: PotentialShareYear | null, latest: PotentialShareYear): string {
  if (!best) return ''
  if (best.school_year === latest.school_year) return '是歷年最高'
  return `歷年最高 ${formatShare(best.share)}（${best.school_year} 學年）`
}

/** 走勢圖每個點的提示：「108 學年：279 ÷ 14,366 位，1.94%」。 */
export function yearTitle(year: PotentialShareYear): string {
  return `${year.school_year} 學年：${shareSentence(year)}，${formatShare(year.share)}`
}

const ratioText = (value: number): string => value.toFixed(2)

/**
 * 國小一年級對帳：半徑內各里所屬國小的一年級人數 ÷ 這些學校學區的 6 歲戶籍人數。歷年範圍不含最新一年；
 * 只有一年資料時不寫範圍。warn（最新一年偏離歷年平均太多）時句尾接上提醒。沒有任何學年回空字串。
 */
export function elementarySentence(check: PotentialElementaryCheck, radiusKm = 3): string {
  const latest = [...check.years].sort((a, b) => b.school_year - a.school_year)[0]
  if (!latest) return ''
  const earlier = check.years.filter((year) => year.school_year !== latest.school_year).map((year) => year.ratio)
  const range = earlier.length ? `（歷年 ${ratioText(Math.min(...earlier))}–${ratioText(Math.max(...earlier))}）` : ''
  const sentence =
    `國小一年級對帳：${latest.school_year} 學年 ${radiusKm} 公里內各里所屬的 ${check.schools} 所國小，` +
    `一年級 ${formatCount(latest.grade1)} 位，是 6 歲戶籍的 ${ratioText(check.latest_ratio)}${range}。`
  return check.warn ? `${sentence}${WARN_SENTENCE}` : sentence
}

/** 各學年數字的 CSV：市佔率寫百分比數字（1.93），沒有值寫空白；里界調整的學年標「是」。 */
export function shareCsv(years: readonly PotentialShareYear[], radiusKm: number): { header: string[]; rows: CsvCell[][] } {
  return {
    header: ['學年', '秋季註冊', `${radiusKm} 公里內 2–5 歲`, '市佔率（%）', '里界調整'],
    rows: years.map((year) => [
      year.school_year,
      year.registered,
      year.children ?? '',
      year.share === null ? '' : Number((year.share * 100).toFixed(2)),
      year.merged ? '是' : '',
    ]),
  }
}
