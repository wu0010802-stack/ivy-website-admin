// @vitest-environment happy-dom
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, nextTick, onBeforeUnmount, onMounted, ref, type App } from 'vue'
import VisitLineNotify from '../app/components/VisitLineNotify.vue'
import { liffCspSources, liffIdFromConfig, liffOnlyManifestKeys, normalizeLiffId, urlCarriesLiffCredentials } from '../shared/line-liff'
import { analyticsIdsFromConfig } from '../shared/third-party-analytics'
import { PUBLIC_RESOURCE_CSP, publicCsp, publicResourceCsp, securityHeadersFor } from '../server/utils/security-headers'
import { publicScriptSources } from '../server/utils/script-csp'
import { inLineApp, liffAlignedPath, whenUrlHasNoLiffCredentials } from '../app/utils/line-liff'

// 在 LINE 裡預約、預約當下綁 LINE（2026-11-28，docs/specs/2026-11-28-line-apis-design.md §7.2）。
// LIFF SDK（可拆裝版：core＋三個模組）用 vi.mock 換掉：驗證「什麼條件下才 import SDK」，不連真的 LINE。
const sdk = vi.hoisted(() => ({
  imported: 0,
  used: [] as string[],
  init: vi.fn(),
  isInClient: vi.fn(),
  isLoggedIn: vi.fn(),
  getIDToken: vi.fn()
}))
vi.mock('@line/liff/core', () => {
  sdk.imported += 1
  return { default: { use: (module: { name: string }) => { sdk.used.push(module.name) }, init: sdk.init, isInClient: sdk.isInClient, isLoggedIn: sdk.isLoggedIn, getIDToken: sdk.getIDToken } }
})
vi.mock('@line/liff/is-in-client', () => ({ default: class { name = 'isInClient' } }))
vi.mock('@line/liff/is-logged-in', () => ({ default: class { name = 'isLoggedIn' } }))
vi.mock('@line/liff/get-id-token', () => ({ default: class { name = 'getIDToken' } }))
// 完整版不該被載入：它在 init 時會從 LINE 的 CDN 再載一支腳本，公開頁的 CSP 會擋，init 就失敗。
vi.mock('@line/liff', () => { throw new Error('不該載入完整版的 @line/liff') })

const LIFF_ID = '1234567890-AbcdEfgh'
const LINE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Line/14.20.0'
const SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'

describe('LIFF ID 與 User-Agent 判斷', () => {
  it('格式是 數字-英數；其他一律當作沒設', () => {
    expect(normalizeLiffId(LIFF_ID)).toBe(LIFF_ID)
    expect(normalizeLiffId(`  ${LIFF_ID} `)).toBe(LIFF_ID)
    for (const bad of ['', '1234567890', 'abc-defg', '1234567890-', '1234567890-ab cd', '1234567890-Abcd/..', 1234567890, null, undefined, {}]) {
      expect(normalizeLiffId(bad), String(bad)).toBeNull()
    }
  })

  it('liffIdFromConfig 讀 runtimeConfig.public.lineLiffId', () => {
    expect(liffIdFromConfig({ public: { lineLiffId: LIFF_ID } })).toBe(LIFF_ID)
    expect(liffIdFromConfig({ public: { lineLiffId: 'bad' } })).toBeNull()
    expect(liffIdFromConfig({ public: {} })).toBeNull()
    expect(liffIdFromConfig({})).toBeNull()
    expect(liffIdFromConfig(undefined)).toBeNull()
  })

  it('只有 LINE App 內的瀏覽器（含 Line/）算', () => {
    expect(inLineApp(LINE_UA)).toBe(true)
    expect(inLineApp('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36 Line/14.1.0')).toBe(true)
    expect(inLineApp(SAFARI_UA)).toBe(false)
    expect(inLineApp('Mozilla/5.0 (Macintosh) Chrome/130 Safari/537.36')).toBe(false)
    expect(inLineApp('')).toBe(false)
    expect(inLineApp(null)).toBe(false)
    expect(inLineApp(undefined)).toBe(false)
  })
})

