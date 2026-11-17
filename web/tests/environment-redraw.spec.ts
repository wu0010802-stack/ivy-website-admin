// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type App, type Component } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import EnvironmentContent from '../app/components/EnvironmentContent.vue'
import ResponsivePicture from '../app/components/ResponsivePicture.vue'

// 2026-10-12 即時預覽補洞，2026-11-17「拱窗打開」版沿用：後台即時預覽換字、換照片或換場景之後版面會變，
// 捲動敘事（utils/environment-windows.ts：首屏標題收成一列要移多少、五顆心與舞台的尺寸、各段的進度）要跟著重算。
// 元件要在 page／campuses 變動、畫面更新完之後呼叫 windows.refresh()；正式頁的 props 不會變，所以不受影響。
// Nuxt 的自動匯入在單元測試裡沒有，這裡補上；捲動敘事換成假的（refresh 怎麼重算由 environment-windows 自己負責，見 environment-windows-20261117.spec）。
// 2026-11-17 以前這裡守的是圓點小路（utils/environment-route.ts，已刪），測的事情一樣：建一次、內容變了重算一次、卸載時拆掉。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('nextTick', nextTick)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
vi.stubGlobal('useHead', vi.fn())
// 短說明的斷詞結果放在 useState（EnvironmentContent.vue 的 Phrases），單元測試裡用一般的 ref 代替
vi.stubGlobal('useState', <T>(_key: string, init: () => T) => ref(init()))
// 第四章先開哪一校讀網址 ?campus= 與記住的校區（cookie）：這裡一律從第一校開始
vi.stubGlobal('useRoute', () => ({ path: '/environment', query: {} }))
vi.stubGlobal('useRememberedCampus', () => ({ recall: () => null, remember: () => {} }))

const routes = vi.hoisted(() => ({ refresh: vi.fn(), replay: vi.fn(), destroy: vi.fn(), create: vi.fn(), endJump: vi.fn() }))
vi.mock('../app/utils/environment-windows', () => ({
  createEnvironmentWindows: (...args: unknown[]) => {
    routes.create(...args)
    return { refresh: routes.refresh, replay: routes.replay, destroy: routes.destroy }
  },
  smoothNextHashJump: vi.fn(),
  endSmoothHashJump: routes.endJump
}))

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
  routes.replay.mockReset()
  routes.destroy.mockReset()
  routes.create.mockReset()
  routes.endJump.mockReset()
})

/** 掛起來，等捲動敘事建好（onMounted 裡要動態載入）。 */
async function mountEnvironment() {
  const state = reactive({ page: structuredClone(site.environmentPage), campuses: structuredClone(site.campuses) })
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(EnvironmentContent as Component, { campuses: state.campuses, page: state.page }) })
  app.component('NuxtLink', NuxtLink)
  app.component('ResponsivePicture', ResponsivePicture)
  app.config.warnHandler = () => {}
  app.mount(host)
  await vi.waitFor(() => expect(routes.create).toHaveBeenCalledOnce())
  routes.refresh.mockClear()
  return state
}

describe('環境頁即時預覽換內容後重算捲動敘事', () => {
  it('捲動敘事建在整個 main 上（正式頁可以釘住）；卸載時拆掉，暫時開的平滑捲動也收掉', async () => {
    await mountEnvironment()
    expect(routes.create).toHaveBeenCalledWith(document.querySelector('main.renv'), { pin: true })
    app!.unmount()
    app = null
    expect(routes.destroy).toHaveBeenCalledOnce()
    expect(routes.endJump).toHaveBeenCalledOnce()
  })

  it('換校：新面板的窗重新打開；按角落：那張換到大窗、那一校的窗重新打開；下一所：換到下一校', async () => {
    await mountEnvironment()
    const panel = (key: string) => document.querySelector<HTMLElement>(`#tour-${key}`)!
    document.querySelector<HTMLElement>('#tour-tab-minghua')!.click()
    await vi.waitFor(() => expect(routes.replay).toHaveBeenCalledOnce())
    expect(routes.replay).toHaveBeenLastCalledWith(panel('minghua'))
    expect([panel('yihua').hidden, panel('minghua').hidden]).toEqual([true, false])
    // 再點同一個分頁：沒有換校，不重播
    document.querySelector<HTMLElement>('#tour-tab-minghua')!.click()
    await nextTick()
    expect(routes.replay).toHaveBeenCalledOnce()
    const corners = [...panel('minghua').querySelectorAll<HTMLElement>('.renv-corner')]
    corners[2]!.click()
    await vi.waitFor(() => expect(routes.replay).toHaveBeenCalledTimes(2))
    expect(routes.replay).toHaveBeenLastCalledWith(panel('minghua').querySelector('.renv-scenes'))
    expect([...panel('minghua').querySelectorAll('.renv-scene-n')].map((el) => el.textContent)).toEqual(['紅磚迴廊中庭', '戶外廣場', '學習區教室'])
    expect(corners.map((corner) => corner.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true'])
    // 已經在大窗的那一張再按一次：不動
    corners[2]!.click()
    await nextTick()
    expect(routes.replay).toHaveBeenCalledTimes(2)
    // 別校的順序不受影響（各校各記各的）
    expect([...panel('yihua').querySelectorAll('.renv-scene-n')].map((el) => el.textContent)).toEqual(['戶外廣場', '共創教室', '生態花園'])
    panel('minghua').querySelector<HTMLElement>('.renv-panel-next')!.click()
    await vi.waitFor(() => expect(panel('chongde').hidden).toBe(false))
    expect(document.querySelector('#tour-tab-chongde')!.getAttribute('aria-selected')).toBe('true')
  })

  it('後台即時預覽（/preview?embed=1&live=1）不做釘住的敘事：改到哪一個空間，預覽要直接看得到', async () => {
    vi.stubGlobal('useRoute', () => ({ path: '/preview', query: { embed: '1', live: '1' } }))
    try {
      await mountEnvironment()
      expect(routes.create).toHaveBeenCalledWith(document.querySelector('main.renv'), { pin: false })
      expect(document.querySelector('main.renv')!.classList.contains('renv-still')).toBe(true)
    } finally {
      vi.stubGlobal('useRoute', () => ({ path: '/environment', query: {} }))
    }
  })

  it('page 的文字變了：畫面更新完之後重算一次，呼叫的當下新的文字已經在畫面上', async () => {
    const state = await mountEnvironment()
    expect(routes.refresh).not.toHaveBeenCalled()
    let seen = ''
    routes.refresh.mockImplementation(() => { seen = document.querySelector('#meals .renv-meals-p')?.textContent ?? '' })
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
    app.component('ResponsivePicture', ResponsivePicture)
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

  it('捲動敘事還沒建好時內容就變了：不丟錯（建的時候本來就量最新版面）', async () => {
    const state = reactive({ page: structuredClone(site.environmentPage) })
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp({ render: () => h(EnvironmentContent as Component, { campuses: site.campuses, page: state.page }) })
    app.component('NuxtLink', NuxtLink)
    app.component('ResponsivePicture', ResponsivePicture)
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
