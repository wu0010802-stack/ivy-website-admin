// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fixture from '../server/data/site-fixture.json'
import type { AboutPageContent, SiteContent } from '../app/types/site-content'
import { applyContentOverlay, type LiveAboutPage } from '../app/utils/content-overlay'
import AboutContent from '../app/components/AboutContent.vue'
import AboutYear from '../app/components/AboutYear.vue'
import ResponsivePicture from '../app/components/ResponsivePicture.vue'
import { LITERACIES } from '../app/utils/about-content'

// 後台改過的值會出現在官網：後台存的 payload 經 applyContentOverlay 套到內容，再用伺服器渲染（同官網 SSR）
// 畫出 AboutContent，看沿革的年份、民國年與首屏索引的年份範圍。Nuxt 的自動匯入在單元測試裡沒有，這裡補上
// （元件也要自己註冊：年份跳字 AboutYear）。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)

const site = fixture as unknown as SiteContent
const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.())
})
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

async function render(page: AboutPageContent, extra: { anniversary?: boolean; campuses?: SiteContent['campuses'] } = {}): Promise<string> {
  const app = createSSRApp({ render: () => h(AboutContent as Component, { campuses: site.campuses, page, ...extra }) })
  app.component('NuxtLink', NuxtLink)
  app.component('ResponsivePicture', ResponsivePicture)
  app.component('AboutYear', AboutYear)
  return renderToString(app)
}

describe('關於常春藤頁：後台改過的值會出現在官網', () => {
  it('內建內容：義華 1997（民國 86 年）', async () => {
    const html = await render(site.aboutPage)
    expect(html).toContain('民國 86 年')
    expect(html).toMatch(/<p class="abh-year"[^>]*><span lang="en"[^>]*>1997<\/span>/)
    // 首屏索引的小字：創校那年到今年（沿革最後一站是今年）
    expect(html).toMatch(/1997 到 20\d\d/)
    expect(html).not.toContain('1998')
    // 年份里程表：伺服器輸出就停在第一站那一年（讀得到的是 sr-only 那個數字，滾動的直條不讀）
    expect(html).toMatch(/<span class="sr-only"[^>]*>1997<\/span><span class="aby-reel" aria-hidden="true"/)
  })

  it('後台把義華年份改成 1998：沿革顯示民國 87 年、沿革年份與首屏索引用 1998', async () => {
    const live = Object.fromEntries(Object.entries(site.aboutPage).map(([key, value]) => [snake(key), structuredClone(value)])) as unknown as LiveAboutPage
    live.milestones[0] = { ...live.milestones[0]!, year: 1998 }
    const page = applyContentOverlay(site, { about_page: live }).aboutPage
    const html = await render(page)
    expect(html).toContain('民國 87 年')
    expect(html).not.toContain('民國 86 年')
    expect(html).toMatch(/<p class="abh-year"[^>]*><span lang="en"[^>]*>1998<\/span>/)
    expect(html).toMatch(/1998 到 20\d\d/)
    // 首屏介紹是後台的另一個欄位（這裡沒改），只看沿革與索引沒有舊年份
    expect(html).not.toMatch(/>1997<|1997 到/)
  })
})

