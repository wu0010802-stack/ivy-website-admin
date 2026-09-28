// B03 審查意見：改規則後舊時段跟著調整、只停止新預約不必關閉時段、手機上的
// 日期區間面板、存預約設定會讓填表中的家長重新確認。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import VisitSchedulePanel from '../components/VisitSchedulePanel.vue'
import VisitSlotsView from '../views/VisitSlotsView.vue'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import AnalyticsView from '../views/AnalyticsView.vue'
import BookingSettingsView from '../views/BookingSettingsView.vue'
import { api } from '../api/client'
import { auditMetadataSummary, slotClosedLabel, slotSyncLines } from '../api/labels'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function mountAt(component: unknown, path: string, props: Record<string, unknown> = {}): Promise<VueWrapper> {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: [] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as ReturnType<typeof defineComponent>, {
    props,
    global: {
      plugins: [pinia, router, ElementPlus],
      stubs: { SiteTrafficPanel: true },
      provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) },
    },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const RULE = { weekday: 2, start_time: '09:00:00', end_time: '10:30:00', slot_minutes: 30, capacity: 2 }
const schedule = (extra: object = {}) => ({ campus_key: 'yihua', min_lead_hours: 24, max_advance_days: 60, rules: [RULE], exceptions: [], rules_extended_on: null, version: 4, ...extra })

describe('改每週規則：還沒有人預約的時段跟著調整', () => {
  it('存檔後說明調整了哪些時段，已排入家長的場次留下提醒', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(schedule() as never)
    const put = vi.spyOn(api, 'put').mockResolvedValue(schedule({
      rules: [{ ...RULE, slot_minutes: 45 }],
      version: 5,
      slot_sync: { removed: 2, closed: 1, reopened: 0, capacity_updated: 1, kept_booked: 1 },
    }) as never)
    const success = vi.spyOn(ElMessage, 'success')
    const wrapper = await mountAt(VisitSchedulePanel, '/', { campusKey: 'yihua', canManage: true })
    wrapper.findAllComponents({ name: 'ElInputNumber' }).find(item => item.find('input[aria-label="每場分鐘"]').exists())!.vm.$emit('update:modelValue', 45)
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '儲存規則')!.trigger('click')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/admin/visit-schedule/yihua', expect.objectContaining({ expected_version: 4 }))
    const message = String(success.mock.calls.at(-1)![0])
    expect(message).toContain('還沒有人預約的時段已跟著調整：3 場不符合新規則的時段不再開放、1 場名額改成新規則')
    expect(message).not.toContain('已存在的不會變動')
    expect(wrapper.emitted('slots-changed')).toBeTruthy()
    expect(wrapper.text()).toContain('1 場不在新規則內，但已有家長排入')
    expect(wrapper.text()).toContain('把名額調成已占用的組數')
    expect(wrapper.text()).toContain('改規則時，還沒有人預約的時段會跟著調整')
  })

  it('沒有要調整的時段就不多說，也不重新讀時段清單', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(schedule() as never)
    vi.spyOn(api, 'put').mockResolvedValue(schedule({
      min_lead_hours: 48, version: 5, slot_sync: { removed: 0, closed: 0, reopened: 0, capacity_updated: 0, kept_booked: 0 },
    }) as never)
    const success = vi.spyOn(ElMessage, 'success')
    const wrapper = await mountAt(VisitSchedulePanel, '/', { campusKey: 'yihua', canManage: true })
    wrapper.findAllComponents({ name: 'ElInputNumber' })[0]!.vm.$emit('update:modelValue', 48)
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '儲存規則')!.trigger('click')
    await flushPromises()
    expect(String(success.mock.calls.at(-1)![0])).not.toContain('跟著調整')
    expect(wrapper.emitted('slots-changed')).toBeFalsy()
    expect(wrapper.text()).not.toContain('已有家長排入')
  })

  it('中文標籤：規則變更停用的時段、操作紀錄的時段調整', () => {
    expect(slotClosedLabel('rule')).toBe('不在開放規則內')
    expect(slotClosedLabel('exception')).toBe('休假日關閉')
    expect(slotClosedLabel(null)).toBe('已關閉')
    expect(slotSyncLines({ removed: 0, closed: 0, reopened: 2, capacity_updated: 0, kept_booked: 0 })).toEqual(['重新開放 2 場'])
    expect(auditMetadataSummary({ rule_count: 1, slot_sync: { removed: 3, closed: 0, reopened: 0, capacity_updated: 0, kept_booked: 1 } }))
      .toBe('rule_count=1，時段：3 場不符合新規則的時段不再開放、1 場已有家長排入，維持原樣')
  })
})