describe('載入 LIFF（app/utils/line-liff.ts）', () => {
  beforeEach(() => {
    vi.resetModules()
    sdk.imported = 0
    sdk.used.length = 0
    sdk.init.mockReset().mockResolvedValue(undefined)
    sdk.isInClient.mockReset().mockReturnValue(true)
    sdk.isLoggedIn.mockReset().mockReturnValue(true)
    sdk.getIDToken.mockReset().mockReturnValue('id-token-abc')
  })
  const load = () => import('../app/utils/line-liff')

  it('沒設 LIFF ID（或格式不符）：不 import SDK、不可用', async () => {
    const { loadLiff, getLiffIdToken } = await load()
    expect(await loadLiff('', LINE_UA)).toBe(false)
    expect(await loadLiff('bad-id', LINE_UA)).toBe(false)
    expect(await loadLiff(undefined, LINE_UA)).toBe(false)
    expect(sdk.imported).toBe(0)
    expect(sdk.init).not.toHaveBeenCalled()
    expect(getLiffIdToken()).toBeNull()
  })

  it('不是 LINE App 內的瀏覽器：不 import SDK', async () => {
    const { loadLiff } = await load()
    expect(await loadLiff(LIFF_ID, SAFARI_UA)).toBe(false)
    expect(sdk.imported).toBe(0)
    expect(sdk.init).not.toHaveBeenCalled()
  })

  it('有設 ID 而且在 LINE 裡：init 帶 liffId，完成後可用、取得 ID token', async () => {
    const { loadLiff, getLiffIdToken } = await load()
    expect(getLiffIdToken()).toBeNull()
    expect(await loadLiff(LIFF_ID, LINE_UA)).toBe(true)
    expect(sdk.imported).toBe(1)
    // 只裝用到的三個模組，而且在 init 之前裝好。
    expect(sdk.used).toEqual(['isInClient', 'isLoggedIn', 'getIDToken'])
    expect(sdk.init).toHaveBeenCalledWith({ liffId: LIFF_ID })
    expect(getLiffIdToken()).toBe('id-token-abc')
  })

  it('同一頁重複呼叫只 init 一次，共用同一個 Promise', async () => {
    const { loadLiff } = await load()
    const first = loadLiff(LIFF_ID, LINE_UA)
    const second = loadLiff(LIFF_ID, LINE_UA)
    expect(second).toBe(first)
    expect(await first).toBe(true)
    expect(await loadLiff(LIFF_ID, LINE_UA)).toBe(true)
    expect(sdk.init).toHaveBeenCalledTimes(1)
  })

  it('init 失敗：吞掉錯誤、不可用、沒有 token', async () => {
    sdk.init.mockRejectedValue(new Error('INIT_FAILED'))
    const { loadLiff, getLiffIdToken } = await load()
    expect(await loadLiff(LIFF_ID, LINE_UA)).toBe(false)
    expect(getLiffIdToken()).toBeNull()
  })

  it('SDK 載入失敗（import 丟錯）一樣吞掉', async () => {
    sdk.init.mockImplementation(() => { throw new Error('boom') })
    const { loadLiff } = await load()
    expect(await loadLiff(LIFF_ID, LINE_UA)).toBe(false)
  })

  it('不在 LIFF client 裡、或還沒登入：不可用，不取 token', async () => {
    sdk.isInClient.mockReturnValue(false)
    const a = await load()
    expect(await a.loadLiff(LIFF_ID, LINE_UA)).toBe(false)
    expect(a.getLiffIdToken()).toBeNull()

    vi.resetModules()
    sdk.isInClient.mockReturnValue(true)
    sdk.isLoggedIn.mockReturnValue(false)
    const b = await load()
    expect(await b.loadLiff(LIFF_ID, LINE_UA)).toBe(false)
    expect(b.getLiffIdToken()).toBeNull()
    expect(sdk.getIDToken).not.toHaveBeenCalled()
  })

  it('getIDToken 回空值或丟錯：當作沒有 token', async () => {
    const { loadLiff, getLiffIdToken } = await load()
    await loadLiff(LIFF_ID, LINE_UA)
    sdk.getIDToken.mockReturnValue(null)
    expect(getLiffIdToken()).toBeNull()
    sdk.getIDToken.mockReturnValue('')
    expect(getLiffIdToken()).toBeNull()
    sdk.getIDToken.mockImplementation(() => { throw new Error('x') })
    expect(getLiffIdToken()).toBeNull()
  })

  it('SDK 只用動態 import 載入，不出現在任何靜態 import（不進其他頁的 chunk）', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|vue)$/.test(name)) files.push(path)
      }
    }
    walk(resolve(__dirname, '../app'))
    walk(resolve(__dirname, '../server'))
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/(?:^|\n)\s*import\s[^\n]*from\s+['"]@line\/liff(?:\/[^'"]*)?['"]/)
      // 完整版（裸的 @line/liff）連動態 import 都不行：只能用 core 與個別模組。
      expect(text, file).not.toMatch(/import\(\s*['"]@line\/liff['"]\s*\)/)
    }
    const source = readFileSync(resolve(__dirname, '../app/utils/line-liff.ts'), 'utf8')
    for (const entry of ['core', 'is-in-client', 'is-logged-in', 'get-id-token']) expect(source).toContain(`import('@line/liff/${entry}')`)
  })
})

