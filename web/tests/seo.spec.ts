import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { normalizeSiteOrigin, pageSeo, serializeJsonLd, sitemapXml } from '../app/utils/seo'
import { publishedContent } from '../app/utils/published-content'

const site = fixture as unknown as SiteContent
describe('公開搜尋資料', () => {
  it('正式 origin 僅接受 HTTPS origin，拒絕帳密、路徑、query 與 localhost', () => {
    expect(normalizeSiteOrigin('https://ivy.example/')).toBe('https://ivy.example')
    for (const value of ['http://ivy.example', 'https://a:b@ivy.example', 'https://ivy.example/a', 'https://ivy.example/?secret=x', 'https://localhost', 'invalid']) {
      expect(normalizeSiteOrigin(value)).toBe('')
    }
  })
  it('各校 canonical、分享圖與實體資料指向同一校；不杜撰時間或評論', () => {
    const campus = site.campuses[4]!
    const result = pageSeo(site, 'https://ivy.example', campus)
    expect(result.canonical).toBe('https://ivy.example/campuses/renwu')
    expect(result.title).toContain(campus.district)
    expect(result.image).toMatch(/^https:\/\/ivy.example\/assets\//)
    const school = result.graph.find((item) => item['@type'] === 'Preschool')!
    expect(school.address).toMatchObject({ streetAddress: campus.address })
    expect(school.telephone).toBe(campus.phone)
    expect(school).not.toHaveProperty('openingHours')
    expect(school).not.toHaveProperty('aggregateRating')
    expect(result.graph.find((item) => item['@type'] === 'BreadcrumbList')).toBeTruthy()
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
  it('sitemap 僅含傳入的已發布校區、不虛構 lastmod', () => {
    const xml = sitemapXml('https://ivy.example', [site.campuses[4]!])
    expect(xml).toContain('/campuses/renwu')
    expect(xml).not.toContain('yihua')
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
