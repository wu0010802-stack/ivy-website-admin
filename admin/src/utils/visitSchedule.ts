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

// 星期幾（週一…週日），給時段列表、日期標題用。這個檔不 import 任何模組：labels.ts 要用這裡的 slotStart
// 與 formatWeekday，從 labels 反向 import 會繞成圈。
const weekdayFormatter = new Intl.DateTimeFormat('zh-TW', { weekday: 'short', timeZone: TAIPEI })

export function formatWeekday(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(`${value}T00:00:00+08:00`)
  if (Number.isNaN(d.getTime())) return ''
  return weekdayFormatter.format(d)
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

// ── 行程清單（2026-10-06 方向 B）──

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** 一週從週一開始（週日算這一週的最後一天）。 */
export function weekStart(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  return addDays(day, -((weekday + 6) % 7))
}

export type DayBucket = 'today' | 'tomorrow' | 'yesterday' | 'this_week' | 'earlier_this_week' | 'later' | 'earlier' | 'none'

/** 行程清單的日期分組（2026-10-06 方向 B）：今天、明天、昨天優先，其餘看是不是這一週。 */
export function dayBucket(slotDate: string | null | undefined, today: string): DayBucket {
  if (!slotDate) return 'none'
  const diff = daysBetween(today, slotDate)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  const start = weekStart(today)
  if (diff > 1) return slotDate <= addDays(start, 6) ? 'this_week' : 'later'
  return slotDate >= start ? 'earlier_this_week' : 'earlier'
}

const BUCKET_LABELS: Record<DayBucket, string> = {
  today: '今天', tomorrow: '明天', yesterday: '昨天', this_week: '本週', earlier_this_week: '本週稍早',
  later: '之後', earlier: '更早', none: '沒有場次',
}
const DATED: ReadonlySet<DayBucket> = new Set(['today', 'tomorrow', 'yesterday'])

/** 「09/28（週一）」；不是台北今年的日子前面加年份（跨年的場次看不出是哪一年會誤會，同舊表格的 formatShortSlotWhen）。 */
export function shortDay(day: string, today: string): string {
  const year = day.slice(0, 4) === today.slice(0, 4) ? '' : `${day.slice(0, 4)}/`
  return `${year}${day.slice(5).replace('-', '/')}（${formatWeekday(day)}）`
}

export interface DayGroup<T> { key: string; bucket: DayBucket; label: string; rows: T[] }

/** 已經依參觀時間排好的一頁切成連續的日期分組；同一組在清單裡相鄰，所以照清單順序走、不重排。 */
export function groupVisitsByDay<T extends { slot?: { slot_date: string } | null }>(rows: readonly T[], today: string): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  for (const row of rows) {
    const day = row.slot?.slot_date ?? null
    const bucket = dayBucket(day, today)
    const last = groups[groups.length - 1]
    if (last && last.bucket === bucket) {
      last.rows.push(row)
      continue
    }
    const label = DATED.has(bucket) && day ? `${BUCKET_LABELS[bucket]} ${shortDay(day, today)}` : BUCKET_LABELS[bucket]
    groups.push({ key: `${bucket}-${groups.length}`, bucket, label, rows: [row] })
  }
  return groups
}

export type VisitPhase = 'upcoming' | 'ongoing' | 'ended' | 'done' | 'no_show' | 'cancelled'

/** 列上的接待狀態（同總覽「今天的參觀」：還沒標記、進行中、已到場、未到場）。 */
export function visitPhase(row: { status: string; slot?: SlotTime | null }, now: number): VisitPhase {
  if (row.status === 'cancelled') return 'cancelled'
  if (row.status === 'completed') return 'done'
  if (row.status === 'no_show') return 'no_show'
  if (!row.slot || now < slotStart(row.slot)) return 'upcoming'
  return now < slotEnd(row.slot) ? 'ongoing' : 'ended'
}

export const VISIT_PHASE_LABELS: Record<VisitPhase, string> = {
  upcoming: '', ongoing: '進行中', ended: '還沒標記', done: '已到場', no_show: '未到場', cancelled: '已取消',
}

/** 預覽面板的「下一筆」：清單裡的下一筆；目前這筆已離開清單（例如剛取消）就由接手它位置的那筆遞補（同明細「下一筆」）。 */
export function nextInList(ids: readonly string[], current: string | null, lastIndex: number): string | null {
  const index = current ? ids.indexOf(current) : -1
  if (index >= 0) return ids[index + 1] ?? null
  if (!ids.length) return null
  return ids[Math.min(Math.max(lastIndex, 0), ids.length - 1)] ?? null
}

// ── 到期待追蹤（列表的列與明細頁首共用，預檢 D5：規則只留一份）──

/** 會列進總覽「到期待追蹤」的案件：與後端同一個定義，已取消、已完成的不算（結案不會清掉預定聯絡時間，所以不能只看時間）。 */
export const followUpTracked = (status: string): boolean => status !== 'cancelled' && status !== 'completed'

/** 預定聯絡時間已到、案件還沒結案。 */
export function followUpDue(row: { status: string; follow_up_at?: string | null }, now: number): boolean {
  return Boolean(row.follow_up_at) && followUpTracked(row.status) && Date.parse(row.follow_up_at!) <= now
}
