import { indexableArticles, NEWS_PATH, newsPath } from './news-content'
import { mediaFileUrl, isMediaId } from './media-image'
import { campusMapUrl, httpsUrl } from './site-links'
import { admissionFaqEntries } from './admission-faq'
import type { Campus, NewsArticle, NewsContent, PageSeoKey, SiteContent, SiteMetaContent } from '../types/site-content'

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

/**
 * 家長搜尋與口語上的園名。品牌名（siteMeta.brandName）是「常春藤教育機構」，內建描述一直寫「常春藤幼兒園」；
 * 結構化資料與 llms.txt 兩個名字都給，搜尋引擎與 AI 助理才對得上同一個機構。
 */
export const SCHOOL_NAME = '常春藤幼兒園'
/**
 * 搜尋結果標題結尾用的名字（2026-11-11 使用者選定，取代原本的品牌名「常春藤教育機構」）：家長搜的是
 * 「常春藤幼兒園」。使用者同日裁定標題不加「高雄」，不要再加。只用在 <title> 與分享標題，頁面上的品牌字不動。
 * 後台「各頁搜尋與分享」的提示字逐字跟著這裡（admin/src/composables/pageSeoDefaults.ts）。
 */
export const TITLE_BRAND = '常春藤幼兒園'

const organizationId = (origin: string) => `${origin}/#organization`
const websiteId = (origin: string) => `${origin}/#website`
/** 各校節點的 @id：首頁（五校都列）與各校預約頁（只列自己）共用同一個，搜尋引擎才認得是同一所學校。 */
export const campusNodeId = (origin: string, key: string) => `${origin}/#campus-${encodeURIComponent(key)}`

/** 07-392-8366 → +886-7-392-8366（結構化資料用國際寫法）；不是 0 開頭的寫法原樣輸出。 */
export function internationalPhone(phone: string): string {
  const value = phone.trim()
  return /^0\d[\d\- ]+$/.test(value) ? `+886-${value.slice(1)}` : value
}

/** 機構本身的社群（全站設定的 socialLinks），EducationalOrganization 的 sameAs。 */
function organizationSameAs(site: SiteContent): string[] {
  return (site.siteMeta.socialLinks ?? []).map((link) => httpsUrl(link.url)).filter((url): url is string => Boolean(url))
}

/** 分校自己的社群帳號。和機構社群同一個網址的不算該校的帳號，不列；不拿別校的代填。 */
function campusSameAs(site: SiteContent, campus: Campus): string[] {
  const shared = new Set(organizationSameAs(site))
  return [...new Set([campus.facebook, campus.line, campus.instagram, campus.youtube]
    .map(httpsUrl).filter((url): url is string => Boolean(url) && !shared.has(url!)))]
}

/** 地址拆出縣市與行政區給在地搜尋用；只從已發布的地址與區名取，對不上就不輸出。 */
function postalAddress(campus: Pick<Campus, 'address' | 'district'>) {
  const region = campus.address.match(/^(\S{2}[市縣])/)?.[1]
  const locality = campus.district && campus.address.includes(campus.district) ? campus.district : undefined
  return { '@type': 'PostalAddress', streetAddress: campus.address, ...(locality ? { addressLocality: locality } : {}), ...(region ? { addressRegion: region } : {}), addressCountry: 'TW' }
}

/** 五校所在的縣市（都在同一個才有值），機構節點的服務範圍與 llms.txt 的一句話介紹用。 */
function campusRegion(campuses: Pick<Campus, 'address' | 'district'>[]): string | undefined {
  const regions = new Set(campuses.map((campus) => postalAddress(campus).addressRegion))
  const [only] = [...regions]
  return regions.size === 1 ? only : undefined
}

/**
 * 每一頁都帶的機構與網站節點（2026-11-11）。原本只有首頁有，內頁的 isPartOf／publisher 指到別頁才定義的 @id，
 * 讀單頁的搜尋引擎與 AI 爬蟲解析不到。內頁只帶名稱、別名與 logo；創立年份、社群、服務範圍、五校留在首頁（full）。
 */