describe('liff.init() 之後把網址和路由對齊', () => {
  it('一樣就不動', () => {
    expect(liffAlignedPath({ pathname: '/visit', search: '' }, { fullPath: '/visit' })).toBeNull()
    expect(liffAlignedPath({ pathname: '/visit/yihua', search: '?utm_source=line' }, { fullPath: '/visit/yihua?utm_source=line' })).toBeNull()
  })

  it('路由還停在 LIFF 第一次轉址的網址：換成瀏覽器上的網址（replace）', () => {
    expect(liffAlignedPath({ pathname: '/visit/yihua', search: '' }, { fullPath: '/visit?liff.state=%2Fyihua' })).toBe('/visit/yihua')
  })

  it('liff.* 查詢參數不留在網址上，其他參數保留', () => {
    expect(liffAlignedPath({ pathname: '/visit', search: '?liff.state=%2Fyihua&liff.referrer=x&utm_source=line' }, { fullPath: '/visit?liff.state=%2Fyihua&liff.referrer=x&utm_source=line' }))
      .toBe('/visit?utm_source=line')
    expect(liffAlignedPath({ pathname: '/visit', search: '?liff.referrer=x' }, { fullPath: '/visit?liff.referrer=x' })).toBe('/visit')
  })

  it('路由的 hash 照留，比對時不算進去', () => {
    expect(liffAlignedPath({ pathname: '/visit', search: '' }, { fullPath: '/visit#a', hash: '#a' })).toBeNull()
    expect(liffAlignedPath({ pathname: '/visit/yihua', search: '' }, { fullPath: '/visit#a', hash: '#a' })).toBe('/visit/yihua#a')
  })
})

describe('公開頁 CSP：LIFF', () => {
  const resources = "img-src 'self' data: blob: https://i.ytimg.com; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://www.youtube-nocookie.com https://challenges.cloudflare.com"
  const original = `script-src ${publicScriptSources()}; script-src-attr 'none'; form-action 'self'; ${resources}; frame-ancestors 'self'; base-uri 'self'; object-src 'none'`
  const parts = (csp: string) => Object.fromEntries(csp.split('; ').map(part => [part.split(' ')[0]!, part.split(' ').slice(1)]))
  const none = analyticsIdsFromConfig({})

  it('沒設 LIFF：三條和以前一字不差', () => {
    expect(PUBLIC_RESOURCE_CSP).toBe(resources)
    expect(publicResourceCsp()).toBe(resources)
    expect(publicResourceCsp(none, { liff: false })).toBe(resources)
    expect(publicCsp()).toBe(original)
    expect(publicCsp([], none, {})).toBe(original)
    expect(publicCsp([], none, { liff: false })).toBe(original)
    expect(securityHeadersFor('/', 'production')['Content-Security-Policy']).toBe(original)
    expect(securityHeadersFor('/', 'production', { analytics: none, liff: false })['Content-Security-Policy']).toBe(original)
  })

  it('有設 LIFF：只有 connect-src 多一個 https://api.line.me', () => {
    const csp = publicCsp([], none, { liff: true })
    const base = parts(original)
    const withLiff = parts(csp)
    expect(withLiff['connect-src']).toEqual([...base['connect-src']!, 'https://api.line.me'])
    for (const key of Object.keys(base).filter(key => key !== 'connect-src')) expect(withLiff[key], key).toEqual(base[key])
    expect(securityHeadersFor('/visit', 'production', { analytics: none, liff: true })['Content-Security-Policy']).toBe(csp)
    expect(liffCspSources().connect).toEqual(['https://api.line.me'])
  })

  it('和 GA4 同時開：各加各的，LIFF 附在最後', () => {
    const ga = analyticsIdsFromConfig({ public: { gaMeasurementId: 'G-TEST123456' } })
    const connect = parts(publicCsp([], ga, { liff: true }))['connect-src']!
    expect(connect).toContain('https://*.google-analytics.com')
    expect(connect.at(-1)).toBe('https://api.line.me')
  })

  it('script-src 不因 LIFF 改變（SDK 是 npm 打包的）；後台 CSP 不放行', () => {
    expect(parts(publicCsp([], none, { liff: true }))['script-src']).toEqual(parts(original)['script-src'])
    expect(securityHeadersFor('/admin/', 'production', { liff: true })['Content-Security-Policy']).not.toContain('api.line.me')
  })
})

