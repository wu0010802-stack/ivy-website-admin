import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { NewsArticle, SiteContent } from '../app/types/site-content'
import { applyContentOverlay, type LiveHomeNews } from '../app/utils/content-overlay'
import { previewOverlay } from '../app/utils/draft-preview'
import { eventTimeDetail, eventTimeText, homeArticles, isSampleNews, safeWebUrl, sampleCoverage } from '../app/utils/news-content'

const site = fixture as unknown as SiteContent

function article(id: string, date: string, extra: Partial<NewsArticle> = {}): NewsArticle {
  return { id, date, campus: '全校', category: '', title: id, description: '', image: 'garden', alt: '', ...extra }
}

const baseArticle = { category: '日常', title: '標題', description: '摘要', image: 'garden', alt: '' }
const baseEvent = { title: '活動', description: '說明' }

describe('首頁輪播的消息', () => {
  const list = [
    article('old', '2026-09-01', { featured: true }),
    article('new', '2026-09-20'),
    article('mid', '2026-09-10', { featured: true }),
    article('newest', '2026-09-22')
  ]

  it('有推薦時只輪播推薦的，依後台順序（不重新依日期排）', () => {
    expect(homeArticles(list).map((a) => a.id)).toEqual(['old', 'mid'])
  })

  it('完全沒有推薦時退回依日期新到舊，不會讓首頁變空', () => {
    const none = list.map((a) => ({ ...a, featured: false }))
    expect(homeArticles(none).map((a) => a.id)).toEqual(['newest', 'new', 'mid', 'old'])
  })

  it('依顯示筆數截斷；沒有設定就全部', () => {
    const none = list.map((a) => ({ ...a, featured: false }))
    expect(homeArticles(none, 2).map((a) => a.id)).toEqual(['newest', 'new'])
    expect(homeArticles(none, null)).toHaveLength(4)
  })
})

describe('活動時間與連結', () => {
  it('全天、起訖時間與只有開始時間', () => {
    expect(eventTimeText({})).toBe('全天')
    expect(eventTimeText({ allDay: true, startTime: '09:00' })).toBe('全天')
    expect(eventTimeText({ allDay: false, startTime: '09:30', endTime: '11:00' })).toBe('09:30–11:00')
    expect(eventTimeText({ allDay: false, startTime: '09:30', endTime: null })).toBe('09:30 開始')
  })

  it('卡片與詳細頁只在園方填了時間時寫時間，不替舊活動或預設的全天寫「全天」', () => {
    expect(eventTimeDetail({ allDay: false, startTime: '09:30', endTime: '11:00' })).toBe('09:30–11:00')
    // 舊活動沒有時間欄位、後台勾選框預設全天：都不寫。
    expect(eventTimeDetail({})).toBe('')
    expect(eventTimeDetail({ allDay: true })).toBe('')
    const [legacy] = applyContentOverlay(site, { home_news: { sample_note: '', articles: [], events: [{ ...baseEvent, id: 'old', date: '2026-10-06', campus: '全校' }] } }).news.events
    expect(eventTimeDetail(legacy!)).toBe('')
  })

  it('只放行 http／https 網址', () => {
    expect(safeWebUrl(' https://example.com/signup ')).toBe('https://example.com/signup')
    for (const bad of ['javascript:alert(1)', 'mailto:a@example.com', 'example.com', '', undefined]) {
      expect(safeWebUrl(bad)).toBe('')
    }
  })
})

