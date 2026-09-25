import type { Campus, SiteContent, SiteMetaContent } from '../types/site-content'

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

/** 社群分享圖（1200×630 JPG）路徑，檔案由 scripts/optimize-site-images.py 依 OG_IMAGES 產生。 */
export function ogImagePath(imageName: string): string {
  return `/assets/og/${imageName}.jpg`
}

/**
 * 首頁與入學資訊頁的分享圖：後台設了素材庫分享圖就用它（同源公開媒體
 * 端點，只有已發布的素材才會回檔案），否則沿用首頁大圖的 1200×630 JPG。
 */
export function siteShareImage(site: SiteContent): { path: string; alt: string } {
  const media = site.siteMeta.shareImage
  if (media && /^[0-9a-f-]{36}$/i.test(media)) {
    return { path: `/api/website/v1/public/media/${media}/file`, alt: site.siteMeta.shareImageAlt || site.home.hero.heroImageAlt }
  }
  // 後台換了首屏照片：分享圖跟著用它（素材原檔，不是另外產生的 1200×630）。
  const hero = site.home.hero.heroImageMedia
  return { path: hero ? hero.src : ogImagePath(site.home.hero.heroImage), alt: site.home.hero.heroImageAlt }
}

/** 分校的分享圖：後台換了封面就用封面原檔，否則用內建的 1200×630 JPG。 */
export function campusShareImagePath(campus: Campus): string {
  return campus.imageMedia ? campus.imageMedia.src : ogImagePath(campus.image)
}

/** 公開的單頁（非分校頁）：目前只有入學資訊。 */
export type StaticPage = 'admission'
export const ADMISSION_PATH = '/admission'

/** 入學資訊頁的 SEO：標題描述固定、分享圖沿用首頁（不另產圖），麵包屑兩層。 */
export function admissionSeo(site: SiteContent, siteOrigin: string) {
  const origin = normalizeSiteOrigin(siteOrigin)
  const title = site.siteMeta.admissionTitle || `入學資訊｜入學流程、新生須知、收退費與分班｜${site.siteMeta.brandName}`
  const description = site.siteMeta.admissionDescription || '常春藤幼兒園入學流程、新生入園須知、收退費辦法與補助，並可依寶貝生日查詢就讀班級。'
  const canonical = origin ? `${origin}${ADMISSION_PATH}` : undefined
  const share = siteShareImage(site)
  const imagePath = share.path
  const image = origin ? `${origin}${imagePath}` : undefined
  const graph: Record<string, unknown>[] = origin ? [
    { '@type': 'WebPage', '@id': `${canonical}#page`, url: canonical, name: title, description, inLanguage: 'zh-Hant-TW', isPartOf: { '@id': `${origin}/#website` } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首頁', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: '入學資訊', item: canonical }
    ] }
  ] : []
  return { title, description, canonical, image, imagePath, imageAlt: share.alt, graph }
}

export function pageSeo(site: SiteContent, siteOrigin: string, campus?: Campus) {
  const origin = normalizeSiteOrigin(siteOrigin)
  const title = campus ? `${campus.name}｜高雄${campus.district}｜${site.siteMeta.brandName}` : site.siteMeta.title
  const description = campus?.description ?? site.siteMeta.description
  const path = campus ? `/campuses/${encodeURIComponent(campus.key)}` : '/'
  const canonical = origin ? `${origin}${path}` : undefined
  // 分享圖用 1200×630 JPG（scripts/optimize-site-images.py 的 OG_IMAGES 產出）；
  // 社群平台對 WebP 支援不一致。
  const share = siteShareImage(site)
  const imagePath = campus ? campusShareImagePath(campus) : share.path
  const image = origin ? `${origin}${imagePath}` : undefined
  const graph: Record<string, unknown>[] = []
  if (origin) {
    const organization = `${origin}/#organization`
    graph.push({ '@type': 'EducationalOrganization', '@id': organization, name: site.siteMeta.brandName, url: `${origin}/` })
    const school = (c: Campus) => {
      const url = `${origin}/campuses/${encodeURIComponent(c.key)}`
      return {
        '@type': 'Preschool', '@id': `${url}#school`, name: `${site.siteMeta.brandName} ${c.name}`,
        url, description: c.description ?? site.siteMeta.description, image: `${origin}${campusShareImagePath(c)}`, telephone: c.phone,
        address: { '@type': 'PostalAddress', streetAddress: c.address, addressCountry: 'TW' },
        parentOrganization: { '@id': organization }
      }
    }
    if (campus) {
      graph.push(school(campus))
      graph.push({ '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: '首頁', item: `${origin}/` },
        { '@type': 'ListItem', position: 2, name: campus.name, item: canonical }
      ] })
      // 與頁面上 CampusFaq 顯示的同一份問答（伺服器端就輸出），不另寫文案。
      const faq = campus.faq.items.filter((item) => item.q.trim() && item.a.trim())
      if (faq.length) {
        graph.push({ '@type': 'FAQPage', '@id': `${canonical}#faq`, url: `${canonical}#faq`, inLanguage: 'zh-Hant-TW', mainEntity: faq.map((item) => ({
          '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a }
        })) })
      }
    } else {
      graph.push({ '@type': 'WebSite', '@id': `${origin}/#website`, name: site.siteMeta.brandName, url: canonical, inLanguage: 'zh-Hant-TW', publisher: { '@id': organization } })
      // 首頁列出已發布的每一校（地址、電話取自發布內容，不另編）。
      for (const c of site.campuses) graph.push(school(c))
    }
  }
  return { title, description, canonical, image, imagePath, imageAlt: campus ? `${campus.name}校園外觀` : share.alt, graph }
}

