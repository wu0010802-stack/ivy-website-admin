// 「參觀場次」頁以場次為單位設定每週固定場次；後端仍存每週規則（visit_rules）。
// 換算必須和後端 schedule_service.rule_windows／rule_window_map 產生完全相同的時段，
// 否則存檔時 sync_rule_slots 會刪建場次。weekday 0＝週一（Python weekday）。

export interface RuleRow { weekday: number; start_time: string; end_time: string; slot_minutes: number; capacity: number }
export interface Session { start: string; minutes: number; capacity: number; weekdays: number[] }

export const WEEKDAY_NAMES: readonly string[] = ['一', '二', '三', '四', '五', '六', '日']
export const COMMON_SESSIONS: readonly Session[] = [
  { start: '10:00', minutes: 60, capacity: 1, weekdays: [0, 1, 2, 3, 4] },
  { start: '14:30', minutes: 60, capacity: 1, weekdays: [0, 1, 2, 3, 4] },
]

function toMinutes(value: string): number {
  const [h, m] = value.slice(0, 5).split(':').map(Number)
  return h! * 60 + m!
}
function toClock(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function ruleWindows(rule: RuleRow): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = []
  const end = toMinutes(rule.end_time)
  if (rule.slot_minutes <= 0) return out
  for (let cursor = toMinutes(rule.start_time); cursor + rule.slot_minutes <= end; cursor += rule.slot_minutes) {
    out.push({ start: toClock(cursor), end: toClock(cursor + rule.slot_minutes) })
  }
  return out
}

export function rulesToSessions(rules: RuleRow[]): Session[] {
  // 先排的規則優先（後端 list_rules 依 weekday, start_time 排序，rule_window_map 用 setdefault）。
  const ordered = [...rules].sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))
  const windows = new Map<string, number>()
  for (const rule of ordered) {
    for (const w of ruleWindows(rule)) {
      const key = `${rule.weekday}|${w.start}|${w.end}`
      if (!windows.has(key)) windows.set(key, rule.capacity)
    }
  }
  const sessions = new Map<string, Session>()
  for (const [key, capacity] of windows) {
    const [weekday, start, end] = key.split('|')
    const minutes = toMinutes(end!) - toMinutes(start!)
    const id = `${start}|${minutes}|${capacity}`
    const session = sessions.get(id) ?? { start: start!, minutes, capacity, weekdays: [] }
    session.weekdays.push(Number(weekday))
    sessions.set(id, session)
  }
  return [...sessions.values()]
    .map(s => ({ ...s, weekdays: [...new Set(s.weekdays)].sort((a, b) => a - b) }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.minutes - b.minutes || a.capacity - b.capacity)
}

export function sessionsToRules(sessions: Session[]): RuleRow[] {
  const single = sessions
    .flatMap(s => s.weekdays.map(weekday => ({
      weekday,
      start_time: `${s.start}:00`,
      end_time: `${toClock(toMinutes(s.start) + s.minutes)}:00`,
      slot_minutes: s.minutes,
      capacity: s.capacity,
    })))
    .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))
  // 同一天首尾相接、長度與組數相同的場次合併成一條區間規則：產生的時段不變，
  // 但規則條數少很多（後端上限 50 條；整天每 30 分鐘一格逐場展開會超過）。
  const merged: RuleRow[] = []
  for (const rule of single) {
    const last = merged[merged.length - 1]
    if (last && last.weekday === rule.weekday && last.slot_minutes === rule.slot_minutes && last.capacity === rule.capacity && last.end_time === rule.start_time) {
      last.end_time = rule.end_time
    } else {
      merged.push({ ...rule })
    }
  }
  return merged
}

export function sessionName(start: string): string {
  const hhmm = start.slice(0, 5)
  return `${Number(hhmm.slice(0, 2)) < 12 ? '上午場' : '下午場'} ${hhmm}`
}

export function weekdaySummary(weekdays: number[]): string {
  const days = [...new Set(weekdays)].sort((a, b) => a - b)
  if (!days.length) return '未選星期'
  if (days.length === 7) return '每天'
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1]! + 1)
  if (contiguous && days.length >= 3) return `週${WEEKDAY_NAMES[days[0]!]}–週${WEEKDAY_NAMES[days[days.length - 1]!]}`
  return days.map(d => `週${WEEKDAY_NAMES[d]}`).join('、')
}

export function sessionProblems(sessions: Session[]): string[] {
  const problems: string[] = []
  for (const s of sessions) {
    if (!s.weekdays.length) problems.push(`${sessionName(s.start)} 還沒選星期`)
    if (toMinutes(s.start) + s.minutes > 24 * 60) problems.push(`${sessionName(s.start)} 會超過午夜`)
  }
  for (let day = 0; day < 7; day++) {
    const today = sessions.filter(s => s.weekdays.includes(day)).sort((a, b) => a.start.localeCompare(b.start))
    for (let i = 1; i < today.length; i++) {
      const prev = today[i - 1]!
      if (toMinutes(prev.start) + prev.minutes > toMinutes(today[i]!.start)) {
        problems.push(`週${WEEKDAY_NAMES[day]}的${sessionName(prev.start)} 與${sessionName(today[i]!.start)} 時間重疊`)
      }
    }
  }
  return [...new Set(problems)]
}
