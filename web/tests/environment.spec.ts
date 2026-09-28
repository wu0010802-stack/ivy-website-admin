import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import { isGeneratedTourScenes, type SiteContent } from '../app/types/site-content'
import { MEAL_BOOK_URL, mealBookLink } from '../app/utils/meal-book'
import { environmentSeo, llmsTxt, sitemapXml } from '../app/utils/seo'
import { ENVIRONMENT_HERO_ASPECT, ENVIRONMENT_HERO_IMAGE, environmentHeroImage, responsiveImage } from '../app/utils/responsive-image'
import { clotheslineY, layoutSpotBoxes, mealArcPoint } from '../app/utils/rough-sketch'
import { ARRIVE, LEAVE, footstepLengths, smoothPath, stepStop, walkAnchors, walkedLength } from '../app/utils/environment-motion'
import manifest from '../app/generated/image-manifest.json'
import fontManifest from '../app/generated/environment-font-manifest.json'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const site = fixture as unknown as SiteContent

describe('營養餐點書：依台北日期開到當月菜單那一頁', () => {
  it('1–6 月在第 10–15 頁，7–12 月在第 17–22 頁（第 16 頁是文章）', () => {
    const page = (month: number) => mealBookLink({ year: 2026, month, day: 15 }).page
    expect([1, 2, 3, 4, 5, 6].map(page)).toEqual([10, 11, 12, 13, 14, 15])
    expect([7, 8, 9, 10, 11, 12].map(page)).toEqual([17, 18, 19, 20, 21, 22])
  })
  it('連結帶頁碼、文字帶月份', () => {
    const link = mealBookLink({ year: 2026, month: 9, day: 25 })
    expect(link).toEqual({ month: 9, page: 19, href: `${MEAL_BOOK_URL}#p=19`, label: '看 9 月菜單' })
  })
  it('月份用台北時間：UTC 9/30 17:00 已是台北 10/1', () => {
    expect(mealBookLink(new Date('2026-09-30T17:00:00Z')).month).toBe(10)
    expect(mealBookLink(new Date('2026-09-30T15:59:00Z')).month).toBe(9)
  })
})

describe('頁首只留真正的分頁（2026-09-25 使用者裁定；2026-09-26 加特色教學、關於常春藤）', () => {
  it('選單只有關於常春藤、特色教學、常春藤環境與入學資訊，首頁錨點拿掉', () => {
    expect(site.siteMeta.primaryNav).toEqual([
      { label: '關於常春藤', labelEn: 'About', href: '/about' },
      { label: '特色教學', labelEn: 'Curriculum', href: '/curriculum' },
      { label: '常春藤環境', labelEn: 'Environment', href: '/environment' },
      { label: '入學資訊', labelEn: 'Admission', href: '/admission' }
    ])
    expect(site.siteMeta.primaryNav.some((item) => item.href.startsWith('/#'))).toBe(false)
  })
  it('頁尾也有常春藤環境入口', () => {
    expect(site.footer.links.some((item) => item.href === '/environment')).toBe(true)
  })
})

describe('常春藤環境頁 SEO', () => {
  it('canonical、麵包屑與 sitemap／llms.txt 都指向 /environment', () => {
    const seo = environmentSeo(site, 'https://ivy.example')
    expect(seo.canonical).toBe('https://ivy.example/environment')
    expect(seo.title).toContain('常春藤環境')
    expect(JSON.stringify(seo.graph)).toContain('"name":"常春藤環境"')
    expect(sitemapXml('https://ivy.example', [])).toContain('<loc>https://ivy.example/environment</loc>')
    expect(llmsTxt('https://ivy.example', { siteMeta: site.siteMeta, campuses: [] })).toContain('(https://ivy.example/environment)')
  })
  it('沒有正式 origin 時不輸出 canonical 與結構化資料', () => {
    const seo = environmentSeo(site, '')
    expect(seo.canonical).toBeUndefined()
    expect(seo.graph).toEqual([])
  })
})

describe('常春藤環境頁圖片', () => {
  const names = [ENVIRONMENT_HERO_IMAGE, 'env-care-teacher', 'env-care-health', 'env-care-meal', 'env-care-clothes', 'env-care-comfort', 'env-care-clean',
    'env-space-playground', 'env-space-classroom', 'env-space-materials', 'env-space-plaza', 'env-space-corner', 'env-space-restroom', 'env-space-animals', 'env-meal-book']
  it.each(names)('%s 已產生響應式候選檔', (name) => {
    expect(Object.hasOwn(manifest, name)).toBe(true)
    expect(responsiveImage(name).srcset).toBeTruthy()
  })
})

