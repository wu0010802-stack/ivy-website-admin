// 後台的前端錯誤回報（2026-11-05，utils/errorReport.ts）：忽略規則、遮蔽、每頁上限與去重、
// 只取 pathname、app.config.errorHandler 保留原本的 console.error，以及只在正式建置安裝。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { ApiError } from '../api/client'
import {
  MAX_REPORTS_PER_PAGE,
  buildReport,
  createErrorReporter,
  installErrorReporting,
  postReport,
  redactText,
  shouldIgnoreAdminError,
  shouldIgnoreError,
  type ErrorReport,
} from '../utils/errorReport'

afterEach(() => vi.restoreAllMocks())

// 官網那份規則（web/shared/client-error.ts）：不能用靜態 import——映像建置時 admin 先於 web 複製進來，
// vue-tsc 會找不到模組；測試執行時 web/ 一定在，動態載入。
interface WebRules {
  redactClientText: (text: string, options?: { tokens?: boolean }) => string
  shouldIgnoreClientError: (error: { kind: string; message: string; stack?: string; filename?: string }) => boolean
}
const webRules = (await import(/* @vite-ignore */ resolve(__dirname, '../../../web/shared/client-error.ts'))) as WebRules
const { redactClientText, shouldIgnoreClientError } = webRules

const failure = (message: string, name = 'TypeError') =>
  Object.assign(new Error(message), { name, stack: `${name}: ${message}\n    at go (https://admin.example/admin/assets/index-abc123.js?v=1:10:20)` })

describe('遮蔽與忽略：和官網（web/shared/client-error.ts）同一組', () => {
  const samples = [
    'see https://a.example/x?q=1&p=0912345678#top now',
    'at f (https://a.example/e.js?v=3:12:34)',
    'at g (/admin/assets/f.js?email=mom@example.com:5:6)',
    'a@b.co and c.d+e@f.org',
    '0912345678 / 0912-345-678 / +886 912 345 678 / 1234567 / 123456',
    'A123456789 b223456789',
    'tok ' + 'a1'.repeat(10) + ' short1234',
    '3f2c9a1e-1b2c-4d5e-8f90-123456789abc',
    '-'.repeat(30),
    'postgresql://user:pw@db.internal/app',
    '搜尋「王小美」電話 0912-345-678 失敗',
    '',
  ]
  it.each(samples)('遮蔽：%s', (sample) => {
    expect(redactText(sample)).toBe(redactClientText(sample))
    expect(redactText(sample, { tokens: false })).toBe(redactClientText(sample, { tokens: false }))
  })
  it('忽略規則與官網一致（擴充套件、ResizeObserver、無堆疊的 Script error、AbortError、chunk 載入失敗）', () => {
    const cases = [
      { kind: 'Error', message: 'boom', stack: 'Error: boom\n    at f (/admin/assets/a.js:1:2)' },
      { kind: 'Error', message: 'boom', stack: 'Error: boom\n    at f (chrome-extension://abc/c.js:1:2)' },
      { kind: 'Error', message: 'boom', filename: 'moz-extension://abc/x.js' },
      { kind: 'Error', message: 'ResizeObserver loop limit exceeded' },
      { kind: 'Error', message: 'Script error.' },
      { kind: 'Error', message: 'Script error.', stack: 'Error\n    at f (/admin/assets/a.js:1:2)' },
      { kind: 'AbortError', message: 'The user aborted a request.' },
      { kind: 'Error', message: 'Failed to fetch dynamically imported module: /admin/assets/old.js' },
      { kind: 'TypeError', message: 'Importing a module script failed.' },
      { kind: 'Error', message: 'error loading dynamically imported module' },
      { kind: 'TypeError', message: 'Failed to fetch' },
      { kind: 'TypeError', message: 'Load failed' },
      { kind: 'TypeError', message: 'NetworkError when attempting to fetch resource.' },
      { kind: 'TypeError', message: "Cannot read properties of undefined (reading 'Failed to fetch')" },
    ]
    for (const raw of cases) expect(shouldIgnoreError(raw), JSON.stringify(raw)).toBe(shouldIgnoreClientError(raw))
    // 14 個樣本裡只有一般錯誤、「有堆疊的 Script error」與剛好提到 fetch 的程式錯誤要送
    expect(cases.filter((raw) => shouldIgnoreError(raw))).toHaveLength(11)
  })
})

describe('後台另外忽略 ApiError 與頁面 chunk 載入失敗', () => {
  it('ApiError（API 端錯誤後端自己會記）不回報', () => {
    const error = new ApiError(500, { code: 'INTERNAL_ERROR', message: '系統發生未預期的錯誤' })
    expect(shouldIgnoreAdminError({ kind: 'Error', message: error.message, stack: error.stack }, error)).toBe(true)
    expect(shouldIgnoreAdminError({ kind: 'Error', message: 'x' }, new Error('x'))).toBe(false)
  })
  it('Vite 的 chunk／CSS 預載失敗（router 會整頁重載）不回報', () => {
    const css = new Error('Unable to preload CSS for /admin/assets/Users-abc.css')
    expect(shouldIgnoreAdminError({ kind: 'Error', message: css.message, stack: css.stack }, css)).toBe(true)
    const chunk = new TypeError('Failed to fetch dynamically imported module: https://x/admin/assets/a.js')
    expect(shouldIgnoreAdminError({ kind: 'TypeError', message: chunk.message }, chunk)).toBe(true)
  })
})

