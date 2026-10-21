import { h, type VNode } from 'vue'
import { ApiError } from '../../../api/client'
import { apiErrorCode } from '../../../api/errors'
import type { EnrolledPreview, HistoryPreview, ImportStatus } from '../../../api/types'
import { termLabel } from '../../../admissions/academic'
import { GRADES } from '../../../admissions/constants'
import { NO_VALUE } from '../../../admissions/statsFormat'
import { formatCount } from '../area/areaFormat'

// 資料匯入（2026-10-21 規格 §7）的固定文案與顯示格式。沒有點的原因沿用 areaFormat 的 reasonLabel。

export const NOT_IMPORTED_TEXT = '還沒有匯入'
export const DOORPLATE_CHANGED_TEXT = '門牌已換版，可以重新上傳清冊。'
export const ENROLLED_SENDS_TEXT = '只會送出地址和班別，地址比對完不保存。'
export const HISTORY_SENDS_TEXT = '只會送出表頭和各年級的數字。'
export const LOW_RATIO_TEXT = '有點的比例不到 90%，不能匯入。'
export const REMOVED_ACK_TEXT = '我知道這些學期會被刪掉'
export const NO_CHANGE_TEXT = '兩邊都有的學期，註冊人數都一樣。'

type EnrolledStatus = NonNullable<ImportStatus['enrolled']>
type HistoryStatus = NonNullable<ImportStatus['history']>
type Term = { school_year: number; semester: number }

// 比對等級：有點的兩級用地圖圖例的說法（精確／鄰近門牌），沒有點的三級同區域分析「在籍學生」的沒有點原因。
const LEVEL_LABELS: Record<string, string> = {
  exact: '精確門牌', nearby: '鄰近門牌', street: '只對到里', district: '只對到區', unlocated: '對不到',
}
export const levelLabel = (level: string): string => LEVEL_LABELS[level] ?? level

// 補區方式（後端 enrolled/locate.py RosterMatch.method）：清冊地址多半沒寫區，靠里名或街路名找區；
// 同名的里或路在好幾區都有時取離本校最近的（「推定」）。
const METHOD_LABELS: Record<string, string> = {
  written: '地址有寫區',
  village_unique: '依里名（只有一區）',
  village_nearest: '依里名（取最近的區）',
  village_mismatch: '里名對不上（取最近的區）',
  street_unique: '依街路（只有一區）',
  street_nearest: '依街路（取最近的區）',
  none: '補不到區',
}
export const methodLabel = (method: string): string => METHOD_LABELS[method] ?? method

/** 「2026-10-15」→「2026/10/15」（同區域分析的清冊日期）。 */
export const rosterDateText = (date: string): string => date.replaceAll('-', '/')

/** 「99上」 */
export const termText = (term: Term): string => termLabel(term.school_year, term.semester, 'short')

/** 「99上～115上」 */
export const termRangeText = (first: Term, last: Term): string => `${termText(first)}～${termText(last)}`

export const historyStatusRange = (history: HistoryStatus): string =>
  termRangeText(
    { school_year: history.first_school_year, semester: history.first_semester },
    { school_year: history.last_school_year, semester: history.last_semester },
  )

/** 有點的比例取到小數一位、無條件捨去：差一點點到 90% 的不會寫成「90.0%」卻不能匯入。 */
export const placedRatioText = (ratio: number): string => `${(Math.floor(ratio * 1000 + 1e-9) / 10).toFixed(1)}%`

/** 「幼幼班 4、小班 5」：後端已依固定順序、只放大於 0 的。 */
export function countsText(counts: Record<string, number>, label: (key: string) => string = (key) => key): string {
  const parts = Object.entries(counts).map(([key, count]) => `${label(key)} ${formatCount(count)}`)
  return parts.length ? parts.join('、') : NO_VALUE
}

/** 「目前：2026/09/15・190 位 → 新的：2026/10/15・20 位」；這校還沒匯入過就寫「目前：還沒有匯入」。 */
export function enrolledCompareText(current: EnrolledStatus | null, preview: EnrolledPreview): string {
  const before = current ? `${rosterDateText(current.roster_date)}・${formatCount(current.total)} 位` : NOT_IMPORTED_TEXT
  return `目前：${before} → 新的：${rosterDateText(preview.roster_date)}・${formatCount(preview.total)} 位`
}

