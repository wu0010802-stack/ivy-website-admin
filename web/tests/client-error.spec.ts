import { describe, expect, it, vi } from 'vitest'
import {
  CLIENT_ERROR_MAX_PER_PAGE,
  buildClientError,
  createClientErrorReporter,
  describeThrown,
  redactClientPath,
  redactClientText,
  shouldIgnoreClientError,
  stackLocation,
  validateClientError,
  type ClientErrorReport,
} from '../shared/client-error'

const report = (overrides: Record<string, unknown> = {}) => ({ source: 'web', kind: 'TypeError', message: 'x is not a function', path: '/campuses/yihua', ...overrides })

describe('驗證：嚴格白名單', () => {
  it('合法回報原樣通過，stack 與 release 可省略', () => {
    const full = report({ stack: 'TypeError: x\n    at f (/_nuxt/a.js:1:2)', release: 'build-1' })
    expect(validateClientError(full)).toEqual(full)
    expect(validateClientError(report())).toEqual(report())
    expect(validateClientError(report({ source: 'admin', message: '' }))).not.toBeNull()
  })
  it('多餘欄位（IP、cookie、帳號、location）一律拒絕', () => {
    for (const extra of [{ ip: '1.2.3.4' }, { cookie: 'a=b' }, { user: '王小美' }, { location: '/_nuxt/a.js:1:2' }, { email: 'a@b.co' }]) {
      expect(validateClientError(report(extra))).toBeNull()
    }
  })
  it('欄位型別與長度', () => {
    expect(validateClientError(report({ source: 'api' }))).toBeNull()
    expect(validateClientError(report({ source: undefined }))).toBeNull()
    expect(validateClientError(report({ kind: '' }))).toBeNull()
    expect(validateClientError(report({ kind: 'k'.repeat(121) }))).toBeNull()
    expect(validateClientError(report({ kind: 'k'.repeat(120) }))).not.toBeNull()
    expect(validateClientError(report({ message: 'm'.repeat(501) }))).toBeNull()
    expect(validateClientError(report({ message: 'm'.repeat(500) }))).not.toBeNull()
    expect(validateClientError(report({ stack: 's'.repeat(6001) }))).toBeNull()
    expect(validateClientError(report({ stack: 's'.repeat(6000) }))).not.toBeNull()
    expect(validateClientError(report({ stack: null }))).toBeNull()
    expect(validateClientError(report({ path: 'campuses' }))).toBeNull()
    expect(validateClientError(report({ path: '/' + 'p'.repeat(300) }))).toBeNull()
    expect(validateClientError(report({ release: 'r'.repeat(65) }))).toBeNull()
    expect(validateClientError(report({ message: 42 }))).toBeNull()
    for (const bad of [null, undefined, 'x', 3, [], [report()]]) expect(validateClientError(bad)).toBeNull()
  })
})

describe('遮蔽（與後端 redact_text 同一組規則）', () => {
  it('網址去掉 query 與 hash，保留堆疊的行列', () => {
    expect(redactClientText('see https://a.example/x?q=1&p=0912345678#top now')).toBe('see https://a.example/x now')
    expect(redactClientText('at f (https://a.example/e.js?v=3:12:34)')).toBe('at f (https://a.example/e.js:12:34)')
    expect(redactClientText('at g (/_nuxt/f.js?email=mom@example.com:5:6)')).toBe('at g (/_nuxt/f.js:5:6)')
    expect(redactClientText('fetch /api/x?phone=0912345678 failed')).toBe('fetch /api/x failed')
    expect(redactClientText('https://a.example/p#frag')).toBe('https://a.example/p')
  })
  it('Email、身分證、7 位以上數字（含電話的 - 與空白）、20 字以上連續串', () => {
    expect(redactClientText('a@b.co and c.d+e@f.org')).toBe('[email] and [email]')
    expect(redactClientText('0912345678 / 0912-345-678 / +886 912 345 678 / 1234567')).toBe('[n] / [n] / +[n] / [n]')
    expect(redactClientText('123456')).toBe('123456')
    expect(redactClientText('A123456789 b223456789')).toBe('[id] [id]')
    expect(redactClientText('tok ' + 'a1'.repeat(10) + ' short1234')).toBe('tok [token] short1234')
    expect(redactClientText('3f2c9a1e-1b2c-4d5e-8f90-123456789abc')).toBe('[token]')
    expect(redactClientText('-'.repeat(30))).toBe('-'.repeat(30))
    expect(redactClientText('postgresql://user:pw@db.internal/app')).toBe('postgresql://[credentials]@db.internal/app')
  })
  it('kind 是錯誤名稱不是資料：不套 token 規則，但 Email 與數字照遮', () => {
    expect(redactClientText('VeryLongCustomErrorNameHere', { tokens: false })).toBe('VeryLongCustomErrorNameHere')
    expect(redactClientText('mom@example.com', { tokens: false })).toBe('[email]')
  })
  it('頁面路徑只留 pathname，家長管理連結的 token 遮掉', () => {
    expect(redactClientPath('/visit/manage/abcdefghijklmnopqrstuvwxyz0123456789?token=secret#frag')).toBe('/visit/manage/[token]')
    expect(redactClientPath('/admin/visits?q=0912345678')).toBe('/admin/visits')
    expect(redactClientPath('/campuses/yihua')).toBe('/campuses/yihua')
  })
})

