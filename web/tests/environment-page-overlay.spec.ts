// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fixture from '../server/data/site-fixture.json'
import type { EnvironmentPageContent, SiteContent } from '../app/types/site-content'
import { applyContentOverlay, type LiveEnvironmentPage } from '../app/utils/content-overlay'
import { environmentHeroAttrs, type MediaInfoMap } from '../app/utils/media-image'
import { ENVIRONMENT_HERO_IMAGE, environmentHeroImage } from '../app/utils/responsive-image'
import { PAGE_COUNTS } from '../app/utils/page-content'
import EnvironmentContent from '../app/components/EnvironmentContent.vue'

// 環境頁前三章的後台內容（environment_page）：後台存的 payload 經 applyContentOverlay 套到內容，
// 形狀不符整份退回內建；再用伺服器渲染 EnvironmentContent 看照片與文字真的換了。
// Nuxt 的自動匯入在單元測試裡沒有，這裡補上；手繪線與 GSAP 只在瀏覽器掛載後才動。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('nextTick', nextTick)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
vi.stubGlobal('useHead', vi.fn())

const site = fixture as unknown as SiteContent
const HERO = '3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c'
const CARE = '4a3d2b0f-9c8e-4d7f-8b2c-3e4f5a6b7c8d'
const SPACE = '5b4e3c1a-0d9f-4e80-9c3d-4f5a6b7c8d9e'
const info = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, kind: 'image', content_type: 'image/webp', width: 1600, height: 1200, alt_text: '素材庫說明', focus_x: 30, focus_y: 40, variants: [], ...overrides
})
const media = {
  [HERO]: info(HERO, { width: 2400, height: 1200, alt_text: '素材庫的首屏說明', focus_x: null, focus_y: null }),
  [CARE]: info(CARE),
  [SPACE]: info(SPACE, { alt_text: '素材庫的空間說明', focus_x: 70, focus_y: 20 })
} as unknown as MediaInfoMap

const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
/** fixture 的 camelCase → 後端實際送來的形狀：頂層與 spaces 的 campusLabel 轉 snake_case，照片版位是 null、說明是空字串。 */
function livePayload(): LiveEnvironmentPage {
  const e = structuredClone(site.environmentPage)
  const live = Object.fromEntries(Object.entries(e).map(([key, value]) => [snake(key), value])) as unknown as LiveEnvironmentPage
  live.spaces = e.spaces.map(({ campusLabel, ...rest }) => ({ ...rest, campus_label: campusLabel, photo: null, photo_alt: '' }))
  live.care_items = e.careItems.map((item) => ({ ...item, photo: null, photo_alt: '' }))
  live.feature = { ...e.feature, photo: null, photo_alt: '' }
  return { ...live, hero_photo: null, hero_photo_alt: '', care_photo: null, care_photo_alt: '' }
}
const overlay = (live: LiveEnvironmentPage, mediaInfo: MediaInfoMap = {}): EnvironmentPageContent =>
  applyContentOverlay(site, { environment_page: live }, mediaInfo).environmentPage

const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.())
})
async function render(page: EnvironmentPageContent): Promise<string> {
  const app = createSSRApp({ render: () => h(EnvironmentContent as Component, { campuses: site.campuses, page }) })
  app.component('NuxtLink', NuxtLink)
  return renderToString(app)
}
const img = (html: string, alt: string) => html.match(new RegExp(`<img[^>]*alt="${alt}"[^>]*>`))?.[0] ?? ''

