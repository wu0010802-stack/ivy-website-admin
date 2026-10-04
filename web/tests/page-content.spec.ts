import { describe, expect, it, vi } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { applyContentOverlay, type LiveCurriculumPage } from '../app/utils/content-overlay'
import { curriculumHeroAttrs, type MediaInfoMap } from '../app/utils/media-image'
import { CURRICULUM_HERO_IMAGE, CURRICULUM_HERO_SIZES, responsiveImage } from '../app/utils/responsive-image'
import { pageMarkedLines, pagePhotoAlt, pagePhotoStyle, pageTitleLines, rocYear, withPhotoStyle } from '../app/utils/page-content'

const site = fixture as unknown as SiteContent
const MEDIA = '3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c'
const media: MediaInfoMap = {
  [MEDIA]: { id: MEDIA, kind: 'image', content_type: 'image/webp', width: 1600, height: 1200, alt_text: '素材庫說明', focus_x: 30, focus_y: 40, variants: [] }
}
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
/** fixture 的 camelCase → 後台 payload（頂層轉 snake_case，巢狀欄位兩邊同名） */
function livePayload<T>(source: object): T {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [snake(key), structuredClone(value)])) as T
}

describe('整頁內容的小工具', () => {
  it('標題用 \\n 換行', () => {
    expect(pageTitleLines('從動手做開始，\n愛上學習。')).toEqual(['從動手做開始，', '愛上學習。'])
  })
  it('空行不輸出（官網不出現空的 <br>）', () => {
    expect(pageTitleLines('a\n')).toEqual(['a'])
    expect(pageTitleLines('a\n\nb')).toEqual(['a', 'b'])
    expect(pageMarkedLines('a\n \nb', 'b')).toEqual([{ before: 'a', mark: '', after: '' }, { before: '', mark: 'b', after: '' }])
  })
  it('顏料標示只畫第一次出現的地方；找不到或留空就整行不畫', () => {
    expect(pageMarkedLines('從動手做開始，\n愛上學習。', '動手做')).toEqual([
      { before: '從', mark: '動手做', after: '開始，' },
      { before: '愛上學習。', mark: '', after: '' }
    ])
    expect(pageMarkedLines('一\n二', '三')).toEqual([{ before: '一', mark: '', after: '' }, { before: '二', mark: '', after: '' }])
    expect(pageMarkedLines('一', '')).toEqual([{ before: '一', mark: '', after: '' }])
  })
  it('照片說明與位置：沒換照片用內建的，換了用後台的', () => {
    const photo = { src: '/x', candidates: [], position: '30% 40%', alt: '素材庫說明' }
    expect(pagePhotoAlt('內建說明', undefined, undefined)).toBe('內建說明')
    expect(pagePhotoAlt('內建說明', photo, '')).toBe('素材庫說明')
    expect(pagePhotoAlt('內建說明', photo, '後台說明')).toBe('後台說明')
    expect(pagePhotoStyle('40% 50%', undefined)).toEqual({ objectPosition: '40% 50%' })
    expect(pagePhotoStyle(undefined, undefined)).toBeUndefined()
    expect(pagePhotoStyle('40% 50%', photo)).toEqual({ objectPosition: '30% 40%' })
    expect(pagePhotoStyle('40% 50%', { ...photo, position: null })).toBeUndefined()
  })
  it('原本沒有 style 的圖片：只有後台照片有焦點時才帶 style（SSR 不多出 style=""）', () => {
    const attrs = { src: '/a.webp', width: 10, height: 10, srcset: undefined, sizes: undefined }
    expect(withPhotoStyle(attrs, undefined)).toEqual(attrs)
    expect('style' in withPhotoStyle(attrs, undefined)).toBe(false)
    expect('style' in withPhotoStyle(attrs, { src: '/x', candidates: [], position: null, alt: '' })).toBe(false)
    expect(withPhotoStyle(attrs, { src: '/x', candidates: [], position: '30% 40%', alt: '' }).style).toEqual({ objectPosition: '30% 40%' })
  })
  it('民國年 = 西元 − 1911', () => {
    expect([1997, 2001, 2005, 2020, 2021].map(rocYear)).toEqual([86, 90, 94, 109, 110])
  })
})

describe('特色教學頁的後台內容', () => {
  it('發布的內容和內建一字不差時，官網內容完全不變', () => {
    const next = applyContentOverlay(site, { curriculum_page: livePayload<LiveCurriculumPage>(site.curriculumPage) })
    expect(next.curriculumPage).toEqual(site.curriculumPage)
  })
  it('換了照片：首屏與清單項目都用素材，說明留空時用素材庫的說明', () => {
    const live = livePayload<LiveCurriculumPage>(site.curriculumPage)
    live.hero_photo = { media_id: MEDIA }
    live.gallery[2] = { ...live.gallery[2]!, photo: { media_id: MEDIA }, photo_alt: '' }
    live.daily[0] = { ...live.daily[0]!, photo: { media_id: MEDIA }, photo_alt: '孩子閉眼靜心' }
    const next = applyContentOverlay(site, { curriculum_page: live }, media).curriculumPage
    expect(next.heroPhoto?.src).toBe(`/api/website/v1/public/media/${MEDIA}/file`)
    expect(next.heroPhoto?.position).toBe('30% 40%')
    expect(next.heroPhotoAlt).toBe('素材庫說明')
    expect(next.gallery[2]!.photoAlt).toBe('素材庫說明')
    expect(next.daily[0]!.photoAlt).toBe('孩子閉眼靜心')
    expect(next.gallery[0]!.photo).toBeUndefined()
  })
  it('項目數不符的舊版內容整份退回內建內容（不讓頁面壞掉）', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const live = livePayload<LiveCurriculumPage>(site.curriculumPage)
    live.gallery = live.gallery.slice(0, 3)
    live.hero_eyebrow = '不該出現'
    expect(applyContentOverlay(site, { curriculum_page: live }).curriculumPage).toEqual(site.curriculumPage)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
  it('首屏照片：沒換照片時和現在的 preload 完全相同', () => {
    expect(curriculumHeroAttrs(site.curriculumPage)).toEqual(responsiveImage(CURRICULUM_HERO_IMAGE, CURRICULUM_HERO_SIZES))
    const live = livePayload<LiveCurriculumPage>(site.curriculumPage)
    live.hero_photo = { media_id: MEDIA }
    expect(curriculumHeroAttrs(applyContentOverlay(site, { curriculum_page: live }, media).curriculumPage).src).toBe(`/api/website/v1/public/media/${MEDIA}/file`)
  })
  it('格式壞掉的已發布內容（缺欄位、型別錯、清單裡有 null）整份退回內建內容且不丟錯', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mutations: ((live: any) => void)[] = [
      (live) => { delete live.hero_title },
      (live) => { live.hero_title = 123 },
      (live) => { live.beliefs = 'abcde' },
      (live) => { live.gallery = null },
      (live) => { live.gallery[1] = null },
      (live) => { delete live.gallery[0].label },
      (live) => { delete live.directions[2].key }
    ]
    for (const mutate of mutations) {
      const live = livePayload<LiveCurriculumPage>(site.curriculumPage)
      mutate(live)
      expect(() => applyContentOverlay(site, { curriculum_page: live })).not.toThrow()
      expect(applyContentOverlay(site, { curriculum_page: live }).curriculumPage).toEqual(site.curriculumPage)
    }
    expect(error).toHaveBeenCalledTimes(mutations.length * 2)
    error.mockRestore()
  })
})
