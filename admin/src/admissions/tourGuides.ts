// 帶參觀老師可以有多位（2026-10-06）：仍存在同一欄 tour_guide_name，用「、」串起來，不加欄位。
// 拆分規則要和後端 split_tour_guides（backend/app/admissions/constants.py）一致：
// 「、」「，」「,」「／」「/」都當分隔，去掉空白與重複，保留第一次出現的順序。

export const TOUR_GUIDE_SEPARATOR = '、'
// 後端 LEN_TOUR_GUIDE：串起來的整串不能超過 50 字。
export const TOUR_GUIDE_MAX_LENGTH = 50

const SEPARATORS = /[、，,／/]/

export function splitTourGuides(value: string | null | undefined): string[] {
  const names: string[] = []
  for (const part of (value ?? '').split(SEPARATORS)) {
    const name = part.trim()
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

export function joinTourGuides(names: readonly string[]): string | null {
  return names.length ? names.join(TOUR_GUIDE_SEPARATOR) : null
}
