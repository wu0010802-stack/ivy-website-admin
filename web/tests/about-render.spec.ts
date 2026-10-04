// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fixture from '../server/data/site-fixture.json'
import type { AboutPageContent, SiteContent } from '../app/types/site-content'
import { applyContentOverlay, type LiveAboutPage } from '../app/utils/content-overlay'
import AboutContent from '../app/components/AboutContent.vue'
import AboutMedal from '../app/components/AboutMedal.vue'

// 後台改過的值會出現在官網：後台存的 payload 經 applyContentOverlay 套到內容，再用伺服器渲染（同官網 SSR）
// 畫出 AboutContent，看沿革的民國年與紀念章用的 data-year。Nuxt 的自動匯入在單元測試裡沒有，這裡補上；
// 六圈（AboutWholePerson）只在瀏覽器裡動，換成空元件。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)

const site = fixture as unknown as SiteContent
const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.())
})
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

async function render(page: AboutPageContent): Promise<string> {
  const app = createSSRApp({ render: () => h(AboutContent as Component, { campuses: site.campuses, page }) })
  app.component('NuxtLink', NuxtLink)
  app.component('AboutMedal', AboutMedal as Component)
  app.component('AboutWholePerson', defineComponent({ render: () => null }))
  return renderToString(app)
}

describe('關於常春藤頁：後台改過的值會出現在官網', () => {
  it('內建內容：義華 1997（民國 86 年）', async () => {
    const html = await render(site.aboutPage)
    expect(html).toContain('民國 86 年')
    expect(html).toContain('data-year="1997"')
    expect(html).not.toContain('1998')
  })

  it('後台把義華年份改成 1998：沿革顯示民國 87 年、卡紙與紀念章用 1998', async () => {
    const live = Object.fromEntries(Object.entries(site.aboutPage).map(([key, value]) => [snake(key), structuredClone(value)])) as unknown as LiveAboutPage
    live.milestones[0] = { ...live.milestones[0]!, year: 1998 }
    const page = applyContentOverlay(site, { about_page: live }).aboutPage
    const html = await render(page)
    expect(html).toContain('民國 87 年')
    expect(html).not.toContain('民國 86 年')
    expect(html).toContain('data-year="1998"')
    expect(html).not.toContain('data-year="1997"')
    // 紀念章背面先印第一所（沒有 JS 時）：校名＋年份
    expect(html).toMatch(/class="is-year"[^>]*>1998<\/text>/)
  })
})
