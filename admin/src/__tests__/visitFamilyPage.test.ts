// 預約明細當家庭頁（docs/specs/2026-10-05-visit-family-page-design.md 第 5 節；Review Focus 1、2、3）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import FamilyActions from '../components/visit/FamilyActions.vue'
import { ApiError } from '../api/client'
import type { UserOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { writeVisitNoteDraft } from '../composables/visitNoteDraft'
import { testUser } from './fixtures'
import { button, cleanup, deferred, hasButton, mockGet, mockPost, pathsTo, superAdmin, visit, VR_ID, VR_ID_2, wrappers } from './admissionsTestKit'

afterEach(cleanup)

const started = { id: 'slot-started', slot_date: '2020-01-01', start_time: '10:00:00', end_time: '11:00:00' }
const detail = (changes: Record<string, unknown> = {}) => ({
  id: VR_ID, campus_key: 'yihua', status: 'completed', parent_name: '陳媽媽', phone: '0911000111', child_name: '陳小寶',
  child_birthdate: '2023-03-02', email: 'chen@example.org', referral_sources: [], age: null, preferred_time: null, questions: null,
  slot_id: started.id, slot: started, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null,
  assigned_staff_id: 'desk', confirmed_at: '2026-09-22T01:00:00Z', cancelled_at: null, source: 'web', pending_reschedule: null,
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
  records?: unknown[] | (() => unknown)
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

async function mountDetail(user: UserOut = superAdmin(), back?: string) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
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
  it('頁首是招生階段與到場日、承辦人小字；撥號用招生電話', async () => {
    mockFamily()
    const { wrapper } = await mountDetail()
    expect(wrapper.get('.detail__status').text()).toContain('已訪視')
    expect(wrapper.get('.detail__status').text()).toContain('10/06 到場')
    expect(wrapper.get('.detail__head').text()).toContain('・預約承辦 櫃台小美')
    expect(wrapper.get('.detail__call').attributes('href')).toBe('tel:0912345678')
  })

  it('招生資料在上、預約資料收合；展開後看得到家長填的內容', async () => {
    mockFamily()
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.family-data').exists()).toBe(true)
    const booking = wrapper.get('.detail__data')
    expect(booking.get('h2').text()).toBe('家長預約時填寫的資料')
    expect(booking.find('.el-descriptions').isVisible()).toBe(false)
    await button(booking, '展開')!.trigger('click')
    expect(booking.find('.el-descriptions').isVisible()).toBe(true)
    expect(booking.text()).toContain('chen@example.org')
  })

  it('聯絡紀錄合併參觀前後；沒有輸入框；歷程合併招生事件', async () => {
    mockFamily()
    const { wrapper } = await mountDetail()
    expect(wrapper.findAll('.family-notes__item').map((item) => item.attributes('data-phase'))).toEqual(['after', 'before'])
    expect(wrapper.find('.notes__form').exists()).toBe(false)
    const titles = wrapper.findAll('.timeline__item strong').map((el) => el.text())
    expect(titles).toEqual(['建立訪視（官網預約到場）', '標記已到場', '家長從官網送出'])
  })

  it('處理區換成招生動作；舊的參觀後追蹤、招生入學連結、承辦人下拉都不在了', async () => {
    mockFamily()
    const { wrapper } = await mountDetail()
    expect(wrapper.findComponent(FamilyActions).exists()).toBe(true)
    expect(hasButton(wrapper, '記錄聯絡')).toBe(true)
    expect(wrapper.find('.detail__after').exists()).toBe(false)
    expect(wrapper.find('.detail__admissions').exists()).toBe(false)
    expect(wrapper.find('#visit-assignee').exists()).toBe(false)
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

  it('2：切到下一筆後，前一筆較晚回來的招生事件不會出現', async () => {
    const slow = deferred<unknown[]>()
    mockFamily({
      events: () => slow.promise,
      extra: {
        [`/admin/visit-requests/${VR_ID_2}/contact-notes`]: [],
        [`/admin/visit-requests/${VR_ID_2}`]: () => detail({ id: VR_ID_2, status: 'confirmed', history: [] }),
      },
    })
    const { wrapper, router } = await mountDetail()
    await router.push(`/visit-requests/${VR_ID_2}`)
    await flushPromises()
    slow.resolve([{ id: 'late', event_type: 'deposit_added', from_stage: 'visited', to_stage: 'deposited', reason: null, metadata_json: null, actor_user_id: 'desk', actor_name: '櫃台小美', created_at: '2026-10-14T01:30:00Z' }])
    await flushPromises()
    expect(wrapper.text()).not.toContain('加上預繳')
    expect(wrapper.find('.family-data').exists()).toBe(false)
  })

  it('3：已匿名化的招生訪視：唯讀，撥號退回預約電話', async () => {
    mockFamily({ records: [linked({ anonymized_at: '2026-10-01T00:00:00Z', phone: '0900000000' })] })
    const { wrapper } = await mountDetail()
    expect(hasButton(wrapper, '記錄聯絡')).toBe(false)
    expect(hasButton(wrapper, '編輯')).toBe(false)
    expect(wrapper.get('.detail__call').attributes('href')).toBe('tel:0911000111')
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
})
