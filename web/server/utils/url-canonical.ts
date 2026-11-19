import { isValidHostHeader } from './admin-host'

// 頁面網址只留一種寫法（2026-11-12 QA L27／L4／L5）。
//
// 以前 /about/、/About、//about 都回 200 同一頁：頁首收不起來、選單沒有 aria-current，也是重複內容；
// ///admin/ 還會被靜態處理器當成後台入口送出，套的卻是公開頁的 CSP、沒有 no-store／noindex。
// 這裡把這些寫法 301 成唯一的正規寫法；Host 標頭格式錯誤（連接埠不是數字…）則在最前面直接回 400，
// 不讓請求進 SSR 才在組網址時丟例外、變成 500。
//
// 套用的地方是 server/plugins/url-canonical.ts：要排在 nitro 靜態資源處理器之前
// （/admin/ 入口是 public/admin/index.html，server/middleware 攔不到，見 utils/static-video.ts 的 installFirst）。
//
// 正規寫法（只對頁面，GET／HEAD）：
// (a) 連續斜線收成一個；
// (b) 去掉尾斜線，但 / 與 /admin/ 本身保留（/admin/ 是後台 SPA 的入口）；/admin/ 底下其他路徑的尾斜線不動；
// (c) 第一段轉小寫，只在轉完是已知頁面時才轉；後面的段落（消息 id、校區代碼）不動。
// 查詢字串原樣保留。API、建置產物、靜態資源（/api、/_nuxt、/assets、/__nuxt…）和帶副檔名的路徑完全不碰。

// 第一段是這些才算頁面。新增頁面路由時要補（tests/url-canonical.spec.ts 有跟 app/pages 對照的測試）。
export const PAGE_ROOTS: ReadonlySet<string> = new Set([
  'about', 'curriculum', 'environment', 'admission', 'news', 'visit', 'privacy', 'anniversary', 'preview', 'admin'
])

// Location 只組站內路徑：可見 ASCII，不含空白與反斜線。反斜線在瀏覽器裡等於斜線，
// /\evil.com 當成 Location 會被解讀成 //evil.com（開放轉址）；非 ASCII 字元放進標頭也會讓 Node 丟例外。
const SAFE_URL = /^[\x21-\x5b\x5d-\x7e]+$/
const HAS_EXTENSION = /\.[a-z0-9]{1,8}$/i

/** 第一段（可能是百分比編碼）對應到的頁面名；不是頁面回 null。 */
function pageRoot(segment: string): string | null {
  let value = segment
  if (value.includes('%')) {
    try {
      value = decodeURIComponent(value)
    } catch {
      return null
    }
  }
  // 只收純 ASCII 字母：避免 Unicode 的大小寫對應（例如 Kelvin 符號）湊出頁面名。
  if (!/^[A-Za-z]+$/.test(value)) return null
  const lower = value.toLowerCase()
  return PAGE_ROOTS.has(lower) ? lower : null
}

/**
 * url 是 path＋query（event.path）。要轉址就回正規寫法（站內路徑，含原本的查詢字串）；
 * 已經是正規寫法、不是頁面、不是 GET／HEAD，或網址含不安全字元就回 null。
 */
export function canonicalPageLocation(url: string, method: string): string | null {
  const verb = method.toUpperCase()
  if (verb !== 'GET' && verb !== 'HEAD') return null
  if (!url.startsWith('/') || !SAFE_URL.test(url)) return null

  const queryAt = url.indexOf('?')
  const pathname = queryAt === -1 ? url : url.slice(0, queryAt)
  const query = queryAt === -1 ? '' : url.slice(queryAt)
  const collapsed = pathname.replace(/\/{2,}/g, '/')

  // 只有斜線：//、/// → /
  if (collapsed === '/') return pathname === '/' ? null : `/${query}`

  const rest = collapsed.slice(1)
  const slashAt = rest.indexOf('/')
  const first = slashAt === -1 ? rest : rest.slice(0, slashAt)
  const tail = slashAt === -1 ? '' : rest.slice(slashAt)
  const root = pageRoot(first)
  if (!root) return null
  // 帶副檔名的是檔案（/admin/assets/x.js、/admin/sw.js…），不是頁面。
  if (HAS_EXTENSION.test(collapsed.slice(collapsed.lastIndexOf('/') + 1))) return null

  const canonical = `/${root}${root === 'admin' ? tail : tail.replace(/\/$/, '')}`
  return canonical === pathname ? null : `${canonical}${query}`
}

export type UrlCanonicalDecision =
  | { action: 'pass' }
  | { action: 'bad-host' }
  | { action: 'redirect'; location: string }

/** Host 先驗（格式錯誤 → 400），再看網址要不要轉成正規寫法。 */
export function decideUrlCanonical(input: { host: string | undefined; method: string; url: string }): UrlCanonicalDecision {
  if (!isValidHostHeader(input.host)) return { action: 'bad-host' }
  const location = canonicalPageLocation(input.url, input.method)
  return location === null ? { action: 'pass' } : { action: 'redirect', location }
}
