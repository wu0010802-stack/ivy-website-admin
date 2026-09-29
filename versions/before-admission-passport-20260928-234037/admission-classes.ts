/**
 * 分班對照（入學資訊頁）。規則沿用舊官網分班表：民國 Y/9/2 ～ Y+1/9/1 出生為同一屆，
 * Y+3 學年度讀幼幼班，之後每年升一班，Y+7 學年度上小一。學年度 8 月 1 日起算。
 * 規則是法定入學年齡，不是園方文案，所以寫在程式裡、不進後台。
 */
export const CLASS_BY_OFFSET: Record<number, string> = { 3: '幼幼班', 4: '小班', 5: '中班', 6: '大班', 7: '小一' }
const KINDERGARTEN_OFFSETS = [3, 4, 5, 6]
const PLAN_OFFSETS = [3, 4, 5, 6, 7]

interface YMD { year: number; month: number; day: number }

/** 台北時區的年月日。伺服器在 UTC，SSR 與瀏覽器要算出同一個學年度。 */
export function taipeiYmd(now = new Date()): YMD {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now).split('-').map(Number)
  return { year: year!, month: month!, day: day! }
}

/** 目前的學年度（民國）：8 月起算新學年。 */
export function academicYear(today: YMD): number {
  return today.month >= 8 ? today.year - 1911 : today.year - 1912
}

/** 出生日期 → 屆別（民國 Y，代表 Y/9/2 ～ Y+1/9/1 出生）。 */
export function cohortOf(birth: YMD): number {
  const roc = birth.year - 1911
  return birth.month > 9 || (birth.month === 9 && birth.day >= 2) ? roc : roc - 1
}

/** 解析 <input type=date> 的 YYYY-MM-DD；格式不對或日期不存在回傳 null。 */
export function parseBirthday(value: string): YMD | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return { year, month, day }
}

export interface ClassRange { roc: string; ad: string }
export interface ClassTableRow { name: string; ranges: ClassRange[] }

/** 各班在指定學年度的出生區間（民國與西元並列）。 */
export function classTable(years: number[]): ClassTableRow[] {
  return KINDERGARTEN_OFFSETS.map((offset) => ({
    name: CLASS_BY_OFFSET[offset]!,
    ranges: years.map((y) => {
      const start = y - offset
      return { roc: `${start}/9/2 – ${start + 1}/9/1`, ad: `${start + 1911}.9.2 – ${start + 1912}.9.1` }
    })
  }))
}

export interface ClassPlanRow { year: number; name: string; current: boolean; past: boolean }
export interface ClassPlan { summary: string; rows: ClassPlanRow[] }

/** 依生日列出幼幼班到小一每一年的班級，並寫一句摘要。 */
export function classPlan(birth: YMD, currentYear: number): ClassPlan {
  const cohort = cohortOf(birth)
  const rows = PLAN_OFFSETS.map((offset) => ({
    year: cohort + offset,
    name: CLASS_BY_OFFSET[offset]!,
    current: cohort + offset === currentYear,
    past: cohort + offset < currentYear
  }))
  const now = rows.find((row) => row.current)
  let summary: string
  if (now) summary = `${currentYear} 學年度，寶貝就讀${now.name}。`
  else if (cohort + 3 > currentYear) summary = `寶貝 ${cohort + 3} 學年度（${cohort + 3 + 1911} 年 8 月起）可以開始讀幼幼班。`
  else summary = '寶貝已到國小年齡囉。'
  return { summary, rows }
}
