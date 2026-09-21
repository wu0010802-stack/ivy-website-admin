import siteFixture from '../data/site-fixture.json'

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 校區清單目前仍讀 fixture（campuses 尚未搬進 CONTENT_KIND_REGISTRY，
 * 見 useDraftPreview.ts 的說明）；等校區清單真的可由後台增刪後，這裡
 * 要改讀 `/public/site`，不能維持寫死清單。
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  setResponseHeader(event, 'Content-Type', 'application/xml; charset=utf-8')

  if (!config.public.indexingEnabled || !config.public.siteOrigin) {
    setResponseStatus(event, 404)
    return null
  }

  const origin = config.public.siteOrigin.replace(/\/$/, '')
  const campusKeys: string[] = (siteFixture as { campuses: { key: string }[] }).campuses.map(
    (c) => c.key
  )

  const urls = ['', ...campusKeys.map((key) => `campuses/${key}`)].map(
    (path) => `<url><loc>${escapeXml(`${origin}/${path}`)}</loc></url>`
  )

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
})
