// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import manifest from '../app/generated/image-manifest.json'
import ResponsivePicture from '../app/components/ResponsivePicture.vue'
import ScopedHost from './fixtures/scoped-picture-host.vue'
import { aboutHeroAttrs, curriculumHeroAttrs, heroImageAttrs, mediaImageAttrs, pickImage, type MediaImage } from '../app/utils/media-image'
import { ABOUT_HERO_SIZES, admissionHeroImage, environmentHeroImage, heroPreloadLink, responsiveImage } from '../app/utils/responsive-image'
import { responsiveTourImage } from '../app/utils/tour-image'
import { prefetchImage } from '../app/utils/avif-support'

// 2026-11-05：內建照片另產同寬 AVIF，前台用 <picture><source type="image/avif"> 提供、WebP 當退路。
// 這裡守：helper 的 avifSrcset、manifest 與檔案、<ResponsivePicture> 的輸出、首屏預載，以及不能讓 avifSrcset 漏成 <img> 屬性。
const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')
type Candidate = { src: string, width: number, avif?: string }
const images = manifest as Record<string, { width: number, height: number, candidates: Candidate[] }>
const withAvif = Object.entries(images).filter(([, info]) => info.candidates.some((candidate) => candidate.avif))
const widthsOf = (srcset: string) => srcset.split(', ').map((entry) => entry.split(' ').at(-1))

const render = (props: Record<string, unknown>, component: Component = ResponsivePicture) => renderToString(createSSRApp({ render: () => h(component, props) }))

describe('responsiveImage() 的 avifSrcset', () => {
  it('每個寬度都有 AVIF：avifSrcset 全是 .avif，寬度級距與 srcset 完全相同', () => {
    const attrs = responsiveImage('about-curious', '100vw')
    expect(attrs.avifSrcset).toBeDefined()
    expect(attrs.avifSrcset!.split(', ').every((entry) => entry.split(' ')[0]!.endsWith('.avif'))).toBe(true)
    expect(widthsOf(attrs.avifSrcset!)).toEqual(widthsOf(attrs.srcset!))
    expect(attrs.src).toBe('/assets/about-curious.webp')
  })

  it('部分寬度沒有 AVIF（沒省到一成）：那個寬度沿用 WebP 網址，級距不變', () => {
    const attrs = responsiveImage('day-discover')
    const webp = attrs.srcset!.split(', ')
    const avif = attrs.avifSrcset!.split(', ')
    expect(avif).toHaveLength(webp.length)
    const missing = images['day-discover']!.candidates.filter((candidate) => !candidate.avif)
    expect(missing.length).toBeGreaterThan(0)
    for (const candidate of missing) expect(avif).toContain(`${candidate.src} ${candidate.width}w`)
    expect(widthsOf(attrs.avifSrcset!)).toEqual(widthsOf(attrs.srcset!))
  })

  it('整張圖都沒有 AVIF（線稿、去背）或找不到素材：不放 avifSrcset 這個鍵', () => {
    for (const name of ['campus-line-art-yihua-ink', 'campus-line-art-yihua-wash', 'not-a-real-image', '__proto__']) {
      expect('avifSrcset' in responsiveImage(name), name).toBe(false)
    }
  })

  it('所有有 AVIF 的圖：兩組 srcset 寬度級距一致、sizes 同一份', () => {
    for (const [name] of withAvif) {
      const attrs = responsiveImage(name, '(max-width: 600px) 50vw, 300px')
      expect(widthsOf(attrs.avifSrcset!), name).toEqual(widthsOf(attrs.srcset!))
      expect(attrs.sizes).toBe('(max-width: 600px) 50vw, 300px')
    }
  })

  it('包裝函式把 avifSrcset 一路帶出來；後台素材與放大檢視沒有', () => {
    expect(pickImage('about-curious', undefined, '100vw').avifSrcset).toBe(responsiveImage('about-curious', '100vw').avifSrcset)
    expect(responsiveTourImage('about-curious', '100vw').avifSrcset).toBeDefined()
    expect(admissionHeroImage().avifSrcset).toBeDefined()
    expect(environmentHeroImage().avifSrcset).toBeDefined()
    // 放大檢視回原圖：srcset 與 avifSrcset 一起拿掉，不然 <source> 沒有 sizes 會挑小圖
    const full = responsiveTourImage('about-curious', '100vw', true)
    expect(full.srcset).toBeUndefined()
    expect('avifSrcset' in full).toBe(false)
    const media: MediaImage = {
      src: '/api/website/v1/public/media/x/file', width: 1600, height: 900, position: null, alt: '',
      candidates: [{ src: '/api/website/v1/public/media/x/variants/medium', width: 800 }, { src: '/api/website/v1/public/media/x/file', width: 1600 }]
    }
    expect(mediaImageAttrs(media, '100vw').srcset).toContain('800w')
    expect('avifSrcset' in mediaImageAttrs(media, '100vw')).toBe(false)
    expect('avifSrcset' in pickImage('about-curious', media, '100vw')).toBe(false)
  })
})

