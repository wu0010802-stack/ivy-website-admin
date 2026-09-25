import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { applyContentOverlay } from '../app/utils/content-overlay'
import {
  previewDate,
  previewFrameSrc,
  previewPage,
  previewViewport,
  scheduledVisible,
  scheduleNewsDraft
} from '../app/utils/draft-preview'

const site = fixture as unknown as SiteContent

describe('草稿預覽的網址參數', () => {
  it('頁面只認首頁、入學、分校、預約頁，寬度只有桌機與手機', () => {
    expect(previewPage({ page: 'visit' })).toBe('visit')
    expect(previewPage({ page: 'campus' })).toBe('campus')
    expect(previewPage({ page: 'unknown' })).toBe('home')
    expect(previewViewport({ viewport: 'mobile' })).toBe('mobile')
    expect(previewViewport({ viewport: ['mobile'] })).toBe('desktop')
  })

  it('預覽日期只收存在的 YYYY-MM-DD，其餘退回今天', () => {
    expect(previewDate({ date: '2026-10-01' }, '2026-09-25')).toBe('2026-10-01')
    expect(previewDate({ date: '2026-02-30' }, '2026-09-25')).toBe('2026-09-25')
    expect(previewDate({ date: '明天' }, '2026-09-25')).toBe('2026-09-25')
    expect(previewDate({}, '2026-09-25')).toBe('2026-09-25')
  })

  it('手機 iframe 帶同一頁、校區與日期，加 embed=1、不再帶 viewport', () => {
    const src = previewFrameSrc({ page: 'campus', campus: 'yihua', viewport: 'mobile', date: '2026-10-01' })
    const params = new URL(src, 'https://example.test').searchParams
    expect(src.startsWith('/preview?')).toBe(true)
    expect(Object.fromEntries(params)).toEqual({ page: 'campus', campus: 'yihua', date: '2026-10-01', embed: '1' })
  })
})

describe('草稿預覽套用消息的上下架日期', () => {
  const news = {
    sample_note: '',
    articles: [
      { id: 'now', date: '2026-09-20', campus: '全校', category: '日常', title: '已上架', description: '', image: 'news-1', alt: '', show_from: '2026-09-01' },
      { id: 'later', date: '2026-10-05', campus: '全校', category: '日常', title: '下週才上架', description: '', image: 'news-2', alt: '', show_from: '2026-10-01' },
      { id: 'gone', date: '2026-08-01', campus: '全校', category: '日常', title: '已下架', description: '', image: 'news-3', alt: '', show_until: '2026-09-24' }
    ],
    events: [{ id: 'open', date: '2026-11-02', campus: '全校', title: '開放日', description: '', show_from: '2026-10-15' }]
  }

  it('日期含當天，規則和後端 is_scheduled_visible 一樣', () => {
    expect(scheduledVisible({ show_from: '2026-09-25' }, '2026-09-25')).toBe(true)
    expect(scheduledVisible({ show_until: '2026-09-25' }, '2026-09-25')).toBe(true)
    expect(scheduledVisible({ show_until: '2026-09-24' }, '2026-09-25')).toBe(false)
    expect(scheduledVisible({}, '2026-09-25')).toBe(true)
  })

  it('預覽日當天不顯示的消息與活動拿掉並列出原因，顯示的去掉上下架欄位', () => {
    const { payload, hidden } = scheduleNewsDraft(news, '2026-09-25')
    expect(payload.articles.map((a) => a.id)).toEqual(['now'])
    expect(payload.articles[0]).not.toHaveProperty('show_from')
    expect(payload.events).toEqual([])
    expect(hidden).toEqual([
      { type: 'article', title: '下週才上架', reason: '2026-10-01 才上架' },
      { type: 'article', title: '已下架', reason: '2026-09-24 已下架' },
      { type: 'event', title: '開放日', reason: '2026-10-15 才上架' }
    ])
    // 換一天看：10/20 時下週那則已上架、開放日開始宣傳。
    const later = scheduleNewsDraft(news, '2026-10-20')
    expect(later.payload.articles.map((a) => a.id)).toEqual(['now', 'later'])
    expect(later.payload.events.map((e) => e.id)).toEqual(['open'])
  })

  it('過濾後的草稿照常疊到站台內容上', () => {
    const { payload } = scheduleNewsDraft(news, '2026-09-25')
    const content = applyContentOverlay(site, { home_news: payload as never })
    expect(content.news.articles.map((a) => a.id)).toEqual(['now'])
  })
})
