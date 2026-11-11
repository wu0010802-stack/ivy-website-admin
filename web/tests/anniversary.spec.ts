import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANNI_MILESTONES, ANNI_YEARS, anniversaryYearIndex, campusCountAt, crayonLineX, milestoneOf, yearAtOffset } from '../app/utils/anniversary/timeline'
import { ANNI_ARTWORKS, mosaicCells } from '../app/utils/anniversary/gallery'
import { ANNI_MEDIA } from '../app/utils/anniversary/media'
import { thirtyStrokes } from '../app/utils/anniversary/crayonPad'
import { ANNI_FILM } from '../app/utils/anniversary/film-media'
import { FILM_CREDIT, FILM_CUES, FILM_FPS, FILM_PORTRAIT, FILM_SECONDS, FILM_TITLE, cueIndexAt, cueSeconds, durationLabel, formatClock, isoDuration, posterSrcset } from '../app/utils/anniversary/film'
import { CLIENT_INLINE_SCRIPTS } from '../server/utils/script-csp'
import { anniversaryEnabled, anniversarySeo, isAnniversaryHref, llmsTxt, sitemapXml } from '../app/utils/seo'
import { applyContentOverlay } from '../app/utils/content-overlay'
import siteFixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')
const page = read('app/pages/anniversary.vue')
const content = read('app/components/AnniversaryContent.vue')
const film = read('app/components/AnniversaryFilm.vue')
const css = read('app/assets/css/anniversary.css')
const filmCss = read('app/assets/css/anniversary-film.css')

describe('30 週年分頁：只用真實年份與已上線的文字', () => {
  it('五校年份依官方校史，1997 義華為業主裁定', () => {
    expect(ANNI_MILESTONES.map((m) => [m.key, m.year])).toEqual([
      ['yihua', 1997], ['minghua', 2001], ['chongde', 2005], ['international', 2020], ['renwu', 2021]
    ])
    for (const m of ANNI_MILESTONES) expect(m.roc).toBe(m.year - 1911)
  })

  // 2026-10 起 /about 的沿革文字改讀後台（預設＝fixture 的 aboutPage）
  it('沿革文字和 /about 第一章的內建內容一字不差', () => {
    const about = (siteFixture as unknown as SiteContent).aboutPage.milestones
    for (const m of ANNI_MILESTONES) expect(about.find((item) => item.key === m.key)?.text).toBe(m.history)
  })

  it('作品與替代文字沿用特色教學頁，沒放的照樣不放', () => {
    const curriculum = read('app/components/CurriculumContent.vue')
    expect(ANNI_ARTWORKS).toHaveLength(8)
    for (const a of ANNI_ARTWORKS) {
      expect(curriculum).toContain(`image: '${a.image}'`)
      expect(curriculum).toContain(`alt: '${a.alt}'`)
    }
  })

  it('不出現幼兒園不能用的字眼與未確認的說法', () => {
    const all = [content, film, read('app/utils/anniversary/film.ts'), read('app/utils/anniversary/timeline.ts'), read('app/utils/anniversary/gallery.ts')].join('\n')
    for (const word of ['美語部', '補習班', '三十多', '雙語']) expect(all).not.toContain(word)
  })
})

describe('30 週年分頁：時間軸', () => {
  it('1997 到 2027 每一年都有一格，2027 滿 30 年', () => {
    expect(ANNI_YEARS[0]).toBe(1997)
    expect(ANNI_YEARS.at(-1)).toBe(2027)
    expect(ANNI_YEARS).toHaveLength(31)
    expect(anniversaryYearIndex(1997)).toBe(1)
    expect(anniversaryYearIndex(2026)).toBe(30)
  })

  it('成立當年就算一所校園', () => {
    expect(campusCountAt(1997)).toBe(1)
    expect(campusCountAt(2000)).toBe(1)
    expect(campusCountAt(2001)).toBe(2)
    expect(campusCountAt(2019.9)).toBe(3)
    expect(campusCountAt(2021)).toBe(5)
    expect(milestoneOf(2005)?.key).toBe('chongde')
    expect(milestoneOf(2006)).toBeUndefined()
  })

  it('線頭位置換算年份：夾在頭尾、中間線性內插', () => {
    const marks = [{ year: 1997, y: 100 }, { year: 1998, y: 200 }, { year: 2001, y: 500 }]
    expect(yearAtOffset(0, marks)).toBe(1997)
    expect(yearAtOffset(150, marks)).toBeCloseTo(1997.5)
    expect(yearAtOffset(350, marks)).toBeCloseTo(1999.5)
    expect(yearAtOffset(9999, marks)).toBe(2001)
    expect(yearAtOffset(10, [])).toBe(1997)
  })

  it('蠟筆線的左右擺動不超出軌道，同一個 y 永遠同一個值', () => {
    for (let y = 0; y < 6000; y += 37) {
      const x = crayonLineX(y)
      expect(x).toBeGreaterThan(0.2)
      expect(x).toBeLessThan(0.8)
      expect(crayonLineX(y)).toBe(x)
    }
  })
})

