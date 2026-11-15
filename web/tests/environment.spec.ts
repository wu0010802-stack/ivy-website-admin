import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { MEAL_BOOK_URL, mealBookLink } from '../app/utils/meal-book'
import { environmentHeroAttrs } from '../app/utils/media-image'
import { environmentSeo, llmsTxt, sitemapXml } from '../app/utils/seo'
import { ENVIRONMENT_HERO_ARCH_IMAGE, ENVIRONMENT_HERO_ASPECT, ENVIRONMENT_HERO_IMAGE, environmentHeroImage, responsiveImage } from '../app/utils/responsive-image'
import { daySegments, dotCount, mapSegments, mapSegmentsNarrow } from '../app/utils/environment-route'
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

describe('常春藤環境頁木頭積木版（2026-10-30 比稿選 D，校園環境與餐點照 A 用圓點串起來＝D2）', () => {
  const component = read('../app/components/EnvironmentContent.vue')
  const template = component.slice(component.indexOf('<template>')).replace(/<!--[\s\S]*?-->/g, '')

  it('這一頁不放預約參觀（2026-09-28 使用者裁定；全站頁首的預約鈕不在這支元件裡）', () => {
    expect(template).not.toMatch(/預約|\/visit/)
    expect(component).toContain('data-cta-entry="environment"')
  })

  it('首屏照片：頁面 <img> 與預載共用 environmentHeroImage()，sizes 依赤陶拱窗（約 4:5）的裁切放大', () => {
    // 2026-11-13 內建照片改載裁好的直幅（747×934，就是 4:5），倍率 1；手機不必為了看得到的 38% 下載整張 1960w 的橫幅
    const { width, height } = (manifest as Record<string, { width: number; height: number }>)[ENVIRONMENT_HERO_ARCH_IMAGE]!
    const factor = Number(Math.max(1, width / height / ENVIRONMENT_HERO_ASPECT).toFixed(2))
    const attrs = environmentHeroImage()
    expect(factor).toBe(1)
    expect(attrs.src).toBe(`/assets/${ENVIRONMENT_HERO_ARCH_IMAGE}.webp`)
    // 直幅是從橫幅裁出來的：高度相同，寬＝高 × 0.8，左緣＝(橫幅寬 − 寬) × 0.7（同首屏的 object-position 70%）
    const wide = (manifest as Record<string, { width: number; height: number }>)[ENVIRONMENT_HERO_IMAGE]!
    expect(height).toBe(wide.height)
    expect(width).toBe(Math.round(wide.height * ENVIRONMENT_HERO_ASPECT))
    expect(component).toContain("pagePhotoStyle('70% 38%', page.heroPhoto)")
    expect(ENVIRONMENT_HERO_ASPECT).toBe(4 / 5)
    // 2026-11-13 起平板（641–900）也是兩欄：照片欄是版心的 44%，寫 42vw 只會高估（641 寬時 256 對 243）
    expect(attrs.sizes).toBe(`(max-width: 640px) calc((100vw - 74px) * ${factor}), (max-width: 900px) calc(42vw * ${factor}), ${Math.round(480 * factor)}px`)
    expect(attrs.srcset).toBeTruthy()
    // 2026-10-12 首屏照片後台可換：<img> 與預載改走 environmentHeroAttrs（沒換照片時 ＝ environmentHeroImage()，見 environment-page-overlay.spec.ts）
    expect(environmentHeroAttrs(site.environmentPage)).toEqual(attrs)
    expect(component).toContain('environmentHeroAttrs(page)')
    expect(read('../app/composables/usePageSeo.ts')).toContain("if (page === 'environment') return environmentHeroAttrs(site.value.environmentPage)")
    // 框：2026-11-04 起一塊赤陶拱（邊 20px，後面錯開 26px 墊芥末拱），桌機照片最寬 (540 − 26) − 2×20；900 以下邊 14px、錯開 13px
    const css = read('../app/assets/css/environment.css')
    expect(css).toContain('.renv-arch{--ar:.8;--t:20px;--off:26px;')
    expect(css).toMatch(/@media \(width<=900px\)\{[^@]*\.renv-arch\{--t:14px;--off:13px\}/)
    expect(component.match(/class="renv-arch-(back|face)[ "]/g)).toHaveLength(2)
    expect(component).not.toContain('renv-rainbow')
  })

  it('首屏 641 以上框站在地上（2026-11-13 起平板也是兩欄）：照片欄是尺寸容器，拱貼右下、底緣和目次切齊、頂最高到大標頂', () => {
    const css = read('../app/assets/css/environment.css')
    expect(css).toMatch(/@media \(width>640px\)\{\n  \.renv-hero-fig\{position:relative;align-self:stretch;container-type:size\}/)
    expect(css).toContain('.renv-arch{position:absolute;right:var(--off);bottom:0;width:auto;height:min(100cqh - clamp(8px,2.8vw,40px) - 8px,(100cqw - var(--off)) / var(--ar))}')
    // 大標頂＝字欄的 padding-top，兩邊要用同一個 clamp
    expect(css).toContain('.renv-hero-txt{grid-area:txt;padding-top:clamp(8px,2.8vw,40px);')
  })

  it('目次積木照 --b 等比例縮放：不超過字欄寬（2026-11-04 前 901–1100 會蓋到首屏照片），也跟著視窗高度收（2026-11-13）', () => {
    const css = read('../app/assets/css/environment.css')
    // 圓、拱、方同寬（＝--b，最大 192px），半圓 1.56 倍（300px）。10-30 定案時是 192／188／180：左欄的圓和方差 12px、兩列間距不一，11-13 統一。
    // 最寬的一列（方 1＋間距 .115＋半圓 1.56）是 2.675 × --b，所以寬度上限是字欄的 37%；高度每矮 100px 縮 30px
    expect(css).toContain('.renv-index{grid-area:toc;align-self:end;container-type:inline-size}')
    expect(css).toContain('.renv-index ul{--b:clamp(120px,min(30svh - 78px,37cqi),192px);')
    expect(css).toContain('.renv-index li:nth-child(1) a{width:var(--b)}')
    expect(css).toMatch(/\.renv-index li:nth-child\(2\) a\{[^}]*width:var\(--b\);/)
    expect(css).toMatch(/\.renv-index li:nth-child\(3\) a\{[^}]*width:var\(--b\)\}/)
    const semi = Number(css.match(/\.renv-index li:nth-child\(4\) a\{[^}]*width:calc\(var\(--b\) \* ([\d.]+)\)/)?.[1])
    expect(semi).toBe(1.56)
    expect((1 + 0.115 + semi) * 37).toBeLessThanOrEqual(100)
    // 841 以上、不到 700px 高：目次排成一列，四塊加間距 4.905 × --b 不超過字欄（641–840 的字欄放不下一列，照舊兩列）
    expect(css).toMatch(/@media \(width>840px\) and \(height<700px\)\{[^@]*\.renv-index ul\{--b:clamp\(72px,20\.3cqi,128px\);grid-template-columns:repeat\(4,auto\);/)
    expect((3 + semi + 3 * 0.115) * 20.3).toBeLessThanOrEqual(100)
    // 手機（640 以下）排成一列、撐滿版心（2026-11-14；原本是兩列的大積木，要捲過一整屏才看到第一章）：
    // 圓、拱、方同寬，半圓 1.4 倍，加三個 8px 的間距＝4.4 × --b ＋ 24px，所以 --b＝(版心 − 24px) ÷ 4.4；放不下小字，只留編號與章名
    expect(css).toMatch(/@media \(width<=640px\)\{[^@]*\.renv-index ul\{--b:calc\(\(100cqi - 24px\) \/ 4\.4\);grid-template-columns:repeat\(4,auto\);justify-content:space-between;gap:8px;/)
    expect(css).toMatch(/@media \(width<=640px\)\{[^@]*\.renv-index li:nth-child\(4\) a\{width:calc\(var\(--b\) \* 1\.4\);/)
    expect(css).toMatch(/@media \(width<=640px\)\{[^@]*\.renv-index-hint\{display:none\}/)
    expect(css).not.toContain('.renv-index li a{width:100% !important}')
    expect(css).toContain('@media (640px<width<=1180px){.renv-hero-grid{grid-template-columns:minmax(0,1fr) minmax(0,46%)}}')
  })

  it('版面分三級：641–900 平板沿用兩欄構圖，640 以下才是手機單欄；小路的窄版判斷用同一個斷點（2026-11-13）', () => {
    const css = read('../app/assets/css/environment.css')
    expect(css).toContain('@media (640px<width<=900px){')
    expect(css).toMatch(/@media \(width<=640px\)\{[^@]*\.renv-hero-grid\{grid-template-columns:minmax\(0,1fr\);grid-template-areas:"txt" "fig" "toc"\}/)
    // 單欄的版心最寬 440px：481–640 不再把手機版面等比例放大
    expect(css).toMatch(/@media \(width<=640px\)\{[^@]*\.renv-wrap\{width:min\(100% - 2\*var\(--renv-gutter\),440px\)\}/)
    // 不用範圍寫法 (width <= 640px)：Safari 16.4 以前不認得（tests/legacy-safari-20261113.spec.ts）
    expect(read('../app/utils/environment-route.ts')).toContain("matchMedia('(max-width: 640px)')")
    // 章節留白取視窗寬、視窗高換算較小的那個（筆電 650–780px 高時不會一屏只剩留白）
    expect(css).toContain('--renv-pad:clamp(68px,min(9vw,15svh),128px);')
    expect(css).toContain('.renv-section{position:relative;padding-block:var(--renv-pad);')
  })

  it('五顆心固定一列（原本 901–1150 寬第五顆會掉到第二列）；第五件照顧的小事不再是半圓＋空平板', () => {
    const css = read('../app/assets/css/environment.css')
    // 不換行的 flex：每顆最寬 82px、欄窄時一起縮，兩端貼齊右欄
    expect(css).toContain('.renv-hearts{display:flex;justify-content:space-between;')
    expect(css).toContain('.renv-hearts li{flex:0 1 82px;min-width:0;')
    expect(css).not.toMatch(/\.renv-hearts\{[^}]*flex-wrap/)
    expect(css).not.toContain('renv-care-ped')
    expect(component).not.toContain('renv-care-ped')
    expect(component).toMatch(/CARE_LOOKS: Look\[\] = \[[\s\S]*\{ shape: 's-sq', ar: 1\.1, color: 'pink'/)
  })

  it('照片被裁進比它瘦的框時，sizes 照「照片比框寬多少」放大（原本只寫框寬，橫幅照片在拱裡 Retina 只拿到 0.67 倍）', () => {
    // 保育主照片是 2.2:1 的橫幅：放進 1:1 的框要畫 2.2 倍寬
    const attrs = pageCoverPhotoAttrs('env-care-teacher', undefined, 1, (f) => `(max-width: 640px) calc(44vw * ${f}), ${Math.round(221 * f)}px`)
    const { width, height } = (manifest as Record<string, { width: number; height: number }>)['env-care-teacher']!
    const factor = Number((width / height).toFixed(2))
    expect(factor).toBeGreaterThan(2)
    expect(attrs.sizes).toBe(`(max-width: 640px) calc(44vw * ${factor}), ${Math.round(221 * factor)}px`)
    // 健康把關的母檔重裁成 4:5（原本 1961×934 的橫幅，手機要為了拱框看得到的 37% 下載 1600w）：倍率接近 1
    const health = (manifest as Record<string, { width: number; height: number }>)['env-care-health']!
    expect(health.width / health.height).toBeCloseTo(0.8, 2)
    expect(component).toContain("{ shape: 's-arch', ar: 0.78, color: 'terra', pos: '50% 50%' }")
    // 照片比框瘦或一樣時倍率是 1，不會縮小
    expect(pageCoverPhotoAttrs('env-care-meal', undefined, 2, (f) => `${f}`).sizes).toBe('1')
    expect(pageCoverPhotoAttrs('env-care-meal', { src: '/m.webp', width: 3000, height: 1000, candidates: [{ src: '/a.webp', width: 800 }, { src: '/b.webp', width: 1600 }], position: null, alt: '' }, 1, (f) => `${f}`).sizes).toBe('3')
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

  it('字型跟全站一致（2026-11-03）：標題與積木上的名稱用 LINE Seed、內文系統字，不再載圓體與芫荽', () => {
    const css = read('../app/assets/css/environment.css')
    expect(component).not.toMatch(/environment-fonts/)
    expect(css).not.toMatch(/Chiron|Iansui|renv-round/)
    expect(css).toMatch(/\.renv\{[^}]*font-family:var\(--font\);/)
    expect(css).toContain('.renv :where(h1,h2,h3,h4){font-family:var(--font-head);')
    // LINE Seed 只用 Bold 700（已預載的那個字重），800 留給首屏「新發現」這類重點字
    expect(css).not.toMatch(/font-weight:\s*(800|900)/)
  })
})

describe('常春藤環境頁圓點小路（utils/environment-route.ts）', () => {
  const component = read('../app/components/EnvironmentContent.vue')
  const frames = [{ x: 300, top: 0, bottom: 400 }, { x: 900, top: 500, bottom: 900 }, { x: 320, top: 1000, bottom: 1300 }]
  const colors = ['var(--renv-mist-side)', 'var(--renv-pink-side)', 'var(--renv-terra-side)']

  it('校園環境（桌機、平板）：每段從這張照片底部接到下一張頂部，從第一張走到最後一張，頭尾不多走（2026-11-13）；每段用要去的那一站的顏色', () => {
    const segs = mapSegments(frames, colors)
    expect(segs).toHaveLength(frames.length - 1)
    expect(segs[0]!.d.startsWith('M300.0 400.0 C')).toBe(true)
    expect(segs[0]!.d.endsWith(' 900.0 500.0')).toBe(true)
    expect(segs[0]!.color).toBe(colors[1])
    expect(segs[1]!.d.startsWith('M900.0 900.0 C')).toBe(true)
    expect(segs[1]!.d.endsWith(' 320.0 1000.0')).toBe(true)
    expect(segs[1]!.color).toBe(colors[2])
    expect(mapSegments([frames[0]!], colors)).toEqual([])
    expect(mapSegments([], [])).toEqual([])
  })

  it('校園環境（手機）：左邊一條直線，從第一站的編號依序走到最後一站', () => {
    const segs = mapSegmentsNarrow([[20, 100], [20, 600], [20, 1100]], colors)
    expect(segs.map((seg) => seg.d)).toEqual(['M20.0 100.0 L20.0 600.0', 'M20.0 600.0 L20.0 1100.0'])
    expect(segs.map((seg) => seg.color)).toEqual(colors.slice(1))
    expect(mapSegmentsNarrow([[20, 100]], colors)).toEqual([])
    expect(mapSegmentsNarrow([], [])).toEqual([])
  })

  it('幼兒餐點：盤子和盤子之間各一小段（從盤緣到盤緣、圓點置中），橫向頭尾各多一小段、直向沒有', () => {
    const stations: [number, number][] = [[100, 50], [300, 50], [500, 50]]
    const wide = daySegments(stations, 'var(--renv-terra)', false, { radius: 40, pad: 10, stub: 30 })
    expect(wide.map((seg) => seg.d)).toEqual(['M20.0 50.0 L50.0 50.0', 'M150.0 50.0 L250.0 50.0', 'M350.0 50.0 L450.0 50.0', 'M550.0 50.0 L580.0 50.0'])
    expect(wide.every((seg) => seg.centered && seg.color === 'var(--renv-terra)')).toBe(true)
    // 頭尾放不下一顆圓點（平板的版心窄）就不畫
    expect(daySegments(stations, 'c', false, { radius: 40, pad: 10, stub: 8 })).toHaveLength(2)
    // 直向：盤子底下還有 7px 的積木側面要讓開；沒有頭尾
    expect(daySegments([[42, 40], [42, 180]], 'c', true, { radius: 40, pad: 7, side: 7 }).map((seg) => seg.d)).toEqual(['M42.0 94.0 L42.0 133.0'])
    // 盤子貼在一起、中間沒有空位就不畫
    expect(daySegments([[42, 40], [42, 130]], 'c', true, { radius: 40, pad: 7, side: 7 })).toEqual([])
    expect(daySegments([], 'c', false)).toEqual([])
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

describe('常春藤環境頁調亮（2026-11-14：使用者「背景配色有點舊舊的」，要諾貝爾、吉的堡那種明亮）', () => {
  const tokens = read('../app/assets/css/tokens.css')
  const css = read('../app/assets/css/environment.css')
  const component = read('../app/components/EnvironmentContent.vue')
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

  it('有底色的三章是內縮的圓角底板，02 校園環境不鋪底色；底板內縮多少、裡面的留白就少多少（版心寬度不變）', () => {
    expect(css).toContain('.renv-care{--renv-bg:var(--ivy-env-tint-pink)}')
    expect(css).toContain('.renv-meals{--renv-bg:var(--ivy-env-tint-mustard)}')
    expect(css).toContain('.renv-tour{--renv-bg:var(--ivy-env-tint-mist)}')
    expect(css).not.toMatch(/\.renv-spaces\{--renv-bg/)
    expect(tokens).not.toMatch(/--ivy-env-tint-sage:/)
    expect(css).toContain('.renv :is(.renv-care,.renv-meals,.renv-tour){--renv-gutter:calc(var(--renv-gutter-page) - var(--renv-inset));margin-inline:var(--renv-inset);border-radius:var(--renv-board-r)}')
    // 手機不內縮（版心只有 358px），只留圓角
    expect(css).toMatch(/@media \(width<=640px\)\{\n  \.renv\{--renv-inset:0px;--renv-board-r:28px\}/)
  })

  it('目次四塊積木的顏色＝那一章的章節色：01 粉、02 綠、03 黃、04 藍', () => {
    expect(component).toContain("const INDEX_LOOKS: [string, Block][] = [['s-circle', 'pink'], ['s-arch', 'sage'], ['s-sq', 'mustard'], ['s-semi', 'mist']]")
  })

  it('章節編號一律深綠底白字；小標籤是平的；照片外緣有一圈極淡的線', () => {
    expect(component.match(/class="renv-dot c-forest" lang="en">\{\{ chapterNo\(/g)).toHaveLength(4)
    expect(css).toContain('.renv-kicker .renv-dot{color:var(--renv-paper)}')
    expect(css).toMatch(/\.renv-tag\{[^}]*box-shadow:none/)
    expect(css).toMatch(/\.renv-campus\{[^}]*box-shadow:none/)
    expect(css).toContain('.renv-frame::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 1px rgb(var(--ink) / .08);pointer-events:none}')
  })

  it('五所校園（藍底板）照片後面的墊塊不用藍，也不和那一校照片框同色', () => {
    expect(component).toContain("const pool = TOUR_COLORS.filter((color) => color !== 'mist' && color !== TOUR_COLORS[t % 5])")
    expect(component).toContain(':class="`c-${tourBack(t, 0)}`"')
    expect(component).toContain('`c-${tourBack(t, s + 1)}`')
  })

  it('兩塊底板相鄰時中間留 24px 的白（手機底板滿版，縫太窄會像破圖）', () => {
    expect(css).toContain('.renv :is(.renv-care,.renv-meals,.renv-tour)+:is(.renv-care,.renv-meals,.renv-tour){margin-top:24px}')
  })

  it('規則裡不寫色彩字面值（顏色只從 tokens.css 來）', () => {
    // rgb(var(--ink) / .08) 這種「token 三元組＋透明度」是 tokens.css 允許的寫法
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\((?!var\(--)|oklch\(|hsla?\(/i)
  })
})
