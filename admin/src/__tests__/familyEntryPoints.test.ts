// 招生入學點有預約的家庭開預約明細；返回鍵依來源（docs/specs/2026-10-05-visit-family-page-design.md 第 6 節；Review Focus 4）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import FunnelBoard from '../components/admissions/FunnelBoard.vue'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import FollowUpsTab from '../components/admissions/FollowUpsTab.vue'
import EventsDrawer from '../components/admissions/EventsDrawer.vue'
import VisitDetailView from '../views/VisitDetailView.vue'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
import { board, card, cleanup, mockGet, mountWith, superAdmin, visit, VR_ID, wrappers } from './admissionsTestKit'

afterEach(cleanup)

// 只有招生權限、沒有 booking.read（Review Focus 4）。
const admissionsOnly = () => testUser('reception', { id: 'adm', campus_keys: ['yihua'], effective_capabilities: ['admissions.read', 'admissions.write'] })
const followRow = (changes: Record<string, unknown> = {}) => ({
  visit_id: 'v-1', child_name: '王小安', grade: '小班', stage: 'visited', visit_date: '2026-10-01', contact_name: '王媽媽',
  phone: '0912345678', follow_up_at: '2020-01-01T02:00:00Z', follow_up_owner_id: null, follow_up_owner_name: null,
  follow_up_owner_active: null, last_contacted_at: null, last_contact_channel: null, last_contact_reached: null,
  has_visit_request: true, visit_request_id: VR_ID, version: 3, ...changes,
})
const followList = (rows: unknown[]) => ({ as_of: '2026-10-05T02:00:00Z', campus_key: 'yihua', scope: 'due', totals: { due: 1, upcoming: 0, unscheduled: 0 }, total: rows.length, page: 1, page_size: 50, rows })

describe('漏斗看板點卡片', () => {
  it('有預約：開預約明細，不開抽屜', async () => {
    mockGet({ '/admin/admissions/board': board({ visited: [card({ has_visit_request: true, visit_request_id: VR_ID })] }) })
    const { wrapper, router } = await mountWith(FunnelBoard, { props: { campusKey: 'yihua', schoolYear: 115, semester: null } })
    await wrapper.get('.funnel-card[data-id="v-1"] button.funnel-card__open').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(`/visit-requests/${VR_ID}`)
    expect(wrapper.getComponent(EventsDrawer).props('modelValue')).toBe(false)
  })
  it('手動新增或沒有 booking.read：照舊開抽屜', async () => {
    mockGet({ '/admin/admissions/board': board({ visited: [card()] }) })
    const manual = await mountWith(FunnelBoard, { props: { campusKey: 'yihua', schoolYear: 115, semester: null } })
    await manual.wrapper.get('button.funnel-card__open').trigger('click')
    expect(manual.wrapper.getComponent(EventsDrawer).props('modelValue')).toBe(true)
    cleanup()
    mockGet({ '/admin/admissions/board': board({ visited: [card({ has_visit_request: true, visit_request_id: VR_ID })] }) })
    const noBooking = await mountWith(FunnelBoard, { props: { campusKey: 'yihua', schoolYear: 115, semester: null }, user: admissionsOnly() })
    await noBooking.wrapper.get('button.funnel-card__open').trigger('click')
    expect(noBooking.router.currentRoute.value.path).toBe('/admissions')
    expect(noBooking.wrapper.getComponent(EventsDrawer).props('modelValue')).toBe(true)
  })
})

describe('訪視明細點姓名', () => {
  const props = { campusKey: 'yihua', schoolYear: 115, semester: null, month: '', visitRequestId: '' }
  it('有預約：開預約明細；「查看預約」連結拿掉了', async () => {
    mockGet({ '/admin/admissions/records': [visit({ visit_request_id: VR_ID, has_visit_request: true })] })
    const { wrapper, router } = await mountWith(RecordsTab, { props })
    expect(wrapper.text()).not.toContain('查看預約')
    await wrapper.get('button.records__name').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(`/visit-requests/${VR_ID}`)
  })
  it('沒有預約：開抽屜', async () => {
    mockGet({ '/admin/admissions/records': [visit()] })
    const { wrapper } = await mountWith(RecordsTab, { props })
    await wrapper.get('button.records__name').trigger('click')
    expect(wrapper.getComponent(EventsDrawer).props('modelValue')).toBe(true)
  })
})

