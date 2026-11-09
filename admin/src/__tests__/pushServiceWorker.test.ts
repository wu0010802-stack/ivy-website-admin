// 後台 PWA 與手機推播的靜態部分（2026-11-05）：Service worker（public/sw.js）的 push／notificationclick 行為、
// 沒有 fetch handler 與快取、manifest 與圖示、index.html 的標籤。sw.js 是不經打包的純 JS，
// 這裡用 node:vm 載入原始碼、塞一個假的 self，驗證註冊了哪些事件與每個事件做了什麼。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const ADMIN = resolve(__dirname, '../..')
const source = readFileSync(resolve(ADMIN, 'public/sw.js'), 'utf8')
const ORIGIN = 'https://ivy.example'

type Listener = (event: Record<string, unknown>) => void
interface FakeClient {
  url: string
  focus: ReturnType<typeof vi.fn>
  navigate: ReturnType<typeof vi.fn>
}

function client(url: string, options: { navigateFails?: boolean } = {}): FakeClient {
  const fake: FakeClient = {
    url,
    focus: vi.fn(async () => fake),
    navigate: vi.fn(async () => (options.navigateFails ? Promise.reject(new Error('navigate not supported')) : fake)),
  }
  return fake
}

function loadWorker(windows: FakeClient[] = []) {
  const listeners = new Map<string, Listener>()
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => undefined),
    },
    registration: { showNotification: vi.fn(async (_title: string, _options: Record<string, unknown>) => undefined) },
  }
  runInNewContext(source, { self, URL, Promise, String }, { filename: 'sw.js' })

  const waits: Promise<unknown>[] = []
  const waitUntil = (promise: Promise<unknown>) => { waits.push(promise) }
  return {
    self,
    listeners,
    async push(data: unknown, { json = true }: { json?: boolean } = {}) {
      const event = {
        waitUntil,
        data: data === undefined ? null : { json: () => { if (!json) throw new SyntaxError('bad json'); return data } },
      }
      listeners.get('push')!(event)
      await Promise.all(waits)
    },
    async click(notification: { data?: unknown }) {
      const close = vi.fn()
      listeners.get('notificationclick')!({ waitUntil, notification: { ...notification, close } })
      await Promise.all(waits)
      return close
    },
  }
}