describe('常春藤環境頁手繪版（2026-09-28 使用者選定 mock C）', () => {
  const component = read('../app/components/EnvironmentContent.vue')
  const template = component.slice(component.indexOf('<template>')).replace(/<!--[\s\S]*?-->/g, '')

  it('這一頁不放預約參觀（2026-09-28 使用者裁定；全站頁首的預約鈕不在這支元件裡）', () => {
    expect(template).not.toMatch(/預約|\/visit/)
    expect(component).toContain('data-cta-entry="environment"')
  })

  it('首屏照片：頁面 <img> 與預載共用 environmentHeroImage()，sizes 依 3:2 相框的裁切放大', () => {
    const { width, height } = (manifest as Record<string, { width: number; height: number }>)[ENVIRONMENT_HERO_IMAGE]!
    const factor = Number((width / height / ENVIRONMENT_HERO_ASPECT).toFixed(2))
    const attrs = environmentHeroImage()
    expect(attrs.sizes).toBe(`(max-width: 900px) calc((100vw - 40px) * ${factor}), ${Math.round(540 * factor)}px`)
    expect(attrs.srcset).toBeTruthy()
    expect(component).toContain('const hero = environmentHeroImage()')
    expect(read('../app/composables/usePageSeo.ts')).toContain("if (page === 'environment') return environmentHeroImage()")
    expect(read('../app/assets/css/environment.css')).toMatch(/\.renv-hero-photo>img\{aspect-ratio:3\/2;/)
  })

  it('頁首用實底：淺色紙底首屏不能配透明白字頁首', () => {
    const header = read('../app/components/SiteHeader.vue')
    const pills = header.slice(header.indexOf('const PILL_PAGES'), header.indexOf('\n', header.indexOf('const PILL_PAGES')))
    expect(pills).not.toContain("'/environment'")
  })

  it('五所校園讀各校校園探索（fixture 五校都有真正的場景，標註點座標是照片的百分比）', () => {
    const campuses = (fixture as unknown as SiteContent).campuses
    const scenes = campuses.flatMap((campus) => (isGeneratedTourScenes(campus.tourScenes) ? [] : campus.tourScenes))
    expect(campuses.every((campus) => !isGeneratedTourScenes(campus.tourScenes) && campus.tourScenes.length > 0)).toBe(true)
    for (const scene of scenes) for (const spot of scene.spots) {
      expect(spot.x).toBeGreaterThanOrEqual(0)
      expect(spot.x).toBeLessThanOrEqual(100)
      expect(spot.y).toBeGreaterThanOrEqual(0)
      expect(spot.y).toBeLessThanOrEqual(100)
    }
  })

  it('標註便條：點在下半部放上方、太靠上放下方；便條彼此不重疊、不離開照片太遠', () => {
    const image = { x: 0, y: 0, w: 800, h: 500 }
    const [above, below] = layoutSpotBoxes(image, [{ x: 50, y: 70, w: 80, h: 28 }, { x: 50, y: 10, w: 80, h: 28 }])
    expect(above!.y + above!.h).toBeLessThan(0.7 * 500)
    expect(below!.y).toBeGreaterThan(0.1 * 500)
    // 國際校美語商店街：郵局與餐廳同高、左右相鄰
    const boxes = layoutSpotBoxes(image, [{ x: 12, y: 22, w: 60, h: 28 }, { x: 58, y: 32, w: 60, h: 28 }, { x: 92, y: 14, w: 76, h: 28 }, { x: 41, y: 32, w: 60, h: 28 }])
    for (const [i, a] of boxes.entries()) {
      expect(a.x).toBeGreaterThanOrEqual(-10)
      expect(a.x + a.w).toBeLessThanOrEqual(810)
      for (const b of boxes.slice(i + 1)) {
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlap).toBe(false)
      }
    }
  })

  it('太陽弧兩端等高、中午最高；曬衣繩兩端 8px、中間最低', () => {
    const [x0, y0] = mealArcPoint(0, 1200)
    const [x1, y1] = mealArcPoint(1, 1200)
    const [, noon] = mealArcPoint(0.5, 1200)
    expect(x0).toBeLessThan(x1)
    expect(y0).toBe(y1)
    expect(noon).toBeLessThan(y0)
    expect(clotheslineY(0, 1000)).toBe(8)
    expect(clotheslineY(1000, 1000)).toBe(8)
    expect(clotheslineY(500, 1000)).toBeGreaterThan(clotheslineY(250, 1000))
  })

  it('字型：圓體 400／700／800 與芫荽各有 critical 分片，大標那片預載，檔案都在 public', () => {
    const faces = fontManifest.faces as Record<string, { critical: { src: string; characters: number } }>
    const publicFile = (url: string) => fileURLToPath(new URL(`../public${url}`, import.meta.url))
    expect(Object.keys(faces).sort()).toEqual(['hand-400', 'round-400', 'round-700', 'round-800'])
    expect(fontManifest.preload).toEqual([faces['round-800']!.critical.src])
    const inline = read('../app/assets/css/environment-fonts.css')
    for (const [key, face] of Object.entries(faces)) {
      expect(existsSync(publicFile(face.critical.src)), key).toBe(true)
      expect(inline).toContain(`src:url(${face.critical.src})`)
    }
    expect(existsSync(publicFile(fontManifest.stylesheet.src))).toBe(true)
    for (const weight of [400, 700, 800]) expect(inline).toContain(`font-family:'Chiron GoRound TC';font-weight:${weight};`)
    expect(inline).toContain("font-family:'Iansui';font-weight:400;")
  })

  it('一開始畫得到的字都在 critical；隱藏分頁的字在 tour 分片（environment-font-chars.json）', () => {
    const chars = JSON.parse(read('../app/generated/environment-font-chars.json')).groups as Record<string, string>
    const inline = read('../app/assets/css/environment-fonts.css')
    const faces = fontManifest.faces as Record<string, { critical: { characters: number } }>
    const covered = (family: string, weight: string, kind: string) => {
      const rule = inline.split('\n').find((line) => line.includes(`font-family:'${family}';font-weight:${weight};`) && line.includes(`-${kind}-`))
      const ranges = (rule?.match(/unicode-range:([^}]+)/)?.[1] ?? '').split(',').filter(Boolean)
      return (cp: number) => ranges.some((range) => {
        const [a, b = a] = range.replace('U+', '').split('-').map((hex) => parseInt(hex, 16))
        return cp >= a! && cp <= b!
      })
    }
    for (const [key, text] of Object.entries(chars)) {
      const [code, weight, hidden] = key.split('-')
      const family = code === 'round' ? 'Chiron GoRound TC' : 'Iansui'
      expect(faces[`${code}-${weight}`], key).toBeTruthy()
      const inCritical = covered(family, weight!, 'critical')
      const inTour = covered(family, weight!, 'tour')
      for (const char of new Set(text)) {
        const cp = char.codePointAt(0)!
        expect(hidden ? inCritical(cp) || inTour(cp) : inCritical(cp), `${key} ${char}`).toBe(true)
      }
    }
  })
})

