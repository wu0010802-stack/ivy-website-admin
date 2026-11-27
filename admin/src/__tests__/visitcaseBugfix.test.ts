import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import { useVisitCase, type VisitCase } from '../composables/useVisitCase'
import { button, cleanup, deferred, mockGet, mockPost, mountWith, pathsTo, reception } from './admissionsTestKit'
import { caseRoutes, mountRoutes, pastSlot, visitCase } from './visitCaseKit'

// 2026-11-26 稽核：參觀案件的動作（標記已到場／提早到、取消、未到場、改期）在 await（招生查詢、確認框）
// 之後才讀當下的 id，期間換了案件（下一筆、預覽換列、瀏覽器返回）就把動作寫到另一筆。
afterEach(() => { cleanup(); window.sessionStorage.clear() })

const caseB = (extra: Record<string, unknown> = {}) => visitCase({ id: 'case-b', parent_name: '王先生', phone: '0912000002', ...extra })
const started = (extra: Record<string, unknown> = {}) => ({ slot: pastSlot, slot_id: pastSlot.id, display_status: 'past', ...extra })
const openSlot = { id: 's2', campus_key: 'yihua', slot_date: '2099-10-02', start_time: '10:00:00', end_time: '11:00:00', capacity: 3, booked_count: 0, closed: false }

/** case-a 的招生查詢卡住（slow），其他案件的查回空的（招生可用、沒有招生訪視）。 */
function mockCases(slow: Promise<unknown[]> | null, a: Record<string, unknown> = {}, b: Record<string, unknown> = {}) {
  return mockGet({
    ...caseRoutes(visitCase(a)),
    ...caseRoutes(caseB(b)),
    '/admin/slots': [openSlot],
    '/admin/admissions/records': (path: string) => (slow && path.includes('case-a') ? slow : []),
  })
}

async function mountCase(initial: string) {
  const id = ref(initial)
  let vc!: VisitCase
  const Host = defineComponent({ setup() { vc = useVisitCase(id); return () => h('p', vc.detail?.parent_name ?? '') } })
  await mountWith(Host)
  return { id, vc: () => vc }
}

describe('案件明細：招生查詢還沒回來就按「家長到了」再換一筆（稽核重現步驟）', () => {
  it('等查詢的這段算處理中：按鈕轉圈、下一筆不放行；查完照常確認，標記只寫進原案件', async () => {
    const slow = deferred<unknown[]>()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    mockCases(slow.promise, started(), started())
    const post = mockPost()
    const { wrapper, router } = await mountRoutes('/visit-requests/case-a', { detail: VisitDetailView }, { user: reception(), admissions: true })

    await button(wrapper, '家長到了')!.trigger('click')
    await flushPromises()
    // 處理中的樣子用 soft：舊程式在這裡就不對，仍跑到最後，看得到標記寫到哪一筆。
    expect.soft(button(wrapper, '家長到了')!.classes()).toContain('is-loading')
    expect.soft(button(wrapper, '沒來')!.attributes('disabled')).toBeDefined()

    await router.push('/visit-requests/case-b')
    await flushPromises()
    expect.soft(router.currentRoute.value.fullPath).toBe('/visit-requests/case-a')

    slow.resolve([])
    await flushPromises()
    expect(pathsTo(post, '/admin/visit-requests/case-b')).toEqual([])
    // 確認框寫的是原案件（招生可用、能改招生資料：標記後打開招生資料表單）。
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0]![1]).toBe('標記已到場？')
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/case-a/complete')
  })
})

