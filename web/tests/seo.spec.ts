import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { aboutSeo, admissionSeo, anniversarySeo, curriculumSeo, environmentSeo, llmsTxt, newsArticleSeo, newsListSeo, normalizeSiteOrigin, ogImagePath, pageSeo, privacySeo, serializeJsonLd, siteShareImage, sitemapXml } from '../app/utils/seo'
import { httpsUrl } from '../app/utils/site-links'
import { publishedContent } from '../app/utils/published-content'

const site = fixture as unknown as SiteContent
describe('公開搜尋資料', () => {
  it('正式 origin 僅接受 HTTPS origin，拒絕帳密、路徑、query 與 localhost', () => {
    expect(normalizeSiteOrigin('https://ivy.example/')).toBe('https://ivy.example')
    for (const value of ['http://ivy.example', 'https://a:b@ivy.example', 'https://ivy.example/a', 'https://ivy.example/?secret=x', 'https://localhost', 'invalid']) {
      expect(normalizeSiteOrigin(value)).toBe('')
    }
  })
  it('首頁結構化資料只有機構與網站，不列各校 Preschool／FAQPage／麵包屑；分享圖為 1200×630 JPG 且檔案存在', () => {
    const result = pageSeo(site, 'https://ivy.example')
    expect(result.canonical).toBe('https://ivy.example/')
    expect(result.graph.map((item) => item['@type'])).toEqual(['EducationalOrganization', 'WebSite'])
    expect(JSON.stringify(result.graph)).not.toMatch(/campuses\/|Preschool|FAQPage|openingHours|aggregateRating/)
    expect(result.image).toMatch(/\/assets\/og\/[\w-]+\.jpg$/)
    expect(existsSync(new URL(`../public${ogImagePath(site.home.hero.heroImage)}`, import.meta.url))).toBe(true)
  })
  it('機構節點帶 logo、英文名、創立年份與全站社群', () => {
    const org = pageSeo(site, 'https://ivy.example').graph.find((item) => item['@type'] === 'EducationalOrganization')!
    expect(org.logo).toBe('https://ivy.example/assets/logo.png')
    expect(existsSync(new URL('../public/assets/logo.png', import.meta.url))).toBe(true)
    expect(org.alternateName).toBe(site.siteMeta.brandNameEn)
    expect(org.foundingDate).toBe('1997')
    expect(org.sameAs).toEqual(site.siteMeta.socialLinks!.map((link) => link.url))
  })
  it('創立年份跟著關於常春藤頁沿革第一站（後台改成 1998 就是 1998）', () => {
    const edited = { ...site, aboutPage: { ...site.aboutPage, milestones: site.aboutPage.milestones.map((m, i) => (i ? m : { ...m, year: 1998 })) } }
    const org = pageSeo(edited, 'https://ivy.example').graph.find((item) => item['@type'] === 'EducationalOrganization')!
    expect(org.foundingDate).toBe('1998')
  })
  it('CMS 文字不能關閉 JSON-LD script；解析後保留原文', () => {
    const value = { name: '</script><script>alert(1)</script>&' }
    const encoded = serializeJsonLd(value)
    expect(encoded).not.toContain('<')
    expect(JSON.parse(encoded)).toEqual(value)
  })
  it('沒有 origin 不產生假 canonical 或 JSON-LD 網址', () => {
    expect(pageSeo(site, '').canonical).toBeUndefined()
    expect(pageSeo(site, '').graph).toEqual([])
  })
  it('llms.txt 不列各校網址與常見問答', () => {
    const text = llmsTxt('https://ivy.example', { siteMeta: site.siteMeta })
    expect(text.startsWith(`# ${site.siteMeta.brandName}\n`)).toBe(true)
    expect(text).not.toMatch(/campuses\/|常見問題|## 校區/)
  })
  it('sitemap 不含分校頁、不虛構 lastmod', () => {
    const xml = sitemapXml('https://ivy.example')
    expect(xml).toContain('<loc>https://ivy.example/</loc>')
    expect(xml).not.toContain('/campuses/')
    expect(xml).not.toContain('lastmod')
  })
  it('公開合成資料只保留 release 中已發布 profile，且不修改 fixture', () => {
    const c = site.campuses[4]!
    const result = publishedContent(site, {
      schema_version: '1', release_id: 'release-1', content: {
        campus_profile: { renwu: { name: c.name, district: c.district, address: '已發布的仁武地址', phone: c.phone, facebook: c.facebook, line: '' } }
      }
    })
    expect(result.content.campuses.map((campus) => campus.key)).toEqual(['renwu'])
    expect(result.content.campuses[0]!.address).toBe('已發布的仁武地址')
    expect(site.campuses).toHaveLength(5)
    expect(() => publishedContent(site, { schema_version: '1', release_id: null, content: {} })).toThrow()
  })
})

// 後台「各頁搜尋與分享」（2026-10-12）：七頁的標題、描述與分享圖可由 siteMeta.pageSeo 覆寫，空值沿用內建。
const ORIGIN = 'https://ivy.example'
const SHARE = '3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c'
type PageEntry = { title?: string; description?: string; shareImage?: string; shareImageAlt?: string }
const withPageSeo = (key: string, entry: PageEntry, siteMeta: Partial<SiteContent['siteMeta']> = {}): SiteContent => ({
  ...site, siteMeta: { ...site.siteMeta, ...siteMeta, pageSeo: { [key]: entry } as NonNullable<SiteContent['siteMeta']['pageSeo']> }
})
const PAGES = [
  ['admission', admissionSeo], ['about', aboutSeo], ['curriculum', curriculumSeo], ['environment', environmentSeo],
  ['news', newsListSeo], ['anniversary', anniversarySeo], ['privacy', privacySeo]
] as const

describe.each(PAGES)('%s 頁的搜尋設定讀後台 pageSeo', (key, seoOf) => {
  const builtin = seoOf(site, ORIGIN)
  it('沒有 pageSeo（舊資料）或沒列到這一頁：全部沿用內建', () => {
    expect(seoOf({ ...site, siteMeta: { ...site.siteMeta, pageSeo: {} } }, ORIGIN)).toEqual(builtin)
    expect(seoOf(withPageSeo(key === 'about' ? 'news' : 'about', { title: '別頁的標題' }), ORIGIN)).toEqual(builtin)
  })
  it('標題與描述有填就覆寫（包含結構化資料的 name／description），沒填的欄位沿用內建', () => {
    const result = seoOf(withPageSeo(key, { title: '自訂標題｜常春藤' }), ORIGIN)
    expect(result.title).toBe('自訂標題｜常春藤')
    expect(result.description).toBe(builtin.description)
    expect(result.graph[0]).toMatchObject({ name: '自訂標題｜常春藤' })
    const both = seoOf(withPageSeo(key, { title: '自訂標題', description: '自訂描述' }), ORIGIN)
    expect(both.description).toBe('自訂描述')
    expect(both.graph[0]).toMatchObject({ description: '自訂描述' })
  })
  it('空字串與全空白視為沒設定', () => {
    expect(seoOf(withPageSeo(key, { title: '', description: '   ', shareImage: '', shareImageAlt: '' }), ORIGIN)).toEqual(builtin)
  })
  it('分享圖是合法素材 UUID：og:image 走公開素材網址，說明用該頁的，沒填退回全站說明', () => {
    const result = seoOf(withPageSeo(key, { shareImage: SHARE, shareImageAlt: '本頁分享圖' }), ORIGIN)
    expect(result.imagePath).toBe(`/api/website/v1/public/media/${SHARE}/file`)
    expect(result.image).toBe(`${ORIGIN}/api/website/v1/public/media/${SHARE}/file`)
    expect(result.imageAlt).toBe('本頁分享圖')
    // 本頁沒填說明：退回全站分享圖的說明（全站也沒設分享圖時，就是首頁大圖的說明）
    const noAlt = seoOf(withPageSeo(key, { shareImage: SHARE }, { shareImage: '11111111-1111-4111-8111-111111111111', shareImageAlt: '全站說明' }), ORIGIN)
    expect(noAlt.imagePath).toBe(`/api/website/v1/public/media/${SHARE}/file`)
    expect(noAlt.imageAlt).toBe('全站說明')
    expect(seoOf(withPageSeo(key, { shareImage: SHARE }), ORIGIN).imageAlt).toBe(site.home.hero.heroImageAlt)
  })
  it('分享圖不是合法 UUID：退回全站分享圖，本頁的說明也不套用', () => {
    for (const bad of ['not-a-uuid', '-'.repeat(36), 'javascript:alert(1)', `${SHARE}x`, '../../etc/passwd']) {
      const result = seoOf(withPageSeo(key, { shareImage: bad, shareImageAlt: '不該出現' }), ORIGIN)
      expect(result.imagePath).toBe(builtin.imagePath)
      expect(result.imageAlt).toBe(builtin.imageAlt)
    }
  })
  it('沒有分享圖時，全站分享圖照舊優先於首頁大圖', () => {
    const result = seoOf(withPageSeo(key, { title: '只改標題' }, { shareImage: SHARE, shareImageAlt: '全站' }), ORIGIN)
    expect(result.imagePath).toBe(`/api/website/v1/public/media/${SHARE}/file`)
    expect(result.imageAlt).toBe('全站')
  })
})

describe('各頁搜尋設定的細節', () => {
  it('30 週年頁沿用既有標題格式，後台有填才覆寫', () => {
    expect(anniversarySeo(site, ORIGIN).title).toBe(`常春藤 30 週年｜1997—2027｜${site.siteMeta.brandName}`)
    expect(anniversarySeo(withPageSeo('anniversary', { title: '30 週年特別企劃' }), ORIGIN).title).toBe('30 週年特別企劃')
  })
  it('隱私權政策頁：後台沒填時標題仍以政策標題為準', () => {
    expect(privacySeo(site, ORIGIN).title).toBe(`${site.privacyPolicy?.title || '隱私權政策'}｜${site.siteMeta.brandName}`)
    expect(privacySeo(withPageSeo('privacy', { title: '個資說明' }), ORIGIN).title).toBe('個資說明')
  })
  it('入學頁讀 pageSeo.admission（不再讀舊的 admissionTitle／admissionDescription）', () => {
    const custom = withPageSeo('admission', { title: '入學資訊｜常春藤', description: '自訂描述' })
    expect(admissionSeo(custom, '').title).toBe('入學資訊｜常春藤')
    expect(admissionSeo(custom, '').description).toBe('自訂描述')
    const legacy = { ...site, siteMeta: { ...site.siteMeta, admissionTitle: '舊欄位', admissionDescription: '舊描述' } } as unknown as SiteContent
    expect(admissionSeo(legacy, '').title).toContain('入學資訊｜入學流程')
  })
  it('首頁不吃 pageSeo；單篇消息不吃 pageSeo.news', () => {
    const custom = withPageSeo('news', { title: '消息列表', description: '列表描述', shareImage: SHARE })
    expect(pageSeo(custom, ORIGIN)).toEqual(pageSeo(site, ORIGIN))
    const article = site.news.articles[0]!
    expect(newsArticleSeo(custom, ORIGIN, article, false, '/cover.jpg')).toEqual(newsArticleSeo(site, ORIGIN, article, false, '/cover.jpg'))
  })
  it('siteShareImage 只收嚴格 UUID（36 個連字號不算）', () => {
    expect(siteShareImage({ ...site, siteMeta: { ...site.siteMeta, shareImage: '-'.repeat(36) } }).path).toMatch(/^\/assets\/og\//)
    expect(siteShareImage({ ...site, siteMeta: { ...site.siteMeta, shareImage: SHARE.toUpperCase() } }).path).toBe(`/api/website/v1/public/media/${SHARE.toUpperCase()}/file`)
  })
  it('機構 sameAs 取後台的社群清單，只列 https；清單是空的就不輸出 sameAs', () => {
    const find = (s: SiteContent) => pageSeo(s, ORIGIN).graph.find((item) => item['@type'] === 'EducationalOrganization')!
    const custom = { ...site, siteMeta: { ...site.siteMeta, socialLinks: [
      { platform: 'instagram' as const, label: 'IG', url: 'https://www.instagram.com/ivy' },
      { platform: 'youtube' as const, label: 'YT', url: 'https://www.youtube.com/@ivy' }
    ] } }
    expect(find(custom).sameAs).toEqual(['https://www.instagram.com/ivy', 'https://www.youtube.com/@ivy'])
    expect(find({ ...site, siteMeta: { ...site.siteMeta, socialLinks: [] } })).not.toHaveProperty('sameAs')
  })
})

describe('httpsUrl', () => {
  it('只收完整的 https 網址，回傳去掉前後空白的值', () => {
    expect(httpsUrl('https://www.facebook.com/ivykid')).toBe('https://www.facebook.com/ivykid')
    expect(httpsUrl('  https://line.me/R/ti/p/@ivy  ')).toBe('https://line.me/R/ti/p/@ivy')
  })
  it('其他一律不通過', () => {
    for (const bad of ['', '  ', null, undefined, 'http://example.com', 'javascript:alert(1)', 'data:text/html,x', '//example.com', '/relative', 'https://', 'https://user:pw@example.com', 'https://exa mple.com', 'https://example.com/a b', 'https://example.com\\evil']) {
      expect(httpsUrl(bad as string | null | undefined)).toBeUndefined()
    }
  })
})
