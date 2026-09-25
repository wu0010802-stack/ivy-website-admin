import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { NewsArticle, SiteContent } from '../app/types/site-content'
import { applyContentOverlay, mergeCampusFaq, type LiveHomeNews } from '../app/utils/content-overlay'
import { previewOverlay } from '../app/utils/draft-preview'
import { eventTimeText, homeArticles, safeWebUrl } from '../app/utils/news-content'
import { pageSeo } from '../app/utils/seo'

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
    name: c.name, district: c.district, address: c.address, phone: c.phone, intro: c.intro,
    description: c.description, facebook: c.facebook, fb_note: c.fbNote, line: c.line ?? ''
  }
}

describe('常見問題：全站共用＋各校', () => {
  const shared = {
    items: [
      { id: 's1', q: '共用一', a: '共用答一' },
      { id: 's2', q: '共用二', a: '共用答二', enabled: false },
      { id: 's3', q: '只給仁武', a: '仁武答', scope: 'campus' as const, campus_keys: ['renwu'] },
      { id: 's4', q: '可以改嗎？', a: '共用的回答' }
    ]
  }

  it('共用題目預設放在本校題目之前，停用的共用題目不出現', () => {
    const items = mergeCampusFaq('yihua', { items: [{ q: '本校題', a: '本校答' }] }, shared)
    expect(items.map((i) => i.q)).toEqual(['共用一', '可以改嗎？', '本校題'])
  })

  it('可以放在之後，或完全不顯示共用題目；指定校區的共用題只在那一校', () => {
    const after = mergeCampusFaq('renwu', { items: [{ q: '本校題', a: '本校答' }], shared_position: 'after' }, shared)
    expect(after.map((i) => i.q)).toEqual(['本校題', '共用一', '只給仁武', '可以改嗎？'])
    const off = mergeCampusFaq('renwu', { items: [{ q: '本校題', a: '本校答' }], include_shared: false }, shared)
    expect(off.map((i) => i.q)).toEqual(['本校題'])
  })

  it('本校有同一題時顯示本校版本，停用就是本校不顯示那一題；其他校不受影響', () => {
    const own = mergeCampusFaq('yihua', { items: [{ q: '可以改嗎？', a: '義華的回答' }, { q: '共用一', a: '', enabled: false }] }, shared)
    expect(own).toEqual([{ q: '可以改嗎？', a: '義華的回答' }])
    const other = mergeCampusFaq('minghua', { items: [] }, shared)
    expect(other).toEqual([{ q: '共用一', a: '共用答一' }, { q: '可以改嗎？', a: '共用的回答' }])
  })

  it('分校頁與 FAQPage 結構化資料都用合併後的題目；沒有各校設定的校區維持原文', () => {
    const next = applyContentOverlay(site, {
      shared_faq: shared,
      campus_faq: { renwu: { items: [{ q: '仁武自己的', a: '答' }], shared_position: 'after' } }
    })
    const renwu = next.campuses.find((c) => c.key === 'renwu')!
    expect(renwu.faq.items.map((i) => i.q)).toEqual(['仁武自己的', '共用一', '只給仁武', '可以改嗎？'])
    const faqPage = pageSeo(next, 'https://ivy.example', renwu).graph.find((item) => item['@type'] === 'FAQPage')!
    expect((faqPage.mainEntity as { name: string }[]).map((q) => q.name)).toEqual(renwu.faq.items.map((i) => i.q))
    expect(next.campuses.find((c) => c.key === 'yihua')!.faq.items).toEqual(site.campuses[0]!.faq.items)
  })
})
