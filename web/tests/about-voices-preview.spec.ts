// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type App, type Component } from 'vue'
import fixture from '../server/data/site-fixture.json'
import type { Campus, SiteContent } from '../app/types/site-content'
import AboutContent from '../app/components/AboutContent.vue'
import AboutYear from '../app/components/AboutYear.vue'
import ResponsivePicture from '../app/components/ResponsivePicture.vue'

// 後台即時預覽（/preview）會在看著的時候刪影片、換順序、改說詞，關於頁第四章不能因此壞掉。
// 2026-10-12 的原始問題：選了第 3 支後影片刪到只剩 1 支，voices[shownVoice] 是 undefined，整頁預覽畫不出來。
// 2026-11-11 整頁重做後一位家長一張影片卡、各自原地播（playingId 記正在播的那支影片）：沒有「選中的那一支」了，
// 要守的是：正在播的那支被刪掉就停、還在就不重設、一次只播一支。
// Nuxt 的自動匯入在單元測試裡沒有，這裡補上（同 about-render.spec.ts）。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('watch', watch)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)

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
  app.component('ResponsivePicture', ResponsivePicture)
  app.component('AboutYear', AboutYear)
  app.config.warnHandler = () => {}
  app.config.errorHandler = (error) => { errors.push(error) }
  app.mount(host)
  await nextTick()
  return { state, errors }
}

const cards = () => [...document.querySelectorAll<HTMLElement>('#voices .abh-voice')]
const playing = () => cards().map((card) => card.querySelector('iframe') !== null)
const speakers = () => cards().map((card) => card.querySelector('small')?.textContent)
const play = (index: number) => cards()[index]!.querySelector<HTMLElement>('.abh-play')!.click()

describe('關於頁第四章：即時預覽改家長影片時', () => {
  it('一位家長一張影片卡；按了哪一張就在那一張原地播，再按別張，前一張回到封面', async () => {
    await mountAbout()
    expect(speakers()).toEqual(yihua.testimonials!.map((t) => t.speaker))
    expect(playing()).toEqual([false, false, false, false])
    play(2)
    await nextTick()
    expect(playing()).toEqual([false, false, true, false])
    expect(cards()[2]!.querySelector('iframe')!.getAttribute('src')).toContain(`youtube-nocookie.com/embed/${yihua.testimonials![2]!.youtubeId}`)
    play(0)
    await nextTick()
    expect(playing()).toEqual([true, false, false, false])
  })

  it('播著第 3 支時影片刪到只剩 1 支：不丟錯、停止播放、剩一張封面', async () => {
    const { state, errors } = await mountAbout()
    play(2)
    await nextTick()
    expect(playing()).toEqual([false, false, true, false])

    state.campuses = withVoices(1)
    await nextTick()
    await nextTick()

    expect(errors).toEqual([])
    expect(playing()).toEqual([false])
    expect(cards()[0]!.querySelector('.abh-play')).not.toBeNull()
  })

  it('正在播的影片還在（改的是別的內容）：播放中的畫面不被重設', async () => {
    const { state, errors } = await mountAbout()
    play(1)
    await nextTick()
    const frame = cards()[1]!.querySelector('iframe')

    // 預覽每次更新都會換一份新的 campuses（影片同一批、只是第 1 支的說詞改了）
    state.campuses = site.campuses.map((c) => c.key === 'yihua'
      ? { ...yihua, testimonials: yihua.testimonials!.map((t, i) => i === 0 ? { ...t, quote: '預覽時改過的說詞' } : t) }
      : c)
    await nextTick()
    await nextTick()

    expect(errors).toEqual([])
    expect(cards()[0]!.querySelector('q')!.textContent).toBe('預覽時改過的說詞')
    expect(playing()).toEqual([false, true, false, false])
    // 同一個 iframe 節點（沒有被拆掉重建，影片不會從頭播）
    expect(cards()[1]!.querySelector('iframe')).toBe(frame)
  })

  it('正在播的那支被刪掉、後面的補上來：停止播放，補上來的那張是封面', async () => {
    const { state, errors } = await mountAbout()
    play(1)
    await nextTick()

    state.campuses = site.campuses.map((c) => c.key === 'yihua'
      ? { ...yihua, testimonials: yihua.testimonials!.filter((_, i) => i !== 1) }
      : c)
    await nextTick()
    await nextTick()

    expect(errors).toEqual([])
    expect(playing()).toEqual([false, false, false])
    expect(speakers()[1]).toBe(yihua.testimonials![2]!.speaker)
  })

  it('正在播的那支換了位置（前面一支被刪掉）：跟著影片走，繼續播', async () => {
    const { state, errors } = await mountAbout()
    play(2)
    await nextTick()

    state.campuses = site.campuses.map((c) => c.key === 'yihua'
      ? { ...yihua, testimonials: yihua.testimonials!.filter((_, i) => i !== 0) }
      : c)
    await nextTick()
    await nextTick()

    expect(errors).toEqual([])
    expect(playing()).toEqual([false, true, false])
  })
})