/**
 * 搜尋引擎可以收錄官網的條件（各頁 robots meta、robots.txt、sitemap.xml、
 * llms.txt 共用）：部署開啟正式索引（NUXT_PUBLIC_INDEXING_ENABLED）、有正式
 * 網址，而且已發布的「網站標題與電話」沒有關掉收錄。後台只能收緊、不能
 * 在部署沒開時強制打開。
 */
export function crawlerIndexable(indexingEnabled: boolean, origin: string, siteMeta: Pick<SiteMetaContent, 'allowIndexing'> | undefined): boolean {
  return indexingEnabled && Boolean(origin) && siteMeta?.allowIndexing !== false
}

export function robotsTxt(origin: string, indexable: boolean): string {
  // 不能收錄時全站擋爬蟲，避免草稿階段或後台關閉收錄時被搜尋引擎收進去。
  if (!indexable || !origin) return 'User-agent: *\nDisallow: /\n'
  return [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /preview',
    'Disallow: /visit',
    'Disallow: /api/',
    `Sitemap: ${origin}/sitemap.xml`,
    ''
  ].join('\n')
}

/** 不能收錄時回的 sitemap：合法但沒有任何網址。 */
export const EMPTY_SITEMAP = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n'

export function sitemapXml(origin: string, campuses: Pick<Campus, 'key'>[]): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const urls = ['/', ADMISSION_PATH, ...campuses.map((c) => `/campuses/${encodeURIComponent(c.key)}`)]
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((path) => `<url><loc>${escape(`${origin}${path}`)}</loc></url>`).join('')}</urlset>\n`
}

/**
 * /llms.txt（https://llmstxt.org/）：給 AI 助理讀的網站摘要。只用已發布內容
 * 的名稱、描述、地址與電話，不另寫宣傳文案；未開放索引時不提供（見路由）。
 */
export function llmsTxt(origin: string, site: Pick<SiteContent, 'siteMeta' | 'campuses'>): string {
  const line = (value: string) => value.replace(/\s+/g, ' ').trim()
  const campusUrl = (c: Campus) => `${origin}/campuses/${encodeURIComponent(c.key)}`
  const out = [
    `# ${line(site.siteMeta.brandName)}`,
    '',
    `> ${line(site.siteMeta.description)}`,
    '',
    '## 校區',
    '',
    // 分校頁沒有題目時不輸出 #faq 區塊（CampusPageMain），這裡也就不指過去。
    ...site.campuses.map((c) => `- [${line(c.name)}](${campusUrl(c)})：高雄${line(c.district)}，${line(c.address)}，參觀專線 ${line(c.phone)}${c.faq.items.length ? `；常見問題見 ${campusUrl(c)}#faq` : ''}`),
    ''
  ]
  out.push('## 入學資訊', '', `- [入學資訊](${origin}${ADMISSION_PATH})：入學流程、新生入園須知、收退費辦法與補助、依生日查詢就讀班級。`, '')
  out.push('## 預約參觀', '', `- [預約參觀](${origin}/visit)：線上送出參觀需求，園方聯絡並確認後才算預約成立。`, '')
  return out.join('\n')
}
