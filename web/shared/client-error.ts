// 官網與後台的前端錯誤回報（2026-11-05）：驗證、遮蔽、忽略規則與「每頁最多五筆、同一個只送一次」。
//
// 瀏覽器 → Nitro POST /api/client-errors → FastAPI POST /public/client-errors（backend/app/operations/error_reports.py
// 存成分組的 error_groups，總管理者在後台「系統狀態」看）。不存 IP、cookie、帳號，也不存 query string 與 hash：
// 訊息、堆疊、頁面路徑送出前先遮蔽一次（這裡），API 收到後再遮一次（不信任呼叫端）。兩邊的規則要一致，
// 見 backend/tests/test_error_reports.py 與 web/tests/client-error.spec.ts。
//
// 刻意不用 lookbehind：iOS Safari 16.4 以前遇到含 lookbehind 的正規式會在載入整份 script 時就丟 SyntaxError。

export type ClientErrorSource = 'web' | 'admin'

export interface ClientErrorReport {
  source: ClientErrorSource
  kind: string
  message: string
  stack?: string
  path: string
  release?: string
}

export const CLIENT_ERROR_LIMITS = { kind: 120, message: 500, stack: 6000, path: 300, release: 64 } as const
/** 每次頁面載入最多送幾筆。 */
export const CLIENT_ERROR_MAX_PER_PAGE = 5

const REPORT_KEYS = ['source', 'kind', 'message', 'stack', 'path', 'release']

/** Nitro 與 FastAPI 都用這份白名單驗：只收這幾個欄位，其他（含 IP、cookie、帳號之類）一律拒絕。 */
export function validateClientError(input: unknown): ClientErrorReport | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const item = input as Record<string, unknown>
  if (Object.keys(item).some((key) => !REPORT_KEYS.includes(key))) return null
  if (item.source !== 'web' && item.source !== 'admin') return null
  if (typeof item.kind !== 'string' || item.kind.length < 1 || item.kind.length > CLIENT_ERROR_LIMITS.kind) return null
  if (typeof item.message !== 'string' || item.message.length > CLIENT_ERROR_LIMITS.message) return null
  if (item.stack !== undefined && (typeof item.stack !== 'string' || item.stack.length > CLIENT_ERROR_LIMITS.stack)) return null
  if (typeof item.path !== 'string' || item.path.length > CLIENT_ERROR_LIMITS.path || !item.path.startsWith('/')) return null
  if (item.release !== undefined && (typeof item.release !== 'string' || item.release.length > CLIENT_ERROR_LIMITS.release)) return null
  return item as unknown as ClientErrorReport
}

// ----------------------------------------------------------------------------- 遮蔽

