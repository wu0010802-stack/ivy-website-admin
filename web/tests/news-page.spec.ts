import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { NewsArticle, SiteContent } from '../app/types/site-content'
import { articlesForCampus, findArticle, indexableArticles, NEWS_PATH, newsPath } from '../app/utils/news-content'
import { llmsTxt, newsArticleSeo, newsListSeo, sitemapXml } from '../app/utils/seo'

const site = fixture as unknown as SiteContent
const article = (over: Partial<NewsArticle>): NewsArticle => ({
  id: 'a', date: '2026-09-01', campus: '全校', campusKeys: [], category: '校園日常', title: '標題', description: '摘要', image: 'garden', alt: '', ...over
})

describe('消息網址', () => {
  it('各校消息的 id 帶校區前綴，網址逐段編碼，找得回同一則', () => {
    expect(newsPath('yihua:open-day')).toBe('/news/yihua%3Aopen-day')
    expect(newsPath('中秋 活動')).toBe('/news/%E4%B8%AD%E7%A7%8B%20%E6%B4%BB%E5%8B%95')
    const list = [article({ id: 'yihua:open-day' }), article({ id: 'b' })]
    expect(findArticle(list, decodeURIComponent('yihua%3Aopen-day'))?.id).toBe('yihua:open-day')
    expect(findArticle(list, 'missing')).toBeUndefined()
  })

  it('頁尾的最新消息指向 /news', () => {
    expect(site.footer.links.find((item) => item.label === '最新消息')?.href).toBe(NEWS_PATH)
  })
})

describe('校區篩選', () => {
  const list = [
    article({ id: 'all', date: '2026-09-03' }),
    article({ id: 'yihua:x', date: '2026-09-02', campusKeys: ['yihua'] }),
    article({ id: 'renwu:y', date: '2026-09-04', campusKeys: ['renwu'] })
  ]
  it('全校消息在每一校都看得到，依日期新到舊', () => {
    expect(articlesForCampus(list, 'yihua').map((a) => a.id)).toEqual(['all', 'yihua:x'])
    expect(articlesForCampus(list, undefined).map((a) => a.id)).toEqual(['renwu:y', 'all', 'yihua:x'])
  })
})

describe('示意消息不給搜尋引擎（2026-09-26 裁定）', () => {
  const real = article({ id: 'yihua:real', sample: false, campus: '義華校', campusKeys: ['yihua'] })
  const fake = article({ id: 'fake', sample: true })

  it('indexableArticles 排除示意；純 fixture 看整份的 sampleNote', () => {
    expect(indexableArticles([real, fake], '示意').map((a) => a.id)).toEqual(['yihua:real'])
    expect(indexableArticles(site.news.articles, site.news.sampleNote)).toEqual(site.news.sampleNote ? [] : site.news.articles)
  })

  it('sitemap 列 /news 與真實消息，不列示意消息', () => {
    const xml = sitemapXml('https://ivy.example', [], { articles: [real, fake], sampleNote: '示意' })
    expect(xml).toContain('<loc>https://ivy.example/news</loc>')
    expect(xml).toContain('<loc>https://ivy.example/news/yihua%3Areal</loc>')
    expect(xml).not.toContain('/news/fake')
  })

  it('示意單篇沒有 canonical 與結構化資料；真實單篇有 NewsArticle 與三層麵包屑', () => {
    const sample = newsArticleSeo(site, 'https://ivy.example', fake, true, '/assets/garden.webp')
    expect(sample.canonical).toBeUndefined()
    expect(sample.graph).toEqual([])
    const seo = newsArticleSeo(site, 'https://ivy.example', real, false, '/assets/garden.webp')
    expect(seo.canonical).toBe('https://ivy.example/news/yihua%3Areal')
    expect(seo.image).toBe('https://ivy.example/assets/garden.webp')
    expect(JSON.stringify(seo.graph)).toContain('"@type":"NewsArticle"')
    expect(JSON.stringify(seo.graph)).toContain('"datePublished":"2026-09-01"')
    expect(seo.title).toContain('義華校')
  })

  it('列表頁有 canonical；llms.txt 指向 /news', () => {
    expect(newsListSeo(site, 'https://ivy.example').canonical).toBe('https://ivy.example/news')
    expect(newsListSeo(site, '').graph).toEqual([])
    expect(llmsTxt('https://ivy.example', { siteMeta: site.siteMeta, campuses: [] })).toContain('(https://ivy.example/news)')
  })
})