describe('每週規則面板：收合摘要、載入中與未儲存保護', () => {
  it('預設收合成一行摘要，展開後才列出規則；沒有規則時寫「尚未設定每週規則」', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(schedule({
      rules: [RULE, { ...RULE, weekday: 3 }],
      exceptions: [{ id: 'e1', exception_date: '2099-01-07', reason: null }],
    }) as never)
    const wrapper = await mountAt(VisitSchedulePanel, '/', { campusKey: 'yihua', canManage: true })
    const summary = wrapper.get('.schedule__summary').text()
    expect(summary).toContain('週三、週四 09:00–10:30')
    expect(summary).toContain('家長可約 24 小時後到 60 天內的場次')
    expect(summary).toContain('休假日 1 天')
    expect((wrapper.get('#schedule-body').element as HTMLElement).style.display).toBe('none')
    // 收合時仍找得到「依規則產生時段」。
    expect(wrapper.findAll('button').some(button => button.text() === '依規則產生時段…')).toBe(true)
    await wrapper.findAll('button').find(button => button.text() === '查看與修改')!.trigger('click')
    expect((wrapper.get('#schedule-body').element as HTMLElement).style.display).toBe('')

    vi.spyOn(api, 'get').mockResolvedValue(schedule({ rules: [] }) as never)
    const empty = await mountAt(VisitSchedulePanel, '/', { campusKey: 'yihua', canManage: true })
    expect(empty.get('.schedule__summary').text()).toContain('尚未設定每週規則')
  })

  it('讀取中不顯示「還沒有規則」，換校時也不留上一校的規則', async () => {
    let resolveRenwu!: (value: unknown) => void
    vi.spyOn(api, 'get').mockImplementation(async path => (String(path).endsWith('/renwu')
      ? new Promise(resolve => { resolveRenwu = resolve })
      : schedule()) as never)
    const wrapper = await mountAt(VisitSchedulePanel, '/', { campusKey: 'yihua', canManage: true })
    expect(wrapper.get('.schedule__summary').text()).toContain('週三 09:00–10:30')
    await wrapper.setProps({ campusKey: 'renwu' })
    await flushPromises()
    expect(wrapper.get('.schedule__summary').text()).toContain('讀取中')
    expect(wrapper.text()).not.toContain('週三 09:00–10:30')
    expect(wrapper.text()).not.toContain('還沒有規則')
    expect(wrapper.text()).not.toContain('接下來沒有休假日')
    resolveRenwu(schedule({ campus_key: 'renwu', rules: [] }))
    await flushPromises()
    expect(wrapper.get('.schedule__summary').text()).toContain('尚未設定每週規則')
  })

  it('存規則後說明新場次約一分鐘內補上，一分多鐘後自動請清單重讀一次', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(schedule() as never)
    vi.spyOn(api, 'put').mockResolvedValue(schedule({
      rules: [RULE, { ...RULE, weekday: 4 }], version: 5, slot_sync: { removed: 0, closed: 0, reopened: 0, capacity_updated: 0, kept_booked: 0 },
    }) as never)
    const wrapper = await mountAt(VisitSchedulePanel, '/', { campusKey: 'yihua', canManage: true })
    await wrapper.findAll('button').find(button => button.text() === '查看與修改')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '新增規則')!.trigger('click')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await wrapper.findAll('button').find(button => button.text() === '儲存規則')!.trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('系統約一分鐘內會依新規則補上 60 天內的時段，下方清單會自動更新')
      // 沒有要調整的時段：存檔當下不重讀清單，等定期工作補好再讀。
      expect(wrapper.emitted('slots-changed')).toBeFalsy()
      vi.advanceTimersByTime(70_000)
      expect(wrapper.emitted('slots-changed')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('還沒有規則時，收合鈕寫「設定每週規則」', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(schedule({ rules: [] }) as never)
    const wrapper = await mountAt(VisitSchedulePanel, '/', { campusKey: 'yihua', canManage: true })
    expect(wrapper.findAll('button').map(button => button.text())).toContain('設定每週規則')
    // 沒有規則不能產生時段，收合時也不擺這個入口。
    expect(wrapper.findAll('button').map(button => button.text())).not.toContain('依規則產生時段…')
  })

  it('唯讀帳號只看得到文字，不列一整排停用的輸入框', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(schedule() as never)
    const wrapper = await mountAt(VisitSchedulePanel, '/', { campusKey: 'yihua', canManage: false })
    expect(wrapper.findAllComponents({ name: 'ElInputNumber' })).toHaveLength(0)
    expect(wrapper.text()).toContain('週三 09:00–10:30，每 30 分鐘一場、每場 2 組（共 3 場）')
    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['查看規則'])
  })

  it('改了規則還沒存就切校區會先確認；選留在這頁就不換校，確認放棄才換並寫回網址', async () => {
    vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).startsWith('/admin/visit-schedule/')) return schedule() as never
      return [] as never
    })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValueOnce('confirm' as never)
    const wrapper = await mountAt(VisitSlotsView, '/slots')
    await wrapper.findAll('button').find(button => button.text() === '查看與修改')!.trigger('click')
    wrapper.findAllComponents({ name: 'ElInputNumber' }).find(item => item.find('input[aria-label="每場名額"]').exists())!.vm.$emit('update:modelValue', 4)
    await flushPromises()
    expect(wrapper.text()).toContain('有未儲存的修改')
    const select = wrapper.getComponent({ name: 'CampusSelect' })
    select.vm.$emit('update:modelValue', 'renwu')
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(select.props('modelValue')).toBe('yihua')
    expect(wrapper.text()).toContain('有未儲存的修改')
    select.vm.$emit('update:modelValue', 'renwu')
    await flushPromises()
    expect(select.props('modelValue')).toBe('renwu')
    expect(wrapper.vm.$router.currentRoute.value.query.campus).toBe('renwu')
  })
})

