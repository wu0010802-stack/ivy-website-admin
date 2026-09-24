import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { NewsArticle, NewsEvent, SiteContent } from '../app/types/site-content'
import { applyContentOverlay } from '../app/utils/content-overlay'
import { newsMonth, sortedArticles, taipeiToday, upcomingEvents } from '../app/utils/news-content'

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
