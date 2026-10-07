// 標記已到場後接著打開招生資料表單（2026-10-06）：案件列表「到了」、總覽今天名單「到了」、預約明細「標記已到場」。
// 招生入學開著、能改招生資料才打開；關掉表單不影響到場與招生訪視。批次標記不打開（visitRequestsBatch.test.ts）。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import DashboardView from '../views/DashboardView.vue'
import VisitDetailView from '../views/VisitDetailView.vue'
import { ApiError } from '../api/client'
import type { UserOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
import { bodyOf, button, cleanup, mockGet, mockPatch, mockPost, pathsTo, queryOf, superAdmin, visit, VR_ID, wrappers } from './admissionsTestKit'

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
})
afterEach(cleanup)

const started = { id: 'slot-started', slot_date: '2020-01-01', start_time: '10:00:00', end_time: '11:00:00' }
const booking = (changes: Record<string, unknown> = {}) => ({
  id: VR_ID, campus_key: 'yihua', status: 'confirmed', parent_name: '黃志明', phone: '0912345678', child_name: '小安',
  child_birthdate: '2022-05-01', email: null, referral_sources: [], age: null, preferred_time: null, questions: null,
  party_size: null, consent_given: false, consent_revision_id: null, consent_accepted_at: null,
  slot_id: started.id, slot: started, created_at: '2026-10-05T00:00:00Z', hold_expires_at: null, follow_up_at: null,
  confirmed_at: '2026-10-05T00:00:00Z', cancelled_at: null, source: 'web', display_status: 'past',
  history: [], pending_reschedule: null, access_link: null, version: 1, ...changes,
})
const created = () => visit({ id: 'v-1', visit_request_id: VR_ID, has_visit_request: true, child_name: '小安', contact_name: '黃志明' })

// 只能讀招生、不能改：到場照舊標記，不打開表單。
const readOnlyAdmissions = () =>
  testUser('reception', { id: 'desk', campus_keys: ['yihua'], effective_capabilities: ['admissions.read', 'booking.read', 'booking.handle'] })

const dialog = () => document.body.querySelector<HTMLElement>('.record-dialog')
const dialogButton = (text: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('.record-dialog button')].find(b => b.textContent?.trim() === text)
const dialogInput = (label: string) => document.body.querySelector<HTMLInputElement>(`.record-dialog input[aria-label="${label}"]`)

async function mountList(options: { user?: UserOut; admissions?: boolean; records?: unknown } = {}) {
  const get = mockGet({
    '/admin/visit-requests/view-counts': {},
    '/admin/visit-requests': [booking()],
    '/admin/admissions/records': options.records ?? [created()],
  })
  const pinia = createPinia()
  const auth = useAuthStore(pinia)
  auth.user = options.user ?? superAdmin()
  auth.features = { admissions: options.admissions ?? true, password_reset_email: false }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/visit-requests'); await router.isReady()
  const wrapper = mount(VisitRequestsView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, get }
}

async function arriveInList(wrapper: Awaited<ReturnType<typeof mountList>>['wrapper']) {
  await button(wrapper.get('.visit-row .attendance-actions'), '到了')!.trigger('click')
  await flushPromises()
}

