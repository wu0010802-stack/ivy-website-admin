// 後台的前端錯誤回報（2026-11-05）：和官網（web/shared/client-error.ts、web/app/plugins/error-report.client.ts）
// 同一套規則，送到同一個 /api/client-errors（source: 'admin'），總管理者在「系統狀態」頁看。
// 後台不能直接 import web 的檔案（映像建置時 admin 先於 web 複製進來），所以遮蔽與忽略規則在這裡有一份，
// __tests__/errorReport.test.ts 會拿同一組樣本和 web 那份比對，改一邊沒改另一邊就會失敗。
//
// 不存個資：後台網址的 query 常有家長姓名、電話等搜尋字，path 一律只取 location.pathname；
// 訊息與堆疊先遮蔽再送，API 收到後還會再遮一次。錯誤回報本身失敗一律吞掉。
import type { App } from 'vue'
import { ApiError } from '../api/client'
import { isChunkLoadError } from '../router/chunkReload'

export interface ErrorReport {
  source: 'admin'
  kind: string
  message: string
  stack?: string
  path: string
}

export interface RawError {
  kind: string
  message: string
  stack?: string
  filename?: string
}

const LIMITS = { kind: 120, message: 500, stack: 6000, path: 300 } as const
/** 每次頁面載入最多送幾筆。 */
export const MAX_REPORTS_PER_PAGE = 5

// ----------------------------------------------------------------------------- 遮蔽（不用 lookbehind：舊版 Safari 會整份 script 載入失敗）

const ABSOLUTE_URL_QUERY = /((?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/[^\s'"<>()?#]+)[?#][^\s'"<>()]*?((?::\d+){0,2})(?=[\s'"<>)\]]|$)/g
const RELATIVE_URL_QUERY = /(^|[^\w/.:-])(\/[^\s'"<>()?#:]+)[?#][^\s'"<>()]*?((?::\d+){0,2})(?=[\s'"<>)\]]|$)/g
const USERINFO = /(\/\/)[^\s/@]+@/g
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
const TW_ID = /(^|[^A-Za-z0-9])[A-Za-z][12]\d{8}(?!\d)/g
const LONG_DIGITS = /[0-9](?:[ -]?[0-9]){6,}/g
const TOKEN = /[A-Za-z0-9_-]{20,}/g

export function redactText(text: string, options: { tokens?: boolean } = {}): string {
  let result = text
    .replace(ABSOLUTE_URL_QUERY, (_match, url: string, pos: string) => url + pos)
    .replace(RELATIVE_URL_QUERY, (_match, before: string, url: string, pos: string) => before + url + pos)
    .replace(USERINFO, '$1[credentials]@')
    .replace(EMAIL, '[email]')
    .replace(TW_ID, (_match, before: string) => `${before}[id]`)
  if (options.tokens !== false) result = result.replace(TOKEN, (value) => (/[A-Za-z0-9]/.test(value) ? '[token]' : value))
  return result.replace(LONG_DIGITS, '[n]')
}

function redactPath(path: string): string {
  const clean = path.split('?')[0]!.split('#')[0]!
  const redacted = redactText(clean)
  return redacted.startsWith('/') ? redacted : `/${redacted}`
}

// ----------------------------------------------------------------------------- 忽略規則

const EXTENSION_MARKERS = ['chrome-extension://', 'moz-extension://', 'safari-extension://', 'safari-web-extension://', 'webkit-masked-url']
const CHUNK_LOAD_MESSAGE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i
// 連不上伺服器（離線、換網路、部署重啟）時 fetch 的訊息，三家瀏覽器各一種；API 的 5xx 由後端記。
const NETWORK_FAILURE_MESSAGE = /^(?:TypeError:\s*)?(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|The network connection was lost\.?|The Internet connection appears to be offline\.?)$/i

