import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import { ApiError } from '../api/client'
import { cleanup, deferred, mockGet, mockPost, mountWith, pathsTo } from './admissionsTestKit'
import { caseRoutes, pastSlot, visitCase } from './visitCaseKit'
import { useVisitCase, type VisitCase, type VisitCaseHooks } from '../composables/useVisitCase'

afterEach(() => { cleanup(); window.sessionStorage.clear() })

async function mountCase(initial: string, hooks: VisitCaseHooks = {}) {
  const id = ref(initial)
  let vc!: VisitCase
  const Host = defineComponent({ setup() { vc = useVisitCase(id, hooks); return () => h('p', vc.detail?.parent_name ?? '') } })
  const { wrapper } = await mountWith(Host)
  return { wrapper, id, vc: () => vc }
}

describe('useVisitCase（2026-10-06 從案件明細抽出）', () => {
  it('案件與聯絡紀錄一起讀；讀到後通知 onLoaded', async () => {
    const get = mockGet(caseRoutes(visitCase()))
    const onLoaded = vi.fn()
    const { vc } = await mountCase('case-a', { onLoaded })
    expect(pathsTo(get, '/admin/visit-requests/case-a')).toEqual(
      expect.arrayContaining(['/admin/visit-requests/case-a', '/admin/visit-requests/case-a/contact-notes']),
    )
    expect(onLoaded).toHaveBeenCalledWith(expect.objectContaining({ id: 'case-a' }))
    expect(vc().loading).toBe(false)
    expect(vc().statusDisplay?.label).toBe('預約正常')
  })

  it('換案件時，上一筆較晚回來的回應不會蓋掉畫面', async () => {
    const slow = deferred<unknown>()
    mockGet({
      '/admin/visit-requests/case-a': () => slow.promise,
      '/admin/visit-requests/case-a/contact-notes': [],
      ...caseRoutes(visitCase({ id: 'case-b', parent_name: '王先生' })),
    })
    const { id, vc } = await mountCase('case-a')
    id.value = 'case-b'
    await flushPromises()
    slow.resolve(visitCase())
    await flushPromises()
    expect(vc().detail?.id).toBe('case-b')
  })

  it('標記未到場成功：重讀並通知 onChanged 一次', async () => {
    mockGet(caseRoutes(visitCase({ slot: pastSlot, slot_id: pastSlot.id, display_status: 'past' })))
    const post = mockPost()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const onChanged = vi.fn()
    const { vc } = await mountCase('case-a', { onChanged })
    await vc().markNoShow()
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/case-a/no-show')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  // ── onChanged：案件真的變了，預覽面板要讓列表重讀（Task 9 帶入的缺口）──
  describe('onChanged 在案件變動的每條路徑都會通知', () => {
    const otherSlot = { id: 's-other', slot_date: '2099-10-03', start_time: '14:00:00', end_time: '15:00:00' }
    const openSlot = { id: 's2', campus_key: 'yihua', slot_date: '2099-10-02', start_time: '10:00:00', end_time: '11:00:00', capacity: 3, booked_count: 0, closed: false }
    const transitionConflict = () => new ApiError(409, { code: 'INVALID_TRANSITION', message: '這筆案件已不是預約正常' })
    const stubDecisions = () => {
      vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    }

    it('新增紀錄送出後使用者已換到別筆：紀錄已寫進原案件，仍通知', async () => {
      const post = deferred<unknown>()
      mockGet({ ...caseRoutes(visitCase()), ...caseRoutes(visitCase({ id: 'case-b', parent_name: '王先生' })) })
      mockPost({ '/admin/visit-requests/case-a/contact-notes': () => post.promise })
      const onChanged = vi.fn()
      const { id, vc } = await mountCase('case-a', { onChanged })
      vc().newNote = '家長說週末再聯絡'
      const sending = vc().addNote()
      id.value = 'case-b'
      await flushPromises()
      expect(onChanged).not.toHaveBeenCalled()
      post.resolve({})
      await sending
      await flushPromises()
      expect(onChanged).toHaveBeenCalledTimes(1)
    })

    it('狀態轉換被擋、重讀後發現同事已處理：通知；狀態沒變（照後端原因講）就不通知', async () => {
      stubDecisions()
      const waiting = () => visitCase({ slot: pastSlot, slot_id: pastSlot.id, display_status: 'past' })
      let current: Record<string, unknown> = waiting()
      mockGet({ '/admin/visit-requests/case-a': () => current, '/admin/visit-requests/case-a/contact-notes': [] })
      let elsewhere = true
      mockPost({
        '/admin/visit-requests/case-a/no-show': () => {
          if (elsewhere) current = { ...current, status: 'completed', version: 2 }
          throw transitionConflict()
        },
      })
      const onChanged = vi.fn()
      const { vc } = await mountCase('case-a', { onChanged })
      await vc().markNoShow()
      await flushPromises()
      expect(vc().detail?.status).toBe('completed')
      expect(onChanged).toHaveBeenCalledTimes(1)

      onChanged.mockClear()
      elsewhere = false
      current = waiting()
      await vc().load({ quiet: true })
      await vc().markNoShow()
      await flushPromises()
      expect(vc().detail?.status).toBe('confirmed')
      expect(onChanged).not.toHaveBeenCalled()
    })

    it('下次聯絡時間剛被別人改過（版本衝突）：重讀後通知', async () => {
      let current: Record<string, unknown> = visitCase()
      mockGet({ '/admin/visit-requests/case-a': () => current, '/admin/visit-requests/case-a/contact-notes': [] })
      mockPost({
        '/admin/visit-requests/case-a/contact-notes': () => {
          current = { ...current, follow_up_at: '2099-10-05T02:00:00Z', version: 2 }
          throw new ApiError(409, { code: 'VISIT_REQUEST_VERSION_CONFLICT', message: '剛被修改' })
        },
      })
      const seen: unknown[] = []
      const { vc } = await mountCase('case-a', { onChanged: () => seen.push(vc().detail?.follow_up_at) })
      vc().newNote = '家長說下週再打'
      vc().followUpAt = '2099-10-04T10:00:00+08:00'
      await vc().addNote()
      await flushPromises()
      // 通知時已經讀到同事改好的時間，列表重讀拿到的才是新值。
      expect(seen).toEqual(['2099-10-05T02:00:00Z'])
    })

    it('改期失敗後重讀，發現場次已被別人改走：通知；沒變就不通知', async () => {
      stubDecisions()
      let current: Record<string, unknown> = visitCase()
      mockGet({ ...{ '/admin/visit-requests/case-a': () => current, '/admin/visit-requests/case-a/contact-notes': [] }, '/admin/slots': [openSlot] })
      let elsewhere = true
      mockPost({
        '/admin/visit-requests/case-a/reschedule': () => {
          if (elsewhere) current = { ...current, slot: otherSlot, slot_id: otherSlot.id, version: 2 }
          throw new ApiError(500, { code: 'INTERNAL_ERROR', message: '失敗' })
        },
      })
      const onChanged = vi.fn()
      const { vc } = await mountCase('case-a', { onChanged })
      vc().rescheduleSlotId = openSlot.id
      await vc().reschedule()
      await flushPromises()
      expect(vc().detail?.slot_id).toBe(otherSlot.id)
      expect(onChanged).toHaveBeenCalledTimes(1)

      onChanged.mockClear()
      elsewhere = false
      vc().rescheduleSlotId = openSlot.id
      await vc().reschedule()
      await flushPromises()
      expect(onChanged).not.toHaveBeenCalled()
    })

    it('改期遇到狀態轉換被擋：只重讀一次、只通知一次（reportError 已經在重讀）', async () => {
      stubDecisions()
      let current: Record<string, unknown> = visitCase()
      const get = mockGet({ '/admin/visit-requests/case-a': () => current, '/admin/visit-requests/case-a/contact-notes': [], '/admin/slots': [openSlot] })
      const caseReads = () => get.mock.calls.filter((call) => call[0] === '/admin/visit-requests/case-a').length
      const cancelledElsewhere = () => { current = { ...current, status: 'cancelled', version: 2 }; throw transitionConflict() }
      mockPost({ '/admin/visit-requests/case-a/reschedule': cancelledElsewhere })
      const onChanged = vi.fn()
      const { vc } = await mountCase('case-a', { onChanged })

      vc().rescheduleSlotId = openSlot.id
      const readsBefore = caseReads()
      await vc().reschedule()
      await flushPromises()
      expect(caseReads() - readsBefore).toBe(1)
      expect(onChanged).toHaveBeenCalledTimes(1)
    })
  })
})
