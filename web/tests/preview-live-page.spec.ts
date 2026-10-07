// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, onErrorCaptured, onMounted, ref, shallowRef, type App } from 'vue'
import { createMemoryHistory, createRouter, isNavigationFailure, NavigationFailureType, onBeforeRouteLeave, RouterView } from 'vue-router'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import Preview from '../app/pages/preview.vue'

// 2026-10-07 fix round 1：/preview 即時預覽模式的行為（授權順序、握手、錯誤處理、卸載），
// 直接把 preview.vue 掛起來測。Nuxt 的自動匯入與區塊元件換成最小的替身；
// useDraftPreview 換成可控的假的（它自己的行為在 use-draft-preview.spec）。
const ORIGIN = 'https://ivy.example'
const CAMPUS_KEYS = ['yihua', 'minghua', 'chongde', 'international', 'renwu']
const site = fixture as unknown as SiteContent

let query: Record<string, string> = {}
const useDraftPreview = vi.fn()
vi.stubGlobal('useDraftPreview', useDraftPreview)
vi.stubGlobal('definePageMeta', vi.fn())
vi.stubGlobal('useHead', vi.fn())
vi.stubGlobal('useRoute', () => ({ query }))
vi.stubGlobal('useRouter', () => ({ replace: vi.fn() }))
for (const [name, fn] of Object.entries({ computed, nextTick, onBeforeUnmount, onErrorCaptured, onMounted, ref, shallowRef })) vi.stubGlobal(name, fn)
// 一般測試沒有路由，守衛不掛（vue-router 的 onBeforeRouteLeave 找不到路由會警告）；「路由守衛」那組才用真的。
let realRouter = false
vi.stubGlobal('onBeforeRouteLeave', (guard: Parameters<typeof onBeforeRouteLeave>[0]) => { if (realRouter) onBeforeRouteLeave(guard) })

const Stub = defineComponent({
  props: ['content', 'hero', 'about', 'day', 'board', 'campuses', 'news', 'admission', 'page', 'policy', 'booking'],
  render: () => h('div')
})
const SiteFooter = defineComponent({
  props: ['content'],
  render() {
    if (String(this.content.footer.tagline).startsWith('KABOOM')) throw new Error('區塊畫不出來')
    return h('footer', { class: 'footer' }, [h('p', this.content.footer.tagline), h('a', { href: '/about', id: 'out' }, '前往')])
  }
})

const parentWindow = { postMessage: vi.fn() }
const originalParent = Object.getOwnPropertyDescriptor(window, 'parent')
let app: App | null = null
let errorHandler: ReturnType<typeof vi.fn>

interface FakeOptions { authorized?: boolean, failSaved?: boolean, savedTagline?: string }
function fakeResult({ authorized = true, failSaved = false, savedTagline }: FakeOptions = {}) {
  const render = vi.fn((_date: string, live?: { kind: string, payload: Record<string, unknown> } | null) => {
    if (failSaved || (live && live.payload.boom)) throw new Error('boom')
    const content = structuredClone(site)
    if (savedTagline) content.footer.tagline = savedTagline
    if (live?.kind === 'site_footer') content.footer.tagline = String(live.payload.tagline)
    return { content, hiddenNews: [] }
  })
  return { authorized, campusKeys: authorized ? CAMPUS_KEYS : [], render: authorized ? render : null }
}

function mountPreview(result: ReturnType<typeof fakeResult>) {
  useDraftPreview.mockResolvedValue(result)
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp(Preview as never)
  errorHandler = vi.fn()
  app.config.errorHandler = errorHandler
  app.config.warnHandler = () => {}
  for (const name of ['SiteHeader', 'AdmissionContent', 'CurriculumContent', 'AboutContent', 'EnvironmentContent', 'PrivacyPolicyContent', 'BookingDraftPreview', 'HeroVideo', 'AboutSection', 'DayExperience', 'CampusBoard', 'NewsDialog', 'NuxtLink']) app.component(name, Stub)
  app.component('SiteFooter', SiteFooter)
  app.mount(host)
  return result
}

const draft = (seq: number, payload: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  type: 'ivy-preview:draft', v: 1, seq, kind: 'site_footer', campusKey: null, payload, page: 'home',
  focus: { block: 'site-footer', campusKey: null, probe: null, mark: true }, ...over
})
function deliver(data: unknown, over: Record<string, unknown> = {}) {
  const event = new Event('message')
  Object.assign(event, { data, origin: ORIGIN, source: parentWindow, ...over })
  window.dispatchEvent(event)
}
const replies = () => parentWindow.postMessage.mock.calls.map(([message]) => message as Record<string, unknown>)
const repliesOf = (type: string) => replies().filter((message) => message.type === type)
const settle = async () => { for (let i = 0; i < 4; i++) { await nextTick(); await new Promise((resolve) => setTimeout(resolve, 5)) } }
const footerText = () => document.querySelector('.footer p')?.textContent ?? null