// 2026-10-31：年數由今年（台北）算、沿革最後接 30 週年頁、六大領域點開看說明
describe('關於常春藤頁：年數、30 週年、六大領域', () => {
  afterEach(() => { vi.useRealTimers() })
  const at = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)) }
  const storyTitle = (html: string) => /<h2 id="story-title"[^>]*>(.*?)<\/h2>/.exec(html)![1]!.replace(/<br[^>]*>/g, '\n').replace(/<!--.*?-->/g, '')

  it('2026 年：第一章「走到今年⏎是第 30 年」（標題不放逗號句號），首屏介紹照原文「近三十年來」', async () => {
    at('2026-10-31T04:00:00Z')
    const html = await render(site.aboutPage)
    expect(storyTitle(html)).toBe('走到今年\n是第 30 年')
    expect(html).toContain('近三十年來，我們守著')
    expect(html).not.toContain('長出五所校園')
  })

  it('台北 2027 年元旦（UTC 還是 2026）就換成「滿 30 年」「三十年來」', async () => {
    at('2026-12-31T16:30:00Z')
    const html = await render(site.aboutPage)
    expect(storyTitle(html)).toBe('走到今年\n滿 30 年')
    expect(html).toContain('。三十年來，我們守著')
  })

  it('後台改寫過第一章標題就照後台，不換算（逗號句號照樣拿掉）', async () => {
    at('2026-10-31T04:00:00Z')
    const html = await render({ ...site.aboutPage, storyTitle: '一路走來，\n五所校園。' })
    expect(storyTitle(html)).toBe('一路走來\n五所校園')
  })

  it('內文不連 30 週年頁（2026-11-12 使用者說先拿掉），開關開或關都一樣', async () => {
    expect(await render(site.aboutPage, { anniversary: true })).not.toContain('/anniversary')
    expect(await render(site.aboutPage)).not.toContain('/anniversary')
  })

  it('六大領域是一組同名 radio（預設選第一項），六段說明都直接在 HTML 裡（搜尋讀得到）', async () => {
    const html = await render(site.aboutPage)
    const radios = html.match(/<input[^>]*type="radio"[^>]*name="abh-domain"[^>]*>/g) ?? []
    expect(radios).toHaveLength(6)
    expect(radios.filter((tag) => /\bchecked\b/.test(tag))).toHaveLength(1)
    expect(radios[0]).toMatch(/\bchecked\b/)
    expect(html.match(/<div class="abh-panel"/g)).toHaveLength(6)
    expect(html).not.toContain('<details')
    expect(html).toContain('認知不是背知識，而是學會找答案')
    expect(html).toMatch(/<b[^>]*>六大核心素養<\/b>/)
    for (const name of LITERACIES) expect(html).toMatch(new RegExp(`<span[^>]*>${name}</span>`))
  })

  // 2026-11-11：沿革一校一站，多了地址電話與那一校的場景照；最後一站是今年
  it('沿革每一站有地址與電話連結，不放校園場景照；整章收在今年、寫第幾年與幾所校園', async () => {
    at('2026-10-31T04:00:00Z')
    const html = await render(site.aboutPage)
    expect(html.match(/<li[^>]*class="abh-stop"/g)).toHaveLength(5)
    for (const campus of site.campuses) {
      expect(html).toContain(campus.address)
      expect(html).toContain(`href="tel:${campus.phone.replace(/[^0-9+]/g, '')}"`)
      expect(html).toContain(`alt="${campus.name}校舍的手繪圖"`)
    }
    for (const scene of site.campuses.flatMap((c) => c.tourScenes)) expect(html).not.toContain(`>${scene.name}<`)
    const now = html.slice(html.indexOf('abh-finale'), html.indexOf('id="whole-child"'))
    expect(now).toMatch(/<span class="sr-only"[^>]*>2026<\/span>/)
    expect(now).toMatch(/<span[^>]*>民國 115 年<\/span><b[^>]*>第 30 年<\/b>/)
    expect(now).toMatch(/<h3[^>]*>五所校園<\/h3>/)
    expect(now).not.toContain('<a ')
    expect(now.match(/<span class="abh-sky-art"/g)).toHaveLength(5)
  })

  it('分校下架：那一年留在沿革裡，不放線稿、校名與聯絡方式，今年那一站少算一所', async () => {
    const html = await render(site.aboutPage, { campuses: site.campuses.filter((c) => c.key !== 'renwu') })
    expect(html.match(/<li[^>]*class="abh-stop"/g)).toHaveLength(5)
    expect(html).toContain('第五所校園，在仁武區成立。')
    expect(html).not.toContain('仁武校校舍的手繪圖')
    expect(html).not.toContain('京吉一路')
    expect(html).toMatch(/<h3[^>]*>四所校園<\/h3>/)
  })
})
