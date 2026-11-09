// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, onBeforeUnmount, onMounted, onUnmounted, ref, type App } from 'vue'
import { useHomeFooterFade } from '../app/composables/useHomeFooterFade'
import { useHomeReveal } from '../app/composables/useHomeReveal'
import { useNewsTransition } from '../app/composables/useNewsTransition'

// 2026-11-05 前台流暢度：首頁捲動簾幕、消息紙、頁尾進場（README 同日段落、DESIGN.md 同日章節）。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** 手動推進的 rAF：flush() 跑完目前排著的幀。 */
let frames = new Map<number, FrameRequestCallback>()
let nextFrame = 1
function flush() {
  const due = [...frames.values()]
  frames.clear()
  due.forEach((cb) => cb(0))
}

let supported = true
const matched = new Set<string>()
const mediaListeners = new Map<string, () => void>()
let app: App | null = null

beforeEach(() => {
  // Nuxt 自動匯入在單元測試裡沒有，這裡補上；瀏覽器 API 換成可控制的假物件。
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
  vi.stubGlobal('onUnmounted', onUnmounted)
  frames = new Map()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrame++
    frames.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  supported = true
  matched.clear()
  mediaListeners.clear()
  vi.stubGlobal('CSS', { supports: () => supported })
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return matched.has(query) },
    addEventListener: (_: string, cb: () => void) => mediaListeners.set(query, cb),
    removeEventListener: () => mediaListeners.delete(query)
  }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise(() => {}) } })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1440 })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 800 })
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

/** 換掉元素的 inert，記下每一次寫入（Chromium 同值重設也會改屬性、重算樣式）。 */
function trackInert(el: HTMLElement) {
  let value = false
  const writes: boolean[] = []
  Object.defineProperty(el, 'inert', { configurable: true, get: () => value, set: (next: boolean) => { writes.push(next); value = next } })
  return writes
}

function mountWith(setup: () => void) {
  app = createApp(defineComponent({ setup() { setup(); return () => null } }))
  app.mount(document.createElement('div'))
}

const scroll = () => window.dispatchEvent(new Event('scroll'))

describe('消息紙：inert 同值不寫', () => {
  function mountNews() {
    document.body.innerHTML = '<div class="news-transition"><div class="news-transition-prior"></div><div class="news-transition-paper"></div></div>'
    const root = document.querySelector<HTMLElement>('.news-transition')!
    const previous = document.querySelector<HTMLElement>('.news-transition-prior')!
    const paper = document.querySelector<HTMLElement>('.news-transition-paper')!
    const writes = trackInert(previous)
    const state = { top: 2000 }
    const rect = vi.fn(() => ({ top: state.top }) as DOMRect)
    paper.getBoundingClientRect = rect
    mountWith(() => useNewsTransition(ref(root), ref(previous), ref(paper)))
    flush()
    rect.mockClear()
    return { root, previous, writes, state, rect }
  }

  it('紙還在下方時每幀都是 false，一次都不寫', () => {
    const { writes } = mountNews()
    for (let i = 0; i < 6; i++) { scroll(); flush() }
    expect(writes).toEqual([])
  })

  it('紙蓋滿之後每幀都是 true，只寫一次；退回去再寫一次 false', () => {
    const { previous, writes, state } = mountNews()
    state.top = -10
    for (let i = 0; i < 6; i++) { scroll(); flush() }
    expect(previous.inert).toBe(true)
    state.top = 400
    for (let i = 0; i < 3; i++) { scroll(); flush() }
    expect(previous.inert).toBe(false)
    expect(writes).toEqual([true, false])
  })

  it('原生路徑也是每個捲動幀都量：直接跳到消息時，同一幀就要設好 inert（晚一幀五校的 IO 會把被蓋住的輪播當成看得到）', () => {
    const { root, previous, state, rect } = mountNews()
    expect(root.dataset.newsMotion).toBe('native')
    state.top = -10
    scroll()
    flush()
    expect(rect).toHaveBeenCalledTimes(1)
    expect(previous.inert).toBe(true)
  })

  it('JS 備援照舊寫進度變數', () => {
    supported = false
    const { root, state } = mountNews()
    expect(root.dataset.newsMotion).toBe('fallback')
    state.top = 400
    scroll(); flush()
    expect(root.style.getPropertyValue('--news-paper-progress')).toBe('0.5')
  })
})

