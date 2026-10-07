// 即時預覽的「改哪格亮哪格」（2026-10-06 方向 D）：比較上一次送出的表單與這一次，找出改到的
// 最外層欄位，以及裡面改到的那段文字（清單、物件往裡找）。預覽頁拿這段文字找位置框起來。

/** 送給預覽頁找位置的文字最多幾個字（以碼點算；官網收到後最多留 80）。 */
export const PROBE_LENGTH = 40
const MAX_DEPTH = 6

export interface LastEdit {
  /** 改到的最外層欄位 */
  key: string
  /** 改到的那段文字；改的不是文字（圖片、焦點、數字）時是 null */
  text: string | null
}

const hasOwn = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key)

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function changedText(before: unknown, after: unknown, depth: number): string | null {
  if (typeof after === 'string') return after
  if (depth >= MAX_DEPTH || after === null || typeof after !== 'object') return null
  const previous = before !== null && typeof before === 'object' ? (before as Record<string, unknown>) : {}
  const entries: [string, unknown][] = Array.isArray(after) ? after.map((value, index) => [String(index), value]) : Object.entries(after)
  for (const [key, value] of entries) {
    if (same(previous[key], value)) continue
    const text = changedText(previous[key], value, depth + 1)
    if (text !== null) return text
  }
  return null
}

export function lastEdit(before: Record<string, unknown> | null, after: Record<string, unknown>): LastEdit | null {
  if (!before) return null
  for (const key of Object.keys(after)) {
    if (!same(before[key], after[key])) return { key, text: changedText(before[key], after[key], 1) }
  }
  for (const key of Object.keys(before)) {
    if (!hasOwn(after, key)) return { key, text: null }
  }
  return null
}

/** 第一個至少兩個字的行，壓掉多餘空白，最多 PROBE_LENGTH 個字（以碼點算，不把 emoji 切成半個）。 */
export function probeText(text: string): string | null {
  const line = text
    .split('\n')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .find((part) => part.length >= 2)
  // 先限在最多佔的 UTF-16 單位數，免得為很長的字串配大陣列。
  return line ? Array.from(line.slice(0, PROBE_LENGTH * 2)).slice(0, PROBE_LENGTH).join('') : null
}
