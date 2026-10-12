// 案件列表的批次標記已到場（2026-10-04 參觀後追蹤規格 7.5；2026-10-05 拿掉招生入學「官網預約」分頁，
// 搬到案件列表的「只看尚未確認到場」）。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import { api, ApiError } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { markArrivedInOrder, markInOrder } from '../composables/visitAttendance'
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
  history: [], access_link: null, version: 1, ...extra,
})
const rows = [row(), row({ id: 'r2', parent_name: '林爸爸' })]

async function mountList(path: string, list: unknown[], options: { user?: UserOut; admissions?: boolean } = {}) {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url: string) =>
    (url.startsWith('/admin/visit-requests/view-counts') ? {} : url.startsWith('/admin/visit-requests') ? list : []) as never)
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

const button = (wrapper: VueWrapper, text: string) => wrapper.findAll('button').find(b => b.text() === text)
// 批次列的「全選這一頁」：勾起這一頁每一個還沒標記到場的列。
async function selectAll(wrapper: VueWrapper) {
  await wrapper.get('.requests-batch .el-checkbox input').setValue(true)
  await flushPromises()
}

describe('案件列表：批次標記已到場', () => {
  it('只有「只看尚未確認到場」才有勾選欄與批次按鈕', async () => {
    const plain = (await mountList('/visit-requests?group=past', rows)).wrapper
    expect(plain.find('.requests-batch').exists()).toBe(false)
    expect(plain.find('.visit-row__check').exists()).toBe(false)

    const { wrapper } = await mountList(ATTENDANCE, rows)
    expect(wrapper.find('.requests-batch .el-checkbox').exists()).toBe(true)
    expect(wrapper.findAll('.visit-row .visit-row__check .el-checkbox')).toHaveLength(2)
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

  it('一列一列自己勾選，按鈕跟著寫勾了幾位；全選框變成半選', async () => {
    const { wrapper } = await mountList(ATTENDANCE, rows)
    await wrapper.get('.visit-row__check .el-checkbox[aria-label="勾選 林爸爸"] input').setValue(true)
    expect(button(wrapper, '1 位標記已到場')).toBeDefined()
    expect(wrapper.get('.requests-batch .el-checkbox__input').classes()).toContain('is-indeterminate')
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    await button(wrapper, '1 位標記已到場')!.trigger('click')
    await flushPromises()
    expect(post.mock.calls.map(call => call[0])).toEqual(['/admin/visit-requests/r2/complete'])
  })

  it('點到勾選欄的格子不會打開案件；點家長名字才打開', async () => {
    const { wrapper, router } = await mountList(ATTENDANCE, rows)
    await wrapper.get('.visit-row__check').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/visit-requests')
    await wrapper.get('a.visit-row__main').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/visit-requests/r1')
  })

  it('全選之後再按一次全選框，全部取消', async () => {
    const { wrapper } = await mountList(ATTENDANCE, rows)
    await selectAll(wrapper)
    expect(button(wrapper, '2 位標記已到場')).toBeDefined()
    await wrapper.get('.requests-batch .el-checkbox input').setValue(false)
    expect(button(wrapper, '勾選後一次標記已到場')).toBeDefined()
  })

  it('唯讀帳號沒有勾選與批次按鈕', async () => {
    const { wrapper } = await mountList(ATTENDANCE, rows, { user: testUser('readonly', { campus_keys: ['yihua'] }) })
    expect(wrapper.find('.requests-batch').exists()).toBe(false)
    expect(wrapper.find('.visit-row__check').exists()).toBe(false)
  })
})

// 批次標記沒來（2026-10-12）：同一份勾選、同一條 /no-show，後端不改。
const batchButton = (wrapper: VueWrapper, text: string) => wrapper.get('.requests-batch').findAll('button').find(b => b.text() === text)
const NO_SHOW_CONFIRM = '把 2 筆標成沒來？會結案、停用家長的修改連結，名額不會釋出。'

describe('案件列表：批次標記沒來', () => {
  it('批次列有「標記沒來」，沒勾選時停用；非「只看尚未確認到場」或唯讀帳號沒有', async () => {
    const { wrapper } = await mountList(ATTENDANCE, rows)
    expect(batchButton(wrapper, '標記沒來')?.attributes('disabled')).toBeDefined()
    await selectAll(wrapper)
    expect(batchButton(wrapper, '標記沒來')?.attributes('disabled')).toBeUndefined()

    const plain = (await mountList('/visit-requests?group=past', rows)).wrapper
    expect(plain.find('.requests-batch').exists()).toBe(false)
    expect(plain.findAll('button').some(b => b.text() === '標記沒來')).toBe(false)

    const readonly = (await mountList(ATTENDANCE, rows, { user: testUser('readonly', { campus_keys: ['yihua'] }) })).wrapper
    expect(readonly.findAll('button').some(b => b.text() === '標記沒來')).toBe(false)
  })

  it('勾兩筆：確認框寫出筆數與後果、確認鈕危險色；確認後依序打 /no-show，成功訊息，列表重讀', async () => {
    const { wrapper, get } = await mountList(ATTENDANCE, rows, { admissions: true })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    const success = vi.spyOn(ElMessage, 'success')
    await selectAll(wrapper)
    const callsBefore = get.mock.calls.length
    await batchButton(wrapper, '標記沒來')!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith(NO_SHOW_CONFIRM, expect.any(String), expect.objectContaining({
      confirmButtonText: '標記沒來', cancelButtonText: '先不要', confirmButtonClass: 'el-button--danger', autofocus: false,
    }))
    expect(post.mock.calls.map(call => call[0])).toEqual(['/admin/visit-requests/r1/no-show', '/admin/visit-requests/r2/no-show'])
    expect(success).toHaveBeenCalledWith('已標記 2 位沒來')
    expect(wrapper.find('.requests-batch__failures').exists()).toBe(false)
    expect(get.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('一筆回 409：逐筆列出「狀態剛被其他人更新」，另一筆照常送出', async () => {
    const { wrapper } = await mountList(ATTENDANCE, rows)
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const post = vi.spyOn(api, 'post').mockImplementation(async (url: string) => {
      if (url.includes('/r1/')) throw new ApiError(409, { code: 'INVALID_TRANSITION' })
      return {} as never
    })
    const success = vi.spyOn(ElMessage, 'success')
    await selectAll(wrapper)
    await batchButton(wrapper, '標記沒來')!.trigger('click')
    await flushPromises()
    expect(post.mock.calls.map(call => call[0])).toEqual(['/admin/visit-requests/r1/no-show', '/admin/visit-requests/r2/no-show'])
    expect(wrapper.get('.requests-batch__failures').text()).toContain('黃志明：狀態剛被其他人更新')
    expect(success).toHaveBeenCalledWith('已標記 1 位沒來')
  })

  it('確認框按「先不要」：不送出', async () => {
    const { wrapper } = await mountList(ATTENDANCE, rows)
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    await selectAll(wrapper)
    await batchButton(wrapper, '標記沒來')!.trigger('click')
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
  })
})

describe('markInOrder：依序呼叫、各自收失敗', () => {
  const targets = [{ id: 'a', parent_name: 'A' }, { id: 'b', parent_name: 'B' }, { id: 'c', parent_name: 'C' }]

  it('no-show：依序打 /no-show；b 回 409 記下「狀態剛被其他人更新」，c 仍會送', async () => {
    const post = vi.spyOn(api, 'post').mockImplementation(async (url: string) => {
      if (url.includes('/b/')) throw new ApiError(409, { code: 'INVALID_TRANSITION' })
      return {} as never
    })
    const progress: number[] = []
    const result = await markInOrder(targets, 'no-show', done => progress.push(done))
    expect(post.mock.calls.map(call => call[0])).toEqual([
      '/admin/visit-requests/a/no-show', '/admin/visit-requests/b/no-show', '/admin/visit-requests/c/no-show',
    ])
    expect(result.succeeded).toBe(2)
    expect(result.failures).toEqual([{ id: 'b', name: 'B', reason: expect.stringContaining('狀態剛被其他人更新') }])
    expect(progress).toEqual([1, 2, 3])
  })

  it('arrived：打 /complete；markArrivedInOrder 是它的包裝', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    expect((await markInOrder(targets.slice(0, 1), 'arrived', () => {})).succeeded).toBe(1)
    expect((await markArrivedInOrder(targets.slice(1, 2), () => {})).succeeded).toBe(1)
    expect(post.mock.calls.map(call => call[0])).toEqual(['/admin/visit-requests/a/complete', '/admin/visit-requests/b/complete'])
  })
})
