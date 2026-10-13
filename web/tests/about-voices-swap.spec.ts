// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type App, type Component } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { Campus, SiteContent } from '../app/types/site-content'
import AboutContent from '../app/components/AboutContent.vue'
import AboutMedal from '../app/components/AboutMedal.vue'

// 2026-10-13：點了家長影片後，大卡紙要等換片動畫（約半秒）播完才真的換。動畫播到一半即時預覽把影片
// 刪少了：watch 已經回到第 1 支，動畫結束時不能再換到那個已經不存在的位置（voices[3] 是 undefined，
// 整頁預覽畫不出來）。這裡的 about-popup 換成假的：swap 先把「換片」留著，由測試決定什麼時候播完。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
vi.mock('motion', () => ({ animate: vi.fn(), scroll: vi.fn(), inView: vi.fn() }))
const swaps = vi.hoisted(() => [] as (() => void)[])
const popups = vi.hoisted(() => ({ created: 0 }))
vi.mock('../app/utils/about-popup', () => ({
  createAboutPopup: () => {
    popups.created += 1
    return { swap: (_pops: HTMLElement[], update: () => void) => { swaps.push(update) }, destroy: () => {} }
  }
}))

const site = fixture as unknown as SiteContent
const yihua = site.campuses.find((c) => c.key === 'yihua')!
const NuxtLink = defineComponent({
  props: { to: { type: [String, Object], required: true } },
  setup: (props, { slots }) => () => h('a', { href: typeof props.to === 'string' ? props.to : '#' }, slots.default?.())
})

let app: App | null = null
afterEach(() => {
  swaps.length = 0
  popups.created = 0
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
  // 立體書動畫在 onMounted 裡動態載入；載入完才有 swap（慢的機器 20ms 不一定夠）
  await vi.waitFor(() => expect(popups.created).toBe(1))
  return { state, errors }
}

const caption = () => document.querySelector('#voices figcaption q')?.textContent
const pressed = () => [...document.querySelectorAll<HTMLElement>('#voices .abk-voice-list button')].map((b) => b.getAttribute('aria-pressed'))

describe('關於頁第四章：換片動畫播到一半影片被刪少', () => {
  it('動畫結束時選的位置已經不在了：不丟錯、停在第 1 支', async () => {
    const { state, errors } = await mountAbout()
    const quotes = yihua.testimonials!.map((t) => t.quote)
    document.querySelectorAll<HTMLElement>('#voices .abk-voice-list button')[3]!.click()
    await nextTick()
    expect(swaps).toHaveLength(1) // 換片動畫開始，大卡紙還沒換
    expect(caption()).toBe(quotes[0])

    state.campuses = withVoices(1)
    await nextTick()
    swaps[0]!() // 動畫播完
    await nextTick()

    expect(errors).toEqual([])
    expect(caption()).toBe(quotes[0])
    expect(pressed()).toEqual(['true'])
  })

  it('動畫期間只改了別的內容（影片還在原位）：照常換到選的那支', async () => {
    const { state, errors } = await mountAbout()
    const quotes = yihua.testimonials!.map((t) => t.quote)
    document.querySelectorAll<HTMLElement>('#voices .abk-voice-list button')[2]!.click()
    await nextTick()
    state.campuses = site.campuses.map((c) => c.key === 'yihua'
      ? { ...yihua, testimonials: yihua.testimonials!.map((t, i) => i === 0 ? { ...t, quote: '預覽時改過的說詞' } : t) }
      : c)
    await nextTick()
    swaps[0]!()
    await nextTick()

    expect(errors).toEqual([])
    expect(caption()).toBe(quotes[2])
  })
})
