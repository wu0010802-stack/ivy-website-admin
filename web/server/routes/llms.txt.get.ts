import { llmsTxt, normalizeSiteOrigin } from '../../app/utils/seo'
import { loadPublishedSite } from '../utils/published-site'

// 跟 sitemap.xml 同一道閘：未開放索引（或沒有正式網址）時回 404，
// 草稿階段不讓 AI 爬蟲拿到暫用網域的摘要。
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const origin = normalizeSiteOrigin(config.public.siteOrigin)
  setResponseHeader(event, 'Cache-Control', 'no-cache, max-age=0')
  if (!config.public.indexingEnabled || !origin) throw createError({ statusCode: 404 })
  const published = await loadPublishedSite(config)
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  return llmsTxt(origin, published.content)
})