describe('Service worker：事件與範圍', () => {
  it('只處理 install、activate、push、notificationclick：沒有 fetch handler、不碰 Cache', () => {
    const { listeners } = loadWorker()
    expect([...listeners.keys()].sort()).toEqual(['activate', 'install', 'notificationclick', 'push'])
    expect(source).not.toMatch(/addEventListener\(\s*['"]fetch['"]/)
    expect(source).not.toMatch(/\bcaches\b|CacheStorage|\.match\(|importScripts|\bimport\s/)
  })

  it('install 立刻接手（skipWaiting），activate 認領已開的頁面（clients.claim）', async () => {
    const worker = loadWorker()
    worker.listeners.get('install')!({})
    expect(worker.self.skipWaiting).toHaveBeenCalledTimes(1)
    const waits: Promise<unknown>[] = []
    worker.listeners.get('activate')!({ waitUntil: (p: Promise<unknown>) => waits.push(p) })
    await Promise.all(waits)
    expect(worker.self.clients.claim).toHaveBeenCalledTimes(1)
  })
})

describe('Service worker：push', () => {
  it('依內容顯示通知：標題、內文、tag、點開的網址、圖示', async () => {
    const worker = loadWorker()
    await worker.push({ title: '新的參觀預約', body: '義華校｜11/8（六）10:00', url: '/admin/visit-requests/abc', tag: 'visit-abc' })
    expect(worker.self.registration.showNotification).toHaveBeenCalledWith('新的參觀預約', {
      body: '義華校｜11/8（六）10:00',
      icon: '/admin/pwa-192.png',
      tag: 'visit-abc',
      renotify: true,
      data: { url: '/admin/visit-requests/abc' },
    })
  })

  it('沒有 tag 就不設 renotify（有 renotify 沒 tag 瀏覽器會丟例外）', async () => {
    const worker = loadWorker()
    await worker.push({ title: 'x', body: 'y', url: '/admin/' })
    const options = worker.self.registration.showNotification.mock.calls[0]![1]
    expect(options).not.toHaveProperty('tag')
    expect(options).not.toHaveProperty('renotify')
  })

  it.each([
    ['不是 JSON', undefined, false],
    ['沒有本文', undefined, true],
    ['JSON 但不是物件', 'just a string', true],
    ['JSON 是 null', null, true],
    ['解析丟例外', { title: 'x' }, false],
  ])('%s：顯示通用的「官網後台有新通知」，不吞掉推播（iOS 每則推播都必須顯示通知）', async (_label, data, json) => {
    const worker = loadWorker()
    await worker.push(data, { json })
    expect(worker.self.registration.showNotification).toHaveBeenCalledTimes(1)
    expect(worker.self.registration.showNotification).toHaveBeenCalledWith('官網後台有新通知', {
      icon: '/admin/pwa-192.png',
      data: { url: '/admin/' },
    })
  })

  it('欄位型別不對或是空白：標題用通用的、內文與 tag 略過', async () => {
    const worker = loadWorker()
    await worker.push({ title: 5, body: '   ', url: 7, tag: {} })
    expect(worker.self.registration.showNotification).toHaveBeenCalledWith('官網後台有新通知', {
      icon: '/admin/pwa-192.png',
      data: { url: '/admin/' },
    })
  })

  it('標題與內文過長會截斷', async () => {
    const worker = loadWorker()
    await worker.push({ title: 'T'.repeat(500), body: 'B'.repeat(1000), tag: 'g'.repeat(500) })
    const [title, options] = worker.self.registration.showNotification.mock.calls[0]! as [string, { body: string; tag: string }]
    expect(title).toHaveLength(120)
    expect(options.body).toHaveLength(300)
    expect(options.tag).toHaveLength(100)
  })

  it.each([
    ['/admin/visit-requests/abc', '/admin/visit-requests/abc'],
    ['/admin/system-status#errors', '/admin/system-status#errors'],
    ['/admin/visit-requests?status=open', '/admin/visit-requests?status=open'],
    [`${ORIGIN}/admin/account`, '/admin/account'],
    ['/admin/', '/admin/'],
    ['/admin', '/admin/'],
    ['/administrator', '/admin/'],
    ['/other/page', '/admin/'],
    ['https://evil.example/admin/x', '/admin/'],
    ['//evil.example/admin/x', '/admin/'],
    ['javascript:alert(1)', '/admin/'],
    ['data:text/html,hi', '/admin/'],
    ['/admin/../secret', '/admin/'],
    ['', '/admin/'],
  ])('點開的網址只收同源且在 /admin/ 底下：%s → %s', async (input, expected) => {
    const worker = loadWorker()
    await worker.push({ title: 'x', url: input })
    const options = worker.self.registration.showNotification.mock.calls[0]![1] as { data: { url: string } }
    expect(options.data.url).toBe(expected)
  })
})

describe('Service worker：notificationclick', () => {
  it('已經開著後台視窗：關掉通知、focus 並導到通知的網址，不另開視窗', async () => {
    const open = client(`${ORIGIN}/admin/visit-requests`)
    const worker = loadWorker([client(`${ORIGIN}/preview`), open])
    const close = await worker.click({ data: { url: '/admin/visit-requests/abc' } })
    expect(close).toHaveBeenCalledTimes(1)
    expect(open.focus).toHaveBeenCalledTimes(1)
    expect(open.navigate).toHaveBeenCalledWith('/admin/visit-requests/abc')
    expect(worker.self.clients.openWindow).not.toHaveBeenCalled()
    expect(worker.self.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true })
  })

  it('沒有後台視窗：開新視窗（官網前台的視窗不算）', async () => {
    const worker = loadWorker([client(`${ORIGIN}/campuses/yihua`), client('https://other.example/admin/')])
    await worker.click({ data: { url: '/admin/system-status#errors' } })
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith('/admin/system-status#errors')
  })

  it('沒有任何視窗：開新視窗', async () => {
    const worker = loadWorker([])
    await worker.click({ data: { url: '/admin/visit-requests/abc' } })
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith('/admin/visit-requests/abc')
  })

  it('這個瀏覽器不能導覽既有視窗（navigate 失敗）：改開新視窗', async () => {
    const open = client(`${ORIGIN}/admin/`, { navigateFails: true })
    const worker = loadWorker([open])
    await worker.click({ data: { url: '/admin/visit-requests/abc' } })
    expect(open.focus).toHaveBeenCalled()
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith('/admin/visit-requests/abc')
  })

  it.each([
    ['沒有 data', undefined],
    ['網址是外站', { url: 'https://evil.example/' }],
    ['網址不在 /admin/ 底下', { url: '/other' }],
    ['網址不是字串', { url: { toString: (): string => 'https://evil.example/' } }],
  ])('%s：一律回後台首頁，不會被帶去別處', async (_label, data) => {
    const worker = loadWorker([])
    await worker.click({ data })
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith('/admin/')
  })
})

describe('PWA：manifest、圖示與入口標籤', () => {
  const manifest = JSON.parse(readFileSync(resolve(ADMIN, 'public/manifest.webmanifest'), 'utf8')) as {
    name: string; short_name: string; start_url: string; scope: string; display: string; lang: string
    theme_color: string; background_color: string; icons: { src: string; sizes: string; type: string; purpose: string }[]
  }

  it('名稱、範圍與顯示方式', () => {
    expect(manifest.name).toBe('常春藤官網後台')
    expect(manifest.short_name).toBe('官網後台')
    expect(manifest.start_url).toBe('/admin/')
    expect(manifest.scope).toBe('/admin/')
    expect(manifest.display).toBe('standalone')
    expect(manifest.lang).toBe('zh-Hant-TW')
  })

  it('顏色來自後台現有的 token：主色 --admin-accent、底色 --surface-2（style.css 註解記的就是這組 sRGB）', () => {
    const css = readFileSync(resolve(ADMIN, 'src/style.css'), 'utf8')
    expect(css).toMatch(/--admin-accent: oklch\(0\.587617 0\.138868 241\.9661\); \/\* #0284c7 \*\//)
    expect(css).toMatch(/--surface-2: oklch\(0\.973 0\.005 250\)/)
    expect(manifest.theme_color).toBe('#0284c7')
    expect(manifest.background_color).toBe('#f4f6f9')
  })

  it('圖示：192、512 與 512 maskable，檔案都在 public/、尺寸正確、是 PNG', () => {
    expect(manifest.icons.map(({ src, sizes, purpose }) => [src, sizes, purpose])).toEqual([
      ['/admin/pwa-192.png', '192x192', 'any'],
      ['/admin/pwa-512.png', '512x512', 'any'],
      ['/admin/pwa-maskable-512.png', '512x512', 'maskable'],
    ])
    for (const icon of manifest.icons) {
      const file = readFileSync(resolve(ADMIN, 'public', icon.src.replace('/admin/', '')))
      expect(file.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      const [width, height] = icon.sizes.split('x').map(Number)
      expect([file.readUInt32BE(16), file.readUInt32BE(20)]).toEqual([width, height])
      expect(icon.type).toBe('image/png')
    }
  })

  it('index.html 連到 manifest（Vite 會補上 /admin/ 前綴）、theme-color 與 manifest 同色、iOS 主畫面名稱', () => {
    const html = readFileSync(resolve(ADMIN, 'index.html'), 'utf8')
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}" />`)
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="官網後台" />')
  })
})
