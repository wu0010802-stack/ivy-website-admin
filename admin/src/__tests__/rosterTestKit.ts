// 編班與缺額的測試假資料（姓名一律虛構）。檔名不是 *.test.ts，vitest 不會當測試跑。
import type { GapBlock, Roster, RosterClassWithStudents, RosterStudent, Tier } from '../api/roster'

let counter = 0

export function student(over: Partial<RosterStudent> = {}): RosterStudent {
  counter += 1
  return {
    id: `s-${counter}`, campus_key: 'yihua', school_year: 115, class_id: null, position: null, grade: '小班', child_name: `測試${counter}`,
    birthday: '2023-05-01', note: null, status: 'enrolled', enrollment_date: null, planned_entry_date: null, deposit_date: null,
    left_date: null, refunded_date: null, target_school_year: null, target_semester: null, is_special_education: false,
    is_indigenous: false, is_new_manual: false, underage_manual: false, next_year: 'continue', from_funnel: false, version: 1,
    is_new: false, is_underage: null, board_notice: null, ...over,
  }
}

const NO_TIER: Tier = { base: null, boost: null, top: null, reached: null, next: null, short: null }
const GRADES = ['大班', '中班', '小班', '幼幼班']

function zeroRow(): Record<string, number> {
  return { 大班: 0, 中班: 0, 小班: 0, 幼幼班: 0, total: 0 }
}

export function emptyBlock(rows: string[]): GapBlock {
  const nulls = Object.fromEntries([...GRADES, 'total'].map((key) => [key, null]))
  return {
    rows: Object.fromEntries(rows.map((key) => [key, zeroRow()])),
    targets: { ...nulls }, achievement: { ...nulls }, gap: { ...nulls }, tier: { ...NO_TIER },
  } as GapBlock
}

/** 一個班：students 會被補上 class_id 與 position。 */
export function klass(
  over: Partial<RosterClassWithStudents> & { students?: RosterStudent[] } = {},
): RosterClassWithStudents {
  counter += 1
  const id = over.id ?? `c-${counter}`
  const grade = over.grade ?? '大班'
  const students = (over.students ?? []).map((s, index) => ({ ...s, class_id: id, position: index, grade }))
  return {
    id, campus_key: 'yihua', school_year: 115, grade, name: `${grade[0]}${counter}班`, class_code: `${grade[0]}${counter}`,
    english_name: null, head_teacher: null, assistant_teacher: null, english_teacher: null, target_seats: null, sort_order: 0,
    version: 1, count: students.length, gap: null, ...over, students,
  }
}

export function roster(over: Partial<Roster> = {}): Roster {
  const classes = over.classes ?? []
  const grade_totals = Object.fromEntries(GRADES.map((g) => {
    const members = classes.filter((c) => c.grade === g).flatMap((c) => c.students)
    const pending = members.filter((m) => m.status === 'pending').length
    const fresh = members.filter((m) => m.is_new).length
    return [g, { count: members.length, returning: members.length - fresh, new: fresh, pending }]
  }))
  return {
    campus_key: 'yihua', school_year: 115, today: '2026-11-15', as_of: '2026-11-15', classes, unassigned: [], next_year: [], gone: [],
    grade_totals, current: emptyBlock(['enrolled', 'pending_s1', 'pending_s2', 'estimate']),
    next: emptyBlock(['promoted', 'leaving', 'repeating', 'pending_next', 'estimate_next']),
    underage_enrolled: 0, underage_pending: 0, missing_birthday: 0, incomplete: 0, snapshots: [], ...over,
  }
}
