// 參觀時間的台北日期與相對時間（2026-10-06 案件明細 C、列表 B）。後台使用者可能不在台灣時區
// （出差、CI 是 UTC），一律以台北日期計算，不用瀏覽器本地時間。場次的日期與時間本來就是台北的。
const TAIPEI = 'Asia/Taipei'
const dayFormatter = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TAIPEI })

/** 某個時間點在台北是哪一天（YYYY-MM-DD）。 */
export function taipeiDay(time: number): string {
  return dayFormatter.format(new Date(time))
}

/** 兩個 YYYY-MM-DD 相差幾天（b − a）。 */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

export interface SlotTime { slot_date: string; start_time: string; end_time?: string | null }

const at = (date: string, time: string) => Date.parse(`${date}T${time.slice(0, 8)}+08:00`)

export function slotStart(slot: SlotTime): number {
  return at(slot.slot_date, slot.start_time)
}

/** 沒有結束時間的來源當一小時（參觀場次的預設長度）。 */
export function slotEnd(slot: SlotTime): number {
  return slot.end_time ? at(slot.slot_date, slot.end_time) : slotStart(slot) + 3_600_000
}

export type RelativeTone = 'live' | 'ended' | ''

/** 頁首參觀時間旁的「還有 3 天」「明天」「進行中」「結束了 2 小時」（第五輪：寫剩多久，不只給時間戳）。 */
export function relativeVisitTime(slot: SlotTime, now: number): { text: string; tone: RelativeTone } {
  const start = slotStart(slot)
  if (Number.isNaN(start)) return { text: '', tone: '' }
  const end = slotEnd(slot)
  if (now < start) {
    const days = daysBetween(taipeiDay(now), slot.slot_date)
    if (days >= 2) return { text: `還有 ${days} 天`, tone: '' }
    if (days === 1) return { text: '明天', tone: '' }
    const minutes = Math.ceil((start - now) / 60_000)
    return { text: minutes < 60 ? `還有 ${minutes} 分鐘` : `還有 ${Math.floor(minutes / 60)} 小時`, tone: '' }
  }
  if (now < end) return { text: '進行中', tone: 'live' }
  const minutes = Math.floor((now - end) / 60_000)
  if (minutes < 1) return { text: '剛結束', tone: 'ended' }
  if (minutes < 60) return { text: `結束了 ${minutes} 分鐘`, tone: 'ended' }
  if (minutes < 24 * 60) return { text: `結束了 ${Math.floor(minutes / 60)} 小時`, tone: 'ended' }
  return { text: `結束了 ${Math.max(1, daysBetween(slot.slot_date, taipeiDay(now)))} 天`, tone: 'ended' }
}
