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

// 網址後面的 ?query 與 #hash 整段拿掉，保留堆疊 frame 的「:行:列」。完整網址（含 // 開頭）直接比對；
// 站內路徑（/ 開頭）前面不能是字元、斜線、點、冒號、減號（取代 lookbehind，免得把 https://host/x 的後半段誤當路徑）。
const ABSOLUTE_URL_QUERY = /((?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/[^\s'"<>()?#]+)[?#][^\s'"<>()]*?((?::\d+){0,2})(?=[\s'"<>)\]]|$)/g
const RELATIVE_URL_QUERY = /(^|[^\w/.:-])(\/[^\s'"<>()?#:]+)[?#][^\s'"<>()]*?((?::\d+){0,2})(?=[\s'"<>)\]]|$)/g
const USERINFO = /(\/\/)[^\s/@]+@/g
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
const TW_ID = /(^|[^A-Za-z0-9])[A-Za-z][12]\d{8}(?!\d)/g
const LONG_DIGITS = /[0-9](?:[ -]?[0-9]){6,}/g
const TOKEN = /[A-Za-z0-9_-]{20,}/g

/**
 * 把可能識別個人的片段換成佔位符，順序與 backend/app/operations/error_reports.py 的 redact_text 相同：
 * 網址 query／hash → 網址帳密 → Email → 身分證 → 20 字以上連續串 → 7 位以上數字（含電話的 - 與空白）。
 * tokens: false 用在 kind（錯誤名稱不是資料）。
 */
export function redactClientText(text: string, options: { tokens?: boolean } = {}): string {
  let result = text
    .replace(ABSOLUTE_URL_QUERY, (_match, url: string, pos: string) => url + pos)
    .replace(RELATIVE_URL_QUERY, (_match, before: string, url: string, pos: string) => before + url + pos)
    .replace(USERINFO, '$1[credentials]@')
    .replace(EMAIL, '[email]')
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

export interface RawClientError {
  kind: string
  message: string
  stack?: string
  /** window error 事件的 filename（沒有堆疊時用來判斷是不是瀏覽器擴充套件） */
  filename?: string
}

/** 不是我們的程式出錯、或沒有可行動資訊的錯誤：瀏覽器擴充套件、無堆疊的跨來源 Script error、AbortError、部署換檔名造成的 chunk 載入失敗。 */
export function shouldIgnoreClientError(error: RawClientError): boolean {
  const haystack = `${error.stack ?? ''}\n${error.filename ?? ''}`
  if (EXTENSION_MARKERS.some((marker) => haystack.includes(marker))) return true
  const message = error.message ?? ''
  if (/ResizeObserver loop/i.test(message)) return true
  if (!error.stack && /^Script error\.?$/i.test(message.trim())) return true
  if (error.kind === 'AbortError' || /\bAbortError\b/.test(message)) return true
  if (CHUNK_LOAD_MESSAGE.test(message)) return true
  if (NETWORK_FAILURE_MESSAGE.test(message.trim())) return true
  return false
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
