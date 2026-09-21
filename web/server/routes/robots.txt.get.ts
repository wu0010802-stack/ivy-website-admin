import { normalizeSiteOrigin } from '../../app/utils/seo'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const origin = normalizeSiteOrigin(config.public.siteOrigin)
  setResponseHeader(event, 'Cache-Control', 'no-cache, max-age=0')
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')

  if (!config.public.indexingEnabled || !origin) {
    // 尚未拍板正式索引（或未設定正式網址）：全站擋爬蟲，避免草稿階段的
    // 網域被搜尋引擎收錄。
    return 'User-agent: *\nDisallow: /\n'
  }

  return [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /preview',
    'Disallow: /visit',
    'Disallow: /api/',
    `Sitemap: ${origin}/sitemap.xml`,
    ''
  ].join('\n')
})
