// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createHooks } from 'hookable'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { entranceBootstrap } from '../app/utils/entrance-policy'
import { MOTION_LAYOUT_SCRIPT } from '../app/utils/inline-scripts'
import { TURNSTILE_SCRIPT_SRC } from '../app/utils/turnstile'
import { CLIENT_INLINE_SCRIPTS, inlineScriptHashes, publicScriptSources, scriptHashSource, TURNSTILE_ORIGIN } from '../server/utils/script-csp'
import { ADMIN_CSP, publicCsp } from '../server/utils/security-headers'

const webRoot = join(__dirname, '..')

describe('公開頁 script-src 的雜湊（2026-11-04 資安強化）', () => {
  it('hash-source 是 UTF-8 本文的 sha256（CSP 規格的已知值）', () => {
    expect(scriptHashSource('')).toBe("'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='")
    expect(scriptHashSource('alert(1)')).toBe("'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='")
  })

  it('只算會執行的 inline script：略過外部腳本與 JSON 資料區塊，importmap 要算，重複的只留一個', () => {
    const html = [
      '<script type="importmap">{"imports":{"#entry":"/_nuxt/a.js"}}</script>',
      '<script data-hid="motion-layout">a()</script>',
      '<script type="module" src="/_nuxt/a.js" crossorigin></script>',
      '<script type="application/json" data-nuxt-data="nuxt-app" id="__NUXT_DATA__">[1]</script>',
      "<script type='application/ld+json'>{\"@context\":\"https://schema.org\"}</script>",
      '<SCRIPT data-src="/x.js">b()</SCRIPT >',
      '<script>a()</script>',
      '<script type="module">\nimport "x"\n</script>'
    ].join('\n')
    expect(inlineScriptHashes(html)).toEqual([
      scriptHashSource('{"imports":{"#entry":"/_nuxt/a.js"}}'),
      scriptHashSource('a()'),
      scriptHashSource('b()'),
      scriptHashSource('\nimport "x"\n')
    ])
  })

  it('預約表單的 Turnstile 腳本來源在 script-src 裡', () => {
    expect(TURNSTILE_ORIGIN).toBe(new URL(TURNSTILE_SCRIPT_SRC).origin)
    expect(publicCsp()).toContain(` ${TURNSTILE_ORIGIN} `)
  })

  it('用戶端換頁會插入的 inline script，雜湊事先放進每一頁的 CSP', () => {
    expect(CLIENT_INLINE_SCRIPTS).toEqual([MOTION_LAYOUT_SCRIPT, entranceBootstrap])
    for (const body of CLIENT_INLINE_SCRIPTS) expect(publicCsp()).toContain(scriptHashSource(body))
    // 這一頁的雜湊加在後面，與事先登記的重複時不重列。
    const page = scriptHashSource('window.__NUXT__={}')
    expect(publicScriptSources([page, scriptHashSource(MOTION_LAYOUT_SCRIPT)]).split(' ').filter(s => s === scriptHashSource(MOTION_LAYOUT_SCRIPT))).toHaveLength(1)
    expect(publicCsp([page])).toContain(page)
  })

  it('app 與 nuxt.config 的 inline script 一律取自登記過的常數（新增的沒登記，換頁插入時會被 CSP 擋）', () => {
    // useHead／app.head 的 script 本文只能是這幾個常數；JSON-LD 是資料區塊（不執行），style 不受 script-src 管。
    const allowed = new Set(['MOTION_LAYOUT_SCRIPT', 'entranceBootstrap', 'entranceCoverStyles', 'serializeJsonLd'])
    const files: string[] = [join(webRoot, 'nuxt.config.ts')]
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) {
          if (name !== '__tests__' && name !== 'generated') walk(path)
        } else if (/\.(vue|ts)$/.test(name) && !/\.(test|spec)\.ts$/.test(name)) {
          files.push(path)
        }
      }
    }
    walk(join(webRoot, 'app'))
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/\b(?:innerHTML|textContent)\s*:\s*([A-Za-z_$][\w$]*|[`'"])/g)) {
        if (!allowed.has(match[1] ?? '')) offenders.push(`${relative(webRoot, file)}: ${match[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('security-headers 外掛的 render:html／render:response', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function loadPlugin(initial: Record<string, string>) {
    const headers = new Map(Object.entries(initial).map(([k, v]) => [k.toLowerCase(), v]))
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    vi.stubGlobal('useRuntimeConfig', () => ({ websiteEnv: 'production' }))
    vi.stubGlobal('setResponseHeader', (_e: unknown, name: string, value: string) => headers.set(name.toLowerCase(), value))
    vi.stubGlobal('getResponseHeader', (_e: unknown, name: string) => headers.get(name.toLowerCase()))
    vi.stubGlobal('removeResponseHeader', (_e: unknown, name: string) => headers.delete(name.toLowerCase()))
    const { default: plugin } = await import('../server/plugins/security-headers')
    const hooks = createHooks<Record<string, (...args: never[]) => unknown>>()
    ;(plugin as (app: { hooks: typeof hooks }) => void)({ hooks })
    return { hooks, headers }
  }

  it('Nuxt 渲染的頁面：CSP 換成含這一頁 inline script 雜湊的版本', async () => {
    const { hooks, headers } = await loadPlugin({ 'Content-Security-Policy': publicCsp() })
    const html = {
      head: ['<script type="importmap">{"imports":{}}</script><script data-hid="motion-layout">' + MOTION_LAYOUT_SCRIPT + '</script>'],
      bodyPrepend: [],
      body: ['<div id="__nuxt"></div>'],
      bodyAppend: ['<script>window.__NUXT__={}</script><script type="application/json" id="__NUXT_DATA__">[]</script>']
    }
    await hooks.callHook('render:html', html as never, { event: {} } as never)
    const csp = headers.get('content-security-policy') ?? ''
    expect(csp).toBe(publicCsp([scriptHashSource('{"imports":{}}'), scriptHashSource(MOTION_LAYOUT_SCRIPT), scriptHashSource('window.__NUXT__={}')]))
    expect(csp).toContain(scriptHashSource('window.__NUXT__={}'))
    expect(csp).not.toContain(scriptHashSource('[]'))
  })

  it('app 本體與 Teleport 裡漏出的 script 不算雜湊（2026-11-12：伺服器端注入不能自己放行）', async () => {
    const { hooks, headers } = await loadPlugin({ 'Content-Security-Policy': publicCsp() })
    const injected = 'fetch("/api/website/v1/auth/me")'
    const html = {
      head: ['<script type="importmap">{"imports":{}}</script>'],
      bodyPrepend: [`<div class="curtain"><script>${injected}</script></div>`],
      body: [`<div id="__nuxt"><p>news</p><script>${injected}</script><img src=x onerror="${injected}"></div>`],
      bodyAppend: ['<script>window.__NUXT__={}</script>']
    }
    await hooks.callHook('render:html', html as never, { event: {} } as never)
    const csp = headers.get('content-security-policy') ?? ''
    expect(csp).toBe(publicCsp([scriptHashSource('{"imports":{}}'), scriptHashSource('window.__NUXT__={}')]))
    expect(csp).not.toContain(scriptHashSource(injected))
  })

  it('元件 Teleport 用的登記過的 inline script（CLIENT_INLINE_SCRIPTS）照樣放行', async () => {
    const { hooks, headers } = await loadPlugin({ 'Content-Security-Policy': publicCsp() })
    const html = { head: [], bodyPrepend: [`<script>${MOTION_LAYOUT_SCRIPT}</script>`], body: [], bodyAppend: [] }
    await hooks.callHook('render:html', html as never, { event: {} } as never)
    expect(headers.get('content-security-policy')).toContain(scriptHashSource(MOTION_LAYOUT_SCRIPT))
  })

  it('後台 CSP 不會被公開頁的版本蓋掉', async () => {
    const { hooks, headers } = await loadPlugin({ 'Content-Security-Policy': ADMIN_CSP })
    await hooks.callHook('render:html', { head: ['<script>x()</script>'], bodyPrepend: [], body: [], bodyAppend: [] } as never, { event: {} } as never)
    expect(headers.get('content-security-policy')).toBe(ADMIN_CSP)
  })

  it('不送 x-powered-by（renderer 寫進回應與 render:response 的 headers 兩邊都拿掉）', async () => {
    const { hooks, headers } = await loadPlugin({ 'x-powered-by': 'Nuxt' })
    const response = { body: '<html></html>', headers: { 'content-type': 'text/html', 'x-powered-by': 'Nuxt' } as Record<string, string> }
    await hooks.callHook('render:response', response as never, { event: {} } as never)
    expect(response.headers['x-powered-by']).toBeUndefined()
    expect(response.headers['content-type']).toBe('text/html')
    expect(headers.has('x-powered-by')).toBe(false)
  })
})
