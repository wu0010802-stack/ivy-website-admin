// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest'
import { validateClientError, type ClientErrorReport } from '../shared/client-error'

// 官網的前端錯誤回報外掛（plugins/error-report.client.ts）：監聽哪些事件、忽略什麼、每頁上限與去重、送出的樣子、
// 不因 DNT／GPC 停用、送出失敗吞掉。規則本身的單元測試在 client-error.spec.ts。

type Plugin = (app: { hook: (name: string, fn: (error: unknown) => void) => void }) => void
let plugin: Plugin
const cleanups: (() => void)[] = []

beforeAll(async () => {
  vi.stubGlobal('defineNuxtPlugin', (setup: Plugin) => setup)
  plugin = (await import('../app/plugins/error-report.client')).default as unknown as Plugin
})

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
  vi.stubGlobal('defineNuxtPlugin', (setup: Plugin) => setup)
})

/** 在 path 這一頁掛上外掛；回傳 fetch 與 vue／app 的錯誤 hook。 */
function mountAt(path: string, options: { enabled?: boolean; fetch?: Mock } = {}) {
  history.replaceState(null, '', path)
  const fetch = options.fetch ?? vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { errorReportsEnabled: options.enabled ?? true }, app: { buildId: 'build-xyz' } }))
  const hooks: Record<string, (error: unknown) => void> = {}
  const added: [string, EventListenerOrEventListenerObject][] = []
  const original = window.addEventListener.bind(window)
  const add = vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
    added.push([type, listener])
    original(type, listener, opts)
  })
  plugin({ hook: (name, fn) => { hooks[name] = fn } })
  add.mockRestore()
  cleanups.push(() => added.forEach(([type, listener]) => window.removeEventListener(type, listener)))
  return { fetch, hooks, listenerTypes: added.map(([type]) => type) }
}

const bodies = (fetch: Mock): ClientErrorReport[] => fetch.mock.calls.map(([, init]) => JSON.parse(init.body))
const raise = (error: Error) => window.dispatchEvent(new ErrorEvent('error', { error, message: error.message, filename: `${location.origin}/_nuxt/a.js` }))
const reject = (reason: unknown) => {
  const event = new Event('unhandledrejection') as Event & { reason?: unknown }
  event.reason = reason
  window.dispatchEvent(event)
}
const failure = (message: string, name = 'TypeError') => Object.assign(new Error(message), { name, stack: `${name}: ${message}\n    at go (${location.origin}/_nuxt/entry.abc123.js?v=1:10:20)` })

describe('掛載', () => {
  it('開關關閉（非 production）就什麼都不監聽', () => {
    const { listenerTypes, hooks } = mountAt('/', { enabled: false })
    expect(listenerTypes).toEqual([])
    expect(hooks).toEqual({})
  })
  it('開啟時監聽 error、unhandledrejection、vue:error、app:error', () => {
    const { listenerTypes, hooks } = mountAt('/')
    expect(listenerTypes.sort()).toEqual(['error', 'unhandledrejection'])
    expect(Object.keys(hooks).sort()).toEqual(['app:error', 'vue:error'])
  })
})

describe('送出的內容', () => {
  it('POST /api/client-errors：不帶 cookie、keepalive、通過白名單驗證；位置只留 pathname；堆疊的 origin 與 query 拿掉', () => {
    const { fetch } = mountAt('/visit/manage/abcdefghijklmnopqrstuvwxyz0123456789?token=secret#frag')
    raise(failure('x is not a function'))
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('/api/client-errors')
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', keepalive: true, headers: { 'content-type': 'application/json' } })
    const [body] = bodies(fetch)
    expect(validateClientError(body)).not.toBeNull()
    expect(body).toEqual({
      source: 'web', kind: 'TypeError', message: 'x is not a function', release: 'build-xyz',
      path: '/visit/manage/[token]',
      stack: 'TypeError: x is not a function\n    at go (/_nuxt/entry.abc123.js:10:20)',
    })
    expect(JSON.stringify(body)).not.toMatch(/secret|frag|localhost/)
  })
  it('不因 DNT／GPC 停用（回報裡沒有識別資訊）', () => {
    vi.stubGlobal('navigator', { ...navigator, globalPrivacyControl: true, doNotTrack: '1' })
    const { fetch } = mountAt('/')
    raise(failure('still reported'))
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('收哪些錯誤', () => {
  it('window error（ErrorEvent）、unhandledrejection（Error 與其他值）、vue:error、app:error', () => {
    const { fetch, hooks } = mountAt('/')
    raise(failure('from window'))
    reject(failure('from promise', 'RangeError'))
    reject('plain string reason')
    hooks['vue:error']!(failure('from vue', 'VueError'))
    hooks['app:error']!(failure('from nuxt', 'NuxtError'))
    expect(bodies(fetch).map((b) => [b.kind, b.message])).toEqual([
      ['TypeError', 'from window'], ['RangeError', 'from promise'], ['unhandledrejection', 'plain string reason'],
      ['VueError', 'from vue'], ['NuxtError', 'from nuxt'],
    ])
  })
  it('資源載入失敗（不是 ErrorEvent）不收', () => {
    const { fetch } = mountAt('/')
    window.dispatchEvent(new Event('error'))
    expect(fetch).not.toHaveBeenCalled()
  })
  it('忽略：擴充套件、ResizeObserver、沒堆疊的 Script error、AbortError、chunk 載入失敗', () => {
    const { fetch, hooks } = mountAt('/')
    raise(Object.assign(new Error('injected'), { stack: 'Error: injected\n    at x (chrome-extension://abc/c.js:1:2)' }))
    window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' }))
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.', filename: '' }))
    reject(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }))
    hooks['app:error']!(new Error('Failed to fetch dynamically imported module: /_nuxt/old.js'))
    reject(new TypeError('Importing a module script failed.'))
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('每頁上限與去重', () => {
  it('同一個錯誤只送一次；第 6 個不同的錯誤起不送', () => {
    const { fetch } = mountAt('/')
    for (let i = 0; i < 3; i++) raise(failure('same thing'))
    for (let i = 0; i < 8; i++) raise(failure(`other failure ${'x'.repeat(i)}`))
    expect(fetch).toHaveBeenCalledTimes(5)
    expect(new Set(bodies(fetch).map((b) => b.message)).size).toBe(5)
  })
})

describe('送出失敗一律吞掉', () => {
  it('fetch 被拒絕：不讓頁面多出一個 unhandled rejection', async () => {
    const rejected = vi.fn().mockRejectedValue(new TypeError('offline'))
    mountAt('/', { fetch: rejected })
    const unhandled = vi.fn()
    window.addEventListener('unhandledrejection', unhandled)
    cleanups.push(() => window.removeEventListener('unhandledrejection', unhandled))
    expect(() => raise(failure('first'))).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(rejected).toHaveBeenCalledTimes(1)
    expect(unhandled).not.toHaveBeenCalled()
  })
  it('fetch 同步丟例外：照樣不外洩', () => {
    const throwing = vi.fn(() => { throw new Error('fetch exploded') })
    mountAt('/', { fetch: throwing as unknown as Mock })
    expect(() => raise(failure('second'))).not.toThrow()
    expect(throwing).toHaveBeenCalledTimes(1)
  })
})
