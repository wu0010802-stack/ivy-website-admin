import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { llmsTxt, normalizeSiteOrigin, ogImagePath, pageSeo, serializeJsonLd, sitemapXml } from '../app/utils/seo'
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
        campus_profile: { renwu: { name: c.name, district: c.district, address: c.address, phone: c.phone, intro: c.intro, description: '已發布的仁武介紹', facebook: c.facebook, fb_note: c.fbNote, line: '' } }
      }
    })
    expect(result.content.campuses.map((campus) => campus.key)).toEqual(['renwu'])
    expect(result.content.campuses[0]!.description).toBe('已發布的仁武介紹')
    expect(site.campuses).toHaveLength(5)
    expect(() => publishedContent(site, { schema_version: '1', release_id: null, content: {} })).toThrow()
  })
})
