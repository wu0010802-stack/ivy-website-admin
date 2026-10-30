import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { MEAL_BOOK_URL, mealBookLink } from '../app/utils/meal-book'
import { environmentHeroAttrs } from '../app/utils/media-image'
import { environmentSeo, llmsTxt, sitemapXml } from '../app/utils/seo'
import { ENVIRONMENT_HERO_ASPECT, ENVIRONMENT_HERO_IMAGE, environmentHeroImage, responsiveImage } from '../app/utils/responsive-image'
import { daySegments, dotCount, mapSegments, mapSegmentsNarrow } from '../app/utils/environment-route'
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

describe('頁首只留真正的分頁（2026-09-25 使用者裁定；2026-09-26 加特色教學、關於常春藤；2026-10-04 加 30 週年）', () => {
  it('選單是關於常春藤、特色教學、常春藤環境、入學資訊與 30 週年，首頁錨點拿掉', () => {
    expect(site.siteMeta.primaryNav).toEqual([
      { label: '關於常春藤', labelEn: 'About', href: '/about' },
      { label: '特色教學', labelEn: 'Curriculum', href: '/curriculum' },
      { label: '常春藤環境', labelEn: 'Environment', href: '/environment' },
      { label: '入學資訊', labelEn: 'Admission', href: '/admission' },
      { label: '30 週年', labelEn: 'Anniversary', href: '/anniversary' }
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
    expect(sitemapXml('https://ivy.example')).toContain('<loc>https://ivy.example/environment</loc>')
    expect(llmsTxt('https://ivy.example', { siteMeta: site.siteMeta })).toContain('(https://ivy.example/environment)')
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

describe('常春藤環境頁木頭積木版（2026-10-30 比稿選 D，校園環境與餐點照 A 用圓點串起來＝D2）', () => {
  const component = read('../app/components/EnvironmentContent.vue')
  const template = component.slice(component.indexOf('<template>')).replace(/<!--[\s\S]*?-->/g, '')

  it('這一頁不放預約參觀（2026-09-28 使用者裁定；全站頁首的預約鈕不在這支元件裡）', () => {
    expect(template).not.toMatch(/預約|\/visit/)
    expect(component).toContain('data-cta-entry="environment"')
  })

  it('首屏照片：頁面 <img> 與預載共用 environmentHeroImage()，sizes 依彩虹最內圈拱框（約 3:4）的裁切放大', () => {
    const { width, height } = (manifest as Record<string, { width: number; height: number }>)[ENVIRONMENT_HERO_IMAGE]!
    const factor = Number((width / height / ENVIRONMENT_HERO_ASPECT).toFixed(2))
    const attrs = environmentHeroImage()
    expect(ENVIRONMENT_HERO_ASPECT).toBe(3 / 4)
    expect(attrs.sizes).toBe(`(max-width: 900px) calc((100vw - 140px) * ${factor}), ${Math.round(320 * factor)}px`)
    expect(attrs.srcset).toBeTruthy()
    // 2026-10-12 首屏照片後台可換：<img> 與預載改走 environmentHeroAttrs（沒換照片時 ＝ environmentHeroImage()，見 environment-page-overlay.spec.ts）
    expect(environmentHeroAttrs(site.environmentPage)).toEqual(attrs)
    expect(component).toContain('environmentHeroAttrs(page)')
    expect(read('../app/composables/usePageSeo.ts')).toContain("if (page === 'environment') return environmentHeroAttrs(site.value.environmentPage)")
    // 框寬：桌機彩虹 540px、五道拱各 17＋5px；900 以下彩虹滿版、每道 11＋3px
    const css = read('../app/assets/css/environment.css')
    expect(css).toContain('.renv-rainbow{--t:17px;--g:5px;width:100%;max-width:540px;')
    expect(css).toContain('.renv-rainbow{--t:11px;--g:3px;')
    expect(component.match(/class="renv-rb c-/g)).toHaveLength(5)
  })

  it('頁首用實底：淺色紙底首屏不能配透明白字頁首', () => {
    const header = read('../app/components/SiteHeader.vue')
    const pills = header.slice(header.indexOf('const PILL_PAGES'), header.indexOf('\n', header.indexOf('const PILL_PAGES')))
    expect(pills).not.toContain("'/environment'")
  })

  it('五所校園讀各校校園探索（fixture 五校都有真正的場景，標註點座標是照片的百分比）', () => {
    const campuses = (fixture as unknown as SiteContent).campuses
    const scenes = campuses.flatMap((campus) => campus.tourScenes)
    expect(campuses.every((campus) => campus.tourScenes.length > 0)).toBe(true)
    for (const scene of scenes) for (const spot of scene.spots) {
      expect(spot.x).toBeGreaterThanOrEqual(0)
      expect(spot.x).toBeLessThanOrEqual(100)
      expect(spot.y).toBeGreaterThanOrEqual(0)
      expect(spot.y).toBeLessThanOrEqual(100)
    }
  })

  it('照片不放說明與註解（使用者 10-30）：沒有圖說、便條、小路與選校提示、校園探索說明句；戶外廣場的校別標示照留', () => {
    for (const field of ['heroCaption', 'careCaption', 'carePhotoNote', 'feature.note', 'space.note', 'trailHint', 'tourHint', 'scene.intro']) expect(template).not.toContain(field)
    expect(template).not.toContain('<figcaption')
    expect(template).toContain('space.campusLabel')
  })

  it('沒有手繪層、GSAP、蠟筆塗鴉；也沒有紋理（使用者 10-30：舊版髒、像解析度不夠）', () => {
    expect(component).not.toMatch(/from '(roughjs|gsap)|import\('(roughjs|gsap)|rough-sketch|environment-motion|environment-doodles/)
    const css = read('../app/assets/css/environment.css')
    expect(css).not.toMatch(/repeating-|radial-gradient|feTurbulence|url\(/)
    for (const gone of ['../app/utils/rough-sketch.ts', '../app/utils/environment-motion.ts', '../app/utils/environment-doodles.ts']) expect(existsSync(fileURLToPath(new URL(gone, import.meta.url)))).toBe(false)
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

describe('常春藤環境頁圓點小路（utils/environment-route.ts）', () => {
  const component = read('../app/components/EnvironmentContent.vue')
  const frames = [{ x: 300, top: 0, bottom: 400 }, { x: 900, top: 500, bottom: 900 }, { x: 320, top: 1000, bottom: 1300 }]
  const colors = ['var(--renv-mist-side)', 'var(--renv-pink-side)', 'var(--renv-terra-side)']

  it('校園環境（桌機）：從第一張上方進來，每段從這張照片底部接到下一張頂部，最後再走出去；每段用要去的那一站的顏色', () => {
    const segs = mapSegments(frames, colors)
    expect(segs).toHaveLength(frames.length + 1)
    expect(segs[0]).toEqual({ d: 'M300.0 -130.0 L300.0 0.0', color: colors[0] })
    expect(segs[1]!.d.startsWith('M300.0 400.0 C')).toBe(true)
    expect(segs[1]!.d.endsWith(' 900.0 500.0')).toBe(true)
    expect(segs[1]!.color).toBe(colors[1])
    expect(segs[2]!.d.endsWith(' 320.0 1000.0')).toBe(true)
    expect(segs[2]!.color).toBe(colors[2])
    expect(segs[3]).toEqual({ d: 'M320.0 1300.0 L320.0 1380.0', color: colors[2] })
    expect(mapSegments([], [])).toEqual([])
  })

  it('校園環境（手機）：左邊一條直線依序經過每一站的編號', () => {
    const segs = mapSegmentsNarrow([[20, 100], [20, 600], [20, 1100]], colors)
    expect(segs.map((seg) => seg.d)).toEqual(['M20.0 10.0 L20.0 100.0', 'M20.0 100.0 L20.0 600.0', 'M20.0 600.0 L20.0 1100.0', 'M20.0 1100.0 L20.0 1210.0'])
    expect(segs.map((seg) => seg.color)).toEqual([...colors, colors[2]])
  })

  it('幼兒餐點：直線串起每個時間站，桌機左右、手機上下各多走一段', () => {
    const stations: [number, number][] = [[100, 50], [300, 50], [500, 50]]
    expect(daySegments(stations, 'var(--renv-terra)', false)).toEqual([{ d: 'M-10.0 50.0 L100.0 50.0 L300.0 50.0 L500.0 50.0 L610.0 50.0', color: 'var(--renv-terra)' }])
    expect(daySegments([[42, 40], [42, 200]], 'c', true)[0]!.d).toBe('M42.0 -4.0 L42.0 40.0 L42.0 200.0 L42.0 244.0')
  })

  it('等距撒點，至少一顆', () => {
    expect(dotCount(180, 18)).toBe(10)
    expect(dotCount(5, 18)).toBe(1)
  })

  it('小路掛在 <ol> 外面（<ol> 只放 <li>），只在瀏覽器動態載入、載入失敗就沒有圓點；預覽換內容後重算', () => {
    expect(component).toMatch(/<div class="renv-stops">\s*<svg class="renv-route" data-route="map"[^>]*\/>\s*<ol class="renv-stop-list">/)
    expect(component).toMatch(/<div class="renv-day-track">\s*<svg class="renv-route" data-route="day"[^>]*\/>\s*<ol class="renv-day-list">/)
    expect(component).not.toMatch(/^import (?!type )[^\n]*environment-route/m)
    expect(component).toContain("import('~/utils/environment-route').catch(() => null)")
    expect(component).toContain('routes?.refresh()')
  })

  it('積木落下只套在一開始不在視窗裡的元素（首屏與 LCP 照片不能先藏起來），減少動態時不做', () => {
    expect(component).toContain('el.getBoundingClientRect().top >= fold')
    expect(component).toContain("if (!reducedMotion && 'IntersectionObserver' in window) drop = createDrop(root.value)")
    const css = read('../app/assets/css/environment.css')
    expect(css).toContain('.renv [data-drop].is-waiting{opacity:0;transform:translateY(-46px)}')
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\n  \.renv \[data-drop\]\.is-waiting\{opacity:1;transform:none\}/)
  })
})