describe('manifest 與 AVIF 檔', () => {
  it('每個 avif 檔都在、比同寬 WebP 小一成以上', () => {
    expect(withAvif.length).toBeGreaterThan(50)
    for (const [name, info] of withAvif) {
      for (const candidate of info.candidates) {
        if (!candidate.avif) continue
        const avif = resolve(here, `../public${candidate.avif}`)
        const webp = resolve(here, `../public${candidate.src}`)
        expect(existsSync(avif), `${name} ${candidate.avif}`).toBe(true)
        expect(candidate.avif.endsWith('.avif')).toBe(true)
        expect(statSync(avif).size, `${name} ${candidate.width}w`).toBeLessThanOrEqual(statSync(webp).size * 0.9)
      }
    }
  })

  it('public/assets/responsive 裡的 .avif 都被 manifest 引用（沒有孤兒檔）', () => {
    const used = new Set(withAvif.flatMap(([, info]) => info.candidates.flatMap((candidate) => (candidate.avif ? [candidate.avif.replace('/assets/responsive/', '')] : []))))
    const onDisk = readdirSync(resolve(here, '../public/assets/responsive')).filter((file) => file.endsWith('.avif'))
    expect(onDisk.filter((file) => !used.has(file))).toEqual([])
  })

  it('只出現在 RGB 照片：線稿（含 -ink／-wash／-colour）、劇院布幕與投影插畫沒有，帶 alpha 的 WebP 也沒有', () => {
    const hasAlpha = (file: string) => {
      const bytes = readFileSync(file)
      return bytes.toString('latin1', 12, 16) === 'VP8X' && (bytes[20]! & 0x10) !== 0
    }
    for (const [name, info] of Object.entries(images)) {
      const isAvif = info.candidates.some((candidate) => candidate.avif)
      if (/^(campus-line-art|entrance-poster|ivy-30th-anniversary-projection)/.test(name) || /-(ink|wash)$/.test(name)) expect(isAvif, name).toBe(false)
      if (isAvif) for (const candidate of info.candidates) expect(hasAlpha(resolve(here, `../public${candidate.src}`)), `${name} ${candidate.src}`).toBe(false)
    }
  })
})

