import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import SlotUsagePane from '../components/sessions/SlotUsagePane.vue'
import StatsDimensionTable from '../components/admissions/StatsDimensionTable.vue'
import VisitCalendarView from '../views/VisitCalendarView.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
import {
  BUCKET_LABELS, lookupEmptyText, lookupSummaryText, signalText, slotLabel, slotsEmptyText, usageCsvFilename,
} from '../utils/slotUsage'
import type { SlotUsage } from '../utils/slotUsage'

const usage = (changes: Partial<SlotUsage> = {}, lookups: Partial<SlotUsage['lookups']> = {}, slots: Partial<SlotUsage['slots']> = {}): SlotUsage => ({
  campus_key: 'yihua', booking_mode: 'slots', today: '2026-10-13',
  lookups: {
    date_from: '2026-09-16', date_to: '2026-10-13', first_recorded_day: '2026-10-01', total: 10,
    buckets: [
      { key: 'within_1', count: 1 }, { key: 'days_2_3', count: 2 }, { key: 'days_4_7', count: 3 },
      { key: 'over_7', count: 3 }, { key: 'none', count: 1 },
    ],
    ...lookups,
  },
  slots: {
    weeks: 12, date_from: '2026-07-21', date_to: '2026-10-12', excluded_cases: 0,
    thresholds: { min_slots: 4, often_full_share: 0.5, rarely_booked_rate: 0.2 },
    rows: [{ weekday: 5, start_time: '10:00:00', end_time: '11:00:00', slot_count: 12, capacity_total: 36, booked: 33, fill_rate: 0.917, full_count: 9, signal: 'often_full' }],
    ...slots,
  },
  ...changes,
})

describe('場次使用情況：文字', () => {
  it('區間標籤五個，順序固定', () => {
    expect(Object.values(BUCKET_LABELS)).toEqual(['明天以前', '2–3 天', '4–7 天', '超過 7 天', '沒有場次'])
  })

  it('時段標籤：星期＋去掉秒的起訖', () => {
    expect(slotLabel(usage().slots.rows[0]!)).toBe('週六 10:00–11:00')
  })

  it('判讀文字', () => {
    expect(signalText('often_full', 4)).toBe('常額滿，可以考慮加開')
    expect(signalText('rarely_booked', 4)).toBe('很少人約，可以考慮收掉或縮短')
    expect(signalText('too_few', 4)).toBe('還不到 4 場，還不判斷')
    expect(signalText('normal', 4)).toBe('—')
  })

  it('總結句：7 天內約不到＝超過 7 天＋沒有場次，整段沒有場次單獨列', () => {
    expect(lookupSummaryText('義華校', usage().lookups)).toBe(
      '近 4 週家長打開義華校預約頁 10 次，其中 4 次 7 天內已經約不到，1 次整段沒有場次可選。',
    )
  })

  it('檔名', () => {
    expect(usageCsvFilename('義華校', 12, '2026-10-13')).toBe('場次使用情況-義華校-近12週-20261013.csv')
  })
})

describe('場次使用情況：空狀態（規格 §5.3）', () => {
  it('還沒有任何紀錄', () => {
    const empty = usage({}, { first_recorded_day: null, total: 0, buckets: usage().lookups.buckets.map(b => ({ ...b, count: 0 })) })
    expect(lookupEmptyText(empty)).toBe('還沒有家長打開預約頁的紀錄。')
  })

  it('以前記過、近 4 週沒有人打開', () => {
    const quiet = usage({}, { total: 0, buckets: usage().lookups.buckets.map(b => ({ ...b, count: 0 })) })
    expect(lookupEmptyText(quiet)).toBe('近 4 週沒有家長打開預約頁。')
  })

  it('不是自選場次、近 4 週也沒有紀錄', () => {
    const phone = usage({ booking_mode: 'phone' }, { first_recorded_day: null, total: 0 })
    expect(lookupEmptyText(phone)).toBe('目前的預約方式不是自選場次，家長看不到場次。')
  })

  it('以前是自選場次、後來改成電話：近 4 週沒有紀錄時也說明預約方式', () => {
    const switched = usage({ booking_mode: 'phone' }, { total: 0, buckets: usage().lookups.buckets.map(b => ({ ...b, count: 0 })) })
    expect(lookupEmptyText(switched)).toBe('目前的預約方式不是自選場次，家長看不到場次。')
  })

  it('有資料就沒有空狀態', () => {
    expect(lookupEmptyText(usage())).toBeNull()
  })

  it('範圍內沒有過去的場次', () => {
    expect(slotsEmptyText(usage({}, {}, { rows: [] }))).toBe('近 12 週沒有開放的場次。')
    expect(slotsEmptyText(usage())).toBeNull()
  })
})

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
})