beforeEach(() => {
  query = { embed: '1', live: '1' }
  ;(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${ORIGIN}/preview?embed=1&live=1`)
  Object.defineProperty(window, 'parent', { value: parentWindow, configurable: true })
  parentWindow.postMessage.mockClear()
  realRouter = false
})
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  if (originalParent) Object.defineProperty(window, 'parent', originalParent)
})

describe('/preview 即時預覽模式', () => {
  it('授權後才收訊息：先回 ready，之後後台的草稿蓋上去並回報 applied（targetOrigin 是自己的來源）', async () => {
    const result = mountPreview(fakeResult())
    await vi.waitFor(() => expect(repliesOf('ivy-preview:ready')).toHaveLength(1))
    expect(parentWindow.postMessage).toHaveBeenCalledWith({ v: 1, type: 'ivy-preview:ready' }, ORIGIN)
    expect(footerText()).toBe(site.footer.tagline)
    deliver(draft(1, { tagline: '還沒存的標語' }))
    await vi.waitFor(() => expect(repliesOf('ivy-preview:applied')).toHaveLength(1))
    expect(footerText()).toBe('還沒存的標語')
    expect(repliesOf('ivy-preview:applied')[0]).toMatchObject({ seq: 1, hit: 'block' })
    expect(result.render).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ kind: 'site_footer' }))
  })

  it('不是外層後台頁送的訊息一律不理（別的來源、別的視窗）', async () => {
    mountPreview(fakeResult())
    await vi.waitFor(() => expect(repliesOf('ivy-preview:ready')).toHaveLength(1))
    deliver(draft(1, { tagline: '別的來源' }), { origin: 'https://evil.example' })
    deliver(draft(2, { tagline: '別的視窗' }), { source: {} })
    await settle()
    expect(footerText()).toBe(site.footer.tagline)
    expect(repliesOf('ivy-preview:applied')).toHaveLength(0)
  })

  it('沒授權：只回 denied，不掛 message listener、不回 ready，之後的訊息也不處理', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const result = mountPreview(fakeResult({ authorized: false }))
    await vi.waitFor(() => expect(repliesOf('ivy-preview:denied')).toHaveLength(1))
    deliver(draft(1, { tagline: '不該出現' }))
    await settle()
    expect(add.mock.calls.filter(([type]) => type === 'message')).toHaveLength(0)
    expect(repliesOf('ivy-preview:ready')).toHaveLength(0)
    expect(repliesOf('ivy-preview:applied')).toHaveLength(0)
    expect(result.render).toBeNull()
    expect(document.body.textContent).toContain('只給已登入的後台管理者')
  })

  it('一般預覽（沒有 live=1）：不回任何訊息、不掛 listener', async () => {
    query = { embed: '1' }
    const add = vi.spyOn(window, 'addEventListener')
    mountPreview(fakeResult())
    await settle()
    deliver(draft(1, { tagline: '不該出現' }))
    await settle()
    expect(replies()).toEqual([])
    expect(add.mock.calls.filter(([type]) => type === 'message')).toHaveLength(0)
    expect(footerText()).toBe(site.footer.tagline)
  })

  it('這一則內容畫不出來：停在上一個畫面、console.error 記一筆（只在 iframe 裡）、回報 failed；下一則好的照常接上', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    mountPreview(fakeResult())
    await vi.waitFor(() => expect(repliesOf('ivy-preview:ready')).toHaveLength(1))
    deliver(draft(1, { tagline: '第一版' }))
    await vi.waitFor(() => expect(repliesOf('ivy-preview:applied')).toHaveLength(1))
    deliver(draft(2, { tagline: '壞的', boom: true }))
    await vi.waitFor(() => expect(repliesOf('ivy-preview:applied')).toHaveLength(2))
    expect(repliesOf('ivy-preview:applied')[1]).toEqual({ v: 1, type: 'ivy-preview:applied', seq: 2, hit: 'failed' })
    expect(footerText()).toBe('第一版')
    expect(logged).toHaveBeenCalled()
    expect(errorHandler).not.toHaveBeenCalled()
    expect(document.querySelector('.footer')).not.toBeNull()
    deliver(draft(3, { tagline: '第三版' }))
    await vi.waitFor(() => expect(repliesOf('ivy-preview:applied')).toHaveLength(3))
    expect(footerText()).toBe('第三版')
    expect(repliesOf('ivy-preview:applied')[2]).toMatchObject({ seq: 3, hit: 'block' })
  })

  it('已存草稿就畫不出來：錯誤照常丟出去、不送 ready、不掛 message listener（預覽欄不會空白還說自己是即時的）', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mountPreview(fakeResult({ failSaved: true }))
    await vi.waitFor(() => expect(errorHandler).toHaveBeenCalled())
    await settle()
    expect(repliesOf('ivy-preview:ready')).toHaveLength(0)
    expect(add.mock.calls.filter(([type]) => type === 'message')).toHaveLength(0)
    deliver(draft(1, { tagline: '不該出現' }))
    await settle()
    expect(repliesOf('ivy-preview:applied')).toHaveLength(0)
  })

  it('某個區塊被這一則內容弄到畫不出來：錯誤停在預覽頁（記 console、不換成整頁錯誤）、回報 failed；下一則好的接得上', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    mountPreview(fakeResult())
    await vi.waitFor(() => expect(repliesOf('ivy-preview:ready')).toHaveLength(1))
    deliver(draft(1, { tagline: 'KABOOM 區塊' }))
    await vi.waitFor(() => expect(repliesOf('ivy-preview:applied')).toHaveLength(1))
    expect(repliesOf('ivy-preview:applied')[0]).toEqual({ v: 1, type: 'ivy-preview:applied', seq: 1, hit: 'failed' })
    expect(logged).toHaveBeenCalled()
    expect(errorHandler).not.toHaveBeenCalled()
    deliver(draft(2, { tagline: '修好了' }))
    await vi.waitFor(() => expect(repliesOf('ivy-preview:applied')).toHaveLength(2))
    expect(footerText()).toBe('修好了')
    expect(repliesOf('ivy-preview:applied')[1]).toMatchObject({ seq: 2, hit: 'block' })
  })

  it('已存草稿的區塊畫不出來：錯誤照常往上丟、不送 ready', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mountPreview(fakeResult({ savedTagline: 'KABOOM 已存' }))
    await vi.waitFor(() => expect(errorHandler).toHaveBeenCalled())
    await settle()
    expect(repliesOf('ivy-preview:ready')).toHaveLength(0)
  })

  it('failed 和 none 分開：畫不出來回 failed；畫得出來但找不到位置（或這次改的不在這一塊）回 none', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mountPreview(fakeResult())
    await vi.waitFor(() => expect(repliesOf('ivy-preview:ready')).toHaveLength(1))
    const lost = { block: 'page-top', campusKey: null, probe: '這段文字不在畫面上', mark: true }
    deliver(draft(1, { tagline: '找不到位置' }, { focus: lost }))
    await vi.waitFor(() => expect(repliesOf('ivy-preview:applied')).toHaveLength(1))
    deliver(draft(2, { tagline: '改的不在這一塊' }, { focus: { ...lost, mark: false } }))
    await vi.waitFor(() => expect(repliesOf('ivy-preview:applied')).toHaveLength(2))
    deliver(draft(3, { tagline: '壞的', boom: true }, { focus: lost }))
    await vi.waitFor(() => expect(repliesOf('ivy-preview:applied')).toHaveLength(3))
    expect(repliesOf('ivy-preview:applied').map((reply) => [reply.seq, reply.hit])).toEqual([[1, 'none'], [2, 'none'], [3, 'failed']])
  })

  it('預覽裡點連結不換頁', async () => {
    mountPreview(fakeResult())
    await vi.waitFor(() => expect(repliesOf('ivy-preview:ready')).toHaveLength(1))
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.getElementById('out')!.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
  })

  // 2026-10-07 最終審查 I1：官網元件自己呼叫 navigateTo（首頁五校「預約參觀」的照片接續換頁）不經過連結點擊，
  // stayOnPreview 攔不到。這裡用真的 vue-router 驗路由守衛：即時模式離不開 /preview，只換 query 不受影響。
  describe('即時模式不准離開 /preview（路由守衛）', () => {
    async function mountInRouter(result: ReturnType<typeof fakeResult>) {
      realRouter = true
      useDraftPreview.mockResolvedValue(result)
      const history = createMemoryHistory()
      history.replace('/preview?embed=1&live=1')
      const router = createRouter({
        history,
        routes: [
          { path: '/preview', component: Preview as never },
          { path: '/visit/:campus', component: { render: () => h('div', { id: 'visit' }) } }
        ]
      })
      const host = document.createElement('div')
      document.body.append(host)
      app = createApp({ render: () => h(RouterView) })
      errorHandler = vi.fn()
      app.config.errorHandler = errorHandler
      app.config.warnHandler = () => {}
      for (const name of ['SiteHeader', 'AdmissionContent', 'CurriculumContent', 'AboutContent', 'EnvironmentContent', 'PrivacyPolicyContent', 'BookingDraftPreview', 'HeroVideo', 'AboutSection', 'DayExperience', 'CampusBoard', 'NewsDialog', 'NuxtLink']) app.component(name, Stub)
      app.component('SiteFooter', SiteFooter)
      app.use(router)
      app.mount(host)
      await router.isReady()
      return router
    }

    it('navigateTo／router.push 到別頁被擋下，仍留在 /preview；預覽照常收得到草稿', async () => {
      const router = await mountInRouter(fakeResult())
      await vi.waitFor(() => expect(repliesOf('ivy-preview:ready')).toHaveLength(1))
      const failure = await router.push('/visit/yihua')
      expect(isNavigationFailure(failure, NavigationFailureType.aborted)).toBe(true)
      expect(router.currentRoute.value.path).toBe('/preview')
      expect(document.querySelector('#visit')).toBeNull()
      deliver(draft(1, { tagline: '擋住之後還收得到' }))
      await vi.waitFor(() => expect(repliesOf('ivy-preview:applied')).toHaveLength(1))
      expect(footerText()).toBe('擋住之後還收得到')
    })

    it('同一頁只換 query（寬度、日期）不算離開，不受影響', async () => {
      const router = await mountInRouter(fakeResult())
      await vi.waitFor(() => expect(repliesOf('ivy-preview:ready')).toHaveLength(1))
      const result = await router.replace({ path: '/preview', query: { embed: '1', live: '1', viewport: 'mobile' } })
      expect(result).toBeUndefined()
      expect(router.currentRoute.value.query.viewport).toBe('mobile')
    })

    it('不是即時模式（一般的草稿預覽）不加這道限制', async () => {
      query = {}
      const router = await mountInRouter(fakeResult())
      await settle()
      const failure = await router.push('/visit/yihua')
      expect(failure).toBeUndefined()
      expect(router.currentRoute.value.path).toBe('/visit/yihua')
    })
  })

  it('卸載時拿掉 message listener 與點擊攔截；卸載之後送來的訊息不處理', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const removeDoc = vi.spyOn(document, 'removeEventListener')
    const result = mountPreview(fakeResult())
    await vi.waitFor(() => expect(repliesOf('ivy-preview:ready')).toHaveLength(1))
    app!.unmount()
    app = null
    expect(remove.mock.calls.some(([type]) => type === 'message')).toBe(true)
    expect(removeDoc.mock.calls.some(([type]) => type === 'click')).toBe(true)
    deliver(draft(1, { tagline: '卸載後' }))
    await settle()
    expect(repliesOf('ivy-preview:applied')).toHaveLength(0)
    expect(result.render).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: 'site_footer' }))
  })

  it('授權成功、畫完之前就卸載：不掛 listener、不送 ready', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const base = fakeResult()
    // 讀 render 的當下排一個卸載：它會在 onMounted 等畫面更新（await nextTick）的空檔裡發生。
    const result = { authorized: true, campusKeys: CAMPUS_KEYS, get render() { queueMicrotask(() => { app?.unmount(); app = null }); return base.render } }
    mountPreview(result as unknown as ReturnType<typeof fakeResult>)
    await settle()
    expect(app).toBeNull()
    expect(add.mock.calls.filter(([type]) => type === 'message')).toHaveLength(0)
    expect(repliesOf('ivy-preview:ready')).toHaveLength(0)
  })

  it('授權結果回來前就卸載：不掛 listener、不回任何訊息', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    let release: (value: ReturnType<typeof fakeResult>) => void = () => {}
    useDraftPreview.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp(Preview as never)
    app.config.warnHandler = () => {}
    for (const name of ['SiteHeader', 'HeroVideo', 'AboutSection', 'DayExperience', 'CampusBoard', 'NewsDialog']) app.component(name, Stub)
    app.component('SiteFooter', SiteFooter)
    app.mount(host)
    app.unmount()
    app = null
    release(fakeResult())
    await settle()
    expect(add.mock.calls.filter(([type]) => type === 'message')).toHaveLength(0)
    expect(replies()).toEqual([])
  })
})
