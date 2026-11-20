import { isSearchHost } from './engagement-source'

// 找不到的網址（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md §4）：訪客看到 404 時回報路徑與「從哪裡來」，
// 看舊網站（Wix）的連結落在哪些不存在的網址、要補哪些轉址。只送路徑（不含 ?query 與 #），不送來源網址。
// 規則要和後端 backend/app/operations/analytics_more_routes.py 的 NotFoundIn 一致。

export const NOT_FOUND_REFS = ['none', 'internal', 'search', 'external'] as const
export type NotFoundRef = (typeof NOT_FOUND_REFS)[number]
export type NotFoundEvent = { event: 'not_found'; path: string; ref: NotFoundRef }
export const NOT_FOUND_PATH_MAX = 160
const BAD_CHARS = /[\u0000-\u001f\u007f?#]/

/** 網址列的路徑 → 要記的路徑：解碼、小寫、去掉結尾斜線、截到上限。解不開或有控制字元回 null。 */
export function notFoundPath(pathname: string): string | null {
  let path = pathname
  try { path = decodeURIComponent(pathname) } catch { return null }
  if (!path.startsWith('/') || BAD_CHARS.test(path)) return null
  path = path.replace(/\/+$/, '') || '/'
  return [...path.toLowerCase()].slice(0, NOT_FOUND_PATH_MAX).join('')
}

/** 從哪裡來：沒有來源網址、站內、搜尋引擎、其他網站。 */
export function notFoundRef(referrer: string, origin: string): NotFoundRef {
  if (!referrer) return 'none'
  let url: URL
  try { url = new URL(referrer) } catch { return 'none' }
  if (url.origin === origin) return 'internal'
  return isSearchHost(url.hostname) ? 'search' : 'external'
}

export function validateNotFound(input: unknown): NotFoundEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const item = input as Record<string, unknown>
  if (item.event !== 'not_found' || Object.keys(item).some((key) => !['event', 'path', 'ref'].includes(key))) return null
  if (typeof item.path !== 'string' || !item.path.startsWith('/') || BAD_CHARS.test(item.path) || [...item.path].length > NOT_FOUND_PATH_MAX) return null
  if (!NOT_FOUND_REFS.some((ref) => ref === item.ref)) return null
  return item as NotFoundEvent
}