function siteNodes(site: SiteContent, origin: string, full = false): Record<string, unknown>[] {
  const organization = organizationId(origin)
  const alternateName = [SCHOOL_NAME, site.siteMeta.brandNameEn].filter((name): name is string => Boolean(name) && name !== site.siteMeta.brandName)
  const orgSameAs = organizationSameAs(site)
  const region = campusRegion(site.campuses)
  return [
    { '@type': 'EducationalOrganization', '@id': organization, name: site.siteMeta.brandName, url: `${origin}/`,
      ...(alternateName.length ? { alternateName } : {}),
      ...(site.siteMeta.logo ? { logo: `${origin}/${site.siteMeta.logo.replace(/^\/+/, '')}` } : {}),
      // 創立年份同關於常春藤頁（aboutSeo）：沿革第一站的年份。
      ...(full ? {
        foundingDate: String(foundingYear(site)),
        ...(region ? { areaServed: { '@type': 'AdministrativeArea', name: region } } : {}),
        ...(orgSameAs.length ? { sameAs: orgSameAs } : {}),
        ...(site.campuses.length ? { subOrganization: site.campuses.map((campus) => ({ '@id': campusNodeId(origin, campus.key) })) } : {})
      } : {}) },
    { '@type': 'WebSite', '@id': websiteId(origin), name: site.siteMeta.brandName, alternateName: SCHOOL_NAME, url: `${origin}/`, inLanguage: 'zh-Hant-TW', publisher: { '@id': organization } }
  ]
}

/**
 * 首頁的各校節點（2026-11-11 加回）。10-03 拿掉分校頁時連結構化資料一起拿掉，之後五校的地址只剩 noindex 的
 * 預約頁讀得到；首頁五校區塊本來就列各校地址、電話、社群（切分頁可見），這裡照同一份已發布資料輸出。
 * 網址是各校的預約頁 /visit/<校>（同日開放收錄，是各校唯一有自己網址的頁；該頁也輸出同一個 @id 的節點）。
 * 不輸出經緯度、營業時間、收費、評分：沒有已發布資料。創立年份取關於頁沿革同一校那一站。
 */
