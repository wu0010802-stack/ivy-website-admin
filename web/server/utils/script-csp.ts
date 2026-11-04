import { createHash } from 'node:crypto'
import { entranceBootstrap } from '../../app/utils/entrance-policy'
import { ANNI_INTRO_GATE_SCRIPT, MOTION_LAYOUT_SCRIPT } from '../../app/utils/inline-scripts'

// 公開頁 CSP 的 script-src（2026-11-04 資安強化，關閉延後已久的 shared-origin-no-script-csp）。
//
// 為什麼要有：後台與公開站同源、session cookie 是 Path=/，公開頁（含編輯看草稿的 /preview）
// 只要被注入一段腳本，就能同源呼叫後台 API。公開頁原本的 CSP 只有 frame-ancestors／base-uri／
// object-src，不限腳本。
//
// 做法：script-src 'self' 加上每支 inline script 的 sha256，不用 'unsafe-inline'。
// - 外部腳本只有同源的 /_nuxt/*（含 modulepreload）與預約表單的 Turnstile（有設 site key 才載）。
//   公開頁沒有其他外部腳本（2026-11-04 盤點正式站 8 頁：外部網址全是 <a href> 連結）。
// - SSR 送出的 inline script（Nuxt 的 importmap 與 window.__NUXT__ 設定、useHead 放的幾支）
//   由 server/plugins/security-headers.ts 在 render:html 依實際 HTML 逐支算雜湊，內容怎麼變都對得上。
// - 用戶端換頁時 head 管理器會再插入 useHead 的 script，那時沒有伺服器，所以 CLIENT_INLINE_SCRIPTS
//   的雜湊事先放進每一頁（含非 HTML 回應的預設 CSP）。新增 inline script 要加進這份清單，本文放
//   app/utils/inline-scripts.ts。
// - application/json、application/ld+json 是資料區塊，瀏覽器不執行、CSP 不管，不算雜湊。
// - 不用 'strict-dynamic'：它會讓 'self' 失效，modulepreload 與 Turnstile 都得另外帶 nonce。
// - script-src-attr 'none' 擋 onerror= 這類事件屬性（Vue 綁事件用 addEventListener，不受影響）。
//   style-src 不收：Nuxt inlineStyles 與元件的 style 屬性很多，而且 CSS 注入不能直接呼叫 API。

/** CSP 的 hash-source，例如 'sha256-…'；瀏覽器用 UTF-8 本文算。 */
export function scriptHashSource(body: string): string {
  return `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`
}

/** 用戶端換頁可能由 head 管理器插入的 inline script（本文與元件共用同一個常數）。 */
export const CLIENT_INLINE_SCRIPTS: readonly string[] = [MOTION_LAYOUT_SCRIPT, entranceBootstrap, ANNI_INTRO_GATE_SCRIPT]

// app/utils/turnstile.ts 的 TURNSTILE_SCRIPT_SRC 所在的 origin（那支檔案有 DOM 型別，server 不引用；
// 兩邊一致由 tests/script-csp.spec.ts 檢查）。
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
const TYPE_ATTR = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i
const SRC_ATTR = /(?:^|\s)src\s*=/i
const DATA_BLOCK_TYPES = new Set(['application/json', 'application/ld+json'])

/** HTML 片段裡每支會執行的 inline script（含 importmap）的 hash-source，去重、照出現順序。 */
export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>()
  for (const match of html.matchAll(SCRIPT_TAG)) {
    const attrs = match[1] ?? ''
    if (SRC_ATTR.test(attrs)) continue
    const typeMatch = TYPE_ATTR.exec(attrs)
    const type = (typeMatch?.[1] ?? typeMatch?.[2] ?? typeMatch?.[3] ?? '').trim().toLowerCase()
    if (DATA_BLOCK_TYPES.has(type)) continue
    hashes.add(scriptHashSource(match[2] ?? ''))
  }
  return [...hashes]
}

const CLIENT_HASHES = CLIENT_INLINE_SCRIPTS.map(scriptHashSource)

/** 公開頁 script-src 的來源清單：同源、Turnstile、事先登記的用戶端 inline script，再加這一頁的雜湊。 */
export function publicScriptSources(pageHashes: Iterable<string> = []): string {
  const sources = new Set(["'self'", TURNSTILE_ORIGIN, ...CLIENT_HASHES, ...pageHashes])
  return [...sources].join(' ')
}