// 網址後面的 ?query 與 #hash 整段拿掉，保留堆疊 frame 的「:行:列」。先處理完整網址（含 // 開頭），再處理站內路徑
// （/ 開頭，前面不能是字元、斜線、點、冒號、減號，免得把 https://host/x 的後半段誤當路徑）。
//
// 結果等同依序套這兩條正規式（2026-11-26 以前就是用它們），換成「網址＋尾巴的 :行:列」：
//   完整網址 /((?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/[^\s'"<>()?#]+)[?#][^\s'"<>()]*?((?::\d+){0,2})(?=[\s'"<>)\]]|$)/g
//   站內路徑 /(^|[^\w/.:-])(\/[^\s'"<>()?#:]+)[?#][^\s'"<>()]*?((?::\d+){0,2})(?=[\s'"<>)\]]|$)/g
// 但它們每個起點都先吃到結尾再回溯，一長串 / 或 //a? 就是 O(n²)。改成逐段往前掃一次（作法同 error_reports.py）：
// 比對只會落在「不含空白、引號、<>、()」的同一個連續串裡，串裡以每個 ? 或 # 為界，它前面那段有網址，就把 ? 起
// 到收尾處拿掉、只留尾巴的「:行:列」。收尾處是下一個 ]，或串的結尾（串後面接的是 ( 就不算）。
// 從哪個字開始比對只影響「網址」那段，而那段原樣保留，所以只要知道有沒有。web/tests/redactregex-bugfix-20261126.spec.ts
// 拿舊正規式逐一比對。
const URL_RUN = /[^\s'"<>()]+/g
const PATH_PREFIX = /[\w/.:-]/
const FRAME_POSITION = /(?::\d+){0,2}$/
const USERINFO = /(\/\/)[^\s/@]+@/g
// Email 等同 /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g，理由同上（一長串英數字沒有 @ 也是 O(n²)）：
// 先切出由這些字元與 @ 組成的連續串，串裡每個 @ 前面到上一次比對結束（或串頭）整段都是本地部分，接得上網域就整段換掉。
const EMAIL_RUN = /[A-Za-z0-9._%+@-]+/g
const EMAIL_DOMAIN = /[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/y
const TW_ID = /(^|[^A-Za-z0-9])[A-Za-z][12]\d{8}(?!\d)/g
const LONG_DIGITS = /[0-9](?:[ -]?[0-9]){6,}/g
const TOKEN = /[A-Za-z0-9_-]{20,}/g

type UrlBefore = (run: string, start: number, mark: number) => boolean

/** 完整網址：// 後面在 ? 之前至少還有一個字；前面有沒有 scheme 都一樣。 */
const hasAbsoluteUrl: UrlBefore = (run, start, mark) => {
  const slashes = run.slice(start, mark).indexOf('//')
  return slashes >= 0 && start + slashes + 2 < mark
}

/** 站內路徑：/ 到 ? 之間不能有冒號，/ 前一個字不能是字元、斜線、點、冒號、減號（串頭前面一定是分隔字元）。 */
const hasRelativeUrl: UrlBefore = (run, start, mark) => {
  const segment = run.slice(start, mark)
  for (let slash = segment.indexOf('/', segment.lastIndexOf(':') + 1); slash >= 0 && slash < segment.length - 1; slash = segment.indexOf('/', slash + 1)) {
    if (start + slash === 0 || !PATH_PREFIX.test(run[start + slash - 1]!)) return true
  }
  return false
}

/** 一個連續串裡的 query／hash；closed：串後面不是「(」。下一個 ?、#、] 的位置各自記著往前推，整串只掃一次。 */
function stripRunQueries(run: string, closed: boolean, hasUrl: UrlBefore): string {
  let result = ''
  let cursor = 0
  let question = run.indexOf('?')
  let hash = run.indexOf('#')
  let bracket = run.indexOf(']')
  for (;;) {
    if (question >= 0 && question < cursor) question = run.indexOf('?', cursor)
    if (hash >= 0 && hash < cursor) hash = run.indexOf('#', cursor)
    if (question < 0 && hash < 0) break
    const mark = hash < 0 || (question >= 0 && question < hash) ? question : hash
    if (bracket >= 0 && bracket <= mark) bracket = run.indexOf(']', mark + 1)
    const end = bracket >= 0 ? bracket : closed ? run.length : -1
    if (end < 0) break // 後面沒有能收尾的地方，之後的 ? 也一樣
    if (hasUrl(run, cursor, mark)) {
      result += run.slice(cursor, mark) + FRAME_POSITION.exec(run.slice(mark + 1, end))![0]
      cursor = end
    } else {
      result += run.slice(cursor, mark + 1)
      cursor = mark + 1
    }
  }
  return result + run.slice(cursor)
}

function stripUrlQueries(text: string, hasUrl: UrlBefore): string {
  if (!text.includes('?') && !text.includes('#')) return text
  return text.replace(URL_RUN, (run: string, offset: number) =>
    run.includes('?') || run.includes('#') ? stripRunQueries(run, text[offset + run.length] !== '(', hasUrl) : run)
}

function redactRunEmails(run: string): string {
  let at = run.indexOf('@')
  if (at < 0) return run
  let result = ''
  let done = 0
  let cursor = 0
  while (at >= 0) {
    EMAIL_DOMAIN.lastIndex = at + 1
    const domain = at > cursor ? EMAIL_DOMAIN.exec(run) : null
    if (domain) {
      result += run.slice(done, cursor) + '[email]'
      done = cursor = EMAIL_DOMAIN.lastIndex
    } else {
      cursor = at + 1 // 本地部分是空的或網域不成立：這個 @ 之前都不會是 Email
    }
    at = run.indexOf('@', cursor)
  }
  return result + run.slice(done)
}

/**
 * 把可能識別個人的片段換成佔位符，順序與 backend/app/operations/error_reports.py 的 redact_text 相同：
 * 網址 query／hash → 網址帳密 → Email → 身分證 → 20 字以上連續串 → 7 位以上數字（含電話的 - 與空白）。
 * tokens: false 用在 kind（錯誤名稱不是資料）。
 */
export function redactClientText(text: string, options: { tokens?: boolean } = {}): string {
  let result = stripUrlQueries(stripUrlQueries(text, hasAbsoluteUrl), hasRelativeUrl)
    .replace(USERINFO, '$1[credentials]@')
    .replace(EMAIL_RUN, redactRunEmails)
    .replace(TW_ID, (_match, before: string) => `${before}[id]`)
  // token 在長數字之前：UUID 與 20 位以上的長串整段換掉，不會被數字規則切成兩半。
  if (options.tokens !== false) result = result.replace(TOKEN, (value) => (/[A-Za-z0-9]/.test(value) ? '[token]' : value))
  return result.replace(LONG_DIGITS, '[n]')
}

/** 頁面路徑只留 pathname：去掉 query／hash 後套同一組遮蔽（家長管理連結的 token 就在路徑裡）。 */
export function redactClientPath(path: string): string {
  const clean = path.split('?')[0]!.split('#')[0]!
  const redacted = redactClientText(clean)
  return redacted.startsWith('/') ? redacted : `/${redacted}`
}

// ----------------------------------------------------------------------------- 忽略規則

const EXTENSION_MARKERS = ['chrome-extension://', 'moz-extension://', 'safari-extension://', 'safari-web-extension://', 'webkit-masked-url']
const CHUNK_LOAD_MESSAGE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i
// 連不上伺服器（離線、換網路、部署重啟那幾秒）時 fetch 丟的訊息：Chrome／Firefox／Safari 各一種寫法，
// 不是程式錯誤、也沒有可行動資訊；API 本身的 5xx 由後端記。
const NETWORK_FAILURE_MESSAGE = /^(?:TypeError:\s*)?(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|The network connection was lost\.?|The Internet connection appears to be offline\.?)$/i
// Android WebView 的 Java 橋接（@JavascriptInterface）錯誤，2026-11-27：官網不註冊任何橋接，這只會來自 App 內建瀏覽器
// 自己注入的腳本——FB 內建瀏覽器（UA 含 FB_IAB）的 iabjs:// 在使用者關掉它或切到背景、原生物件已回收時呼叫
// postMessage 就會丟。看訊息不看 iabjs://：注入腳本也會包住頁面的事件，我們自己的錯誤堆疊下層可能有 iabjs frame。
const JAVA_BRIDGE_MESSAGE = /Java object is gone|Java exception was raised during method invocation/i

export interface RawClientError {
  kind: string
  message: string
  stack?: string
  /** window error 事件的 filename（沒有堆疊時用來判斷是不是瀏覽器擴充套件） */
  filename?: string
}

/** 不是我們的程式出錯、或沒有可行動資訊的錯誤：瀏覽器擴充套件、無堆疊的跨來源 Script error、AbortError、部署換檔名造成的 chunk 載入失敗、App 內建瀏覽器的 Java 橋接錯誤。 */
export function shouldIgnoreClientError(error: RawClientError): boolean {
  const haystack = `${error.stack ?? ''}\n${error.filename ?? ''}`
  if (EXTENSION_MARKERS.some((marker) => haystack.includes(marker))) return true
  const message = error.message ?? ''
  if (/ResizeObserver loop/i.test(message)) return true
  if (!error.stack && /^Script error\.?$/i.test(message.trim())) return true
  if (error.kind === 'AbortError' || /\bAbortError\b/.test(message)) return true
  if (CHUNK_LOAD_MESSAGE.test(message)) return true
  if (NETWORK_FAILURE_MESSAGE.test(message.trim())) return true
  if (JAVA_BRIDGE_MESSAGE.test(message)) return true
  return false
}

// 爬蟲、無畫面瀏覽器、檢測工具：名稱後面接 / ; - ) 或在結尾的「…bot」（Googlebot/2.1、bingbot/2.0、Slackbot-LinkExpanding；
// 手機品牌 CUBOT 後面接空白，不算），以及幾個不叫 bot 的。
const AUTOMATED_USER_AGENT = /bot(?:[/;)-]|$)|spider|crawl|headless|lightpanda|phantomjs|lighthouse|facebookexternalhit|externalagent|google-inspectiontool|googleother/i

/**
 * 這個 User-Agent 是不是爬蟲或自動化瀏覽器（2026-11-13）。它們的 DOM 實作常不完整（Lightpanda 在入學頁掛載時丟
 * Illegal invocation），回報進來只會讓總管理者手機跳通知，沒有可以修的東西；搜尋引擎用的是新版 Chromium，
 * 真的壞了一般訪客也會回報。錯誤回報在伺服器（server/api/client-errors.post.ts）看請求標頭；
 * 第一方成效統計（app/utils/cta-analytics.ts 的 statsAllowed，2026-11-20）在瀏覽器看 navigator.userAgent。
 */
export function isAutomatedUserAgent(userAgent: string | undefined): boolean {
  return !!userAgent && AUTOMATED_USER_AGENT.test(userAgent)
}

/** 任何被丟出來的值（Error、字串、物件）轉成 kind／message／stack；不展開物件內容，免得把 API 回應或表單資料帶出去。 */
export function describeThrown(value: unknown, fallbackKind: string): RawClientError {
  if (value instanceof Error) return { kind: value.name || fallbackKind, message: value.message ?? '', stack: value.stack }
  if (value && typeof value === 'object') {
    const shaped = value as { name?: unknown; message?: unknown; stack?: unknown }
    return {
      kind: typeof shaped.name === 'string' && shaped.name ? shaped.name : fallbackKind,
      message: typeof shaped.message === 'string' ? shaped.message : `[${Object.prototype.toString.call(value).slice(8, -1)}]`,
      stack: typeof shaped.stack === 'string' ? shaped.stack : undefined,
    }
  }
  return { kind: fallbackKind, message: value === undefined || value === null ? '' : String(value) }
}

// ----------------------------------------------------------------------------- 組報告

/** 堆疊裡自己這個 origin 的網址換成站內路徑：後端靠「以 / 開頭」判斷哪一格是自己的檔案（跨來源腳本保持完整網址）。 */
export function stripOrigin(stack: string, origin: string): string {
  return origin ? stack.split(origin).join('') : stack
}

const FRAME_LOCATION = /(^|[^\w/.:-])(\/[^\s()'"<>?#:]*)(?:[?#][^\s()'"<>]*?)?:(\d+):(\d+)(?=[\s)\]]|$)/

/** 堆疊第一個站內 frame 的「檔名:行:列」，去重用（後端分組也是這個位置）。 */
export function stackLocation(stack: string | undefined): string {
  const match = stack ? FRAME_LOCATION.exec(stack) : null
  return match ? `${match[2]}:${match[3]}:${match[4]}` : ''
}

export interface ClientErrorContext {
  source: ClientErrorSource
  origin: string
  pathname: string
  release?: string
}

/**
 * 截到最多 max 個 UTF-16 單位（和 validateClientError 的 .length 同一種算法），但不切斷 surrogate pair：
 * 截斷點若落在 emoji 中間（第 max 個單位是 high surrogate），往前退一格把整個 emoji 拿掉。
 * 孤立的 surrogate 序列化成 JSON 是 \ud83d 這種跳脫，後端存不進去、整筆回報 422 遺失（2026-11-12）。
 */
export function clipClientText(text: string, max: number): string {
  if (text.length <= max) return text
  const last = text.charCodeAt(max - 1)
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max)
}

export function buildClientError(raw: RawClientError, context: ClientErrorContext): ClientErrorReport {
  const stack = raw.stack ? clipClientText(redactClientText(stripOrigin(raw.stack, context.origin)), CLIENT_ERROR_LIMITS.stack) : ''
  const release = context.release === undefined ? undefined : clipClientText(context.release, CLIENT_ERROR_LIMITS.release)
  return {
    source: context.source,
    kind: clipClientText(redactClientText(raw.kind, { tokens: false }), CLIENT_ERROR_LIMITS.kind) || 'Error',
    message: clipClientText(redactClientText(raw.message ?? ''), CLIENT_ERROR_LIMITS.message),
    ...(stack ? { stack } : {}),
    path: clipClientText(redactClientPath(context.pathname), CLIENT_ERROR_LIMITS.path),
    ...(release ? { release } : {}),
  }
}

export interface ClientErrorReporterOptions extends ClientErrorContext {
  send: (report: ClientErrorReport) => void
  /** 額外的忽略規則（後台：ApiError、chunk 載入失敗） */
  ignore?: (raw: RawClientError, value: unknown) => boolean
  maxPerPage?: number
}

/**
 * 每次頁面載入最多送 maxPerPage 筆，同一個（kind＋message＋位置）只送一次。
 * capture 永遠不丟例外：錯誤回報本身壞了不能讓頁面跟著壞。
 */
export function createClientErrorReporter(options: ClientErrorReporterOptions) {
  const seen = new Set<string>()
  const max = options.maxPerPage ?? CLIENT_ERROR_MAX_PER_PAGE
  return {
    capture(value: unknown, fallbackKind: string, filename?: string): boolean {
      try {
        if (seen.size >= max) return false
        const raw = { ...describeThrown(value, fallbackKind), filename }
        if (shouldIgnoreClientError(raw) || options.ignore?.(raw, value)) return false
        const report = buildClientError(raw, options)
        const key = `${report.kind}|${report.message}|${stackLocation(raw.stack ? stripOrigin(raw.stack, options.origin) : undefined)}`
        if (seen.has(key)) return false
        seen.add(key)
        options.send(report)
        return true
      } catch {
        return false
      }
    },
  }
}

/** fetch 送出：keepalive 讓換頁前也送得出去；失敗一律吞掉。 */
export function postClientError(report: ClientErrorReport): void {
  try {
    void fetch('/api/client-errors', {
      method: 'POST',
      credentials: 'omit',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    }).catch(() => {})
  } catch {
    // 沒有 fetch 或網址壞掉：不回報就是了。
  }
}
