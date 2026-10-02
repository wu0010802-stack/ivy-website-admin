/// <reference types="node" />
// 讀 repo 根目錄的共用案例（node:fs／__dirname）。app 的 tsconfig 只開 vite/client，
// 這裡明確引用 Node 型別（同 siteStructure.test.ts）。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { currentTerm, gradeForBirthday, outsideRocRange, rocDate, rocMonth, schoolYearOptions, taipeiToday, termLabel } from '../admissions/academic'

// 形狀由 A1 鎖定：年級一律用 expected_term 的學年換算。
interface GradeCases {
  cases: { name: string; birthday: string; today: string; expected_term: [number, 1 | 2]; expected_grade: string | null }[]
}
const cases = JSON.parse(readFileSync(resolve(__dirname, '../../../contracts/ivy-recruitment/grade-cases.json'), 'utf8')) as GradeCases

describe('年級與學期：與後端、官網讀同一份共用案例（規格 6.4、R12）', () => {
  it('生日換算適讀班級', () => {
    expect(cases.cases.length).toBeGreaterThan(0)
    for (const c of cases.cases) expect(gradeForBirthday(c.birthday, c.expected_term[0]), c.name).toBe(c.expected_grade)
  })

  it('台北日期換算目前學期', () => {
    expect(cases.cases.length).toBeGreaterThan(0)
    for (const c of cases.cases) expect(currentTerm(c.today), c.name).toEqual({ schoolYear: c.expected_term[0], semester: c.expected_term[1] })
  })
})

describe('學期邊界（Review Focus 2）', () => {
  it('7/31 還是上一學年下學期，8/1 換新學年上學期；1/31 仍是上學期，2/1 換下學期', () => {
    expect(currentTerm('2026-07-31')).toEqual({ schoolYear: 114, semester: 2 })
    expect(currentTerm('2026-08-01')).toEqual({ schoolYear: 115, semester: 1 })
    expect(currentTerm('2027-01-31')).toEqual({ schoolYear: 115, semester: 1 })
    expect(currentTerm('2027-02-01')).toEqual({ schoolYear: 115, semester: 2 })
  })

  it('「今天」用台北時間：UTC 7/31 16:00 已經是台北 8/1', () => {
    expect(taipeiToday(new Date('2026-07-31T16:00:00Z'))).toBe('2026-08-01')
    expect(taipeiToday(new Date('2026-07-31T15:59:59Z'))).toBe('2026-07-31')
  })
})

describe('園務 gradeForBirthday 的規則', () => {
  it('9/1 含當天以前出生算足歲；範圍外與格式錯誤回 null（不硬帶）', () => {
    expect(gradeForBirthday('2023-09-01', 115)).toBe('小班')
    expect(gradeForBirthday('2023-09-02', 115)).toBe('幼幼班')
    expect(gradeForBirthday('2021-01-15', 115)).toBe('大班')
    expect(gradeForBirthday('2025-01-15', 115)).toBeNull()
    expect(gradeForBirthday('2019-05-05', 115)).toBeNull()
    expect(gradeForBirthday('2023/09/01', 115)).toBeNull()
    expect(gradeForBirthday(null, 115)).toBeNull()
    expect(gradeForBirthday('2023-09-01', null)).toBeNull()
  })
})

describe('顯示用的寫法', () => {
  it('入學學期：明細「115 上學期」、卡片「115上」，缺值不硬湊', () => {
    expect(termLabel(115, 1)).toBe('115 上學期')
    expect(termLabel(115, 2, 'short')).toBe('115下')
    expect(termLabel(115, null)).toBe('115 學年')
    expect(termLabel(null, 1)).toBe('—')
    expect(termLabel(115, null, 'short')).toBe('')
  })

  it('民國月份與日期（園務表單「民國：115.09.08（月份：115.09）」）', () => {
    expect(rocMonth('2026-09-08')).toBe('115.09')
    expect(rocDate('2026-09-08')).toBe('115.09.08')
    expect(rocMonth('2026-01-31')).toBe('115.01')
    expect(rocMonth('')).toBe('')
    expect(rocDate(null)).toBe('')
  })

  it('學年選項依偏移排列', () => {
    expect(schoolYearOptions(115, [1, 0, -1, -2])).toEqual([116, 115, 114, 113])
  })
})

describe('民國日期範圍（R12）', () => {
  it('民國 100–200 年以外不可選', () => {
    expect(outsideRocRange(new Date(2010, 11, 31))).toBe(true)
    expect(outsideRocRange(new Date(2011, 0, 1))).toBe(false)
    expect(outsideRocRange(new Date(2111, 11, 31))).toBe(false)
    expect(outsideRocRange(new Date(2112, 0, 1))).toBe(true)
  })
})
