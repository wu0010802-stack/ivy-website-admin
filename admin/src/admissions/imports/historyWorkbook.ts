// 園方「目標執行統計表」（.xls）在瀏覽器擷取：規則同後端 tests/history_helpers.py browser_extract，
// 共用案例 contracts/ivy-recruitment/history-extract-cases.json。只送第 2、3 列表頭和五個標籤列
// （四個年級、總人數），其餘列（標題、寫著幼生姓名的備註）不離開瀏覽器；格子內容不明的
// （率、姓名、布林）只留位置 { masked: true }。伺服器端會再驗一次形狀（見 history 預覽端點）。
import { GRADES } from '../constants'

export type HistoryCell = null | number | string | { masked: true }

export interface HistorySheetGrid {
  name: string
  width: number
  rows: Record<string, HistoryCell[]>
}

/** 檔案不是可讀的統計表；訊息可以直接印給操作的人看（不含檔案內容）。 */
export class HistoryFileError extends Error {}

const UNREADABLE = '無法讀取這個檔案，請確認是園方的目標執行統計表（.xls）'
const BLOCK_ROW = 2 // 區塊名（舊生、新生、大班重讀生）與日期欄的表頭
const SUBHEADER_ROW = 3 // 區塊內的子欄名
const FIRST_GRADE_ROW = 4 // 往下找年級列的起點
const GRADE_LABELS: ReadonlySet<string> = new Set([...GRADES, '總人數'])
// 和 Python re.sub(r"\s+", "", s) 同一組字元（逐一比對過全部碼位）：JS 內建的 \s 多了 U+FEFF、少了 U+001C–U+001F 與 U+0085。
const WHITESPACE = /[\p{White_Space}\x1c-\x1f]+/gu
const DIGITS = /^\p{Nd}+$/u // Unicode 十進位數字，同 Python \d（全形的「８」也算）

function plain(text: string): string {
  return text.replace(WHITESPACE, '')
}

function masked(): HistoryCell {
  return { masked: true }
}

// 數字照送；NaN、無限大 JSON 化會變 null（看起來像空白），改成遮住。
function numberCell(value: number): HistoryCell {
  return Number.isFinite(value) ? value : masked()
}

/** 表頭格：空白送 null，數字與字串照原樣，其他型別遮住。 */
function headerCell(raw: unknown): HistoryCell {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return numberCell(raw)
  if (typeof raw === 'string') return plain(raw) === '' ? null : raw
  return masked()
}

/** 年級列的非標籤格：數字照送、去空白後全是數字的字串照送原字串、空白送 null、其他一律遮住。 */
function figureCell(raw: unknown): HistoryCell {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return numberCell(raw)
  if (typeof raw !== 'string') return masked()
  const text = plain(raw)
  if (text === '') return null
  return DIGITS.test(text) ? raw : masked()
}

/**
 * 一張工作表 → 要送給伺服器的格子表。rows 是試算表函式庫回傳的原始值（第 0 列起算，可以比 width 短或長），
 * 送出的每一列都剛好 width 格（短的補 null、長的截掉）。
 */
export function extractSheet(name: string, rows: readonly (readonly unknown[])[], width: number): HistorySheetGrid {
  const grid: Record<string, HistoryCell[]> = {}
  for (const row of [BLOCK_ROW, SUBHEADER_ROW]) {
    if (row < rows.length) grid[row] = Array.from({ length: width }, (_, col) => headerCell(rows[row]?.[col]))
  }
  // 年級與總人數各取第一個，五個找齊就停；第 3 列以前的標籤不算。
  const found = new Set<string>()
  for (let row = FIRST_GRADE_ROW; row < rows.length && found.size < GRADE_LABELS.size; row++) {
    const first = rows[row]?.[0]
    const label = typeof first === 'string' ? plain(first) : ''
    if (!GRADE_LABELS.has(label) || found.has(label)) continue
    found.add(label)
    grid[row] = Array.from({ length: width }, (_, col) => (col === 0 ? label : figureCell(rows[row]?.[col])))
  }
  return { name, width, rows: grid }
}

// SheetJS 不認得的格式會當成純文字、CSV 或 HTML 讀成一張只有一格的表，不會丟例外，
// 所以先認檔頭：Excel 97–2003（OLE2 複合檔）或 xlsx（zip）以外一律當作讀不了。
const SIGNATURES: readonly (readonly number[])[] = [
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  [0x50, 0x4b, 0x03, 0x04],
]

function isExcel(bytes: Uint8Array): boolean {
  return SIGNATURES.some((signature) => signature.every((byte, index) => bytes[index] === byte))
}

// 試算表格子 → extractSheet 吃的原始值：數字與字串照給，沒有格子或空格（stub）是 null；
// 布林、錯誤值、日期給一個既不是數字也不是字串的值（錯誤值的 v 是錯誤碼，不能當數字傳）。
const OTHER = Object.freeze({})

function rawCell(cell: { t: string; v?: unknown } | null | undefined): unknown {
  if (!cell || cell.t === 'z') return null
  return cell.t === 'n' || cell.t === 's' ? cell.v : OTHER
}

/**
 * 讀統計表檔案，每張工作表擷取成格子表。SheetJS 用動態 import（獨立 chunk，進匯入頁才下載）；
 * 備註與標題在這裡就丟掉，不進回傳值。讀不了（不是 Excel、檔案壞掉、沒有工作表）丟 HistoryFileError。
 */
export async function readHistoryWorkbook(data: ArrayBuffer): Promise<HistorySheetGrid[]> {
  if (!isExcel(new Uint8Array(data))) throw new HistoryFileError(UNREADABLE)
  const XLSX = await import('xlsx')
  try {
    const book = XLSX.read(data, { type: 'array', dense: true })
    if (book.SheetNames.length === 0) throw new HistoryFileError(UNREADABLE)
    return book.SheetNames.map((name) => {
      const sheet = book.Sheets[name]
      const ref = sheet?.['!ref']
      const width = ref ? XLSX.utils.decode_range(ref).e.c + 1 : 1
      const rows = Array.from(sheet?.['!data'] ?? [], (row) => (row ? Array.from(row, rawCell) : []))
      return extractSheet(name, rows, width)
    })
  } catch (error) {
    throw error instanceof HistoryFileError ? error : new HistoryFileError(UNREADABLE)
  }
}