describe('時段清單：只想停止新預約不用關閉時段', () => {
  const slot = (id: string, extra: object) => ({ id, campus_key: 'yihua', slot_date: '2099-01-06', start_time: '10:00:00', end_time: '11:00:00', capacity: 3, booked_count: 0, closed: false, closed_source: null, version: 2, ...extra })

  function mockSlots() {
    vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).startsWith('/admin/visit-schedule/')) return schedule({ rules: [] }) as never
      return [slot('booked', { booked_count: 2 }), slot('retired', { slot_date: '2099-01-07', closed: true, closed_source: 'rule' })] as never
    })
  }

  const closeButton = (wrapper: VueWrapper) =>
    wrapper.findAll('.slot-row').find(row => row.text().includes('開放中'))!.findAll('button').find(button => button.text() === '關閉')!
  const choiceButtons = (wrapper: VueWrapper) => wrapper.findAll('.close-slot__actions button')

  it('選「只停止新預約」把名額調成已占用的組數，不關閉、不列入待人工處理', async () => {
    mockSlots()
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({} as never)
    const success = vi.spyOn(ElMessage, 'success')
    const wrapper = await mountAt(VisitSlotsView, '/slots')
    expect(wrapper.text()).toContain('不在開放規則內')
    expect(wrapper.text()).toContain('只想停止新預約，把名額調成已占用的組數')
    await closeButton(wrapper).trigger('click')
    await flushPromises()
    // 三個寫明後果的選項；不再用「取消鈕其實會改名額」的確認框。
    expect(confirm).not.toHaveBeenCalled()
    expect(choiceButtons(wrapper).map(button => button.text())).toEqual(['先不要', '關閉這一場', '只停止新預約（名額改為 2 組）'])
    expect(wrapper.text()).toContain('這一場已有 2 組家庭占用名額')
    await choiceButtons(wrapper).find(button => button.text().startsWith('只停止新預約'))!.trigger('click')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/slots/booked', { capacity: 2, expected_version: 2 })
    expect(patch).not.toHaveBeenCalledWith('/admin/slots/booked', expect.objectContaining({ closed: true }))
    expect(String(success.mock.calls.at(-1)![0])).toContain('已排入的家長照常參觀')
    expect(wrapper.text()).not.toContain('關閉的時段還有家長排入')
  })

  it('選「先不要」什麼都不改', async () => {
    mockSlots()
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({} as never)
    const wrapper = await mountAt(VisitSlotsView, '/slots')
    await closeButton(wrapper).trigger('click')
    await flushPromises()
    await choiceButtons(wrapper).find(button => button.text() === '先不要')!.trigger('click')
    await flushPromises()
    expect(patch).not.toHaveBeenCalled()
  })

  it('名額回傳後只換那一列，不重讀整張清單；其他場次照常可以調整', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).startsWith('/admin/visit-schedule/')) return schedule({ rules: [] }) as never
      if (String(path).startsWith('/admin/booking-config/')) return { campus_key: 'yihua', mode: 'slots', slots_auto_confirm: false } as never
      return [slot('a', {}), slot('b', { start_time: '14:00:00', end_time: '15:00:00' })] as never
    })
    let resolvePatch!: (value: unknown) => void
    vi.spyOn(api, 'patch').mockImplementation(() => new Promise(resolve => { resolvePatch = resolve }) as never)
    const wrapper = await mountAt(VisitSlotsView, '/slots')
    const slotCalls = () => get.mock.calls.filter(([path]) => String(path).startsWith('/admin/slots?')).length
    const before = slotCalls()
    const [first, second] = wrapper.findAll('.slot-row')
    first!.findComponent({ name: 'ElInputNumber' }).vm.$emit('change', 5)
    await flushPromises()
    // 儲存中只停用那一列。
    expect(first!.find('.el-input-number').classes()).toContain('is-disabled')
    expect(second!.find('.el-input-number').classes()).not.toContain('is-disabled')
    resolvePatch(slot('a', { capacity: 5, version: 3 }))
    await flushPromises()
    expect(slotCalls()).toBe(before)
    expect(wrapper.find('.el-skeleton').exists()).toBe(false)
    expect(wrapper.findAll('.slot-row')[0]!.findComponent({ name: 'ElInputNumber' }).props('modelValue')).toBe(5)
    // 桌機表格的欄位標題寫明調整後立即儲存。
    expect(wrapper.find('.slots-table').text()).toContain('名額調整後立即儲存')
  })

  it('按「重新整理」時舊的列留在畫面上，不換成骨架', async () => {
    let pending: ((value: unknown) => void) | null = null
    vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).startsWith('/admin/visit-schedule/')) return schedule({ rules: [] }) as never
      if (String(path).startsWith('/admin/slots?') && pending === null) return [slot('a', {}), slot('b', { start_time: '14:00:00', end_time: '15:00:00' })] as never
      if (String(path).startsWith('/admin/slots?')) return new Promise(resolve => { pending = resolve }) as never
      return [] as never
    })
    const wrapper = await mountAt(VisitSlotsView, '/slots')
    pending = () => {}
    await wrapper.findAll('button').find(button => button.text() === '重新整理')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.list-skeleton').exists()).toBe(false)
    expect(wrapper.findAll('.slot-row')).toHaveLength(2)
    pending!([slot('a', {})])
    await flushPromises()
    expect(wrapper.findAll('.slot-row')).toHaveLength(1)
  })
})

