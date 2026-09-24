import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { admissionSeo, pageSeo } from '../app/utils/seo'
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

  it('設了分享圖：首頁與入學資訊頁改用素材庫圖，分校頁仍用各校照片', () => {
    const next = applyContentOverlay(site, { site_meta: { ...liveMeta, share_image: MEDIA, share_image_alt: '孩子在園區' } })
    const home = pageSeo(next, 'https://ivy.example')
    expect(home.image).toBe(`https://ivy.example/api/website/v1/public/media/${MEDIA}/file`)
    expect(home.imageAlt).toBe('孩子在園區')
    expect(admissionSeo(next, 'https://ivy.example').imagePath).toBe(`/api/website/v1/public/media/${MEDIA}/file`)
    expect(pageSeo(next, 'https://ivy.example', next.campuses[0]!).imagePath).toMatch(/^\/assets\/og\//)
  })

  it('入學資訊頁標題與描述可由後台覆寫，空字串沿用內建', () => {
    const custom = applyContentOverlay(site, { site_meta: { ...liveMeta, admission_title: '入學資訊｜常春藤', admission_description: '自訂描述' } })
    expect(admissionSeo(custom, '').title).toBe('入學資訊｜常春藤')
    expect(admissionSeo(custom, '').description).toBe('自訂描述')
    const blank = applyContentOverlay(site, { site_meta: { ...liveMeta, admission_title: '' } })
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