describe('忽略規則', () => {
  const ignored = (overrides: Partial<Parameters<typeof shouldIgnoreClientError>[0]>) =>
    shouldIgnoreClientError({ kind: 'Error', message: 'boom', stack: 'Error: boom\n    at f (/_nuxt/a.js:1:2)', ...overrides })
  it('一般錯誤不忽略', () => expect(ignored({})).toBe(false))
  it('瀏覽器擴充套件（堆疊或檔名）', () => {
    for (const marker of ['chrome-extension://abc/content.js', 'moz-extension://abc/x.js', 'safari-extension://abc/x.js', 'safari-web-extension://abc/x.js', 'webkit-masked-url://hidden/']) {
      expect(ignored({ stack: `Error: boom\n    at f (${marker}:1:2)` }), marker).toBe(true)
      expect(ignored({ stack: undefined, filename: marker }), marker).toBe(true)
    }
  })
  it('ResizeObserver loop、沒有堆疊的 Script error、AbortError', () => {
    expect(ignored({ message: 'ResizeObserver loop limit exceeded' })).toBe(true)
    expect(ignored({ message: 'ResizeObserver loop completed with undelivered notifications.' })).toBe(true)
    expect(ignored({ message: 'Script error.', stack: undefined })).toBe(true)
    expect(ignored({ message: 'Script error.' })).toBe(false) // 有堆疊就是自己的程式
    expect(ignored({ kind: 'AbortError', message: 'The user aborted a request.' })).toBe(true)
    expect(ignored({ message: 'AbortError: signal is aborted without reason' })).toBe(true)
  })
  it('連不上伺服器的 fetch 失敗（離線、部署重啟）', () => {
    for (const message of ['Failed to fetch', 'TypeError: Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.', 'The network connection was lost.', 'The Internet connection appears to be offline.']) {
      expect(ignored({ kind: 'TypeError', message }), message).toBe(true)
    }
    // 只有整句是網路失敗才忽略，訊息裡剛好提到 fetch 的程式錯誤照記
    expect(ignored({ kind: 'TypeError', message: "Cannot read properties of undefined (reading 'Failed to fetch')" })).toBe(false)
  })
  it('動態 import／chunk 載入失敗（部署換檔名）', () => {
    for (const message of ['Failed to fetch dynamically imported module: https://x/_nuxt/a.js', 'Importing a module script failed.', 'error loading dynamically imported module']) {
      expect(ignored({ message }), message).toBe(true)
    }
  })
})

describe('describeThrown：任何被丟出的值', () => {
  it('Error、字串、物件、空值；不展開物件內容', () => {
    expect(describeThrown(new RangeError('bad'), 'x')).toMatchObject({ kind: 'RangeError', message: 'bad' })
    expect(describeThrown('plain text', 'unhandledrejection')).toEqual({ kind: 'unhandledrejection', message: 'plain text' })
    expect(describeThrown({ name: 'Custom', message: 'm', stack: 's' }, 'x')).toEqual({ kind: 'Custom', message: 'm', stack: 's' })
    expect(describeThrown({ phone: '0912345678' }, 'unhandledrejection')).toEqual({ kind: 'unhandledrejection', message: '[Object]', stack: undefined })
    expect(describeThrown(undefined, 'unhandledrejection')).toEqual({ kind: 'unhandledrejection', message: '' })
  })
})

