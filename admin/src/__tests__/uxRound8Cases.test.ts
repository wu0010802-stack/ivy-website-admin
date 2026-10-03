// 2026-10-03 第八輪：兩位櫃台同時處理同一案件（稽核 09-28）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import DashboardView from '../views/DashboardView.vue'
import UsersView from '../views/UsersView.vue'
import VisitDetailView from '../views/VisitDetailView.vue'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import UserActions from '../components/UserActions.vue'
import { api, ApiError } from '../api/client'
import { lastHandled } from '../api/visitHistory'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach((w) => w.unmount()); wrappers.length = 0; vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = '' })

const future = { id: 'slot-f', slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00' }
const event = (extra: Record<string, unknown>) => ({
  id: `e-${Math.random()}`, event_type: 'contact_logged', source: 'staff', actor_user_id: 'u-wang', actor_email: 'wang@ivy.example',
  actor_display_name: '王老師', before: null, after: null, reason: null, created_at: '2026-10-03T02:00:00Z', ...extra,
})
const caseOf = (extra: Record<string, unknown> = {}) => ({
  id: 'case-a', campus_key: 'yihua', status: 'confirmed', parent_name: '黃志明', phone: '0912345678', child_name: null,
  child_birthdate: null, email: null, referral_sources: [], age: null, preferred_time: null, questions: null,
  slot_id: future.id, slot: future, created_at: '2026-09-22T00:00:00Z', hold_expires_at: null, follow_up_at: null,
  assigned_staff_id: null, confirmed_at: '2026-09-22T00:00:00Z', cancelled_at: null, source: 'web', display_status: 'upcoming',
  history: [], pending_reschedule: null, access_link: null, version: 1, ...extra,
})

async function mountDetail(responses: () => Record<string, unknown>) {
  vi.spyOn(api, 'get').mockImplementation(async (path) => {
    const url = String(path)
    if (url.endsWith('/contact-notes')) return [] as never
    if (url.startsWith('/admin/booking-config/')) return { parent_email_enabled: false } as never
    if (url.startsWith('/admin/slots') || url.startsWith('/admin/visit-requests?') || url.startsWith('/admin/visit-staff')) return [] as never
    return responses() as never
  })
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/visit-requests/:id', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/visit-requests/case-a'); await router.isReady()
  const wrapper = mount(VisitDetailView, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('lastHandled', () => {
  it('取最近一筆後台同事的歷程；家長與系統的不算；自己做的寫「你」', () => {
    const history = [
      event({ created_at: '2026-10-03T01:00:00Z', event_type: 'assigned' }),
      event({ created_at: '2026-10-03T03:00:00Z', source: 'parent', actor_user_id: null, actor_email: null, actor_display_name: null, event_type: 'details_updated' }),
      event({ created_at: '2026-10-03T02:00:00Z' }),
    ]
    expect(lastHandled(history as never, 'me')).toEqual({ who: '王老師', at: '2026-10-03T02:00:00Z', what: '新增聯絡紀錄', self: false })
    expect(lastHandled([event({ actor_user_id: 'me' })] as never, 'me')).toMatchObject({ who: '你', self: true })
    expect(lastHandled([], 'me')).toBeNull()
  })
})

describe('案件明細：同時處理', () => {
  it('頁首寫最後處理：誰・何時・做了什麼', async () => {
    const wrapper = await mountDetail(() => caseOf({ history: [event({})] }))
    expect(wrapper.get('.detail__handled').text()).toMatch(/^最後處理：王老師・.+・新增聯絡紀錄$/)
  })

  it('按取消時別人已經結案：重讀明細，寫出現在的狀態與是誰處理的', async () => {
    let current = caseOf()
    const wrapper = await mountDetail(() => current)
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '' } as never)
    vi.spyOn(api, 'post').mockImplementation(async () => {
      current = caseOf({ status: 'cancelled', display_status: 'cancelled', cancelled_at: '2026-10-03T02:00:00Z', history: [event({ event_type: 'cancelled' })] })
      throw new ApiError(409, { code: 'INVALID_TRANSITION', message: '這筆案件現在是「已取消」，不能取消' })
    })
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation((() => undefined) as never)
    await wrapper.get('.detail__cancel').trigger('click')
    await flushPromises()
    const message = String((warning.mock.calls[0]![0] as { message: string }).message)
    expect(message).toContain('剛被處理過')
    expect(message).toContain('王老師')
    expect(message).toContain('已取消')
    expect(wrapper.get('.detail__status').text()).toContain('已取消')
  })

  it('狀態沒變的 INVALID_TRANSITION：照後端原因提示，不說被別人處理', async () => {
    const wrapper = await mountDetail(() => caseOf())
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '' } as never)
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, { code: 'INVALID_TRANSITION', message: '參觀還沒開始，不能標記' }))
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation((() => undefined) as never)
    const error = vi.spyOn(ElMessage, 'error').mockImplementation((() => undefined) as never)
    await wrapper.get('.detail__cancel').trigger('click')
    await flushPromises()
    expect(warning).not.toHaveBeenCalled()
    expect(String((error.mock.calls[0]![0] as { message: string }).message)).toBe('參觀還沒開始，不能標記')
  })

  it('切回分頁超過 30 秒靜默重讀；同事剛改過就提示；打到一半的聯絡紀錄不被清掉', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T03:00:00Z'))
    let current = caseOf()
    const wrapper = await mountDetail(() => current)
    const note = wrapper.get('textarea')
    await note.setValue('家長說下週再約')
    current = caseOf({ history: [event({ event_type: 'assigned', created_at: '2026-10-03T03:00:20Z' })] })
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation((() => undefined) as never)

    vi.setSystemTime(new Date('2026-10-03T03:00:10Z'))
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(warning).not.toHaveBeenCalled()

    vi.setSystemTime(new Date('2026-10-03T03:00:40Z'))
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(String((warning.mock.calls[0]![0] as { message: string }).message)).toBe('王老師剛剛指派承辦人，畫面已更新。')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('家長說下週再約')
  })

  it('focus 與 visibilitychange 連續觸發：只重讀一次、只提示一次', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T03:00:00Z'))
    let current = caseOf()
    let reads = 0
    const wrapper = await mountDetail(() => { reads += 1; return current })
    current = caseOf({ history: [event({ event_type: 'assigned', created_at: '2026-10-03T03:00:20Z' })] })
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation((() => undefined) as never)
    const before = reads
    vi.setSystemTime(new Date('2026-10-03T03:00:40Z'))
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(reads - before).toBe(1)
    expect(warning).toHaveBeenCalledTimes(1)
    expect(wrapper.exists()).toBe(true)
  })

  it('變動來自家長、最近的同事動作是舊的：不點同事名字', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T03:00:00Z'))
    const old = event({ created_at: '2026-10-01T02:00:00Z' })
    let current = caseOf({ history: [old] })
    await mountDetail(() => current)
    current = caseOf({ history: [old, event({ source: 'parent', actor_user_id: null, actor_email: null, actor_display_name: null, event_type: 'details_updated', created_at: '2026-10-03T03:00:20Z' })] })
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation((() => undefined) as never)
    vi.setSystemTime(new Date('2026-10-03T03:00:40Z'))
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    const message = String((warning.mock.calls[0]![0] as { message: string }).message)
    expect(message).not.toContain('王老師')
    expect(message).toBe('這筆案件剛有更新，畫面已重新整理。')
  })

  it('靜默重讀失敗：草稿與表單還在，不出現整頁錯誤', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T03:00:00Z'))
    let fail = false
    const wrapper = await mountDetail(() => { if (fail) throw new ApiError(500, { code: 'X', message: 'boom' }); return caseOf() })
    await wrapper.get('textarea').setValue('家長說下週再約')
    fail = true
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation((() => undefined) as never)
    vi.setSystemTime(new Date('2026-10-03T03:00:40Z'))
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(wrapper.find('.el-alert--error').exists()).toBe(false)
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('家長說下週再約')
    expect(String((warning.mock.calls[0]![0] as { message: string }).message)).toBe('無法更新案件，畫面可能不是最新。')
  })
})

