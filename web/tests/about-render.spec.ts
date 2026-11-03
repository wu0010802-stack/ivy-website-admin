// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fixture from '../server/data/site-fixture.json'
import type { AboutPageContent, SiteContent } from '../app/types/site-content'
import { applyContentOverlay, type LiveAboutPage } from '../app/utils/content-overlay'
import AboutContent from '../app/components/AboutContent.vue'

// 後台改過的值會出現在官網：後台存的 payload 經 applyContentOverlay 套到內容，再用伺服器渲染（同官網 SSR）
// 畫出 AboutContent，看沿革的年份、民國年與首屏索引的年份範圍。Nuxt 的自動匯入在單元測試裡沒有，這裡補上；
// 六圈（AboutWholePerson）只在瀏覽器裡動，換成空元件。
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

async function render(page: AboutPageContent, extra: { anniversary?: boolean } = {}): Promise<string> {
  const app = createSSRApp({ render: () => h(AboutContent as Component, { campuses: site.campuses, page, ...extra }) })
  app.component('NuxtLink', NuxtLink)
  app.component('AboutWholePerson', defineComponent({ render: () => null }))
  return renderToString(app)
}

describe('關於常春藤頁：後台改過的值會出現在官網', () => {
  it('內建內容：義華 1997（民國 86 年）', async () => {
    const html = await render(site.aboutPage)
    expect(html).toContain('民國 86 年')
    expect(html).toMatch(/<p class="abh-year"[^>]*><span lang="en"[^>]*>1997<\/span>/)
    expect(html).toContain('1997 到 2021')
    expect(html).not.toContain('1998')
  })

  it('後台把義華年份改成 1998：沿革顯示民國 87 年、沿革年份與首屏索引用 1998', async () => {
    const live = Object.fromEntries(Object.entries(site.aboutPage).map(([key, value]) => [snake(key), structuredClone(value)])) as unknown as LiveAboutPage
    live.milestones[0] = { ...live.milestones[0]!, year: 1998 }
    const page = applyContentOverlay(site, { about_page: live }).aboutPage
    const html = await render(page)
    expect(html).toContain('民國 87 年')
    expect(html).not.toContain('民國 86 年')
    expect(html).toMatch(/<p class="abh-year"[^>]*><span lang="en"[^>]*>1998<\/span>/)
    expect(html).toContain('1998 到 2021')
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

  it('30 週年開關打開才接 /anniversary', async () => {
    expect(await render(site.aboutPage, { anniversary: true })).toMatch(/<a href="\/anniversary"[^>]*>看常春藤 30 週年/)
    expect(await render(site.aboutPage)).not.toContain('/anniversary')
  })

  it('六大領域各是一個同名 details，說明文字直接在 HTML 裡（搜尋讀得到），預設全部收起', async () => {
    const html = await render(site.aboutPage)
    expect(html.match(/<details name="abh-domain"[^>]*>/g)).toHaveLength(6)
    expect(html).not.toMatch(/<details[^>]*\bopen\b/)
    expect(html).toMatch(/<summary[^>]*>認知<svg/)
    expect(html).toContain('認知不是背知識，而是學會找答案')
  })
})
