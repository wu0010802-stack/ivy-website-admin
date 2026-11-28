// 在 LINE 裡預約、預約當下綁 LINE（2026-11-28，docs/specs/2026-11-28-line-apis-design.md §7）的純函式。
// 瀏覽器端的載入在 app/utils/line-liff.ts，伺服器端的 CSP 在 server/utils/security-headers.ts；兩邊共用的判斷放這裡。
// 預設關：runtimeConfig.public.lineLiffId 沒設（或格式不符）就視同未設定——不載 SDK，CSP 也一字不變。

/** LIFF ID 的格式：數字-英數，例如 1234567890-AbcdEfgh。 */
const LIFF_ID_PATTERN = /^\d{6,20}-[A-Za-z0-9]{4,32}$/

export function normalizeLiffId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return LIFF_ID_PATTERN.test(id) ? id : null
}

/** 從 runtimeConfig（含 public）取 LIFF ID；格式不符一律當作沒設。config 可能是空物件（測試）。 */
export function liffIdFromConfig(config: unknown): string | null {
  const pub = (config as { public?: Record<string, unknown> } | null | undefined)?.public
  return normalizeLiffId(pub?.lineLiffId)
}

interface ManifestEntryLike { src?: string; imports?: string[]; dynamicImports?: string[] }

/**
 * 建置清單（Nuxt 的 build:manifest）裡「只有 LIFF SDK 在用」的區塊：SDK 的四個進入點，加上只被它們引用的共用區塊。
 * 這些不該出現在預約頁的 <link rel=prefetch>——只有 LINE App 內的瀏覽器才會真的 import，其他訪客不必預先下載（約 70 KB）。
 * 進入點關掉 prefetch 不會連帶關掉它的依賴（同 three 的教訓），所以要自己算：從進入點往下走到的區塊裡，
 * 被清單上任何其他區塊引用的留著，其餘才算 LIFF 專用。
 */
export function liffOnlyManifestKeys(manifest: Record<string, ManifestEntryLike>): string[] {
  const entries = Object.keys(manifest).filter(key => /(?:^|\/)node_modules\/@line\/liff\//.test(manifest[key]?.src ?? key))
  const only = new Set(entries)
  const queue = [...entries]
  while (queue.length) {
    for (const dep of manifest[queue.pop()!]?.imports ?? []) {
      if (manifest[dep] && !only.has(dep)) {
        only.add(dep)
        queue.push(dep)
      }
    }
  }
  // 反覆剔除被 LIFF 以外的區塊引用的：剔掉一個之後，它引用的也變成「被外面引用」。
  for (let changed = true; changed;) {
    changed = false
    for (const [key, entry] of Object.entries(manifest)) {
      if (only.has(key)) continue
      for (const dep of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) {
        if (only.has(dep) && !entries.includes(dep)) {
          only.delete(dep)
          changed = true
        }
      }
    }
  }
  return [...only]
}

/**
 * 網址上還帶著 LIFF 的憑證或轉址參數：LINE 把家長帶到 Endpoint URL 的那一刻（第一次轉址），access token 等在 hash、
 * 要去的路徑在 liff.state；liff.init() 完成後 SDK 才把它們從網址拿掉（或整頁轉到第二個網址）。
 * 這段時間的網址不能交給任何第三方（LINE 官方文件對 Google Analytics 之類工具的提醒）：Meta Pixel 會自己讀完整網址。
 * 不看有沒有設 LIFF ID：別人把自己的 LIFF app 指到本站時，網址一樣帶著不該外流的憑證。
 */
export function urlCarriesLiffCredentials(search: string, hash: string): boolean {
  return /(?:^|[?&])liff\.[A-Za-z_.]+=/.test(search) || /(?:^|[#&])(?:access_token|id_token|context_token|feature_token)=/.test(hash)
}

/**
 * LIFF SDK 在 LINE App 內執行 liff.init()＋liff.getIDToken() 要連的主機（connect-src）。
 * 2026-11-28 靜態分析 @line/liff 2.32.0 與 @liff/*（沒有連真的 LINE 伺服器）：
 * - @liff/server-api 的 getEndPoint 以 `https://${subdomain}.line.me/${pathname}` 拼出所有網址，init 路徑用到的只有
 *   api.line.me：`liff/v2/apps/{liffId}/contextToken`（取 LIFF 設定）、`featureToken`、`oauth2/v2.1/token`（授權碼換 token）、
 *   `oauth2/v2.1/verify`（驗證 access token）、`oauth2/v2.1/certs`（驗 ID token 簽章）。都是 fetch。
 * - getIDToken() 只讀 SDK 自己存的 token（@liff/store），不連網路。
 * - access.line.me（authorize）是整頁轉址，不受 connect-src 管；liff.line.me／liff-shortcut.line.me 只在權限詢問、
 *   子視窗、永久連結、捷徑這幾條用不到的路徑上出現，不放行。
 * - script-src 不為 LIFF 開任何來源：用的是可拆裝的 SDK（@line/liff/core＋三個模組，見 app/utils/line-liff.ts）。
 *   完整版（@line/liff）在 init 時會從 static.line-scdn.net 再載一支橋接腳本（`*-extensions_*.js`），載不到 init 就失敗
 *   （同日以正式建置＋LINE 的 User-Agent 實測：完整版那支被 CSP 擋下，核心版沒有任何被擋的請求）；
 *   完整版也帶使用量統計模組（@liff/analytics，會載 uts.js 並把資料送到 uts-front.line-apps.com），核心版沒有。
 *   預約頁有個資，不讓外站腳本進來。
 */
export const LIFF_API_ORIGIN = 'https://api.line.me'

/** 公開頁 CSP 要為 LIFF 多放行的來源；沒有 LIFF ID 時不應該呼叫（呼叫端傳 false）。 */
export function liffCspSources(): { connect: string[] } {
  return { connect: [LIFF_API_ORIGIN] }
}
