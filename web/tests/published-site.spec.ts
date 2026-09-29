import { afterEach, expect, it, vi } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { applyContentOverlay, type ContentOverlay } from '../app/utils/content-overlay'
import { loadPublishedSite, resetPublishedSiteCache } from '../server/utils/published-site'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetPublishedSiteCache()
})
it('正式環境禁止 fixture，live 失敗維持 503，不回示範資料', async () => {
  vi.stubGlobal('createError', (value: object) => Object.assign(new Error('unavailable'), value))
  vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('upstream failure')))
  await expect(loadPublishedSite({ websiteEnv: 'production', websiteApiInternalBase: 'http://api.test', public: { contentMode: 'fixture' } })).rejects.toMatchObject({ statusCode: 503 })
  await expect(loadPublishedSite({ websiteEnv: 'production', websiteApiInternalBase: 'http://api.test', public: { contentMode: 'live' } })).rejects.toMatchObject({ statusCode: 503 })
})
it('每次請求重讀 release，不使用跨請求快取', async () => {
  vi.stubGlobal('$fetch', vi.fn()
    .mockResolvedValueOnce({ release_id: 'v1', schema_version: '1', content: {} })
    .mockResolvedValueOnce({ release_id: 'v2', schema_version: '1', content: {} }))
  const config = { websiteEnv: 'production', websiteApiInternalBase: 'http://api.test', public: { contentMode: 'live' } }
  expect((await loadPublishedSite(config)).releaseId).toBe('v1')
  expect((await loadPublishedSite(config)).releaseId).toBe('v2')
})

it('API 暫時失敗時退回上一份成功內容，不讓全站 503', async () => {
  vi.stubGlobal('createError', (value: object) => Object.assign(new Error('unavailable'), value))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('$fetch', vi.fn()
    .mockResolvedValueOnce({ release_id: 'v1', schema_version: '1', content: {} })
    .mockRejectedValueOnce(Object.assign(new Error('Service Unavailable'), { statusCode: 503 })))
  const config = { websiteEnv: 'production', websiteApiInternalBase: 'http://api.test', public: { contentMode: 'live' } }
  expect((await loadPublishedSite(config)).releaseId).toBe('v1')
  expect((await loadPublishedSite(config)).releaseId).toBe('v1')
})

it('向 API 取內容有逾時上限', async () => {
  const fetch = vi.fn().mockResolvedValue({ release_id: 'v1', schema_version: '1', content: {} })
  vi.stubGlobal('$fetch', fetch)
  await loadPublishedSite({ websiteEnv: 'production', websiteApiInternalBase: 'http://api.test', public: { contentMode: 'live' } })
  expect(fetch.mock.calls[0][1]).toMatchObject({ timeout: expect.any(Number) })
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
