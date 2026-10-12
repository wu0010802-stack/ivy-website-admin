// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type App, type Component } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import EnvironmentContent from '../app/components/EnvironmentContent.vue'

// 2026-10-12 即時預覽補洞：環境頁的手繪線條（框、便條箭頭、章節底紙）只在掛載與視窗改寬時重畫。
// 後台即時預覽換字、換照片或換場景之後，版面高度變了，線條卻停在舊的位置（實測：文字變長時
// 「03 幼兒餐點」的黃色底紙蓋不到最後一個時段）。元件要在 page／campuses 變動、畫面更新完之後
// 呼叫 sketch.refresh(整頁)；正式頁的 props 不會變，所以不受影響。
// Nuxt 的自動匯入在單元測試裡沒有，這裡補上；手繪層與 GSAP 換成假的（refresh 是否重算版面由 rough-sketch 自己負責）。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('nextTick', nextTick)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
vi.stubGlobal('useHead', vi.fn())

const sketch = vi.hoisted(() => ({
  refresh: vi.fn(),
  destroy: vi.fn(),
  create: vi.fn()
}))
vi.mock('../app/utils/rough-sketch', () => ({
  createRoughSketch: (...args: unknown[]) => {
    sketch.create(...args)
    return { ready: Promise.resolve(), refresh: sketch.refresh, destroy: sketch.destroy }
  }
}))
vi.mock('../app/utils/environment-motion', () => ({ createEnvironmentMotion: () => null }))
// 字型樣式表交給瀏覽器去抓；這裡不要讓 happy-dom 真的發請求
vi.mock('../app/utils/environment-fonts', () => ({ ENVIRONMENT_FONT_PRELOAD: [], attachEnvironmentFontStylesheet: () => {} }))

const site = fixture as unknown as SiteContent
const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.())
})

let app: App | null = null
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  sketch.refresh.mockClear()
  sketch.destroy.mockClear()
  sketch.create.mockClear()
})

/** 掛起來，等手繪層建好（onMounted 裡要動態載入幾支模組）。 */
async function mountEnvironment() {
  const state = reactive({ page: structuredClone(site.environmentPage), campuses: structuredClone(site.campuses) })
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(EnvironmentContent as Component, { campuses: state.campuses, page: state.page }) })
  app.component('NuxtLink', NuxtLink)
  app.config.warnHandler = () => {}
  app.mount(host)
  await vi.waitFor(() => expect(sketch.create).toHaveBeenCalledOnce())
  await vi.waitFor(() => expect(document.querySelector('main.renv')).not.toBeNull())
  // 建好之後 onMounted 還有 await sketch.ready：讓它跑完
  await new Promise((resolve) => setTimeout(resolve, 0))
  sketch.refresh.mockClear()
  return state
}

describe('環境頁即時預覽換內容後重畫手繪線條', () => {
  it('page 的文字變了：畫面更新完之後整頁重畫一次（refresh 收到整個 main）', async () => {
    const state = await mountEnvironment()
    expect(sketch.refresh).not.toHaveBeenCalled()
    state.page.mealsText = `${state.page.mealsText}（預覽時多寫了一大段，底紙要跟著長高）`
    await nextTick()
    await vi.waitFor(() => expect(sketch.refresh).toHaveBeenCalledOnce())
    const root = document.querySelector('main.renv')!
    expect(sketch.refresh).toHaveBeenCalledWith(root)
    // 呼叫的當下，新的文字已經在畫面上（先更新 DOM 再量版面）
    expect(root.textContent).toContain('預覽時多寫了一大段')
  })

  it('refresh 呼叫時 DOM 已經更新（不是更新前就量）', async () => {
    const state = await mountEnvironment()
    let seen = ''
    sketch.refresh.mockImplementation(() => { seen = document.querySelector('#meals .renv-text')?.textContent ?? '' })
    state.page.mealsText = '新的餐點說明'
    await vi.waitFor(() => expect(sketch.refresh).toHaveBeenCalled())
    expect(seen).toBe('新的餐點說明')
    sketch.refresh.mockReset()
  })

  it('campuses 變了（校園探索換場景、換照片）：同樣整頁重畫', async () => {
    const state = await mountEnvironment()
    const campus = state.campuses.find((c) => c.tourScenes.length > 0)!
    campus.tourScenes[0]!.intro = '預覽時改過的場景說明'
    await vi.waitFor(() => expect(sketch.refresh).toHaveBeenCalledOnce())
    expect(sketch.refresh).toHaveBeenCalledWith(document.querySelector('main.renv'))
  })

  it('同一個 tick 內改好幾處只重畫一次；沒有變動就不重畫', async () => {
    const state = await mountEnvironment()
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sketch.refresh).not.toHaveBeenCalled()
    state.page.heroLede = '一'
    state.page.careText = '二'
    state.page.mealsText = '三'
    await vi.waitFor(() => expect(sketch.refresh).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sketch.refresh).toHaveBeenCalledOnce()
  })

  it('餐點時間打到一半（空字串、兩餐同時間）：清單的 key 不重複，不出現 Duplicate keys 警告', async () => {
    const warnings: string[] = []
    const state = reactive({ page: structuredClone(site.environmentPage) })
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp({ render: () => h(EnvironmentContent as Component, { campuses: site.campuses, page: state.page }) })
    app.component('NuxtLink', NuxtLink)
    app.config.warnHandler = (message) => { warnings.push(message) }
    app.mount(host)
    await vi.waitFor(() => expect(document.querySelector('main.renv')).not.toBeNull())
    state.page.meals[1]!.time = ''
    state.page.meals[2]!.time = ''
    state.page.meals[3]!.time = state.page.meals[0]!.time
    await nextTick()
    expect(document.querySelectorAll('.renv-meal')).toHaveLength(5)
    expect(warnings.filter((message) => /duplicate/i.test(message))).toEqual([])
  })

  it('手繪層還沒建好時內容就變了：不丟錯（第一次渲染本來就會量到最新版面）', async () => {
    const state = reactive({ page: structuredClone(site.environmentPage) })
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp({ render: () => h(EnvironmentContent as Component, { campuses: site.campuses, page: state.page }) })
    app.component('NuxtLink', NuxtLink)
    const errors = vi.fn()
    app.config.errorHandler = errors
    app.config.warnHandler = () => {}
    app.mount(host)
    state.page.heroLede = '建好之前就改了'
    await nextTick()
    await vi.waitFor(() => expect(sketch.create).toHaveBeenCalledOnce())
    expect(errors).not.toHaveBeenCalled()
  })
})
