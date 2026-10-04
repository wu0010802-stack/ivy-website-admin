import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import { ApiError } from '../api/client'
import type { UserOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
import { button, cleanup, deferred, hasButton, mockGet, mockPost, pathsTo, queryOf, superAdmin, visit, VR_ID, wrappers } from './admissionsTestKit'

afterEach(cleanup)

// 已開始的場次：標記已到場只在這種場次出現。
const started = { id: 'slot-started', slot_date: '2020-01-01', start_time: '10:00:00', end_time: '11:00:00' }
const detail = (changes: Record<string, unknown> = {}) => ({
  id: VR_ID, campus_key: 'yihua', status: 'confirmed', parent_name: '陳媽媽', phone: '0912345678', child_name: '陳小寶',
  child_birthdate: '2023-03-02', email: null, referral_sources: [], age: null, preferred_time: null, questions: null,
  slot_id: started.id, slot: started, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null,
  assigned_staff_id: null, confirmed_at: '2026-09-22T01:00:00Z', cancelled_at: null, source: 'web', history: [],
  pending_reschedule: null, access_link: null, version: 1, ...changes,
})

function mockDetail(data: Record<string, unknown>, records: unknown[] | (() => unknown[]) = []) {
  return mockGet({
    [`/admin/visit-requests/${VR_ID}/contact-notes`]: [],
    [`/admin/visit-requests/${VR_ID}`]: () => data,
    '/admin/visit-requests?': [],
    '/admin/slots': [],
    '/admin/visit-staff': [],
    '/admin/booking-config': {},
    '/admin/dashboard': {},
    '/admin/admissions/records': () => (typeof records === 'function' ? records() : records),
  })
}

async function mountDetail(user: UserOut = superAdmin()) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/visit-requests/:id', component: defineComponent({ template: '<div />' }) },
      { path: '/:rest(.*)*', component: defineComponent({ template: '<div />' }) },
    ],
  })
  await router.push(`/visit-requests/${VR_ID}`)
  await router.isReady()
  const wrapper = mount(VisitDetailView, { attachTo: document.body, global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('標記已到場的確認框（規格第 10 節）', () => {
  it('先確認，文案寫出會建立招生訪視；按先不要就不送', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel' as never)
    const success = vi.spyOn(ElMessage, 'success')
    mockDetail(detail())
    const post = mockPost()
    const { wrapper } = await mountDetail()
    await button(wrapper, '標記已到場')!.trigger('click')
    await flushPromises()
    expect(confirm.mock.calls[0]!.slice(0, 2)).toEqual(['會同時建立一筆招生訪視，之後在招生入學頁追蹤。', '標記已到場？'])
    expect(post).not.toHaveBeenCalled()
    confirm.mockResolvedValueOnce('confirm' as never)
    await button(wrapper, '標記已到場')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`/admin/visit-requests/${VR_ID}/complete`)
    expect(success).toHaveBeenCalledWith('已標記已到場，招生訪視已建立')
  })
  // R1：招生開關關閉時（招生 API 404）與查不到時，維持改版前的行為。
  it('招生未啟用（招生 API 回 404）：沒有確認框、維持原本訊息、沒有招生訪視區塊', async () => {
    mockDetail(detail({ status: 'completed' }), () => { throw new ApiError(404, { code: 'NOT_FOUND' }) })
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.detail__admissions').exists()).toBe(false)
    cleanup()

    const confirmAgain = vi.spyOn(ElMessageBox, 'confirm')
    const successAgain = vi.spyOn(ElMessage, 'success')
    mockDetail(detail(), () => { throw new ApiError(404, { code: 'NOT_FOUND' }) })
    const post = mockPost()
    const off = await mountDetail()
    await button(off.wrapper, '標記已到場')!.trigger('click')
    await flushPromises()
    expect(confirmAgain).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith(`/admin/visit-requests/${VR_ID}/complete`)
    expect(successAgain).toHaveBeenCalledWith('已標記已到場')
  })

  it('查招生失敗（非 404）：不確定招生是否可用，維持改版前的行為', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const success = vi.spyOn(ElMessage, 'success')
    mockDetail(detail(), () => { throw new ApiError(500, { code: 'INTERNAL_ERROR' }) })
    mockPost()
    const { wrapper } = await mountDetail()
    await button(wrapper, '標記已到場')!.trigger('click')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(success).toHaveBeenCalledWith('已標記已到場')
  })

  it('F6c：已到場但查招生回 500：不顯示招生訪視區塊', async () => {
    mockDetail(detail({ status: 'completed' }), () => { throw new ApiError(500, { code: 'INTERNAL_ERROR' }) })
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.detail__admissions').exists()).toBe(false)
  })

  it('F3：招生查詢還沒回來就按「標記已到場」：等查完，有確認框、成功文案寫招生訪視已建立', async () => {
    const slow = deferred<unknown[]>()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const success = vi.spyOn(ElMessage, 'success')
    mockDetail(detail(), () => slow.promise as never)
    const post = mockPost()
    const { wrapper } = await mountDetail()
    await button(wrapper, '標記已到場')!.trigger('click')
    await flushPromises()
    // 查詢還在跑：不能先送出（後端會建招生訪視，卻沒有確認框）。
    expect(post).not.toHaveBeenCalled()
    slow.resolve([])
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(post).toHaveBeenCalledWith(`/admin/visit-requests/${VR_ID}/complete`)
    expect(success).toHaveBeenCalledWith('已標記已到場，招生訪視已建立')
  })

  it('沒有招生權限（沒查招生）：維持改版前的行為', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const success = vi.spyOn(ElMessage, 'success')
    mockDetail(detail())
    mockPost()
    const bookingOnly = testUser('reception', { campus_keys: ['yihua'], effective_capabilities: ['booking.read', 'booking.handle'] })
    const { wrapper } = await mountDetail(bookingOnly)
    await button(wrapper, '標記已到場')!.trigger('click')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(success).toHaveBeenCalledWith('已標記已到場')
  })
})

