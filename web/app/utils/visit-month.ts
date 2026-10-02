// 預約日期月曆（2026-10-02 取代原生下拉）：日期一律是 YYYY-MM-DD 字串、月份是 YYYY-MM，
// 只用 UTC 計算，不受瀏覽器時區影響（場次日期本來就是台北日期）。
export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

const pad = (value: number) => String(value).padStart(2, '0')

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split('-').map(Number) as [number, number]
  const shifted = new Date(Date.UTC(year, monthIndex - 1 + delta, 1))
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`
}

/** 月曆格：前面補 null，讓 1 號落在正確的星期（週日起算），之後是當月每一天。 */
export function monthCells(month: string): (string | null)[] {
  const [year, monthIndex] = month.split('-').map(Number) as [number, number]
  const lead = new Date(Date.UTC(year, monthIndex - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate()
  return [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, index) => `${month}-${pad(index + 1)}`)
  ]
}

/** 短日期（10 月 7 日（週三））：同一頁已經看得到年份時用。 */
export function shortDateLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const weekday = '日一二三四五六'[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
  return `${month} 月 ${day} 日（週${weekday}）`
}

export function monthTitle(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number)
  return `${year} 年 ${monthIndex} 月`
}

/** 每天還能選的場次數（傳入的場次已濾掉額滿）。 */
export function slotCountsByDate(slots: readonly { slot_date: string }[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const slot of slots) counts[slot.slot_date] = (counts[slot.slot_date] ?? 0) + 1
  return counts
}