describe('首屏揭幕：inert 同值不寫', () => {
  it('actions／media 過門檻各寫一次，hero 沒蓋滿就不寫', () => {
    document.body.innerHTML = `
      <div class="home-reveal"><div class="home-reveal-track"><section class="studio-hero">
        <div class="studio-hero-copy"></div><div class="studio-hero-image"></div><div class="studio-media"></div><div class="studio-actions"></div>
      </section></div></div>`
    const q = (selector: string) => document.querySelector<HTMLElement>(selector)!
    const [root, track, hero, copy, image, media, actions] = ['.home-reveal', '.home-reveal-track', '.studio-hero', '.studio-hero-copy', '.studio-hero-image', '.studio-media', '.studio-actions'].map(q) as HTMLElement[]
    hero!.getBoundingClientRect = () => ({ top: 0, height: 700 }) as DOMRect
    track!.getBoundingClientRect = () => ({ top: 0, height: 1600 }) as DOMRect
    const writes = { hero: trackInert(hero!), media: trackInert(media!), actions: trackInert(actions!) }
    mountWith(() => useHomeReveal({ root: ref(root!), track: ref(track!), hero: ref(hero!), copy: ref(copy!), image: ref(image!), media: ref(media!), actions: ref(actions!) }))
    expect(root!.dataset.motion).toBe('native')
    // 揭幕距離 1600 - 800 = 800px；捲到一半，每幀都在門檻之後
    for (let y = 0; y <= 400; y += 40) {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
      scroll(); flush()
    }
    expect(actions!.inert).toBe(true)
    expect(media!.inert).toBe(true)
    expect(writes).toEqual({ hero: [], media: [true], actions: [true] })
  })
})

describe('頁尾進場 JS 備援：進度寫在消息紙上，不寫整頁', () => {
  function mountFooter() {
    document.body.innerHTML = `
      <div class="home-page"><div class="home-reveal"><div class="news-transition"><div class="news-transition-paper"></div></div></div>
      <div class="home-footer"></div></div>`
    const root = document.querySelector<HTMLElement>('.home-page')!
    const paper = document.querySelector<HTMLElement>('.news-transition-paper')!
    const footer = document.querySelector<HTMLElement>('.home-footer')!
    const state = { top: 1000 }
    footer.getBoundingClientRect = () => ({ top: state.top }) as DOMRect
    Object.defineProperty(footer, 'offsetHeight', { configurable: true, value: 400 })
    mountWith(() => useHomeFooterFade(ref(root), ref(footer)))
    return { root, paper, state }
  }

  it('fallback：寫在 .news-transition-paper，.home-page 不帶變數', () => {
    supported = false
    const { root, paper, state } = mountFooter()
    expect(root.dataset.footerMotion).toBe('fallback')
    state.top = 600
    scroll(); flush()
    expect(paper.style.getPropertyValue('--home-footer-progress')).toBe('0.5')
    expect(root.style.getPropertyValue('--home-footer-progress')).toBe('')
  })

  it('切到減少動態時從同一個元素拿掉', () => {
    supported = false
    const { root, paper, state } = mountFooter()
    state.top = 600
    scroll(); flush()
    matched.add('(prefers-reduced-motion: reduce)')
    mediaListeners.get('(prefers-reduced-motion: reduce)')!()
    expect(root.dataset.footerMotion).toBe('off')
    expect(paper.style.getPropertyValue('--home-footer-progress')).toBe('')
  })

  it('原生路徑完全不寫', () => {
    const { root, paper, state } = mountFooter()
    expect(root.dataset.footerMotion).toBe('native')
    state.top = 600
    scroll(); flush()
    expect(frames.size).toBe(0)
    expect(paper.getAttribute('style')).toBeNull()
    expect(root.style.getPropertyValue('--home-footer-progress')).toBe('')
  })
})

