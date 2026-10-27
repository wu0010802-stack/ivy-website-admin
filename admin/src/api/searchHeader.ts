// 搜尋字常是家長電話、孩子或介紹人的姓名：不放網址，改放 X-Ivy-Search header（2026-10-22 資安稽核，
// 後端 common/search_header.py）。網址上的查詢字串可能留在官網 web 服務那一層的 HTTP 紀錄裡，header 不會。
// header 只能放 Latin-1，所以 JSON 先百分比編碼。
export const SEARCH_HEADER = 'X-Ivy-Search'

/** 有值的欄位才送（空字串、空陣列當沒值）；全部沒值就不帶 header。陣列給操作紀錄的多個搜尋詞用。 */
export function searchHeaders(fields: Record<string, string | string[] | null | undefined>): Record<string, string> {
  const picked = Object.fromEntries(Object.entries(fields).filter(([, value]) =>
    Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value !== ''))
  return Object.keys(picked).length ? { [SEARCH_HEADER]: encodeURIComponent(JSON.stringify(picked)) } : {}
}

// 參觀案件列表的搜尋字記在這一筆瀏覽歷程的 state（不進網址）：點進案件再返回、重新整理都還在，
// 案件頁的「下一筆」也從這裡拿。
export const LIST_SEARCH_STATE = 'listSearch'

export function historySearch(state: unknown): string {
  const value = state && typeof state === 'object' ? (state as Record<string, unknown>)[LIST_SEARCH_STATE] : undefined
  return typeof value === 'string' ? value : ''
}
