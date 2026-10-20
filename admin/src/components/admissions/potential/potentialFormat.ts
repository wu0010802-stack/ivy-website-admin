import type {
  PotentialCapacity, PotentialElementaryCheck, PotentialEvent, PotentialShareYear, PotentialSource, PotentialSourceKey, PotentialTotal,
} from '../../../api/types'
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

// 每年還能多招（2026-10-20 第二、三波）：三個來源各估一個低／中／高，加起來是卡片上的數字。
// 卡片與來源表的數字一律取整（API 是一位小數）；「怎麼算」裡逐年、逐案的小數另用 detailSeats，不然一案 0.4 位會寫成 0。

export const ESTIMATE_TITLE = '每年還能多招'
export const NO_ESTIMATE_TEXT = '三個來源都沒有資料，算不出每年還能多招幾位。'

export const SOURCE_NAMES: Record<PotentialSourceKey, string> = {
  closures: '附近園所停辦釋出',
  villages: '現有的里還沒招到',
  presale: '新建案搬進來',
}
export const sourceName = (key: PotentialSourceKey): string => SOURCE_NAMES[key]

/** 來源表的整數：四捨五入加千分位；沒有值寫「—」。 */
export const seats = (value: number | null): string => (value === null ? NO_VALUE : formatCount(Math.round(value)))

/** 「怎麼算」裡逐年、逐案的數字：一位小數；有值卻不到 0.05 寫「不到 0.1」；0 寫 0；沒有值寫「—」。 */
export function detailSeats(value: number | null): string {
  if (value === null) return NO_VALUE
  if (value === 0) return '0'
  const text = value.toFixed(1)
  return text === '0.0' ? '不到 0.1' : text
}

/** 大字：「約 13 位」。 */
export const estimateHeadline = (total: Pick<PotentialTotal, 'mid'>): string => `約 ${formatCount(Math.round(total.mid))} 位`

/** 區間：低取下限、高取上限，區間不會比實際窄：「5～24 位」。 */
export const estimateRange = (total: Pick<PotentialTotal, 'low' | 'high'>): string =>
  `${formatCount(Math.floor(total.low))}～${formatCount(Math.ceil(total.high))} 位`

export const openSeatsText = (capacity: Pick<PotentialCapacity, 'open'>): string => `目前空位 ${formatCount(capacity.open)} 位`

/** 有來源沒算進去（沒有資料）時，說明這個數字只含哪幾個；三個都算了回空字串。 */
export const includedNote = (total: Pick<PotentialTotal, 'included'>): string =>
  total.included.length >= 3 ? '' : `只含：${total.included.map(sourceName).join('、')}`

/** 沒有資料的列：直接帶 API 給的原因。 */
export const noDataText = (reason: string | null): string => (reason ? `沒有資料（${reason}）` : '沒有資料')

/** 區間條的刻度上限：有數字的來源裡最大的 high；沒有任何數字是 0。 */
export const rangeScale = (sources: readonly Pick<PotentialSource, 'status' | 'high'>[]): number =>
  Math.max(0, ...sources.map((source) => (source.status === 'ok' && source.high !== null ? source.high : 0)))

const percent = (value: number, scale: number): number => (scale <= 0 ? 0 : Math.min(100, Math.max(0, (value / scale) * 100)))

/** 區間條：low–high 的起點與寬度、mid 的位置，都是占刻度的百分比（0–100）。 */
export function rangeBar(source: Pick<PotentialSource, 'low' | 'mid' | 'high'>, scale: number): { left: number; width: number; mid: number } {
  const low = percent(source.low ?? 0, scale)
  const high = percent(source.high ?? 0, scale)
  return { left: low, width: high - low, mid: percent(source.mid ?? 0, scale) }
}

/** 里程：「0.9 km」。先以 100 m 為單位進位再除（850 m 直接 toFixed 會因二進位誤差變 0.8）。 */
export const distanceKm = (meters: number): string => `${(Math.round(meters / 100) / 10).toFixed(1)} km`

/** 距離帶 "0-1" → 「0–1 km」。 */
export const bandLabel = (band: string): string => `${band.replace('-', '–')} km`

/** 停辦的統計窗口（學年口徑，10 月到隔年 9 月）：111 → 「2022 年 10 月～2023 年 9 月」。 */
export const periodText = (schoolYear: number): string => `${schoolYear + 1911} 年 10 月～${schoolYear + 1912} 年 9 月`

/** 預計交屋：「約 2027 下半年」；已過預計時間、還沒登記的另寫。 */
export function deliveryText(delivery: { expected_year: number; expected_half: number; overdue: boolean }): string {
  return delivery.overdue ? '已過預計時間（尚未登記）' : `約 ${delivery.expected_year} ${delivery.expected_half === 1 ? '上' : '下'}半年`
}

/** 走勢圖停辦標記的提示：「2026-09-15 某某幼兒園停辦（核定 30）」。 */
export const closureEventTitle = (event: Pick<PotentialEvent, 'occurred_on' | 'name' | 'approved_capacity'>): string =>
  `${event.occurred_on} ${event.name}停辦（${event.approved_capacity === null ? '核定名額未填' : `核定 ${event.approved_capacity}`}）`

export interface ClosureMarker {
  year: number
  title: string
}

/**
 * 走勢圖的停辦標記。event.school_year 是來源一的統計窗口（10 月到隔年 9 月），停辦影響的是下一個秋季註冊，
 * 所以標在 school_year + 1（2026-09-15 停辦 → 窗口 114 → 標在 115）。同一學年多所合併成一個標記，提示每所一行（依日期）；
 * 落在圖上學年範圍（first–last）以外的不畫；結果依學年排序。
 */
export function closureMarkers(events: readonly PotentialEvent[], firstYear: number, lastYear: number): ClosureMarker[] {
  const byYear = new Map<number, PotentialEvent[]>()
  for (const event of events) {
    const year = event.school_year + 1
    if (year < firstYear || year > lastYear) continue
    byYear.set(year, [...(byYear.get(year) ?? []), event])
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, list]) => ({
      year,
      title: list
        .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on))
        .map(closureEventTitle)
        .join('\n'),
    }))
}