describe('<ResponsivePicture>', () => {
  const photo = () => ({ ...responsiveImage('about-curious', '(max-width: 600px) 90vw, 400px'), class: 'photo', alt: '孩子', loading: 'lazy', fetchpriority: 'high', decoding: 'async', style: { objectPosition: '10% 20%' } })

  it('有 avifSrcset：<picture> 裡先 <source type="image/avif">（同一份 sizes）、再 <img>（WebP）', async () => {
    const html = await render(photo())
    expect(html.startsWith('<picture class="responsive-picture"><source type="image/avif" srcset="')).toBe(true)
    expect(html).toContain(`srcset="${responsiveImage('about-curious', '(max-width: 600px) 90vw, 400px').avifSrcset}" sizes="(max-width: 600px) 90vw, 400px"><img `)
    expect(html.endsWith('></picture>')).toBe(true)
    expect(html.indexOf('<source')).toBeLessThan(html.indexOf('<img'))
  })

  it('其他屬性原封不動轉給 <img>；avifSrcset 不會變成 img 的屬性，<picture>／<source> 也不吃 class、alt', async () => {
    const html = await render(photo())
    const img = html.match(/<img [^>]*>/)![0]
    for (const part of ['src="/assets/about-curious.webp"', 'width="1600"', 'height="1200"', 'alt="孩子"', 'loading="lazy"', 'fetchpriority="high"', 'decoding="async"', 'class="photo"', 'style="object-position:10% 20%;"']) expect(img).toContain(part)
    expect(img).toContain('srcset="/assets/responsive/about-curious-bef30fd859ff-480.webp 480w')
    expect(html.toLowerCase()).not.toContain('avifsrcset')
    expect(html.match(/<picture[^>]*>/)![0]).toBe('<picture class="responsive-picture">')
    expect(html.match(/<source[^>]*>/)![0]).not.toMatch(/alt=|class=|loading=/)
  })

  it('沒有 avifSrcset（線稿、後台素材、純 src）：DOM 和原本的 <img> 一模一樣', async () => {
    const attrs = { ...responsiveImage('campus-line-art-yihua-ink', '60px'), alt: '', loading: 'lazy', decoding: 'async' }
    const html = await render(attrs)
    expect(html.startsWith('<img ')).toBe(true)
    expect(html).not.toContain('picture')
    expect(html).not.toContain('<source')
    expect(html.toLowerCase()).not.toContain('avifsrcset')
    expect(await render({ src: '/api/website/v1/public/media/x/file', alt: 'x' })).toBe('<img src="/api/website/v1/public/media/x/file" alt="x">')
  })

  it('avifSrcset 是 undefined（例如延後載入的封面還沒輪到）：不輸出 <picture>', async () => {
    const attrs = photo()
    const html = await render({ ...attrs, avifSrcset: undefined })
    expect(html.startsWith('<img ')).toBe(true)
    expect(html).not.toContain('<source')
  })

  it('呼叫端是 <style scoped>：<picture> 和 <img> 都帶 data-v-*（不然 scoped 的 .photo[data-v-*] 對不上 img）', async () => {
    const scopeId = (ScopedHost as { __scopeId?: string }).__scopeId
    expect(scopeId).toMatch(/^data-v-/)
    const withAvif = await render({ avifSrcset: '/a-480.avif 480w, /a.avif 800w' }, ScopedHost)
    expect(withAvif.match(/<picture[^>]*>/)![0]).toContain(scopeId!)
    expect(withAvif.match(/<img[^>]*>/)![0]).toContain(scopeId!)
    expect(withAvif.match(/<source[^>]*>/)![0]).toContain('srcset="/a-480.avif 480w, /a.avif 800w" sizes="100vw"')
    const plain = await render({}, ScopedHost)
    expect(plain.match(/<img[^>]*>/)![0]).toContain(scopeId!)
    expect(plain).not.toContain('picture')
  })

  it('全站 CSS：<picture class="responsive-picture"> 一律 display: contents（<img> 照舊是原父元素的版面子項）', () => {
    expect(read('../app/assets/css/styles.css')).toContain('picture.responsive-picture{display:contents}')
  })

  it('全站 CSS：<source> 不產生版面方塊（picture 是 contents 時，空的 source 會在 grid／flex 父元素佔一格，把 <img> 擠到下一格）', () => {
    expect(read('../app/assets/css/styles.css')).toContain('picture.responsive-picture>source{display:none}')
  })
})

