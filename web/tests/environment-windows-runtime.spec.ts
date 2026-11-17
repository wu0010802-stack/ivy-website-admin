// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEnvironmentWindows, MOTION_QUERY, PIN_QUERY, type EnvironmentWindows } from '../app/utils/environment-windows'

// 真正建立模組、派發 scroll / media change / resize；只替沒有 layout 的 DOM 提供幾何量測。
// 完整瀏覽器落點與導航由 tests/e2e/environment-windows.spec.ts 驗證。
let instance: EnvironmentWindows | undefined
let root: HTMLElement
let y: number
let frames: Map<number, FrameRequestCallback>
let now: number
let media: Map<string, MediaQueryList>

function flush() {
  const pending = [...frames.values()]
  frames.clear()
  now += 16.67
  pending.forEach(callback => callback(now))
}
function change(query: string, matches: boolean) {
  Object.assign(media.get(query)!, { matches })
  media.get(query)!.dispatchEvent(new Event('change'))
}

beforeEach(async () => {
  y = 0
  now = 0
  frames = new Map()
  media = new Map()
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key))
  vi.stubGlobal('innerHeight', 900)
  vi.stubGlobal('innerWidth', 1440)
  vi.stubGlobal('CSS', { supports: () => true })
  vi.stubGlobal('ResizeObserver', undefined)
  vi.stubGlobal('matchMedia', (query: string) => {
    if (!media.has(query)) media.set(query, Object.assign(new EventTarget(), { matches: query === PIN_QUERY || query === MOTION_QUERY, media: query }) as MediaQueryList)
    return media.get(query)!
  })
  document.body.innerHTML = `<header class="header"></header><main class="renv">
    <section class="renv-hero"><div class="renv-hero-stage"><div class="renv-hero-txt"><div class="renv-hero-txt-in"><h1 class="renv-h-title" style="font-size:80px"><span class="renv-h-line">孩子</span></h1></div></div></div></section>
    <section class="renv-hearts"><div class="renv-hwin"><div class="renv-hwin-ph"></div></div><svg class="renv-hlids"><g class="renv-lid"></g></svg><ul class="renv-hnames"></ul></section>
    <section class="renv-stops-sec"><div class="renv-stops-stage"><div class="renv-stops-in"><div class="renv-stop" data-sh="rect"><figure class="renv-win renv-door"></figure></div><div class="renv-stop" data-sh="circle"><figure class="renv-win renv-door"></figure></div><button class="renv-sn"></button><button class="renv-sn"></button></div></div></section>
    <div class="renv-day-tl"><div class="renv-day-i"></div></div>
  </main>`
  root = document.querySelector('main')!
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
    if (this.classList.contains('header')) return 93
    if (this.classList.contains('renv-hero')) return 1752
    if (this.classList.contains('renv-stops-sec')) return 2112
    return 807
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const top = this.classList.contains('renv-hero') ? 93 : 3000
    return { x: 0, y: top - y, top: top - y, bottom: top - y + 500, left: 0, right: 1200, width: 1200, height: 500, toJSON() {} }
  })
  instance = createEnvironmentWindows(root)
  await Promise.resolve()
  flush()
})

afterEach(() => {
  instance?.destroy()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('環境頁捲動模組執行時', () => {
  it('同一幀先量完再寫，首屏只量一次、畫一次，不重新讀高度', () => {
    const order: string[] = []
    const hero = root.querySelector<HTMLElement>('.renv-hero')!
    const stage = root.querySelector<HTMLElement>('.renv-hero-stage')!
    const rect = vi.mocked(hero.getBoundingClientRect).getMockImplementation()!
    const read = vi.fn(() => { order.push('read'); return rect.call(hero) })
    Object.defineProperty(hero, 'getBoundingClientRect', { configurable: true, value: read })
    const height = vi.spyOn(hero, 'offsetHeight', 'get').mockClear()
    const set = stage.style.setProperty.bind(stage.style)
    const writes = vi.spyOn(stage.style, 'setProperty').mockImplementation((name, value, priority) => { order.push('write'); set(name, value, priority) })
    y = 700
    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('scroll'))
    expect(frames.size).toBe(1)
    flush()
    expect(read).toHaveBeenCalledTimes(1)
    expect(height).not.toHaveBeenCalled()
    expect(order[0]).toBe('read')
    expect(order.lastIndexOf('read')).toBeLessThan(order.indexOf('write'))
    expect(writes.mock.calls.filter(([key]) => key === '--qt')).toHaveLength(1)
    expect(writes.mock.calls.filter(([key]) => key === '--q').length).toBeLessThanOrEqual(1)
    for (let i = 0; i < 150; i++) flush()
    expect(Number(stage.style.getPropertyValue('--q'))).toBeLessThan(0.03)
    expect(frames.size).toBe(0)
  })

  it('減少動態會開啟所有窗，重新啟用可再捲動；preview 不釘住', () => {
    change(MOTION_QUERY, false)
    expect(document.documentElement.classList.contains('renv-pin')).toBe(false)
    expect(root.querySelector('.is-shut')).toBeNull()
    expect(root.querySelector<HTMLElement>('.renv-hero-stage')!.style.getPropertyValue('--q')).toBe('')
    change(MOTION_QUERY, true)
    expect(document.documentElement.classList.contains('renv-pin')).toBe(true)
    instance!.destroy()
    instance = createEnvironmentWindows(root, { pin: false })
    expect(document.documentElement.classList.contains('renv-pin')).toBe(false)
    expect(document.documentElement.classList.contains('renv-fx')).toBe(true)
  })

  it('換校重播後立刻離頁會取消兩層動畫排程，清除 SVG 與全域狀態', () => {
    instance!.replay(root)
    expect(frames.size).toBeGreaterThan(0)
    flush() // 第一層已執行，第二層仍在等
    instance!.destroy()
    expect(frames.size).toBe(0)
    expect(document.documentElement.className).not.toMatch(/renv-(pin|fx)/)
    expect(root.querySelector('.is-shut')).toBeNull()
    expect(root.querySelector('.renv-lid')!.hasAttribute('transform')).toBe(false)
    expect(root.querySelector('.renv-hlids')!.hasAttribute('viewBox')).toBe(false)
    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
    instance!.replay(root)
    expect(frames.size).toBe(0)
  })
})
