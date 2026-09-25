// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { crawlerIndexable, EMPTY_SITEMAP, robotsTxt } from '../app/utils/seo'

// robots.txt、sitemap.xml、llms.txt 要同時尊重部署的正式索引設定與已發布
// site_meta 的 allow_indexing（B11 #61）：任一關閉就擋爬蟲、sitemap 為空。
const state = vi.hoisted(() => ({
  indexingEnabled: true,
  siteOrigin: 'https://ivy.example',
  allowIndexing: undefined as boolean | undefined,
  loads: 0
}))

vi.mock('../server/utils/published-site', () => ({
  loadPublishedSite: async () => {
    state.loads++
    return {
      schemaVersion: 'test',
      releaseId: 'r1',
      content: {
        siteMeta: { brandName: '常春藤', description: '官網', allowIndexing: state.allowIndexing },
        campuses: [{ key: 'renwu', name: '仁武校', district: '仁武區', address: '高雄市', phone: '07-000-0000' }]
      }
    }
  }
}))

const headers: Record<string, string> = {}

beforeEach(() => {
  state.indexingEnabled = true
  state.siteOrigin = 'https://ivy.example'
  state.allowIndexing = undefined
  state.loads = 0
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('setResponseHeader', (_event: unknown, name: string, value: string) => { headers[name] = value })
  vi.stubGlobal('useRuntimeConfig', () => ({
    websiteEnv: 'test',
    websiteApiInternalBase: 'http://127.0.0.1:0',
    public: { indexingEnabled: state.indexingEnabled, siteOrigin: state.siteOrigin, contentMode: 'live' }
  }))
})
afterEach(() => vi.unstubAllGlobals())

type Handler = (event: unknown) => Promise<string>
async function route(name: 'robots.txt' | 'sitemap.xml' | 'llms.txt'): Promise<Handler> {
  return (await import(`../server/routes/${name}.get.ts`)).default as Handler
}

describe('搜尋引擎收錄的閘門', () => {
  it('部署開啟、有正式網址、site_meta 沒關才可收錄；未發布過 site_meta 視為允許', () => {
    expect(crawlerIndexable(true, 'https://ivy.example', { allowIndexing: true })).toBe(true)
    expect(crawlerIndexable(true, 'https://ivy.example', undefined)).toBe(true)
    expect(crawlerIndexable(true, 'https://ivy.example', { allowIndexing: false })).toBe(false)
    expect(crawlerIndexable(false, 'https://ivy.example', { allowIndexing: true })).toBe(false)
    expect(crawlerIndexable(true, '', { allowIndexing: true })).toBe(false)
    expect(robotsTxt('https://ivy.example', false)).toBe('User-agent: *\nDisallow: /\n')
    expect(robotsTxt('https://ivy.example', true)).toContain('Sitemap: https://ivy.example/sitemap.xml')
    expect(EMPTY_SITEMAP).not.toContain('<url>')
  })

  it('全部開啟時 robots.txt 放行公開頁、sitemap 列出校區、llms.txt 可讀', async () => {
    state.allowIndexing = true
    const robots = await (await route('robots.txt'))({})
    expect(robots).not.toBe('User-agent: *\nDisallow: /\n')
    expect(robots).toContain('Disallow: /admin')
    expect(await (await route('sitemap.xml'))({})).toContain('https://ivy.example/campuses/renwu')
    expect(await (await route('llms.txt'))({})).toContain('仁武校')
  })

  it('後台關掉收錄（已發布 allow_indexing=false）：robots.txt 全擋、sitemap 為空、llms.txt 404', async () => {
    state.allowIndexing = false
    expect(await (await route('robots.txt'))({})).toBe('User-agent: *\nDisallow: /\n')
    expect(headers['Content-Type']).toBe('text/plain; charset=utf-8')
    expect(await (await route('sitemap.xml'))({})).toBe(EMPTY_SITEMAP)
    await expect((await route('llms.txt'))({})).rejects.toMatchObject({ statusCode: 404 })
  })

  it('部署沒開正式索引：不讀內容就全擋，後台允許也一樣', async () => {
    state.indexingEnabled = false
    state.allowIndexing = true
    expect(await (await route('robots.txt'))({})).toBe('User-agent: *\nDisallow: /\n')
    expect(await (await route('sitemap.xml'))({})).toBe(EMPTY_SITEMAP)
    await expect((await route('llms.txt'))({})).rejects.toMatchObject({ statusCode: 404 })
    expect(state.loads).toBe(0)
  })
})