function campusNode(site: SiteContent, origin: string, campus: Campus): Record<string, unknown> {
  const sameAs = campusSameAs(site, campus)
  const founded = site.aboutPage?.milestones?.find((milestone) => milestone.key === campus.key)?.year
  return {
    '@type': 'Preschool', '@id': campusNodeId(origin, campus.key),
    name: `${SCHOOL_NAME}${campus.name}`, alternateName: `${site.siteMeta.brandName} ${campus.name}`,
    url: `${origin}${VISIT_PATH}/${encodeURIComponent(campus.key)}`,
    image: `${origin}${campusShareImagePath(campus)}`,
    ...(campus.phone ? { telephone: internationalPhone(campus.phone) } : {}),
    address: postalAddress(campus), hasMap: campusMapUrl(campus),
    ...(founded ? { foundingDate: String(founded) } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    parentOrganization: { '@id': organizationId(origin) }
  }
}

/** 社群分享圖（1200×630 JPG）路徑，檔案由 scripts/optimize-site-images.py 依 OG_IMAGES 產生。 */
export function ogImagePath(imageName: string): string {
  return `/assets/og/${imageName}.jpg`
}

/**
 * 全站分享圖（首頁，以及各頁沒另設分享圖時）：後台設了素材庫分享圖就用它（同源公開媒體
 * 端點，只有已發布的素材才會回檔案），否則沿用首頁大圖的 1200×630 JPG。
 */
export function siteShareImage(site: SiteContent): { path: string; alt: string } {
  const media = site.siteMeta.shareImage
  if (isMediaId(media)) {
    return { path: mediaFileUrl(media), alt: site.siteMeta.shareImageAlt || site.home.hero.heroImageAlt }
  }
  // 後台換了首屏照片：分享圖跟著用它（素材原檔，不是另外產生的 1200×630）。
  const hero = site.home.hero.heroImageMedia
  return { path: hero ? hero.src : ogImagePath(site.home.hero.heroImage), alt: site.home.hero.heroImageAlt }
}

/**
 * 公開單頁的搜尋設定（後台「全站設定」的各頁搜尋與分享，2026-10-12）：標題、描述有填才覆寫內建，
 * 空字串視為沒設定；分享圖要是合法的素材 UUID 才用（說明用該頁的，沒填退回全站說明），
 * 否則退回全站分享圖（siteShareImage）。
 */
function pageOverride(site: SiteContent, page: PageSeoKey, builtin: { title: string; description: string }) {
  const entry = site.siteMeta.pageSeo?.[page]
  const global = siteShareImage(site)
  const share = isMediaId(entry?.shareImage)
    ? { path: mediaFileUrl(entry.shareImage), alt: entry.shareImageAlt?.trim() || global.alt }
    : global
  return {
    title: entry?.title?.trim() || builtin.title,
    description: entry?.description?.trim() || builtin.description,
    share
  }
}

/** 分校的分享圖：後台換了封面就用封面原檔，否則用內建的 1200×630 JPG。 */
export function campusShareImagePath(campus: Campus): string {
  return campus.imageMedia ? campus.imageMedia.src : ogImagePath(campus.image)
}

/** 公開的單頁（非分校頁）：最新消息列表、關於常春藤、入學資訊、常春藤環境、特色教學、30 週年。 */
export type StaticPage = 'news' | 'about' | 'admission' | 'environment' | 'curriculum' | 'privacy' | 'anniversary'
/** 後台「各頁搜尋與分享」開放設定的七個頁面（同 StaticPage，與後端 PAGE_SEO_KEYS 一致） */
export const PAGE_SEO_KEYS: readonly PageSeoKey[] = ['admission', 'about', 'curriculum', 'environment', 'news', 'anniversary', 'privacy']
export const ADMISSION_PATH = '/admission'
export const ENVIRONMENT_PATH = '/environment'
export const CURRICULUM_PATH = '/curriculum'
export const ABOUT_PATH = '/about'
export const PRIVACY_PATH = '/privacy'
export const ANNIVERSARY_PATH = '/anniversary'

/** 後台「全站設定」的 30 週年開關；沒有這個欄位（舊版本、內建內容）＝開。 */
export function anniversaryEnabled(siteMeta: Pick<SiteMetaContent, 'anniversaryEnabled'> | undefined): boolean {
  return siteMeta?.anniversaryEnabled !== false
}

/** 站內連到 30 週年頁的連結（/anniversary、/anniversary/、帶 # 或 ? 的都算）。 */
export function isAnniversaryHref(href: string): boolean {
  return /^\/anniversary\/?(?:[?#]|$)/.test(href.trim())
}

/** 後台「全站設定」的最新消息開關（2026-11-11）；沒有這個欄位（舊版本、內建內容）＝開。 */
export function newsEnabled(siteMeta: Pick<SiteMetaContent, 'newsEnabled'> | undefined): boolean {
  return siteMeta?.newsEnabled !== false
}

/** 站內連到最新消息的連結：列表頁、單篇頁（/news、/news/、/news/<id>、帶 # 或 ? 的都算），以及首頁那一章的錨點（/#latest-news）。 */
export function isNewsHref(href: string, sectionId = 'latest-news'): boolean {
  const value = href.trim()
  return /^\/news(?:\/[^?#]*)?(?:[?#]|$)/.test(value) || (Boolean(sectionId) && value.replace(/^\/(?=#)/, '') === `#${sectionId}`)
}

/** 後台「全站設定」的入學資訊分頁開關（2026-11-11）；沒有這個欄位（舊版本、內建內容）＝顯示。 */
export function admissionEnabled(siteMeta: Pick<SiteMetaContent, 'admissionEnabled'> | undefined): boolean {
  return siteMeta?.admissionEnabled !== false
}

/** 站內連到入學資訊頁的連結（/admission、/admission/、帶 # 或 ? 的都算）。 */
export function isAdmissionHref(href: string): boolean {
  return /^\/admission\/?(?:[?#]|$)/.test(href.trim())
}

/** 入學資訊頁的 SEO：標題、描述、分享圖預設用內建（分享圖沿用首頁），後台「各頁搜尋與分享」可覆寫，麵包屑兩層。 */
export function admissionSeo(site: SiteContent, siteOrigin: string) {
  const origin = normalizeSiteOrigin(siteOrigin)
  const { title, description, share } = pageOverride(site, 'admission', {
    title: `入學資訊｜入學流程、新生須知、收退費與分班｜${TITLE_BRAND}`,
    description: '常春藤幼兒園入學流程、依寶貝生日查詢就讀班級、新生入園須知，以及補助、退費、學期中入學等常見問題。'
  })
  const canonical = origin ? `${origin}${ADMISSION_PATH}` : undefined
  const imagePath = share.path
  const image = origin ? `${origin}${imagePath}` : undefined
  // 常見問題：和頁面上「爸媽常問的事」同一份問答（utils/admission-faq.ts），每題的網址是頁內錨點。
  const faq = admissionFaqEntries(site.admission, site.campuses)
  const graph: Record<string, unknown>[] = origin ? [
    { '@type': faq.length ? ['WebPage', 'FAQPage'] : 'WebPage', '@id': `${canonical}#page`, url: canonical, name: title, description, inLanguage: 'zh-Hant-TW', isPartOf: { '@id': `${origin}/#website` },
      ...(faq.length ? { mainEntity: faq.map((entry) => ({ '@type': 'Question', '@id': `${canonical}#${entry.id}`, url: `${canonical}#${entry.id}`, name: entry.q, acceptedAnswer: { '@type': 'Answer', text: entry.a } })) } : {}) },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首頁', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: '入學資訊', item: canonical }
    ] },
    ...siteNodes(site, origin)
  ] : []
  return { title, description, canonical, image, imagePath, imageAlt: share.alt, graph }
}

/** 隱私權政策頁的 SEO：標題預設跟著政策標題，描述與分享圖預設內建，後台「各頁搜尋與分享」可覆寫，麵包屑兩層。 */
export function privacySeo(site: SiteContent, siteOrigin: string) {
  const origin = normalizeSiteOrigin(siteOrigin)
  const policyTitle = site.privacyPolicy?.title || '隱私權政策'
  const { title, description, share } = pageOverride(site, 'privacy', {
    title: `${policyTitle}｜${TITLE_BRAND}`,
    description: '常春藤幼兒園官網如何蒐集、使用與保護您的個人資料，以及 Cookie 的使用方式。'
  })
  const canonical = origin ? `${origin}${PRIVACY_PATH}` : undefined
  const image = origin ? `${origin}${share.path}` : undefined
  const graph: Record<string, unknown>[] = origin ? [
    { '@type': 'WebPage', '@id': `${canonical}#page`, url: canonical, name: title, description, inLanguage: 'zh-Hant-TW', isPartOf: { '@id': `${origin}/#website` } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首頁', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: policyTitle, item: canonical }
    ] },
    ...siteNodes(site, origin)
  ] : []
  return { title, description, canonical, image, imagePath: share.path, imageAlt: share.alt, graph }
}

/** 常春藤環境頁的 SEO（2026-09-25）：同入學資訊頁，預設內建、後台可覆寫（2026-10-12），麵包屑兩層。 */
export function environmentSeo(site: SiteContent, siteOrigin: string) {
  const origin = normalizeSiteOrigin(siteOrigin)
  const { title, description, share } = pageOverride(site, 'environment', {
    title: `常春藤環境｜幼兒保育、校園環境與幼兒餐點｜${TITLE_BRAND}`,
    description: '常春藤幼兒園的保育照顧、校園空間與每日餐點：五顆心照顧孩子，教室、教具、衛廁到戶外廣場都以安全與探索為出發點，每月菜單收在營養餐點書。'
  })
  const canonical = origin ? `${origin}${ENVIRONMENT_PATH}` : undefined
  const image = origin ? `${origin}${share.path}` : undefined
  const graph: Record<string, unknown>[] = origin ? [
    { '@type': 'WebPage', '@id': `${canonical}#page`, url: canonical, name: title, description, inLanguage: 'zh-Hant-TW', isPartOf: { '@id': `${origin}/#website` } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首頁', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: '常春藤環境', item: canonical }
    ] },
    ...siteNodes(site, origin)
  ] : []
  return { title, description, canonical, image, imagePath: share.path, imageAlt: share.alt, graph }
}

/** 30 週年分頁的 SEO（2026-10-04 使用者同意做成正式分頁）：預設內建、後台可覆寫（2026-10-12），麵包屑兩層。 */
export function anniversarySeo(site: SiteContent, siteOrigin: string) {
  const origin = normalizeSiteOrigin(siteOrigin)
  const { title, description, share } = pageOverride(site, 'anniversary', {
    title: `常春藤 30 週年｜1997—2027｜${TITLE_BRAND}`,
    description: '1997 年，第一間常春藤在高雄三民區義華路成立，到 2027 年滿 30 年。看義華、明華、崇德、國際、仁武五所校園一年一年長出來，也換你用蠟筆畫一個 30。'
  })
  const canonical = origin ? `${origin}${ANNIVERSARY_PATH}` : undefined
  const image = origin ? `${origin}${share.path}` : undefined
  const graph: Record<string, unknown>[] = origin ? [
    { '@type': 'WebPage', '@id': `${canonical}#page`, url: canonical, name: title, description, inLanguage: 'zh-Hant-TW', isPartOf: { '@id': `${origin}/#website` } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首頁', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: '常春藤 30 週年', item: canonical }
    ] },
    ...siteNodes(site, origin)
  ] : []
  return { title, description, canonical, image, imagePath: share.path, imageAlt: share.alt, graph }
}

/** 特色教學頁的 SEO（2026-09-26）：同常春藤環境頁，預設內建、後台可覆寫（2026-10-12），麵包屑兩層。 */
export function curriculumSeo(site: SiteContent, siteOrigin: string) {
  const origin = normalizeSiteOrigin(siteOrigin)
  const { title, description, share } = pageOverride(site, 'curriculum', {
    title: `特色教學｜四個年段、七個課程方向與每天的五件事｜${TITLE_BRAND}`,
    description: '常春藤幼兒園的特色教學：幼幼班到大班四個年段，認知、統整、多元文化、品德、自主學習、課程活動與藝術共創七個課程方向，孩子作品的兒童美術館，以及靜心、教具操作、美術創作、閱讀與大肌肉時間。'
  })
  const canonical = origin ? `${origin}${CURRICULUM_PATH}` : undefined
  const image = origin ? `${origin}${share.path}` : undefined
  const graph: Record<string, unknown>[] = origin ? [
    { '@type': 'WebPage', '@id': `${canonical}#page`, url: canonical, name: title, description, inLanguage: 'zh-Hant-TW', isPartOf: { '@id': `${origin}/#website` } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首頁', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: '特色教學', item: canonical }
    ] },
    ...siteNodes(site, origin)
  ] : []
  return { title, description, canonical, image, imagePath: share.path, imageAlt: share.alt, graph }
}

export const VISIT_PATH = '/visit'

/**
 * 預約參觀頁（/visit 選校、/visit/<校> 參觀方式與表單，2026-10-29）。2026-11-11 使用者裁定開放收錄（取代 10-12 的
 * noindex）：拿掉分校頁以後，這裡是唯一列出五校地址、各校有自己網址的頁，/visit/<校> 當各校的搜尋入口，
 * 也給 Google 商家檔案連。收錄照全站開關（crawlerIndexable）；/visit/manage 照舊不收。不進後台「各頁搜尋與分享」，
 * 標題描述用內建。廣告網址帶的 utm 參數靠 canonical 收回同一頁。
 * 描述不寫「線上預約」：只有開放場次的校區能線上選時段，其他校要來電。
 * 結構化資料：頁面與麵包屑；/visit/<校> 另帶那一校的 Preschool（和首頁同一個 @id）。
 */
export function visitSeo(site: SiteContent, siteOrigin: string, campus?: Campus) {
  const origin = normalizeSiteOrigin(siteOrigin)
  const title = campus ? `預約參觀${campus.name}｜${TITLE_BRAND}` : `預約校園參觀｜${TITLE_BRAND}`
  const names = site.campuses.map((c) => c.name.replace(/校$/, '')).join('、')
  const description = campus
    ? `預約參觀常春藤${campus.name}：${campus.address}${campus.phone ? `，電話 ${campus.phone}` : ''}。看參觀方式，帶孩子來校園走走。`
    : `預約參觀常春藤幼兒園：${names}，選一所離生活圈近的校園，看參觀方式與可預約的時段。`
  const canonical = origin ? `${origin}${campus ? `${VISIT_PATH}/${campus.key}` : VISIT_PATH}` : undefined
  const share = campus
    ? { path: campusShareImagePath(campus), alt: campus.imageMedia?.alt || `常春藤${campus.name}校舍` }
    : siteShareImage(site)
  const image = origin ? `${origin}${share.path}` : undefined
  const graph: Record<string, unknown>[] = origin ? [
    { '@type': 'WebPage', '@id': `${canonical}#page`, url: canonical, name: title, description, inLanguage: 'zh-Hant-TW', isPartOf: { '@id': `${origin}/#website` },
      ...(campus ? { about: { '@id': campusNodeId(origin, campus.key) } } : {}) },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首頁', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: '預約參觀', item: `${origin}${VISIT_PATH}` },
      ...(campus ? [{ '@type': 'ListItem', position: 3, name: campus.name, item: canonical }] : [])
    ] },
    ...(campus ? [campusNode(site, origin, campus)] : []),
    ...siteNodes(site, origin)
  ] : []
  return { title, description, canonical, image, imagePath: share.path, imageAlt: share.alt, graph }
}

