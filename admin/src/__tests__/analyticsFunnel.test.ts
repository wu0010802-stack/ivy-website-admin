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

async function setup() {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/analytics')
  await router.isReady()
  const get = vi.spyOn(api, 'get').mockResolvedValue(funnel as never)
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
    expect(rows[3]).toContain('取消率 30%')
    expect(wrapper.text()).toContain('家長自行取消 1・園方取消 1・待確認逾期 1')
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
