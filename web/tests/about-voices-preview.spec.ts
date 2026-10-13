// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type App, type Component } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { Campus, SiteContent } from '../app/types/site-content'
import AboutContent from '../app/components/AboutContent.vue'
import AboutMedal from '../app/components/AboutMedal.vue'

// 2026-10-12 即時預覽補洞：關於頁第四章選了第 3 支家長影片後，後台把影片刪到只剩 1 支，
// pickedVoice／shownVoice 還停在第 3 支，voices[shownVoice] 是 undefined，整頁預覽畫不出來。
// 影片變少或換掉時要回到第 1 支、停止播放。Nuxt 的自動匯入在單元測試裡沒有，這裡補上（同 about-render.spec.ts）；
// 立體書動畫不載入，沒有動畫時選片直接換：走元件本來就有的「強制色彩模式不載入動畫」那條路（onMounted 一開始就 return）。
// 不用 vi.mock 換掉 about-popup：.vue 裡的動態 import('~/utils/about-popup') 攔不住，載入在等待的 20ms 內完成時
// 會跑到真的動畫、選片被延後，第二項偶發失敗（2026-10-13 main CI 紅過一次，本機約三成）。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
const realMatchMedia = window.matchMedia.bind(window)
vi.stubGlobal('matchMedia', (query: string) => query === '(forced-colors: active)'
  ? { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
  : realMatchMedia(query))

const site = fixture as unknown as SiteContent
const yihua = site.campuses.find((c) => c.key === 'yihua')!
const NuxtLink = defineComponent({
  props: { to: { type: [String, Object], required: true } },
  setup: (props, { slots }) => () => h('a', { href: typeof props.to === 'string' ? props.to : '#' }, slots.default?.())
})

let app: App | null = null
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

const withVoices = (count: number): Campus[] => site.campuses.map((c) => c.key === 'yihua' ? { ...yihua, testimonials: yihua.testimonials!.slice(0, count) } : c)

async function mountAbout() {
  const state = reactive({ campuses: withVoices(4) })
  const errors: unknown[] = []
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(AboutContent as Component, { campuses: state.campuses, page: site.aboutPage }) })
  app.component('NuxtLink', NuxtLink)
  app.component('AboutMedal', AboutMedal as Component)
  app.component('AboutWholePerson', defineComponent({ render: () => null }))
  app.config.warnHandler = () => {}
  app.config.errorHandler = (error) => { errors.push(error) }
  app.mount(host)
  await nextTick()
  // onMounted 裡動態載入幾支模組（失敗也不影響這個測試）：讓它跑完
  await new Promise((resolve) => setTimeout(resolve, 20))
  return { state, errors }
}

const caption = () => document.querySelector('#voices figcaption q')?.textContent
const pressed = () => [...document.querySelectorAll<HTMLElement>('#voices .abk-voice-list button')].map((b) => b.getAttribute('aria-pressed'))

describe('關於頁第四章：即時預覽把家長影片刪到比選中的少', () => {
  it('選第 3 支後影片只剩 1 支：不丟錯、大卡紙回到第 1 支、清單也標在第 1 支、停止播放', async () => {
    const { state, errors } = await mountAbout()
    const quotes = yihua.testimonials!.map((t) => t.quote)
    expect(caption()).toBe(quotes[0])

    document.querySelectorAll<HTMLElement>('#voices .abk-voice-list button')[2]!.click()
    await nextTick()
    expect(caption()).toBe(quotes[2])
    document.querySelector<HTMLElement>('#voices .abk-play')!.click()
    await nextTick()
    expect(document.querySelector('#voices iframe')).not.toBeNull()

    state.campuses = withVoices(1)
    await nextTick()
    await nextTick()

    expect(errors).toEqual([])
    expect(caption()).toBe(quotes[0])
    expect(pressed()).toEqual(['true'])
    expect(document.querySelector('#voices iframe')).toBeNull()
    expect(document.querySelector('#voices .abk-play')).not.toBeNull()
  })

  it('影片還在原位時（改的是別的內容）：選中的那支與播放中的畫面不被重設', async () => {
    const { state, errors } = await mountAbout()
    const quotes = yihua.testimonials!.map((t) => t.quote)
    document.querySelectorAll<HTMLElement>('#voices .abk-voice-list button')[1]!.click()
    await nextTick()
    document.querySelector<HTMLElement>('#voices .abk-play')!.click()
    await nextTick()

    // 預覽每次更新都會換一份新的 campuses（影片同一批、只是第 1 支的說詞改了）
    state.campuses = site.campuses.map((c) => c.key === 'yihua'
      ? { ...yihua, testimonials: yihua.testimonials!.map((t, i) => i === 0 ? { ...t, quote: '預覽時改過的說詞' } : t) }
      : c)
    await nextTick()
    await nextTick()

    expect(errors).toEqual([])
    expect(caption()).toBe(quotes[1])
    expect(pressed()).toEqual(['false', 'true', 'false', 'false'])
    expect(document.querySelector('#voices iframe')).not.toBeNull()
  })

  it('選中的那支被刪掉、後面的補上來（同一個位置變成別支影片）：回到第 1 支、停止播放', async () => {
    const { state, errors } = await mountAbout()
    const quotes = yihua.testimonials!.map((t) => t.quote)
    document.querySelectorAll<HTMLElement>('#voices .abk-voice-list button')[1]!.click()
    await nextTick()
    document.querySelector<HTMLElement>('#voices .abk-play')!.click()
    await nextTick()

    state.campuses = site.campuses.map((c) => c.key === 'yihua'
      ? { ...yihua, testimonials: yihua.testimonials!.filter((_, i) => i !== 1) }
      : c)
    await nextTick()
    await nextTick()

    expect(errors).toEqual([])
    expect(caption()).toBe(quotes[0])
    expect(document.querySelector('#voices iframe')).toBeNull()
  })
})
