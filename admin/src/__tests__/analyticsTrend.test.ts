import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import EventTrendPanel from '../components/analytics/EventTrendPanel.vue'
import { api } from '../api/client'
import type { EventTrendOut } from '../api/types'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach((wrapper) => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const day = (date: string, over: Partial<EventTrendOut['days'][number]> = {}) =>
  ({ day: date, request_created: 0, visit_completed: 0, visit_cancelled: 0, clicks: 0, ...over })

const trend = (over: Partial<EventTrendOut> = {}): EventTrendOut => ({
  as_of: '2026-10-03T06:05:00Z', campus_key: 'yihua', date_from: '2026-09-30', date_to: '2026-10-02', truncated: false, unit: 'event',
  days: [day('2026-09-30', { request_created: 2, clicks: 1 }), day('2026-10-01', { request_created: 4, clicks: 8 }), day('2026-10-02')],
  ...over,
})

async function mountPanel(data: EventTrendOut = trend(), props: Record<string, unknown> = {}) {
  const get = vi.spyOn(api, 'get').mockResolvedValue(data as never)
  const wrapper = mount(EventTrendPanel, { props: { campusKey: 'yihua', range: null, periodLabel: '開站至今', ...props }, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, get }
}

const heights = (wrapper: VueWrapper) => wrapper.findAll('.daily-bars__fill').map((fill) => (fill.element as HTMLElement).style.height)

describe('每日變化', () => {
  it('預設畫送出需求，標出 10/01 自選場次上線，寫實際畫出的期間', async () => {
    const { wrapper, get } = await mountPanel()
    expect(get).toHaveBeenCalledWith('/admin/analytics/event-trend?campus_key=yihua')
    expect(heights(wrapper)).toEqual(['50%', '100%', '0%'])
    expect(wrapper.text()).toContain('10/01 起：家長自選場次上線')
    expect(wrapper.text()).toContain('期間 2026/09/30–2026/10/02')
    expect(wrapper.text()).toContain('未到場沒有每日紀錄')
  })

  it('切到預約鈕點擊不重抓，直條換成點擊數', async () => {
    const { wrapper, get } = await mountPanel()
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 'clicks')
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(1)
    expect(heights(wrapper)).toEqual(['13%', '100%', '0%'])
  })

  it('換校或換期間才重抓', async () => {
    const { wrapper, get } = await mountPanel()
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    await wrapper.setProps({ range: { from: '2026-09-01', to: '2026-09-30' } })
    await flushPromises()
    expect(get.mock.calls.map((call) => call[0])).toEqual([
      '/admin/analytics/event-trend?campus_key=yihua',
      '/admin/analytics/event-trend?campus_key=minghua',
      '/admin/analytics/event-trend?campus_key=minghua&from=2026-09-01&to=2026-09-30',
    ])
  })

  it('重新整理（refreshToken 變）時重抓', async () => {
    const { wrapper, get } = await mountPanel()
    await wrapper.setProps({ refreshToken: 1 })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('超過 400 天寫明只畫最近 400 天', async () => {
    const { wrapper } = await mountPanel(trend({ truncated: true }))
    expect(wrapper.text()).toContain('只畫最近 400 天')
  })

  it('讀取失敗顯示錯誤', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('network'))
    const wrapper = mount(EventTrendPanel, { props: { campusKey: 'yihua', range: null, periodLabel: '開站至今' }, global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('無法讀取每日變化')
    expect(wrapper.find('.daily-bars__plot').exists()).toBe(false)
  })

  it('回應順序顛倒時只顯示最後一次換校的資料', async () => {
    const pending: Array<(value: EventTrendOut) => void> = []
    vi.spyOn(api, 'get').mockImplementation(() => new Promise((resolve) => { pending.push(resolve as (value: EventTrendOut) => void) }))
    const wrapper = mount(EventTrendPanel, { props: { campusKey: 'yihua', range: null, periodLabel: '開站至今' }, global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await wrapper.setProps({ campusKey: 'minghua' })
    await wrapper.setProps({ campusKey: 'chongde' })
    expect(pending).toHaveLength(3)
    pending[2](trend({ campus_key: 'chongde', days: [day('2026-09-30', { request_created: 5 }), day('2026-10-01', { request_created: 10 })] }))
    await flushPromises()
    pending[1](trend({ campus_key: 'minghua', days: [day('2026-09-30', { request_created: 10 }), day('2026-10-01', { request_created: 1 })] }))
    await flushPromises()
    expect(heights(wrapper)).toEqual(['50%', '100%'])
    expect(wrapper.text()).toContain('崇德')
  })

  it('重抓中保留舊資料與舊校區標題，標示更新中', async () => {
    const { wrapper } = await mountPanel()
    let release: (value: EventTrendOut) => void = () => {}
    vi.spyOn(api, 'get').mockImplementation(() => new Promise((resolve) => { release = resolve as (value: EventTrendOut) => void }))
    await wrapper.setProps({ campusKey: 'minghua' })
    expect(wrapper.find('.trend').classes()).toContain('is-updating')
    expect(wrapper.find('.trend').attributes('aria-busy')).toBe('true')
    expect(heights(wrapper)).toEqual(['50%', '100%', '0%'])
    expect(wrapper.find('#event-trend-title').text()).toContain('義華')
    release(trend({ campus_key: 'minghua' }))
    await flushPromises()
    expect(wrapper.find('.trend').classes()).not.toContain('is-updating')
    expect(wrapper.find('#event-trend-title').text()).toContain('明華')
  })

  it('重抓失敗時不留舊直條，只顯示錯誤', async () => {
    const { wrapper } = await mountPanel()
    vi.spyOn(api, 'get').mockRejectedValue(new Error('network'))
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    expect(wrapper.text()).toContain('無法讀取每日變化')
    expect(wrapper.find('.daily-bars__plot').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('期間 2026/09/30')
  })
})