describe('我承辦的未結案', () => {
  const stub = defineComponent({ template: '<div />' })

  it('列表 ?assignee=inactive&open=1：送 assignee=inactive 與 open=true，勾著「只看未結案」', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([] as never)
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/visit-requests', component: VisitRequestsView }, { path: '/visit-requests/:id', component: stub }, { path: '/dashboard', component: stub }] })
    await router.push('/visit-requests?assignee=inactive&open=1'); await router.isReady()
    const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    const list = get.mock.calls.map(([p]) => String(p)).find((p) => p.startsWith('/admin/visit-requests?') && p.includes('page='))!
    expect(list).toContain('assignee=inactive')
    expect(list).toContain('open=true')
    expect(router.currentRoute.value.query).toMatchObject({ assignee: 'inactive', open: '1' })
    expect(wrapper.text()).toContain('沒有承辦人已停用、還沒結案的案件')
  })

  async function mountDashboard(summary: Record<string, unknown>, rows: unknown[] = [], role: 'super_admin' | 'reception' = 'super_admin') {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path) => {
      const url = String(path)
      if (url === '/admin/dashboard') return { today_visits: 0, today_visit_list: [], pending_follow_up: 0, pending_publish: 0, campuses_without_active_booking: [], failed_notifications: 0, ...summary } as never
      if (url.startsWith('/admin/visit-requests?')) return rows as never
      return [] as never
    })
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser(role)
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: DashboardView }, { path: '/visit-requests', component: stub }, { path: '/visit-requests/:id', component: stub }] })
    await router.push('/'); await router.isReady()
    const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
    wrappers.push(wrapper); await flushPromises()
    return { wrapper, get }
  }

  it('總覽：有我承辦的案件時列最多 5 筆＋查看全部；不算待辦', async () => {
    const { wrapper, get } = await mountDashboard({ my_open_cases: 7 }, [caseOf({ id: 'c1', parent_name: '周美玲' })])
    const section = wrapper.get('.dash__mine')
    expect(section.get('h2').text()).toBe('我承辦的案件')
    expect(section.text()).toContain('周美玲')
    expect(section.get('a.dash__mine-all').attributes('href')).toBe('/visit-requests?assignee=me&open=1&order=oldest')
    expect(section.get('a.dash__mine-all').text()).toContain('查看全部 7 件')
    expect(get.mock.calls.map(([p]) => String(p))).toContain('/admin/visit-requests?assignee=me&open=true&order=oldest&page_size=5')
    expect(wrapper.text()).toContain('目前沒有待處理事項')
  })

  it('總覽：承辦人已停用還沒結案的算待辦，連到篩好的列表', async () => {
    const { wrapper } = await mountDashboard({ inactive_assignee_open_cases: 2 })
    const task = wrapper.get('a.task[href="/visit-requests?assignee=inactive&open=1"]')
    expect(task.text()).toContain('承辦人已停用，案件還沒結案')
    expect(task.get('.task__number').text()).toBe('2')
  })

  it('停用帳號：對方還有未結案件時提示件數；查件數失敗時照樣只說已停用', async () => {
    const colleague = testUser('campus_admin', { id: 'u-wang', email: 'wang@ivy.example', display_name: '王老師', campus_keys: ['yihua'] })
    let countsFail = false
    vi.spyOn(api, 'get').mockImplementation(async (path) => {
      const url = String(path)
      if (url === '/admin/users') return [colleague] as never
      if (url.startsWith('/admin/visit-requests/group-counts')) {
        if (countsFail) throw new ApiError(500, {})
        return { pending: 0, upcoming: 2, past: 1, cancelled: 0 } as never
      }
      return [] as never
    })
    vi.spyOn(api, 'patch').mockResolvedValue({ ...colleague, is_active: false } as never)
    vi.spyOn(ElMessage, 'success').mockImplementation((() => undefined) as never)
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation((() => undefined) as never)
    const error = vi.spyOn(ElMessage, 'error').mockImplementation((() => undefined) as never)
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin', { id: 'me' })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/users', component: UsersView }] })
    await router.push('/users'); await router.isReady()
    const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper); await flushPromises()

    wrapper.findComponent(UserActions).vm.$emit('toggle', colleague)
    await flushPromises()
    expect(String((warning.mock.calls[0]![0] as { message: string }).message)).toBe('王老師還有 3 件沒結案的參觀案件：到「參觀案件」的承辦人篩選選「承辦人已停用」，重新指派給其他同事。')

    warning.mockClear()
    countsFail = true
    wrapper.findComponent(UserActions).vm.$emit('toggle', { ...colleague, is_active: true })
    await flushPromises()
    expect(warning).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})
