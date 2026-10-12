// 預約明細當家庭頁（docs/specs/2026-10-05-visit-family-page-design.md 第 5 節；Review Focus 1、2、3）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import FamilyActions from '../components/visit/FamilyActions.vue'
import FamilyAdmissionsData from '../components/visit/FamilyAdmissionsData.vue'
import { ApiError } from '../api/client'
import type { UserOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { writeVisitNoteDraft } from '../composables/visitNoteDraft'
import { testUser } from './fixtures'
import { button, cleanup, deferred, hasButton, mockGet, mockPost, pathsTo, queryOf, superAdmin, visit, VR_ID, VR_ID_2, wrappers } from './admissionsTestKit'

afterEach(cleanup)

const started = { id: 'slot-started', slot_date: '2020-01-01', start_time: '10:00:00', end_time: '11:00:00' }
const detail = (changes: Record<string, unknown> = {}) => ({
  id: VR_ID, campus_key: 'yihua', status: 'completed', parent_name: '陳媽媽', phone: '0911000111', child_name: '陳小寶',
  child_birthdate: '2023-03-02', email: 'chen@example.org', referral_sources: [], age: null, preferred_time: null, questions: null,
  slot_id: started.id, slot: started, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null,
  confirmed_at: '2026-09-22T01:00:00Z', cancelled_at: null, source: 'web',
  access_link: null, version: 1,
  history: [
    { id: 'h1', event_type: 'created', source: 'parent', actor_user_id: null, actor_email: null, actor_display_name: null, before: null, after: null, reason: null, created_at: '2026-09-22T00:00:00Z' },
    { id: 'h2', event_type: 'completed', source: 'staff', actor_user_id: 'desk', actor_email: 'desk@example.invalid', actor_display_name: '櫃台小美', before: null, after: null, reason: null, created_at: '2026-10-06T02:35:00Z' },
  ],
  ...changes,
})
const linked = (changes: Record<string, unknown> = {}) =>
  visit({ visit_request_id: VR_ID, has_visit_request: true, visit_date: '2026-10-06', phone: '0912345678', english_name: null, father_occupation: null, mother_occupation: null, ...changes })
const staffList = [{ id: 'desk', display_name: '櫃台小美', email: 'desk@example.invalid' }]
const visitStaff = [{ id: 'desk', email: 'desk@example.invalid', display_name: '櫃台小美', role: 'reception', is_active: true, campus_keys: ['yihua'] }]

function mockFamily(options: {
  data?: Record<string, unknown>
  records?: unknown[] | ((path: string) => unknown)
  events?: unknown
  logs?: unknown
  notes?: unknown[]
  extra?: Record<string, unknown>
} = {}) {
  return mockGet({
    [`/admin/visit-requests/${VR_ID}/contact-notes`]: options.notes ?? [
      { id: 'n1', note: '提醒參觀時間', created_at: '2026-10-03T06:05:00Z', created_by: 'desk', created_by_display_name: '櫃台小美', created_by_email: 'desk@example.invalid' },
    ],
    [`/admin/visit-requests/${VR_ID}`]: () => options.data ?? detail(),
    '/admin/visit-requests?': [],
    '/admin/slots': [],
    '/admin/visit-staff': visitStaff,
    '/admin/booking-config': {},
    '/admin/admissions/records/v-1/events': options.events ?? [
      { id: 'e1', event_type: 'created', from_stage: null, to_stage: 'visited', reason: null, metadata_json: { origin: 'visit_request' }, actor_user_id: 'desk', actor_name: '櫃台小美', created_at: '2026-10-06T02:35:00Z' },
    ],
    '/admin/admissions/records/v-1/contact-logs': options.logs ?? [
      { id: 'l1', recruitment_visit_id: 'v-1', contacted_at: '2026-10-08T08:20:00Z', channel: 'phone', reached: true, note: '下週一前回覆', next_follow_up_at: null, created_by: 'desk', created_by_name: '櫃台小美', created_at: '2026-10-08T08:21:00Z' },
    ],
    '/admin/admissions/records': options.records ?? [linked()],
    '/admin/admissions/staff': staffList,
    ...options.extra,
  })
}

async function mountDetail(user: UserOut = superAdmin(), back?: string, featureOn = true) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  useAuthStore(pinia).features = { admissions: featureOn, password_reset_email: false }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/visit-requests/:id', component: defineComponent({ template: '<div />' }) },
      { path: '/:rest(.*)*', component: defineComponent({ template: '<div />' }) },
    ],
  })
  // memory history 不記 state.back：要測「從哪裡來」就直接給（VisitDetailView 讀 router.options.history.state）。
  if (back) Object.defineProperty(router.options.history, 'state', { configurable: true, get: () => ({ back }) })
  await router.push(`/visit-requests/${VR_ID}`)
  await router.isReady()
  const { mount } = await import('@vue/test-utils')
  const wrapper = mount(VisitDetailView, { attachTo: document.body, global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('家庭版面（5.1–5.7）', () => {
  it('頁首是招生階段與到場日（承辦人 2026-10-06 拿掉）；撥號用招生電話', async () => {
    mockFamily()
    const { wrapper } = await mountDetail()
    expect(wrapper.get('.detail__status').text()).toContain('已訪視')
    expect(wrapper.get('.detail__status').text()).toContain('10/06 到場')
    expect(wrapper.get('.detail__head').text()).not.toContain('承辦')
    expect(wrapper.get('.detail__call').attributes('href')).toBe('tel:0912345678')
  })

  it('招生資料在上、預約資料收合；展開後看得到家長填的內容', async () => {
    mockFamily()
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.family-data').exists()).toBe(true)
    const booking = wrapper.get('.detail__data')
    expect(booking.get('h2').text()).toBe('家長預約時填寫的資料')
    expect(booking.get('#visit-booking-data').isVisible()).toBe(false)
    await button(booking, '展開')!.trigger('click')
    expect(booking.get('#visit-booking-data').isVisible()).toBe(true)
    expect(booking.text()).toContain('chen@example.org')
  })

  it('聯絡紀錄合併參觀前後；沒有輸入框；歷程合併招生事件', async () => {
    mockFamily()
    const { wrapper } = await mountDetail()
    expect(wrapper.findAll('.timeline__item[data-kind="note"][data-phase]').map((item) => item.attributes('data-phase'))).toEqual(['after', 'before'])
    expect(wrapper.find('.notes__form').exists()).toBe(false)
    const titles = wrapper.findAll('.timeline__item[data-kind="event"] strong').map((el) => el.text())
    expect(titles).toEqual(['建立訪視（官網預約到場）', '標記已到場', '家長從官網送出'])
  })

  it('處理區換成招生動作；舊的參觀後追蹤、招生入學連結都不在了', async () => {
    mockFamily()
    const { wrapper } = await mountDetail()
    expect(wrapper.findComponent(FamilyActions).exists()).toBe(true)
    expect(hasButton(wrapper, '記錄聯絡')).toBe(true)
    expect(wrapper.find('.detail__after').exists()).toBe(false)
    expect(wrapper.find('.detail__admissions').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('在招生入學查看')
  })

  it('最後處理含參觀後聯絡', async () => {
    mockFamily()
    const { wrapper } = await mountDetail(testUser('super_admin', { id: 'desk' }))
    expect(wrapper.get('.detail__handled').text()).toContain('最後處理：你・2026/10/08 16:21・記錄聯絡')
  })

  it('處理區往上傳變更：換掉訪視並重讀事件與聯絡紀錄', async () => {
    const get = mockFamily()
    const { wrapper } = await mountDetail()
    const before = pathsTo(get, '/admin/admissions/records/v-1/contact-logs').length
    wrapper.getComponent(FamilyActions).vm.$emit('changed', linked({ stage: 'deposited', has_deposit: true, version: 2 }))
    await flushPromises()
    expect(wrapper.get('.detail__status').text()).toContain('已預繳')
    expect(pathsTo(get, '/admin/admissions/records/v-1/contact-logs').length).toBe(before + 1)
  })
})

describe('不是家庭版面的情況維持原樣（5.9）', () => {
  it('招生開關關閉：沒有招生區塊，聯絡紀錄輸入框還在', async () => {
    mockFamily({ records: () => { throw new ApiError(404, { code: 'NOT_FOUND' }) } })
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.family-data').exists()).toBe(false)
    expect(wrapper.find('.notes__form').exists()).toBe(true)
    expect(wrapper.get('.detail__data h2').text()).toBe('家長填寫的資料')
  })

  it('沒有 admissions.read：不查招生 API，畫面同改版前', async () => {
    const get = mockFamily()
    const { wrapper } = await mountDetail(testUser('reception', { campus_keys: ['yihua'], effective_capabilities: ['booking.read', 'booking.handle'] }))
    expect(pathsTo(get, '/admin/admissions')).toEqual([])
    expect(wrapper.find('.family-data').exists()).toBe(false)
  })

  it('已到場但沒有招生訪視：補建後直接切成家庭版面', async () => {
    let records: unknown[] = []
    mockFamily({ records: () => records })
    mockPost({ [`/admin/admissions/from-visit-request/${VR_ID}`]: () => { records = [linked()]; return linked() } })
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.family-data').exists()).toBe(false)
    await button(wrapper, '建立招生訪視')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.family-data').exists()).toBe(true)
    expect(wrapper.get('.detail__status').text()).toContain('已訪視')
  })

  it('招生訪視讀取失敗（非 404）：提示並能重新載入', async () => {
    let fail = true
    mockFamily({ records: () => { if (fail) throw new ApiError(500, { code: 'INTERNAL' }); return [linked()] } })
    const { wrapper } = await mountDetail()
    expect(wrapper.get('.detail__admissions').text()).toContain('招生資料讀不到')
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.family-data').exists()).toBe(true)
  })
})

describe('Review Focus', () => {
  it('1：家庭版面不因看不到的草稿擋離開', async () => {
    writeVisitNoteDraft(VR_ID, '打到一半的參觀前紀錄')
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    mockFamily()
    const { router } = await mountDetail()
    await router.push('/admissions')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/admissions')
    writeVisitNoteDraft(VR_ID, '')
  })

  it('2：切到下一筆後，前一筆較晚回來的招生事件與聯絡紀錄不會出現', async () => {
    const slowEvents = deferred<unknown[]>()
    const slowLogs = deferred<unknown[]>()
    mockFamily({
      events: () => slowEvents.promise,
      logs: () => slowLogs.promise,
      records: (path: string) => (queryOf(path).get('visit_request_id') === VR_ID_2 ? [linked({ id: 'v-2', visit_request_id: VR_ID_2 })] : [linked()]),
      extra: {
        [`/admin/visit-requests/${VR_ID_2}/contact-notes`]: [],
        [`/admin/visit-requests/${VR_ID_2}`]: () => detail({ id: VR_ID_2, history: [] }),
        '/admin/admissions/records/v-2/events': [],
        '/admin/admissions/records/v-2/contact-logs': [],
      },
    })
    const { wrapper, router } = await mountDetail()
    await router.push(`/visit-requests/${VR_ID_2}`)
    await flushPromises()
    expect(wrapper.find('.family-data').exists()).toBe(true)
    slowEvents.resolve([{ id: 'late', event_type: 'deposit_added', from_stage: 'visited', to_stage: 'deposited', reason: null, metadata_json: null, actor_user_id: 'desk', actor_name: '櫃台小美', created_at: '2026-10-14T01:30:00Z' }])
    slowLogs.resolve([{ id: 'late-log', recruitment_visit_id: 'v-1', contacted_at: '2026-10-14T08:20:00Z', channel: 'phone', reached: true, note: '前一筆的獨特聯絡內容', next_follow_up_at: null, created_by: 'desk', created_by_name: '櫃台小美', created_at: '2026-10-14T08:21:00Z' }])
    await flushPromises()
    expect(wrapper.text()).not.toContain('加上預繳')
    expect(wrapper.text()).not.toContain('前一筆的獨特聯絡內容')
  })

  it('3：已匿名化的招生訪視：唯讀，不顯示撥號鈕（預約電話也已被改成假號碼）', async () => {
    mockFamily({ records: [linked({ anonymized_at: '2026-10-01T00:00:00Z', phone: '0900000000' })] })
    const { wrapper } = await mountDetail()
    expect(hasButton(wrapper, '記錄聯絡')).toBe(false)
    expect(hasButton(wrapper, '編輯')).toBe(false)
    expect(wrapper.find('.detail__call').exists()).toBe(false)
  })
})

describe('唯讀招生權限（5.9）', () => {
  it('只有 admissions.read：看得到家庭版面，沒有記錄聯絡與重新預約', async () => {
    mockFamily()
    const { wrapper } = await mountDetail(testUser('reception', { campus_keys: ['yihua'], effective_capabilities: ['admissions.read', 'booking.read'] }))
    expect(wrapper.find('.family-actions').exists()).toBe(true)
    expect(wrapper.get('.detail__status').text()).toContain('已訪視')
    expect(hasButton(wrapper, '記錄聯絡')).toBe(false)
    expect(hasButton(wrapper, '重新預約（另建新案）')).toBe(false)
    expect(wrapper.text()).not.toContain('你的帳號只能查看案件')
  })

  it('只有 admissions.read：頁首沒有主動作可給，不留空的 .case-hero__actions 容器（不佔 gap）', async () => {
    mockFamily()
    const { wrapper } = await mountDetail(testUser('reception', { campus_keys: ['yihua'], effective_capabilities: ['admissions.read', 'booking.read'] }))
    expect(wrapper.find('.case-hero__actions').exists()).toBe(false)
    // 右側欄只剩狀態與撥號。
    expect(wrapper.get('.case-hero__side').find('.detail__status').exists()).toBe(true)
  })

  it('有 admissions.write 的家庭版面頁首仍有「填招生資料」；招生訪視已匿名化就跟著收起容器', async () => {
    mockFamily()
    const writable = await mountDetail()
    expect(writable.wrapper.get('.case-hero__actions').attributes('data-stage')).toBe('family')
    expect(hasButton(writable.wrapper.get('.case-hero__actions'), '填招生資料')).toBe(true)
    cleanup()
    mockFamily({ records: [linked({ anonymized_at: '2026-10-01T00:00:00Z', phone: '0900000000' })] })
    const anonymized = await mountDetail()
    expect(anonymized.wrapper.find('.case-hero__actions').exists()).toBe(false)
  })
})

describe('409 重讀不卸載家庭版面（5.9）', () => {
  it('FamilyActions、FamilyAdmissionsData 的 stale：版面留著，回來後換成新版本', async () => {
    const slow = deferred<unknown[]>()
    let calls = 0
    mockFamily({ records: () => (++calls === 1 ? [linked()] : slow.promise) })
    const { wrapper } = await mountDetail()
    wrapper.getComponent(FamilyActions).vm.$emit('stale')
    wrapper.getComponent(FamilyAdmissionsData).vm.$emit('stale')
    await flushPromises()
    expect(wrapper.find('.family-actions').exists()).toBe(true)
    expect(wrapper.find('.family-data').exists()).toBe(true)
    slow.resolve([linked({ version: 2 })])
    await flushPromises()
    expect(wrapper.getComponent(FamilyActions).props('visit').version).toBe(2)
    expect(wrapper.find('.family-data').exists()).toBe(true)
  })
})

describe('載入招生查詢時不閃改版前的畫面（F2）', () => {
  it('查詢回來前只有骨架；回來後換成家庭版面', async () => {
    const slow = deferred<unknown[]>()
    mockFamily({ records: () => slow.promise })
    const { wrapper } = await mountDetail()
    expect(wrapper.findAll('.detail__family-pending').length).toBe(1)
    expect(wrapper.find('.notes__form').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('這筆案件已結案')
    expect(wrapper.find('.detail__status').exists()).toBe(false)
    expect(wrapper.find('.detail__call').exists()).toBe(false)
    slow.resolve([linked()])
    await flushPromises()
    expect(wrapper.find('.detail__family-pending').exists()).toBe(false)
    expect(wrapper.find('.family-data').exists()).toBe(true)
    expect(wrapper.get('.detail__status').text()).toContain('已訪視')
  })

  it('查詢 404：回來後是改版前畫面，沒有骨架', async () => {
    const slow = deferred<unknown[]>()
    mockFamily({ records: () => slow.promise })
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.detail__family-pending').exists()).toBe(true)
    slow.reject(new ApiError(404, { code: 'NOT_FOUND' }))
    await flushPromises()
    expect(wrapper.find('.detail__family-pending').exists()).toBe(false)
    expect(wrapper.find('.notes__form').exists()).toBe(true)
  })

  it('預約不是已到場：從頭到尾沒有骨架', async () => {
    const slow = deferred<unknown[]>()
    mockFamily({ data: detail({ status: 'confirmed' }), records: () => slow.promise })
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.detail__family-pending').exists()).toBe(false)
    expect(wrapper.find('.notes__form').exists()).toBe(true)
  })

  it('骨架期間看不到的草稿不擋離開', async () => {
    writeVisitNoteDraft(VR_ID, '打到一半')
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const slow = deferred<unknown[]>()
    mockFamily({ records: () => slow.promise })
    const { router } = await mountDetail()
    await router.push('/admissions')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    writeVisitNoteDraft(VR_ID, '')
  })
})

describe('其他修正', () => {
  it('M7：招生歷程讀不到的提示在時間線前面', async () => {
    mockFamily({ events: () => { throw new ApiError(500, { code: 'INTERNAL' }) } })
    const { wrapper } = await mountDetail()
    const html = wrapper.html()
    const hint = html.indexOf('招生的歷程讀不到')
    expect(hint).toBeGreaterThan(-1)
    expect(hint).toBeLessThan(html.indexOf('case-timeline__list'))
  })

  it('M8：切回分頁重讀預約時，家庭版面的招生訪視也一起重讀', async () => {
    const get = mockFamily()
    const { wrapper } = await mountDetail()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 10 * 60 * 1000)
    try {
      const before = pathsTo(get, '/admin/admissions/records?').length
      document.dispatchEvent(new Event('visibilitychange'))
      await flushPromises()
      expect(pathsTo(get, '/admin/admissions/records?').length).toBeGreaterThan(before)
      expect(wrapper.find('.family-data').exists()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('撥號與開關（第二輪）', () => {
  it('招生電話是空的：退回預約電話', async () => {
    mockFamily({ records: [linked({ phone: null })] })
    const { wrapper } = await mountDetail()
    expect(wrapper.get('.detail__call').attributes('href')).toBe('tel:0911000111')
  })

  it('招生開關關閉：已到場的預約一掛載就沒有骨架', async () => {
    const slow = deferred<unknown[]>()
    mockFamily({ records: () => slow.promise })
    const { wrapper } = await mountDetail(superAdmin(), undefined, false)
    expect(wrapper.find('.detail__family-pending').exists()).toBe(false)
  })
})