describe('常春藤環境頁的後台內容', () => {
  it('固定項目數和後端一致', () => {
    expect(PAGE_COUNTS.environment).toEqual({ chapterNames: 4, hearts: 5, careItems: 5, spaces: 6, meals: 5 })
    expect(site.environmentPage.careItems).toHaveLength(5)
    expect(site.environmentPage.meals).toHaveLength(5)
  })

  it('後端實際送來的形狀（照片 null、說明空字串）和內建一字不差：官網內容完全不變，沒有任何照片', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const next = overlay(livePayload())
    expect(error).not.toHaveBeenCalled()
    expect(next).toEqual(site.environmentPage)
    expect([next.heroPhoto, next.carePhoto, next.feature.photo, ...next.careItems.map((x) => x.photo), ...next.spaces.map((x) => x.photo)].every((x) => x === undefined)).toBe(true)
    error.mockRestore()
  })

  it('正常的草稿整份取代：標題、便條、校名、餐點、第四章段落都換成後台的', () => {
    const live = livePayload()
    live.hero_title = '孩子的每一天，\n都在這裡開心長大。'
    live.hero_highlight = '開心'
    live.hearts = ['愛心', '細心', '耐心', '貼心', '真心']
    live.care_photo_note = '三角鐵'
    live.feature.title = '在遊戲裡，\n快樂長大。'
    live.spaces[0]!.campus_label = '義華校'
    live.spaces[2]!.campus_label = ''
    live.meals[4]!.time = '16:00'
    live.meals[4]!.name = '下午點心'
    live.tour_text = '後台改過的第四章說明。'
    live.chapter_names = ['保育', '環境', '餐點', '校園']
    const next = overlay(live)
    expect(next.heroTitle).toBe('孩子的每一天，\n都在這裡開心長大。')
    expect(next.heroHighlight).toBe('開心')
    expect(next.hearts[4]).toBe('真心')
    expect(next.carePhotoNote).toBe('三角鐵')
    expect(next.feature.title).toBe('在遊戲裡，\n快樂長大。')
    expect(next.spaces.map((x) => x.campusLabel)).toEqual(['義華校', '', '', '', '', ''])
    expect(next.meals[4]).toMatchObject({ time: '16:00', name: '下午點心' })
    expect(next.tourText).toBe('後台改過的第四章說明。')
    expect(next.chapterNames).toEqual(['保育', '環境', '餐點', '校園'])
    // 沒改的欄位照後台送來的值
    expect(next.careItems).toEqual(site.environmentPage.careItems)
    expect(next.mealsText).toBe(site.environmentPage.mealsText)
  })

  it('舊版內容沒有選填欄位（大標螢光、校名）：當作空字串，不退回內建', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const live = livePayload()
    delete live.hero_highlight
    delete live.spaces[2]!.campus_label
    const next = overlay(live)
    expect(error).not.toHaveBeenCalled()
    expect(next.heroHighlight).toBe('')
    expect(next.spaces[2]!.campusLabel).toBe('')
    error.mockRestore()
  })

  it('照片是素材：用素材網址與焦點，說明後台優先、沒填用素材庫的', () => {
    const live = livePayload()
    live.hero_photo = { media_id: HERO }
    live.hero_photo_alt = '後台寫的首屏說明'
    live.care_photo = { media_id: CARE }
    live.feature.photo = { media_id: CARE }
    live.care_items[1]!.photo = { media_id: CARE, focus_x: 10, focus_y: 90 }
    live.spaces[3]!.photo = { media_id: SPACE }
    const next = overlay(live, media)
    expect(next.heroPhoto?.src).toBe(`/api/website/v1/public/media/${HERO}/file`)
    expect(next.heroPhotoAlt).toBe('後台寫的首屏說明')
    expect(next.carePhoto?.position).toBe('30% 40%')
    expect(next.carePhotoAlt).toBe('素材庫說明')
    expect(next.feature.photo?.src).toContain(CARE)
    expect(next.careItems[1]!.photo?.position).toBe('10% 90%')
    expect(next.careItems[0]!.photo).toBeUndefined()
    expect(next.spaces[3]!.photo?.position).toBe('70% 20%')
    expect(next.spaces[3]!.photoAlt).toBe('素材庫的空間說明')
    expect(next.spaces[2]!.photo).toBeUndefined()
  })

  it('形狀不符（少一張卡、多一個餐點、欄位型別不對…）：整份退回內建，不丟錯、不半套', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mutations: ((live: any) => void)[] = [
      (live) => { live.care_items.pop() },
      (live) => { live.care_items.push(live.care_items[0]) },
      (live) => { live.spaces.pop() },
      (live) => { live.meals.push({ ...live.meals[4], time: '17:00' }) },
      (live) => { live.meals.pop() },
      (live) => { live.hearts.pop() },
      (live) => { live.chapter_names.pop() },
      (live) => { live.meals[3].time = null }, // 型別不對仍退回（時間格式與先後不檢查，見下一個測試）
      (live) => { delete live.hero_title },
      (live) => { live.tour_hint = 7 },
      (live) => { live.hearts[0] = null },
      (live) => { live.chapter_names[1] = 3 },
      (live) => { delete live.feature },
      (live) => { live.feature.note = null },
      (live) => { live.care_items[2] = null },
      (live) => { delete live.care_items[0].title },
      (live) => { live.spaces[4].note = 5 },
      (live) => { delete live.meals[1].text },
      (live) => { live.care_items = 'abcde' }
    ]
    for (const mutate of mutations) {
      const live = livePayload()
      live.hero_title = '會被退回的標題' // 形狀不符時連同這個正常的修改一起退回
      mutate(live)
      expect(() => applyContentOverlay(site, { environment_page: live })).not.toThrow()
      expect(applyContentOverlay(site, { environment_page: live }).environmentPage).toEqual(site.environmentPage)
    }
    expect(error).toHaveBeenCalledTimes(mutations.length * 2)
    error.mockRestore()
  })

  it('餐點時間倒序、同時間、格式不對、空字串：照樣顯示，不退回內建（時間規則由後端擋存檔，即時預覽打到一半不要整份消失）', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cases: [string, (live: LiveEnvironmentPage) => void, string[]][] = [
      ['倒序', (live) => { live.meals[2]!.time = '09:00' }, ['08:30', '10:00', '09:00', '12:00', '15:30']],
      ['同時間', (live) => { live.meals[1]!.time = live.meals[0]!.time }, ['08:30', '08:30', '11:40', '12:00', '15:30']],
      ['不是 HH:MM', (live) => { live.meals[0]!.time = '8:30' }, ['8:30', '10:00', '11:40', '12:00', '15:30']],
      ['超出 24 小時', (live) => { live.meals[0]!.time = '25:00' }, ['25:00', '10:00', '11:40', '12:00', '15:30']],
      ['空字串', (live) => { live.meals[3]!.time = '' }, ['08:30', '10:00', '11:40', '', '15:30']]
    ]
    for (const [label, mutate, times] of cases) {
      const live = livePayload()
      live.hero_title = '預覽打到一半的標題'
      mutate(live)
      const next = overlay(live)
      expect(next.heroTitle, label).toBe('預覽打到一半的標題')
      expect(next.meals.map((m) => m.time), label).toEqual(times)
    }
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('餐點時間空字串的預覽也畫得出來（SSR）', async () => {
    const live = livePayload()
    live.meals[1]!.time = ''
    live.meals[2]!.time = ''
    live.meals[1]!.name = '時間還沒填的餐點'
    const html = await render(overlay(live))
    expect(html).toContain('時間還沒填的餐點')
    expect(html).toContain('<time lang="en"></time>')
  })

  it('預覽時 SSR 渲染的是整份取代後的內容', async () => {
    const live = livePayload()
    live.hero_title = '歡迎來到\n我們的環境。'
    live.hero_highlight = '環境'
    live.meals[1]!.name = '水果'
    live.meals[1]!.time = '10:30'
    live.spaces[2]!.campus_label = ''
    live.hero_notice = '   '.trim()
    const html = await render(overlay(live))
    expect(html).toContain('歡迎來到')
    expect(html).toMatch(/我們的<span class="renv-mark" data-rough="highlight" data-seed="11">環境<\/span>。/)
    expect(html).not.toContain('孩子的每一天')
    expect(html).toContain('10:30')
    expect(html).not.toContain('class="renv-campus"')
    // 大標沒有螢光字、提醒留空：不畫螢光、不畫提醒
    live.hero_highlight = ''
    const plain = await render(overlay(live))
    expect(plain).not.toContain('renv-mark')
    expect(plain).not.toContain('renv-notice')
  })
})