describe('組報告', () => {
  const context = { source: 'web' as const, origin: 'https://site.example', pathname: '/visit/manage/abcdefghijklmnopqrstuvwxyz0123456789', release: 'build-1' }
  it('自己 origin 的網址換成站內路徑、其餘照遮蔽；位置取第一個站內 frame', () => {
    const stack = 'TypeError: x\n    at a (https://site.example/_nuxt/e.js?v=1&t=abc:3:4)\n    at b (https://cdn.example/lib.js:9:9)'
    const built = buildClientError({ kind: 'TypeError', message: 'mom@example.com', stack }, context)
    expect(built).toEqual({
      source: 'web', kind: 'TypeError', message: '[email]', path: '/visit/manage/[token]', release: 'build-1',
      stack: 'TypeError: x\n    at a (/_nuxt/e.js:3:4)\n    at b (https://cdn.example/lib.js:9:9)',
    })
    expect(stackLocation('x\n    at a (/_nuxt/e.js:3:4)\n    at b (https://cdn.example/lib.js:9:9)')).toBe('/_nuxt/e.js:3:4')
    expect(stackLocation('only https://cdn.example/lib.js:9:9')).toBe('')
    expect(stackLocation('foo@/_nuxt/a.js?v=2:5:6')).toBe('/_nuxt/a.js:5:6')
  })
  it('超長截到上限、沒有堆疊與版本就不帶欄位', () => {
    const built = buildClientError({ kind: 'K'.repeat(300), message: 'm '.repeat(600), stack: 'at x (/_nuxt/a.js:1:2)\n' + 'line\n'.repeat(3000) }, { ...context, release: undefined, pathname: '/x' })
    expect(built.kind.length).toBe(120)
    expect(built.message.length).toBe(500)
    expect(built.stack!.length).toBe(6000)
    expect('release' in built).toBe(false)
    expect('stack' in buildClientError({ kind: 'E', message: 'm' }, context)).toBe(false)
    expect(validateClientError(built)).not.toBeNull()
  })
})

describe('每頁最多 5 筆、同一個只送一次', () => {
  const make = (extra: Partial<Parameters<typeof createClientErrorReporter>[0]> = {}) => {
    const sent: ClientErrorReport[] = []
    const reporter = createClientErrorReporter({ source: 'web', origin: 'https://site.example', pathname: '/', send: (r) => sent.push(r), ...extra })
    return { sent, reporter }
  }
  const thrown = (message: string) => Object.assign(new Error(message), { stack: `Error: ${message}\n    at f (https://site.example/_nuxt/a.js:1:2)` })

  it('相同（kind＋message＋位置）只送一次；數字不同的訊息各算一個', () => {
    const { sent, reporter } = make()
    expect(reporter.capture(thrown('boom'), 'Error')).toBe(true)
    expect(reporter.capture(thrown('boom'), 'Error')).toBe(false)
    expect(reporter.capture(thrown('boom 1'), 'Error')).toBe(true)
    expect(sent.map((r) => r.message)).toEqual(['boom', 'boom 1'])
  })
  it('第 6 筆起不送', () => {
    const { sent, reporter } = make()
    const results = Array.from({ length: 8 }, (_, index) => reporter.capture(thrown(`distinct failure ${'x'.repeat(index)}`), 'Error'))
    expect(CLIENT_ERROR_MAX_PER_PAGE).toBe(5)
    expect(results).toEqual([true, true, true, true, true, false, false, false])
    expect(sent).toHaveLength(5)
  })
  it('被忽略的不佔額度', () => {
    const { sent, reporter } = make()
    for (let i = 0; i < 10; i++) expect(reporter.capture(new Error('ResizeObserver loop limit exceeded'), 'Error')).toBe(false)
    expect(reporter.capture(thrown('real'), 'Error')).toBe(true)
    expect(sent).toHaveLength(1)
  })
  it('send 丟例外也不外洩', () => {
    const { reporter } = make({ send: () => { throw new Error('send broke') } })
    expect(() => reporter.capture(thrown('boom'), 'Error')).not.toThrow()
  })
  it('額外忽略規則收到原始值', () => {
    const ignore = vi.fn(() => true)
    const { sent, reporter } = make({ ignore })
    const value = thrown('api failure')
    expect(reporter.capture(value, 'Error')).toBe(false)
    expect(ignore).toHaveBeenCalledWith(expect.objectContaining({ message: 'api failure' }), value)
    expect(sent).toEqual([])
  })
  it('路徑每次送出時才讀（單頁應用換頁後是新的路徑）', () => {
    let pathname = '/a'
    const sent: ClientErrorReport[] = []
    const reporter = createClientErrorReporter({ source: 'web', origin: '', get pathname() { return pathname }, send: (r) => sent.push(r) })
    reporter.capture(thrown('one'), 'Error')
    pathname = '/b'
    reporter.capture(thrown('two'), 'Error')
    expect(sent.map((r) => r.path)).toEqual(['/a', '/b'])
  })
})