describe('案件列表：到了 → 招生資料表單', () => {
  it('確認框講明接著打開表單；標記後用預約 id 查到剛建立的招生訪視，打開編輯表單（預約資料已帶入）', async () => {
    const { wrapper, get } = await mountList()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const success = vi.spyOn(ElMessage, 'success')
    const post = mockPost()
    await arriveInList(wrapper)

    expect(String(confirm.mock.calls[0]![0])).toContain('會同時建立一筆招生訪視，接著打開招生資料表單。')
    expect(post).toHaveBeenCalledWith(`/admin/visit-requests/${VR_ID}/complete`)
    const lookup = pathsTo(get, '/admin/admissions/records?')
    expect(lookup).toHaveLength(1)
    expect(Object.fromEntries(queryOf(lookup[0]!))).toMatchObject({ campus_key: 'yihua', visit_request_id: VR_ID })
    // 表單上方已經寫了已到場，不再另跳成功訊息。
    expect(success).not.toHaveBeenCalled()
    expect(dialog()?.textContent).toContain('已標記 黃志明 已到場')
    expect(dialogInput('幼生姓名')?.value).toBe('小安')
    expect(dialogButton('之後再填')).toBeDefined()
    expect(dialogButton('取消')).toBeUndefined()
  })

  it('填了英文名字按儲存：只送改過的欄位與版本', async () => {
    const { wrapper } = await mountList()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    mockPost()
    const patch = mockPatch({ '/admin/admissions/records/v-1': visit({ id: 'v-1', english_name: 'Ann', version: 2 }) })
    await arriveInList(wrapper)

    const english = dialogInput('英文名字')!
    english.value = 'Ann'
    english.dispatchEvent(new Event('input'))
    await flushPromises()
    dialogButton('儲存')!.click()
    await flushPromises()
    expect(patch).toHaveBeenCalledOnce()
    expect(String(patch.mock.calls[0]![0])).toBe('/admin/admissions/records/v-1')
    expect(bodyOf(patch, '/admin/admissions/records/v-1')).toEqual({ english_name: 'Ann', expected_version: 1 })
  })

  it('按「之後再填」關掉表單，到場已經標記好（不再送任何東西）', async () => {
    const { wrapper } = await mountList()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const post = mockPost()
    const patch = mockPatch()
    await arriveInList(wrapper)
    dialogButton('之後再填')!.click()
    await flushPromises()
    expect(dialog()?.closest('.el-overlay')?.getAttribute('style') ?? '').toContain('display: none')
    expect(post).toHaveBeenCalledOnce()
    expect(patch).not.toHaveBeenCalled()
  })

  it('查不到招生訪視：講明已到場、表單沒打開，去招生入學補', async () => {
    const { wrapper } = await mountList({ records: () => { throw new ApiError(500, { code: 'INTERNAL_ERROR' }) } })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const warning = vi.spyOn(ElMessage, 'warning')
    mockPost()
    await arriveInList(wrapper)
    expect(dialog()).toBeNull()
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '已標記 黃志明 已到場，但招生資料表單打不開；請到招生入學補填' }))
  })

  it('剛標記到場卻找不到招生訪視（空清單）：同樣講明已到場、去招生入學補，不用「建立招生訪視」的說法', async () => {
    const { wrapper } = await mountList({ records: [] })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const warning = vi.spyOn(ElMessage, 'warning')
    mockPost()
    await arriveInList(wrapper)
    expect(dialog()).toBeNull()
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '已標記 黃志明 已到場，但招生資料表單打不開；請到招生入學補填' }))
  })

  it('不能改招生資料、或招生入學沒開：照舊只標記到場，不查招生、不打開表單', async () => {
    for (const options of [{ user: readOnlyAdmissions() }, { admissions: false }]) {
      const { wrapper, get } = await mountList(options)
      const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
      const success = vi.spyOn(ElMessage, 'success')
      mockPost()
      await arriveInList(wrapper)
      expect(String(confirm.mock.calls[0]![0])).not.toContain('招生資料表單')
      expect(pathsTo(get, '/admin/admissions/records')).toEqual([])
      expect(dialog()).toBeNull()
      expect(success).toHaveBeenCalledOnce()
      cleanup()
    }
  })
})

