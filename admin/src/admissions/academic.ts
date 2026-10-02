import type { Grade } from './constants'

// 招生的「今天」一律用台北日期（後端 app.common.timezones.today_local 同一條規則）。
const TAIPEI_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function taipeiToday(now: Date = new Date()): string {
  return TAIPEI_DATE.format(now)
}

export interface Term {
  schoolYear: number
  semester: 1 | 2
}

// 同後端 academic.current_term：8/1–12/31 →（西元−1911，上）；1/1–1/31 →（西元−1912，上）；
// 2/1–7/31 →（西元−1912，下）。7 月仍算上一學年下學期（同園務），暑假新增的訪視
// 要自己改成新學年；表單提示「預設當前學期，可改」。
export function currentTerm(today: string = taipeiToday()): Term {
  const [year = 0, month = 0] = today.split('-').map(Number)
  if (month >= 8) return { schoolYear: year - 1911, semester: 1 }
  if (month === 1) return { schoolYear: year - 1912, semester: 1 }
  return { schoolYear: year - 1912, semester: 2 }
}

/** 明細用 long：「115 上學期」；卡片用 short：「115上」（同園務卡片的入學學期標籤）。 */
export function termLabel(
  schoolYear: number | null | undefined,
  semester: number | null | undefined,
  style: 'long' | 'short' = 'long',
): string {
  const half = semester === 1 ? '上' : semester === 2 ? '下' : ''
  if (style === 'short') return schoolYear && half ? `${schoolYear}${half}` : ''
  if (!schoolYear) return '—'
  return half ? `${schoolYear} ${half}學期` : `${schoolYear} 學年`
}

const AGE_GRADES: Record<number, Grade> = { 2: '幼幼班', 3: '小班', 4: '中班', 5: '大班' }

// 園務 constants/recruitment.ts gradeForBirthday：學年 N 以西元 (N+1911)/9/1（含）為足歲
// 基準；2 歲幼幼班、3 小班、4 中班、5 大班，範圍外回 null（不強帶）。
export function gradeForBirthday(birthday: string | null | undefined, schoolYear: number | null | undefined): Grade | null {
  if (!birthday || !schoolYear) return null
  const match = ISO_DATE.exec(birthday)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  let age = schoolYear + 1911 - year
  if (month > 9 || (month === 9 && day > 1)) age -= 1
  return AGE_GRADES[age] ?? null
}

/** 「2026-09-08」→「115.09」（園務 month 欄位格式）。 */
export function rocMonth(iso: string | null | undefined): string {
  const match = ISO_DATE.exec(iso ?? '')
  return match ? `${Number(match[1]) - 1911}.${match[2]}` : ''
}

/** 「2026-09-08」→「115.09.08」（園務 visit_date 字串格式）。 */
export function rocDate(iso: string | null | undefined): string {
  const match = ISO_DATE.exec(iso ?? '')
  return match ? `${Number(match[1]) - 1911}.${match[2]}.${match[3]}` : ''
}

export function schoolYearOptions(base: number, offsets: readonly number[]): number[] {
  return offsets.map((offset) => base + offset)
}

/** 日期選擇器的 disabled-date：民國 100–200 年（西元 2011–2111）以外不可選。 */
export function outsideRocRange(date: Date): boolean {
  const year = date.getFullYear()
  return year < 2011 || year > 2111
}
