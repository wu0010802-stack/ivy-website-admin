// 後台前端組 CSV 的共用工具（2026-10-03 匯出擴充）。給園方用 Excel 直接開：開頭 BOM、
// 中文欄名、CRLF。公式注入防護和後端 backend/app/common/csv_export.py 的 safe_cell 是
// 同一條規則，改一邊另一邊一起改。含個資的名單一律由後端產生（downloadServerCsv），
// 這裡自己組的只有畫面上已經有的去識別資料與操作紀錄。
import { api } from '../api/client'

export const CSV_BOM = '﻿'

export type CsvCell = string | number | boolean | null | undefined

const FORMULA_STARTS = new Set(['=', '+', '-', '@'])
// 試算表會先略過開頭的空白與控制字元再判斷是不是公式（同後端 isspace／isprintable）。
const LEADING_SPACE_OR_CONTROL = /^[\s\p{C}]/u

export function safeCell(value: CsvCell): string {
  if (value === null || value === undefined) return ''
  // 數字是我們自己算的計數與比率，負數也不是公式，照寫。
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? '是' : '否'
  const text = String(value)
  if (!text) return ''
  if (LEADING_SPACE_OR_CONTROL.test(text) || FORMULA_STARTS.has(text.trimStart().charAt(0))) return `'${text}`
  return text
}

function quote(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function buildCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header, ...rows].map((row) => row.map((cell) => quote(safeCell(cell))).join(','))
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`
}

/** fetch 的 response.text() 會吃掉開頭的 BOM（後端有加），存檔前補回來，Excel 才認得 UTF-8。 */
export function withBom(text: string): string {
  return text.startsWith(CSV_BOM) ? text : `${CSV_BOM}${text}`
}

const ROC_MONTH = /^(\d{1,3})\.(\d{1,2})$/

/** 園務的民國月份「115.09」在 CSV 寫成「115年09月」：Excel 會把 115.10 當數字轉成 115.1，月份就錯了。
 *  只改匯出，畫面仍是「115.09」；不是「年.月」格式的（例如「未填寫」）原樣不動。 */
export function rocMonthCsv(value: string | null | undefined): string {
  const text = value ?? ''
  const match = ROC_MONTH.exec(text)
  return match ? `${match[1]}年${match[2]!.padStart(2, '0')}月` : text
}

const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|\p{Cc}]+/gu

export function csvFilename(...parts: (string | null | undefined)[]): string {
  const name = parts
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .map((part) => part.replace(UNSAFE_FILENAME_CHARS, '_'))
    .join('-')
  return `${name || 'export'}.csv`
}

export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([withBom(csv)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 等瀏覽器接手下載再釋放；同步 revoke 在 Safari 會下載失敗。
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 後端產生的 CSV（含個資的名單）：用 API 讀成文字再存檔，403／422 才能寫成中文提示，
 *  不會像 window.open 那樣在新分頁露出 JSON。錯誤原樣丟給呼叫端。 */
export async function downloadServerCsv(path: string, filename: string): Promise<void> {
  const text = await api.get<string>(path)
  downloadCsv(filename, typeof text === 'string' ? text : '')
}
