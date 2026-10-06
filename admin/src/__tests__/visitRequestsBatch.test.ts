// 案件列表的批次標記已到場（2026-10-04 參觀後追蹤規格 7.5；2026-10-05 拿掉招生入學「官網預約」分頁，
// 搬到案件列表的「只看尚未確認到場」）。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import { api, ApiError } from '../api/client'
import { useAuthStore } from '../stores/auth'
import type { UserOut } from '../api/types'
import { testUser } from './fixtures'

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
})

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(w => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const ATTENDANCE = '/visit-requests?group=past&status=confirmed'
const started = { id: 'slot-started', slot_date: '2020-01-01', start_time: '10:00:00', end_time: '11:00:00' }
const row = (extra: Record<string, unknown> = {}) => ({
  id: 'r1', campus_key: 'yihua', status: 'confirmed', parent_name: '黃志明', phone: '0912345678', child_name: '小安',
  child_birthdate: '2022-05-01', email: 'p@example.org', referral_sources: [], age: null, preferred_time: null, questions: null,
  party_size: null, consent_given: false, consent_revision_id: null, consent_accepted_at: null,
  slot_id: started.id, slot: started, created_at: '2026-10-05T00:00:00Z', hold_expires_at: null, follow_up_at: null,
  confirmed_at: '2026-10-05T00:00:00Z', cancelled_at: null, source: 'web', display_status: 'past',
  history: [], pending_reschedule: null, access_link: null, version: 1, ...extra,
})
const rows = [row(), row({ id: 'r2', parent_name: '林爸爸' })]

async function mountList(path: string, list: unknown[], options: { user?: UserOut; admissions?: boolean } = {}) {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url: string) =>
    (url.startsWith('/admin/visit-requests/group-counts') ? {} : url.startsWith('/admin/visit-requests') ? list : []) as never)
  const pinia = createPinia()
  const auth = useAuthStore(pinia)
  auth.user = options.user ?? testUser('super_admin', { id: 'me', campus_keys: [] })
  auth.features = { admissions: Boolean(options.admissions), password_reset_email: false }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path); await router.isReady()
  const wrapper = mount(VisitRequestsView, {
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router, get }
}

const table = (wrapper: VueWrapper) => wrapper.findAllComponents({ name: 'ElTable' }).find(t => t.classes().includes('requests-table'))!
const button = (wrapper: VueWrapper, text: string) => wrapper.findAll('button').find(b => b.text() === text)
// 勾選由 Element Plus 的表格處理；這裡直接送出它的 selection-change，測的是勾選之後的流程。
async function selectAll(wrapper: VueWrapper) {
  table(wrapper).vm.$emit('selection-change', rows)
  await flushPromises()
}

describe('案件列表：批次標記已到場', () => {
  it('只有「只看尚未確認到場」才有勾選欄與批次按鈕', async () => {
    const plain = (await mountList('/visit-requests?group=past', rows)).wrapper
    expect(plain.find('.requests-batch').exists()).toBe(false)
    expect(plain.find('.requests-table .el-table__header .el-checkbox').exists()).toBe(false)
    expect(plain.find('.request-list__check').exists()).toBe(false)

    const { wrapper } = await mountList(ATTENDANCE, rows)
    expect(wrapper.find('.requests-batch').exists()).toBe(true)
    expect(wrapper.find('.requests-table .el-table__header .el-checkbox').exists()).toBe(true)
    expect(wrapper.findAll('.request-list__check')).toHaveLength(2)
    expect(button(wrapper, '勾選後一次標記已到場')?.attributes('disabled')).toBeDefined()
  })

  it('勾選後一次確認、逐筆呼叫既有的 /complete；部分失敗逐筆列出原因，之後重讀列表', async () => {
    const { wrapper, get } = await mountList(ATTENDANCE, rows, { admissions: true })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const post = vi.spyOn(api, 'post').mockImplementation(async (url: string) => {
      if (url.includes('/r2/')) throw new ApiError(409, { code: 'INVALID_TRANSITION' })
      return {} as never
    })
    await selectAll(wrapper)
    const callsBefore = get.mock.calls.length
    await button(wrapper, '2 位標記已到場')!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('會同時建立 2 筆招生訪視'), '2 位標記已到場？', expect.anything())
    expect(post.mock.calls.map(call => call[0])).toEqual(['/admin/visit-requests/r1/complete', '/admin/visit-requests/r2/complete'])
    expect(wrapper.get('.requests-batch__failures').text()).toContain('林爸爸：狀態剛被其他人更新')
    expect(get.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('招生入學關著時確認框不提招生訪視；按「先不要」不送出', async () => {
    const { wrapper } = await mountList(ATTENDANCE, rows)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    await selectAll(wrapper)
    await button(wrapper, '2 位標記已到場')!.trigger('click')
    await flushPromises()
    expect(String(confirm.mock.calls[0]![0])).not.toContain('招生訪視')
    expect(post).not.toHaveBeenCalled()
  })

  it('手機卡片自己勾選，按鈕跟著寫勾了幾位', async () => {
    const { wrapper } = await mountList(ATTENDANCE, rows)
    await wrapper.get('.request-list__check input[aria-label="勾選 林爸爸"]').setValue(true)
    expect(button(wrapper, '1 位標記已到場')).toBeDefined()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    await button(wrapper, '1 位標記已到場')!.trigger('click')
    await flushPromises()
    expect(post.mock.calls.map(call => call[0])).toEqual(['/admin/visit-requests/r2/complete'])
  })

  it('點到勾選欄的格子不會打開案件', async () => {
    const { wrapper, router } = await mountList(ATTENDANCE, rows)
    table(wrapper).vm.$emit('row-click', rows[0], { type: 'selection' })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/visit-requests')
    table(wrapper).vm.$emit('row-click', rows[0], { type: 'default' })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/visit-requests/r1')
  })

  it('唯讀帳號沒有勾選與批次按鈕', async () => {
    const { wrapper } = await mountList(ATTENDANCE, rows, { user: testUser('readonly', { campus_keys: ['yihua'] }) })
    expect(wrapper.find('.requests-batch').exists()).toBe(false)
    expect(wrapper.find('.requests-table .el-table__header .el-checkbox').exists()).toBe(false)
    expect(wrapper.find('.request-list__check').exists()).toBe(false)
  })
})