describe('首屏預載', () => {
  it('hero 有 AVIF：預載 avifSrcset、type=image/avif，href／imagesizes／fetchpriority 照舊', () => {
    const hero = responsiveImage('about-hero', ABOUT_HERO_SIZES)
    const link = heroPreloadLink(hero)
    expect(link).toMatchObject({ rel: 'preload', as: 'image', href: '/assets/about-hero.webp', imagesizes: hero.sizes, fetchpriority: 'high', type: 'image/avif' })
    expect(link.imagesrcset).toBe(hero.avifSrcset)
    expect(link.imagesrcset).toContain('.avif ')
  })

  it('hero 沒有 AVIF（後台素材、線稿）：維持原本的 WebP 預載，不標 type', () => {
    const media = mediaImageAttrs({ src: '/m/file', candidates: [{ src: '/m/v', width: 800 }, { src: '/m/file', width: 1600 }], position: null, alt: '' }, '100vw')
    const link = heroPreloadLink(media)
    expect(link.imagesrcset).toBe(media.srcset)
    expect('type' in link).toBe(false)
    expect(link).toMatchObject({ rel: 'preload', as: 'image', href: '/m/file', imagesizes: '100vw', fetchpriority: 'high' })
  })

  it('每頁 hero 的預載與 <img> 用同一份 attrs（sizes 一致），avifSrcset 也是同一份', () => {
    const page = { heroPhoto: undefined }
    for (const attrs of [heroImageAttrs({ heroImage: 'day-hello', heroImageMedia: undefined }), aboutHeroAttrs(page), curriculumHeroAttrs(page), admissionHeroImage(), environmentHeroImage()]) {
      const link = heroPreloadLink(attrs)
      expect(link.imagesizes).toBe(attrs.sizes)
      if (attrs.avifSrcset) {
        expect(link.imagesrcset).toBe(attrs.avifSrcset)
        expect(widthsOf(link.imagesrcset!)).toEqual(widthsOf(attrs.srcset!))
      }
    }
    expect(read('../app/composables/usePageSeo.ts')).toContain('heroPreloadLink(hero.value)')
  })
})

describe('呼叫端', () => {
  const components = readdirSync(resolve(here, '../app/components')).filter((file) => file.endsWith('.vue') && file !== 'ResponsivePicture.vue')

  it('helper 的 attrs 一律綁到 <ResponsivePicture>：<img v-bind="…"> 只剩預約頁首圖（它自己包 <picture>，先拆掉 avifSrcset）', () => {
    const offenders: string[] = []
    for (const file of components) {
      for (const tag of read(`../app/components/${file}`).match(/<img\b[^>]*>/g) ?? []) {
        if (/\bv-bind=/.test(tag) && !(file === 'VisitForm.vue' && tag.includes('v-bind="welcomePhoto"'))) offenders.push(`${file}: ${tag.slice(0, 80)}`)
      }
    }
    expect(offenders).toEqual([])
    const form = read('../app/components/VisitForm.vue')
    expect(form).toContain('const { avifSrcset: welcomeAvifSrcset, ...welcomePhoto } = responsiveImage(')
    // 手機那個 media source（1×1 透明圖）要排在 AVIF source 前面，手機才先命中它
    expect(form.indexOf('<source media=')).toBeLessThan(form.indexOf('<source v-if="welcomeAvifSrcset" type="image/avif"'))
    expect(form.indexOf('type="image/avif"')).toBeLessThan(form.indexOf('<img v-bind="welcomePhoto"'))
  })

  it('延後載入的首頁封面：AVIF 的 srcset 跟 src／srcset 一起等 posterReady（<source> 不等的話會自己載）', () => {
    expect(read('../app/components/DayExperience.vue')).toContain(':avifSrcset="posterReady ? posterImage.avifSrcset : undefined"')
  })

  it('SVG <image>、寫死 .webp 的 <img>、CSS url() 與只吃網址的 JS 載入維持 WebP', () => {
    for (const file of ['CrestPopup.vue', 'SiteHeader.vue', 'HomeStories.vue']) expect(read(`../app/components/${file}`)).not.toContain('avifSrcset')
    expect(read('../app/components/AnniversaryContent.vue')).toContain('src="/assets/ivy-30th-anniversary-projection.webp"')
  })

  it('子代選擇器：被換成 <ResponsivePicture> 的 <img> 另有 > picture > img 的對應規則（:where 不增加權重）', () => {
    const css = (file: string) => read(`../app/assets/css/${file}`)
    expect(css('studio.css').match(/\.studio-hero-image>img,\.studio-hero-image>:where\(picture\)>img/g)).toHaveLength(4)
    expect(css('studio.css')).toContain('.studio-hero-image>:is(img,video),.studio-hero-image>:where(picture)>img')
    // 關於頁 2026-11-11 重做後照片都用後代選擇器（.abh-hero-frame img 這類），不看 <img> 是不是直接子代，不需要對應規則
    expect(css('about.css').replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/>\s*img/)
    expect(css('environment.css')).toContain('.renv-frame>img,.renv-frame>:where(picture)>img{')
    expect(css('environment.css')).toContain('.renv-book>*,.renv-book>:where(picture)>:where(img){position:absolute;bottom:var(--side)}')
    expect(read('../app/components/HomeStoryViewer.vue')).toContain('.hsv-stage > img, .hsv-stage > :where(picture) > img,')
    expect(read('../app/components/HomeStories.vue')).toContain('.hs-card > img, .hs-card > :where(picture) > img {')
  })

  it('HeroVideo 用元件 expose 的 img 看首屏照片有沒有載完（ref 抓到的是元件，不是 <img>）', () => {
    const hero = read('../app/components/HeroVideo.vue')
    expect(hero).toContain('ref="heroPicture"')
    expect(hero).toContain('const heroImgEl = computed(() => heroPicture.value?.img ?? null)')
    expect(read('../app/components/ResponsivePicture.vue')).toContain('defineExpose({ img })')
  })
})