// ---- VisitLineNotify ----
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)

const BASE = '/api/website/v1/public/visit-manage'
const FRIEND_URL = 'https://line.me/R/ti/p/%40ivy-yihua'

describe('VisitLineNotify：預約當下已綁 LINE', () => {
  let app: App | null = null
  let root: HTMLElement
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchMock)
    root = document.createElement('div')
    document.body.appendChild(root)
  })
  afterEach(() => {
    app?.unmount()
    app = null
    root.remove()
    vi.useRealTimers()
  })

  async function flush() {
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve()
      await nextTick()
    }
  }
  async function mountWith(props: Record<string, unknown>) {
    app = createApp(VisitLineNotify, props)
    app.mount(root)
    await flush()
  }
  const button = (text: string) => [...root.querySelectorAll('button')].find(el => el.textContent?.includes(text))!
  const urls = () => fetchMock.mock.calls.map(call => String(call[0]))

  it('有初始狀態就直接顯示已用 LINE 接收通知，不傳代碼、沒有「用 LINE 接收通知」按鈕', async () => {
    await mountWith({ token: 'tok-1', visitId: 'v1', initial: { linked: true, friend: true, account_name: '常春藤義華', add_friend_url: FRIEND_URL } })
    expect(root.textContent).toContain('已用 LINE 接收通知')
    expect(root.textContent).toContain('「常春藤義華」')
    expect(root.textContent).not.toContain('用 LINE 接收參觀通知')
    expect(root.textContent).not.toContain('還沒加入')
    expect(root.querySelector('a.line-notify-button')).toBeNull()
    // 已是好友：不查、不換 session。
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('friend === false：標題不變，多一段還沒加好友的說明與「加入好友」連結（新分頁）', async () => {
    fetchMock.mockResolvedValue({ available: true, linked: true, friend: false })
    await mountWith({ token: 'tok-1', visitId: 'v1', initial: { linked: true, friend: false, account_name: '常春藤義華', add_friend_url: FRIEND_URL } })
    expect(root.querySelector('.line-notify-title')!.textContent).toBe('已用 LINE 接收通知')
    expect(root.textContent).toContain('還沒加入「常春藤義華」好友，LINE 送不到通知。')
    const add = root.querySelector<HTMLAnchorElement>(`a[href="${FRIEND_URL}"]`)!
    expect(add.textContent).toBe('加入好友')
    expect(add.target).toBe('_blank')
    expect(add.rel).toContain('noopener')
  })

  it('加好友連結不是 https 就不放進 href', async () => {
    fetchMock.mockResolvedValue({ available: true, linked: true, friend: false })
    await mountWith({ token: 'tok-1', initial: { linked: true, friend: false, account_name: 'x', add_friend_url: 'javascript:alert(1)' } })
    expect(root.textContent).toContain('還沒加入')
    expect(root.querySelector('a.line-notify-button')).toBeNull()
  })

  it('friend === false：先用 token 換 session，之後每 4 秒查一次；變成好友就把那段收掉並停止查詢', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/exchange') ? {} : { available: true, linked: true, friend: false }))
    await mountWith({ token: 'tok-1', visitId: 'v1', initial: { linked: true, friend: false, account_name: '常春藤義華', add_friend_url: FRIEND_URL } })
    expect(fetchMock.mock.calls[0]).toEqual([`${BASE}/exchange`, { method: 'POST', headers: { 'X-Ivy-Parent': '1' }, body: { token: 'tok-1' } }])
    expect(urls().filter(url => url.includes('/line-notify'))).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(4000)
    expect(urls()).toContain(`${BASE}/line-notify?visit_request_id=v1`)
    expect(root.textContent).toContain('還沒加入')

    fetchMock.mockImplementation(async () => ({ available: true, linked: true, friend: true, account_name: '常春藤義華' }))
    await vi.advanceTimersByTimeAsync(4000)
    await flush()
    expect(root.textContent).not.toContain('還沒加入')
    expect(root.textContent).toContain('已用 LINE 接收通知')
    const calls = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchMock.mock.calls.length).toBe(calls)
    // 只換過一次 session。
    expect(urls().filter(url => url.endsWith('/exchange'))).toHaveLength(1)
  })

  it('查詢超過 30 分鐘就不再查', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/exchange') ? {} : { available: true, linked: true, friend: false }))
    await mountWith({ token: 'tok-1', initial: { linked: true, friend: false, account_name: 'x', add_friend_url: FRIEND_URL } })
    await vi.advanceTimersByTimeAsync(31 * 60_000)
    const calls = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('換 session 失敗：不查、提示照舊', async () => {
    fetchMock.mockRejectedValue(new Error('401'))
    await mountWith({ token: 'bad', initial: { linked: true, friend: false, account_name: 'x', add_friend_url: FRIEND_URL } })
    await vi.advanceTimersByTimeAsync(12_000)
    expect(urls().filter(url => url.includes('/line-notify'))).toHaveLength(0)
    expect(root.textContent).toContain('還沒加入')
  })

  it('結果頁按「不再用 LINE 接收」：先用 token 換 session 再 DELETE（帶案件 id）', async () => {
    fetchMock.mockResolvedValue({})
    await mountWith({ token: 'tok-1', visitId: 'v1', initial: { linked: true, friend: true, account_name: '常春藤義華', add_friend_url: FRIEND_URL } })
    expect(fetchMock).not.toHaveBeenCalled()
    button('不再用 LINE 接收').click()
    await flush()
    expect(fetchMock.mock.calls[0]).toEqual([`${BASE}/exchange`, { method: 'POST', headers: { 'X-Ivy-Parent': '1' }, body: { token: 'tok-1' } }])
    expect(fetchMock.mock.calls[1]).toEqual([`${BASE}/line-notify?visit_request_id=v1`, { method: 'DELETE', headers: { 'X-Ivy-Parent': '1' } }])
    expect(root.textContent).toContain('用 LINE 接收參觀通知')
    expect(root.textContent).not.toContain('已用 LINE 接收通知')
  })

  it('friend === false 時解除：session 只換一次、輪詢停止', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/exchange') ? {} : { available: true, linked: true, friend: false }))
    await mountWith({ token: 'tok-1', initial: { linked: true, friend: false, account_name: 'x', add_friend_url: FRIEND_URL } })
    button('不再用 LINE 接收').click()
    await flush()
    expect(urls().filter(url => url.endsWith('/exchange'))).toHaveLength(1)
    expect(fetchMock.mock.calls.at(-1)![1]).toMatchObject({ method: 'DELETE' })
    const calls = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('修改頁（check）：GET 回 friend === false 一樣顯示提示並輪詢，不需要 exchange', async () => {
    fetchMock.mockResolvedValue({ available: true, linked: true, friend: false, account_name: '常春藤義華', add_friend_url: FRIEND_URL })
    await mountWith({ check: true, visitId: 'v1' })
    expect(root.textContent).toContain('還沒加入「常春藤義華」好友')
    expect(root.querySelector(`a[href="${FRIEND_URL}"]`)).not.toBeNull()
    fetchMock.mockResolvedValue({ available: true, linked: true, friend: true, account_name: '常春藤義華' })
    await vi.advanceTimersByTimeAsync(4000)
    await flush()
    expect(root.textContent).not.toContain('還沒加入')
    expect(urls().some(url => url.endsWith('/exchange'))).toBe(false)
  })

  it('修改頁：friend 是 null（查不到）不顯示提示', async () => {
    fetchMock.mockResolvedValue({ available: true, linked: true, friend: null, account_name: '常春藤義華' })
    await mountWith({ check: true })
    expect(root.textContent).toContain('已用 LINE 接收通知')
    expect(root.textContent).not.toContain('還沒加入')
  })
})

