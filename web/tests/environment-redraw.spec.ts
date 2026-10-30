// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type App, type Component } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import EnvironmentContent from '../app/components/EnvironmentContent.vue'

// 2026-10-12 即時預覽補洞，2026-10-30 木頭積木版沿用：後台即時預覽換字、換照片或換場景之後版面高度會變，
// 圓點小路（utils/environment-route.ts，依照片與時間站的位置撒點）要跟著重算。元件要在 page／campuses 變動、
// 畫面更新完之後呼叫 routes.refresh()；正式頁的 props 不會變，所以不受影響。
// Nuxt 的自動匯入在單元測試裡沒有，這裡補上；圓點小路換成假的（refresh 怎麼重算由 environment-route 自己負責，見 environment.spec）。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('nextTick', nextTick)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
vi.stubGlobal('useHead', vi.fn())

const routes = vi.hoisted(() => ({ refresh: vi.fn(), destroy: vi.fn(), create: vi.fn() }))
vi.mock('../app/utils/environment-route', () => ({
  createEnvironmentRoutes: (...args: unknown[]) => {
    routes.create(...args)
    return { refresh: routes.refresh, destroy: routes.destroy }
  }
}))
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
  routes.refresh.mockReset()
  routes.destroy.mockReset()
  routes.create.mockReset()
})

/** 掛起來，等圓點小路建好（onMounted 裡要動態載入）。 */
async function mountEnvironment() {
  const state = reactive({ page: structuredClone(site.environmentPage), campuses: structuredClone(site.campuses) })
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(EnvironmentContent as Component, { campuses: state.campuses, page: state.page }) })
  app.component('NuxtLink', NuxtLink)
  app.config.warnHandler = () => {}
  app.mount(host)
  await vi.waitFor(() => expect(routes.create).toHaveBeenCalledOnce())
  routes.refresh.mockClear()
  return state
}

describe('環境頁即時預覽換內容後重算圓點小路', () => {
  it('圓點小路建在整個 main 上；卸載時拆掉', async () => {
    await mountEnvironment()
    expect(routes.create).toHaveBeenCalledWith(document.querySelector('main.renv'), { reducedMotion: false })
    app!.unmount()
    app = null
    expect(routes.destroy).toHaveBeenCalledOnce()
  })

  it('page 的文字變了：畫面更新完之後重算一次，呼叫的當下新的文字已經在畫面上', async () => {
    const state = await mountEnvironment()
    expect(routes.refresh).not.toHaveBeenCalled()
    let seen = ''
    routes.refresh.mockImplementation(() => { seen = document.querySelector('#meals .renv-text')?.textContent ?? '' })
    state.page.mealsText = '新的餐點說明（預覽時多寫了一大段）'
    await vi.waitFor(() => expect(routes.refresh).toHaveBeenCalledOnce())
    expect(seen).toBe('新的餐點說明（預覽時多寫了一大段）')
  })

  it('campuses 變了（校園探索換場景、換照片）：同樣重算', async () => {
    const state = await mountEnvironment()
    const campus = state.campuses.find((c) => c.tourScenes.length > 0)!
    campus.tourScenes[0]!.name = '預覽時改過的場景名稱'
    await vi.waitFor(() => expect(routes.refresh).toHaveBeenCalledOnce())
  })

  it('同一個 tick 內改好幾處只重算一次；沒有變動就不重算', async () => {
    const state = await mountEnvironment()
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(routes.refresh).not.toHaveBeenCalled()
    state.page.heroLede = '一'
    state.page.careText = '二'
    state.page.mealsText = '三'
    await vi.waitFor(() => expect(routes.refresh).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(routes.refresh).toHaveBeenCalledOnce()
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
    expect(document.querySelectorAll('.renv-day-list > li')).toHaveLength(5)
    expect(warnings.filter((message) => /duplicate/i.test(message))).toEqual([])
  })

  it('圓點小路還沒建好時內容就變了：不丟錯（建的時候本來就量最新版面）', async () => {
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
    await vi.waitFor(() => expect(routes.create).toHaveBeenCalledOnce())
    expect(errors).not.toHaveBeenCalled()
  })
})
