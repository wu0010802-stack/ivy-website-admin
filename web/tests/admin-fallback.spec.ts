// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// /admin 底下找不到的路徑回後台入口（SPA 的 history 路由）；找不到的資源與 PWA 固定檔名（sw.js、manifest、圖示）回 404，
// 不能回 index.html（200）：建置漏檔時瀏覽器會把一份 HTML 當成 Service worker 或 manifest 註冊（2026-11-05）。

const servers: Server[] = []
const dirs: string[] = []
const INDEX = '<!doctype html><title>後台</title><div id="app"></div>'

async function start(options: { adminDistDir?: string | null; withIndex?: boolean } = {}) {
  vi.resetModules()
  const h3 = await import('h3')
  for (const name of ['defineEventHandler', 'setResponseHeader', 'createError'] as const) vi.stubGlobal(name, h3[name])
  const dir = await mkdtemp(join(tmpdir(), 'admin-dist-'))
  dirs.push(dir)
  if (options.withIndex !== false) await writeFile(join(dir, 'index.html'), INDEX)
  const adminDistDir = options.adminDistDir === undefined ? dir : options.adminDistDir
  vi.stubGlobal('useRuntimeConfig', () => ({ adminDistDir: adminDistDir ?? '' }))
  const { default: handler } = await import('../server/routes/admin/[...path].get')
  const server = createServer(h3.toNodeListener(h3.createApp().use(handler)))
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  return (path: string) => fetch(`${base}${path}`)
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) })))
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('後台 SPA fallback', () => {
  it('前端路由（找不到檔的 history 路徑）回後台入口 HTML，不快取、不給搜尋引擎', async () => {
    const get = await start()
    for (const path of ['/admin/visit-requests', '/admin/visit-requests/7f1e2c3a-1b2c-4d5e-8f90-123456789abc', '/admin/system-status?x=1#errors', '/admin/account']) {
      const response = await get(path)
      expect(response.status, path).toBe(200)
      expect(await response.text()).toBe(INDEX)
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    }
  })

  it('PWA 固定檔名找不到一律 404（sw.js、manifest.webmanifest、pwa-*.png），不是 index.html', async () => {
    const get = await start()
    for (const path of [
      '/admin/sw.js',
      '/admin/sw.js?v=3',
      '/admin/manifest.webmanifest',
      '/admin/pwa-192.png',
      '/admin/pwa-512.png',
      '/admin/pwa-maskable-512.png',
      '/admin/%73w.js', // nitro 會先解碼再找檔
      '/admin/pwa-%31%39%32.png',
    ]) {
      const response = await get(path)
      expect(response.status, path).toBe(404)
      expect(await response.text(), path).not.toContain('id="app"')
    }
  })

  it('/admin/assets/ 底下找不到照舊 404；只有固定檔名才算，路徑更深或名稱不同的不受影響', async () => {
    const get = await start()
    expect((await get('/admin/assets/index-abc123.js')).status).toBe(404)
    // 不是後台根目錄的固定檔，維持前端路由（由前端顯示找不到）。
    for (const path of ['/admin/sw.js/extra', '/admin/sub/sw.js', '/admin/sw.json', '/admin/pwa.png', '/admin/pwa-192.jpg']) {
      expect((await get(path)).status, path).toBe(200)
    }
  })

  it('不合法的百分比編碼不會讓處理器丟例外', async () => {
    const get = await start()
    expect((await get('/admin/%E0%A4%A')).status).toBe(200)
  })

  it('沒有設定後台建置目錄：一律 404；入口檔讀不到：503', async () => {
    expect((await (await start({ adminDistDir: null }))('/admin/visit-requests')).status).toBe(404)
    expect((await (await start({ withIndex: false }))('/admin/visit-requests')).status).toBe(503)
  })
})
