// 30 週年分頁（/anniversary）的時間軸：只放真實年份與 /about 已上線的沿革文字，不另寫故事。
// 1997 義華為業主 2026-10-03 裁定；其他年份依官方校史（國際校＝校史的「球場校」）。

export const ANNI_YEAR0 = 1997
export const ANNI_YEAR1 = 2027

export interface AnniversaryMilestone {
  key: string
  year: number
  /** 民國年，和 /about 沿革一樣並列 */
  roc: number
  /** 與 components/AboutContent.vue 第一章沿革同一份文字 */
  history: string
}

export const ANNI_MILESTONES: readonly AnniversaryMilestone[] = [
  { key: 'yihua', year: 1997, roc: 86, history: '第一間常春藤，在三民區義華路成立。' },
  { key: 'minghua', year: 2001, roc: 90, history: '走進左營區，有了第二所校園。' },
  { key: 'chongde', year: 2005, roc: 94, history: '左營區的第二所校園。' },
  { key: 'international', year: 2020, roc: 109, history: '在鳥松區球場路成立。' },
  { key: 'renwu', year: 2021, roc: 110, history: '第五所校園，在仁武區成立。' },
]

export const ANNI_YEARS: readonly number[] = Array.from({ length: ANNI_YEAR1 - ANNI_YEAR0 + 1 }, (_, i) => ANNI_YEAR0 + i)

export function milestoneOf(year: number): AnniversaryMilestone | undefined {
  return ANNI_MILESTONES.find((m) => m.year === year)
}

/** 那一年已經有幾所校園（成立當年就算） */
export function campusCountAt(year: number): number {
  return ANNI_MILESTONES.filter((m) => m.year <= Math.floor(year)).length
}

/** 第幾年：1997 是第 1 年，2026 是第 30 年，2027 滿 30 年 */
export function anniversaryYearIndex(year: number): number {
  return Math.floor(year) - ANNI_YEAR0 + 1
}

/** 計數器上的「第 N 年」：2027 年起寫「滿 30 年」，不寫「第 31 年」（結尾就是「2027 年，滿 30 年」） */
export function anniversaryYearMeta(year: number): { prefix: '第' | '滿'; n: number } {
  return Math.floor(year) >= ANNI_YEAR1 ? { prefix: '滿', n: ANNI_YEAR1 - ANNI_YEAR0 } : { prefix: '第', n: anniversaryYearIndex(year) }
}

export interface YearMark {
  year: number
  /** 這一年的刻度在時間軸上的位置（px，相對時間軸頂端） */
  y: number
}

/**
 * 畫筆走到 y 的時候是哪一年（可帶小數）。marks 依 y 由小到大，
 * 頭尾以外夾在第一年與最後一年。
 */
export function yearAtOffset(y: number, marks: readonly YearMark[]): number {
  if (!marks.length) return ANNI_YEAR0
  const first = marks[0]!, last = marks[marks.length - 1]!
  if (y <= first.y) return first.year
  if (y >= last.y) return last.year
  for (let i = 1; i < marks.length; i++) {
    const a = marks[i - 1]!, b = marks[i]!
    if (y <= b.y) return a.year + ((y - a.y) / Math.max(1e-6, b.y - a.y)) * (b.year - a.year)
  }
  return last.year
}

/**
 * 蠟筆線在時間軸欄位裡的水平位置：慢慢左右擺，像孩子拿著蠟筆往下走。
 * 回傳 0–1（欄位寬度的比例），同一個 y 永遠同一個值（重畫、伺服器端都一致）。
 */
export function crayonLineX(y: number): number {
  return 0.5 + 0.2 * Math.sin(y / 260 + 0.6) + 0.07 * Math.sin(y / 97 + 2.1)
}

/** 開場影片只在同一個分頁工作階段播一次 */
export const ANNI_INTRO_SESSION_KEY = 'ivy-anni-intro-seen'