/**
 * 創校年份：關於常春藤頁沿革的第一站（義華；內建 1997，後台「關於常春藤頁」可改）。
 * /about 的標題描述與首頁機構節點的 foundingDate 跟著它；30 週年頁與 llms.txt 是活動主題，固定寫 1997。
 */
export function foundingYear(site: Pick<SiteContent, 'aboutPage'>): number {
  return site.aboutPage?.milestones?.[0]?.year ?? 1997
}

/** 關於常春藤頁的 SEO（2026-09-26）：同特色教學頁，預設內建（創校年份跟著沿革）、後台可覆寫（2026-10-12），麵包屑兩層。 */
export function aboutSeo(site: SiteContent, siteOrigin: string) {
  const origin = normalizeSiteOrigin(siteOrigin)
  const year = foundingYear(site)
  const { title, description, share } = pageOverride(site, 'about', {
    title: `關於常春藤｜${year} 年創立、五所校園與全人教育｜${TITLE_BRAND}`,
    description: `常春藤幼兒園 ${year} 年在高雄三民區義華路創立，陸續成立明華、崇德、國際、仁武校。秉持全人教育，以課綱六大領域培養孩子六大核心素養。`
  })
  const canonical = origin ? `${origin}${ABOUT_PATH}` : undefined
  const image = origin ? `${origin}${share.path}` : undefined
  const graph: Record<string, unknown>[] = origin ? [
    { '@type': 'AboutPage', '@id': `${canonical}#page`, url: canonical, name: title, description, inLanguage: 'zh-Hant-TW', isPartOf: { '@id': `${origin}/#website` }, about: { '@id': organizationId(origin) } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首頁', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: '關於常春藤', item: canonical }
    ] },
    ...siteNodes(site, origin)
  ] : []
  return { title, description, canonical, image, imagePath: share.path, imageAlt: share.alt, graph }
}

