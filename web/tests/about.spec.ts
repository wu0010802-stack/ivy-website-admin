import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { aboutSeo, llmsTxt, sitemapXml } from '../app/utils/seo'
import { ABOUT_HERO_IMAGE, responsiveImage } from '../app/utils/responsive-image'
import { rocYear } from '../app/utils/page-content'
import { DOMAINS, SCENE, STORY_TITLE_ORIGINAL, aboutHeroLede, storyYearTitle, yearsSpoken } from '../app/utils/about-content'
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
  it('畫面上不寫死「三十多年」，也不提美語補習班（未定案）；「週年」只在接 30 週年頁的連結（後台開關打開時）', () => {
    expect(template).not.toMatch(/三十多|美語部|補習班/)
    expect(JSON.stringify(site.aboutPage)).not.toMatch(/三十多|週年|美語部|補習班/)
    expect(template.replace(/<!--[\s\S]*?-->/g, '').match(/週年/g)).toHaveLength(1)
    expect(template).toMatch(/<p v-if="anniversary" class="abh-tl-end">\s*<NuxtLink class="abh-link" to="\/anniversary">看常春藤 30 週年/)
    // 開關在後台「全站設定」：關掉時 /anniversary 回 404，這頁也不連過去（正式頁與後台預覽都傳）
    expect(read('../app/pages/about.vue')).toContain(':anniversary="anniversaryEnabled(data.content.siteMeta)"')
    expect(read('../app/pages/preview.vue')).toContain(':anniversary="anniversaryEnabled(draft.siteMeta)"')
  })
})

// 2026-10-31：首屏介紹與第一章標題寫死「近三十年」，2027 年就過時；第一章標題又和首屏大標都在講「長成五所校園」
describe('年數由今年算', () => {
  it('幾年的說法：差一兩年到整十年寫「近」、整十年、其他「多年」', () => {
    expect([29, 30, 31, 37, 38, 40].map(yearsSpoken)).toEqual(['近三十年', '三十年', '三十多年', '三十多年', '近四十年', '四十年'])
  })
  it('第一章標題：1997 是第 1 年，2026 是第 30 年，2027 滿 30 年；不再重複首屏的「五所校園」', () => {
    expect(storyYearTitle(1997, 2026)).toEqual(['走到今年', '是第 30 年'])
    expect(storyYearTitle(1997, 2027)).toEqual(['走到今年', '滿 30 年'])
    expect(storyYearTitle(1997, 2028)).toEqual(['走到今年', '是第 32 年'])
    expect(storyYearTitle(1998, 2026)).toEqual(['走到今年', '是第 29 年'])
    expect(storyYearTitle(1997, 2026).join('')).not.toContain('五所校園')
  })
  it('首屏介紹：內建原文換年數，2026 年和原文一字不差；後台改寫過的照後台', () => {
    const lede = site.aboutPage.heroLede
    expect(aboutHeroLede(lede, 2026)).toBe(lede)
    expect(aboutHeroLede(lede, 2027)).toContain('。三十年來，我們守著')
    expect(aboutHeroLede(lede, 2029)).toContain('。三十多年來，我們守著')
    expect(aboutHeroLede('園方改寫的介紹，近三十年來。', 2030)).toBe('園方改寫的介紹，近三十年來。')
  })
  it('換算只認內建原文：fixture 的第一章標題與首屏介紹沒被改過（改了就要一起改 utils/about-content.ts）', () => {
    expect(site.aboutPage.storyTitle).toBe(STORY_TITLE_ORIGINAL)
    expect(site.aboutPage.heroLede).toContain('近三十年來')
    expect(component).toContain('props.page.storyTitle === STORY_TITLE_ORIGINAL')
    expect(component).toContain("Number.parseInt(taipeiIsoDate(), 10)")
  })
})

