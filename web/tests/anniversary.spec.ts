import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANNI_MILESTONES, ANNI_YEARS, anniversaryYearIndex, campusCountAt, crayonLineX, milestoneOf, yearAtOffset } from '../app/utils/anniversary/timeline'
import { ANNI_ARTWORKS, mosaicCells } from '../app/utils/anniversary/gallery'
import { ANNI_MEDIA } from '../app/utils/anniversary/media'
import { thirtyStrokes } from '../app/utils/anniversary/crayonPad'

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

  it('沿革文字和 /about 第一章一字不差', () => {
    const about = read('app/components/AboutContent.vue')
    for (const m of ANNI_MILESTONES) expect(about).toContain(m.history)
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
  it('週年版未拍板：不給搜尋引擎收錄、標題照全站格式', () => {
    expect(page).toContain("robots: 'noindex, nofollow'")
    expect(page).toMatch(/常春藤 30 週年｜1997—2027｜/)
    expect(read('app/components/SiteHeader.vue')).toMatch(/PILL_PAGES = \[[^\]]*'\/anniversary'/)
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