describe('useVisitCase：await 之後不讀當下的案件', () => {
  it('家長提早到了：等招生查詢時案件被換掉（沒經過離頁守衛），醒來不送出、也不跳確認框', async () => {
    const slow = deferred<unknown[]>()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const warning = vi.spyOn(ElMessage, 'warning')
    mockCases(slow.promise)
    const post = mockPost()
    const { id, vc } = await mountCase('case-a')

    const marking = vc().markCompletedEarly()
    await flushPromises()
    expect(vc().pendingAction).toBe('complete')
    expect(vc().busy).toBe(true)

    id.value = 'case-b'
    await flushPromises()
    slow.resolve([])
    await marking
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    expect(vc().busy).toBe(false)
    expect(String((warning.mock.calls[0]![0] as { message: string }).message)).toContain('沒有送出')
  })

  it('等招生查詢時連按兩次：只問一次、只送一次', async () => {
    const slow = deferred<unknown[]>()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    mockCases(slow.promise, started())
    const post = mockPost()
    const { vc } = await mountCase('case-a')

    const first = vc().markCompleted()
    const second = vc().markCompleted()
    slow.resolve([])
    await Promise.all([first, second])
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(pathsTo(post, '/admin/visit-requests/')).toEqual(['/admin/visit-requests/case-a/complete'])
  })

  it('查完後在確認框按「先不要」：不送出，處理中狀態也清掉', async () => {
    const slow = deferred<unknown[]>()
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    mockCases(slow.promise, started())
    const post = mockPost()
    const { vc } = await mountCase('case-a')

    const marking = vc().markCompleted()
    await flushPromises()
    expect(vc().busy).toBe(true)
    slow.resolve([])
    await marking
    expect(post).not.toHaveBeenCalled()
    expect(vc().pendingAction).toBeNull()
  })

  it('家長到了：確認框開著時換到別筆（例如瀏覽器返回），再按確認：不送出', async () => {
    const decision = deferred<unknown>()
    vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(decision.promise as never)
    mockCases(null, started(), started())
    const post = mockPost()
    const { id, vc } = await mountCase('case-a')

    const marking = vc().markCompleted()
    await flushPromises()
    id.value = 'case-b'
    await flushPromises()
    decision.resolve('confirm')
    await marking
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
  })

  it('取消預約：確認框開著時換到別筆，再按確認：不取消新案件', async () => {
    const decision = deferred<unknown>()
    vi.spyOn(ElMessageBox, 'prompt').mockReturnValue(decision.promise as never)
    const warning = vi.spyOn(ElMessage, 'warning')
    mockCases(null)
    const post = mockPost()
    const { id, vc } = await mountCase('case-a')

    const cancelling = vc().cancel()
    id.value = 'case-b'
    await flushPromises()
    decision.resolve({ value: '家長改天再約' })
    await cancelling
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
    expect(String((warning.mock.calls[0]![0] as { message: string }).message)).toContain('沒有送出')
  })

  it('標記未到場：確認框開著時換到別筆，再按確認：不標記新案件', async () => {
    const decision = deferred<unknown>()
    vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(decision.promise as never)
    mockCases(null, started(), started())
    const post = mockPost()
    const { id, vc } = await mountCase('case-a')

    const marking = vc().markNoShow()
    id.value = 'case-b'
    await flushPromises()
    decision.resolve('confirm')
    await marking
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
  })

  it('改期：確認框開著時換到別筆，再按確認：不把原案件選的場次套到新案件', async () => {
    const decision = deferred<unknown>()
    vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(decision.promise as never)
    mockCases(null)
    const post = mockPost()
    const { id, vc } = await mountCase('case-a')
    vc().rescheduleSlotId = openSlot.id

    const rescheduling = vc().reschedule()
    id.value = 'case-b'
    await flushPromises()
    decision.resolve('confirm')
    await rescheduling
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
  })

  it('沒換案件時照常送到原案件（對照）', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '' } as never)
    mockCases(null, started())
    const post = mockPost()
    const { vc } = await mountCase('case-a')
    await vc().markNoShow()
    await vc().cancel()
    await flushPromises()
    expect(pathsTo(post, '/admin/visit-requests/')).toEqual(['/admin/visit-requests/case-a/no-show', '/admin/visit-requests/case-a/cancel'])
  })
})
