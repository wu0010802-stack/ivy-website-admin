import type { AreaChildrenHistory, AreaChildrenHistoryVillage } from '../../../api/types'
import { signedCount } from './areaFormat'

// 區域分析「2–5 歲孩子」模式的年份滑桿（2026-11-16 規格 §5.3）：格子、標籤、著色、比前一年。純函式，不碰 Vue／API。

/** 滑桿的一格：九月年份（民國年）或最新月份。 */
export type YearStop = number | 'latest'

/** 九月年份舊到新，最後一格是最新月份（沒有人口資料時沒有這一格）。 */
export function childrenStops(data: AreaChildrenHistory): YearStop[] {
  return data.latest ? [...data.years, 'latest'] : [...data.years]
}

/** counts 與標籤表的鍵。 */
export function stopKey(stop: YearStop): string {
  return String(stop)
}

/** 年份寫「107」，最新寫「最新 115.10」。 */
export function stopLabel(stop: YearStop, data: AreaChildrenHistory): string {
  if (stop !== 'latest') return String(stop)
  return `最新 ${(data.latest?.label ?? '').replace('-', '.')}`.trimEnd()
}

export interface ChildrenShade {
  /** 里代碼 → 這一格的 2–5 歲人數；這個里那一年沒有資料（例如新設）是 null。 */
  byCode: ReadonlyMap<string, number | null>
  /** 所有年份共用的最大值：換年份色階不重算，才看得出變化。 */
  max: number
}

export function childrenShade(data: AreaChildrenHistory, stop: YearStop): ChildrenShade {
  const key = stopKey(stop)
  return {
    byCode: new Map(data.villages.map((village) => [village.village_code, village.counts[key] ?? null])),
    max: data.max_children,
  }
}

// 一格代表的月份：年份＝該年九月，最新＝人口狀態的月份。
const monthOf = (stop: YearStop, latestLabel: string | null | undefined): string =>
  stop === 'latest' ? (latestLabel ?? '999-99') : `${String(stop).padStart(3, '0')}-09`

/**
 * 右欄排行的細節：和前一格比。兩邊都有數字且兩點之間（前一格月份之後、這一格月份以內）沒有界線調整 → 「比前一年 +3」；
 * 兩邊都有數字但之間有調整 → 「界線 115-07 調整」（前後不可直接比）；第一格或任一邊沒有資料 → 空字串。
 * latestLabel 是最新月份（如 115-10），算「最新」這一格與前一格之間用。
 */
export function yearChangeText(
  village: AreaChildrenHistoryVillage,
  stop: YearStop,
  stops: readonly YearStop[],
  latestLabel?: string | null,
): string {
  const index = stops.indexOf(stop)
  if (index <= 0) return ''
  const previous = stops[index - 1]
  const current = village.counts[stopKey(stop)]
  const before = village.counts[stopKey(previous)]
  if (current === null || current === undefined || before === null || before === undefined) return ''
  const from = monthOf(previous, latestLabel)
  const to = monthOf(stop, latestLabel)
  const crossed = village.adjusted.find((month) => month > from && month <= to)
  if (crossed) return `界線 ${crossed} 調整`
  // 「最新」和前一格（最近一年的九月）只差幾個月，不能寫成「前一年」：寫出是比哪個月。
  const base = stop === 'latest' ? `比 ${String(previous).padStart(3, '0')}.09` : '比前一年'
  return `${base} ${signedCount(current - before)}`
}

const RETIRED_NAMES_SHOWN = 3

/** 地圖下方的一行：這一年有資料、但現行里界畫不出來的已廢止的里。沒有就空字串。 */
export function retiredNote(data: AreaChildrenHistory, stop: YearStop): string {
  if (stop === 'latest') return ''
  const present = data.retired.filter((item) => item.years.includes(stop))
  if (!present.length) return ''
  const names = present.slice(0, RETIRED_NAMES_SHOWN).map((item) => item.village).join('、')
  const more = present.length > RETIRED_NAMES_SHOWN ? '等' : ''
  return `同區另有 ${present.length} 個已廢止的里（${names}${more}）有這年的資料，地圖上畫不出來。`
}

/** 網址的年份：不在格子裡（怪年份、九月表沒有的年份、換校區後新範圍沒有）一律退回最新；沒有最新這一格就取最後一格。 */
export function resolveStop(requested: number | null, stops: readonly YearStop[]): YearStop {
  if (requested !== null && stops.includes(requested)) return requested
  if (stops.includes('latest') || !stops.length) return 'latest'
  return stops[stops.length - 1]
}
