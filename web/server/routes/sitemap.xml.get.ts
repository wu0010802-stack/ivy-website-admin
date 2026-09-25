import { crawlerIndexable, EMPTY_SITEMAP, normalizeSiteOrigin, sitemapXml } from '../../app/utils/seo'
import { loadPublishedSite } from '../utils/published-site'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const origin = normalizeSiteOrigin(config.public.siteOrigin)
  setResponseHeader(event, 'Cache-Control', 'no-cache, max-age=0')
  setResponseHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  // 部署沒開正式索引、沒有正式網址，或後台關掉收錄：回空的 sitemap。
  if (!config.public.indexingEnabled || !origin) return EMPTY_SITEMAP
  const published = await loadPublishedSite(config)
  if (!crawlerIndexable(true, origin, published.content.siteMeta)) return EMPTY_SITEMAP
  return sitemapXml(origin, published.content.campuses)
})
