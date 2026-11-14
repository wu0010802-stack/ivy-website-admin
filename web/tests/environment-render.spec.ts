// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import EnvironmentContent from '../app/components/EnvironmentContent.vue'
import ResponsivePicture from '../app/components/ResponsivePicture.vue'

// 環境頁文字逐字守門（2026-10-12）：前三章的文字從 EnvironmentContent.vue 搬進 fixture（environmentPage）、
// 改由後台內容模型提供，用 fixture 渲染出來的可見文字（含 alt、aria-label）和整段 <main> 都要和搬家前一字不差。
// 基準檔在元件還沒改之前存下（toMatchFileSnapshot）；唯一刻意的差異是第四章段落那一句
// （原本寫「取自各分校頁」，分校頁已拿掉）。2026-10-19 起 <main> 多了蠟筆塗鴉的空位置（.renv-doodle、.renv-tour-paint、.renv-meal-name，
// 都是 aria-hidden、沒有文字），可見文字照舊一字不差。2026-11-11 各章 <section> 多了內容興趣統計的 data-track-section。Nuxt 的自動匯入在單元測試裡沒有，這裡補上；
// 手繪線與 GSAP 只在瀏覽器掛載後才動，伺服器渲染不會碰。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('nextTick', nextTick)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
vi.stubGlobal('useHead', vi.fn())
// 短說明的斷詞結果放在 useState（EnvironmentContent.vue 的 Phrases），單元測試裡用一般的 ref 代替
vi.stubGlobal('useState', <T>(_key: string, init: () => T) => ref(init()))

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
    app.component('ResponsivePicture', ResponsivePicture)
    return await renderToString(app)
  } finally {
    vi.useRealTimers()
  }
}

/**
 * 同 scripts/page-ssr-snapshot.cjs：去掉 Vue 的註解標記與標籤間空白。
 * 2026-11-05 起內建照片是 <ResponsivePicture>（有 AVIF 的包成 <picture><source type="image/avif">）：基準檔是包裝之前存的，
 * 這裡把 <picture class="responsive-picture"><source …> 與 </picture> 拿掉再比，證明除了這層包裝之外 <main> 一字不差。
 */
const normalize = (html: string) => html
  .replace(/<!--[\s\S]*?-->/g, '')
  // 2026-11-13 短說明包了一層 <span class="renv-phr">、小段之間放 <wbr>（不從詞中間斷行）：拿掉這層再比，證明文字本身一字不差
  .replace(/<span class="renv-phr">(.*?)<\/span>/g, (_all, inner: string) => inner.replace(/<wbr>/g, ''))
  .replace(/>\s+</g, '><')
  .replace(/<picture class="responsive-picture"><source type="image\/avif" [^>]*>/g, '')
  .replace(/<\/picture>/g, '')

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
