import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { aboutSeo, llmsTxt, sitemapXml } from '../app/utils/seo'
import { ABOUT_HERO_IMAGE, responsiveImage } from '../app/utils/responsive-image'
import { rocYear } from '../app/utils/page-content'
import { DOMAINS, LITERACIES, STORY_TITLE_ORIGINAL, aboutHeroLede, quotePhrases, storyYearTitle, yearDigits, yearsRunning, yearsSpoken } from '../app/utils/about-content'
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
  // 2026-11-11：標題結尾從品牌名改成「常春藤幼兒園」（seo.ts 的 TITLE_BRAND），其餘一字不差。
  it('創校年份跟著後台沿革第一站；內建內容的標題描述照內建寫法', () => {
    const brand = '常春藤幼兒園'
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
  it('畫面上不寫死「三十多年」，也不提美語補習班（未定案）；內文不提「週年」（沿革尾端接 30 週年頁的連結 2026-11-12 使用者說先拿掉）', () => {
    expect(template).not.toMatch(/三十多|美語部|補習班/)
    expect(JSON.stringify(site.aboutPage)).not.toMatch(/三十多|週年|美語部|補習班/)
    expect(template.replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/週年|\/anniversary/)
    // 開關在後台「全站設定」；prop 留著（正式頁與後台預覽照舊傳），連結加回來時直接用
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

// 2026-11-11 整頁重做「紅磚上的常春藤」（使用者：「全新方向重做」；不滿意的是質感不夠專業、內容說服力不夠、
// 動效與互動沒有記憶點）。以下守的是這一版的結構與不能退回去的規則；長相本身看截圖，不逐條鎖 CSS。
const year = read('../app/components/AboutYear.vue')
// 第一個「不減少動態」區塊之前＝沒有任何動態時的樣子
const still = cssCode.slice(0, cssCode.indexOf('@media (prefers-reduced-motion:no-preference)'))
// 第一個寬度斷點之前＝最窄的畫面（手機）
const narrow = cssCode.slice(0, cssCode.indexOf('@media (min-width:601px)'))

describe('整頁重做：不能退回去的規則', () => {
  it('舊版的元件都拿掉：立體書、卡紙疊、紀念章元件、六圈、蠟筆屋；不載 motion、three', () => {
    for (const path of [
      '../app/utils/about-popup.ts', '../app/utils/about-sheets.ts', '../app/components/AboutSheets.vue', '../app/components/AboutMedal.vue',
      '../app/assets/css/about-sheets.css', '../app/components/AboutWholePerson.vue', '../app/components/AboutCrayon.vue', '../app/generated/about-crayon.ts'
    ]) expect(gone(path), path).toBe(true)
    expect(code).not.toMatch(/AboutSheets|AboutMedal|AboutWholePerson|AboutCrayon|about-popup|import\('motion'\)|from 'motion'|from 'three'|import\('three'\)/)
    expect(shared).not.toMatch(/WAX_FILTER|SCENE\b|sceneStyle/)
  })
  it('頁面內容不放預約參觀（頁首全站共用的預約鈕除外，2026-09-28 裁定）', () => {
    expect(template).not.toMatch(/\/visit/)
    expect(template).toContain('data-cta-entry="about"')
  })
  it('四章 id 與順序不變（後台欄位、別頁的錨點都對這四個），沒有「五所校園」那一章', () => {
    const at = ['story', 'whole-child', 'hope', 'voices'].map((id) => template.indexOf(`id="${id}"`))
    for (const index of at) expect(index).toBeGreaterThan(0)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(template).not.toContain('id="campuses"')
  })
  it('章節上方只放後台的章名，不編 01–04、不用英文眉標（09-30、11-03 都被評 AI 感）', () => {
    expect(component).not.toContain("padStart(2, '0')")
    expect(template).not.toMatch(/Our story|Whole child|Our hope|Chapter/)
    // 章名只出現在首屏的章節索引；每章上方不再放眉標（2026-11-11 評析：四章同一套「眉標＋兩行大標＋右側灰字」太公式化）
    expect(code).not.toMatch(/abh-chap|abh-no\b|chapterName\(/)
    expect(cssCode).not.toMatch(/abh-chap|abh-no\b/)
  })
  it('欄位只有兩種切法（七比五、五比七）、同一個欄距，右欄起點全頁只有兩條', () => {
    const splits = [...cssCode.matchAll(/grid-template-columns:minmax\(0,(\d+(?:\.\d+)?)fr\) minmax\(0,(\d+(?:\.\d+)?)fr\)/g)].map((m) => `${m[1]}:${m[2]}`)
    // 1.3:1（沿革每一站的線稿與文字）、1.5:1（手機同一處）、2:1（場景大小圖）是區塊內部的切法，不是版面欄位
    expect([...new Set(splits)].filter((split) => !['1.3:1', '1.5:1', '2:1'].includes(split)).sort()).toEqual(['5:7', '7:5'])
    expect(cssCode.match(/column-gap:var\(--abh-gap\)/g)!.length).toBeGreaterThanOrEqual(7)
  })
  it('顏色一律走 token：樣式檔裡沒有色碼、rgb()、oklch() 字面值', () => {
    expect(cssCode).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|oklch\(|hsla?\(/i)
    expect(read('../app/assets/css/tokens.css')).toMatch(/--ivy-about-brick:\s*oklch\(/)
  })
  it('不用側邊色條、不用細紋與雜訊濾鏡', () => {
    expect(cssCode).not.toMatch(/border-(left|right):\s*[2-9]px/)
    expect(component + css).not.toMatch(/feTurbulence|repeating-linear-gradient/)
  })
  it('不寫操作說明：沒有「左右滑」「點一下」「往下捲」這類字', () => {
    expect(template.replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/左右滑|點一下|點了|往下捲|滑動看/)
  })
})

describe('動態：沒有 JS、減少動態、不支援捲動驅動動畫時都是完成狀態', () => {
  it('所有動畫都在「不減少動態」裡面；跟著捲動的另外包在 @supports', () => {
    expect(still.length).toBeGreaterThan(1000)
    expect(still).not.toMatch(/animation|transition/)
    const scroll = cssCode.indexOf('@supports (animation-timeline: view()){')
    expect(scroll).toBeGreaterThan(0)
    expect(cssCode.slice(scroll)).toMatch(/^@supports \(animation-timeline: view\(\)\)\{\s*@media \(prefers-reduced-motion:no-preference\)\{/)
    expect(cssCode.indexOf('animation-timeline:')).toBeGreaterThan(scroll)
  })
  it('完成狀態看得到每一樣東西：關鍵影格只寫 from（起點），沒有哪個元素的預設樣式是透明或被裁掉', () => {
    // 唯一的 opacity:0／visibility:hidden 是六大領域沒選到的那五段說明（761 以上疊在同一格）
    const hidden = still.match(/[^{}]+\{[^{}]*(?:opacity:0|visibility:hidden)[^{}]*\}/g) ?? []
    expect(hidden.map((rule) => rule.trim().split('{')[0])).toEqual(['.abh-panel'])
    expect(still).not.toMatch(/clip-path/)
    for (const name of ['abh-line', 'abh-fade', 'abh-settle', 'abh-drift', 'abh-lit']) expect(cssCode).toContain(`@keyframes ${name}{from{`)
  })
  it('捲進畫面才播一次的進場：只有 JS 標成 wait 的才會被收起來，標記寫在 data 屬性（Vue 重繪不會洗掉）', () => {
    expect(cssCode).toContain('.abh [data-rise=wait]{opacity:0;transform:translateY(28px)}')
    expect(cssCode).toContain('.abh [data-draw=wait] .abh-sketch-ink{clip-path:inset(0 100% 0 0)}')
    expect(still).not.toMatch(/data-rise|data-draw/)
    // 掛載時已經在畫面裡或上面的不動，只收還在畫面下面的；減少動態時整段不做
    expect(component).toContain("if (matchMedia('(prefers-reduced-motion: reduce)').matches) return")
    expect(component).toContain('if (box.top < window.innerHeight || box.left >= window.innerWidth) continue')
    expect(component).toContain("if (el.dataset.rise === 'wait') el.dataset.rise = 'in'")
    // 模板裡只寫空的屬性（伺服器輸出沒有 wait）
    expect(template).not.toMatch(/data-(rise|draw)="/)
    expect(template.match(/ data-rise\b/g)!.length).toBeGreaterThan(8)
  })
  it('年份跳字的位置寫在 inline style，伺服器輸出就是對的年份；減少動態時不滾', () => {
    expect(year).toContain(`:style="{ '--d': digit, '--i': i }"`)
    expect(year).toMatch(/@media \(prefers-reduced-motion:no-preference\)\{\s*\.aby-strip\{transition:/)
    expect(year).toContain('<span class="sr-only">{{ value }}</span>')
    expect(year).toContain('<span class="aby-reel" aria-hidden="true">')
    expect(yearDigits(1997)).toEqual([1, 9, 9, 7])
    expect(yearDigits(86)).toEqual([0, 0, 8, 6])
    expect(yearDigits(2026)).toEqual([2, 0, 2, 6])
  })
})

describe('首屏', () => {
  it('大標、介紹、一張照片、一排章節索引（點了跳到各章）', () => {
    const hero = template.slice(template.indexOf('<section class="abh-hero"'), template.indexOf('<section id="story"'))
    expect(hero.match(/<figure /g)).toHaveLength(1)
    expect(hero).toContain('<nav class="abh-wrap abh-index" aria-label="這一頁的章節">')
    expect(hero).toContain(':href="`#${item.id}`"')
    expect(hero).not.toContain('about-curious')
  })
  it('電腦（901 以上）：左邊大標在上、介紹在下，右邊 6:5 的照片；母檔 3:2，只露出右邊八成（左邊裁到木柱為止，2026-11-12 使用者：先要裁掉左邊，再說「左邊可以再多一點」）', () => {
    const info = (manifest as Record<string, { width: number, height: number }>)[ABOUT_HERO_IMAGE]!
    expect(info.width / info.height).toBeCloseTo(1.5, 2)
    const desktop = cssCode.slice(cssCode.indexOf('@media (min-width:901px)'), cssCode.indexOf('@media (min-width:1001px)'))
    expect(desktop).toContain('.abh-hero{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);')
    expect(desktop).toContain('.abh-hero-top{display:flex;flex-direction:column;justify-content:space-between;')
    expect(desktop).toContain('.abh-hero-frame img{object-position:100% 50%}')
    // 照片高度不超過「視窗高 − 190px」：矮視窗也整張看得到（使用者的視窗只有 550–650px 高）
    expect(desktop).toContain('.abh-hero-frame{width:min(100%,max(400px,calc((100svh - 190px) * 1.2)));margin-left:auto;aspect-ratio:6/5}')
    expect(cssCode).not.toContain('max-height:820px')
  })
  it('900 以下：照片在標題底下、和版心同寬，700 以下 3:2、701–900 是 2:1', () => {
    expect(still).toMatch(/\.abh-hero-frame\{aspect-ratio:3\/2;/)
    const wide = cssCode.slice(cssCode.indexOf('@media (min-width:701px)'), cssCode.indexOf('@media (min-width:761px)'))
    expect(wide).toContain('.abh-hero-frame{aspect-ratio:2/1}')
  })
  it('內建照片的說明是共用常數、不開放編輯；後台換了照片才用後台的說明', () => {
    expect(shared).toContain("export const HERO_ALT = '校外教學走在步道上，兩個孩子回頭對著鏡頭笑，老師在旁邊陪著'")
    expect(template).toContain('pagePhotoAlt(HERO_ALT, page.heroPhoto, page.heroPhotoAlt)')
    expect(template).toContain('loading="eager" fetchpriority="high"')
  })
})

describe('一路走來：年份里程表、一校一站', () => {
  it('里程表有兩個（1001 以上左邊的特大年份、1000 以下貼在頁首底下的一條），都是裝飾、有 JS 才出現', () => {
    expect(template).toMatch(/<div class="abh-meter" aria-hidden="true">\s*<AboutYear class="abh-meter-year" :value="meter\.year" \/>/)
    expect(template).toMatch(/<div class="abh-strip" aria-hidden="true">\s*<AboutYear class="abh-strip-year" :value="meter\.year" \/>/)
    expect(still).toContain('.abh-meter{display:none}')
    expect(still).toContain('.abh-strip,.abh-strip-mask{display:none}')
    expect(still).toMatch(/\.abh\.is-live \.abh-strip\{position:sticky;top:72px;/)
    // 1001 以上只有年份里程表停在視窗中間一路跟著，章頭照常捲走（整個章頭一起釘，矮視窗釘不住、左邊整片空白）
    expect(cssCode).toMatch(/\.abh\.is-live \.abh-meter\{position:sticky;top:max\(104px,calc\(50vh - 7\.5rem\)\);display:block;/)
    expect(cssCode).not.toMatch(/\.abh-story-side\{[^}]*position:sticky/)
    expect(cssCode).not.toContain('min-height:741px')
    // 年份條上面那塊擋住頁首膠囊後面捲過去的內容，不佔高度
    expect(still).toMatch(/\.abh\.is-live \.abh-strip-mask\{position:sticky;top:0;[^}]*height:72px;margin:0 calc\(-1 \* var\(--abh-gutter\)\) -72px;/)
  })
  it('哪一站走過基準線就換年份：每次整排重算（跳著捲也不漏），走過最後一站是今年、寫第幾年', () => {
    // 基準線：左邊的特大年份看視窗中間；頁首底下那一條看它自己的下緣（看中間的話，年份會壓在上一校的照片上）
    expect(component).toContain('const line = wide ? Math.round(window.innerHeight * 0.6) : 150')
    expect(component).toContain('stops.forEach((stop, i) => { if (stop.getBoundingClientRect().top < line) at = i })')
    // 觀察「基準線以上的全部」：一站的上緣過了線就算在裡面，一次跳過好幾站狀態也一定會變（只看線上那一條會漏）
    expect(component).toContain('rootMargin: `100000px 0px -${Math.max(0, window.innerHeight - line)}px 0px`')
  })
  it('整章收在今年：特大年份從最後一校那年滾到今年、寫第幾年；紀念章、幾所校園、五張線稿排一排', () => {
    const finale = template.slice(template.indexOf('<div class="abh-wrap abh-finale">'), template.indexOf('<!-- 全人教育'))
    expect(finale).toContain('<AboutYear class="abh-meter-year" :value="finaleYear" />')
    expect(finale).toContain('<b>{{ yearsRunning(founded, thisYear) }}</b>')
    expect(finale).toContain('<h3>{{ todayTitle }}</h3>')
    expect(finale).toContain('<span class="abh-medal" aria-hidden="true" />')
    // 2026-11-12 使用者：結尾兩個連結（看五校的校園環境、看常春藤 30 週年）先拿掉
    expect(finale).not.toMatch(/NuxtLink|abh-link/)
    // 伺服器輸出與沒有 JS、減少動態時就是今年；有動態時先停在最後一校那年，捲進畫面才滾
    expect(component).toContain('const finaleYear = ref(thisYear)')
    expect(component).toContain("if (el.classList.contains('abh-finale-year')) finaleYear.value = lastYear.value")
    expect(component).toContain("if (el.classList.contains('abh-finale-year')) finaleYear.value = thisYear")
    expect(yearsRunning(1997, 2026)).toBe('第 30 年')
    expect(yearsRunning(1997, 2027)).toBe('滿 30 年')
    expect(yearsRunning(1997, 2028)).toBe('第 32 年')
  })
  it('每一站：手繪線稿（墨線＋淡彩；後台換過線稿的走 is-blend）、年份校名、沿革、地址電話；不放校園場景照', () => {
    expect(component).toContain('ink: campus ? lineArtInkImage(campus, SKETCH_SIZES) : null')
    expect(component).toContain('wash: campus && !blend ? responsiveImage(`campus-line-art-${item.key}-wash`, SKETCH_SIZES) : null')
    expect(template).toContain(`<figure v-if="item.campus && item.ink" class="abh-sketch" :class="{ 'is-blend': item.blend }" data-draw>`)
    expect(template).toContain(':alt="`${item.campus.name}校舍的手繪圖`"')
    expect(template).toContain('<a :href="`tel:${item.campus.phone.replace(/[^0-9+]/g, \'\')}`">')
    // 2026-11-12 使用者：「只要學校就好 不用校園特色」——各校校園探索的場景照不放在這頁（完整的在環境頁）
    expect(code).not.toMatch(/tourScenes|responsiveTourImage|abh-scenes/)
    expect(cssCode).not.toContain('abh-scenes')
  })
  it('線稿放大了：墨線版補到 1440w（母檔 1536）', () => {
    for (const key of ['yihua', 'minghua', 'chongde', 'international', 'renwu']) {
      const info = (manifest as Record<string, { candidates: { width: number }[] }>)[`campus-line-art-${key}-ink`]!
      expect(info.candidates.map((c) => c.width)).toEqual([160, 240, 360, 480, 720, 1080, 1440])
    }
  })
  it('紀念章在整章結尾（今年）的幾所校園旁，純裝飾；用原本的校徽面圖；不寫「相隔十五年」', () => {
    expect(template).toContain('<span class="abh-medal" aria-hidden="true" />')
    expect(css).toContain("background:url('/assets/about-medal/front.webp') center/cover")
    expect(gone('../public/assets/about-medal/front.webp')).toBe(false)
    expect(template).not.toMatch(/相隔|十五年/)
  })
})

// 2026-10-31（Jason 10-29 的建議）：六大領域各有一段說明；2026-11-10 起不用點開，選一個領域就換那一段
describe('全人教育：六張照片選一個看說明', () => {
  it('六項都有說明與一張站上現有的實拍，順序同課綱', () => {
    expect(DOMAINS.map((d) => d.name)).toEqual(['身體動作與健康', '認知', '語文', '社會', '情緒', '美感'])
    for (const d of DOMAINS) {
      expect(d.detail.length).toBeGreaterThan(30)
      expect((manifest as Record<string, unknown>)[d.photo], d.photo).toBeDefined()
      expect(d.alt.length, d.name).toBeGreaterThan(8)
      expect(d.focus).toMatch(/^\d+% \d+%$/)
      expect(d.zoom).toBeGreaterThanOrEqual(1)
      // 六個領域不再各用一個顏色（名牌統一米白底、選到的暖黃）
      expect(d).not.toHaveProperty('color')
    }
    expect(cssCode).not.toContain('--ivy-whole-')
    expect(new Set(DOMAINS.map((d) => d.photo)).size).toBe(6)
    // 2026-11-12 使用者：「跟其他分頁重複了」——六張是這頁專用的（about-whole-*），別的頁面與內建內容都沒用到
    for (const d of DOMAINS) {
      expect(d.photo).toMatch(/^about-whole-/)
      expect(JSON.stringify(fixture)).not.toContain(d.photo)
      for (const file of ['CurriculumContent.vue', 'EnvironmentContent.vue', 'AdmissionContent.vue', 'DayExperience.vue']) expect(read(`../app/components/${file}`)).not.toContain(d.photo)
    }
    expect(template).toContain('<ResponsivePicture v-bind="pagePhotoAttrs(item.photo, undefined, DOMAIN_SIZES)" :alt="item.alt" loading="lazy" decoding="async" />')
  })
  it('用原生 radio（鍵盤左右鍵換、沒有 JS 也能選），預設第一項；滑鼠停在上面才換、觸控是點', () => {
    expect(template).toContain('<input v-model="pickedDomain" class="sr-only" type="radio" name="abh-domain" :value="i">')
    expect(component).toContain('const pickedDomain = ref(0)')
    expect(component).toContain("if (event.pointerType !== 'mouse') return")
    expect(code).not.toContain('<details')
  })
  it('展開與說明都靠 CSS（:has）：選到的那一欄變寬、那一段說明顯示；六段說明都在 HTML 裡', () => {
    for (let i = 1; i <= 6; i++) expect(cssCode).toContain(`.abh-slats:has(.abh-slat:nth-child(${i}) input:checked){grid-template-columns:`)
    expect(cssCode).toContain('.abh-slat:has(input:checked) .abh-panel{visibility:visible;opacity:1}')
    expect(template).not.toMatch(/class="abh-panel"[^>]*(v-show|v-if|hidden)/)
  })
  it('760 以下是左右滑的六張卡片，說明直接寫在每張底下（不用選）', () => {
    expect(narrow.length).toBeGreaterThan(1000)
    expect(narrow).toMatch(/\.abh-slats\{display:flex;[^}]*overflow-x:auto;scroll-snap-type:x mandatory/)
    expect(narrow).not.toMatch(/\.abh-panel\{[^}]*(visibility|opacity)/)
  })
  it('六大核心素養是一行字（不做成看起來能點的膠囊），出處一行小字', () => {
    expect(LITERACIES).toHaveLength(6)
    // 一個詞一塊、不換行（不然「想像創造」會被拆在兩行），間隔號是 CSS 加的
    expect(template).toContain('<p class="abh-lits"><b>六大核心素養</b><span v-for="name in LITERACIES" :key="name">{{ name }}</span></p>')
    expect(cssCode).toContain('.abh-lits span:not(:last-child)::after{content:"・"}')
    expect(template).toContain('<p v-if="page.wholeFineSource" class="abh-fine-source">{{ page.wholeFineSource }}</p>')
  })
})

describe('我們的期許：深綠、創辦人照片、引言一句一句亮起來', () => {
  it('引言照標點拆成一句一句，拆完接回去一字不差', () => {
    for (const quote of site.aboutPage.hopeQuotes) {
      const parts = quotePhrases(quote)
      expect(parts.length).toBeGreaterThan(1)
      expect(parts.join('')).toBe(quote)
    }
    expect(quotePhrases('沒有標點的一句話')).toEqual(['沒有標點的一句話'])
    expect(template).toContain('<span v-for="(phrase, j) in quotePhrases(quote)" :key="j" class="abh-lit">{{ phrase }}</span>')
  })
  it('還沒亮的顏色只存在捲動動畫的起點；沒有動畫時整段是亮的', () => {
    expect(still).toContain('.abh-lit{display:inline-block;max-width:100%;color:var(--ivy-ivory)}')
    expect(cssCode).toContain('@keyframes abh-lit{from{color:var(--ivy-about-hope-dim)}}')
  })
  it('內建照片底下寫「創辦人和常春藤的孩子」；後台換了照片就不寫（換上的不一定是創辦人）', () => {
    expect(shared).toContain("export const HOPE_CAPTION = '創辦人和常春藤的孩子'")
    expect(template).toContain('<figcaption v-if="!page.hopePhoto">{{ HOPE_CAPTION }}</figcaption>')
    expect(template).toContain("pagePhotoAttrs('about-together', page.hopePhoto")
  })
})

describe('關於常春藤頁的文字來自後台內容（2026-10）', () => {
  it('元件不寫死段落文字與沿革', () => {
    for (const phrase of ['從一間幼兒園', '近三十年，', '孩子的第一所學校', '第一間常春藤，在三民區', '把每個孩子，放在心上']) expect(component).not.toContain(phrase)
    expect(site.aboutPage.chapterNames).toEqual(['一路走來', '全人教育', '我們的期許', '家長怎麼說'])
    expect(site.aboutPage.hopeQuotes).toHaveLength(2)
  })
})

describe('關於常春藤頁圖片', () => {
  it.each([ABOUT_HERO_IMAGE, 'about-together', 'env-hero-hug', 'cur-hero', 'day-hello', ...DOMAINS.map((d) => d.photo)])('%s 已產生響應式候選檔', (name) => {
    expect(Object.hasOwn(manifest, name)).toBe(true)
    expect(responsiveImage(name).srcset).toBeTruthy()
  })
})

describe('家長怎麼說', () => {
  it('第一位放大（影片在左、那句話放大在右），其餘排一列', () => {
    expect(template).toContain(`:class="{ 'is-lead': i === 0 }"`)
    expect(cssCode).toContain('.abh-voice-grid .is-lead{grid-column:1/-1}')
    expect(cssCode).toMatch(/\.is-lead \.abh-voice\{display:grid;grid-template-columns:minmax\(0,7fr\) minmax\(0,5fr\)/)
  })
  it('讀各校後台的 testimonials，五校輪流取最多四位（行為見 about-voices.spec.ts）；沒有資料時整章不出現', () => {
    expect(component).toContain('pickVoices(props.campuses)')
    expect(component).not.toContain('.slice(0, 4)')
    expect(template).toContain('<section v-if="voices.length" id="voices"')
  })
  it('章標題是使用者 10-30 指定的「孩子的進步，家長看得見。」（11-03 起標題不放逗號句號），不取第一位家長的原話', () => {
    expect(component).toContain("const VOICES_TITLE = ['孩子的進步', '家長看得見']")
    expect(template).toContain('v-for="(line, i) in VOICES_TITLE"')
  })
  it('一位家長一張影片卡：按播放才在那一張插 youtube-nocookie，一次只播一支；沒有 JS 時是連到 YouTube 的連結', () => {
    expect(template).toMatch(/<iframe\s+v-if="playingId === item\.youtubeId" :src="youtubeEmbed\(item\.youtubeId\)"/)
    expect(template).toContain('@click.prevent="playingId = item.youtubeId"')
    expect(template).toContain(':href="`https://www.youtube.com/watch?v=${item.youtubeId}`"')
    // 卡片跟著影片走（不是跟著位置）：預覽時前面刪掉一支，正在播的那張不會被拆掉重建
    expect(template).toContain(':key="`${item.campus.key}-${item.youtubeId}`"')
  })
  it('那句話一句一塊（換行落在標點後面），開頭的引號只在第一行往左掛出去', () => {
    expect(template).toContain('<q><span v-for="(phrase, j) in quotePhrases(item.quote)" :key="j" class="abh-ph">{{ phrase }}</span></q>')
    expect(cssCode).toContain('.abh-ph{display:inline-block;max-width:100%;text-indent:0}')
    expect(cssCode).toMatch(/\.abh-voice q\{display:block;quotes:"「" "」";text-indent:-\.5em;/)
    // 一般段落不這樣排（每一句都比一行長，會留下一兩個字的短行）
    expect(template.match(/class="abh-ph"/g)).toHaveLength(1)
  })
  it('只有一校有影片時不特別寫校名（2026-11-12 使用者：「不要特別寫義華校」）；兩校以上才標', () => {
    const withVoices = site.campuses.filter((c) => c.testimonials?.length)
    expect(withVoices.map((c) => c.key)).toEqual(['yihua'])
    expect(component).toContain('const nameCampus = computed(() => voiceCampuses.value.length > 1)')
    expect(template).toContain('<small>{{ item.speaker }}<template v-if="nameCampus"> · {{ item.campus.name }}家長</template></small>')
    expect(template).toContain(`<template v-if="nameCampus">{{ voiceCampuses.map((c) => c.name).join('、') }}</template>家長在學校 YouTube 頻道上的分享。`)
    expect(template).toContain('到<template v-if="nameCampus">{{ campus.name }}</template> YouTube 看更多分')
  })
})

describe('結尾：其他頁面', () => {
  it('不放照片（2026-11-12 使用者），只有頁名、一行說明與箭頭；入學資訊分頁隱藏時不放（後台開關）', () => {
    expect(component).toContain("const nextPages = computed(() => NEXT.filter((item) => props.admission || item.href !== '/admission'))")
    expect(template).toMatch(/<section class="abh-wrap abh-next"[^>]*>\s*<h2 id="next-title">/)
    const next = template.slice(template.indexOf('<section class="abh-wrap abh-next"'))
    expect(next).not.toMatch(/ResponsivePicture|<img|abh-next-photo/)
    expect(read('../app/pages/about.vue')).toContain(':admission="admissionEnabled(data.content.siteMeta)"')
  })
  it('761 以上幾頁排成一排、每一格上面一條線（同首屏的章節索引）；760 以下一列一頁', () => {
    expect(narrow).toContain('.abh-next-list a{display:grid;grid-template-columns:minmax(0,1fr) auto;')
    expect(cssCode).toContain('.abh-next-list{grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);')
    // 不再是左邊標題、右邊三大列（左邊空一大塊）
    expect(cssCode).not.toMatch(/\.abh-next\{grid-template-columns/)
  })
})
