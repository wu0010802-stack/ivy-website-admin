import { describe, expect, it } from 'vitest'
import { COMMON_SESSIONS, ruleWindows, rulesToSessions, sessionName, sessionProblems, sessionsToRules, weekdaySummary, type RuleRow } from '../utils/sessions'

const rule = (weekday: number, start: string, end: string, slot_minutes = 60, capacity = 1): RuleRow =>
  ({ weekday, start_time: `${start}:00`, end_time: `${end}:00`, slot_minutes, capacity })

function windows(rules: RuleRow[]) {
  return rules.flatMap(r => ruleWindows(r).map(w => `${r.weekday} ${w.start}-${w.end} ×${r.capacity}`)).sort()
}

describe('每週規則與場次互換', () => {
  it('weekday 0 is Monday（與後端 Python weekday 相同）', () => {
    const sessions = rulesToSessions([rule(0, '10:00', '11:00')])
    expect(sessions[0]!.weekdays).toEqual([0])
    expect(weekdaySummary([0])).toBe('週一')
    expect(weekdaySummary([6])).toBe('週日')
  })

  it('同時間同名額的規則合併成一個場次', () => {
    const rules = [0, 1, 2, 3, 4].flatMap(d => [rule(d, '10:00', '11:00'), rule(d, '14:30', '15:30')])
    expect(rulesToSessions(rules)).toEqual([
      { start: '10:00', minutes: 60, capacity: 1, weekdays: [0, 1, 2, 3, 4] },
      { start: '14:30', minutes: 60, capacity: 1, weekdays: [0, 1, 2, 3, 4] },
    ])
  })

  it('round-trips a range rule whose length is not a multiple of the slot length', () => {
    const legacy = [rule(2, '09:30', '11:00', 40, 2)]  // 後端只產生 09:30–10:10、10:10–10:50
    expect(ruleWindows(legacy[0]!)).toEqual([{ start: '09:30', end: '10:10' }, { start: '10:10', end: '10:50' }])
    const sessions = rulesToSessions(legacy)
    expect(sessions.map(s => s.start)).toEqual(['09:30', '10:10'])
    expect(windows(sessionsToRules(sessions))).toEqual(windows(legacy))
  })

  it('重疊的規則以先排的名額為準（同後端 rule_window_map）', () => {
    const rules = [rule(0, '10:00', '11:00', 60, 3), rule(0, '10:00', '11:00', 60, 1)]
    expect(rulesToSessions(rules)).toEqual([{ start: '10:00', minutes: 60, capacity: 3, weekdays: [0] }])
  })

  it('星期摘要：連續寫區間，不連續用頓號，七天寫每天', () => {
    expect(weekdaySummary([0, 1, 2, 3, 4])).toBe('週一–週五')
    expect(weekdaySummary([0, 2, 4])).toBe('週一、週三、週五')
    expect(weekdaySummary([0, 1, 2, 3, 4, 5, 6])).toBe('每天')
    expect(weekdaySummary([])).toBe('未選星期')
  })

  it('場次名稱 12:00 起是下午場', () => {
    expect(sessionName('11:30')).toBe('上午場 11:30')
    expect(sessionName('12:00')).toBe('下午場 12:00')
  })

  it('常用場次是上午場 10:00、下午場 14:30，週一到週五，每場 1 組', () => {
    expect(COMMON_SESSIONS).toEqual([
      { start: '10:00', minutes: 60, capacity: 1, weekdays: [0, 1, 2, 3, 4] },
      { start: '14:30', minutes: 60, capacity: 1, weekdays: [0, 1, 2, 3, 4] },
    ])
  })

  it('檢查：沒選星期、同一天時間重疊、超過午夜', () => {
    expect(sessionProblems([{ start: '10:00', minutes: 60, capacity: 1, weekdays: [] }])).toContain('上午場 10:00 還沒選星期')
    expect(sessionProblems([
      { start: '10:00', minutes: 60, capacity: 1, weekdays: [0] },
      { start: '10:30', minutes: 60, capacity: 1, weekdays: [0, 1] },
    ])).toContain('週一的上午場 10:00 與上午場 10:30 時間重疊')
    expect(sessionProblems([{ start: '23:30', minutes: 60, capacity: 1, weekdays: [0] }])).toContain('下午場 23:30 會超過午夜')
    expect(sessionProblems(COMMON_SESSIONS as never)).toEqual([])
  })

  it('連續、長度與組數相同的場次存回時合併成區間規則，不超過後端 50 條上限', () => {
    const hourly = Array.from({ length: 11 }, (_, i) => ({ start: `${String(7 + i).padStart(2, '0')}:00`, minutes: 60, capacity: 1, weekdays: [0, 1, 2, 3, 4] }))
    const rules = sessionsToRules(hourly)
    expect(rules.length).toBeLessThanOrEqual(5)
    // 合併後產生的時段與逐場展開完全相同。
    const expanded = hourly.flatMap(s => s.weekdays.map(d => `${d} ${s.start}`)).sort()
    expect(rules.flatMap(r => ruleWindows(r).map(w => `${r.weekday} ${w.start}`)).sort()).toEqual(expanded)
    // 舊的整天區間規則來回不變多。
    const legacy = [0, 1, 2, 3, 4].map(d => rule(d, '09:00', '17:00', 30))
    expect(sessionsToRules(rulesToSessions(legacy)).length).toBeLessThanOrEqual(5)
  })
})