/** 最新消息列表頁的 SEO（2026-09-26）：預設內建、後台可覆寫（2026-10-12），麵包屑兩層。 */
export function newsListSeo(site: SiteContent, siteOrigin: string) {
  const origin = normalizeSiteOrigin(siteOrigin)
  const { title, description, share } = pageOverride(site, 'news', {
    title: `最新消息｜校園活動與各校公告｜${TITLE_BRAND}`,
    description: '常春藤幼兒園義華、明華、崇德、國際、仁武五校的最新消息與近期活動。'
  })
  const canonical = origin ? `${origin}${NEWS_PATH}` : undefined
  const image = origin ? `${origin}${share.path}` : undefined
  const graph: Record<string, unknown>[] = origin ? [
    { '@type': 'CollectionPage', '@id': `${canonical}#page`, url: canonical, name: title, description, inLanguage: 'zh-Hant-TW', isPartOf: { '@id': `${origin}/#website` } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首頁', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: '最新消息', item: canonical }
    ] },
    ...siteNodes(site, origin)
  ] : []
  return { title, description, canonical, image, imagePath: share.path, imageAlt: share.alt, graph }
}

const NEWS_DESCRIPTION_MAX = 110

/**
 * 消息的頁面描述：後台沒填摘要時取內文第一段（標題、清單也算），超過約兩行的分享預覽就截斷。
 * 2026-11-09 稽核：沒填摘要的消息沒有 description，LINE／FB 分享預覽只剩標題。
 */
