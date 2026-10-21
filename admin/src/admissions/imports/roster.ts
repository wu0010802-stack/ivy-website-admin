// 教保資訊網「園所幼生清冊」匯出檔（UTF-8 HTML、副檔名 .xls）在瀏覽器解析：
// 規則同後端 enrolled/roster.py parse_roster。姓名、生日、其他欄只在這裡讀，
// 不進回傳值；送出的預覽本文只有班別與地址（enrolledPreviewBody）。
import type { components } from '../../../../contracts/generated/website-api'
import { currentTerm, rosterGrade } from '../academic'
import { GRADES } from '../constants'

type EnrolledPreviewRequest = components['schemas']['EnrolledPreviewIn']

const BIRTHDAY_COLUMN = '出生日期'
const ADDRESS_COLUMN = '通訊地址'
const PRINTED = /列印日期[:：]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/
const DATE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/
const INSTITUTION_MAX = 60
// 預覽本文的排序：班別順序再比地址，不照清冊列序。
const GRADE_ORDER: readonly string[] = [...GRADES, '其他']

/** 清冊格式不對；訊息可以直接印給操作的人看（不含地址）。 */
export class RosterFileError extends Error {}

export interface RosterStudent {
  birthday: string // YYYY-MM-DD
  address: string
}

export interface RosterFile {
  printedOn: string | null // YYYY-MM-DD
  institution: string | null
  students: RosterStudent[]
}

// 同 Python date(y, m, d)：年 1–9999、月日要真的存在（2023/02/30 不算）。
function isoDate(year: number, month: number, day: number): string | null {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  if (year < 1 || daysInMonth === undefined || day < 1 || day > daysInMonth) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function birthdayOf(text: string): string | null {
  const matched = DATE.exec(text)
  return matched ? isoDate(Number(matched[1]), Number(matched[2]), Number(matched[3])) : null
}

function printedOn(tables: HTMLTableElement[]): string | null {
  for (const table of tables) {
    for (const row of Array.from(table.rows)) {
      for (const cell of Array.from(row.cells)) {
        const matched = PRINTED.exec(cell.textContent ?? '')
        if (matched) return isoDate(Number(matched[1]), Number(matched[2]), Number(matched[3]))
      }
    }
  }
  return null
}

// 名冊表格以外第一個含「幼兒園」或「常春藤」的格子；內含表格的格子（版面用的外層表格）
// 會連名冊一起帶出，一律略過。
function institutionOf(tables: HTMLTableElement[], roster: HTMLTableElement): string | null {
  for (const table of tables) {
    if (table === roster) continue
    for (const row of Array.from(table.rows)) {
      for (const cell of Array.from(row.cells)) {
        if (cell.querySelector('table')) continue
        const text = (cell.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (text.includes('幼兒園') || text.includes('常春藤')) return text.slice(0, INSTITUTION_MAX)
      }
    }
  }
  return null
}

// DOMParser 產生的文件不執行腳本、不載入圖片，檔案內容只當資料讀。
export function parseRosterHtml(text: string): RosterFile {
  const tables = Array.from(new DOMParser().parseFromString(text, 'text/html').querySelectorAll('table'))
  for (const table of tables) {
    const grid = Array.from(table.rows, (row) => Array.from(row.cells, (cell) => (cell.textContent ?? '').trim()))
    const header = grid[0]
    if (!header || !header.includes(BIRTHDAY_COLUMN) || !header.includes(ADDRESS_COLUMN)) continue
    const birthdayAt = header.indexOf(BIRTHDAY_COLUMN)
    const addressAt = header.indexOf(ADDRESS_COLUMN)
    const students: RosterStudent[] = []
    // 列號照試算表的算法：表頭是第 1 列。
    grid.slice(1).forEach((cells, index) => {
      const number = index + 2
      if (cells.length !== header.length) throw new RosterFileError(`名冊第 ${number} 列的欄數和表頭不同`)
      const birthday = birthdayOf(cells[birthdayAt] ?? '')
      if (birthday === null) throw new RosterFileError(`名冊第 ${number} 列的出生日期不是 YYYY/MM/DD`)
      students.push({ birthday, address: cells[addressAt] ?? '' })
    })
    if (students.length === 0) throw new RosterFileError('名冊沒有任何學生')
    return { printedOn: printedOn(tables), institution: institutionOf(tables, table), students }
  }
  throw new RosterFileError(`找不到有「${BIRTHDAY_COLUMN}」「${ADDRESS_COLUMN}」兩欄的名冊表格`)
}

/** 預覽請求本文：只有名冊日期與每位的班別、地址；依（班別順序, 地址）排序，看不出清冊列序。
 * 地址用字碼比較而不是 localeCompare，本文才不隨瀏覽器語系不同。 */
export function enrolledPreviewBody(roster: RosterFile, rosterDate: string): EnrolledPreviewRequest {
  const { schoolYear } = currentTerm(rosterDate)
  const students = roster.students
    .map((student) => ({ grade: rosterGrade(student.birthday, schoolYear), address: student.address }))
    .sort(
      (a, b) =>
        GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) || (a.address < b.address ? -1 : a.address > b.address ? 1 : 0),
    )
  return { roster_date: rosterDate, students }
}
