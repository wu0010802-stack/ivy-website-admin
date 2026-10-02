import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CLASS_BY_OFFSET, academicYear, cohortOf, parseBirthday } from '../app/utils/admission-classes'

interface GradeCase {
  name: string
  birthday: string
  today: string
  expected_term: [number, number]
  expected_grade: string | null
}

const casesPath = fileURLToPath(new URL('../../contracts/ivy-recruitment/grade-cases.json', import.meta.url))
const cases = (JSON.parse(readFileSync(casesPath, 'utf8')) as { cases: GradeCase[] }).cases

function ymd(value: string) {
  const parsed = parseBirthday(value)
  if (!parsed) throw new Error(`案例日期格式錯誤：${value}`)
  return parsed
}

// 官網分班表的規則：學年度減屆別 3＝幼幼班、6＝大班；7 是小一，招生年級不含。
function gradeOf(birthday: string, schoolYear: number): string | null {
  const offset = schoolYear - cohortOf(ymd(birthday))
  return offset >= 3 && offset <= 6 ? CLASS_BY_OFFSET[offset]! : null
}

describe('招生年級共用案例（contracts/ivy-recruitment/grade-cases.json）', () => {
  it('讀得到案例，沒有空轉', () => {
    expect(cases.length).toBeGreaterThanOrEqual(15)
  })

  for (const c of cases) {
    it(c.name, () => {
      const schoolYear = academicYear(ymd(c.today))
      expect(schoolYear).toBe(c.expected_term[0])
      expect(gradeOf(c.birthday, schoolYear)).toBe(c.expected_grade)
    })
  }
})