describe('待追蹤的「歷程」', () => {
  it('有預約：開預約明細；沒有預約：開抽屜', async () => {
    mockGet({ '/admin/admissions/follow-ups': followList([followRow(), followRow({ visit_id: 'v-2', child_name: '手動寶貝', has_visit_request: false, visit_request_id: null })]), '/admin/admissions/staff': [] })
    const { wrapper, router } = await mountWith(FollowUpsTab, { props: { campusKey: 'yihua', scope: 'due', owner: '' } })
    const historyButtons = () => wrapper.findAll('.follow-ups-table button').filter((b) => b.text() === '歷程')
    await historyButtons()[1]!.trigger('click')
    expect(wrapper.getComponent(EventsDrawer).props()).toMatchObject({ modelValue: true, visitId: 'v-2' })
    await historyButtons()[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(`/visit-requests/${VR_ID}`)
  })
})

describe('預約明細的返回鍵（6.2）', () => {
  async function mountDetailFrom(back: string | undefined) {
    mockGet({
      [`/admin/visit-requests/${VR_ID}/contact-notes`]: [],
      [`/admin/visit-requests/${VR_ID}`]: () => ({
        id: VR_ID, campus_key: 'yihua', status: 'confirmed', parent_name: '陳媽媽', phone: '0912345678', child_name: '陳小寶',
        child_birthdate: null, email: null, referral_sources: [], age: null, preferred_time: null, questions: null, slot_id: null, slot: null,
        created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null, confirmed_at: null,
        cancelled_at: null, source: 'web', history: [], pending_reschedule: null, access_link: null, version: 1,
      }),
    })
    const pinia = createPinia()
    useAuthStore(pinia).user = superAdmin()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/visit-requests/:id', component: defineComponent({ template: '<div />' }) },
        { path: '/:rest(.*)*', component: defineComponent({ template: '<div />' }) },
      ],
    })
    if (back) Object.defineProperty(router.options.history, 'state', { configurable: true, get: () => ({ back }) })
    await router.push(`/visit-requests/${VR_ID}`)
    await router.isReady()
    const { mount } = await import('@vue/test-utils')
    const wrapper = mount(VisitDetailView, { attachTo: document.body, global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } } as never)
    wrappers.push(wrapper)
    await flushPromises()
    return { wrapper, router }
  }

  it('從招生入學來：寫「招生入學」，按下去瀏覽器返回', async () => {
    const { wrapper, router } = await mountDetailFrom('/admissions?campus=yihua&tab=funnel')
    const back = vi.spyOn(router, 'back').mockImplementation(() => undefined)
    expect(wrapper.get('.detail__back').text()).toBe('招生入學')
    await wrapper.get('.detail__back').trigger('click')
    expect(back).toHaveBeenCalledOnce()
  })
  it('從案件列表來：寫「參觀案件」並瀏覽器返回；其他來源直接開案件列表', async () => {
    const fromList = await mountDetailFrom('/visit-requests?group=past')
    const back = vi.spyOn(fromList.router, 'back').mockImplementation(() => undefined)
    expect(fromList.wrapper.get('.detail__back').text()).toBe('參觀案件')
    await fromList.wrapper.get('.detail__back').trigger('click')
    expect(back).toHaveBeenCalledOnce()
    cleanup()
    const direct = await mountDetailFrom(undefined)
    await direct.wrapper.get('.detail__back').trigger('click')
    await flushPromises()
    expect(direct.router.currentRoute.value.path).toBe('/visit-requests')
  })
})
