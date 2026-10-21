import { notifyError } from '../composables/notify'

// 頁面改成點進去才下載之後，部署會換掉舊的檔名：一直開著後台的人換頁會遇到
// 「Failed to fetch dynamically imported module」。整頁重新載入要去的網址，拿到
// 新版就好；同一個網址 10 秒內只重載一次，真的斷線時不會無限重整。頁面附帶的樣式檔
// 載入失敗時 Vite 丟的是「Unable to preload CSS for …」，一樣處理。
const CHUNK_LOAD_ERROR = /dynamically imported module|Importing a module script failed|Unable to preload CSS/i
const CHUNK_RELOAD_KEY = 'ivy-admin-chunk-reload'

/** 動態 import 的 chunk 載不到（多半是部署換了檔名）；頁面以外的動態 import（例如 SheetJS）也用它判斷。 */
export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_LOAD_ERROR.test(error.message)
}

export function reloadAfterChunkError(
  error: unknown,
  href: string,
  navigate: (href: string) => void = url => window.location.assign(url),
): boolean {
  if (!isChunkLoadError(error)) return false
  let reloadedJustNow: boolean
  try {
    const last = JSON.parse(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 'null') as { href?: string; at?: number } | null
    reloadedJustNow = last?.href === href && Date.now() - (last.at ?? 0) < 10_000
    if (!reloadedJustNow) sessionStorage.setItem(CHUNK_RELOAD_KEY, JSON.stringify({ href, at: Date.now() }))
  } catch {
    // 記不住有沒有重載過（私密視窗、封鎖網站資料）：當成剛重載過，不冒無限重整的險。
    reloadedJustNow = true
  }
  if (reloadedJustNow) {
    notifyError('頁面沒有載入成功，請確認網路後重新整理這一頁', { duration: 0 })
    return true
  }
  navigate(href)
  return true
}
