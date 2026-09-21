import { publicCopy } from '../../app/utils/public-copy'
import fixture from '../data/site-fixture.json'
import type { SiteContent } from '../../app/types/site-content'
import { publishedContent, type LivePublicSite, type PublishedSite } from '../../app/utils/published-content'

export async function loadPublishedSite(config: { websiteEnv: string; websiteApiInternalBase: string; public: { contentMode: string } }): Promise<PublishedSite> {
  if (config.public.contentMode === 'fixture') {
    if (config.websiteEnv === 'production') throw createError({ statusCode: 503, statusMessage: '正式環境禁止示範內容' })
    return { schemaVersion: fixture.schemaVersion, releaseId: 'fixture-1', content: publicCopy(fixture as unknown as SiteContent) }
  }
  try {
    const live = await $fetch<LivePublicSite>(`${config.websiteApiInternalBase}/api/website/v1/public/site`)
    return publishedContent(fixture as unknown as SiteContent, live)
  } catch {
    throw createError({ statusCode: 503, statusMessage: '網站內容服務暫時無法使用' })
  }
}