describe('常春藤環境頁 GSAP 動態層（2026-09-28 使用者看過 design/environment-gsap-mockup-20260928/ 後同意上線）', () => {
  const component = read('../app/components/EnvironmentContent.vue')
  const motion = read('../app/utils/environment-motion.ts')
  const sketch = read('../app/utils/rough-sketch.ts')

  it('GSAP 只在這頁動態載入：元件與手繪線都沒有靜態 import，動態層本身只 import 型別', () => {
    for (const source of [component, sketch]) expect(source).not.toMatch(/^import [^\n]*from 'gsap/m)
    expect(motion).not.toMatch(/^import (?!type )[^\n]*from 'gsap/m)
    expect(component).toContain("import('gsap')")
    expect(component).toContain("import('gsap/ScrollTrigger')")
    expect(component).toContain("import('gsap/MotionPathPlugin')")
    expect(JSON.parse(read('../package.json')).dependencies.gsap).toBeTruthy()
  })

  it('GSAP 載入失敗就不用動態層，手繪線照畫（小路退回虛線）', () => {
    expect(component).toMatch(/\.catch\(\(\) => null\)/)
    expect(component).toContain('motion: motion ?? undefined')
    expect(sketch).toContain('if (motion?.trail) { motion.trail(el, tools); return }')
  })

  it('小路提示字跟著改成小腳印', () => {
    expect(component).toContain('跟著小腳印，走一圈看看')
    expect(component).not.toContain('跟著虛線')
  })

  it('不在全站註冊通用名稱的 @property（--rot 別的元件也可能用）', () => {
    const css = read('../app/assets/css/environment.css')
    const registered = [...css.matchAll(/@property\s+(--[\w-]+)/g)].map((m) => m[1])
    expect(registered.length).toBeGreaterThan(0)
    for (const name of registered) expect(name).toMatch(/^--renv-/)
  })

  it('路線經過每一個點（Catmull-Rom 每一段的終點就是下一個點）', () => {
    const points: [number, number][] = [[0, -70], [120, 200], [40, 520], [110, 900]]
    const d = smoothPath(points)
    expect(d.startsWith('M0.0,-70.0')).toBe(true)
    const ends = [...d.matchAll(/C[^C]* (-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
    expect(ends).toEqual(points.slice(1))
  })

  describe('捲動 → 走到小路的第幾 px', () => {
    const vh = 900
    const top = 3000
    const stops = [{ cy: 300, length: 350 }, { cy: 800, length: 900 }]
    const anchors = walkAnchors({ top, height: 1400, vh, stops, total: 1500 })
    const yAt = (cy: number, line: number) => top + cy - vh * line

    it('錨點 y 一定遞增', () => {
      for (let i = 1; i < anchors.length; i++) expect(anchors[i]!.y).toBeGreaterThan(anchors[i - 1]!.y)
    })
    it('小路頂端還沒捲到視窗 80% 前不出發；底端捲過視窗一半就走完', () => {
      expect(walkedLength(anchors, top - vh)).toBe(0)
      expect(walkedLength(anchors, top + 1400)).toBe(1500)
    })
    it('號碼捲到視窗 ARRIVE 時剛好走到那一站，一直停到 LEAVE 才離開', () => {
      expect(ARRIVE).toBeGreaterThan(LEAVE)
      expect(walkedLength(anchors, yAt(300, ARRIVE))).toBeCloseTo(350)
      expect(walkedLength(anchors, (yAt(300, ARRIVE) + yAt(300, LEAVE)) / 2)).toBeCloseTo(350)
      expect(walkedLength(anchors, yAt(300, LEAVE))).toBeCloseTo(350)
      expect(walkedLength(anchors, yAt(800, ARRIVE))).toBeCloseTo(900)
    })
    it('兩站之間線性內插', () => {
      const mid = (yAt(300, LEAVE) + yAt(800, ARRIVE)) / 2
      expect(walkedLength(anchors, mid)).toBeCloseTo((350 + 900) / 2)
    })
    it('兩站靠太近時錨點仍遞增、不會除以零', () => {
      const tight = walkAnchors({ top, height: 400, vh, stops: [{ cy: 100, length: 100 }, { cy: 110, length: 130 }], total: 300 })
      for (let i = 1; i < tight.length; i++) expect(tight[i]!.y).toBeGreaterThan(tight[i - 1]!.y)
      expect(Number.isFinite(walkedLength(tight, top))).toBe(true)
    })
  })

  it('腳印左右輪流、固定步距，站點前後 gap 內不踩', () => {
    const steps = footstepLengths(1000, 40, [300, 700], 40)
    steps.forEach((step, i) => { if (i) expect(step.left).toBe(!steps[i - 1]!.left) })
    for (const { length } of steps) for (const stop of [300, 700]) expect(Math.abs(length - stop)).toBeGreaterThanOrEqual(40)
    expect(steps[0]!.length).toBe(24)
    expect(steps.every(({ length }) => (length - 24) % 40 === 0)).toBe(true)
  })

  it('腳印顏色跟著下一站：還沒走到的第一站，最後一站之後沿用最後一站', () => {
    const stops = [300, 700, 1100]
    expect(stepStop(10, stops)).toBe(0)
    expect(stepStop(300, stops)).toBe(0)
    expect(stepStop(301.5, stops)).toBe(1)
    expect(stepStop(1000, stops)).toBe(2)
    expect(stepStop(1400, stops)).toBe(2)
  })
})
