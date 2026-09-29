import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { aboutSeo, llmsTxt, sitemapXml } from '../app/utils/seo'
import { ABOUT_HERO_IMAGE, responsiveImage } from '../app/utils/responsive-image'
import manifest from '../app/generated/image-manifest.json'
import { pullIndex, snapDegrees, wheelSector } from '../app/utils/about-popup'

const site = fixture as unknown as SiteContent
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const component = read('../app/components/AboutContent.vue')
const template = component.slice(component.indexOf('<template>'))

describe('關於常春藤頁入口', () => {
  it('頁首選單第一項是關於常春藤，頁尾的「關於常春藤」改指向 /about', () => {
    expect(site.siteMeta.primaryNav[0]).toEqual({ label: '關於常春藤', labelEn: 'About', href: '/about' })
    expect(site.footer.links.find((item) => item.label === '關於常春藤')?.href).toBe('/about')
  })
})

describe('關於常春藤頁 SEO', () => {
  it('canonical、麵包屑與 sitemap／llms.txt 都指向 /about', () => {
    const seo = aboutSeo(site, 'https://ivy.example')
    expect(seo.canonical).toBe('https://ivy.example/about')
    expect(seo.title).toContain('關於常春藤')
    expect(JSON.stringify(seo.graph)).toContain('"name":"關於常春藤"')
    expect(sitemapXml('https://ivy.example', [])).toContain('<loc>https://ivy.example/about</loc>')
    expect(llmsTxt('https://ivy.example', { siteMeta: site.siteMeta, campuses: [] })).toContain('(https://ivy.example/about)')
  })
  it('沒有正式 origin 時不輸出 canonical 與結構化資料', () => {
    const seo = aboutSeo(site, '')
    expect(seo.canonical).toBeUndefined()
    expect(seo.graph).toEqual([])
  })
})

describe('五校沿革', () => {
  const milestones = [...component.matchAll(/\{ key: '([a-z]+)', year: (\d+), roc: (\d+)/g)].map((m) => ({ key: m[1], year: Number(m[2]), roc: Number(m[3]) }))
  it('依創校先後排列，民國年與西元年一致（民國 = 西元 − 1911）', () => {
    expect(milestones.map((m) => m.key)).toEqual(['yihua', 'minghua', 'chongde', 'international', 'renwu'])
    expect(milestones.map((m) => m.roc)).toEqual([86, 90, 94, 109, 110])
    for (const m of milestones) expect(m.year - 1911).toBe(m.roc)
  })
  it('每個沿革節點都對得到內建的分校', () => {
    const keys = site.campuses.map((c) => c.key)
    for (const m of milestones) expect(keys).toContain(m.key)
  })
  it('畫面上不寫「三十多年」、週年，也不提美語補習班（未定案）', () => {
    expect(template).not.toMatch(/三十多|週年|美語部|補習班/)
  })
})

describe('關於常春藤頁圖片', () => {
  it.each([ABOUT_HERO_IMAGE, 'about-together', 'about-curious'])('%s 已產生響應式候選檔', (name) => {
    expect(Object.hasOwn(manifest, name)).toBe(true)
    expect(responsiveImage(name).srcset).toBeTruthy()
  })
})

// 2026-09-29 立體書版（使用者選定 J：design/about-style-directions-20260929/j-popup.*）
describe('立體書：拉紙條', () => {
  it('五站等距：紙條位置四捨五入到最近一站，超出範圍夾在頭尾', () => {
    expect([0, 0.12, 0.13, 0.5, 0.74, 1].map((t) => pullIndex(t, 5))).toEqual([0, 0, 1, 2, 3, 4])
    expect(pullIndex(-1, 5)).toBe(0)
    expect(pullIndex(2, 5)).toBe(4)
    expect(pullIndex(0.7, 1)).toBe(0)
  })
  it('使用者要求不特別強調相隔十五年：軌道上的年份等距排，畫面上不寫「相隔十五年」', () => {
    expect(template).toContain(":style=\"{ '--t': i / (milestones.length - 1) }\"")
    expect(template).not.toMatch(/相隔|十五年/)
  })
  it('紙條是鍵盤可操作的 slider，值是第幾站', () => {
    expect(template).toMatch(/<button class="abk-tab" type="button" role="slider" aria-label="[^"]+" aria-valuemin="1" :aria-valuemax="milestones.length" aria-valuenow="1">/)
    const popup = read('../app/utils/about-popup.ts')
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) expect(popup).toContain(key)
    expect(popup).toContain("tab.setAttribute('aria-valuetext'")
  })
})

describe('立體書：紙轉盤', () => {
  it('窗口在正上方：轉盤往負方向轉 60°，下一格轉進窗口；轉滿一圈回到第一格', () => {
    expect([0, -60, -120, -300, -360, 60, 29, 31].map((deg) => wheelSector(deg, 6))).toEqual([0, 1, 2, 5, 0, 5, 0, 5])
  })
  it('放手時彈到最近一格', () => {
    expect([0, 29, 31, -89, -91, 400].map((deg) => snapDegrees(deg, 6))).toEqual([0, 0, 60, -60, -120, 420])
  })
  it('轉盤是裝飾，窗口裡的領域用 aria-live 念出來；「轉一格」是按鈕', () => {
    expect(template).toMatch(/<div class="abk-wheel" data-wheel aria-hidden="true">/)
    expect(template).toContain('data-wheel-out aria-live="polite"')
    expect(template).toMatch(/<button class="abk-turn" type="button" data-turn>/)
  })
})

describe('立體書：沒有 JS 也看得到內容', () => {
  const css = read('../app/assets/css/about.css')
  it('預設書攤開、卡紙站好（--open、--up 沒設定時是 1）', () => {
    expect(css).toMatch(/\.abk-page\.is-right\{[^}]*transform:rotateY\(calc\(\(1 - var\(--open,1\)\) \* -178deg\)\)/)
    expect(css).toMatch(/\.abk-card\{[^}]*transform:rotateX\(calc\(\(1 - var\(--up,1\)\) \* 86deg\)\)/)
  })
  it('900px 以下不翻頁', () => {
    const mobile = css.slice(css.indexOf('@media (max-width:900px)'))
    expect(mobile).toMatch(/\.abk-page\.is-right\{[^}]*transform:none/)
  })
  it('Motion 只在這頁動態載入，減少動態與強制色彩都有處理', () => {
    expect(component).toContain("import('motion')")
    expect(component).not.toMatch(/^import .*from 'motion'/m)
    expect(component).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    expect(component).toContain("matchMedia('(forced-colors: active)')")
  })
  it('頁面內容不放預約參觀（頁首全站共用的預約鈕除外）', () => {
    expect(template).not.toContain('to="/visit"')
    expect(template).toContain('data-cta-entry="about"')
  })
})
