import { publicCopy } from '../../app/utils/public-copy'
import fixture from '../data/site-fixture.json'
import type { SiteContent } from '../../app/types/site-content'
import { publishedContent, type LivePublicSite, type PublishedSite } from '../../app/utils/published-content'

// 已發布內容的短暫快取（稽核 public-site-no-cache）。每個 SSR 頁面與每次
// 前端換頁都會讀一次；沒有快取時，每個請求都讓 API 重組整份網站內容。
// 這裡在 web 程序記憶體保留最近一份：TTL 內直接用；過期後帶 If-None-Match
// 重新驗證，API 回 304 就沿用。發布後最多晚 TTL 秒出現在官網。
// 只放「已發布」內容：草稿預覽（/preview）走 /api/site-fixture 與後台 API，
// 不經過這裡；API 的 /public/site 也不看 cookie，所有訪客拿到的內容相同。
export const PUBLISHED_SITE_TTL_MS = 3000

// 向 API 取已發布內容的上限。API 卡住（連線池吃緊、部署重啟中）時，SSR 不能
// 跟著無限期等下去。
const FETCH_TIMEOUT_MS = 8000

interface CachedSite {
  base: string
  etag: string | null
  site: PublishedSite
  checkedAt: number
}

// 最後一次成功組好的內容，同時是上面的短快取與失敗時的退路：API 部署重啟
// （掛 volume 會先停舊容器）、暫時連不上、逾時或回 5xx 時退回這一份，訪客
// 看到的是上一版官網而不是 503。只存在這個程序的記憶體：web 重啟後第一次
// 請求仍須 API 可用。
let cached: CachedSite | null = null
let inflight: { base: string; promise: Promise<PublishedSite> } | null = null

/** 測試用：清掉快取與進行中的請求。 */
export function resetPublishedSiteCache(): void {
  cached = null
  inflight = null
}

async function fetchPublishedSite(base: string): Promise<PublishedSite> {
  const previous = cached?.base === base ? cached : null
  const headers: Record<string, string> = { accept: 'application/json' }
  if (previous?.etag) headers['if-none-match'] = previous.etag
  const response = await fetch(`${base}/api/website/v1/public/site`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (response.status === 304 && previous) {
    previous.checkedAt = Date.now()
    return previous.site
  }
  if (!response.ok) throw new Error(`public site responded ${response.status}`)
  const site = publishedContent(fixture as unknown as SiteContent, await response.json() as LivePublicSite)
  cached = { base, etag: response.headers.get('etag'), site, checkedAt: Date.now() }
  return site
}

export async function loadPublishedSite(config: { websiteEnv: string; websiteApiInternalBase: string; public: { contentMode: string } }): Promise<PublishedSite> {
  if (config.public.contentMode === 'fixture') {
    if (config.websiteEnv === 'production') throw createError({ statusCode: 503, statusMessage: '正式環境禁止示範內容' })
    return { schemaVersion: fixture.schemaVersion, releaseId: 'fixture-1', content: publicCopy(fixture as unknown as SiteContent) }
  }
  const base = config.websiteApiInternalBase
  if (cached?.base === base && Date.now() - cached.checkedAt < PUBLISHED_SITE_TTL_MS) return cached.site
  // 同時進來的請求共用同一次讀取，過期瞬間不會一起打 API。
  if (inflight?.base !== base) {
    const promise = fetchPublishedSite(base).finally(() => {
      if (inflight?.promise === promise) inflight = null
    })
    inflight = { base, promise }
  }
  try {
    return await inflight.promise
  } catch (error) {
    // 失敗不刷新快取時間：下一個請求照樣向 API 重讀，API 一恢復就換回新內容。
    const lastGood = cached?.base === base ? cached.site : null
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