describe('HomeNewsTransition.vue 的頁尾陰影與備援變數', () => {
  const source = read('../app/components/HomeNewsTransition.vue')
  const global = stripComments(source.match(/<style>([\s\S]*?)<\/style>/)![1]!)
  const scoped = stripComments(source.match(/<style scoped>([\s\S]*?)<\/style>/)![1]!)
  const block = (css: string, selector: string) => {
    const start = css.indexOf(`${selector} {`)
    expect(start, selector).toBeGreaterThanOrEqual(0)
    return css.slice(start, css.indexOf('}', start) + 1)
  }
  const footerNative = '.home-page[data-footer-motion="native"] .news-transition[data-news-motion="native"]'

  it('頁尾段不再對 sheet 的 box-shadow 做動畫：rise 結束時 step-end 拿掉，換 ::before 接手', () => {
    expect(global).not.toContain('news-shadow-out')
    const sheet = block(global, `${footerNative} .news-transition-sheet`)
    expect(sheet).toContain('animation: news-sheet-rise linear both, news-shadow-handoff step-end both;')
    expect(sheet).toContain('animation-timeline: --news-paper, --news-paper;')
    expect(global).toContain('@keyframes news-shadow-handoff { from { box-shadow: var(--news-paper-shadow); } to { box-shadow: none; } }')
  })

  it('::before 用同一道陰影，rise 結束才出現，頁尾段只淡 opacity（與暖白覆色同在 60.6% 到底）', () => {
    const before = block(global, `${footerNative} .news-transition-paper::before`)
    expect(before).toContain('position: absolute;')
    expect(before).toContain('inset: 0;')
    expect(before).toContain('pointer-events: none;')
    expect(before).toContain('box-shadow: var(--news-paper-shadow);')
    // 時間軸沒解析成功時退回只有 sheet 一道陰影（基底藏起來，動畫 fill both 蓋過它）
    expect(before).toContain('visibility: hidden;')
    expect(before).toContain('animation: news-shadow-handon step-end both, news-shadow-fade linear both;')
    expect(before).toContain('animation-timeline: --news-paper, --home-footer;')
    expect(before).toContain('animation-range: entry 0% entry 100%, entry 0% entry 100%;')
    expect(global).toContain('@keyframes news-shadow-handon { from { visibility: hidden; } to { visibility: visible; } }')
    expect(global).toContain('@keyframes news-shadow-fade { 0% { opacity: 1; } 60.6%, 100% { opacity: 0; } }')
    expect(global).toContain('@keyframes news-footer-fade-in { 0% { opacity: 0; } 60.6%, 100% { opacity: 1; } }')
  })

  it('減少動態與強制色彩下 ::before 不出現', () => {
    const media = global.slice(global.indexOf('@media (prefers-reduced-motion: reduce), (forced-colors: active)'))
    expect(media).toContain('.news-transition .news-transition-paper::before { display: none; }')
  })

  it('頁尾進場的衍生值宣告在紙上（JS 備援寫在紙上，不寫整頁）', () => {
    const wrapper = block(scoped, '.news-transition')
    expect(wrapper).not.toContain('--news-footer-fade')
    expect(wrapper).not.toContain('--news-paper-shadow')
    const paper = block(scoped, '.news-transition-paper')
    expect(paper).toContain('--news-footer-fade: clamp(0, calc(var(--home-footer-progress, 0) * 1.65), 1);')
    expect(paper).toContain('--news-paper-shadow: 0 -18px 70px rgb(var(--ink) / calc(.16 * (1 - var(--news-footer-fade))));')
  })

  it('減少動態一生效，紙上的 inline 進度就被蓋過（同 index.vue 的 .home-page，不等 JS 的 change 回呼）', () => {
    const media = scoped.slice(scoped.indexOf('@media(prefers-reduced-motion: reduce), (forced-colors: active)'))
    expect(media.slice(0, media.indexOf('@media(forced-colors: active)'))).toContain('.news-transition-paper { --home-footer-progress: 1 !important; }')
    expect(read('../app/pages/index.vue')).toContain('.home-page { animation: none !important; --home-footer-progress: 1 !important; }')
  })
})
