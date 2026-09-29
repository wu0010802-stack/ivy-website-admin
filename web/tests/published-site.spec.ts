import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { applyContentOverlay, type ContentOverlay } from '../app/utils/content-overlay'
import { loadPublishedSite, PUBLISHED_SITE_TTL_MS, resetPublishedSiteCache } from '../server/utils/published-site'

const config = { websiteEnv: 'production', websiteApiInternalBase: 'http://api.test', public: { contentMode: 'live' } }
const live = (release: string) => ({ release_id: release, schema_version: '1', content: {} })
const ok = (release: string, etag: string) => new Response(JSON.stringify(live(release)), { status: 200, headers: { 'content-type': 'application/json', etag } })

beforeEach(() => {
  resetPublishedSiteCache()
  vi.stubGlobal('createError', (value: object) => Object.assign(new Error('unavailable'), value))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-29T00:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetPublishedSiteCache()
})

it('正式環境禁止 fixture，live 失敗維持 503，不回示範資料', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('upstream failure')))
  await expect(loadPublishedSite({ ...config, public: { contentMode: 'fixture' } })).rejects.toMatchObject({ statusCode: 503 })
  await expect(loadPublishedSite(config)).rejects.toMatchObject({ statusCode: 503 })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"detail":{"code":"NO_PUBLISHED_CONTENT"}}', { status: 503 })))
  await expect(loadPublishedSite(config)).rejects.toMatchObject({ statusCode: 503 })
  expect(console.error).toHaveBeenCalled()
})

it('TTL 內共用同一份，不再打 API（稽核 public-site-no-cache）', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(ok('v1', '"e1"'))
  vi.stubGlobal('fetch', fetchMock)
  expect((await loadPublishedSite(config)).releaseId).toBe('v1')
  vi.setSystemTime(Date.now() + PUBLISHED_SITE_TTL_MS - 1)
  expect((await loadPublishedSite(config)).releaseId).toBe('v1')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(PUBLISHED_SITE_TTL_MS).toBeLessThanOrEqual(5000)
})

it('過期後帶 If-None-Match 重新驗證：304 沿用，200 換新版本', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(ok('v1', '"e1"'))
    .mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"e1"' } }))
    .mockResolvedValueOnce(ok('v2', '"e2"'))
  vi.stubGlobal('fetch', fetchMock)
  const first = await loadPublishedSite(config)
  vi.setSystemTime(Date.now() + PUBLISHED_SITE_TTL_MS)
  expect(await loadPublishedSite(config)).toBe(first)
  expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('if-none-match')).toBe('"e1"')
  vi.setSystemTime(Date.now() + PUBLISHED_SITE_TTL_MS)
  expect((await loadPublishedSite(config)).releaseId).toBe('v2')
  expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('if-none-match')).toBe('"e1"')
  expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.test/api/website/v1/public/site')
})

it('同時進來的請求只打一次 API', async () => {
  let release: (response: Response) => void = () => undefined
  const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve }))
  vi.stubGlobal('fetch', fetchMock)
  const pending = Promise.all([loadPublishedSite(config), loadPublishedSite(config), loadPublishedSite(config)])
  release(ok('v1', '"e1"'))
  expect((await pending).map(site => site.releaseId)).toEqual(['v1', 'v1', 'v1'])
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('失敗不快取：API 恢復後下一個請求就重讀', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const fetchMock = vi.fn()
    .mockRejectedValueOnce(new Error('down'))
    .mockResolvedValueOnce(ok('v1', '"e1"'))
  vi.stubGlobal('fetch', fetchMock)
  await expect(loadPublishedSite(config)).rejects.toMatchObject({ statusCode: 503 })
  expect((await loadPublishedSite(config)).releaseId).toBe('v1')
})

it('不同的 API base 不共用快取', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(ok('v1', '"e1"'))
    .mockResolvedValueOnce(ok('other', '"e9"'))
  vi.stubGlobal('fetch', fetchMock)
  expect((await loadPublishedSite(config)).releaseId).toBe('v1')
  expect((await loadPublishedSite({ ...config, websiteApiInternalBase: 'http://api.other' })).releaseId).toBe('other')
  expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('if-none-match')).toBeNull()
})

it('API 暫時失敗時退回上一份成功內容，不讓全站 503', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(ok('v1', '"e1"'))
    .mockResolvedValueOnce(new Response('{"detail":"Service Unavailable"}', { status: 503 }))
    .mockRejectedValueOnce(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
    .mockResolvedValueOnce(ok('v2', '"e2"'))
  vi.stubGlobal('fetch', fetchMock)
  expect((await loadPublishedSite(config)).releaseId).toBe('v1')
  vi.setSystemTime(Date.now() + PUBLISHED_SITE_TTL_MS)
  // 5xx 與逾時都退回上一份；失敗不刷新快取時間，下一個請求照樣重讀。
  expect((await loadPublishedSite(config)).releaseId).toBe('v1')
  expect((await loadPublishedSite(config)).releaseId).toBe('v1')
  expect(console.warn).toHaveBeenCalledTimes(2)
  // API 一恢復就換回新內容。
  expect((await loadPublishedSite(config)).releaseId).toBe('v2')
  expect(fetchMock).toHaveBeenCalledTimes(4)
})

it('向 API 取內容有逾時上限', async () => {
  const fetchMock = vi.fn().mockResolvedValue(ok('v1', '"e1"'))
  vi.stubGlobal('fetch', fetchMock)
  await loadPublishedSite(config)
  expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
})

it('某一種內容格式不符只影響那一區，其他區照常套用', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const site = fixture as unknown as SiteContent
  const overlay = {
    // 舊版 schema：steps 改名後 web 讀不到，套用時會丟例外。
    admission_content: { title: '入學', intro: '', notes: [] },
    home_about: { title: '新的關於標題', since_label: '1990', body_text: '內文', caption: '說明', photo: null, photo_alt: '' }
  } as unknown as ContentOverlay
  const result = applyContentOverlay(site, overlay)
  expect(result.home.about.title).toBe('新的關於標題')
  expect(result.admission).toBeDefined()
  expect(console.error).toHaveBeenCalled()
})