/** 官網那組忽略規則（擴充套件、ResizeObserver、無堆疊的 Script error、AbortError、chunk 載入失敗、連不上伺服器）。 */
export function shouldIgnoreError(error: RawError): boolean {
  const haystack = `${error.stack ?? ''}\n${error.filename ?? ''}`
  if (EXTENSION_MARKERS.some((marker) => haystack.includes(marker))) return true
  const message = error.message ?? ''
  if (/ResizeObserver loop/i.test(message)) return true
  if (!error.stack && /^Script error\.?$/i.test(message.trim())) return true
  if (error.kind === 'AbortError' || /\bAbortError\b/.test(message)) return true
  if (CHUNK_LOAD_MESSAGE.test(message)) return true
  return NETWORK_FAILURE_MESSAGE.test(message.trim())
}

/** 後台另外忽略：API 回的錯誤（ApiError，後端自己會記）與頁面 chunk 載入失敗（router 的 reloadAfterChunkError 會處理）。 */
export function shouldIgnoreAdminError(raw: RawError, value: unknown): boolean {
  return shouldIgnoreError(raw) || value instanceof ApiError || isChunkLoadError(value)
}

function describeThrown(value: unknown, fallbackKind: string): RawError {
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

// 自己 origin 的網址換成站內路徑：API 靠「以 / 開頭」判斷哪一格堆疊是自己的檔案。
function stripOrigin(stack: string, origin: string): string {
  return origin ? stack.split(origin).join('') : stack
}

const FRAME_LOCATION = /(^|[^\w/.:-])(\/[^\s()'"<>?#:]*)(?:[?#][^\s()'"<>]*?)?:(\d+):(\d+)(?=[\s)\]]|$)/

function stackLocation(stack: string | undefined): string {
  const match = stack ? FRAME_LOCATION.exec(stack) : null
  return match ? `${match[2]}:${match[3]}:${match[4]}` : ''
}

export function buildReport(raw: RawError, origin: string, pathname: string): ErrorReport {
  const stack = raw.stack ? redactText(stripOrigin(raw.stack, origin)).slice(0, LIMITS.stack) : ''
  return {
    source: 'admin',
    kind: redactText(raw.kind, { tokens: false }).slice(0, LIMITS.kind) || 'Error',
    message: redactText(raw.message ?? '').slice(0, LIMITS.message),
    ...(stack ? { stack } : {}),
    path: redactPath(pathname).slice(0, LIMITS.path),
  }
}

export function createErrorReporter(options: {
  send: (report: ErrorReport) => void
  origin: string
  /** 每次送出時才讀：單頁應用換頁後是新的路徑。 */
  pathname: () => string
  maxPerPage?: number
}) {
  const seen = new Set<string>()
  const max = options.maxPerPage ?? MAX_REPORTS_PER_PAGE
  return {
    /** 回傳這次有沒有送出。永遠不丟例外。 */
    capture(value: unknown, fallbackKind: string, filename?: string): boolean {
      try {
        if (seen.size >= max) return false
        const raw = { ...describeThrown(value, fallbackKind), filename }
        if (shouldIgnoreAdminError(raw, value)) return false
        const report = buildReport(raw, options.origin, options.pathname())
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

export function postReport(report: ErrorReport): void {
  try {
    void fetch('/api/client-errors', {
      method: 'POST',
      credentials: 'omit',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    }).catch(() => {})
  } catch {
    // 沒有 fetch：不回報就是了。
  }
}

/**
 * 掛在 main.ts（只在正式建置）。app.config.errorHandler 一裝，Vue 就不再自己印錯，所以這裡要
 * console.error 保留原行為。
 */
export function installErrorReporting(app: App, win: Window = window, send: (report: ErrorReport) => void = postReport): void {
  const reporter = createErrorReporter({ send, origin: win.location.origin, pathname: () => win.location.pathname })
  app.config.errorHandler = (error) => {
    console.error(error)
    reporter.capture(error, 'VueError')
  }
  win.addEventListener('error', (event) => {
    // 圖片、script 載入失敗是一般 Event（target 不是 window），不是程式錯誤。
    if (!(event instanceof ErrorEvent)) return
    reporter.capture(event.error ?? event.message, 'Error', event.filename)
  })
  win.addEventListener('unhandledrejection', (event) => {
    reporter.capture(event.reason, 'unhandledrejection')
  })
}
