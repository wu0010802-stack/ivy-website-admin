import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { curriculumSeo, llmsTxt, sitemapXml } from '../app/utils/seo'
import { CURRICULUM_HERO_IMAGE, responsiveImage } from '../app/utils/responsive-image'
import { CLASS_BY_OFFSET } from '../app/utils/admission-classes'
import manifest from '../app/generated/image-manifest.json'

const site = fixture as unknown as SiteContent
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const component = read('../app/components/CurriculumContent.vue')
const css = read('../app/assets/css/curriculum.css')
const template = component.slice(component.indexOf('<template>'))

describe('特色教學頁入口', () => {
  it('頁首選單與頁尾都有特色教學', () => {
    expect(site.siteMeta.primaryNav.map((item) => item.href)).toContain('/curriculum')
    expect(site.footer.links.some((item) => item.href === '/curriculum')).toBe(true)
  })
})

describe('特色教學頁 SEO', () => {
  it('canonical、麵包屑與 sitemap／llms.txt 都指向 /curriculum', () => {
    const seo = curriculumSeo(site, 'https://ivy.example')
    expect(seo.canonical).toBe('https://ivy.example/curriculum')
    expect(seo.title).toContain('特色教學')
    expect(JSON.stringify(seo.graph)).toContain('"name":"特色教學"')
    expect(sitemapXml('https://ivy.example')).toContain('<loc>https://ivy.example/curriculum</loc>')
    expect(llmsTxt('https://ivy.example', { siteMeta: site.siteMeta })).toContain('(https://ivy.example/curriculum)')
  })
  it('描述與 llms.txt 跟上 2026-09-28 新增的兒童美術館與教學理念', () => {
    expect(curriculumSeo(site, 'https://ivy.example').description).toContain('兒童美術館')
    const llms = llmsTxt('https://ivy.example', { siteMeta: site.siteMeta })
    expect(llms).toContain('兒童美術館')
    expect(llms).toContain('教學理念')
  })
  it('沒有正式 origin 時不輸出 canonical 與結構化資料', () => {
    const seo = curriculumSeo(site, '')
    expect(seo.canonical).toBeUndefined()
    expect(seo.graph).toEqual([])
  })
})

describe('四個年段與入學資訊頁的分班一致', () => {
  it('幼幼班到大班依序是 9/1 前滿 2–5 歲（入學資訊頁 offset 3–6）', () => {
    const years = [...component.matchAll(/\{ age: (\d), name: '([^']+)'/g)].map((m) => [Number(m[1]), m[2]])
    expect(years).toEqual([3, 4, 5, 6].map((offset) => [offset - 1, CLASS_BY_OFFSET[offset]]))
  })
})

describe('特色教學頁的段落（2026-09-28 水彩版）', () => {
  it('章節依序是四個年段、課程方向、兒童美術館、五件事，最後是教學理念', () => {
    const ids = [...template.matchAll(/<section id="([a-z-]+)"/g)].map((m) => m[1])
    expect(ids).toEqual(['years', 'directions', 'gallery', 'daily', 'belief'])
    const chapters = [...component.matchAll(/\{ id: '([a-z-]+)', no: '(\d\d)'/g)].map((m) => [m[1], m[2]])
    expect(chapters).toEqual([['years', '01'], ['directions', '02'], ['gallery', '03'], ['daily', '04']])
  })
  it('使用者要求拿掉預約參觀：頁面主體沒有預約連結與按鈕（頁首的預約鈕是全站共用，不在這裡）', () => {
    expect(template).not.toContain('/visit')
    expect(template).not.toContain('預約')
    expect(JSON.stringify(site.curriculumPage)).not.toContain('預約')
    expect(JSON.stringify(site.curriculumPage)).not.toContain('/visit')
  })
  it('搬來的內容都標出處，義華校的內容不冒充全體', () => {
    expect(site.curriculumPage.dailySource).toBe('照片與介紹取自義華校。')
    expect(site.curriculumPage.beliefSource).toBe('取自義華校教學理念。')
    expect(site.curriculumPage.gallerySource).toContain('常春藤兒童美術館')
  })
  it('過期或只屬於義華的說法不搬：二十七年口碑、歐式城堡建築、高雄獨家、大推', () => {
    const copy = JSON.stringify(site.curriculumPage)
    for (const phrase of ['二十七年', '歐式城堡', '獨家', '大推']) {
      expect(template).not.toContain(phrase)
      expect(copy).not.toContain(phrase)
    }
  })
})

describe('水彩樣式只用色票', () => {
  it('curriculum.css 不寫色碼、rgb／oklch 字面值（顏料色在 tokens.css 的 --ivy-paint-*）', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(body).not.toMatch(/\b(rgba?|oklch|hsla?)\(\s*[\d.]/i)
  })
  it('強制色彩時顏料層、紙紋與照片遮罩都拿掉', () => {
    const forced = css.slice(css.indexOf('@media (forced-colors: active)'))
    expect(forced).toMatch(/\.cur-wash[^{]*\{[^}]*display: none/)
    expect(forced).toContain('.cur-grain')
    expect(forced).toMatch(/mask: none/)
  })
})

describe('特色教學頁圖片', () => {
  const gallery = ['cur-gallery-canvas-yellow', 'cur-gallery-clay-ball', 'cur-gallery-tote', 'cur-gallery-plane-pink',
    'cur-gallery-tee', 'cur-gallery-canvas-blue', 'cur-gallery-tape', 'cur-gallery-plane-dots']
  const names = [CURRICULUM_HERO_IMAGE, 'cur-years', 'cur-cognitive', 'cur-integrated', 'cur-multicultural', 'cur-autonomy', 'cur-activities', 'cur-art',
    'cur-daily-calm', 'cur-daily-materials', 'cur-daily-art', 'cur-daily-reading', 'cur-daily-motor', ...gallery]
  it.each(names)('%s 已產生響應式候選檔', (name) => {
    expect(Object.hasOwn(manifest, name)).toBe(true)
    expect(responsiveImage(name).srcset).toBeTruthy()
  })
  it('元件用到的圖都在清單裡', () => {
    const used = new Set([...component.matchAll(/'(cur-[a-z-]+)'/g)].map((m) => m[1]))
    expect([...used].sort()).toEqual(names.filter((n) => n !== CURRICULUM_HERO_IMAGE).sort())
  })
  it('美術館作品每張都有描述作品本身的替代文字', () => {
    const alts = [...component.matchAll(/\{ image: 'cur-gallery-[a-z-]+', alt: '([^']+)'/g)].map((m) => m[1])
    expect(alts).toHaveLength(gallery.length)
    for (const alt of alts) expect(alt!.length).toBeGreaterThan(6)
  })
})

describe('特色教學頁的文字來自後台內容（2026-10）', () => {
  it('元件不再寫死段落文字，章節與項目數和內容一致', () => {
    for (const phrase of ['每一種學習', '五件事，', '老師好愛我', '六歲定八十', '重視愛與關懷']) expect(template).not.toContain(phrase)
    expect(site.curriculumPage.chapters).toHaveLength(4)
    expect(site.curriculumPage.directions.map((d) => d.key)).toEqual(['cognitive', 'integrated', 'multicultural', 'quote', 'autonomy', 'activities', 'art'])
    expect(site.curriculumPage.gallery).toHaveLength(8)
    expect(site.curriculumPage.daily).toHaveLength(5)
    expect(site.curriculumPage.beliefs).toHaveLength(5)
  })
})
