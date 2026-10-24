import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { NewsArticle, NewsEvent, SiteContent } from '../app/types/site-content'
import { applyContentOverlay } from '../app/utils/content-overlay'
import { newsMonth, sortedArticles, taipeiToday, upcomingEvents, withoutSampleNews } from '../app/utils/news-content'
import { publishedContent } from '../app/utils/published-content'

const site = fixture as unknown as SiteContent
const article = (id: string, date: string) => ({ id, date }) as NewsArticle
const event = (id: string, date: string) => ({ id, date }) as NewsEvent

describe('首頁消息與活動（後台 home_news）', () => {
  it('月份由日期推出，台北日期不受伺服器 UTC 影響', () => {
    expect(newsMonth('2026-09-26')).toBe('SEP')
    expect(newsMonth('2026-12-01')).toBe('DEC')
    // UTC 9/24 16:30 在台北已是 9/25。
    expect(taipeiToday(new Date('2026-09-24T16:30:00Z'))).toBe('2026-09-25')
  })

  it('消息新到舊、同日保留後台順序；活動只列今天以後、近到遠', () => {
    expect(sortedArticles([article('a', '2026-09-01'), article('b', '2026-09-10'), article('c', '2026-09-10')]).map((a) => a.id))
      .toEqual(['b', 'c', 'a'])
    expect(upcomingEvents([event('late', '2026-10-17'), event('past', '2026-09-23'), event('today', '2026-09-24')], '2026-09-24').map((e) => e.id))
      .toEqual(['today', 'late'])
  })

  it('後台發布的消息整組取代 fixture，清空示意說明後不再是示意內容', () => {
    const result = applyContentOverlay(site, {
      home_news: {
        sample_note: '',
        articles: [{ id: 'real', date: '2026-10-01', campus: '義華校', category: '校園日常', title: '真的消息', description: '內容', image: '0b8f1c2e-1111-4a2b-9c3d-123456789abc', alt: '照片' }],
        events: [{ id: 'visit', date: '2026-11-02', campus: '全校', title: '開放日', description: '說明' }]
      }
    })
    expect(result.news.sampleNote).toBe('')
    expect(result.news.articles.map((a) => a.id)).toEqual(['real'])
    expect(result.news.events[0]).toMatchObject({ id: 'visit', month: 'NOV' })
    expect(result.news.sectionId).toBe(site.news.sectionId)
    expect(site.news.articles).toHaveLength(6)
  })

  it('後台清空消息與活動時官網也跟著空，不回填 fixture 示意內容', () => {
    const result = applyContentOverlay(site, { home_news: { sample_note: '', articles: [], events: [] } })
    expect(result.news.articles).toEqual([])
    expect(result.news.events).toEqual([])
  })
})

describe('正式站不沿用內建示意消息（2026-10-24）', () => {
  const campusProfiles = Object.fromEntries(site.campuses.map((c) => [c.key, { name: c.name, district: c.district, address: c.address, phone: c.phone }]))
  const live = (content: Record<string, unknown>) =>
    publishedContent(site, { schema_version: '1', release_id: 'r1', content: { campus_profile: campusProfiles, ...content } as never }).content.news

  it('後台沒發布全站消息：fixture 的示意消息與活動都不上正式站，示意說明清空', () => {
    expect(site.news.sampleNote).not.toBe('')
    const news = live({})
    expect(news.articles).toEqual([])
    expect(news.events).toEqual([])
    expect(news.sampleNote).toBe('')
  })

  it('只有各校發布消息時：留下各校的真實消息，拿掉 fixture 的示意消息', () => {
    const news = live({
      campus_news: { minghua: { articles: [{ id: 'own', date: '2026-10-20', category: '校園日常', title: '明華的消息', description: '', image: '', alt: '' }], events: [] } }
    })
    expect(news.articles.map((a) => a.id)).toEqual(['minghua:own'])
    expect(news.sampleNote).toBe('')
  })

  it('後台明確發布、填了示意說明的全站消息：照舊顯示並標示（園方的選擇）', () => {
    const news = live({ home_news: { sample_note: '示意', articles: [{ id: 'a', date: '2026-10-01', campus: '全校', category: '日常', title: '標題', description: '', image: '', alt: '' }], events: [] } })
    expect(news.articles).toHaveLength(1)
    expect(news.sampleNote).toBe('示意')
  })

  it('withoutSampleNews 不修改傳入的內容', () => {
    const before = site.news.articles.length
    withoutSampleNews(site.news)
    expect(site.news.articles).toHaveLength(before)
  })
})