describe('預取下一則的照片（avif-support）', () => {
  const made: { src?: string, srcset?: string, sizes?: string }[] = []
  class FakeImage {
    src?: string
    srcset?: string
    sizes?: string
    width = 0
    height = 0
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor() { made.push(this) }
  }
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); made.length = 0 })

  const load = async (decodes: boolean) => {
    // supportsAvif 的結果是模組層級快取，每個情境重新載入模組
    class Probe extends FakeImage {
      constructor() {
        super()
        queueMicrotask(() => {
          if (decodes) { this.width = 1; this.height = 1; this.onload?.() } else this.onerror?.()
        })
      }
    }
    vi.stubGlobal('Image', Probe)
    return await import('../app/utils/avif-support')
  }

  it('沒有 avifSrcset：照舊抓 src', async () => {
    const { prefetchImage: prefetch } = await load(true)
    prefetch({ src: '/a.webp', sizes: '100vw' })
    expect(made.map((image) => image.src)).toEqual(['/a.webp'])
  })

  it('瀏覽器解得出 AVIF：預取 avifSrcset＋同一份 sizes（<picture> 會選中的那一檔）', async () => {
    const { prefetchImage: prefetch, supportsAvif } = await load(true)
    expect(await supportsAvif()).toBe(true)
    made.length = 0
    prefetch({ src: '/a.webp', sizes: '100vw', avifSrcset: '/a-480.avif 480w, /a.avif 800w' })
    await Promise.resolve()
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ srcset: '/a-480.avif 480w, /a.avif 800w', sizes: '100vw' })
    expect(made[0]!.src).toBeUndefined()
  })

  it('解不出 AVIF：照舊抓 WebP 的 src，不白抓 AVIF', async () => {
    const { prefetchImage: prefetch, supportsAvif } = await load(false)
    expect(await supportsAvif()).toBe(false)
    made.length = 0
    prefetch({ src: '/a.webp', avifSrcset: '/a.avif 800w' })
    await Promise.resolve()
    expect(made.map((image) => image.src)).toEqual(['/a.webp'])
    expect(made[0]!.srcset).toBeUndefined()
  })

  it('支援與否只量一次', async () => {
    const { supportsAvif } = await load(true)
    await supportsAvif()
    await supportsAvif()
    expect(made).toHaveLength(1)
  })

  it('HomeStoryViewer 預取下一則新聞照片走 prefetchImage', () => {
    expect(typeof prefetchImage).toBe('function')
    expect(read('../app/components/HomeStoryViewer.vue')).toContain("prefetchImage(responsiveTourImage(next.article.image, '100vw', false, next.article.imageMedia))")
  })
})
