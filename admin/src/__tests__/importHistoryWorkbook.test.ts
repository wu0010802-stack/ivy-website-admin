import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { extractSheet, HistoryFileError, readHistoryWorkbook, type HistoryCell } from '../admissions/imports/historyWorkbook'

// 共用案例：contracts/ivy-recruitment/history-extract-cases.json，後端 test_history_grid.py 讀同一份。
interface ExtractCase {
  name: string
  sheet: string
  width: number
  rows: unknown[][]
  expected: { name: string; width: number; rows: Record<string, HistoryCell[]> }
}
const cases = (JSON.parse(readFileSync(resolve(__dirname, '../../../contracts/ivy-recruitment/history-extract-cases.json'), 'utf8')) as { cases: ExtractCase[] }).cases

// 只用合成資料：假備註、假姓名，不開任何真的統計表。
const MASKED: HistoryCell = { masked: true }

function biff8(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const book = XLSX.utils.book_new()
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(aoa), name)
  return XLSX.write(book, { bookType: 'biff8', type: 'array' }) as ArrayBuffer
}

// 仿統計表：第 0–1 列標題、第 2–3 列表頭、第 4 列起年級與總人數，最後是備註。
function termRows(registered: number): unknown[][] {
  return [
    ['常春藤測試幼兒園目標執行統計表'],
    ['測試學年度'],
    ['目標人數', null, '1150915     ', '1150915     目標\n達成率'],
    [null, null, '註冊\n人數', null],
    ['大班', 70, registered, 0.8857],
    ['中班', 60, 50, 0.8333],
    ['小班', 55, 48, 0.8727],
    ['幼幼班', 40, 33, 0.825],
    ['總人數', null, registered + 131, null],
    ['備註：測試小明'],
    ['*115上新生(3人)：測試小明.測試小華', '測試小美'],
  ]
}

describe('extractSheet（共用案例）', () => {
  it.each(cases)('擷取規則和後端一致：$name', ({ sheet, rows, width, expected }) => {
    expect(extractSheet(sheet, rows, width)).toEqual(expected)
  })

  it.each(cases)('只送表頭與年級列，不帶姓名：$name', ({ sheet, rows, width }) => {
    const text = JSON.stringify(extractSheet(sheet, rows, width))
    for (const name of ['測試小明', '測試小華', '測試小美']) expect(text).not.toContain(name)
  })

  it('最多 7 列（兩列表頭加五個標籤列），其餘重複的年級列不送', () => {
    const grades = ['大班', '中班', '小班', '幼幼班', '總人數']
    const rows: unknown[][] = [[], [], ['a'], ['b'], ...grades.map((g) => [g, 1]), ...grades.map((g) => [g, 2]), ['大班', 3]]

    const grid = extractSheet('104上', rows, 2)

    expect(Object.keys(grid.rows)).toEqual(['2', '3', '4', '5', '6', '7', '8'])
    expect(grid.rows['4']).toEqual(['大班', 1])
  })
})

