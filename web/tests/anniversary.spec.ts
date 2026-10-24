import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANNI_MILESTONES, ANNI_YEARS, anniversaryYearIndex, campusCountAt, crayonLineX, milestoneOf, yearAtOffset } from '../app/utils/anniversary/timeline'
import { ANNI_ARTWORKS, mosaicCells } from '../app/utils/anniversary/gallery'
import { ANNI_MEDIA } from '../app/utils/anniversary/media'
import { thirtyStrokes } from '../app/utils/anniversary/crayonPad'
import { anniversaryEnabled, anniversarySeo, isAnniversaryHref, llmsTxt, sitemapXml } from '../app/utils/seo'
import { applyContentOverlay } from '../app/utils/content-overlay'
import siteFixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')
const page = read('app/pages/anniversary.vue')
const content = read('app/components/AnniversaryContent.vue')
const intro = read('app/components/AnniversaryIntro.vue')
const css = read('app/assets/css/anniversary.css')

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
    const all = [content, intro, read('app/utils/anniversary/timeline.ts'), read('app/utils/anniversary/gallery.ts')].join('\n')
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

describe('30 週年分頁：開場影片與素材', () => {
  it('2026-10-04 起是正式分頁：走全站 SEO、進主選單、頁尾、sitemap 與 llms.txt', () => {
    const site = siteFixture as unknown as SiteContent
    expect(page).toContain("usePageSeo(computed(() => data.value?.content), 'anniversary')")
    expect(page).not.toContain('noindex')
    const seo = anniversarySeo(site, 'https://ivy.example')
    expect(seo.title).toBe(`常春藤 30 週年｜1997—2027｜${site.siteMeta.brandName}`)
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

  it('開場只在第一次、沒有偏好減少動態、網址沒有錨點時自動播放，而且一律先靜音', () => {
    expect(intro).toContain('prefers-reduced-motion: reduce')
    expect(intro).toContain('location.hash')
    expect(intro).toContain('sessionStorage.getItem')
    expect(intro).toMatch(/v\.muted = true/)
    expect(intro).toContain('略過開場')
    expect(intro).toContain('開聲音')
  })

  it('海報那一格（29.0 秒，影片 29.35 秒才開始淡出）就飛進首屏相框', () => {
    expect(intro).toContain('const LEAVE_AT = 29.0')
    expect(content).toContain('ref="printImg"')
    expect(css).toContain('--anni-print-tilt')
  })

  it('影片、海報、素材場都在 public 裡，檔名帶雜湊', () => {
    const files = [ANNI_MEDIA.filmDesktop, ANNI_MEDIA.filmMobile, ANNI_MEDIA.posterDesktop, ANNI_MEDIA.posterMobile, ANNI_MEDIA.firstDesktop, ANNI_MEDIA.firstMobile,
      ANNI_MEDIA.crestFields, ANNI_MEDIA.kidsBody, ANNI_MEDIA.kidsBorder, ANNI_MEDIA.paper, ...Object.values(ANNI_MEDIA.fields)]
    for (const f of files) {
      expect(f).toMatch(/^\/assets\/anniversary\/[a-z-]+-[0-9a-f]{10}\.(mp4|webp)$/)
      expect(existsSync(resolve(__dirname, '../public', f.slice(1)))).toBe(true)
    }
    for (const k of ANNI_MILESTONES.map((m) => m.key)) {
      expect(Object.keys(ANNI_MEDIA.fields)).toContain(k)
      expect(existsSync(resolve(__dirname, `../public/assets/campus-line-art-${k}.webp`))).toBe(true)
      expect(existsSync(resolve(__dirname, `../public/assets/campus-line-art-${k}-colour.webp`))).toBe(true)
    }
  })

  it('樣式不寫色碼，只引用 tokens.css', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/oklch\(\s*\d/)
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
  it('「開聲音」和旁邊的按鈕同一款（方角 outline）', () => {
    const toggle = read('app/components/AnniversarySoundToggle.vue')
    expect(toggle).toContain('class="button outline anni-sound"')
    expect(toggle).not.toContain('border-radius: 999px')
  })
})
