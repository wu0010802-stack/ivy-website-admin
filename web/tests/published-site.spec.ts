import { afterEach, expect, it, vi } from 'vitest'
import { loadPublishedSite } from '../server/utils/published-site'

afterEach(() => vi.unstubAllGlobals())
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