export function newsDescription(article: Pick<NewsArticle, 'description' | 'body'>): string {
  const summary = article.description?.trim()
  if (summary) return summary
  const text = (article.body ?? [])
    .map((block) => block.type === 'paragraph' || block.type === 'heading' ? block.text : block.type === 'list' ? block.items.join('、') : '')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
  const chars = [...text]
  return chars.length > NEWS_DESCRIPTION_MAX ? `${chars.slice(0, NEWS_DESCRIPTION_MAX - 1).join('').trimEnd()}…` : text
}

/**
 * 單篇消息的 SEO。示意內容（sample）照常顯示但不給搜尋引擎：不輸出 canonical 與
 * 結構化資料，頁面另加 noindex（見 usePageSeo）。分享圖用消息封面：素材庫圖用原檔，
 * fixture 代號用響應式最大候選（tour-image）。
 */
export function newsArticleSeo(site: SiteContent, siteOrigin: string, article: NewsArticle, sample: boolean, imagePath: string) {
  const origin = normalizeSiteOrigin(siteOrigin)
  const title = `${article.title}｜${article.campus}｜${TITLE_BRAND}`
  const description = newsDescription(article) || site.siteMeta.description
  const canonical = origin && !sample ? `${origin}${newsPath(article.id)}` : undefined
  const image = origin && imagePath ? `${origin}${imagePath}` : undefined
  const graph: Record<string, unknown>[] = canonical ? [
    { '@type': 'NewsArticle', '@id': `${canonical}#article`, url: canonical, mainEntityOfPage: canonical, headline: article.title, description, datePublished: article.date, inLanguage: 'zh-Hant-TW',
      ...(image ? { image: [image] } : {}), author: { '@type': 'EducationalOrganization', '@id': organizationId(origin), name: site.siteMeta.brandName, url: `${origin}/` },
      publisher: { '@type': 'EducationalOrganization', '@id': organizationId(origin), name: site.siteMeta.brandName, url: `${origin}/`, ...(site.siteMeta.logo ? { logo: `${origin}/${site.siteMeta.logo.replace(/^\/+/, '')}` } : {}) }, isPartOf: { '@id': `${origin}/#website` } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首頁', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: '最新消息', item: `${origin}${NEWS_PATH}` },
      { '@type': 'ListItem', position: 3, name: article.title, item: canonical }
    ] },
    ...siteNodes(site, origin)
  ] : []
  // 分享預覽標成文章並帶發布日期；封面沒填說明（粉專轉來的消息）就用標題當圖片說明。
  return { title, description, canonical, image, imagePath, imageAlt: article.alt || article.title, graph, ogType: 'article' as const, publishedTime: article.date }
}

