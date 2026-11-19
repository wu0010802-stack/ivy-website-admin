// 年份滑桿（2026-11-16 規格 §5.3）：el-slider 用索引、▶／❚❚ 每 1 秒前進一格到最後一格停、拖動與換格子都停、
// 偏好減少動態時不放播放鈕。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import ChildrenYearSlider from '../components/admissions/area/ChildrenYearSlider.vue'
import type { YearStop } from '../components/admissions/area/childrenHistory'
import { cleanup, mountWith } from './admissionsTestKit'

const STOPS: YearStop[] = [107, 108, 114, 115, 'latest']
const LABELS = { '107': '107', '108': '108', '114': '114', '115': '115', latest: '最新 115.10' }

function reducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matches && query.includes('prefers-reduced-motion'),
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) as never
}

async function mountSlider(modelValue: YearStop = 107, stops: YearStop[] = STOPS) {
  const { wrapper } = await mountWith(ChildrenYearSlider, { props: { stops, modelValue, labels: LABELS } })
  // 上層持有值：收到 update 就把它寫回 props（和 AreaTab 一樣）。
  const follow = async () => {
    const last = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as YearStop | undefined
    if (last !== undefined) await wrapper.setProps({ modelValue: last })
  }
  return { wrapper, follow }
}
const playButton = (wrapper: VueWrapper) => wrapper.find('button.children-year__play')
const emitted = (wrapper: VueWrapper) => (wrapper.emitted('update:modelValue') ?? []).map((call) => call[0])

beforeEach(() => {
  vi.useFakeTimers()
  reducedMotion(false)
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('年份滑桿', () => {
  it('el-slider 用索引，提示文字與刻度標籤用年份標籤，只標頭尾', async () => {
    const { wrapper } = await mountSlider(114)
    const slider = wrapper.getComponent({ name: 'ElSlider' })
    expect(slider.props('modelValue')).toBe(2)
    expect(slider.props('min')).toBe(0)
    expect(slider.props('max')).toBe(4)
    const formatter = slider.props('formatTooltip') as (index: number) => string
    expect(formatter(4)).toBe('最新 115.10')
    expect(formatter(0)).toBe('107')
    expect(Object.values(slider.props('marks') as Record<number, { label: string } | string>).map((m) => (typeof m === 'string' ? m : m.label)))
      .toEqual(['107', '最新 115.10'])
  })

  it('拖動滑桿：索引換成那一格的值', async () => {
    const { wrapper } = await mountSlider(107)
    await wrapper.getComponent({ name: 'ElSlider' }).vm.$emit('update:modelValue', 3)
    expect(emitted(wrapper)).toEqual([115])
  })

  it('播放：每 1000 ms 前進一格，到最後一格停', async () => {
    const { wrapper, follow } = await mountSlider(114)
    await playButton(wrapper).trigger('click')
    expect(playButton(wrapper).attributes('aria-label')).toBe('暫停播放')
    await vi.advanceTimersByTimeAsync(999)
    expect(emitted(wrapper)).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await follow()
    expect(emitted(wrapper)).toEqual([115])
    await vi.advanceTimersByTimeAsync(1000)
    await follow()
    expect(emitted(wrapper)).toEqual([115, 'latest'])
    await vi.advanceTimersByTimeAsync(5000)
    expect(emitted(wrapper)).toEqual([115, 'latest'])
    expect(playButton(wrapper).attributes('aria-label')).toBe('播放')
  })

  it('已經在最後一格再按播放：從第一格重新開始', async () => {
    const { wrapper, follow } = await mountSlider('latest')
    await playButton(wrapper).trigger('click')
    await flushPromises()
    await follow()
    expect(emitted(wrapper)).toEqual([107])
    await vi.advanceTimersByTimeAsync(1000)
    expect(emitted(wrapper)).toEqual([107, 108])
  })

  it('再按一次暫停、拖動、換格子（stops 改變）、卸載都會停止播放', async () => {
    const { wrapper, follow } = await mountSlider(107)
    await playButton(wrapper).trigger('click')
    await playButton(wrapper).trigger('click')
    await vi.advanceTimersByTimeAsync(3000)
    expect(emitted(wrapper)).toEqual([])

    await playButton(wrapper).trigger('click')
    await wrapper.getComponent({ name: 'ElSlider' }).vm.$emit('update:modelValue', 2)
    await follow()
    await vi.advanceTimersByTimeAsync(3000)
    expect(emitted(wrapper)).toEqual([114])

    await playButton(wrapper).trigger('click')
    await wrapper.setProps({ stops: [107, 108, 'latest'] as YearStop[], modelValue: 107 })
    await vi.advanceTimersByTimeAsync(3000)
    expect(emitted(wrapper)).toEqual([114])
    expect(playButton(wrapper).attributes('aria-label')).toBe('播放')
  })

  it('播放到一半卸載：計時器停掉，不再 emit', async () => {
    const onUpdate = vi.fn()
    const { wrapper } = await mountWith(ChildrenYearSlider, {
      props: { stops: STOPS, modelValue: 107, labels: LABELS, 'onUpdate:modelValue': onUpdate },
    })
    await playButton(wrapper).trigger('click')
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(3000)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('偏好減少動態：沒有播放鈕，滑桿還在', async () => {
    reducedMotion(true)
    const { wrapper } = await mountSlider(107)
    expect(playButton(wrapper).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ElSlider' }).exists()).toBe(true)
  })
})