// 2026-10-31（Jason 10-29 的建議）：六大領域各有一段說明；2026-11-10 起不用點開，選一個領域就換那一段
describe('六大領域選一個看說明', () => {
  it('六項都有說明，順序與顏色同六圈', () => {
    expect(DOMAINS.map((d) => d.name)).toEqual(['身體動作與健康', '認知', '語文', '社會', '情緒', '美感'])
    for (const d of DOMAINS) expect(d.detail.length).toBeGreaterThan(30)
  })
  it('用原生 radio（鍵盤左右鍵換、沒有 JS 也能選），預設第一項；選到的那項讓六圈亮，點六圈也會換', () => {
    expect(template).toContain('<input v-model="pickedDomain" class="sr-only" type="radio" name="abh-domain" :value="i">')
    expect(component).toContain('const pickedDomain = ref(0)')
    expect(component).toContain('const focusDomain = computed(() => hoverDomain.value ?? pickedDomain.value)')
    expect(template).toContain('<AboutWholePerson :focus="focusDomain" @pick="pickedDomain = $event" @hover="hoverDomain = $event" />')
    expect(code).not.toContain('<details')
  })
  it('沒選到的說明用 CSS 收起（六段疊在同一格，換的時候高度不跳），不靠 JS 切換', () => {
    for (let i = 1; i <= 6; i++) expect(cssCode).toContain(`.abh-pick:has(li:nth-child(${i}) input:checked) .abh-panel:nth-child(${i})`)
    expect(cssCode).toMatch(/\.abh-panel\{[^}]*grid-area:1\/1[^}]*visibility:hidden\}/)
    expect(template).not.toMatch(/class="abh-panel"[^>]*(v-show|v-if|hidden)/)
  })
  it('六大核心素養收成出處前的一行，不再另列一份清單', () => {
    expect(template).toContain("六大核心素養：{{ LITERACIES.join('、') }}")
    expect(code).not.toContain('abh-literacies')
    expect(cssCode).not.toMatch(/abh-lists|abh-domains|abh-literacies/)
  })
})

// 2026-11-10 大修（使用者：「可以直接做 uiux 大修」）：這頁原本只有首屏一張孩子的照片，其他是校舍圖、圖表與蠟筆畫
describe('大修：多放真的孩子與家長', () => {
  it('六大領域各配一張站上現有的實拍（內建、有說明文字），放在說明旁邊', () => {
    for (const d of DOMAINS) {
      expect((manifest as Record<string, unknown>)[d.photo], d.photo).toBeDefined()
      expect(d.alt.length, d.name).toBeGreaterThan(8)
    }
    expect(new Set(DOMAINS.map((d) => d.photo)).size).toBe(6)
    expect(template).toContain('<ResponsivePicture v-bind="pagePhotoAttrs(item.photo, undefined, DOMAIN_SIZES)" :alt="item.alt" loading="lazy" />')
  })
  it('風格「乾淨留白」（2026-11-10）：照片沒有相框與傾斜，全人教育不鋪色帶，選項是一排文字', () => {
    expect(cssCode).toContain('.abh-card{position:relative;margin:0}')
    expect(cssCode).not.toMatch(/--abh-shadow|var\(--r[,)]/)
    expect(cssCode).toMatch(/\.abh-band\{[^}]*border-block:1px solid var\(--line\)\}/)
    expect(cssCode).not.toMatch(/\.abh-band\{[^}]*background/)
    expect(cssCode).toContain('.abh-tabs input:checked+span{color:var(--ivy-forest);box-shadow:inset 0 -3px 0 var(--ivy-forest)}')
    expect(cssCode).not.toMatch(/\.abh-tabs span\{[^}]*border-radius/)
    expect(component).not.toMatch(/milestoneLook|TILT/)
    expect(shared).not.toContain('MILESTONE_LOOKS')
  })
  it('家長清單每一位前面放影片封面的小圖（看得到人），仍是一顆按鈕、選到的 aria-pressed', () => {
    expect(template).toContain('<span class="abh-pick-thumb"><ResponsivePicture v-bind="posterAttrs(item, THUMB_SIZES)" alt="" loading="lazy" decoding="async" /></span><q>{{ item.quote }}</q>')
    expect(template).toContain(':aria-pressed="i === shownVoice"')
    // 2026-11-10 風格方向三：選到的那位左邊一條深綠線、小圖不退色（原本是小圖外一圈卡紙色）
    expect(cssCode).toContain('.abh-picks button[aria-pressed=true]{box-shadow:inset 3px 0 0 var(--ivy-forest)}')
    expect(cssCode).toContain('.abh-picks button[aria-pressed=true] .abh-pick-thumb{opacity:1}')
  })
  it('第三章蠟筆屋放大兩成（窗戶裡的照片跟著大），煙對準新的煙囪位置，畫的高度跟著加', () => {
    expect(SCENE.house).toEqual({ x: 130, y: 102, w: 360, h: 408 })
    expect(SCENE.house.x + SCENE.house.w / 2).toBe(310)
    expect(SCENE.smoke.x).toBeCloseTo(SCENE.house.x + 218 * 1.2 - 90, 5)
    expect(cssCode).toContain('.abh-art{--v:calc(min(100cqw,560px) / 620);position:relative;height:calc(600 * var(--v) + 16px);')
  })
  it('桌機第一章章頭：標題與紀念章在左、介紹段落在右下，不留半邊空白', () => {
    expect(template).toMatch(/<div class="abh-story-head">\s*<div class="abh-title-row">/)
    expect(cssCode.slice(cssCode.indexOf('@media (min-width:1001px)'))).toMatch(/\.abh-story-head\{[^}]*grid-template-columns:auto minmax\(0,1fr\)/)
  })
})