export function pageSeo(site: SiteContent, siteOrigin: string) {
  const origin = normalizeSiteOrigin(siteOrigin)
  const title = site.siteMeta.title
  const description = site.siteMeta.description
  const canonical = origin ? `${origin}/` : undefined
  // 分享圖用 1200×630 JPG（scripts/optimize-site-images.py 的 OG_IMAGES 產出）；
  // 社群平台對 WebP 支援不一致。
  const share = siteShareImage(site)
  const imagePath = share.path
  const image = origin ? `${origin}${imagePath}` : undefined
  // 機構（完整）、網站、五校。各校節點的理由見 campusNode。
  const graph: Record<string, unknown>[] = origin
    ? [...siteNodes(site, origin, true), ...site.campuses.map((campus) => campusNode(site, origin, campus))]
    : []
  return { title, description, canonical, image, imagePath, imageAlt: share.alt, graph }
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
    // 預約頁（/visit、/visit/<校>）2026-11-11 起開放收錄，不再整個擋掉：搜尋引擎與 AI 助理要讀得到
    // 這頁的五校地址電話與參觀方式。修改預約頁帶個人連結，照舊不給爬（頁面另有 noindex 標頭）。
    'Disallow: /visit/manage',
    // 公開素材（後台上傳、頁面 <img>／<video> 直接引用的照片與影片）走 /api/ 底下，2026-11-13 起單獨放行，
    // 否則首頁用素材庫的照片搜尋引擎抓不到。規則比對取最長路徑，這條比下面的 /api/ 長所以優先；其餘 API 照舊不給爬。
    'Allow: /api/website/v1/public/media/',
    'Disallow: /api/',
    `Sitemap: ${origin}/sitemap.xml`,
    ''
  ].join('\n')
}

/** 不能收錄時回的 sitemap：合法但沒有任何網址。 */
export const EMPTY_SITEMAP = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n'

/**
 * news：已發布的消息（示意內容由 indexableArticles 排除）；沒傳就只列固定頁。privacy：政策已發布才列 /privacy。
 * anniversary：false＝後台關掉 30 週年，不列 /anniversary。admission：false＝後台隱藏入學資訊分頁，不列 /admission。campuses：各校 key，列 /visit/<校>（2026-11-11 預約頁開放收錄）。
 * newsPages：false＝後台關掉最新消息，/news 與每一則消息都不列（網址會導回首頁）。
 */
