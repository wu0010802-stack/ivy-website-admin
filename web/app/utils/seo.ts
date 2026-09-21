import type { Campus, SiteContent } from '../types/site-content'

/** 固定部署 origin；不從不可信 Host 或 CMS 文字組 canonical。 */
export function normalizeSiteOrigin(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return ''
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]') return ''
    return url.origin
  } catch { return '' }
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

export function pageSeo(site: SiteContent, siteOrigin: string, campus?: Campus) {
  const origin = normalizeSiteOrigin(siteOrigin)
  const title = campus ? `${campus.name}｜高雄${campus.district}｜${site.siteMeta.brandName}` : site.siteMeta.title
  const description = campus?.description ?? site.siteMeta.description
  const path = campus ? `/campuses/${encodeURIComponent(campus.key)}` : '/'
  const canonical = origin ? `${origin}${path}` : undefined
  const imagePath = `/assets/${campus?.image ?? site.home.hero.heroImage}.webp`
  const image = origin ? `${origin}${imagePath}` : undefined
  const graph: Record<string, unknown>[] = []
  if (origin) {
    const organization = `${origin}/#organization`
    graph.push({ '@type': 'EducationalOrganization', '@id': organization, name: site.siteMeta.brandName, url: `${origin}/` })
    if (campus) {
      graph.push({
        '@type': 'Preschool', '@id': `${canonical}#school`, name: `${site.siteMeta.brandName} ${campus.name}`,
        url: canonical, description, image, telephone: campus.phone,
        address: { '@type': 'PostalAddress', streetAddress: campus.address, addressCountry: 'TW' },
        parentOrganization: { '@id': organization }
      })
      graph.push({ '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: '首頁', item: `${origin}/` },
        { '@type': 'ListItem', position: 2, name: campus.name, item: canonical }
      ] })
    } else {
      graph.push({ '@type': 'WebSite', '@id': `${origin}/#website`, name: site.siteMeta.brandName, url: canonical, inLanguage: 'zh-Hant-TW', publisher: { '@id': organization } })
    }
  }
  return { title, description, canonical, image, imagePath, imageAlt: campus ? `${campus.name}校園外觀` : site.home.hero.heroImageAlt, graph }
}

export function sitemapXml(origin: string, campuses: Pick<Campus, 'key'>[]): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const urls = ['/', ...campuses.map((c) => `/campuses/${encodeURIComponent(c.key)}`)]
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((path) => `<url><loc>${escape(`${origin}${path}`)}</loc></url>`).join('')}</urlset>\n`
}
