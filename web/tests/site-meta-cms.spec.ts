import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { aboutSeo, admissionSeo, curriculumSeo, pageSeo } from '../app/utils/seo'
import { applyContentOverlay } from '../app/utils/content-overlay'

const site = fixture as unknown as SiteContent
const MEDIA = '3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c'
const liveMeta = {
  title: site.siteMeta.title,
  description: site.siteMeta.description,
  header_phone_number: site.siteMeta.headerPhone.number,
  header_phone_note: site.siteMeta.headerPhone.note,
}

describe('後台全站設定的分享圖與搜尋設定', () => {
  it('舊版已發布設定沒有新欄位時，沿用首頁大圖並允許收錄', () => {
    const next = applyContentOverlay(site, { site_meta: liveMeta })
    expect(next.siteMeta.allowIndexing).toBe(true)
    expect(pageSeo(next, 'https://ivy.example').imagePath).toMatch(/^\/assets\/og\//)
  })

  it('設了分享圖：首頁與入學資訊頁改用素材庫圖', () => {
    const next = applyContentOverlay(site, { site_meta: { ...liveMeta, share_image: MEDIA, share_image_alt: '孩子在園區' } })
    const home = pageSeo(next, 'https://ivy.example')
    expect(home.image).toBe(`https://ivy.example/api/website/v1/public/media/${MEDIA}/file`)
    expect(home.imageAlt).toBe('孩子在園區')
    expect(admissionSeo(next, 'https://ivy.example').imagePath).toBe(`/api/website/v1/public/media/${MEDIA}/file`)
  })

  it('入學資訊頁標題與描述來自 page_seo.admission，空字串沿用內建', () => {
    const custom = applyContentOverlay(site, { site_meta: { ...liveMeta, page_seo: { admission: { title: '入學資訊｜常春藤', description: '自訂描述', share_image: '', share_image_alt: '' } } } })
    expect(admissionSeo(custom, '').title).toBe('入學資訊｜常春藤')
    expect(admissionSeo(custom, '').description).toBe('自訂描述')
    const blank = applyContentOverlay(site, { site_meta: { ...liveMeta, page_seo: { admission: { title: '', description: '', share_image: '', share_image_alt: '' } } } })
    expect(admissionSeo(blank, '').title).toContain('入學資訊｜入學流程')
  })

  it('關閉收錄會帶到 siteMeta', () => {
    const next = applyContentOverlay(site, { site_meta: { ...liveMeta, allow_indexing: false } })
    expect(next.siteMeta.allowIndexing).toBe(false)
  })
})

import { CONTACT_TIME_OPTIONS, contactTimeLabel } from '../app/utils/visit-form'

describe('方便聯絡時段固定選項', () => {
  it('送代碼、顯示中文，代碼與後端一致', () => {
    expect(CONTACT_TIME_OPTIONS.map((o) => o.value)).toEqual(['flexible', 'weekday_morning', 'weekday_afternoon', 'other'])
    expect(contactTimeLabel('weekday_morning')).toBe('平日上午')
    expect(contactTimeLabel('舊資料原字')).toBe('舊資料原字')
  })
})

describe('後台全站設定的各頁搜尋與分享（page_seo）', () => {
  const entry = (over: Record<string, unknown> = {}) => ({ title: '', description: '', share_image: '', share_image_alt: '', ...over })
  const apply = (page_seo: unknown) => applyContentOverlay(site, { site_meta: { ...liveMeta, page_seo } as never })

  it('轉成 camelCase 存進 siteMeta.pageSeo，七頁都收', () => {
    const keys = ['admission', 'about', 'curriculum', 'environment', 'news', 'anniversary', 'privacy']
    const next = apply(Object.fromEntries(keys.map((key) => [key, entry({ title: `${key} 標題`, description: `${key} 描述`, share_image: MEDIA, share_image_alt: `${key} 圖說` })])))
    expect(Object.keys(next.siteMeta.pageSeo!).sort()).toEqual([...keys].sort())
    expect(next.siteMeta.pageSeo!.about).toEqual({ title: 'about 標題', description: 'about 描述', shareImage: MEDIA, shareImageAlt: 'about 圖說' })
  })

  it('空字串視為未設定：整頁都空就不留，部分空只留有值的欄位', () => {
    const next = apply({ about: entry(), news: entry({ title: '最新消息｜常春藤', description: '  ' }) })
    expect(next.siteMeta.pageSeo).toEqual({ news: { title: '最新消息｜常春藤' } })
  })

  it('不認得的頁面 key、非字串欄位、壞掉的整體形狀都丟掉，不影響其他設定', () => {
    const next = apply({ visit: entry({ title: '預約頁' }), constructor: entry({ title: 'x' }), about: { title: 123, description: ['a'], share_image: null, share_image_alt: '圖說' }, privacy: 'oops' })
    expect(next.siteMeta.pageSeo).toEqual({ about: { shareImageAlt: '圖說' } })
    for (const bad of ['text', 42, [entry({ title: 'a' })]]) {
      const broken = apply(bad)
      expect(broken.siteMeta.pageSeo).toBeUndefined()
      expect(broken.siteMeta.title).toBe(liveMeta.title)
    }
  })

  it('null、沒有這個鍵（舊的已發布版本）都沒有 pageSeo', () => {
    expect(apply(null).siteMeta.pageSeo).toBeUndefined()
    expect(applyContentOverlay(site, { site_meta: liveMeta }).siteMeta.pageSeo).toBeUndefined()
  })

  it('疊出來後各頁搜尋標題生效，沒設定的頁沿用內建', () => {
    const next = apply({ about: entry({ title: '關於我們｜常春藤', share_image: MEDIA }) })
    expect(aboutSeo(next, 'https://ivy.example').title).toBe('關於我們｜常春藤')
    expect(aboutSeo(next, 'https://ivy.example').imagePath).toBe(`/api/website/v1/public/media/${MEDIA}/file`)
    expect(curriculumSeo(next, '').title).toBe(curriculumSeo(site, '').title)
  })
})

describe('後台全站設定的機構社群（social_links）', () => {
  const apply = (social_links: unknown) => applyContentOverlay(site, { site_meta: { ...liveMeta, social_links } as never })
  const link = (over: Record<string, unknown> = {}) => ({ platform: 'instagram', label: 'IG', url: 'https://www.instagram.com/ivy', ...over })

  it('整組取代內建清單，四種平台都收、順序照後台', () => {
    const next = apply([
      link({ platform: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@ivy' }),
      link({ platform: 'line', label: 'LINE', url: 'https://line.me/R/ti/p/@ivy' }),
      link(), link({ platform: 'facebook', label: 'FB', url: ' https://www.facebook.com/ivy ' })
    ])
    expect(next.siteMeta.socialLinks).toEqual([
      { platform: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@ivy' },
      { platform: 'line', label: 'LINE', url: 'https://line.me/R/ti/p/@ivy' },
      { platform: 'instagram', label: 'IG', url: 'https://www.instagram.com/ivy' },
      { platform: 'facebook', label: 'FB', url: 'https://www.facebook.com/ivy' }
    ])
  })

  it('不合格的丟掉：javascript:、http、平台不在四種內、文字空白、非物件', () => {
    const next = apply([
      link({ url: 'javascript:alert(1)' }), link({ url: 'http://www.instagram.com/ivy' }), link({ url: '//www.instagram.com/ivy' }),
      link({ platform: 'twitter' }), link({ label: '  ' }), link({ label: undefined }), link({ url: 42 }), null, 'https://example.com',
      link({ platform: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@ivy' })
    ])
    expect(next.siteMeta.socialLinks).toEqual([{ platform: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@ivy' }])
  })

  it('全部被過濾掉或後台存空清單：不顯示機構社群（不退回內建）', () => {
    expect(apply([]).siteMeta.socialLinks).toEqual([])
    expect(apply([link({ url: 'javascript:alert(1)' })]).siteMeta.socialLinks).toEqual([])
  })

  it('null、沒有這個鍵（舊的已發布版本）、壞掉的形狀：沿用內建清單', () => {
    for (const next of [apply(null), applyContentOverlay(site, { site_meta: liveMeta }), apply('https://example.com'), apply({ 0: link() })]) {
      expect(next.siteMeta.socialLinks).toEqual(site.siteMeta.socialLinks)
    }
    expect(site.siteMeta.socialLinks?.length).toBeGreaterThan(0)
  })
})
