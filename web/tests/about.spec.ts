import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { aboutSeo, llmsTxt, sitemapXml } from '../app/utils/seo'
import { ABOUT_HERO_IMAGE, responsiveImage } from '../app/utils/responsive-image'
import { rocYear } from '../app/utils/page-content'
import manifest from '../app/generated/image-manifest.json'
import { MEDAL_YAW, medalFaces, medalPinTop, medalSequence, medalShown, medalTurn, turnState } from '../app/utils/about-popup'

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
    expect(sitemapXml('https://ivy.example')).toContain('<loc>https://ivy.example/about</loc>')
    expect(llmsTxt('https://ivy.example', { siteMeta: site.siteMeta })).toContain('(https://ivy.example/about)')
  })
  it('沒有正式 origin 時不輸出 canonical 與結構化資料', () => {
    const seo = aboutSeo(site, '')
    expect(seo.canonical).toBeUndefined()
    expect(seo.graph).toEqual([])
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

// 2026-10-03 紀念章取代拉紙條（design/about-medal-directions-20261003/，使用者選「章名旁＋連續轉」）
describe('立體書：紀念章跟著捲動翻面', () => {
  const popup = read('../app/utils/about-popup.ts')
  const medal = read('../app/components/AboutMedal.vue')
  it('每站中間 40% 停住、兩站之間才轉；站點剛好是整數，一路單調不倒轉', () => {
    expect([0, 1, 2, 5].map(medalTurn)).toEqual([0, 1, 2, 5])
    expect(medalTurn(0.85)).toBe(1)
    expect(medalTurn(1.15)).toBe(1)
    expect(medalTurn(1.5)).toBeCloseTo(1.5, 5)
    expect(medalTurn(1.35)).toBeGreaterThan(1)
    expect(medalTurn(1.35)).toBeLessThan(1.5)
    const samples = Array.from({ length: 101 }, (_, i) => medalTurn(i * 0.05))
    samples.slice(1).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(samples[i]!))
  })
  it('正反交替（2026-10-04）：先是大校徽、卡紙全倒，之後 1997／2005／2021 在墨綠反面、2001／2020 在米白正面', () => {
    const steps = medalSequence(5)
    expect(steps.map((s) => s.look)).toEqual(['crest', 'back', 'front', 'back', 'front', 'back'])
    expect(steps.map((s) => s.stop)).toEqual([null, 0, 1, 2, 3, 4])
    expect(steps.map((s) => s.up)).toEqual([0, 1, 2, 3, 4, 5])
    // A 面印偶數步：大校徽與米白正面；B 面印奇數步：都是墨綠反面
    steps.forEach((s, k) => expect(k % 2 ? s.look === 'back' : s.look !== 'back').toBe(true))
  })
  it('A 面印偶數步、B 面印奇數步，背對讀者的那一面先換成下一步', () => {
    expect(medalFaces(0, 6)).toEqual({ a: 0, b: 1 })
    expect(medalFaces(1, 6)).toEqual({ a: 2, b: 1 })
    expect(medalFaces(2, 6)).toEqual({ a: 2, b: 3 })
    expect(medalFaces(5, 6)).toEqual({ a: 5, b: 5 })
  })
  it('停在整數站時看到的就是那一站；靜止往左偏 18°，轉過 0.6 圈左右才換面', () => {
    for (let k = 0; k < 6; k++) expect(medalShown(k, 6)).toBe(k)
    expect(medalShown(0.55, 6)).toBe(0)
    expect(medalShown(0.65, 6)).toBe(1)
    expect(MEDAL_YAW).toBe(-18)
    expect(medal).toContain('rotateY(calc(var(--medal-turn,0) * 180deg - 18deg))')
  })
  it('釘住位置：整個放得下就置中，只放得下要看的範圍就往上推，連範圍都放不下就不釘', () => {
    const margin = { top: 16, bottom: 16 }
    expect(medalPinTop(900, 797, 50, 730, margin)).toBeCloseTo(51.5)
    const top = medalPinTop(760, 797, 50, 730, margin)!
    expect(top).toBeCloseTo(-18.5)
    expect(top + 50).toBeGreaterThanOrEqual(16)
    expect(top + 730).toBeLessThanOrEqual(760 - 16)
    expect(medalPinTop(650, 797, 50, 730, margin)).toBeNull()
  })
  it('拉紙條拿掉；章名旁與右頁接縫各一個紀念章，外層軌道給釘住用；不寫「相隔十五年」', () => {
    expect(template).not.toMatch(/abk-pull|abk-tab|role="slider"|拉拉看/)
    expect(template).toContain('<div class="abk-track" data-medal-track>')
    expect(template).toContain('<AboutMedal class="is-title" :stops="medalStops" />')
    expect(template).toContain('<AboutMedal class="is-seam" :stops="medalStops" />')
    expect(template).not.toMatch(/相隔|十五年/)
  })
  it('紀念章純裝飾、對報讀器隱藏；沒有 JS 時停在校徽正面；強制色彩不顯示', () => {
    expect(medal).toContain('data-medal aria-hidden="true"')
    expect(medal).toContain(":data-state=\"side === 'a' ? 0 : 1\" :data-look=\"side === 'a' ? 'crest' : 'back'\"")
    expect(medal).toMatch(/@media \(forced-colors:active\) \{\s*\.abk-medal \{display:none\}/)
  })
  it('減少動態不釘住也不轉；翻頁的捲動進度量外層軌道（跨頁 sticky 時位置不準）', () => {
    expect(popup).toContain('medals.length && !reducedMotion')
    expect(popup).toContain("spread.closest<HTMLElement>('[data-medal-track]') ?? spread")
  })
  it('面圖三張：大校徽、米白正面帶字、墨綠反面（校名年份用 SVG 疊），不載 three', () => {
    for (const side of ['front', 'label', 'back']) expect(existsSync(fileURLToPath(new URL(`../public/assets/about-medal/${side}.webp`, import.meta.url)))).toBe(true)
    expect(medal).toContain('<text class="is-name"')
    expect(`${medal}\n${popup}`).not.toMatch(/from 'three'|import\('three'\)/)
  })
  it('桌機在章名旁，手機改到右頁上緣接縫', () => {
    const css = read('../app/assets/css/about.css')
    expect(css).toMatch(/\.abk \.abk-medal\.is-title\{position:absolute;/)
    const narrow = css.slice(css.indexOf('@media (max-width:900px)'))
    expect(narrow).toContain('.abk .abk-medal.is-title{display:none}')
    expect(narrow).toMatch(/\.abk \.abk-medal\.is-seam\{display:block;position:absolute;top:-46px/)
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
    // 內建照片的說明留在元件常數、不開放編輯；後台換了照片才用後台的說明
    expect(component).toContain("const HERO_ALT = '孩子們笑著圍在創辦人身邊，大家擠在一起'")
    expect(template).toContain('pagePhotoAlt(HERO_ALT, page.heroPhoto, page.heroPhotoAlt)')
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