/** 「目前：99上～114下・128 列 → 新的：114下～115上・8 列」 */
export function historyCompareText(current: HistoryStatus | null, preview: HistoryPreview): string {
  const before = current ? `${historyStatusRange(current)}・${formatCount(current.rows)} 列` : NOT_IMPORTED_TEXT
  return `目前：${before} → 新的：${termRangeText(preview.first, preview.last)}・${formatCount(preview.rows)} 列`
}

/** 「114下 大班：50 → 52 位」 */
export const changeText = (change: HistoryPreview['changed'][number]): string =>
  `${termText(change)} ${change.grade}：${formatCount(change.before)} → ${formatCount(change.after)} 位`

export interface HistoryTermRow {
  key: string
  term: string
  counts: (number | null)[] // GRADES 順序
  total: number
}

/** 學期 × 年級的註冊人數表（依學期排序，欄位照 GRADES）；某個年級沒有那一列就是 null。 */
export function historyTable(rows: HistoryPreview['payload']['rows']): HistoryTermRow[] {
  const terms = new Map<string, { term: Term; counts: Map<string, number> }>()
  for (const row of rows) {
    const key = `${row.school_year}-${row.semester}`
    const entry = terms.get(key) ?? { term: { school_year: row.school_year, semester: row.semester }, counts: new Map() }
    entry.counts.set(row.grade, row.registered)
    terms.set(key, entry)
  }
  return [...terms.entries()]
    .sort(([, a], [, b]) => a.term.school_year - b.term.school_year || a.term.semester - b.term.semester)
    .map(([key, { term, counts }]) => ({
      key,
      term: termText(term),
      counts: GRADES.map((grade) => counts.get(grade) ?? null),
      total: [...counts.values()].reduce((sum, value) => sum + value, 0),
    }))
}

/** 統計表看不懂（HISTORY_WORKBOOK_INVALID）時伺服器附上的遮罩表頭：不在 OpenAPI 型別裡，這裡自己宣告。 */
export interface WorkbookHeader {
  name: string
  row2: string[]
  row3: string[]
  labels: string[]
}

const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

export function workbookHeaders(err: unknown): WorkbookHeader[] {
  if (!(err instanceof ApiError) || apiErrorCode(err) !== 'HISTORY_WORKBOOK_INVALID') return []
  const headers = (err.detail as { headers?: unknown }).headers
  if (!Array.isArray(headers)) return []
  return headers.filter((item): item is WorkbookHeader =>
    Boolean(item) && typeof item === 'object' && typeof item.name === 'string' && stringList(item.row2) && stringList(item.row3) && stringList(item.labels))
}

/** 遮罩表頭整段文字（可以直接複製給開發者核對）：每張表四行，表與表之間空一行。 */
export function workbookHeadersText(headers: WorkbookHeader[]): string {
  return headers
    .map((sheet) => [
      `表名：${sheet.name}`,
      `第 2 列：${sheet.row2.join(' | ')}`,
      `第 3 列：${sheet.row3.join(' | ')}`,
      `第 0 欄：${sheet.labels.join(' | ')}`,
    ].join('\n'))
    .join('\n\n')
}

/** 確認匯入回 409（門牌換版）或校區不符：手上的預覽已經不能用，清掉讓使用者重新預覽。 */
export function isStalePreview(err: unknown): boolean {
  return (err instanceof ApiError && err.status === 409) || apiErrorCode(err) === 'CAMPUS_MISMATCH'
}

/** 確認對話框的內文：大字「匯入到：〇〇」，下面一句一行。對話框掛在 body 底下，元件的 scoped 樣式管不到，字級寫在行內。 */
export function importConfirmMessage(target: string, lines: string[]): VNode {
  return h('div', [
    h('p', { style: 'margin: 0 0 8px; color: var(--ink); font-size: var(--text-2xl); font-weight: 700' }, target),
    ...lines.map((line) => h('p', { style: 'margin: 0 0 4px' }, line)),
  ])
}
