// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h, nextTick, onMounted, onUnmounted, ref, watch, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import SiteHeader from '../app/components/SiteHeader.vue'

// 頁首選單面板的「機構社群」：不管來源是後台、fixture 還是舊資料，只有通過 httpsUrl 的連結才會變成 <a href>。
// Nuxt 的自動匯入在單元測試裡沒有，這裡補上；元件只用伺服器渲染（同官網 SSR）。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('nextTick', nextTick)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onUnmounted', onUnmounted)
vi.stubGlobal('useRoute', () => ({ path: '/' }))

const site = fixture as unknown as SiteContent
const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.())
})

async function render(socialLinks: unknown): Promise<string> {
  const content = { ...site, siteMeta: { ...site.siteMeta, socialLinks } } as unknown as SiteContent
  const app = createSSRApp({ render: () => h(SiteHeader as Component, { content }) })
  app.component('NuxtLink', NuxtLink)
  return renderToString(app)
}

/** 機構社群區塊裡所有 <a> 的 href 與圖示。 */
function institutionLinks(html: string): { href: string; icon: string }[] {
  const block = html.match(/<div class="menu-socials">([\s\S]*?)<\/nav><\/div>/)?.[1] ?? ''
  return [...block.matchAll(/<a href="([^"]*)"[^>]*>[\s\S]*?<use href="#i-([\w-]+)"/g)].map((m) => ({ href: m[1]!.replace(/&amp;/g, '&'), icon: m[2]! }))
}

describe('SiteHeader 的機構社群連結', () => {
  it('內建清單照常渲染', async () => {
    const links = institutionLinks(await render(site.siteMeta.socialLinks))
    expect(links).toEqual(site.siteMeta.socialLinks!.map((link) => ({ href: link.url, icon: link.platform })))
  })

  it('四種平台都有圖示、順序照清單', async () => {
    const links = institutionLinks(await render([
      { platform: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@ivy' },
      { platform: 'line', label: 'LINE', url: 'https://line.me/R/ti/p/@ivy' },
      { platform: 'instagram', label: 'IG', url: 'https://www.instagram.com/ivy' },
      { platform: 'facebook', label: 'FB', url: 'https://www.facebook.com/ivy' }
    ]))
    expect(links.map((link) => link.icon)).toEqual(['youtube', 'line', 'instagram', 'facebook'])
  })

  it('不合格的網址（javascript:、http、帳密、空白）不會變成連結', async () => {
    const html = await render([
      { platform: 'facebook', label: '壞的一', url: 'javascript:alert(1)' },
      { platform: 'facebook', label: '壞的二', url: 'http://www.facebook.com/ivy' },
      { platform: 'facebook', label: '壞的三', url: 'https://user:pw@www.facebook.com/ivy' },
      { platform: 'facebook', label: '壞的四', url: 'https://www.facebook.com/a b' },
      { platform: 'instagram', label: '好的', url: '  https://www.instagram.com/ivy  ' }
    ])
    expect(institutionLinks(html)).toEqual([{ href: 'https://www.instagram.com/ivy', icon: 'instagram' }])
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('壞的')
  })

  it('全部不合格或清單是空的：整個機構社群區塊不出現', async () => {
    expect(await render([{ platform: 'line', label: '壞的', url: 'javascript:alert(1)' }])).not.toContain('menu-socials')
    expect(await render([])).not.toContain('menu-socials')
    expect(await render(undefined)).not.toContain('menu-socials')
  })
})
