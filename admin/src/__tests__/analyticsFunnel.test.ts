import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import AnalyticsView from '../views/AnalyticsView.vue'
import { api } from '../api/client'
import type { AnalyticsFunnelOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { taipeiToday } from '../composables/newsContent'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const outcome = (created: number, confirmed: number, completed: number, cancelled: number) => ({
  request_created: created, visit_confirmed: confirmed, visit_completed: completed, visit_cancelled: cancelled,
})
const clicks = (form: number, line = 0, phone = 0, external = 0) => ({
  booking_cta_clicked: form, cta_click_line: line, cta_click_phone: phone, cta_click_external: external,
})

const funnel: AnalyticsFunnelOut = {
  campus_key: 'yihua',
  date_from: null,
  date_to: null,
  counts: { ...outcome(10, 6, 4, 3), ...clicks(20, 5, 2, 0) },
  cancelled_by_reason: { parent: 1, staff: 1, hold_expired: 1 },
  by_source: [
    { source: 'unknown', counts: outcome(2, 0, 0, 0) },
    { source: 'phone', counts: outcome(0, 2, 1, 1) },
    { source: 'web', counts: outcome(8, 4, 3, 2) },
  ],
  by_referral: [
    { referral: 'facebook', counts: outcome(5, 3, 2, 1) },
    { referral: 'none', counts: outcome(3, 1, 1, 1) },
  ],
  clicks_by_entry: [
    { entry: 'campus_hero', counts: clicks(12, 1) },
    { entry: 'home_campus_board', counts: clicks(8, 4, 2) },
  ],
  unassigned_clicks: clicks(7),
}

async function setup(data: AnalyticsFunnelOut = funnel) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/analytics')
  await router.isReady()
  const get = vi.spyOn(api, 'get').mockResolvedValue(data as never)
  const wrapper = mount(AnalyticsView, {
    global: {
      plugins: [pinia, router, ElementPlus],
      stubs: { SiteTrafficPanel: true },
      provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, get }
}

describe('成效漏斗：期間、取消與來源維度', () => {
  it('預設看開站至今，列出取消數、取消率與取消原因', async () => {
    const { wrapper, get } = await setup()
    expect(get).toHaveBeenCalledWith('/admin/analytics/funnel?campus_key=yihua')
    const rows = wrapper.findAll('.funnel__row').map((row) => row.text())
    expect(rows[3]).toContain('已取消')
    expect(rows[3]).toContain('3')
    // 取消率只拿官網表單那一列算（2 ÷ 8），電話補登的取消另外寫。
    expect(rows[3]).toContain('官網需求取消率 25%')
    expect(rows[3]).toContain('另有後台補登 1 筆')
    expect(wrapper.text()).toContain('家長自行取消 1・園方取消 1・待確認逾期 1')
    expect(wrapper.find('.analytics__section-title').text()).toBe('各校預約（開站至今）')
  })

  it('確認率只算官網表單的需求，補登另外寫；比例不會超過 100%', async () => {
    const { wrapper } = await setup({
      ...funnel,
      counts: { ...outcome(2, 5, 6, 3) },
      by_source: [
        { source: 'web', counts: outcome(2, 2, 3, 3) },
        { source: 'phone', counts: outcome(0, 2, 2, 0) },
        { source: 'line', counts: outcome(0, 1, 1, 0) },
      ],
    })
    const rows = wrapper.findAll('.funnel__row').map((row) => row.text())
    expect(rows[1]).toContain('官網需求的 100%')
    expect(rows[1]).toContain('另有後台補登 3 筆')
    // 完成比確認多、官網的取消比送出多（含更早送出的需求）：不給比例。
    expect(rows[2]).toContain('含之前確認的預約，不計比例')
    expect(rows[3]).toContain('含之前送出的需求，不計比例')
    const percents = [...wrapper.text().matchAll(/(\d+)%/g)].map((match) => Number(match[1]))
    expect(percents.every((value) => value <= 100)).toBe(true)
    const bySource = wrapper.findAll('.analytics__table')[0]!.findAll('tbody tr').map((row) => row.text())
    expect(bySource[0]).toContain('官網表單')
    expect(bySource[0]).not.toContain('%')
    expect(wrapper.text()).toContain('不計取消率')
  })

  it('換條件時保留上一次的數字並寫「更新中…」，不整區換成骨架', async () => {
    const { wrapper, get } = await setup()
    let resolve!: (value: unknown) => void
    get.mockImplementationOnce(() => new Promise((r) => { resolve = r }) as never)
    await wrapper.findAll('button').find((button) => button.text() === '重新整理')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.el-skeleton').exists()).toBe(false)
    expect(wrapper.findAll('.funnel__row')).toHaveLength(4)
    expect(wrapper.find('.analytics__results').classes()).toContain('is-updating')
    expect(wrapper.text()).toContain('更新中…')
    resolve(funnel)
    await flushPromises()
    expect(wrapper.text()).not.toContain('更新中…')
  })

  it('自訂區間不能選未來日期，超過 400 天先在前端擋下', async () => {
    const { wrapper, get } = await setup()
    const select = wrapper.findAllComponents({ name: 'ElSelect' }).find((item) => item.props('ariaLabel') === '期間' || item.attributes('aria-label') === '期間')!
    select.vm.$emit('update:modelValue', 'custom')
    await flushPromises()
    const picker = wrapper.findComponent({ name: 'ElDatePicker' })
    const disabled = picker.props('disabledDate') as (date: Date) => boolean
    const [y, m, d] = taipeiToday().split('-').map(Number)
    expect(disabled(new Date(y!, m! - 1, d!))).toBe(false)
    expect(disabled(new Date(y!, m! - 1, d! + 1))).toBe(true)
    const calls = get.mock.calls.length
    picker.vm.$emit('update:modelValue', ['2024-01-01', '2026-06-30'])
    await flushPromises()
    expect(get.mock.calls.length).toBe(calls)
    expect(wrapper.text()).toContain('自訂區間最長 400 天')
  })

  it('切換期間時送台北日期的 from／to', async () => {
    const { wrapper, get } = await setup()
    const select = wrapper.findAllComponents({ name: 'ElSelect' }).find((item) => item.attributes('aria-label') === '期間' || item.props('ariaLabel') === '期間')!
    select.vm.$emit('update:modelValue', '30')
    await flushPromises()
    const url = String(get.mock.calls.at(-1)![0])
    const today = taipeiToday()
    expect(url).toContain(`to=${today}`)
    const from = new URLSearchParams(url.split('?')[1]).get('from')!
    expect((Date.parse(today) - Date.parse(from)) / 86400000).toBe(29)

    select.vm.$emit('update:modelValue', 'year')
    await flushPromises()
    expect(String(get.mock.calls.at(-1)![0])).toContain(`from=${today.slice(0, 4)}-01-01`)

    // 自訂區間還沒選日期時不送請求。
    const calls = get.mock.calls.length
    select.vm.$emit('update:modelValue', 'custom')
    await flushPromises()
    expect(get.mock.calls.length).toBe(calls)
    expect(wrapper.text()).toContain('請選擇開始與結束日期')
    wrapper.findComponent({ name: 'ElDatePicker' }).vm.$emit('update:modelValue', ['2026-03-01', '2026-06-30'])
    await flushPromises()
    expect(String(get.mock.calls.at(-1)![0])).toBe('/admin/analytics/funnel?campus_key=yihua&from=2026-03-01&to=2026-06-30')
  })

  it('依案件來源或「從哪裡知道我們」分組，舊資料排最後', async () => {
    const { wrapper } = await setup()
    const table = () => wrapper.findAll('.analytics__table')[0]!.findAll('tbody tr').map((row) => row.text())
    const bySource = table()
    expect(bySource[0]).toContain('官網表單')
    expect(bySource[0]).toContain('25%')
    expect(bySource[1]).toContain('電話')
    expect(bySource[1]).toContain('—') // 補登沒有「送出需求」，取消率不計
    expect(bySource[2]).toContain('未記錄來源')

    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 'referral')
    await flushPromises()
    const byReferral = table()
    expect(byReferral[0]).toContain('Facebook')
    expect(byReferral[1]).toContain('未填寫')
    expect(wrapper.text()).toContain('各列加總可能大於總數')
  })

  it('預約鈕點擊含表單按鈕，依按鈕位置列出，並提示不分校的點擊', async () => {
    const { wrapper } = await setup()
    expect(wrapper.text()).toContain('預約表單')
    const entries = wrapper.findAll('.analytics__table')[1]!.findAll('tbody tr').map((row) => row.text())
    // 依點擊總數排序：首頁五校卡 14 次、分校頁首屏 13 次。
    expect(entries[0]).toContain('首頁五校卡')
    expect(entries[1]).toContain('分校頁首屏')
    expect(wrapper.text()).toContain('另有 7 次點擊沒有指定校區')
  })
})
