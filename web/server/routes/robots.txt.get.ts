import { crawlerIndexable, normalizeSiteOrigin, robotsTxt } from '../../app/utils/seo'
import { loadPublishedSite } from '../utils/published-site'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const origin = normalizeSiteOrigin(config.public.siteOrigin)
  setResponseHeader(event, 'Cache-Control', 'no-cache, max-age=0')
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  // 部署沒開正式索引（或沒有正式網址）就不必問內容服務；開了再看已發布的
  // 「網站標題與電話」有沒有關掉收錄。內容服務讀不到時回 503，爬蟲會當成
  // 暫時不可爬、稍後再試，不會因此放行。
  if (!config.public.indexingEnabled || !origin) return robotsTxt(origin, false)
  const published = await loadPublishedSite(config)
  return robotsTxt(origin, crawlerIndexable(true, origin, published.content.siteMeta))
})