// 2026-11-12 QA L18：String.slice 以 UTF-16 單位截斷，截在 emoji（surrogate pair）中間會留下孤立的 high surrogate，
// JSON.stringify 會把它寫成 \ud83d，後端存不進去、整筆回報 422 遺失。截斷點若落在 pair 中間就往前退一格。
describe('截斷不切斷 emoji（surrogate pair）', () => {
  const context = { source: 'web' as const, origin: 'https://site.example', pathname: '/x', release: 'build-1' }
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/
  const EMOJI = '😀'
  /** 不會被遮蔽規則改寫的填充字（短單字加空白），剛好 n 個 UTF-16 單位。 */
  const filler = (n: number) => 'ab '.repeat(Math.ceil(n / 3)).slice(0, n)

  it('訊息：第 500 個單位剛好是 emoji 的前半，整個 emoji 拿掉', () => {
    const built = buildClientError({ kind: 'E', message: filler(499) + EMOJI + 'tail' }, context)
    expect(built.message).toBe(filler(499))
    expect(built.message.length).toBe(499)
    expect(LONE_SURROGATE.test(built.message)).toBe(false)
    expect(validateClientError(built)).not.toBeNull()
  })

  it('堆疊、類型、路徑、版本都一樣', () => {
    const built = buildClientError({
      kind: 'K'.repeat(119) + EMOJI + 'tail',
      message: 'm',
      stack: filler(5999) + EMOJI + 'tail'
    }, { ...context, pathname: '/a'.repeat(149) + 'x' + EMOJI + 'tail', release: 'r'.repeat(63) + EMOJI + 'tail' })
    expect(built.kind).toBe('K'.repeat(119))
    expect(built.stack).toBe(filler(5999))
    expect(built.path).toBe('/a'.repeat(149) + 'x')
    expect(built.release).toBe('r'.repeat(63))
    for (const value of [built.kind, built.message, built.stack!, built.path, built.release!]) expect(LONE_SURROGATE.test(value)).toBe(false)
    expect(validateClientError(built)).not.toBeNull()
  })

  it('emoji 完整落在上限內就保留，剛好用滿上限也不多切', () => {
    const exact = filler(498) + EMOJI
    expect(exact.length).toBe(500)
    expect(buildClientError({ kind: 'E', message: exact + 'tail' }, context).message).toBe(exact)
    expect(buildClientError({ kind: 'E', message: filler(498) + EMOJI }, context).message).toBe(exact)
  })

  it('沒超過上限的字串原樣不動，序列化後是合法 JSON 且還原得回來', () => {
    const built = buildClientError({ kind: 'E', message: `按鈕壞了 ${EMOJI}${EMOJI}` }, context)
    expect(built.message).toBe(`按鈕壞了 ${EMOJI}${EMOJI}`)
    expect(JSON.parse(JSON.stringify(built)).message).toBe(built.message)
  })

  it('每個欄位的上限不變（純 ASCII 的長度仍等於上限）', () => {
    const built = buildClientError({ kind: 'K'.repeat(300), message: filler(900), stack: 'at x (/_nuxt/a.js:1:2)\n' + filler(9000) }, { ...context, pathname: '/a'.repeat(400), release: 'r'.repeat(200) })
    expect([built.kind.length, built.message.length, built.stack!.length, built.path.length, built.release!.length]).toEqual([120, 500, 6000, 300, 64])
  })
})