describe('總覽今天的名單：到了 → 招生資料表單', () => {
  it('標記後打開同一份表單', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-05T12:00:00+08:00').getTime())
    const today = [{ id: VR_ID, parent_name: '王媽媽', campus_key: 'yihua', start_time: '09:00:00', end_time: '10:00:00' }]
    const get = mockGet({
      '/admin/dashboard': { today_visits: 1, today_visit_list: today, pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0 },
      '/admin/admissions/records': [created()],
    })
    const pinia = createPinia()
    const auth = useAuthStore(pinia)
    auth.user = superAdmin()
    auth.features = { admissions: true, password_reset_email: false }
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: DashboardView }, { path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/'); await router.isReady()
    const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
    wrappers.push(wrapper)
    await flushPromises()

    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const post = mockPost()
    await button(wrapper.get('.today__attendance'), '到了')!.trigger('click')
    await flushPromises()
    expect(String(confirm.mock.calls[0]![0])).toContain('接著打開招生資料表單')
    expect(post).toHaveBeenCalledWith(`/admin/visit-requests/${VR_ID}/complete`)
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/records?')[0]!))).toMatchObject({ campus_key: 'yihua', visit_request_id: VR_ID })
    expect(dialog()?.textContent).toContain('已標記 王媽媽 已到場')
  })
})

describe('預約明細：標記已到場 → 招生資料表單', () => {
  async function mountDetail(user: UserOut = superAdmin()) {
    let status = 'confirmed'
    const get = mockGet({
      [`/admin/visit-requests/${VR_ID}/contact-notes`]: [],
      [`/admin/visit-requests/${VR_ID}`]: () => booking({ parent_name: '陳媽媽', status }),
      '/admin/visit-requests?': [],
      '/admin/admissions/records/v-1/events': [],
      '/admin/admissions/records/v-1/contact-logs': [],
      '/admin/admissions/records': () => (status === 'completed' ? [created()] : []),
    })
    const post = mockPost({ [`/admin/visit-requests/${VR_ID}/complete`]: () => { status = 'completed'; return {} } })
    const pinia = createPinia()
    const auth = useAuthStore(pinia)
    auth.user = user
    auth.features = { admissions: true, password_reset_email: false }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/visit-requests/:id', component: defineComponent({ template: '<div />' }) },
        { path: '/:rest(.*)*', component: defineComponent({ template: '<div />' }) },
      ],
    })
    await router.push(`/visit-requests/${VR_ID}`); await router.isReady()
    const wrapper = mount(VisitDetailView, { attachTo: document.body, global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } } as never)
    wrappers.push(wrapper)
    await flushPromises()
    return { wrapper, get, post }
  }

  it('確認後標記，換成家庭版面並打開表單；儲存後家庭版面的招生資料跟著更新', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const success = vi.spyOn(ElMessage, 'success')
    const { wrapper, post } = await mountDetail()
    await button(wrapper, '家長到了')!.trigger('click')
    await flushPromises()
    expect(confirm.mock.calls[0]!.slice(0, 2)).toEqual(['會同時建立一筆招生訪視，接著打開招生資料表單。', '標記已到場？'])
    expect(post).toHaveBeenCalledWith(`/admin/visit-requests/${VR_ID}/complete`)
    expect(success).not.toHaveBeenCalledWith('已標記已到場，招生訪視已建立')
    expect(dialog()?.textContent).toContain('已標記 陳媽媽 已到場')

    mockPatch({ '/admin/admissions/records/v-1': { ...created(), english_name: 'Ann', version: 2 } })
    const english = dialogInput('英文名字')!
    english.value = 'Ann'
    english.dispatchEvent(new Event('input'))
    await flushPromises()
    dialogButton('儲存')!.click()
    await flushPromises()
    expect(wrapper.get('.family-data').text()).toContain('Ann')
  })

  it('不能改招生資料：照舊標記、不打開表單', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const success = vi.spyOn(ElMessage, 'success')
    const { wrapper } = await mountDetail(readOnlyAdmissions())
    await button(wrapper, '家長到了')!.trigger('click')
    await flushPromises()
    expect(confirm.mock.calls[0]![0]).toBe('會同時建立一筆招生訪視，之後在招生入學頁追蹤。')
    expect(success).toHaveBeenCalledWith('已標記已到場，招生訪視已建立')
    expect(dialog()).toBeNull()
  })
})
