// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { applyContentOverlay } from '../app/utils/content-overlay'
import EnvironmentContent from '../app/components/EnvironmentContent.vue'
import ResponsivePicture from '../app/components/ResponsivePicture.vue'

// 2026-11-26 修復 tourphoto：校園探索可以發布沒有照片的場景（後台「新增場景」帶空字串 image），
// 官網環境頁第四章把 '' 接成 /assets/.webp，正式站破圖。後端已擋發布；官網這裡也防一層：
// 沒有照片的場景不進頁面資料（規則上線前已發布的舊內容、後台的即時預覽都會走到這裡）。
// Nuxt 的自動匯入在單元測試裡沒有，這裡補上（同 environment-render.spec.ts）。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('nextTick', nextTick)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
vi.stubGlobal('useHead', vi.fn())
vi.stubGlobal('useState', <T>(_key: string, init: () => T) => ref(init()))
vi.stubGlobal('useRoute', () => ({ path: '/environment', query: {} }))
vi.stubGlobal('useRememberedCampus', () => ({ recall: () => null, remember: () => {} }))

const site = fixture as unknown as SiteContent
const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.())
})

const scene = (key: string, name: string, image: string) => ({ key, name, image, intro: '' })
// 第二個場景是按「新增場景」後只改了名稱、忘了選照片的樣子。
const missingPhoto = { scenes: [scene('hall', '大廳', 'campus'), scene('scene-1764140000000', '戶外遊戲場', '')] }

async function renderEnvironment(content: SiteContent): Promise<string> {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-12T04:00:00Z'))
  try {
    const app = createSSRApp({ render: () => h(EnvironmentContent as Component, { campuses: content.campuses, page: content.environmentPage }) })
    app.component('NuxtLink', NuxtLink)
    app.component('ResponsivePicture', ResponsivePicture)
    return await renderToString(app)
  } finally {
    vi.useRealTimers()
  }
}

describe('校園探索：沒有照片的場景不上官網', () => {
  it('overlay 拿掉沒有照片的場景，其他場景照舊', () => {
    const result = applyContentOverlay(site, { campus_tour: { yihua: missingPhoto } } as never)
    const yihua = result.campuses.find((c) => c.key === 'yihua')!
    expect(yihua.tourScenes.map((s) => s.key)).toEqual(['hall'])
  })

  it('整組都沒有照片：沿用官網內建的場景，不讓這一校從第四章消失', () => {
    const result = applyContentOverlay(site, { campus_tour: { yihua: { scenes: [scene('a', '戶外遊戲場', '')] } } } as never)
    const builtIn = site.campuses.find((c) => c.key === 'yihua')!.tourScenes
    expect(result.campuses.find((c) => c.key === 'yihua')!.tourScenes).toEqual(builtIn)
  })

  it('環境頁伺服器渲染不出現 /assets/.webp 破圖', async () => {
    const html = await renderEnvironment(applyContentOverlay(site, { campus_tour: { yihua: missingPhoto } } as never))
    expect(html).toContain('大廳')
    expect(html).not.toContain('/assets/.webp')
    expect(html).not.toContain('戶外遊戲場')
  })
})
