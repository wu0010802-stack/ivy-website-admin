import { normalizeSiteOrigin, sitemapXml } from '../../app/utils/seo'
import { loadPublishedSite } from '../utils/published-site'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const origin = normalizeSiteOrigin(config.public.siteOrigin)
  setResponseHeader(event, 'Cache-Control', 'no-cache, max-age=0')
  if (!config.public.indexingEnabled || !origin) throw createError({ statusCode: 404 })
  const published = await loadPublishedSite(config)
  setResponseHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  return sitemapXml(origin, published.content.campuses)
})