describe('環境頁照片：沒選用內建圖與位置，選了用素材網址與焦點', () => {
  it('沒選：內建靜態圖與 pos（照片 alt 也是內建的）', async () => {
    const html = await render(overlay(livePayload(), media))
    const health = img(html, '老師幫戴著口罩的孩子確認身體狀況')
    expect(health).toContain('/assets/responsive/env-care-health')
    expect(health).toContain('object-position:32% 50%')
    expect(img(html, '兩個孩子在教室裡緊緊抱在一起')).toContain('/assets/')
    expect(img(html, '老師拿著鈴鼓，帶幼幼班孩子一起拍手唱歌')).toContain('env-care-teacher')
    expect(html).not.toContain('/api/website/v1/public/media/')
  })

  it('選了：素材網址、素材焦點、後台的說明（沒填用素材庫的）', async () => {
    const live = livePayload()
    live.hero_photo = { media_id: HERO }
    live.care_photo = { media_id: CARE }
    live.care_photo_alt = '後台寫的保育照片說明'
    live.feature.photo = { media_id: CARE }
    live.care_items[0]!.photo = { media_id: CARE, focus_x: 10, focus_y: 90 }
    live.spaces[1]!.photo = { media_id: SPACE }
    const html = await render(overlay(live, media))
    const care0 = img(html, '素材庫說明')
    expect(care0).toContain(`/api/website/v1/public/media/${CARE}/file`)
    expect(html).toContain('object-position:10% 90%')
    expect(img(html, '後台寫的保育照片說明')).toContain(`/media/${CARE}/file`)
    expect(img(html, '素材庫的空間說明')).toContain(`/media/${SPACE}/file`)
    expect(img(html, '素材庫的空間說明')).toContain('object-position:70% 20%')
    // 內建的第一張照顧卡被換掉了，第二張還是內建圖與 pos
    expect(html).not.toContain('老師幫戴著口罩的孩子確認身體狀況')
    expect(img(html, '男孩拿著湯匙，從紅色碗裡舀飯吃')).toContain('object-position:50% 50%')
    // 首屏換了照片：內建首屏圖不再出現
    expect(html).not.toContain(`/assets/${ENVIRONMENT_HERO_IMAGE}.webp`)
    expect(img(html, '素材庫的首屏說明')).toContain(`/media/${HERO}/file`)
    // 素材沒設焦點：置中，不沿用內建首屏圖的 CSS 位置
    expect(img(html, '素材庫的首屏說明')).toContain('object-position:50% 50%')
  })

  it('首屏照片：頁面 <img> 與 preload 共用 environmentHeroAttrs；沒換和原本的 preload 完全相同，換了依寬高比重算 sizes', () => {
    expect(environmentHeroAttrs(site.environmentPage)).toEqual(environmentHeroImage())
    const next = overlay({ ...livePayload(), hero_photo: { media_id: HERO } }, media)
    const attrs = environmentHeroAttrs(next)
    expect(attrs.src).toBe(`/api/website/v1/public/media/${HERO}/file`)
    // 2400×1200 的 2:1 照片塞進 3:2 相框，左右被裁，要畫的寬度是框寬 × (2 ÷ 1.5)
    expect(attrs.width).toBe(2400)
    const wide = overlay({ ...livePayload(), hero_photo: { media_id: HERO } }, { ...media, [HERO]: info(HERO, { width: 2400, height: 1200, variants: [{ kind: 'thumbnail', width: 480, height: 240 }, { kind: 'large', width: 1600, height: 800 }] }) } as unknown as MediaInfoMap)
    expect(environmentHeroAttrs(wide).sizes).toBe('(max-width: 900px) calc((100vw - 40px) * 1.33), 718px')
    // 比 3:2 窄的照片不放大
    const tall = overlay({ ...livePayload(), hero_photo: { media_id: CARE } }, { ...media, [CARE]: info(CARE, { width: 1200, height: 1600, variants: [{ kind: 'thumbnail', width: 360, height: 480 }, { kind: 'large', width: 900, height: 1200 }] }) } as unknown as MediaInfoMap)
    expect(environmentHeroAttrs(tall).sizes).toBe('(max-width: 900px) calc((100vw - 40px) * 1), 540px')
  })
})
