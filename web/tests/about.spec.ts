import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { aboutSeo, llmsTxt, sitemapXml } from '../app/utils/seo'
import { ABOUT_HERO_IMAGE, responsiveImage } from '../app/utils/responsive-image'
import { rocYear } from '../app/utils/page-content'
import manifest from '../app/generated/image-manifest.json'

const site = fixture as unknown as SiteContent
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const component = read('../app/components/AboutContent.vue')
const template = component.slice(component.indexOf('<template>'))
const shared = read('../app/utils/about-content.ts')
const css = read('../app/assets/css/about.css')
const gone = (path: string) => !existsSync(fileURLToPath(new URL(path, import.meta.url)))
// 拿掉註解（註解裡會寫換版前的元件名與動畫）
const code = component.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '')

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
    expect(sitemapXml('https://ivy.example')).toContain('<loc>https://ivy.example/about</loc>')
    expect(llmsTxt('https://ivy.example', { siteMeta: site.siteMeta })).toContain('(https://ivy.example/about)')
  })
  it('沒有正式 origin 時不輸出 canonical 與結構化資料', () => {
    const seo = aboutSeo(site, '')
    expect(seo.canonical).toBeUndefined()
    expect(seo.graph).toEqual([])
  })
  it('創校年份跟著後台沿革第一站；內建內容的標題描述與改版前一字不差', () => {
    const brand = site.siteMeta.brandName
    const seo = aboutSeo(site, 'https://ivy.example')
    expect(seo.title).toBe(`關於常春藤｜1997 年創立、五所校園與全人教育｜${brand}`)
    expect(seo.description).toBe('常春藤幼兒園 1997 年在高雄三民區義華路創立，陸續成立明華、崇德、國際、仁武校。秉持全人教育，以課綱六大領域培養孩子六大核心素養。')
    const edited = { ...site, aboutPage: { ...site.aboutPage, milestones: site.aboutPage.milestones.map((m, i) => (i ? m : { ...m, year: 1998 })) } }
    const changed = aboutSeo(edited, 'https://ivy.example')
    expect(changed.title).toBe(`關於常春藤｜1998 年創立、五所校園與全人教育｜${brand}`)
    expect(changed.description).toContain('常春藤幼兒園 1998 年在高雄三民區義華路創立')
    expect(changed.graph[0]!.name).toBe(changed.title)
  })
})

describe('五校沿革', () => {
  const milestones = site.aboutPage.milestones.map((m) => ({ key: m.key, year: m.year, roc: rocYear(m.year) }))
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
    expect(JSON.stringify(site.aboutPage)).not.toMatch(/三十多|週年|美語部|補習班/)
  })
})

describe('關於常春藤頁的文字來自後台內容（2026-10）', () => {
  it('元件不再寫死段落文字與沿革', () => {
    for (const phrase of ['從一間幼兒園', '近三十年，', '孩子的第一所學校', '第一間常春藤，在三民區', '把每個孩子，放在心上']) expect(component).not.toContain(phrase)
    expect(site.aboutPage.chapterNames).toEqual(['一路走來', '全人教育', '我們的期許', '家長怎麼說'])
    expect(site.aboutPage.hopeQuotes).toHaveLength(2)
  })
})

describe('關於常春藤頁圖片', () => {
  it.each([ABOUT_HERO_IMAGE, 'about-together', 'about-curious'])('%s 已產生響應式候選檔', (name) => {
    expect(Object.hasOwn(manifest, name)).toBe(true)
    expect(responsiveImage(name).srcset).toBeTruthy()
  })
})

