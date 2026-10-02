import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { aboutSeo, llmsTxt, sitemapXml } from '../app/utils/seo'
import { ABOUT_HERO_IMAGE, responsiveImage } from '../app/utils/responsive-image'
import manifest from '../app/generated/image-manifest.json'
import { pullIndex, turnState } from '../app/utils/about-popup'

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

// 2026-10-02 精修（design/about-refine-mockup-20261002/，使用者「先這樣實作」）
describe('立體書精修：章節與目次', () => {
  const css = read('../app/assets/css/about.css')
  it('章名用中文「第○章」，不再用寬字距英文眉標（09-30 被評 AI 感）', () => {
    expect(component).toContain("label: `第${NUMERALS[i]}章`")
    expect(template).not.toMatch(/Our story|Whole child|Our hope/)
  })
  it('首屏有目次，點了跳到各章；結尾錨點是 #campuses', () => {
    expect(template).toContain('<nav class="abk-toc"')
    expect(template).toContain(':href="`#${item.id}`"')
    expect(template).toContain('id="campuses"')
  })
  it('首屏照片裡的長輩是創辦人（使用者確認，不寫姓名）', () => {
    expect(template).toContain('alt="孩子們笑著圍在創辦人身邊，大家擠在一起"')
  })
  it('引言不用左側色條（側條），改用括號', () => {
    expect(css).not.toMatch(/\.abk-quote\{[^}]*border-left/)
    expect(css).toMatch(/\.abk-quote::before\{content:'「'/)
  })
  it('頁緣厚度跟著跨頁位置：右邊是 --last − --n', () => {
    expect(css).toContain('--th:calc(4px + (var(--last,4) - var(--n)) * 3px)')
    expect(template).toContain(":style=\"{ '--last': chapters.length }\"")
  })
})

describe('立體書精修：翻頁的封面與明暗', () => {
  it('翻開程度用 smoothstep；頭尾不背光，還壓在左頁上方（未過 90°）才有左頁影子', () => {
    expect(turnState(0)).toEqual({ open: 0, shade: 0, cast: 0 })
    expect(turnState(1).open).toBe(1)
    expect(turnState(1).shade).toBeCloseTo(0, 5)
    expect(turnState(0.5).open).toBe(0.5)
    expect(turnState(0.5).shade).toBeCloseTo(0.55, 5)
    expect(turnState(0.25).cast).toBeGreaterThan(0)
    expect(turnState(0.75).cast).toBe(0)
    expect(turnState(-1).open).toBe(0)
    expect(turnState(2).open).toBe(1)
  })
  it('右頁背面是章節封面，只給螢幕閱讀器看正面', () => {
    expect(template.match(/<div class="abk-cover" aria-hidden="true">/g)?.length).toBe(4)
  })
  it('紙條連按方向鍵以「正要去的那一站」為準', () => {
    const popup = read('../app/utils/about-popup.ts')
    expect(popup).toContain('toStop(goal + step)')
  })
})

describe('立體書精修：家長怎麼說', () => {
  it('讀各校後台的 testimonials，最多四位；沒有資料時整章不出現', () => {
    expect(component).toContain('campus.testimonials ?? []')
    expect(component).toContain('.slice(0, 4)')
    expect(template).toContain('<section v-if="voices.length" id="voices"')
  })
  it('按播放才插 youtube-nocookie；沒有 JS 時是連到 YouTube 的連結', () => {
    expect(template).toMatch(/<iframe\s+v-if="playing" :src="youtubeEmbed\(/)
    expect(template).toContain('@click.prevent="playing = true"')
    expect(template).toContain(':href="`https://www.youtube.com/watch?v=${voices[shownVoice]!.youtubeId}`"')
  })
  it('目前內建資料只有義華校家長，頁面標出校名', () => {
    const withVoices = site.campuses.filter((c) => c.testimonials?.length)
    expect(withVoices.map((c) => c.key)).toEqual(['yihua'])
    expect(template).toContain('{{ voices[shownVoice]!.campus.name }}家長')
  })
})