describe('新增時段：一次開好幾場、建在清單範圍外也看得到', () => {
  it('建立並新增下一場：對話框不關、開始時間接上一場結束；日期在清單範圍外就放寬並標出新的一場', async () => {
    const created = { id: 'new', campus_key: 'yihua', slot_date: '2099-03-01', start_time: '10:00:00', end_time: '11:00:00', capacity: 5, booked_count: 0, closed: false, closed_source: null, version: 1 }
    let posted = false
    const get = vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).startsWith('/admin/visit-schedule/')) return schedule({ rules: [] }) as never
      if (String(path).startsWith('/admin/slots?')) return (posted ? [created] : []) as never
      return [] as never
    })
    const post = vi.spyOn(api, 'post').mockImplementation(async () => { posted = true; return created as never })
    const success = vi.spyOn(ElMessage, 'success')
    const wrapper = await mountAt(VisitSlotsView, '/slots')
    await wrapper.findAll('button').find(button => button.text() === '新增時段')!.trigger('click')
    await flushPromises()
    const dialog = wrapper.findAllComponents({ name: 'ElDialog' }).find(item => item.props('title').startsWith('新增'))!
    dialog.findComponent({ name: 'ElDatePicker' }).vm.$emit('update:modelValue', '2099-03-01')
    await flushPromises()
    await dialog.findAll('button').find(button => button.text() === '建立並新增下一場')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/slots?campus_key=yihua', expect.objectContaining({ slot_date: '2099-03-01', start_time: '10:00:00', end_time: '11:00:00' }))
    expect(String(success.mock.calls.at(-1)![0])).toContain('已建立 2099/03/01（週日）10:00–11:00 的時段，清單的日期範圍已放寬到這一天')
    // 對話框還開著，下一場從 11:00 開始、時長一樣一小時。
    expect(dialog.props('modelValue')).toBe(true)
    const times = dialog.findAllComponents({ name: 'ElTimePicker' }).map(item => item.props('modelValue'))
    expect(times).toEqual(['11:00:00', '12:00:00'])
    // 清單的結束日期延到新的一天，重讀後那一場標成剛建立。
    expect(get.mock.calls.some(([path]) => String(path).includes('date_to=2099-03-01'))).toBe(true)
    expect(wrapper.find('.slot-row.is-new').exists()).toBe(true)
  })
})

