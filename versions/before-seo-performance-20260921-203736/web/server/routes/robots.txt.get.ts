export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')

  if (!config.public.indexingEnabled || !config.public.siteOrigin) {
    // 尚未拍板正式索引（或未設定正式網址）：全站擋爬蟲，避免草稿階段的
    // 網域被搜尋引擎收錄。
    return 'User-agent: *\nDisallow: /\n'
  }

  return [
    'User-agent: *',
    'Disallow: /preview',
    'Disallow: /visit',
    'Disallow: /api/',
    `Sitemap: ${config.public.siteOrigin}/sitemap.xml`,
    ''
  ].join('\n')
})