describe('預約明細的招生訪視連結', () => {
  it('有連結的招生訪視：顯示階段與連結，帶校區、vr 與不限學年', async () => {
    const get = mockDetail(detail({ status: 'completed' }), [visit({ visit_request_id: VR_ID, has_visit_request: true, has_deposit: true, stage: 'deposited' })])
    const { wrapper } = await mountDetail()
    const lookup = pathsTo(get, '/admin/admissions/records?')
    expect(lookup).toHaveLength(1)
    expect(Object.fromEntries(queryOf(lookup[0]!))).toEqual({ campus_key: 'yihua', visit_request_id: VR_ID, page: '1', page_size: '1' })
    const link = wrapper.get('.detail__admissions a')
    expect(link.text()).toBe('已預繳・在招生入學查看')
    const href = new URL(link.attributes('href')!, 'http://admin.invalid')
    expect(href.pathname).toBe('/admissions')
    expect(Object.fromEntries(href.searchParams)).toEqual({ campus: 'yihua', tab: 'records', vr: VR_ID, sy: 'all' })
  })

  it('已到場但沒有招生訪視：可以建立，建立後換成連結', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    mockDetail(detail({ status: 'completed' }), [])
    const post = mockPost({ [`/admin/admissions/from-visit-request/${VR_ID}`]: visit({ visit_request_id: VR_ID, stage: 'visited' }) })
    const { wrapper } = await mountDetail()
    expect(wrapper.get('.detail__admissions').text()).toContain('已到場，但還沒有招生訪視。')
    await button(wrapper, '建立招生訪視')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`/admin/admissions/from-visit-request/${VR_ID}`)
    expect(success).toHaveBeenCalledWith('已建立招生訪視')
    expect(wrapper.get('.detail__admissions a').text()).toBe('已訪視・在招生入學查看')
  })

  it('補建被拒（例如已匿名化）顯示原因', async () => {
    const error = vi.spyOn(ElMessage, 'error')
    mockDetail(detail({ status: 'completed' }), [])
    mockPost({ [`/admin/admissions/from-visit-request/${VR_ID}`]: () => { throw new ApiError(409, { code: 'VISIT_REQUEST_ANONYMIZED' }) } })
    const { wrapper } = await mountDetail()
    await button(wrapper, '建立招生訪視')!.trigger('click')
    await flushPromises()
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: '這筆預約已依保存政策匿名化，不能再建立招生訪視' }))
  })

  it('還沒到場、也沒有招生訪視：不顯示這一區', async () => {
    mockDetail(detail(), [])
    const { wrapper } = await mountDetail()
    expect(wrapper.find('.detail__admissions').exists()).toBe(false)
  })

  it('能看招生、不能建立的帳號只看到說明；沒有 admissions.read 不查招生 API', async () => {
    mockDetail(detail({ status: 'completed' }), [])
    const viewer = testUser('reception', { campus_keys: ['yihua'], effective_capabilities: ['admissions.read', 'booking.read'] })
    const { wrapper } = await mountDetail(viewer)
    expect(wrapper.get('.detail__admissions').text()).toContain('請有招生權限的同事建立')
    expect(hasButton(wrapper, '建立招生訪視')).toBe(false)
    cleanup()

    const get = mockDetail(detail({ status: 'completed' }), [])
    const bookingOnly = testUser('reception', { campus_keys: ['yihua'], effective_capabilities: ['booking.read', 'booking.handle'] })
    const second = await mountDetail(bookingOnly)
    expect(pathsTo(get, '/admin/admissions')).toEqual([])
    expect(second.wrapper.find('.detail__admissions').exists()).toBe(false)
  })
})