describe('30 週年分頁：作品拼成的 30', () => {
  const ring = (x: number, y: number) => (Math.hypot((x - 0.5) / 0.35, (y - 0.5) / 0.4) < 1 ? 1 : 0)

  it('只在字形裡放格子，相鄰的格子不放同一件', () => {
    const cols = 20, rows = 16
    const cells = mosaicCells(ring, cols, rows)
    expect(cells.length).toBeGreaterThan(50)
    const at = new Map(cells.map((c) => [`${Math.round(c.x * cols)},${Math.round(c.y * rows)}`, c.art]))
    for (const c of cells) {
      expect(ring(c.x + 0.5 / cols, c.y + 0.5 / rows)).toBe(1)
      const i = Math.round(c.x * cols), j = Math.round(c.y * rows)
      expect(at.get(`${i - 1},${j}`)).not.toBe(c.art)
      expect(at.get(`${i},${j - 1}`)).not.toBe(c.art)
      expect(c.order).toBeGreaterThanOrEqual(0)
      expect(c.order).toBeLessThanOrEqual(1)
    }
    expect(mosaicCells(ring, cols, rows)).toEqual(cells)
  })
})

describe('30 週年分頁：入口、開關與素材', () => {
  it('2026-10-04 起是正式分頁：走全站 SEO、進主選單、頁尾、sitemap 與 llms.txt', () => {
    const site = siteFixture as unknown as SiteContent
    expect(page).toContain("usePageSeo(computed(() => data.value?.content), 'anniversary')")
    expect(page).not.toContain('noindex')
    const seo = anniversarySeo(site, 'https://ivy.example')
    expect(seo.title).toBe('常春藤 30 週年｜1997—2027｜常春藤幼兒園')
    expect(seo.canonical).toBe('https://ivy.example/anniversary')
    expect(sitemapXml('https://ivy.example')).toContain('<loc>https://ivy.example/anniversary</loc>')
    expect(llmsTxt('https://ivy.example', site)).toContain('[常春藤 30 週年](https://ivy.example/anniversary)')
    expect(site.siteMeta.primaryNav.at(-1)).toEqual({ label: '30 週年', labelEn: 'Anniversary', href: '/anniversary' })
    expect(site.footer.links.some((l) => l.href === '/anniversary')).toBe(true)
    expect(read('app/components/SiteHeader.vue')).toMatch(/PILL_PAGES = \[[^\]]*'\/anniversary'/)
  })

  it('後台「全站設定」關掉 30 週年：選單、頁尾、sitemap、llms.txt 拿掉，分頁 404、首頁不播布幕', () => {
    const site = siteFixture as unknown as SiteContent
    const meta = { title: 't', description: 'd', header_phone_number: '07', header_phone_note: 'n' }
    // 舊版本沒有這個欄位＝開
    const on = applyContentOverlay(site, { site_meta: meta })
    expect(anniversaryEnabled(on.siteMeta)).toBe(true)
    expect(on.siteMeta.primaryNav.some((l) => l.href === '/anniversary')).toBe(true)
    expect(on.footer.links.some((l) => l.href === '/anniversary')).toBe(true)

    const off = applyContentOverlay(site, {
      site_meta: { ...meta, anniversary_enabled: false },
      site_footer: { tagline: 't', copyright: 'c', bottom_note: 'b', campus_list_label: 'l', links: [{ label: '週年', href: '/anniversary#anni-cake' }, { label: '關於', href: '/about' }] }
    })
    expect(anniversaryEnabled(off.siteMeta)).toBe(false)
    expect(off.siteMeta.primaryNav.length).toBe(site.siteMeta.primaryNav.length - 1)
    expect(off.siteMeta.primaryNav.some((l) => isAnniversaryHref(l.href))).toBe(false)
    expect(off.footer.links).toEqual([{ label: '關於', href: '/about' }])
    expect(sitemapXml('https://ivy.example', undefined, { anniversary: false })).not.toContain('/anniversary')
    expect(llmsTxt('https://ivy.example', off)).not.toContain('/anniversary')

    // 後台選單只有 30 週年：關掉後退回內建選單（同樣沒有 30 週年），不留連到 404 的連結
    const onlyAnni = applyContentOverlay(site, {
      site_meta: { ...meta, anniversary_enabled: false, primary_nav: [{ label: '30 週年', label_en: '', href: '/anniversary' }] }
    })
    expect(onlyAnni.siteMeta.primaryNav).toEqual(site.siteMeta.primaryNav.filter((l) => l.href !== '/anniversary'))

    expect(isAnniversaryHref('/anniversary/')).toBe(true)
    expect(isAnniversaryHref('/anniversary?x=1')).toBe(true)
    expect(isAnniversaryHref('/anniversary-old')).toBe(false)
    expect(page).toMatch(/if \(!anniversaryEnabled\(data\.value\?\.content\.siteMeta\)\) \{\n\s+throw createError\(\{ statusCode: 404/)
    const home = read('app/pages/index.vue')
    expect(home).toContain('<EntranceCurtain v-if="curtain" />')
    expect(home).toContain("script: () => (curtain.value ? [{ key: 'entrance-curtain'")
    expect(read('server/routes/sitemap.xml.get.ts')).toContain('anniversary: anniversaryEnabled(published.content.siteMeta)')
  })

  it('瀏覽與預約按鈕的點擊會記在 30 週年頁', () => {
    expect(read('shared/telemetry.ts')).toContain("'/anniversary': 'anniversary'")
    expect(content).toContain('data-cta-entry="anniversary"')
  })

  it('時間軸的素材場都在 public 裡，檔名帶雜湊', () => {
    const files = [ANNI_MEDIA.crestFields, ANNI_MEDIA.kidsBody, ANNI_MEDIA.kidsBorder, ANNI_MEDIA.paper, ...Object.values(ANNI_MEDIA.fields)]
    for (const f of files) {
      expect(f).toMatch(/^\/assets\/anniversary\/[a-z-]+-[0-9a-f]{10}\.webp$/)
      expect(existsSync(resolve(__dirname, '../public', f.slice(1)))).toBe(true)
    }
    for (const k of ANNI_MILESTONES.map((m) => m.key)) {
      expect(Object.keys(ANNI_MEDIA.fields)).toContain(k)
      expect(existsSync(resolve(__dirname, `../public/assets/campus-line-art-${k}.webp`))).toBe(true)
      expect(existsSync(resolve(__dirname, `../public/assets/campus-line-art-${k}-colour.webp`))).toBe(true)
    }
  })

  it('樣式不寫色碼，只引用 tokens.css', () => {
    for (const sheet of [css, filmCss]) {
      expect(sheet).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(sheet).not.toMatch(/oklch\(\s*\d/)
      expect(sheet).not.toMatch(/rgba?\(\s*\d/)
    }
  })
})

// 2026-11-11：首屏從 30 秒的開場動畫《手牽手，走到 30》換成 2 分 24 秒的紀念影片《長成自己喜歡的樣子》。
describe('30 週年分頁：紀念影片', () => {
  const pub = (f: string) => resolve(__dirname, '../public', f.slice(1))

  it('舊的開場動畫整個拿掉：元件、第一次繪製前的閘門、影片與海報檔', () => {
    expect(existsSync(resolve(__dirname, '../app/components/AnniversaryIntro.vue'))).toBe(false)
    expect(content).not.toContain('AnniversaryIntro')
    expect(content).not.toContain('重看開場影片')
    expect(read('app/utils/inline-scripts.ts')).not.toContain('export const ANNI_INTRO_GATE_SCRIPT')
    expect(CLIENT_INLINE_SCRIPTS).toHaveLength(2)
    expect(Object.keys(ANNI_MEDIA)).not.toContain('filmDesktop')
    expect(Object.keys(ANNI_MEDIA)).not.toContain('posterDesktop')
  })

  it('片中的六句都是官網已上線的文字，依出現順序，秒數對在鏡頭的第一格', () => {
    // 官網內容裡同一句有的分兩行、有的沒標點：比對時拿掉逗號、句號、換行
    const published = JSON.stringify(siteFixture)
    const plain = (t: string) => t.replace(/\\n|[，。\s]/g, '')
    for (const cue of FILM_CUES) expect(plain(published)).toContain(plain(cue.text))
    expect(FILM_CUES.map((c) => c.frame)).toEqual([0, 1600, 2160, 2560, 2720, 3360])
    expect(FILM_CUES.map((c) => formatClock(cueSeconds(c)))).toEqual(['0:00', '0:53', '1:12', '1:25', '1:30', '1:52'])
    expect(FILM_CUES.at(-1)!.text).toContain(FILM_TITLE)
    expect(FILM_SECONDS * FILM_FPS).toBe(4320)
    expect(durationLabel()).toBe('2 分 24 秒')
    expect(isoDuration()).toBe('PT2M24S')
  })

  it('播到哪一句、哪一句亮：從那一段的第一個鏡頭亮到下一句開始', () => {
    expect(cueIndexAt(-1)).toBe(-1)
    expect(cueIndexAt(Number.NaN)).toBe(-1)
    expect(cueIndexAt(0)).toBe(0)
    expect(cueIndexAt(53.2)).toBe(0)
    expect(cueIndexAt(1600 / 30)).toBe(1)
    expect(cueIndexAt(72)).toBe(2)
    expect(cueIndexAt(90.6)).toBe(3)
    expect(cueIndexAt(90.7)).toBe(4)
    expect(cueIndexAt(143.9)).toBe(5)
  })

  it('影片、預告、封面、縮圖都在 public 裡，檔名帶雜湊；單檔不超過 50 MB', () => {
    const files = [...Object.values(ANNI_FILM.film), ...Object.values(ANNI_FILM.teaser), ...ANNI_FILM.poster.desktop.map((p) => p.src), ...ANNI_FILM.poster.mobile.map((p) => p.src), ...ANNI_FILM.cues]
    for (const f of files) {
      expect(f).toMatch(/^\/assets\/anniversary-film\/[a-z0-9-]+-[0-9a-f]{10}\.(mp4|webp)$/)
      expect(existsSync(pub(f))).toBe(true)
      expect(statSync(pub(f)).size).toBeLessThan(50 * 1024 * 1024)
    }
    expect(ANNI_FILM.cues).toHaveLength(FILM_CUES.length)
    // 預告是輕的：兩支都在 4 MB 以下
    for (const f of Object.values(ANNI_FILM.teaser)) expect(statSync(pub(f)).size).toBeLessThan(4 * 1024 * 1024)
    expect(posterSrcset(ANNI_FILM.poster.desktop)).toMatch(/ 960w, .* 1600w, .* 2304w$/)
  })

  it('正片按了才下載、才出聲；不會一進頁面就自動播', () => {
    const main = film.slice(film.indexOf('ref="video"'), film.indexOf('</video>'))
    expect(main).toContain('preload="none"')
    expect(main).toContain(':controls="started"')
    expect(main).not.toContain('autoplay')
    expect(main).not.toContain('muted')
    // play() 在點擊的同一個工作裡先呼叫（Safari 才放聲音），之後才換畫面
    const start = film.slice(film.indexOf('function start(at = 0) {'), film.indexOf('function seek('))
    expect(start.indexOf('v.play()')).toBeLessThan(start.indexOf('started.value = true'))
    expect(start.indexOf('v.play()')).toBeGreaterThan(-1)
  })

  it('沒有 JS 時封面是連到影片檔的連結；封面圖是首屏最大的那張，先載', () => {
    expect(film).toContain('<a v-if="!started" class="anni-film-cover" :href="ANNI_FILM.film.desktop"')
    expect(film).toContain('@click.prevent="start(0)"')
    expect(film).toMatch(/<img :src="posterDesktop\[1\]\.src"[^>]*fetchpriority="high"/)
  })

  it('直拿的手機播直式那一版，分界和版面同一條；轉向後換檔接著原本的秒數', () => {
    expect(FILM_PORTRAIT).toBe('(max-aspect-ratio: 4/5)')
    expect(film).toContain('<source :src="ANNI_FILM.film.mobile" :media="FILM_PORTRAIT" type="video/mp4">')
    expect(film.indexOf(':src="ANNI_FILM.film.mobile"')).toBeLessThan(film.indexOf('<source :src="ANNI_FILM.film.desktop" type="video/mp4">'))
    expect(filmCss).toContain('@media (max-aspect-ratio: 4/5) {')
    expect(filmCss).toContain('.anni-film-frame { aspect-ratio: 9 / 16; }')
    expect(film).toContain("v.addEventListener('loadedmetadata', () => { v.currentTime = at; if (wasPlaying) v.play().catch(() => {}) }, { once: true })")
  })

  it('無聲預告：偏好減少動態、省流量、2G／3G 不播；等整頁載完才抓；一律靜音', () => {
    expect(film).toContain('if (!mayAutoplay(reduce, connection)) return')
    expect(film).toContain("addEventListener('load', go, { once: true })")
    expect(film).toMatch(/<video\s+v-if="teaserSrc"[^>]*\bmuted\b[^>]*\bloop\b/)
    expect(film).toContain('watch(teaser, (t) => { if (t) { t.muted = true; t.play().catch(() => {}) } })')
  })

  it('關燈只在「正在播而且看得到」時；暫停、播完、Esc、捲出畫面就開燈，捲走時順便暫停', () => {
    expect(film).toContain('const dark = computed(() => playing.value && visible.value)')
    expect(film).toContain('if (!visible.value && playing.value) video.value?.pause()')
    expect(film).toContain("if (e.key === 'Escape' && dark.value && !document.fullscreenElement) video.value?.pause()")
    expect(film).toContain('@pause="onPause" @ended="onPause"')
    // 那層深色不擋點擊；影片與「影片裡的話」只在關燈時浮到上面，開燈時等深色淡完才放回去
    expect(filmCss).toContain('.anni-film-dim { position: fixed; inset: 0; z-index: 60;')
    expect(filmCss).toMatch(/\.anni-film-dim \{[^}]*pointer-events: none;/)
    expect(filmCss).toContain('.anni-film-stage, .anni-film-side { position: relative; z-index: 0; transition: z-index 0s linear var(--film-fade); }')
    expect(filmCss).toContain('.anni-film.is-dark .anni-film-stage, .anni-film.is-dark .anni-film-side { z-index: 61; transition-delay: 0s; }')
  })

  it('封面左下角的字都是白的，壓在夠深的漸層上（金色小字對預告的淺色鏡頭只有 4.0–4.4:1，2026-11-11 量過後改白）', () => {
    expect(filmCss).toContain('.anni-film-shade { position: absolute; inset: 0; background: linear-gradient(to top, rgb(var(--ink) / .92), rgb(var(--ink) / .74) 22%, rgb(var(--ink) / 0) 56%); }')
    expect(filmCss).toContain('.anni-film-cover { position: absolute; inset: 0; display: block; color: rgb(var(--on-dark)); }')
    expect(filmCss).not.toMatch(/\.anni-film-label small \{[^}]*color: var\(--yellow\)/)
  })

  it('影片裡的話：桌機在影片右邊一句一列，平板三欄，手機橫向滑動；句子只在逗號後換行', () => {
    expect(filmCss).toContain('@media (min-width: 1101px) {')
    expect(filmCss).toContain('.anni-film-side { flex: 1 1 0; container-type: inline-size; padding-top: 10px; }')
    expect(filmCss).toContain('.anni-film-cues { display: flex; gap: 12px; margin-inline: -20px; padding: 4px 20px; overflow-x: auto;')
    expect(film).toContain("const clauses = (text: string) => text.split(/(?<=，)/)")
    // 亮著的那一句只捲那一排，不用會連整頁一起捲的 scrollIntoView
    expect(film).toContain('list.scrollTo({ left,')
    expect(film).not.toContain('scrollIntoView')
  })

  it('鋼琴取樣是 CC BY 3.0：出處留在影片下面', () => {
    expect(FILM_CREDIT).toContain('Salamander Grand Piano')
    expect(FILM_CREDIT).toContain('CC BY 3.0')
    expect(film).toContain('<p>{{ FILM_CREDIT }}</p>')
  })

  it('首屏：標題、放映區、這一頁的索引；分享連結帶 #film', () => {
    expect(content).toContain('<AnniversaryFilm />')
    expect(film).toContain('<section id="film"')
    expect(content).toContain("url: `${location.origin}/anniversary#film`")
    for (const id of ['anni-line', 'anni-art', 'anni-draw']) expect(content).toContain(`id="${id}"`)
    expect(read('app/components/AnniversaryCake.vue')).toContain('id="anni-cake"')
    for (const href of ['#anni-line', '#anni-cake', '#anni-art', '#anni-draw']) expect(content).toContain(`href: '${href}'`)
    // 手機的順序：標題 → 影片 → 介紹 → 索引
    expect(css).toContain('grid-template-areas: "title" "film" "copy" "index";')
  })

  it('結構化資料多一個 VideoObject：片長、縮圖、影片檔網址，句子寫進描述', () => {
    const seo = anniversarySeo(siteFixture as unknown as SiteContent, 'https://ivy.example')
    const video = seo.graph.find((n) => n['@type'] === 'VideoObject') as Record<string, unknown>
    expect(video.name).toBe(`常春藤 30 週年紀念影片《${FILM_TITLE}》`)
    expect(video.duration).toBe('PT2M24S')
    expect(video.contentUrl).toBe(`https://ivy.example${ANNI_FILM.film.desktop}`)
    expect(video.thumbnailUrl).toEqual(ANNI_FILM.poster.desktop.map((p) => `https://ivy.example${p.src}`))
    for (const cue of FILM_CUES) expect(video.description).toContain(cue.text)
    expect(seo.description).toContain(`紀念影片《${FILM_TITLE}》`)
  })
})

describe('30 週年分頁：畫板的 30 導引', () => {
  it('和開場影片同一組幾何：3 在左、0 在右，範圍固定', () => {
    const [three, zero] = thirtyStrokes()
    const xs3 = three!.map((p) => p[0]), xs0 = zero!.map((p) => p[0])
    expect(Math.max(...xs3)).toBeLessThan(Math.min(...xs0))
    const all = [...three!, ...zero!]
    expect(Math.min(...all.map((p) => p[0]))).toBeCloseTo(-49.7, 0)
    expect(Math.max(...all.map((p) => p[0]))).toBeCloseTo(56, 0)
    expect(Math.min(...all.map((p) => p[1]))).toBeCloseTo(-41.5, 0)
    expect(Math.max(...all.map((p) => p[1]))).toBeCloseTo(33.5, 0)
  })
})

describe('30 週年分頁：2026-10-13 精修', () => {
  const track = read('app/utils/anniversary/track.ts')
  const content = read('app/components/AnniversaryContent.vue')
  it('年份在線右邊（≤1100px，軌道 120／64px）時紙偶翻到線左邊，左緣夾在視窗內；紙偶走在校園卡片前、計數列底下', () => {
    expect(track).toContain('kidsFlip = railW < 130')
    expect(track).toContain('placeKids(kids, xAt(head), head, kidsFlip, 1, 1, PUPPET_TIP, 4 - railLeft)')
    expect(css).toContain('.anni-rail { z-index: 1; }')
    expect(css).toMatch(/\.anni-mapcard \{ grid-column: 3; grid-row: 1;[^}]*z-index: 2;/)
  })
  it('吹完蠟燭，蠟筆屑不會留在畫布下緣：每一格先清整張畫布', () => {
    expect(read('app/utils/anniversary/cake.ts')).toContain('g.clearRect(0, 0, canvas.width, canvas.height)')
  })
  it('黏頂計數列在膠囊底下（膠囊底緣 70–74px）', () => {
    expect(css).toContain('.anni-mapcard { grid-column: 1 / -1; top: 80px;')
    expect(css).not.toContain('.anni-mapcard { top: 68px; }')
  })
  it('專有名詞、門牌、計數列單位不拆行；燈箱照片照比例、不留奶油色邊', () => {
    expect(css).toContain('.anni-nobr { white-space: nowrap; }')
    expect(css).toContain('.anni-counter-meta > span { white-space: nowrap; }')
    expect(content).toContain("const NOBR = /(常春藤|高雄|三民區|義華路|\\d+ 年)/")
    expect(content).toContain(':style="{ \'--anni-ar\': lightboxRatio }"')
    expect(css).toContain('.anni-lightbox img { justify-self: center; width: min(100%, 70vh * var(--anni-ar, 1));')
  })
  it('燈箱照片延遲載入：燈箱關著時不先下載 1200w 大圖（2026-11-09 稽核）', () => {
    const lightboxMarkup = content.slice(content.indexOf('<dialog ref="lightbox"'), content.indexOf('</dialog>'))
    expect(lightboxMarkup).toContain('loading="lazy"')
  })
  it('「開聲音」和旁邊的按鈕同一款（方角 outline）', () => {
    const toggle = read('app/components/AnniversarySoundToggle.vue')
    expect(toggle).toContain('class="button outline anni-sound"')
    expect(toggle).not.toContain('border-radius: 999px')
  })
})
