import { expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import initialOverlay from './fixtures/overlay-initial-content.json'
import type { SiteContent } from '../app/types/site-content'
import type { ContentOverlay } from '../app/utils/content-overlay'
import { publicCopy, withoutRetiredFields } from '../app/utils/public-copy'
import { publishedContent } from '../app/utils/published-content'

// 找出整棵資料樹裡所有名為 _todo 的鍵（含陣列內的物件），回傳路徑。
function todoPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => todoPaths(item, `${path}[${i}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => (key === '_todo' ? [`${path}._todo`] : []).concat(todoPaths(child, `${path}.${key}`)))
  }
  return []
}

it('修正已知原型說明，保留示意新聞與 CMS 自訂內容，不杜撰招生條件', () => {
  const site = fixture as unknown as SiteContent
  const result = publicCopy(site)
  expect(result.siteMeta.description).not.toContain('提案')
  expect(result.news.sampleNote).toBe(site.news.sampleNote)
  expect(result.footer.bottomNote).toBe('')
  expect(publicCopy({ ...site, footer: { ...site.footer, bottomNote: 'CMS 自訂備註' } }).footer.bottomNote).toBe('CMS 自訂備註')
  expect(publicCopy({ ...site, siteMeta: { ...site.siteMeta, description: 'CMS 正式自訂內容' } }).siteMeta.description).toBe('CMS 正式自訂內容')
  expect(site.siteMeta.description).toContain('提案')
})

it('官網已不顯示的舊欄位不進頁面資料（原型的示範同意文字、常見問題、熱點等），fixture 本身不動', () => {
  const site = fixture as unknown as SiteContent
  const raw = fixture as unknown as {
    home: { hero: Record<string, unknown>; campusBoard: Record<string, unknown> }
    dayExperience: Record<string, unknown>
    booking: Record<string, unknown>
    campuses: (Record<string, unknown> & { tourScenes: unknown })[]
  }
  // fixture 留著這些值：後端初始化內容要讀。
  expect(raw.booking).toHaveProperty('consentText')
  expect(raw.campuses[0]).toHaveProperty('faq')
  const result = publicCopy(site)
  const json = JSON.stringify(result)
  expect(json).not.toContain('這份 prototype 僅示範流程')
  // 原型預約表單的示範說明、步驟與欄位清單（2026-10-05）。
  expect(json).not.toContain('這是官網互動提案')
  expect(json).not.toContain('示範完成，尚未送出預約')
  expect(json).not.toContain('demo-consent')
  expect(json).not.toContain('我了解這是操作示範')
  expect(result.home.hero).not.toHaveProperty('eyebrow')
  expect(result.home.campusBoard).not.toHaveProperty('note')
  expect(result.dayExperience).not.toHaveProperty('sourceNote')
  for (const key of ['consentText', 'bannerTitleTemplate', 'bannerBody', 'bannerButtonLabel', 'isDemo', 'demoNote', 'steps', 'fields']) expect(result.booking).not.toHaveProperty(key)
  expect(Object.keys(result.booking).sort()).toEqual(['ctaLabel', 'ctaLabelEn'])
  for (const campus of result.campuses) {
    for (const key of ['intro', 'description', 'fbNote', 'heroPhotoPos', 'faq']) expect(campus).not.toHaveProperty(key)
    if (Array.isArray(campus.tourScenes)) for (const scene of campus.tourScenes) expect(scene).not.toHaveProperty('spots')
  }
  // 頁面用得到的欄位照舊。
  expect(result.campuses.map((c) => c.key)).toEqual(site.campuses.map((c) => c.key))
  expect(result.campuses[0]!.address).toBe(site.campuses[0]!.address)
  expect(result.booking.ctaLabel).toBe(site.booking.ctaLabel)
  expect(withoutRetiredFields(site)).toEqual(withoutRetiredFields(withoutRetiredFields(site)))
  expect(raw.booking).toHaveProperty('consentText')
})

it('fixture 的 _todo 維護備註不進公開資料：任何層級都沒有，內部路徑與待辦字句也不外洩', () => {
  const site = fixture as unknown as SiteContent
  // fixture 留著 _todo：後端初始化內容與維護者要看。
  expect(todoPaths(site).length).toBeGreaterThan(0)
  // 正式站的路徑：後台內容疊在 fixture 上，再經 publicCopy。
  const live = publishedContent(site, { schema_version: '1', release_id: 'r1', content: initialOverlay as unknown as ContentOverlay }).content
  for (const result of [publicCopy(site), withoutRetiredFields(site), live]) {
    expect(todoPaths(result)).toEqual([])
    const json = JSON.stringify(result)
    expect(json).not.toContain('design/hero-video-restoration')
    expect(json).not.toContain('非明華校自有粉專')
  }
  // 頁面用得到的欄位照舊（headerPhone 與 hero 只少了 _todo）。
  expect(live.siteMeta.headerPhone.number).toBe(site.siteMeta.headerPhone.number)
  expect(live.home.hero.heroImage).toBeTruthy()
  expect(withoutRetiredFields(site)).toEqual(withoutRetiredFields(withoutRetiredFields(site)))
})
