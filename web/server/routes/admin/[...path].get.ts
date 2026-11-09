import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// 後台根目錄底下檔名固定的檔案（建置時由 Vite 從 admin/public 複製）：加到主畫面的 manifest、只處理推播的
// Service worker、PWA 圖示。這些檔案存在時由 Nitro 的靜態資源處理器直接回，到不了這裡；到得了這裡就是
// 檔案不見了（例如後台建置漏檔），必須回 404。回 index.html（200）的話，瀏覽器會把一份 HTML 當成
// Service worker 或 manifest 來註冊／解析，之後每次重新驗證都更難查（2026-11-05）。
const ADMIN_STATIC_FILE = /^\/admin\/(?:sw\.js|manifest\.webmanifest|pwa-[\w-]+\.png)$/

// nitro 的靜態資源處理器先 decodePath 再找檔（/admin/%73w.js 也會找到 sw.js），這裡同樣解碼再比對；
// 不合法的編碼就用原字串（不會比對成功，照舊走 index.html）。
function adminPathname(path: string): string {
  const pathname = path.split('?')[0] ?? ''
  try {
    return decodeURI(pathname)
  } catch {
    return pathname
  }
}

// Existing assets are served by Nitro. History routes use the separately built
// admin entry point; missing assets must remain 404 instead of receiving HTML.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  if (!config.adminDistDir || event.path.startsWith('/admin/assets/') || ADMIN_STATIC_FILE.test(adminPathname(event.path))) {
    throw createError({ statusCode: 404 })
  }
  let html: string
  try {
    html = await readFile(join(config.adminDistDir, 'index.html'), 'utf8')
  } catch {
    throw createError({ statusCode: 503, statusMessage: '後台服務尚未就緒' })
  }
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  return html
})