describe('預約表單接線（原始碼比對，同 visit-form-result.spec.ts 的做法）', () => {
  const form = readFileSync(resolve(__dirname, '../app/components/VisitForm.vue'), 'utf8')

  it('送單時有 token 才多帶 line_id_token；送單當下才取', () => {
    expect(form).toContain('const lineIdToken = await liffTokenForSubmit()')
    expect(form).toContain('...(lineIdToken ? { line_id_token: lineIdToken } : {}),')
    expect(form.indexOf('const lineIdToken')).toBeLessThan(form.indexOf("'/api/website/v1/public/visit-requests'"))
  })

  it('ID token 不寫進任何儲存空間或統計', () => {
    const util = readFileSync(resolve(__dirname, '../app/utils/line-liff.ts'), 'utf8')
    for (const text of [util]) expect(text).not.toMatch(/localStorage|sessionStorage|document\.cookie|useCookie|trackEngagement/)
    expect(form).not.toMatch(/(?:localStorage|sessionStorage)[^\n]*(?:lineIdToken|line_id_token)/)
  })

  it('掛載時背景啟動、不阻塞；liff.init() 完成前不改網址（更換校區先等）；完成後對齊網址', () => {
    expect(form).toContain('onMounted(() => { void startLiff() })')
    expect(form).toContain('loadLiff(useRuntimeConfig().public.lineLiffId, navigator.userAgent)')
    expect(form).toMatch(/if \(liffReady\) await liffReady\n\s+await router\.push\('\/visit'\)/)
    expect(form).toContain('await navigateTo(target, { replace: true })')
  })

  it('回應的 line_notify 存下來傳給結果頁；待確認的預約有 line_notify 也顯示', () => {
    expect(form).toContain('lineNotifyResult.value = created?.line_notify?.linked ? created.line_notify : null')
    expect(form).toContain(`<VisitLineNotify v-if="manageToken && (lineNotifyResult || (resultKind === 'booked' && bookingConfig?.line_notify_enabled))" :token="manageToken" :visit-id="receiptId" :initial="lineNotifyResult" />`)
  })

  it('Email 說明：line_liff_enabled 而且 LIFF 可用才多一句；原本 PNP 那句不變', () => {
    expect(form).toContain('bookingConfig.value?.line_liff_enabled && liffUsable.value ? `${emailPnpHint.value}預約通知也會傳到您的 LINE。` : emailPnpHint.value')
    expect(form).toContain('<p id="visit-email-hint" class="visit-field-hint">{{ emailHint }}</p>')
  })

  it('nuxt.config 有 lineLiffId，預設空白、不讀 process.env', () => {
    const config = readFileSync(resolve(__dirname, '../nuxt.config.ts'), 'utf8')
    expect(config).toMatch(/lineLiffId: ''/)
    expect(config).not.toMatch(/process\.env\.NUXT_PUBLIC_LINE_LIFF_ID/)
  })
})

