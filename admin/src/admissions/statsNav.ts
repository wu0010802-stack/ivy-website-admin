import type { StatsSub } from './useAdmissionsFilters'

// 招生統計的導覽（2026-11-20）：十二個子分頁原本平鋪成一排，1440 寬只看得到十個半、手機只看得到五個，
// 而且頁首的校區與入學學年學期對哪一頁有效看不出來。改成上層四類、下層才是該類的分頁；
// 「資料匯入」是上傳工具、不是統計，移出分頁列。網址的 sub 不變（舊連結、書籤照用）。
export type StatsGroupKey = 'funnel' | 'booking' | 'market' | 'cross'

export interface StatsGroup {
  key: StatsGroupKey
  label: string
  subs: readonly StatsSub[]
}

export const STATS_GROUPS: readonly StatsGroup[] = [
  { key: 'funnel', label: '招生轉換', subs: ['overview', 'class', 'source', 'staff', 'nodeposit'] },
  { key: 'booking', label: '參觀預約', subs: ['booking', 'journey'] },
  { key: 'market', label: '區域與市場', subs: ['area', 'potential'] },
  { key: 'cross', label: '五校與廣告', subs: ['compare', 'ads'] },
]

// 「參觀預約」這一類底下的第一頁原本也叫「參觀預約」，和分類同名，改叫「預約成效」。
export const STATS_SUB_LABELS: Record<StatsSub, string> = {
  overview: '總覽',
  class: '班別分析',
  source: '來源分析',
  staff: '接待分析',
  nodeposit: '未預繳與退出原因',
  booking: '預約成效',
  journey: '預約全程',
  area: '區域分析',
  potential: '招生潛力與市佔率',
  compare: '五校比較',
  ads: '廣告成效',
  imports: '資料匯入',
}

/** 子分頁屬於哪一類；資料匯入不屬於任何一類（回 null）。 */
export function groupOfSub(sub: StatsSub): StatsGroup | null {
  return STATS_GROUPS.find((group) => group.subs.includes(sub)) ?? null
}

export interface StatsConditions {
  /** 看單一校區：頁首的校區有作用。 */
  campus: boolean
  /** 依入學學年學期：頁首的學年、學期有作用。 */
  term: boolean
}

// 頁首條件只出現在用得到的分頁：五校比較與廣告成效是五校一起看（不分校區）；參觀預約、預約全程、
// 招生潛力、資料匯入不分入學學年學期（各自有期間，或看所有學年）；廣告成效依月份，在分頁裡選。
const CONDITIONS: Record<StatsSub, StatsConditions> = {
  overview: { campus: true, term: true },
  class: { campus: true, term: true },
  source: { campus: true, term: true },
  staff: { campus: true, term: true },
  nodeposit: { campus: true, term: true },
  area: { campus: true, term: true },
  compare: { campus: false, term: true },
  booking: { campus: true, term: false },
  journey: { campus: true, term: false },
  potential: { campus: true, term: false },
  imports: { campus: true, term: false },
  ads: { campus: false, term: false },
}

export function conditionsOf(sub: StatsSub): StatsConditions {
  return CONDITIONS[sub]
}
