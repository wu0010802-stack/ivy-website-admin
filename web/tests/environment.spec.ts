import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { MEAL_BOOK_URL, mealBookLink } from '../app/utils/meal-book'
import { environmentHeroPreloads, environmentHeroSources } from '../app/utils/media-image'
import { environmentSeo, llmsTxt, sitemapXml } from '../app/utils/seo'
import { ENVIRONMENT_HERO_ARCH_ASPECT, ENVIRONMENT_HERO_ARCH_IMAGE, ENVIRONMENT_HERO_ARCH_MEDIA, ENVIRONMENT_HERO_IMAGE, ENVIRONMENT_HERO_WIDE_ASPECT, ENVIRONMENT_HERO_WIDE_MEDIA, environmentHeroImage, environmentHeroWideImage, responsiveImage } from '../app/utils/responsive-image'
import { pageCoverPhotoAttrs } from '../app/utils/page-content'
import manifest from '../app/generated/image-manifest.json'

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
  const names = [ENVIRONMENT_HERO_IMAGE, ENVIRONMENT_HERO_ARCH_IMAGE, 'env-care-teacher', 'env-care-health', 'env-care-meal', 'env-care-clothes', 'env-care-comfort', 'env-care-clean',
    'env-space-playground', 'env-space-classroom', 'env-space-materials', 'env-space-plaza', 'env-space-corner', 'env-space-restroom', 'env-space-animals', 'env-meal-book']
  it.each(names)('%s 已產生響應式候選檔', (name) => {
    expect(Object.hasOwn(manifest, name)).toBe(true)
    expect(responsiveImage(name).srcset).toBeTruthy()
  })
})