export function sitemapXml(origin: string, news?: Pick<NewsContent, 'articles' | 'sampleNote'>, options: { privacy?: boolean; anniversary?: boolean; admission?: boolean; campuses?: string[]; newsPages?: boolean } = {}): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const urls = ['/', ABOUT_PATH, CURRICULUM_PATH, ...(options.admission === false ? [] : [ADMISSION_PATH]), ENVIRONMENT_PATH, ...(options.anniversary === false ? [] : [ANNIVERSARY_PATH]), ...(options.newsPages === false ? [] : [NEWS_PATH]), ...(options.privacy ? [PRIVACY_PATH] : []),
    VISIT_PATH, ...(options.campuses ?? []).map((key) => `${VISIT_PATH}/${encodeURIComponent(key)}`),
    ...(news && options.newsPages !== false ? indexableArticles(news.articles, news.sampleNote).map((a) => newsPath(a.id)) : [])]
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((path) => `<url><loc>${escape(`${origin}${path}`)}</loc></url>`).join('')}</urlset>\n`
}

/**
 * /llms.txt（https://llmstxt.org/）：給 AI 助理讀的網站摘要。只用已發布內容的名稱、描述、地址、電話與
 * 入學頁的常見問題（和頁面同一份），不另寫宣傳文案；未開放索引時不提供（見路由）。
 * 2026-11-11：補一句話介紹、五校地址電話、常見問題——AI 助理最常被問的是「在哪、電話幾號、幾歲能讀、
 * 有沒有補助」，原本只有各頁連結、沒有任何可直接引用的事實。沒傳 campuses／admission（舊呼叫）就不列那兩段。
 */
export function llmsTxt(origin: string, site: Pick<SiteContent, 'siteMeta'> & Partial<Pick<SiteContent, 'campuses' | 'admission'>>): string {
  const line = (value: string) => value.replace(/\s+/g, ' ').trim()
  const campuses = site.campuses ?? []
  const brand = line(site.siteMeta.brandName)
  const out = [
    `# ${brand}`,
    '',
    `> ${line(site.siteMeta.description)}`,
    ''
  ]
  if (campuses.length) {
    const names = [brand, site.siteMeta.brandNameEn ? line(site.siteMeta.brandNameEn) : ''].filter((name) => name && name !== SCHOOL_NAME).join('，')
    const region = campusRegion(campuses)
    out.push(`${SCHOOL_NAME}${names ? `（${names}）` : ''}${region ? `在${region}` : ''}有 ${campuses.length} 所校園：${campuses.map((campus) => `${campus.name}（${campus.district}）`).join('、')}。`, '')
    out.push('## 各校地址與電話', '', ...campuses.map((campus) =>
      `- [${SCHOOL_NAME}${line(campus.name)}](${origin}${VISIT_PATH}/${encodeURIComponent(campus.key)})：${line(campus.address)}${campus.phone ? `，電話 ${line(campus.phone)}` : ''}。`), '')
  }
  out.push('## 關於常春藤', '', `- [關於常春藤](${origin}${ABOUT_PATH})：1997 年創立以來的五校沿革、全人教育的六大領域與六大核心素養。`, '')
  // 後台隱藏入學資訊分頁時（/admission 回 404）：不列這一頁，下面的常見問題也不列（每題都連到這一頁的錨點）。
  const admission = admissionEnabled(site.siteMeta)
  if (admission) out.push('## 入學資訊', '', `- [入學資訊](${origin}${ADMISSION_PATH})：入學流程、依生日查詢就讀班級、新生入園須知，以及補助、退費、學期中入學等問答。`, '')
  out.push('## 特色教學', '', `- [特色教學](${origin}${CURRICULUM_PATH})：幼幼班到大班四個年段、七個課程方向、兒童美術館，與靜心、教具操作、美術創作、閱讀、大肌肉時間五件事，以及教學理念。`, '')
  out.push('## 常春藤環境', '', `- [常春藤環境](${origin}${ENVIRONMENT_PATH})：幼兒保育的五件事、七個校園空間，與每月菜單（營養餐點書）。`, '')
  if (anniversaryEnabled(site.siteMeta)) out.push('## 常春藤 30 週年', '', `- [常春藤 30 週年](${origin}${ANNIVERSARY_PATH})：1997 到 2027，五所校園成立的年份與沿革、地址與電話，孩子的作品，以及用蠟筆畫一個 30 的畫板。`, '')
  if (newsEnabled(site.siteMeta)) out.push('## 最新消息', '', `- [最新消息](${origin}${NEWS_PATH})：五校的最新消息與近期活動。`, '')
  // 只有開放線上場次的校區能線上選時段，其他校區要來電（同 visitSeo 與入學頁「怎麼預約參觀」），不寫成全部都能線上預約。
  out.push('## 預約參觀', '', `- [預約參觀](${origin}${VISIT_PATH})：選校區看參觀方式；開放線上場次的校區可以直接選日期與場次，其他校區請打電話約時間。`, '')
  const faq = admission && site.admission ? admissionFaqEntries(site.admission, campuses) : []
  if (faq.length) out.push('## 常見問題', '', ...faq.map((entry) => `- [${line(entry.q)}](${origin}${ADMISSION_PATH}#${entry.id})：${line(entry.a)}`), '')
  return out.join('\n')
}
