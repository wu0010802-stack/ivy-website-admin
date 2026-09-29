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

/** 某一班（offset＝學年度減屆別，3 幼幼班～7 小一）在指定學年度的出生區間，民國與西元並列。 */
export function classRanges(offset: number, years: number[]): ClassRange[] {
  return years.map((y) => {
    const start = y - offset
    return { roc: `${start}/9/2 – ${start + 1}/9/1`, ad: `${start + 1911}.9.2 – ${start + 1912}.9.1` }
  })
}

/** 各班在指定學年度的出生區間（幼幼班～大班）。 */
export function classTable(years: number[]): ClassTableRow[] {
  return KINDERGARTEN_OFFSETS.map((offset) => ({ name: CLASS_BY_OFFSET[offset]!, ranges: classRanges(offset, years) }))
}

export interface ClassPlanRow { year: number; name: string; current: boolean; past: boolean }
/** enrolled：今年在幼兒園；young：還沒到幼幼班；school：已到國小年齡。 */
export type ClassStatus = 'enrolled' | 'young' | 'school'
export interface ClassPlan {
  summary: string
  rows: ClassPlanRow[]
  cohort: number
  status: ClassStatus
  /** 成長軌道上的站（rows 的索引）：讀幼兒園停今年那一站，還沒入學停幼幼班，已上小學停小一。 */
  position: number
  /** 摘要之後的每一年，例如「116 學年度升大班」。 */
  next: string[]
}

/** 依生日列出幼幼班到小一每一年的班級，並寫一句摘要。 */
export function classPlan(birth: YMD, currentYear: number): ClassPlan {
  const cohort = cohortOf(birth)
  const rows = PLAN_OFFSETS.map((offset) => ({
    year: cohort + offset,
    name: CLASS_BY_OFFSET[offset]!,
    current: cohort + offset === currentYear,
    past: cohort + offset < currentYear
  }))
  const index = rows.findIndex((row) => row.current)
  const now = rows[index]
  let summary: string
  if (now) summary = `${currentYear} 學年度，寶貝就讀${now.name}。`
  else if (cohort + 3 > currentYear) summary = `寶貝 ${cohort + 3} 學年度（${cohort + 3 + 1911} 年 8 月起）可以開始讀幼幼班。`
  else summary = '寶貝已到國小年齡囉。'

  const status: ClassStatus = index >= 0 && index < KINDERGARTEN_OFFSETS.length ? 'enrolled' : cohort + 3 > currentYear ? 'young' : 'school'
  let next: string[]
  if (status === 'enrolled') {
    next = rows.slice(index + 1).map((row) => row === rows.at(-1) ? `${row.year} 學年度（${row.year + 1911} 年 8 月）上小一` : `${row.year} 學年度升${row.name}`)
  } else if (status === 'young') next = [`${cohort + 3 + 1911} 年 8 月起，之後每年 8 月升一班`]
  else next = now ? [`${currentYear} 學年度讀小一`] : []
  const position = status === 'enrolled' ? index : status === 'young' ? 0 : rows.length - 1
  return { summary, rows, cohort, status, position, next }
}