// 2026-10-30 換版（design/about-new-directions-20261030/h-blend.html，使用者選 H 第三版後「先這樣實作」）
describe('換版：桌機手機同一套，不翻頁、不釘住', () => {
  it('立體書（about-popup）、手機卡紙疊（AboutSheets）、AboutMedal 都拿掉，也不再載 motion', () => {
    for (const path of ['../app/utils/about-popup.ts', '../app/utils/about-sheets.ts', '../app/components/AboutSheets.vue', '../app/components/AboutMedal.vue', '../app/assets/css/about-sheets.css']) expect(gone(path)).toBe(true)
    expect(code).not.toMatch(/AboutSheets|AboutMedal|about-popup|import\('motion'\)|from 'motion'/)
    expect(component).not.toContain("matchMedia('(min-width: 901px)')")
  })
  it('動態只用捲動驅動動畫，包在 @supports 與「不減少動態」裡；不支援、減少動態、沒有 JS 時是完成狀態', () => {
    const motion = cssCode.indexOf('@supports (animation-timeline: view()){')
    expect(motion).toBeGreaterThan(0)
    expect(cssCode.slice(motion)).toMatch(/^@supports \(animation-timeline: view\(\)\)\{\s*@media \(prefers-reduced-motion:no-preference\)\{/)
    expect(cssCode.slice(0, motion)).not.toMatch(/animation|opacity:0/)
    expect(component).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    expect(component).toContain("matchMedia('(forced-colors: active)')")
  })
  it('六圈由這頁發 abk-open 開始播（AboutWholePerson 聽最近的 [data-spread]）', () => {
    expect(template).toMatch(/<section id="whole-child"[^>]*\bdata-spread\b/)
    expect(component).toContain("querySelector('#whole-child')?.dispatchEvent(new Event('abk-open'))")
  })
  it('頁面內容不放預約參觀（頁首全站共用的預約鈕除外）', () => {
    expect(template).not.toContain('to="/visit"')
    expect(template).toContain('data-cta-entry="about"')
  })
})

describe('換版：章節與首屏', () => {
  it('首屏一排章節索引，點了跳到各章；章節上方只標兩位數編號，不用英文眉標（09-30 被評 AI 感）', () => {
    expect(template).toContain('<nav class="abh-index" aria-label="這一頁的章節">')
    expect(template).toContain(':href="`#${item.id}`"')
    expect(component).toContain("no: String(i + 1).padStart(2, '0')")
    expect(template).not.toMatch(/Our story|Whole child|Our hope/)
  })
  it('四章 id 不變（特色教學頁連 /about#whole-child），五所校園結尾拿掉', () => {
    for (const id of ['story', 'whole-child', 'hope', 'voices']) expect(template).toContain(`id="${id}"`)
    expect(template).not.toContain('id="campuses"')
    expect(read('../app/components/CurriculumContent.vue')).toContain('/about#whole-child')
  })
  it('首屏照片裡的長輩是創辦人（使用者確認，不寫姓名）', () => {
    // 內建照片的說明是共用常數、不開放編輯；後台換了照片才用後台的說明
    expect(shared).toContain("export const HERO_ALT = '孩子們笑著圍在創辦人身邊，大家擠在一起'")
    expect(template).toContain('pagePhotoAlt(HERO_ALT, page.heroPhoto, page.heroPhotoAlt)')
  })
  it('紀念章在一路走來章名旁，純裝飾；用原本的校徽面圖，不載 three；不寫「相隔十五年」', () => {
    expect(template).toContain('<span class="abh-medal" aria-hidden="true" />')
    expect(css).toContain("background:url('/assets/about-medal/front.webp') center/cover")
    expect(gone('../public/assets/about-medal/front.webp')).toBe(false)
    expect(component).not.toMatch(/from 'three'|import\('three'\)/)
    expect(template).not.toMatch(/相隔|十五年/)
  })
  it('引言不用左側色條（側條），用橘色蠟筆畫的「」（見 about-crayon.spec.ts）', () => {
    expect(css).not.toMatch(/\.abh-quote\{[^}]*border-left/)
    expect(css).toMatch(/\.abh-quote::before\{position:absolute;[^}]*mask-image:url\("data:image\/svg\+xml/)
  })
})

describe('換版：家長怎麼說', () => {
  it('讀各校後台的 testimonials，五校輪流取最多四位（行為見 about-voices.spec.ts）；沒有資料時整章不出現', () => {
    expect(component).toContain('pickVoices(props.campuses)')
    expect(component).not.toContain('.slice(0, 4)')
    expect(template).toContain('<section v-if="voices.length" id="voices"')
  })
  it('章標題是使用者 10-30 指定的「孩子的進步，家長看得見。」，不再取第一位家長的原話', () => {
    expect(component).toContain("const VOICES_TITLE = ['孩子的進步，', '家長看得見。']")
    expect(template).toContain('v-for="(line, i) in VOICES_TITLE"')
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