describe('參觀後追蹤區塊（2026-10-04 參觀後追蹤規格 7.6）', () => {
  it('已到場且有招生訪視：顯示階段、下次聯絡、負責人，能記錄聯絡；下次聯絡選擇器換成提示', async () => {
    mockDetail(detail({ status: 'completed' }), [
      visit({ visit_request_id: VR_ID, has_visit_request: true, follow_up_at: '2020-01-01T02:00:00Z', last_contacted_at: null }),
    ])
    const { wrapper } = await mountDetail()
    const section = wrapper.get('.detail__after')
    expect(section.text()).toContain('參觀後追蹤')
    expect(section.text()).toContain('已訪視')
    expect(section.get('.is-due').text()).toMatch(/^逾 \d+ 天$/)
    expect(section.text()).toContain('還沒聯絡過')
    expect(hasButton(section, '記錄聯絡')).toBe(true)
    expect(hasButton(section, '改期／負責人')).toBe(true)
    expect(wrapper.find('.notes__follow').exists()).toBe(false)
    expect(wrapper.get('.notes__untracked').text()).toBe('已到場的案件請在上方「參觀後追蹤」排下次聯絡。')
  })

  it('還沒到場、或沒有招生權限：不顯示這個區塊', async () => {
    mockDetail(detail({ status: 'confirmed' }), [visit({ visit_request_id: VR_ID })])
    const confirmed = await mountDetail()
    expect(confirmed.wrapper.find('.detail__after').exists()).toBe(false)
    expect(confirmed.wrapper.find('.notes__follow').exists()).toBe(true)
    cleanup()
    const get = mockDetail(detail({ status: 'completed' }), [visit({ visit_request_id: VR_ID })])
    const desk = await mountDetail(testUser('reception', { campus_keys: ['yihua'], effective_capabilities: ['booking.read', 'booking.handle'] }))
    expect(desk.wrapper.find('.detail__after').exists()).toBe(false)
    expect(pathsTo(get, '/admin/admissions/records')).toEqual([])
  })
})
