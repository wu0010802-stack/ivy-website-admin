import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { applyContentOverlay } from '../app/utils/content-overlay'
import { publishedContent } from '../app/utils/published-content'
import {
  isLivePreview,
  previewDate,
  previewFrameSrc,
  previewOverlay,
  previewPage,
  previewViewport,
  scheduledVisible,
  scheduleNewsDraft
} from '../app/utils/draft-preview'

const site = fixture as unknown as SiteContent

describe('草稿預覽的網址參數', () => {
  it('頁面只認首頁、入學資訊、預約、隱私權政策、特色教學頁、關於常春藤頁、常春藤環境頁與最新消息列表頁，寬度只有桌機與手機', () => {
    expect(previewPage({ page: 'admission' })).toBe('admission')
    expect(previewPage({ page: 'visit' })).toBe('visit')
    expect(previewPage({ page: 'privacy' })).toBe('privacy')
    expect(previewPage({ page: 'curriculum' })).toBe('curriculum')
    expect(previewPage({ page: 'about' })).toBe('about')
    expect(previewPage({ page: 'environment' })).toBe('environment')
    expect(previewPage({ page: 'news' })).toBe('news')
    expect(previewPage({ page: 'campus' })).toBe('home')
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
    const src = previewFrameSrc({ page: 'visit', campus: 'yihua', viewport: 'mobile', date: '2026-10-01' })
    const params = new URL(src, 'https://example.test').searchParams
    expect(src.startsWith('/preview?')).toBe(true)
    expect(Object.fromEntries(params)).toEqual({ page: 'visit', campus: 'yihua', date: '2026-10-01', embed: '1' })
  })

  it('即時預覽要同時有 embed=1 與 live=1（後台內容編輯右側的 iframe）', () => {
    expect(isLivePreview({ embed: '1', live: '1' })).toBe(true)
    expect(isLivePreview({ live: '1' })).toBe(false)
    expect(isLivePreview({ embed: '1' })).toBe(false)
    expect(isLivePreview({ embed: '1', live: ['1'] })).toBe(false)
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

// 2026-11-12 QA M9：官網輸出前會過一次 publicCopy（原型來源說明拿掉、原文一字不差的幾段換成正式站的說法），
// 草稿預覽與編輯器右側的即時預覽原本沒過：頁尾多一行「官網設計提案…」、關於段是舊句、孩子的一天是舊回答。
describe('草稿預覽和上線後是同一份文字', () => {
  it('預覽出來的內容和官網用同一份草稿發布後一樣（只差未發布的校區照樣看得到）', () => {
    const preview = previewOverlay(site, {}, '2026-11-12').content
    expect(preview.footer.bottomNote).toBe('')
    expect(preview.home.about.bodyText.startsWith('民國')).toBe(true)
    expect(preview.dayExperience.moments.map((moment) => moment.answer).join('')).not.toContain('參觀時可')
    expect(JSON.stringify(preview)).not.toContain('"_todo"')

    const overlay = { campus_profile: Object.fromEntries(site.campuses.map((campus) => [campus.key, {}])) } as never
    const published = publishedContent(site, { schema_version: '1', release_id: 'r1', content: overlay }).content
    expect(previewOverlay(site, overlay, '2026-11-12').content).toEqual({ ...published, isDemo: preview.isDemo })
  })

  it('園方改過的字照園方的，不會被換掉', () => {
    const about = { ...(site.home.about as unknown as Record<string, unknown>) }
    const footer = { tagline: '園方的標語', copyright: '©', bottom_note: '園方自己寫的頁尾說明', campus_list_label: '五校聯絡' }
    const content = previewOverlay(site, { site_footer: footer as never }, '2026-11-12').content
    expect(content.footer.bottomNote).toBe('園方自己寫的頁尾說明')
    expect(about.bodyText).toBe(site.home.about.bodyText)
  })
})