describe('消息疊資料：全站消息的適用範圍＋各校消息', () => {
  const homeNews: LiveHomeNews = {
    sample_note: '',
    home_display_count: 6,
    articles: [
      { ...baseArticle, id: 'g', date: '2026-10-01', scope: 'global', campus_keys: [], featured: true,
        body: [{ type: 'paragraph', text: '內文' }] },
      { ...baseArticle, id: 'two', date: '2026-10-02', scope: 'campus', campus_keys: ['yihua', 'renwu'] },
      // 2026-09-25 以前發布的版本只有手打的校區文字。
      { ...baseArticle, id: 'legacy', date: '2026-10-03', campus: '明華校' }
    ],
    events: [
      { ...baseEvent, id: 'e', date: '2026-10-05', scope: 'campus', campus_keys: ['chongde'],
        all_day: false, start_time: '09:30', end_time: '11:00', location: '操場', link_url: 'https://example.com', link_label: '報名' },
      { ...baseEvent, id: 'old-event', date: '2026-10-06', campus: '全校' }
    ]
  }

  it('校區文字由適用範圍與分校名稱產生，舊資料沿用原文字', () => {
    const next = applyContentOverlay(site, {
      home_news: homeNews,
      campus_profile: { renwu: { ...profile('renwu'), name: '仁武新校名' } }
    })
    const byId = Object.fromEntries(next.news.articles.map((a) => [a.id, a]))
    expect(byId.g).toMatchObject({ campus: '全校', campusKeys: [], featured: true, body: [{ type: 'paragraph', text: '內文' }] })
    expect(byId.two).toMatchObject({ campus: '義華校、仁武新校名', campusKeys: ['yihua', 'renwu'] })
    expect(byId.legacy).toMatchObject({ campus: '明華校', campusKeys: [], featured: false, body: [] })
    expect(next.news.homeCount).toBe(6)
    expect(next.news.events[0]).toMatchObject({
      campus: '崇德校', month: 'OCT', allDay: false, startTime: '09:30', endTime: '11:00',
      location: '操場', linkUrl: 'https://example.com', linkLabel: '報名'
    })
    // 舊活動沒有新欄位：全天、沒有地點與連結。
    expect(next.news.events[1]).toMatchObject({ campus: '全校', allDay: true, startTime: null, location: '', linkUrl: '' })
  })

  it('各校消息併進同一份清單，標上校名、id 加校區，不能被推薦到首頁', () => {
    const next = applyContentOverlay(site, {
      home_news: homeNews,
      campus_news: {
        minghua: {
          articles: [{ ...baseArticle, id: 'g', date: '2026-10-04', featured: true } as never],
          events: [{ ...baseEvent, id: 'sports', date: '2026-10-09' }]
        },
        // 不在官網分校清單裡的 key 不顯示。
        nowhere: { articles: [{ ...baseArticle, id: 'x', date: '2026-10-04' }], events: [] }
      }
    })
    const own = next.news.articles.find((a) => a.id === 'minghua:g')!
    expect(own).toMatchObject({ campus: '明華校', campusKeys: ['minghua'], featured: false })
    expect(next.news.articles.some((a) => a.id.startsWith('nowhere'))).toBe(false)
    expect(next.news.events.map((e) => e.id)).toContain('minghua:sports')
    expect(homeArticles(next.news.articles).map((a) => a.id)).toEqual(['g'])
  })

  it('只有各校消息、還沒有全站消息時保留原本的消息再加上各校的', () => {
    const next = applyContentOverlay(site, {
      campus_news: { yihua: { articles: [{ ...baseArticle, id: 'y', date: '2026-10-04' }], events: [] } }
    })
    expect(next.news.articles).toHaveLength(site.news.articles.length + 1)
    expect(next.news.sampleNote).toBe(site.news.sampleNote)
    // 沿用的內建消息仍是示意，分校自己發布的那則不是。
    expect(next.news.articles.find((a) => a.id === 'yihua:y')!.sample).toBe(false)
    expect(next.news.articles.filter((a) => a.id !== 'yihua:y').every((a) => a.sample === true)).toBe(true)
  })

  it('全站消息還是示意內容時，各校發布的真實消息與活動不被標成範例', () => {
    const next = applyContentOverlay(site, {
      home_news: { ...homeNews, sample_note: '設計示意｜消息與活動日期均為範例。' },
      campus_news: {
        minghua: {
          articles: [{ ...baseArticle, id: 'open-house', date: '2026-10-04' }],
          events: [{ ...baseEvent, id: 'sports', date: '2026-10-09' }]
        }
      }
    })
    const { sampleNote } = next.news
    const own = next.news.articles.find((a) => a.id === 'minghua:open-house')!
    const ownEvent = next.news.events.find((e) => e.id === 'minghua:sports')!
    expect(isSampleNews(own, sampleNote)).toBe(false)
    expect(isSampleNews(ownEvent, sampleNote)).toBe(false)
    expect(next.news.articles.filter((a) => !a.id.startsWith('minghua:')).every((a) => isSampleNews(a, sampleNote))).toBe(true)
    // 混著真實消息：不在區塊標題整區標「示意內容」，改成逐則標。
    expect(sampleCoverage(next.news.articles, sampleNote)).toBe('some')
    expect(sampleCoverage([own], sampleNote)).toBe('none')
    expect(sampleCoverage(next.news.articles.filter((a) => a !== own), sampleNote)).toBe('all')
  })

  it('全站消息清空示意說明後沒有任何一則是示意；純 fixture 沒有逐則標記時沿用整份說明', () => {
    const next = applyContentOverlay(site, { home_news: homeNews })
    expect(sampleCoverage([...next.news.articles, ...next.news.events], next.news.sampleNote)).toBe('none')
    expect(isSampleNews(site.news.articles[0]!, site.news.sampleNote)).toBe(true)
    expect(isSampleNews(site.news.articles[0]!, '')).toBe(false)
    expect(sampleCoverage([], site.news.sampleNote)).toBe('none')
  })

  it('預覽依日期過濾各校消息，被藏起來的標上校名', () => {
    const { content, hiddenNews } = previewOverlay(site, {
      campus_news: {
        renwu: {
          articles: [
            { ...baseArticle, id: 'soon', date: '2026-10-04', show_from: '2026-10-10' } as never,
            { ...baseArticle, id: 'now', date: '2026-10-04' }
          ],
          events: []
        }
      }
    }, '2026-10-01')
    expect(content.news.articles.map((a) => a.id)).toContain('renwu:now')
    expect(content.news.articles.map((a) => a.id)).not.toContain('renwu:soon')
    expect(hiddenNews).toEqual([{ type: 'article', title: '標題（仁武校）', reason: '2026-10-10 才上架' }])
  })
})

function profile(key: string) {
  const c = site.campuses.find((x) => x.key === key)!
  return {
    name: c.name, district: c.district, address: c.address, phone: c.phone, facebook: c.facebook, line: c.line ?? ''
  }
}
