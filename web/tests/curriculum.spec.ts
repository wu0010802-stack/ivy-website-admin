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
const component = readFileSync(fileURLToPath(new URL('../app/components/CurriculumContent.vue', import.meta.url)), 'utf8')

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
    expect(sitemapXml('https://ivy.example', [])).toContain('<loc>https://ivy.example/curriculum</loc>')
    expect(llmsTxt('https://ivy.example', { siteMeta: site.siteMeta, campuses: [] })).toContain('(https://ivy.example/curriculum)')
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

describe('特色教學頁圖片', () => {
  const names = [CURRICULUM_HERO_IMAGE, 'cur-years', 'cur-cognitive', 'cur-integrated', 'cur-multicultural', 'cur-autonomy', 'cur-activities', 'cur-art',
    'cur-daily-calm', 'cur-daily-materials', 'cur-daily-art', 'cur-daily-reading', 'cur-daily-motor', 'cur-visit']
  it.each(names)('%s 已產生響應式候選檔', (name) => {
    expect(Object.hasOwn(manifest, name)).toBe(true)
    expect(responsiveImage(name).srcset).toBeTruthy()
  })
  it('元件用到的圖都在清單裡', () => {
    const used = new Set([...component.matchAll(/'(cur-[a-z-]+)'/g)].map((m) => m[1]))
    expect([...used].sort()).toEqual(names.filter((n) => n !== CURRICULUM_HERO_IMAGE).sort())
  })
})
