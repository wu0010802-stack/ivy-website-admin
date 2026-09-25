import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { MEAL_BOOK_URL, mealBookLink } from '../app/utils/meal-book'
import { environmentSeo, llmsTxt, sitemapXml } from '../app/utils/seo'
import { ENVIRONMENT_HERO_IMAGE, responsiveImage } from '../app/utils/responsive-image'
import manifest from '../app/generated/image-manifest.json'

const site = fixture as unknown as SiteContent

describe('營養餐點書：依台北日期開到當月菜單那一頁', () => {
  it('1–6 月在第 10–15 頁，7–12 月在第 17–22 頁（第 16 頁是文章）', () => {
    const page = (month: number) => mealBookLink({ year: 2026, month, day: 15 }).page
    expect([1, 2, 3, 4, 5, 6].map(page)).toEqual([10, 11, 12, 13, 14, 15])
    expect([7, 8, 9, 10, 11, 12].map(page)).toEqual([17, 18, 19, 20, 21, 22])
  })
  it('連結帶頁碼、文字帶月份', () => {
    const link = mealBookLink({ year: 2026, month: 9, day: 25 })
    expect(link).toEqual({ month: 9, page: 19, href: `${MEAL_BOOK_URL}#p=19`, label: '看 9 月菜單' })
  })
  it('月份用台北時間：UTC 9/30 17:00 已是台北 10/1', () => {
    expect(mealBookLink(new Date('2026-09-30T17:00:00Z')).month).toBe(10)
    expect(mealBookLink(new Date('2026-09-30T15:59:00Z')).month).toBe(9)
  })
})

describe('頁首只留真正的分頁（2026-09-25 使用者裁定）', () => {
  it('選單只有常春藤環境與入學資訊，首頁錨點拿掉', () => {
    expect(site.siteMeta.primaryNav).toEqual([
      { label: '常春藤環境', labelEn: 'Environment', href: '/environment' },
      { label: '入學資訊', labelEn: 'Admission', href: '/admission' }
    ])
    expect(site.siteMeta.primaryNav.some((item) => item.href.startsWith('/#'))).toBe(false)
  })
  it('頁尾也有常春藤環境入口', () => {
    expect(site.footer.links.some((item) => item.href === '/environment')).toBe(true)
  })
})

describe('常春藤環境頁 SEO', () => {
  it('canonical、麵包屑與 sitemap／llms.txt 都指向 /environment', () => {
    const seo = environmentSeo(site, 'https://ivy.example')
    expect(seo.canonical).toBe('https://ivy.example/environment')
    expect(seo.title).toContain('常春藤環境')
    expect(JSON.stringify(seo.graph)).toContain('"name":"常春藤環境"')
    expect(sitemapXml('https://ivy.example', [])).toContain('<loc>https://ivy.example/environment</loc>')
    expect(llmsTxt('https://ivy.example', { siteMeta: site.siteMeta, campuses: [] })).toContain('(https://ivy.example/environment)')
  })
  it('沒有正式 origin 時不輸出 canonical 與結構化資料', () => {
    const seo = environmentSeo(site, '')
    expect(seo.canonical).toBeUndefined()
    expect(seo.graph).toEqual([])
  })
})

describe('常春藤環境頁圖片', () => {
  const names = [ENVIRONMENT_HERO_IMAGE, 'env-care-teacher', 'env-care-health', 'env-care-meal', 'env-care-clothes', 'env-care-comfort', 'env-care-clean',
    'env-space-playground', 'env-space-classroom', 'env-space-materials', 'env-space-plaza', 'env-space-corner', 'env-space-restroom', 'env-space-animals', 'env-meal-book']
  it.each(names)('%s 已產生響應式候選檔', (name) => {
    expect(Object.hasOwn(manifest, name)).toBe(true)
    expect(responsiveImage(name).srcset).toBeTruthy()
  })
})
