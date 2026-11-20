// 頁首「使用小技巧」從哪一頁點，就先打開那一頁相關的分類（2026-11-20）。
// 單獨一個小檔：頁首每一頁都會載入，不能為了這張對照表把 tips.ts 的全部內容拉進主程式。
// 對不到的頁面（總覽、系統類）回 null，打開全部。

import type { TipSectionKey } from './tips'

const PREFIXES: [string, TipSectionKey][] = [
  ['/visit-requests', 'visits'],
  ['/visit-calendar', 'sessions'],
  ['/admissions', 'admissions'],
  ['/admissions-stats', 'admissions'],
  ['/content/', 'content'],
  ['/media', 'content'],
  ['/releases', 'content'],
  ['/users', 'account'],
  ['/account', 'account'],
]

export function tipSectionForPath(path: string): TipSectionKey | null {
  for (const [prefix, section] of PREFIXES) {
    if (prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`)) return section
  }
  return null
}