describe('組報告', () => {
  it('source 是 admin；自己 origin 的網址換成站內路徑；訊息與堆疊遮蔽；沒有 release', () => {
    const error = failure('查不到 mom@example.com 的案件 0912345678')
    const report = buildReport({ kind: error.name, message: error.message, stack: error.stack }, 'https://admin.example', '/admin/visits')
    expect(report).toEqual({
      source: 'admin', kind: 'TypeError', message: '查不到 [email] 的案件 [n]', path: '/admin/visits',
      stack: 'TypeError: 查不到 [email] 的案件 [n]\n    at go (/admin/assets/index-abc123.js:10:20)',
    })
    expect('release' in report).toBe(false)
  })
  it('超長截到上限', () => {
    const report = buildReport({ kind: 'K'.repeat(300), message: 'm '.repeat(600), stack: 'at x (/a.js:1:2)\n' + 'line\n'.repeat(3000) }, '', '/x')
    expect([report.kind.length, report.message.length, report.stack!.length]).toEqual([120, 500, 6000])
  })
})

describe('每頁最多 5 筆、同一個只送一次', () => {
  const make = () => {
    const sent: ErrorReport[] = []
    const reporter = createErrorReporter({ send: (r) => sent.push(r), origin: 'https://admin.example', pathname: () => '/admin/' })
    return { sent, reporter }
  }
  it('去重與上限；被忽略的不佔額度；send 壞了也不外洩', () => {
    expect(MAX_REPORTS_PER_PAGE).toBe(5)
    const { sent, reporter } = make()
    expect(reporter.capture(new ApiError(500, 'x'), 'Error')).toBe(false)
    expect(reporter.capture(failure('same'), 'Error')).toBe(true)
    expect(reporter.capture(failure('same'), 'Error')).toBe(false)
    const results = Array.from({ length: 6 }, (_, i) => reporter.capture(failure(`distinct failure ${'x'.repeat(i)}`), 'Error'))
    expect(results).toEqual([true, true, true, true, false, false])
    expect(sent).toHaveLength(5)
    const broken = createErrorReporter({ send: () => { throw new Error('send broke') }, origin: '', pathname: () => '/' })
    expect(() => broken.capture(failure('boom'), 'Error')).not.toThrow()
  })
})

describe('postReport', () => {
  it('POST /api/client-errors，不帶 cookie、keepalive；失敗吞掉', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetch)
    try {
      expect(() => postReport({ source: 'admin', kind: 'E', message: 'm', path: '/' })).not.toThrow()
      await Promise.resolve()
      const [url, init] = fetch.mock.calls[0]!
      expect(url).toBe('/api/client-errors')
      expect(init).toMatchObject({ method: 'POST', credentials: 'omit', keepalive: true })
      expect(JSON.parse(init.body)).toEqual({ source: 'admin', kind: 'E', message: 'm', path: '/' })
      vi.stubGlobal('fetch', () => { throw new Error('fetch exploded') })
      expect(() => postReport({ source: 'admin', kind: 'E', message: 'm', path: '/' })).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('installErrorReporting', () => {
  function install() {
    const handlers: Record<string, (event: unknown) => void> = {}
    const win = {
      location: { origin: 'https://admin.example', pathname: '/admin/visits', search: '?q=0912345678&name=王小美', hash: '#x' },
      addEventListener: (type: string, handler: (event: unknown) => void) => { handlers[type] = handler },
    } as unknown as Window
    const sent: ErrorReport[] = []
    const app = createApp({ render: () => null })
    installErrorReporting(app, win, (report) => sent.push(report))
    return { app, handlers, sent }
  }

  it('app.config.errorHandler：照舊 console.error，再回報；path 只取 pathname（搜尋字、hash 不送）', () => {
    const { app, sent } = install()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const error = failure('render blew up', 'VueError')
    app.config.errorHandler!(error, null, 'render function')
    expect(consoleError).toHaveBeenCalledWith(error)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ source: 'admin', kind: 'VueError', message: 'render blew up', path: '/admin/visits' })
    expect(JSON.stringify(sent)).not.toMatch(/0912345678|王小美|#x|\?q=/)
  })

  it('window error 只收 ErrorEvent，unhandledrejection 收任何值；ApiError 與資源載入失敗不收', () => {
    const { handlers, sent } = install()
    handlers.error!(new Event('error'))
    handlers.error!(new ErrorEvent('error', { error: failure('from window'), message: 'from window', filename: 'https://admin.example/admin/assets/a.js' }))
    handlers.unhandledrejection!({ reason: failure('from promise', 'RangeError') })
    handlers.unhandledrejection!({ reason: 'plain string' })
    handlers.unhandledrejection!({ reason: new ApiError(500, 'server') })
    expect(sent.map((r) => [r.kind, r.message])).toEqual([['TypeError', 'from window'], ['RangeError', 'from promise'], ['unhandledrejection', 'plain string']])
  })
})

describe('只在正式建置安裝', () => {
  it('main.ts 以 import.meta.env.PROD 包住 installErrorReporting，且在 mount 之前', () => {
    const main = readFileSync(resolve(__dirname, '../main.ts'), 'utf8')
    expect(main).toMatch(/if \(import\.meta\.env\.PROD\) installErrorReporting\(app\)\s+app\.mount\('#app'\)/)
  })
})
