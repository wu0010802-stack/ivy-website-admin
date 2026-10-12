// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import EnvironmentContent from '../app/components/EnvironmentContent.vue'

// 環境頁文字逐字守門（2026-10-12）：前三章的文字從 EnvironmentContent.vue 搬進 fixture（environmentPage）、
// 改由後台內容模型提供，用 fixture 渲染出來的可見文字（含 alt、aria-label）和整段 <main> 都要和搬家前一字不差。
// 基準檔在元件還沒改之前存下（toMatchFileSnapshot）；唯一刻意的差異是第四章段落那一句
// （原本寫「取自各分校頁」，分校頁已拿掉）。Nuxt 的自動匯入在單元測試裡沒有，這裡補上；
// 手繪線與 GSAP 只在瀏覽器掛載後才動，伺服器渲染不會碰。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('nextTick', nextTick)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
vi.stubGlobal('useHead', vi.fn())

const site = fixture as unknown as SiteContent
const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.())
})

/** 營養餐點書的連結與月份跟著日期變，固定在台北 2026-10-12。 */
async function renderMain(): Promise<string> {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-12T04:00:00Z'))
  try {
    const app = createSSRApp({ render: () => h(EnvironmentContent as Component, { campuses: site.campuses, page: site.environmentPage }) })
    app.component('NuxtLink', NuxtLink)
    return await renderToString(app)
  } finally {
    vi.useRealTimers()
  }
}

/** 同 scripts/page-ssr-snapshot.cjs：去掉 Vue 的註解標記與標籤間空白。 */
const normalize = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><')

/** 依出現順序列出可見文字，再加上 alt、aria-label、title 等讀得到的屬性文字。 */
function visibleStrings(html: string): string[] {
  const out: string[] = []
  const pattern = /(<[^>]+>)|([^<]+)/g
  for (const [, tag, text] of html.matchAll(pattern)) {
    if (text !== undefined) {
      const value = text.trim()
      if (value) out.push(value)
    } else if (tag) {
      for (const [, name, value] of tag.matchAll(/\s(alt|aria-label|title)="([^"]*)"/g)) if (value) out.push(`[${name}] ${value}`)
    }
  }
  return out
}

describe('環境頁渲染文字', () => {
  it('可見文字（含 alt、aria-label）逐字不變', async () => {
    const html = normalize(await renderMain())
    await expect(`${JSON.stringify(visibleStrings(html), null, 2)}\n`).toMatchFileSnapshot('./fixtures/environment-text-20261012.json')
  })

  it('整段 <main>（含手繪層依賴的 data-*、id、class）一字不差', async () => {
    const html = normalize(await renderMain())
    await expect(`${html}\n`).toMatchFileSnapshot('./fixtures/environment-main-20261012.html')
  })
})