// 2026-11-10：桌機沿革五站排成一列（原本左右交錯直排，五站各一句話佔 1.65 屏）
describe('沿革桌機五站一列', () => {
  const row = cssCode.slice(cssCode.indexOf('@media (min-width:1001px)'))
  it('1001px 以上五欄＋一條橫軸，卡紙在上、字在下；1000px 以下照舊', () => {
    expect(row).toMatch(/\.abh-tl\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/)
    expect(row).toMatch(/\.abh-tl li:nth-child\(n\)\{[^}]*grid-template-rows:auto 48px auto[^}]*align-content:start/)
    expect(cssCode).toContain('@media (max-width:700px)')
  })
  it('五張卡紙一張接一張站起來', () => {
    for (const n of [2, 3, 4, 5]) expect(row).toContain(`.abh-tl li:nth-child(${n}) .abh-card{animation-range:`)
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
  it('四章 id 不變，五所校園結尾拿掉', () => {
    for (const id of ['story', 'whole-child', 'hope', 'voices']) expect(template).toContain(`id="${id}"`)
    expect(template).not.toContain('id="campuses"')
  })
  it('首屏只有一張 3:2 卡紙照片（2026-11-03 拿掉後排小卡，創辦人合照只留在第三章窗戶）', () => {
    // 內建照片的說明是共用常數、不開放編輯；後台換了照片才用後台的說明
    expect(shared).toContain("export const HERO_ALT = '校外教學走在步道上，兩個孩子回頭對著鏡頭笑，老師在旁邊陪著'")
    expect(template).toContain('pagePhotoAlt(HERO_ALT, page.heroPhoto, page.heroPhotoAlt)')
    const art = template.slice(template.indexOf('<div class="abh-hero-art">'), template.indexOf('<nav class="abh-index"'))
    expect(art.match(/<figure /g)).toHaveLength(1)
    expect(art).not.toContain('about-curious')
    expect(css).toMatch(/\.abh-hero-art \.abh-card\{[^}]*--ar:3\/2/)
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
  it('章標題是使用者 10-30 指定的「孩子的進步，家長看得見。」（11-03 起標題不放逗號句號），不再取第一位家長的原話', () => {
    expect(component).toContain("const VOICES_TITLE = ['孩子的進步', '家長看得見']")
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
