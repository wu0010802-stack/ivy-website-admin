// 在 LINE 裡預約，預約當下綁 LINE（2026-11-28，docs/specs/2026-11-28-line-apis-design.md §7.2）。
// 只在瀏覽器執行：SDK 載入時就會碰 window，所以只在「有設 LIFF ID」而且「User-Agent 是 LINE App 內的瀏覽器」時
// 才動態 import，不進任何頁面的 chunk、不在伺服器載入。其他瀏覽器完全不載。
// 用可拆裝的 SDK（@line/liff/core＋用到的三個模組），不用完整版（@line/liff）：完整版在 liff.init() 時會再從 LINE 的 CDN
// 載一支橋接腳本（static.line-scdn.net/liff/edge/2/*-extensions_*.js，掃碼、藍牙那類舊功能用），載不到 init 就直接失敗；
// 公開頁的 CSP 不放行外站腳本（2026-11-28 以正式建置實測：完整版那支腳本被擋）。完整版也帶 LINE 的使用量統計模組。
// 核心版兩者都沒有，CSP 的 script-src 不用為 LIFF 開任何來源。
// 任何錯誤都吞掉、當作「不可用」，預約流程照舊。ID token 只在送單當下取出、跟著送單送到自己的 API，
// 不寫進任何儲存空間、統計或錯誤回報。
import { normalizeLiffId, urlCarriesLiffCredentials } from '#shared/line-liff'

export { normalizeLiffId }

/**
 * 等網址上沒有 LIFF 的憑證才執行 run（第三方統計用，見 shared/line-liff.ts 的 urlCarriesLiffCredentials）。
 * 現在就乾淨：立刻同步執行，run(false)。帶著憑證：每 200ms 看一次，乾淨了才 run(true)；
 * 等到 timeoutMs 還沒乾淨（LIFF 初始化失敗）就不執行——這一頁不啟動第三方統計，比把憑證送出去好。
 */
export function whenUrlHasNoLiffCredentials(
  win: Pick<Window, 'location' | 'setInterval' | 'clearInterval'>,
  run: (waited: boolean) => void,
  { intervalMs = 200, timeoutMs = 20_000 }: { intervalMs?: number; timeoutMs?: number } = {}
): void {
  const carries = () => urlCarriesLiffCredentials(win.location.search, win.location.hash)
  if (!carries()) return run(false)
  let waitedMs = 0
  const timer = win.setInterval(() => {
    waitedMs += intervalMs
    if (!carries()) {
      win.clearInterval(timer)
      run(true)
    } else if (waitedMs >= timeoutMs) {
      win.clearInterval(timer)
    }
  }, intervalMs)
}

/** LINE App 內建瀏覽器的 User-Agent 含 `Line/<版本>`。 */
export function inLineApp(userAgent: string | null | undefined): boolean {
  return typeof userAgent === 'string' && /\bLine\//.test(userAgent)
}

/** 送單回應的 line_notify（預約當下用 LIFF 綁了 LINE 才有）。 */
export interface LineNotifyInit {
  linked: boolean
  friend: boolean | null
  account_name: string | null
  add_friend_url: string | null
}

interface LiffSdk {
  init: (config: { liffId: string }) => Promise<void>
  isInClient: () => boolean
  isLoggedIn: () => boolean
  getIDToken: () => string | null
}

let sdk: LiffSdk | null = null
let ready: Promise<boolean> | null = null

/**
 * 載入並初始化 LIFF；回傳「可用」與否（在 LINE App 內而且已登入）。同一頁只初始化一次，重複呼叫共用同一個 Promise。
 * liffId 是 runtimeConfig.public.lineLiffId（格式不符視同沒設）。
 */
export function loadLiff(liffId: unknown, userAgent: string | null | undefined): Promise<boolean> {
  if (ready) return ready
  const id = normalizeLiffId(liffId)
  if (!id || !inLineApp(userAgent)) return Promise.resolve(false)
  ready = (async () => {
    try {
      const [core, inClient, loggedIn, idToken] = await Promise.all([
        import('@line/liff/core'),
        import('@line/liff/is-in-client'),
        import('@line/liff/is-logged-in'),
        import('@line/liff/get-id-token')
      ])
      const liff = core.default
      liff.use(new inClient.default())
      liff.use(new loggedIn.default())
      liff.use(new idToken.default())
      await liff.init({ liffId: id })
      if (!(liff.isInClient() && liff.isLoggedIn())) return false
      sdk = liff as unknown as LiffSdk
      return true
    } catch {
      sdk = null
      return false
    }
  })()
  return ready
}

/** 送單當下呼叫：可用時回 LIFF 的 ID token，否則 null。 */
export function getLiffIdToken(): string | null {
  if (!sdk) return null
  try {
    const token = sdk.getIDToken()
    return typeof token === 'string' && token ? token : null
  } catch {
    return null
  }
}

/**
 * liff.init() 完成後，瀏覽器網址和 Nuxt 目前路由不同（LIFF 第二次轉址沒有整頁重新載入時）要對齊；
 * 回傳該換成的路徑（路徑＋查詢＋路由的 hash），不用換回 null。LIFF 加的 liff.* 查詢參數（liff.state、liff.referrer…）一律丟掉。
 */
export function liffAlignedPath(
  location: { pathname: string; search: string },
  route: { fullPath: string; hash?: string }
): string | null {
  const kept = new URLSearchParams()
  for (const [key, value] of new URLSearchParams(location.search)) {
    if (!key.startsWith('liff.')) kept.append(key, value)
  }
  const query = kept.toString()
  const target = `${location.pathname}${query ? `?${query}` : ''}`
  const hash = route.hash ?? ''
  const current = hash && route.fullPath.endsWith(hash) ? route.fullPath.slice(0, -hash.length) : route.fullPath
  return target === current ? null : `${target}${hash}`
}

/** 測試用：清掉模組內的狀態。 */
export function resetLiffForTests() {
  sdk = null
  ready = null
}