async function mountPane(data: SlotUsage | Error) {
  const get = vi.spyOn(api, 'get')
  if (data instanceof Error) get.mockRejectedValue(data)
  else get.mockResolvedValue(data as never)
  const wrapper = mount(SlotUsagePane, { props: { campusKey: 'yihua', campusName: '義華校' }, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, get }
}

const urlOf = (get: { mock: { calls: unknown[][] } }) => get.mock.calls.map(call => String(call[0]))

describe('SlotUsagePane', () => {
  it('讀 API（預設近 12 週）並顯示總結句、五個區間與時段表', async () => {
    const { wrapper, get } = await mountPane(usage())
    expect(urlOf(get)).toEqual(['/admin/visit-slot-usage?campus_key=yihua&weeks=12'])
    expect(wrapper.text()).toContain('近 4 週家長打開義華校預約頁 10 次')
    for (const label of ['明天以前', '2–3 天', '4–7 天', '超過 7 天', '沒有場次']) expect(wrapper.text()).toContain(label)
    expect(wrapper.text()).toContain('週六 10:00–11:00')
    expect(wrapper.text()).toContain('常額滿，可以考慮加開')
    expect(wrapper.text()).toContain('到接待月曆改規則')
  })

  it('切換週數會重讀', async () => {
    const { wrapper, get } = await mountPane(usage())
    await wrapper.get('[data-test="weeks-26"]').trigger('click')
    await flushPromises()
    expect(urlOf(get).at(-1)).toBe('/admin/visit-slot-usage?campus_key=yihua&weeks=26')
  })

  it('沒有常額滿的列就不顯示「到接待月曆改規則」', async () => {
    const calm = usage({}, {}, { rows: [{ weekday: 0, start_time: '10:00:00', end_time: '11:00:00', slot_count: 6, capacity_total: 12, booked: 6, fill_rate: 0.5, full_count: 0, signal: 'normal' }] })
    const { wrapper } = await mountPane(calm)
    expect(wrapper.text()).not.toContain('到接待月曆改規則')
  })

  it('連結按下發出 go-calendar', async () => {
    const { wrapper } = await mountPane(usage())
    // 要能用鍵盤到達：<a> 沒有 href 不能 focus、Enter 也不會觸發 click，所以必須是 <button>。
    expect(wrapper.get('[data-test="go-calendar"]').element.tagName).toBe('BUTTON')
    await wrapper.get('[data-test="go-calendar"]').trigger('click')
    expect(wrapper.emitted('go-calendar')).toHaveLength(1)
  })

  it('填滿率的長條以 100% 為滿，不以該欄最大值為滿', async () => {
    const low = usage({}, {}, { rows: [{ weekday: 5, start_time: '10:00:00', end_time: '11:00:00', slot_count: 10, capacity_total: 30, booked: 9, fill_rate: 0.3, full_count: 0, signal: 'normal' }] })
    const { wrapper } = await mountPane(low)
    expect(wrapper.get('.stats-bar__fill').attributes('style')).toContain('width: 30%')
  })

  it('上線初期：第一塊寫還沒有紀錄，第二塊照常', async () => {
    const fresh = usage({}, { first_recorded_day: null, total: 0, buckets: usage().lookups.buckets.map(b => ({ ...b, count: 0 })) })
    const { wrapper } = await mountPane(fresh)
    expect(wrapper.text()).toContain('還沒有家長打開預約頁的紀錄。')
    expect(wrapper.text()).toContain('週六 10:00–11:00')
  })

  it('非自選場次的校區', async () => {
    const phone = usage({ booking_mode: 'phone' }, { first_recorded_day: null, total: 0, buckets: usage().lookups.buckets.map(b => ({ ...b, count: 0 })) }, { rows: [] })
    const { wrapper } = await mountPane(phone)
    expect(wrapper.text()).toContain('目前的預約方式不是自選場次，家長看不到場次。')
    expect(wrapper.text()).toContain('近 12 週沒有開放的場次。')
  })

  it('讀取失敗：整個頁籤顯示錯誤與重新載入，重新載入會再讀', async () => {
    const { wrapper, get } = await mountPane(new Error('boom'))
    expect(wrapper.text()).toContain('無法讀取場次使用情況，請重新載入。')
    get.mockResolvedValue(usage() as never)
    await wrapper.get('[data-test="reload"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('近 4 週家長打開義華校預約頁 10 次')
  })

  it('換校區重讀，舊回應不會蓋掉新回應', async () => {
    const slow = new Promise<SlotUsage>(resolve => setTimeout(() => resolve(usage({ campus_key: 'yihua' })), 20))
    const get = vi.spyOn(api, 'get')
      .mockReturnValueOnce(slow as never)
      .mockResolvedValueOnce(usage({ campus_key: 'minghua' }, { total: 99 }) as never)
    const wrapper = mount(SlotUsagePane, { props: { campusKey: 'yihua', campusName: '義華校' }, global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await wrapper.setProps({ campusKey: 'minghua', campusName: '明華校' })
    await new Promise(resolve => setTimeout(resolve, 40))
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('打開明華校預約頁 99 次')
  })

  it('換校區時先清掉舊校的數字，新校的回應回來前不會出現「新校名＋舊校數字」', async () => {
    const { wrapper, get } = await mountPane(usage())
    expect(wrapper.text()).toContain('近 4 週家長打開義華校預約頁 10 次')
    get.mockReturnValue(new Promise(() => {}) as never)
    await wrapper.setProps({ campusKey: 'minghua', campusName: '明華校' })
    await flushPromises()
    expect(urlOf(get).at(-1)).toBe('/admin/visit-slot-usage?campus_key=minghua&weeks=12')
    expect(wrapper.text()).not.toContain('近 4 週家長打開')
    expect(wrapper.text()).not.toContain('週六 10:00–11:00')
    expect(wrapper.attributes('aria-busy')).toBe('true')
  })

  it('只換週數時，新範圍回來前舊表格還在', async () => {
    const { wrapper, get } = await mountPane(usage())
    get.mockReturnValue(new Promise(() => {}) as never)
    await wrapper.get('[data-test="weeks-26"]').trigger('click')
    await flushPromises()
    expect(urlOf(get).at(-1)).toBe('/admin/visit-slot-usage?campus_key=yihua&weeks=26')
    expect(wrapper.text()).toContain('週六 10:00–11:00')
    expect(wrapper.attributes('aria-busy')).toBe('true')
  })

  it('「怎麼算」說明預設收合，內容寫出口徑', async () => {
    const { wrapper } = await mountPane(usage())
    const details = wrapper.get('details')
    expect(details.attributes('open')).toBeUndefined()
    for (const phrase of ['次', '取消', '關閉', '4 場', '50%', '20%']) expect(details.text()).toContain(phrase)
  })
})

async function mountCalendarAt(path: string) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: [] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(VisitCalendarView, {
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('StatsDimensionTable：bar 欄的長條比例', () => {
  const columns = (barMax?: number) => [
    { key: 'name', label: '名稱', sticky: true },
    { key: 'fill', label: '填滿率', kind: 'bar' as const, ...(barMax === undefined ? {} : { barMax }) },
  ]
  const rows = [{ name: 'a', fill: 30 }, { name: 'b', fill: 15 }]
  const widths = (barMax?: number) => {
    const wrapper = mount(StatsDimensionTable, { props: { title: 't', rows, columns: columns(barMax), rowKey: 'name', emptyText: '' }, global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    return wrapper.findAll('.stats-bar__fill').map(fill => fill.attributes('style'))
  }

  it('有 barMax 就以它為 100%：30 是 30% 寬，不是滿', () => {
    const [first, second] = widths(100)
    expect(first).toContain('width: 30%')
    expect(second).toContain('width: 15%')
  })

  it('沒有 barMax 照舊：最大值那列是 100%', () => {
    const [first, second] = widths()
    expect(first).toContain('width: 100%')
    expect(second).toContain('width: 50%')
  })
})

describe('參觀場次頁：頁籤', () => {
  const route = (get: ReturnType<typeof vi.spyOn>) => {
    get.mockImplementation((async (path: string) => {
      if (path.startsWith('/admin/visit-slot-usage')) return usage()
      if (path.startsWith('/admin/visit-schedule/')) return { exceptions: [], rules: [], version: 1, min_lead_hours: 24, max_advance_days: 60 }
      return []
    }) as never)
  }

  it('預設是接待月曆，沒有讀場次使用情況', async () => {
    const get = vi.spyOn(api, 'get'); route(get)
    const { wrapper } = await mountCalendarAt('/visit-calendar?campus=yihua')
    expect(get.mock.calls.map(c => String(c[0])).some(p => p.startsWith('/admin/visit-slot-usage'))).toBe(false)
    expect(wrapper.findAll('[role="tab"]').map(t => t.text())).toEqual(['接待月曆', '場次使用情況'])
    expect(wrapper.find('.calendar__grid').exists()).toBe(true)
  })

  it('直接開 ?tab=usage 就顯示場次使用情況，且只在這時才讀 API', async () => {
    const get = vi.spyOn(api, 'get'); route(get)
    const { wrapper } = await mountCalendarAt('/visit-calendar?campus=yihua&tab=usage')
    expect(get.mock.calls.map(c => String(c[0]))).toContain('/admin/visit-slot-usage?campus_key=yihua&weeks=12')
    expect(wrapper.text()).toContain('最早能約哪天')
  })

  it('切頁籤寫進網址（replace、保留 campus），回月曆時拿掉 tab', async () => {
    const get = vi.spyOn(api, 'get'); route(get)
    const { wrapper, router } = await mountCalendarAt('/visit-calendar?campus=yihua')
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ campus: 'yihua', tab: 'usage' })
    await wrapper.findAll('[role="tab"]')[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBeUndefined()
    expect(router.currentRoute.value.query.campus).toBe('yihua')
  })

  it('「到接待月曆改規則」切回第一個頁籤', async () => {
    const get = vi.spyOn(api, 'get'); route(get)
    const { wrapper, router } = await mountCalendarAt('/visit-calendar?campus=yihua&tab=usage')
    await wrapper.get('[data-test="go-calendar"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBeUndefined()
    expect(wrapper.find('.calendar__grid').exists()).toBe(true)
  })

  it('切校區兩個頁籤共用：在使用情況頁籤換校會重讀新校', async () => {
    const get = vi.spyOn(api, 'get'); route(get)
    const { router } = await mountCalendarAt('/visit-calendar?campus=yihua&tab=usage')
    await router.replace({ query: { campus: 'minghua', tab: 'usage' } })
    await flushPromises()
    expect(get.mock.calls.map(c => String(c[0]))).toContain('/admin/visit-slot-usage?campus_key=minghua&weeks=12')
  })

  it('接待月曆有沒存的修改時，切到場次使用情況先問，取消就留在原頁籤（頁籤列也不動）', async () => {
    const get = vi.spyOn(api, 'get'); route(get)
    const { wrapper, router } = await mountCalendarAt('/visit-calendar?campus=yihua')
    // 用 script setup 的 ref 換成假的卡片：confirmLeave 回 false＝使用者選了取消。
    ;(wrapper.vm as unknown as { sessionsCard: unknown }).sessionsCard = { confirmLeave: async () => false }
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBeUndefined()
    expect(wrapper.find('.calendar__grid').exists()).toBe(true)
    // el-tabs 自己會先把點到的頁籤標成選取：取消後要退回，不能內容在月曆、頁籤列卻亮著「場次使用情況」。
    expect(wrapper.get('.el-tabs__item.is-active').text()).toBe('接待月曆')
  })

  it('接待月曆有沒存的修改時按確定，照常切過去，頁籤列跟著亮', async () => {
    const get = vi.spyOn(api, 'get'); route(get)
    const { wrapper, router } = await mountCalendarAt('/visit-calendar?campus=yihua')
    ;(wrapper.vm as unknown as { sessionsCard: unknown }).sessionsCard = { confirmLeave: async () => true }
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('usage')
    expect(wrapper.get('.el-tabs__item.is-active').text()).toBe('場次使用情況')
  })

  it('接待月曆有沒存的修改時，網址換校（上一頁、帶 ?campus= 的連結）先問；取消就留在原校、網址不動、不讀別校', async () => {
    const get = vi.spyOn(api, 'get'); route(get)
    const { wrapper, router } = await mountCalendarAt('/visit-calendar?campus=yihua')
    ;(wrapper.vm as unknown as { sessionsCard: unknown }).sessionsCard = { confirmLeave: async () => false }
    get.mockClear()
    await router.push({ query: { campus: 'minghua' } }).catch(() => {})
    await flushPromises()
    expect(router.currentRoute.value.query.campus).toBe('yihua')
    expect(get.mock.calls.map(c => String(c[0])).filter(path => path.includes('minghua'))).toEqual([])
  })

  it('接待月曆有沒存的修改時網址換校，按確定就照常換校', async () => {
    const get = vi.spyOn(api, 'get'); route(get)
    const { wrapper, router } = await mountCalendarAt('/visit-calendar?campus=yihua')
    ;(wrapper.vm as unknown as { sessionsCard: unknown }).sessionsCard = { confirmLeave: async () => true }
    await router.push({ query: { campus: 'minghua' } })
    await flushPromises()
    expect(router.currentRoute.value.query.campus).toBe('minghua')
    expect(get.mock.calls.map(c => String(c[0])).some(path => path.includes('minghua'))).toBe(true)
  })

  it('網址改成 tab=usage（例如瀏覽器上一頁）時直接跟著切，不再問，頁籤列與內容一致', async () => {
    const get = vi.spyOn(api, 'get'); route(get)
    const { wrapper, router } = await mountCalendarAt('/visit-calendar?campus=yihua')
    ;(wrapper.vm as unknown as { sessionsCard: unknown }).sessionsCard = { confirmLeave: async () => false }
    await router.replace({ query: { campus: 'yihua', tab: 'usage' } })
    await flushPromises()
    expect(wrapper.text()).toContain('最早能約哪天')
    expect(wrapper.get('.el-tabs__item.is-active').text()).toBe('場次使用情況')
  })
})