// 2026-11-17「拱窗打開」整頁重寫（DESIGN.md「環境頁拱窗打開」）。這裡留的是改版前就有、新版照舊要守的裁定；
// 新版自己的結構、捲動敘事與版面規則在 tests/environment-windows-20261117.spec.ts。
// 隨改版拿掉的舊測試（規則已被取代）：10-30 木頭積木版的首屏拱框與目次 --b、五顆心一列、圓點小路（utils/environment-route.ts 已刪）、
// 積木由上落下（data-drop）、11-14 的章節底板與目次顏色、11-16 的直立積木分頁。
describe('常春藤環境頁沿用的裁定', () => {
  const component = read('../app/components/EnvironmentContent.vue')
  const template = component.slice(component.indexOf('<template>')).replace(/<!--[\s\S]*?-->/g, '')
  const css = read('../app/assets/css/environment.css')

  it('這一頁不放預約參觀（2026-09-28 使用者裁定；全站頁首的預約鈕不在這支元件裡）', () => {
    expect(template).not.toMatch(/預約|\/visit/)
    expect(component).toContain('data-cta-entry="environment"')
  })

  it('首屏內建照片兩張：901 以上用橫幅母檔、900 以下用從它裁出的直幅（手機不必為了拱窗下載整張橫幅）', () => {
    const info = manifest as Record<string, { width: number; height: number }>
    const arch = info[ENVIRONMENT_HERO_ARCH_IMAGE]!
    const wide = info[ENVIRONMENT_HERO_IMAGE]!
    // 直幅是從橫幅裁出來的：高度相同，寬＝高 × 0.8，左緣＝(橫幅寬 − 寬) × 0.7（同首屏的 object-position 70%）
    expect(arch.height).toBe(wide.height)
    expect(arch.width).toBe(Math.round(wide.height * 0.8))
    expect(component).toContain("pagePhotoStyle('70% 38%', page.heroPhoto)")
    // 兩種框的 sizes：大畫面＝版心扣掉兩邊各 12px 的框（1348 以上固定 1176px），橫幅 2.1:1 比框（最瘦 2.15:1）瘦，倍率 1；
    // 拱窗最瘦約 0.7:1，直幅 0.8:1 照窗高畫滿，倍率 1.14
    expect([ENVIRONMENT_HERO_WIDE_MEDIA, ENVIRONMENT_HERO_ARCH_MEDIA]).toEqual(['(min-width: 901px)', '(max-width: 900px)'])
    expect(wide.width / wide.height).toBeLessThan(ENVIRONMENT_HERO_WIDE_ASPECT)
    expect(environmentHeroWideImage().src).toBe(`/assets/${ENVIRONMENT_HERO_IMAGE}.webp`)
    expect(environmentHeroWideImage().sizes).toBe('(min-width: 1348px) 1176px, (min-width: 901px) calc((89vw - 24px) * 1)')
    expect(environmentHeroImage().src).toBe(`/assets/${ENVIRONMENT_HERO_ARCH_IMAGE}.webp`)
    expect(Number((arch.width / arch.height / ENVIRONMENT_HERO_ARCH_ASPECT).toFixed(2))).toBe(1.14)
    expect(environmentHeroImage().sizes).toBe('(max-width: 500px) calc((100vw - 60px) * 1.14), 502px')
    // 頁面的 <picture> 與預載共用同一份：<source media> 是橫幅、<img> 是直幅；預載兩條各帶 media，只會下載其中一張
    const sources = environmentHeroSources(site.environmentPage)
    expect(sources).toEqual({ img: environmentHeroImage(), wide: environmentHeroWideImage() })
    expect(component).toContain('environmentHeroSources(props.page)')
    expect(template).toMatch(/<source v-if="hero\.wide\.avifSrcset" :media="ENVIRONMENT_HERO_WIDE_MEDIA" type="image\/avif"/)
    expect(template).toMatch(/<img :src="hero\.img\.src"[^>]*loading="eager" fetchpriority="high">/)
    const preloads = environmentHeroPreloads(site.environmentPage)
    expect(preloads.map((link) => [link.href, link.media, link.imagesizes])).toEqual([
      [sources.wide!.src, '(min-width: 901px)', sources.wide!.sizes],
      [sources.img.src, '(max-width: 900px)', sources.img.sizes]
    ])
    expect(preloads.every((link) => link.rel === 'preload' && link.fetchpriority === 'high' && link.type === 'image/avif')).toBe(true)
    expect(read('../app/composables/usePageSeo.ts')).toContain("if (page === 'environment') return environmentHeroPreloads(site.value.environmentPage)")
    // 框的比例寫在 environment.css：大畫面寬÷高 2.15（矮視窗放寬到 2.4）、框邊 12px
    expect(css).toContain('--fh:max(220px,min(calc(var(--renv-cw) / 2.15),calc(var(--renv-sh) - 244px)));')
    expect(css).toContain('--fw:min(var(--renv-cw),calc(var(--fh) * 2.4));')
    expect(css).toContain('.renv-hw-photo{position:absolute;inset:12px;')
  })

  it('照片被裁進比它瘦的框時，sizes 照「照片比框寬多少」放大（只寫框寬，橫幅照片在瘦框裡會挑到太小的檔）', () => {
    // 共用工具 pageCoverPhotoAttrs（特色教學等頁也用）：保育主照片是 2.2:1 以上的橫幅，放進 1:1 的框要畫兩倍多寬
    const attrs = pageCoverPhotoAttrs('env-care-teacher', undefined, 1, (f) => `(max-width: 640px) calc(44vw * ${f}), ${Math.round(221 * f)}px`)
    const { width, height } = (manifest as Record<string, { width: number; height: number }>)['env-care-teacher']!
    const factor = Number((width / height).toFixed(2))
    expect(factor).toBeGreaterThan(2)
    expect(attrs.sizes).toBe(`(max-width: 640px) calc(44vw * ${factor}), ${Math.round(221 * factor)}px`)
    // 照片比框瘦或一樣時倍率是 1，不會縮小
    expect(pageCoverPhotoAttrs('env-care-meal', undefined, 2, (f) => `${f}`).sizes).toBe('1')
    expect(pageCoverPhotoAttrs('env-care-meal', { src: '/m.webp', width: 3000, height: 1000, candidates: [{ src: '/a.webp', width: 800 }, { src: '/b.webp', width: 1600 }], position: null, alt: '' }, 1, (f) => `${f}`).sizes).toBe('3')
    // 健康把關的母檔是裁好的 4:5（2026-11-13），放 4:5 的拱窗、焦點置中
    const health = (manifest as Record<string, { width: number; height: number }>)['env-care-health']!
    expect(health.width / health.height).toBeCloseTo(0.8, 2)
    expect(component).toContain("{ shape: 'sh-arch', color: 'pink', ar: 0.8, w: 279, nar: 0.8, pos: '50% 50%' }")
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
    expect(template).toContain('<p v-if="space.campusLabel" class="renv-stop-campus">{{ space.campusLabel }}</p>')
  })

  it('沒有手繪層、GSAP、蠟筆塗鴉、圓點小路的腳本；也沒有紋理（使用者 10-30：舊版髒、像解析度不夠）', () => {
    expect(component).not.toMatch(/from '(roughjs|gsap)|import\('(roughjs|gsap)|rough-sketch|environment-motion|environment-doodles|environment-route/)
    // 唯一的漸層是一天五餐的圓點小路（一格一顆圓點，桌機橫的、手機直的各一條），不是紋理；其餘規則沒有任何漸層、濾鏡雜訊或外部圖
    expect(css.match(/radial-gradient/g)).toHaveLength(2)
    expect(css.match(/\.renv-day-rail,\.renv-day-rail i\{background:radial-gradient\(circle,currentColor 0 [\d.]+px,transparent [\d.]+px\)/g)).toHaveLength(2)
    expect(css).not.toMatch(/repeating-|linear-gradient|conic-gradient|feTurbulence|url\(/)
    for (const gone of ['../app/utils/rough-sketch.ts', '../app/utils/environment-motion.ts', '../app/utils/environment-doodles.ts', '../app/utils/environment-route.ts']) expect(existsSync(fileURLToPath(new URL(gone, import.meta.url)))).toBe(false)
  })

  it('字型跟全站一致（2026-11-03）：標題與積木上的名稱用 LINE Seed、內文系統字，不再載圓體與芫荽', () => {
    expect(component).not.toMatch(/environment-fonts/)
    expect(css).not.toMatch(/Chiron|Iansui|renv-round/)
    expect(css).toMatch(/\.renv\{[^}]*font-family:var\(--font\);/)
    expect(css).toMatch(/\.renv :where\(h1,h2,h3,h4\)\{[^}]*font-family:var\(--font-head\);font-weight:700;/)
    // LINE Seed 只用 Bold 700（已預載的那個字重），800 留給首頁首屏「新發現」這類重點字
    expect(css).not.toMatch(/font-weight:\s*(800|900)|font:\s*(800|900) /)
  })
})

describe('常春藤環境頁調亮（2026-11-14：使用者「背景配色有點舊舊的」，要諾貝爾、吉的堡那種明亮）', () => {
  const tokens = read('../app/assets/css/tokens.css')
  const css = read('../app/assets/css/environment.css')
  // 環境頁的色票（tokens.css 第 15 節），換算成線性 sRGB
  const palette = Object.fromEntries([...tokens.matchAll(/--ivy-env-([\w-]+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g)].map((m) => {
    const [L, C, H] = [Number(m[2]) / 100, Number(m[3]), (Number(m[4]) * Math.PI) / 180]
    const [a, b] = [C * Math.cos(H), C * Math.sin(H)]
    const [l, s2, s3] = [(L + 0.3963377774 * a + 0.2158037573 * b) ** 3, (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, (L - 0.0894841775 * a - 1.291485548 * b) ** 3]
    const rgb = [4.0767416621 * l - 3.3077115913 * s2 + 0.2309699292 * s3, -1.2684380046 * l + 2.6097574011 * s2 - 0.3413193965 * s3, -0.0041960863 * l - 0.7034186147 * s2 + 1.707614701 * s3]
    return [m[1]!, { L, C, rgb, lum: 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]! }]
  }))
  const contrast = (x: string, y: string) => {
    const [hi, lo] = [palette[x]!.lum, palette[y]!.lum].sort((p, q) => q - p)
    return (hi! + 0.05) / (lo! + 0.05)
  }
  const FACES = ['terra', 'mustard', 'sage', 'mist', 'pink']
  const TINTS = ['tint-pink', 'tint-mustard', 'tint-mist']

  it('每個色值都在 sRGB 色域內（超出色域時各家瀏覽器的裁法不同，同一塊積木會兩種顏色）', () => {
    expect(Object.keys(palette).length).toBeGreaterThanOrEqual(19)
    for (const [name, color] of Object.entries(palette)) {
      for (const channel of color.rgb) expect(channel, name).toBeGreaterThanOrEqual(-0.0005)
      for (const channel of color.rgb) expect(channel, name).toBeLessThanOrEqual(1.0005)
    }
  })

  it('積木是乾淨的高明度色：正面明度 ≥ 75%、彩度 ≥ .08（調亮前是 68–85%、.058–.12 的灰濁色），側面比正面深一階', () => {
    for (const face of FACES) {
      expect(palette[face]!.L, face).toBeGreaterThanOrEqual(0.75)
      expect(palette[face]!.C, face).toBeGreaterThanOrEqual(0.08)
      expect(palette[`${face}-side`]!.L, face).toBeLessThanOrEqual(palette[face]!.L - 0.09)
      // 厚度看得出來：側面對正面至少 1.4:1
      expect(contrast(face, `${face}-side`), face).toBeGreaterThanOrEqual(1.4)
    }
  })

  it('頁面底接近純白、章節底色夠淡：墨綠字在每一種底色與每一塊積木正面上都過 4.5:1', () => {
    expect(palette.paper!.L).toBeGreaterThanOrEqual(0.99)
    for (const tint of TINTS) expect(palette[tint]!.L, tint).toBeGreaterThanOrEqual(0.96)
    for (const bg of ['paper', ...TINTS]) {
      expect(contrast('ink', bg), bg).toBeGreaterThanOrEqual(7)
      expect(contrast('ink-soft', bg), bg).toBeGreaterThanOrEqual(7)
    }
    // 積木上的字（目次、分頁、標籤、編號）一律用 ink，不用 ink-soft
    for (const face of FACES) expect(contrast('ink', face), face).toBeGreaterThanOrEqual(4.5)
    expect(contrast('paper', 'forest')).toBeGreaterThanOrEqual(4.5)
  })

  it('規則裡不寫色彩字面值（顏色只從 tokens.css 來）', () => {
    // rgb(var(--ink) / .08) 這種「token 三元組＋透明度」是 tokens.css 允許的寫法
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\((?!var\(--)|oklch\(|hsla?\(/i)
  })
})