describe('extractSheet（邊界）', () => {
  it('每一列都不比 width 長，width 0 也一樣（標籤列也不例外）', () => {
    const rows = [[], [], ['目標人數'], ['註冊'], ['大班', 1], ['總人數', 2]]
    for (const width of [0, 1, 2, 5]) {
      const grid = extractSheet('104上', rows, width)
      for (const row of Object.values(grid.rows)) expect(row).toHaveLength(width)
    }
  })

  it('空白字元和後端 Python 的 \\s 同一組：U+0085、U+001F 算空白，U+FEFF 不算', () => {
    const nel = String.fromCharCode(0x85)
    const unitSeparator = String.fromCharCode(0x1f)
    const bom = String.fromCharCode(0xfeff)
    const rows = [[], [], [], [], [`大${nel}班`, 1], [`中${unitSeparator}班`, 2], [`小${bom}班`, 3], [`${bom}幼幼班`, 4], [' 總人數 ', 5]]

    const grid = extractSheet('104上', rows, 2)

    expect(grid.rows).toEqual({ '2': [null, null], '3': [null, null], '4': ['大班', 1], '5': ['中班', 2], '8': ['總人數', 5] })
  })

  it('數字字串用 Unicode 十進位數字判斷；U+FEFF 夾在數字裡不算空白也不算數字', () => {
    const bom = String.fromCharCode(0xfeff)
    const rows = [[], [], [], [], ['大班', '１２', '1.5', `1${bom}2`, '-3', '1,000', '٣']]

    expect(extractSheet('104上', rows, 7).rows['4']).toEqual(['大班', '１２', MASKED, MASKED, MASKED, MASKED, '٣'])
  })

  it('不是有限數字的數字（NaN、無限大）不能照送：JSON 會把它變成 null，改成遮住', () => {
    const rows = [[], [], ['目標人數', Number.NaN, Number.POSITIVE_INFINITY], [], ['大班', Number.NaN, Number.NEGATIVE_INFINITY]]

    const grid = extractSheet('104上', rows, 3)

    expect(grid.rows['2']).toEqual(['目標人數', MASKED, MASKED])
    expect(grid.rows['4']).toEqual(['大班', MASKED, MASKED])
    expect(JSON.parse(JSON.stringify(grid))).toEqual(grid)
  })

  it('其他型別（布林、日期、物件、undefined）當非數字：表頭與年級列都遮住或當空白', () => {
    const rows = [[], [], [true, new Date(0), {}, undefined], [], ['大班', false, new Date(0), {}, undefined]]

    const grid = extractSheet('104上', rows, 5)

    expect(grid.rows['2']).toEqual([MASKED, MASKED, MASKED, null, null])
    expect(grid.rows['4']).toEqual(['大班', MASKED, MASKED, MASKED, null])
  })

  it('不改動傳進來的列', () => {
    const rows = [[], [], ['目標人數', ' '], ['', 1], ['大班', 5, 'x']]
    const before = JSON.stringify(rows)

    extractSheet('104上', rows, 3)

    expect(JSON.stringify(rows)).toBe(before)
  })
})

