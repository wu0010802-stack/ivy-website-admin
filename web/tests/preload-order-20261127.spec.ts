import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createHead, renderSSRHead } from 'unhead/server'
import fixture from '../server/data/site-fixture.json'
import { EARLY_PRELOAD_PRIORITY } from '../app/utils/head-priority'
import { heroPreloadLink, responsiveImage } from '../app/utils/responsive-image'
import { mediaImageAttrs, type MediaImage } from '../app/utils/media-image'
import {
  VISIT_ASIDE_PRELOAD_MEDIA, VISIT_CARD_PRELOAD_MEDIA, VISIT_WELCOME_PRELOAD_MEDIA,
  visitAsideImage, visitCardImage, visitImagePreloads, visitWelcomeImage
} from '../app/utils/visit-images'

// 2026-11-27 前台效能：首屏預載排在 inline 樣式前面、預約頁補首屏照片預載。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const campuses = fixture.campuses as unknown as { key: string, image: string, imageMedia?: MediaImage }[]

describe('預載排在 inline 樣式前面', () => {
  it('unhead 實際輸出：字型與首屏照片的預載在 <style> 與 stylesheet 之前，其他 preload 照預設在後面', async () => {
    const head = createHead()
    // 跟 Nuxt renderer 的順序一樣：先推 app.head（字型預載），再推 inline 樣式與 CSS、頁面的 hero 預載、模組預載
    head.push({ link: [{ rel: 'preload', as: 'font', type: 'font/woff2', href: '/f.woff2', crossorigin: 'anonymous', tagPriority: EARLY_PRELOAD_PRIORITY }] })
    head.push({ style: [{ innerHTML: '.a{color:red}' }] })
    head.push({ link: [{ rel: 'stylesheet', href: '/a.css' }] })
    head.push({ link: [heroPreloadLink(responsiveImage('about-hero', '100vw'))] })
    head.push({ link: [{ rel: 'modulepreload', href: '/_nuxt/x.js' }] })
    const { headTags } = await renderSSRHead(head)
    const at = (needle: string) => headTags.indexOf(needle)
    expect(at('href="/f.woff2"')).toBeGreaterThan(-1)
    expect(at('as="image"')).toBeGreaterThan(-1)
    for (const early of ['href="/f.woff2"', 'as="image"']) {
      expect(at(early)).toBeLessThan(at('<style'))
      expect(at(early)).toBeLessThan(at('rel="stylesheet"'))
    }
    expect(at('rel="modulepreload"')).toBeGreaterThan(at('<style'))
  })

  it('權重 40：在 title（10）之後、critical inline script（42）與樣式（60）之前', () => {
    expect(EARLY_PRELOAD_PRIORITY).toBeGreaterThan(10)
    expect(EARLY_PRELOAD_PRIORITY).toBeLessThan(42)
    expect(heroPreloadLink(responsiveImage('about-hero', '100vw')).tagPriority).toBe(EARLY_PRELOAD_PRIORITY)
  })

  it('nuxt.config 的三個字型預載都帶 tagPriority', () => {
    const config = read('../nuxt.config.ts')
    const fontLines = config.split('\n').filter((line) => line.includes("rel: 'preload', as: 'font'"))
    expect(fontLines).toHaveLength(3)
    for (const line of fontLines) expect(line).toContain('tagPriority: EARLY_PRELOAD_PRIORITY')
  })
})

describe('預約頁首屏照片預載（utils/visit-images.ts）', () => {
  it('第一步：第一張選校卡（手機）＋迎賓照（桌機、平板，排除橫拿手機）', () => {
    const [card, welcome, ...rest] = visitImagePreloads(campuses)
    expect(rest).toEqual([])
    const first = visitCardImage(campuses[0]!)
    expect(card).toMatchObject({ rel: 'preload', as: 'image', media: VISIT_CARD_PRELOAD_MEDIA, imagesizes: first.sizes, imagesrcset: first.avifSrcset ?? first.srcset, fetchpriority: 'high', tagPriority: EARLY_PRELOAD_PRIORITY })
    const photo = visitWelcomeImage()
    expect(welcome).toMatchObject({ media: VISIT_WELCOME_PRELOAD_MEDIA, imagesizes: photo.sizes, imagesrcset: photo.avifSrcset, type: 'image/avif' })
  })

  it('第二步：只預載左欄照片，限桌機', () => {
    const selected = campuses[2]!
    const links = visitImagePreloads(campuses, selected)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ media: VISIT_ASIDE_PRELOAD_MEDIA, imagesizes: visitAsideImage(selected).sizes })
  })

  it('後台換過封面：用素材的 srcset、不標 AVIF', () => {
    const media: MediaImage = { src: '/m/file', candidates: [{ src: '/m/v', width: 800 }, { src: '/m/file', width: 1600 }], position: null, alt: '' }
    const [card] = visitImagePreloads([{ key: 'yihua', image: 'yihua-exterior-v2', imageMedia: media }])
    expect(card!.imagesrcset).toBe(mediaImageAttrs(media, card!.imagesizes!).srcset)
    expect('type' in card!).toBe(false)
  })

  it('media 條件：迎賓照的預載不會在橫拿手機（≤960 寬、≤500 高）成立', () => {
    // 迎賓照在橫拿手機換成 1×1 透明圖（VisitForm.vue 的第一個 <source media>）。
    const matches = (w: number, h: number) => VISIT_WELCOME_PRELOAD_MEDIA.split(', ').some((part) => {
      const min = (name: string) => Number(new RegExp(`min-${name}: (\\d+)px`).exec(part)?.[1] ?? 0)
      return w >= min('width') && h >= min('height')
    })
    expect(matches(844, 390)).toBe(false) // 橫拿 iPhone
    expect(matches(932, 430)).toBe(false)
    expect(matches(390, 844)).toBe(false) // 直拿手機：卡片才是 LCP
    expect(matches(820, 1180)).toBe(true) // 平板
    expect(matches(1440, 900)).toBe(true)
    expect(read('../app/components/VisitForm.vue')).toContain('<source media="(max-width: 960px) and (max-height: 500px) and (orientation: landscape)"')
  })

  it('VisitForm 與頁面共用同一組 helper（sizes 不會兩邊各寫一份）', () => {
    const form = read('../app/components/VisitForm.vue')
    expect(form).toContain('v-bind="visitCardImage(campus)"')
    expect(form).toContain('v-bind="visitAsideImage(selectedCampus)"')
    expect(form).toContain('= visitWelcomeImage()')
    expect(form).not.toMatch(/pickImage\(campus\.image/)
    expect(read('../app/pages/visit/[[key]].vue')).toContain('visitImagePreloads(data.value.content.campuses, campus.value)')
  })
})