describe('網址帶著 LIFF 憑證時，第三方統計先不啟動', () => {
  it('urlCarriesLiffCredentials：hash 裡的 token 或 query 的 liff.* 都算；平常的網址與歸因參數不算', () => {
    expect(urlCarriesLiffCredentials('', '#access_token=abc&context_token=def')).toBe(true)
    expect(urlCarriesLiffCredentials('', '#x=1&id_token=abc')).toBe(true)
    expect(urlCarriesLiffCredentials('?liff.state=%2Fyihua', '')).toBe(true)
    expect(urlCarriesLiffCredentials('?utm_source=line&liff.referrer=https%3A%2F%2Fexample.com', '')).toBe(true)
    expect(urlCarriesLiffCredentials('', '')).toBe(false)
    expect(urlCarriesLiffCredentials('?utm_source=line&gclid=1', '#about')).toBe(false)
    // 預約修改頁的 #token= 不是 LIFF 的憑證（那一頁另有「不送事件」的規則）。
    expect(urlCarriesLiffCredentials('', '#token=abc')).toBe(false)
    expect(urlCarriesLiffCredentials('?campus=life', '#my_access_token_note')).toBe(false)
  })

  const fakeWindow = (search: string, hash: string) => {
    const location = { search, hash }
    return { location, setInterval: (fn: () => void, ms: number) => setInterval(fn, ms), clearInterval: (id: number) => clearInterval(id) } as unknown as Window & { location: { search: string; hash: string } }
  }

  it('網址乾淨：立刻同步執行，waited 是 false', () => {
    const run = vi.fn()
    whenUrlHasNoLiffCredentials(fakeWindow('?utm_source=line', ''), run)
    expect(run).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('帶著憑證：等 SDK 把網址清乾淨才執行一次，waited 是 true', () => {
    vi.useFakeTimers()
    const win = fakeWindow('?liff.state=%2Fyihua', '#access_token=abc')
    const run = vi.fn()
    whenUrlHasNoLiffCredentials(win, run)
    vi.advanceTimersByTime(1000)
    expect(run).not.toHaveBeenCalled()
    win.location.hash = ''
    vi.advanceTimersByTime(200)
    expect(run).not.toHaveBeenCalled() // query 還有 liff.state
    win.location.search = ''
    vi.advanceTimersByTime(200)
    expect(run).toHaveBeenCalledExactlyOnceWith(true)
    vi.advanceTimersByTime(60_000)
    expect(run).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('一直沒清乾淨（LIFF 初始化失敗）：過了時限就放棄，這一頁不啟動', () => {
    vi.useFakeTimers()
    const win = fakeWindow('', '#access_token=abc')
    const run = vi.fn()
    whenUrlHasNoLiffCredentials(win, run, { timeoutMs: 2000 })
    vi.advanceTimersByTime(5000)
    win.location.hash = ''
    vi.advanceTimersByTime(5000)
    expect(run).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('統計外掛照這個順序：先取好 router 與 head，網址乾淨才建立統計、才送第一次頁面瀏覽', () => {
    const source = readFileSync(resolve(__dirname, '../app/plugins/third-party-analytics.client.ts'), 'utf8')
    const guard = source.indexOf('whenUrlHasNoLiffCredentials(window')
    expect(guard).toBeGreaterThan(source.indexOf('const router = useRouter()'))
    expect(source.indexOf('createThirdPartyAnalytics(ids')).toBeGreaterThan(guard)
    expect(source).toMatch(/if \(waited\) pageView\(\)\s+else app\.hook\('app:mounted', pageView\)/)
  })
})

describe('LIFF SDK 不讓一般訪客預先下載（build:manifest）', () => {
  it('SDK 的進入點與只被它們引用的共用區塊算 LIFF 專用；別的區塊也引用的留著', () => {
    const manifest = {
      '../node_modules/@line/liff/core/index.mjs': { src: '../node_modules/@line/liff/core/index.mjs', imports: ['_liff-shared.js', '_vue.js'] },
      '../node_modules/@line/liff/get-id-token.mjs': { src: '../node_modules/@line/liff/get-id-token.mjs', imports: ['_liff-shared.js', '_store.js'] },
      '_liff-shared.js': { imports: ['_liff-deep.js', '_vue.js'] },
      '_liff-deep.js': {},
      '_store.js': { imports: ['_store-dep.js'] },
      '_store-dep.js': {},
      '_vue.js': {},
      'pages/visit/[[key]].vue': { src: 'pages/visit/[[key]].vue', imports: ['_vue.js'], dynamicImports: ['../node_modules/@line/liff/core/index.mjs', '../node_modules/@line/liff/get-id-token.mjs'] },
      // 別的頁面也用到 _store.js：它和它的依賴都不是 LIFF 專用。
      'pages/about.vue': { src: 'pages/about.vue', imports: ['_store.js'] }
    }
    expect(liffOnlyManifestKeys(manifest).sort()).toEqual([
      '../node_modules/@line/liff/core/index.mjs', '../node_modules/@line/liff/get-id-token.mjs', '_liff-deep.js', '_liff-shared.js'
    ])
    expect(liffOnlyManifestKeys({ 'pages/about.vue': { src: 'pages/about.vue' } })).toEqual([])
  })

  it('nuxt.config 的 build:manifest 把這些區塊的 prefetch 關掉', () => {
    const config = readFileSync(resolve(__dirname, '../nuxt.config.ts'), 'utf8')
    expect(config).toMatch(/for \(const key of liffOnlyManifestKeys\(manifest\)\) manifest\[key\]!\.prefetch = false/)
  })
})
