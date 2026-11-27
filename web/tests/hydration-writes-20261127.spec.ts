// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, onBeforeUnmount, onMounted, onUnmounted, ref, type App } from 'vue'
import { useCurtain } from '../app/composables/useCurtain'
import { useHomeFooterFade } from '../app/composables/useHomeFooterFade'
import { useNewsTransition } from '../app/composables/useNewsTransition'

// 2026-11-27 首頁 hydration：量出來的長度寫在讀它的元素上（studio.css 註冊成不繼承），
// 不寫在簾幕根、消息根、.home-page 上。寫在大祖先上時，掛載中下一個元件一量，就整個子樹同步重算樣式。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const NON_INHERITED = ['--belief-own', '--belief-stick', '--day-own', '--day-stick', '--news-prior-stick', '--home-footer-screen']

let app: App | null = null
beforeEach(() => {
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
  vi.stubGlobal('onUnmounted', onUnmounted)
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('CSS', { supports: () => true })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise(() => {}) } })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1440 })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 800 })
})
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})
const mountWith = (setup: () => void) => {
  app = createApp(defineComponent({ setup() { setup(); return () => null } }))
  app.mount(document.createElement('div'))
}
const box = (el: HTMLElement, height: number) => { el.getBoundingClientRect = () => ({ top: 0, height }) as DOMRect }

describe('studio.css 註冊', () => {
  it.each(NON_INHERITED)('%s：syntax * 不繼承、不設 initial-value（沒寫之前 var() 落到後備值）', (name) => {
    expect(read('../app/assets/css/studio.css')).toContain(`@property ${name} {syntax:'*';inherits:false}`)
  })
})

describe('寫在讀者身上', () => {
  it('簾幕：--own 寫在 track、--stick 寫在 panel，根只有 data-motion', () => {
    document.body.innerHTML = '<div class="home-reveal"><div class="r"><div class="t"><section class="p"></section></div></div></div>'
    const root = document.querySelector<HTMLElement>('.r')!
    const track = document.querySelector<HTMLElement>('.t')!
    const panel = document.querySelector<HTMLElement>('.p')!
    box(track, 2400); box(panel, 1000)
    mountWith(() => useCurtain(ref(root), ref(track), ref(panel), 'day'))
    expect(track.style.getPropertyValue('--day-own')).toBe('1000px')
    expect(panel.style.getPropertyValue('--day-stick')).toBe('-200px')
    expect(root.style.getPropertyValue('--day-own')).toBe('')
    expect(root.style.getPropertyValue('--day-stick')).toBe('')
    expect(root.dataset.motion).toBe('on')
  })

  it('消息紙：--news-screen 寫在紙上、--news-prior-stick 寫在五校上，消息根不寫', () => {
    document.body.innerHTML = '<div class="home-reveal"><div class="n"><div class="prior"></div><div class="paper"></div></div></div>'
    const root = document.querySelector<HTMLElement>('.n')!
    const previous = document.querySelector<HTMLElement>('.prior')!
    const paper = document.querySelector<HTMLElement>('.paper')!
    Object.defineProperty(previous, 'offsetHeight', { configurable: true, value: 1100 })
    box(paper, 900)
    mountWith(() => useNewsTransition(ref(root), ref(previous), ref(paper)))
    expect(paper.style.getPropertyValue('--news-screen')).toBe('800px')
    expect(previous.style.getPropertyValue('--news-prior-stick')).toBe('-300px')
    expect(root.getAttribute('style') ?? '').not.toMatch(/--news-(screen|prior-stick)/)
  })

  it('頁尾：--home-footer-screen 寫在頁尾上，.home-page 不寫', () => {
    document.body.innerHTML = '<div class="home-page"><div class="home-reveal"></div><div class="home-footer"></div></div>'
    const root = document.querySelector<HTMLElement>('.home-page')!
    const footer = document.querySelector<HTMLElement>('.home-footer')!
    mountWith(() => useHomeFooterFade(ref(root), ref(footer)))
    expect(footer.style.getPropertyValue('--home-footer-screen')).toBe('800px')
    expect(root.style.getPropertyValue('--home-footer-screen')).toBe('')
  })

  it('CSS 的讀者沒有換人：track／panel／五校／頁尾自己讀', () => {
    const studio = read('../app/assets/css/studio.css')
    for (const prefix of ['belief', 'day']) expect(studio).toMatch(new RegExp(`\\.${prefix}-reveal-track \\{height:calc\\(var\\(--${prefix}-own,100svh\\)`))
    expect(studio).toContain('.home-belief {position:sticky;top:var(--belief-stick,0px)')
    expect(studio).toContain('.day-experience {position:sticky;top:var(--day-stick,0px)')
    const news = read('../app/components/HomeNewsTransition.vue')
    expect(news).toMatch(/\.news-transition-prior \{\s*position: sticky;\s*top: var\(--news-prior-stick, 0px\);/)
    expect(read('../app/pages/index.vue')).toMatch(/\.home-footer \{[^}]*var\(--home-footer-screen, 100svh\)/)
  })
})
