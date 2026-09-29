import { publicCopy } from '../../app/utils/public-copy'
import fixture from '../data/site-fixture.json'
import type { SiteContent } from '../../app/types/site-content'
import { publishedContent, type LivePublicSite, type PublishedSite } from '../../app/utils/published-content'

// 向 API 取已發布內容的上限。API 卡住（連線池吃緊、部署重啟中）時，SSR 不能
// 跟著無限期等下去。
const FETCH_TIMEOUT_MS = 8000

// 最後一次成功組好的內容。API 部署重啟（掛 volume 會先停舊容器）、暫時連不上
// 或回 5xx 時退回這一份，訪客看到的是上一版官網而不是 503。只存在這個程序的
// 記憶體：web 重啟後第一次請求仍須 API 可用。
let lastGood: PublishedSite | null = null

export function resetPublishedSiteCache(): void {
  lastGood = null
}

export async function loadPublishedSite(config: { websiteEnv: string; websiteApiInternalBase: string; public: { contentMode: string } }): Promise<PublishedSite> {
  if (config.public.contentMode === 'fixture') {
    if (config.websiteEnv === 'production') throw createError({ statusCode: 503, statusMessage: '正式環境禁止示範內容' })
    return { schemaVersion: fixture.schemaVersion, releaseId: 'fixture-1', content: publicCopy(fixture as unknown as SiteContent) }
  }
  try {
    const live = await $fetch<LivePublicSite>(`${config.websiteApiInternalBase}/api/website/v1/public/site`, { timeout: FETCH_TIMEOUT_MS })
    lastGood = publishedContent(fixture as unknown as SiteContent, live)
    return lastGood
  } catch (error) {
    if (lastGood) {
      console.warn(`[published-site] 內容服務暫時無法使用，改用上一份成功內容（release ${lastGood.releaseId}）`, describe(error))
      return lastGood
    }
    console.error('[published-site] 內容服務暫時無法使用，也沒有可退回的內容', describe(error))
    throw createError({ statusCode: 503, statusMessage: '網站內容服務暫時無法使用' })
  }
}

function describe(error: unknown): string {
  if (error && typeof error === 'object') {
    const { statusCode, message } = error as { statusCode?: number; message?: string }
    return [statusCode, message].filter(Boolean).join(' ')
  }
  return String(error)
}