describe('readHistoryWorkbook', () => {
  it('讀得到 BIFF8，表名與數字都在、備註不在', async () => {
    const grids = await readHistoryWorkbook(biff8({ '104上': termRows(62), '104下': termRows(61) }))

    expect(grids.map((g) => g.name)).toEqual(['104上', '104下'])
    expect(grids.map((g) => g.width)).toEqual([4, 4])
    expect(grids[0]!.rows['4']).toEqual(['大班', 70, 62, 0.8857])
    expect(grids[1]!.rows['4']).toEqual(['大班', 70, 61, 0.8857])
    expect(grids[0]!.rows['8']).toEqual(['總人數', null, 193, null])
    expect(grids[0]!.rows['2']).toEqual(['目標人數', null, '1150915     ', '1150915     目標\n達成率'])
    expect(Object.keys(grids[0]!.rows)).toEqual(['2', '3', '4', '5', '6', '7', '8'])
    expect(JSON.stringify(grids)).not.toContain('測試小明')
    expect(JSON.stringify(grids)).not.toContain('測試小美')
    expect(JSON.stringify(grids)).not.toContain('備註')
  })

  it('送出的資料是伺服器接受的形狀：JSON 往返不變、列長不超過 width', async () => {
    const grids = await readHistoryWorkbook(biff8({ '104上': termRows(62) }))

    expect(JSON.parse(JSON.stringify(grids))).toEqual(grids)
    for (const grid of grids) for (const row of Object.values(grid.rows)) expect(row.length).toBeLessThanOrEqual(grid.width)
  })

  it('width 取工作表有資料的最右欄；比較短的列補空白', async () => {
    const aoa = termRows(62)
    aoa[5] = ['中班', 60] // 這一列只有兩格
    aoa[7] = ['幼幼班', 40, 33, 0.825, null, null, 9] // 第 7 欄（G）有數字，width 要變成 7

    const [grid] = await readHistoryWorkbook(biff8({ '104上': aoa }))

    expect(grid!.width).toBe(7)
    expect(grid!.rows['5']).toEqual(['中班', 60, null, null, null, null, null])
    expect(grid!.rows['7']).toEqual(['幼幼班', 40, 33, 0.825, null, null, 9])
    expect(grid!.rows['2']).toEqual(['目標人數', null, '1150915     ', '1150915     目標\n達成率', null, null, null])
  })

  it('布林與錯誤值的格子不能被當成數字送出', async () => {
    const book = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([[], [], ['目標人數'], [], ['大班', true, 7, 5]])
    sheet['D5'] = { t: 'e', v: 7 } // 錯誤值 #DIV/0!，v 是錯誤碼 7
    sheet['C5'] = { t: 'b', v: true }
    XLSX.utils.book_append_sheet(book, sheet, '104上')
    const data = XLSX.write(book, { bookType: 'biff8', type: 'array' }) as ArrayBuffer

    const [grid] = await readHistoryWorkbook(data)

    expect(grid!.rows['4']).toEqual(['大班', MASKED, MASKED, MASKED])
  })

  it('也讀得到 xlsx', async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(termRows(62)), '104上')
    const data = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer

    const [grid] = await readHistoryWorkbook(data)

    expect(grid!.name).toBe('104上')
    expect(grid!.rows['4']).toEqual(['大班', 70, 62, 0.8857])
  })

  it('沒有資料的學期工作表也回傳（width 1、沒有列），讓伺服器依表名報錯', async () => {
    const grids = await readHistoryWorkbook(biff8({ '104上': termRows(62), '104下': [] }))

    expect(grids.map((g) => g.name)).toEqual(['104上', '104下'])
    expect(grids[1]).toEqual({ name: '104下', width: 1, rows: {} })
  })

  it('表名去空白後比對學期，全形數字也算（同後端 parse_term_name）', async () => {
    const grids = await readHistoryWorkbook(biff8({ ' 104 上': termRows(62), '１０５下': termRows(61) }))

    expect(grids.map((g) => g.name)).toEqual([' 104 上', '１０５下'])
  })

  it('別的 Excel 檔（像學生名單）：有不是學期的工作表就整份不收，訊息列出表名、不含格子內容', async () => {
    const roster = [['編號', '幼生姓名', '出生日期'], ['1', '測試小明', '2022/05/10'], ['2', '測試小華', '2023/03/01']]

    const error = await readHistoryWorkbook(biff8({ 工作表1: roster })).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(HistoryFileError)
    expect((error as Error).message).toBe('這個檔案有不是學期的工作表（工作表1），請確認是園方的目標執行統計表')
    for (const leaked of ['測試小明', '測試小華', '2022/05/10']) expect((error as Error).message).not.toContain(leaked)
  })

  it('學期工作表裡夾一張別的表也不收，只列出那幾張；太多張時只列前 5 張', async () => {
    const mixed = await readHistoryWorkbook(biff8({ '104上': termRows(62), 備註: [['測試小明']], '104下': termRows(61), Sheet3: [] })).catch((e: unknown) => e)
    expect((mixed as Error).message).toBe('這個檔案有不是學期的工作表（備註、Sheet3），請確認是園方的目標執行統計表')

    const many = Object.fromEntries(Array.from({ length: 7 }, (_, n) => [`Sheet${n + 1}`, [] as unknown[][]]))
    const error = await readHistoryWorkbook(biff8(many)).catch((e: unknown) => e)
    expect((error as Error).message).toBe('這個檔案有不是學期的工作表（Sheet1、Sheet2、Sheet3、Sheet4、Sheet5 等 7 張），請確認是園方的目標執行統計表')
  })

  const notExcel: [string, () => ArrayBuffer][] = [
    ['PDF', () => new TextEncoder().encode('%PDF-1.4').buffer],
    ['純文字', () => new TextEncoder().encode('大班,70,62\n').buffer],
    ['HTML 表格（像在籍清冊）', () => new TextEncoder().encode('<table><tr><td>出生日期</td></tr></table>').buffer],
    ['空檔案', () => new ArrayBuffer(0)],
    ['有 Excel 檔頭但內容壞掉', () => new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3]).buffer],
    ['有 zip 檔頭但不是 xlsx', () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]).buffer],
  ]
  it.each(notExcel)('不是 Excel 的檔案丟 HistoryFileError：%s', async (_label, make) => {
    const error = await readHistoryWorkbook(make()).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(HistoryFileError)
    expect((error as Error).message).toBe('無法讀取這個檔案，請確認是園方的目標執行統計表（.xls）')
  })
})