describe('時段頁的預約方式與校區網址', () => {
  const slotConfig = (mode: string) => ({ campus_key: 'renwu', version: 1, mode, line_url: null, phone: null, external_url: null, message: null, slots_auto_confirm: false, parent_change_deadline_hours: 24 })
  function mockPage(mode: string) {
    return vi.spyOn(api, 'get').mockImplementation(async path => {
      if (String(path).startsWith('/admin/visit-schedule/')) return schedule({ rules: [] }) as never
      if (String(path).startsWith('/admin/booking-config/')) return slotConfig(mode) as never
      return [] as never
    })
  }

  it('網址帶 ?campus= 直接落在那一校；不是時段預約時說明家長看不到並連到各校預約方式', async () => {
    const get = mockPage('inquiry')
    const wrapper = await mountAt(VisitSlotsView, '/slots?campus=renwu')
    expect(get.mock.calls.some(([path]) => String(path).startsWith('/admin/slots?campus_key=renwu'))).toBe(true)
    expect(wrapper.getComponent({ name: 'CampusSelect' }).props('modelValue')).toBe('renwu')
    expect(wrapper.text()).toContain('家長在官網看不到這些場次')
    expect(wrapper.find('a[href="/booking?campus=renwu"]').exists()).toBe(true)
  })

  it('時段預約時寫明家長送出後由園方確認', async () => {
    mockPage('slots')
    const wrapper = await mountAt(VisitSlotsView, '/slots?campus=renwu')
    expect(wrapper.text()).not.toContain('家長在官網看不到這些場次')
    expect(wrapper.text()).toContain('由園方在 24 小時內確認才算預約成立')
  })
})

describe('手機上的日期區間面板只顯示一個月', () => {
  function stubViewport(narrow: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: narrow && query === '(max-width: 720px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  }
  const rangePicker = (wrapper: VueWrapper) =>
    wrapper.findAllComponents({ name: 'ElDatePicker' }).find(picker => picker.props('type') === 'daterange')!

  it('案件清單的送出日期：390px 用單月面板，桌機維持雙月', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never)
    stubViewport(true)
    expect(rangePicker(await mountAt(VisitRequestsView, '/visit-requests')).props('singlePanel')).toBe(true)
    stubViewport(false)
    expect(rangePicker(await mountAt(VisitRequestsView, '/visit-requests')).props('singlePanel')).toBe(false)
  })

  it('依規則產生時段與成效統計的自訂區間也一樣', async () => {
    stubViewport(true)
    vi.spyOn(api, 'get').mockResolvedValue(schedule() as never)
    expect(rangePicker(await mountAt(VisitSchedulePanel, '/', { campusKey: 'yihua', canManage: true })).props('singlePanel')).toBe(true)
    vi.spyOn(api, 'get').mockResolvedValue({
      campus_key: 'yihua', date_from: null, date_to: null, counts: {}, cancelled_by_reason: {},
      by_source: [], by_referral: [], clicks_by_entry: [], unassigned_clicks: {},
    } as never)
    const analytics = await mountAt(AnalyticsView, '/analytics')
    const period = analytics.findAllComponents({ name: 'ElSelect' }).find(item => item.attributes('aria-label') === '期間' || item.props('ariaLabel') === '期間')!
    period.vm.$emit('update:modelValue', 'custom')
    await flushPromises()
    expect(rangePicker(analytics).props('singlePanel')).toBe(true)
  })
})

describe('預約設定存檔會讓填表中的家長重新確認', () => {
  const config = { campus_key: 'yihua', version: 3, mode: 'slots', line_url: null, phone: null, external_url: null, message: null, slots_auto_confirm: false, parent_change_deadline_hours: 48 }

  it('收表單的方式在存檔按鈕旁說明', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(config as never)
    const wrapper = await mountAt(BookingSettingsView, '/booking')
    expect(wrapper.get('.live-note').text()).toContain('正在官網填預約表的家長送出時，會被請確認一次再送')
  })

  it('電話、LINE 等不收表單的方式不提', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ...config, mode: 'phone', phone: '07-000-0000' } as never)
    const wrapper = await mountAt(BookingSettingsView, '/booking')
    expect(wrapper.get('.live-note').text()).not.toContain('填預約表')
  })
})
