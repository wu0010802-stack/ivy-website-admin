import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import { AUDIT_ACTION_LABELS, formatSlotWhen } from '../api/labels'
import { visitEventChanges, visitEventTitle } from '../api/visitHistory'
import type { VisitHistoryOut } from '../api/types'
import { arrivalAdmissionsNote, earlyArrivalNote } from '../composables/visitAttendance'
import { button, cleanup, mockGet, mockPost } from './admissionsTestKit'
import { caseRoutes, futureSlot, mountRoutes, visitCase, VISIT_ID } from './visitCaseKit'
import { testUser } from './fixtures'

// 提早完成參觀（2026-10-12）：家長比預約的場次早到，頁首在場次開始前多一顆「家長提早到了」。
afterEach(() => { cleanup(); window.sessionStorage.clear() })

async function mountDetail(data: Record<string, unknown>, user = undefined) {
  mockGet(caseRoutes(data))
  return (await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView }, { user })).wrapper
}

describe('earlyArrivalNote', () => {
  const today = { slot_date: '2026-10-12', start_time: '14:00:00', end_time: '15:00:00' }
  const later = { slot_date: '2026-10-20', start_time: '10:00:00', end_time: '11:00:00' }

  it('約今天：只是早到，場次照舊', () => {
    expect(earlyArrivalNote(today, '2026-10-12', false, false)).toBe('原本約今天 14:00，提早到了就先標記已到場。')
  })

  it('約之後的日子：寫出原本的場次、名額釋出、參觀日期記今天', () => {
    expect(earlyArrivalNote(later, '2026-10-12', false, false)).toBe(
      `原本約 ${formatSlotWhen(later)}。標記已到場後，那一場的名額會釋出給其他家長，參觀日期記為今天。`,
    )
  })

  it('招生入學開著：接著寫會建立招生訪視', () => {
    expect(earlyArrivalNote(later, '2026-10-12', true, true)).toMatch(new RegExp(`${arrivalAdmissionsNote(true)}$`))
  })
})

describe('頁首「家長提早到了」', () => {
  it('場次還沒開始：只有「家長提早到了」，不是實心主鈕；「沒來」要等場次開始', async () => {
    const wrapper = await mountDetail(visitCase())
    const actions = wrapper.get('.case-hero__actions')
    expect(actions.attributes('data-stage')).toBe('upcoming')
    const buttons = actions.findAll('button')
    expect(buttons.map((b) => b.text())).toEqual(['家長提早到了'])
    expect(buttons[0]!.classes()).not.toContain('el-button--primary')
    expect(actions.text()).toContain('場次開始後才能標記未到場')
  })

  it('確認框寫出原本的場次與名額釋出，確認後呼叫 /complete-early', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const post = mockPost()
    const wrapper = await mountDetail(visitCase())
    await button(wrapper.get('.case-hero__actions'), '家長提早到了')!.trigger('click')
    await flushPromises()
    const [message, title] = confirm.mock.calls[0]!
    expect(title).toBe('家長提早到了？')
    expect(message).toContain(formatSlotWhen(futureSlot))
    expect(message).toContain('名額會釋出')
    expect(post).toHaveBeenCalledWith(`/admin/visit-requests/${VISIT_ID}/complete-early`)
  })

  it('確認框按「先不要」：不送出', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    const post = mockPost()
    const wrapper = await mountDetail(visitCase())
    await button(wrapper.get('.case-hero__actions'), '家長提早到了')!.trigger('click')
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
  })

  it('只能查看的帳號：沒有按鈕', async () => {
    const viewer = testUser('readonly', { campus_keys: ['yihua'], effective_capabilities: ['booking.read'] })
    const wrapper = await mountDetail(visitCase(), viewer as never)
    expect(wrapper.get('.case-hero__actions').findAll('button')).toHaveLength(0)
  })
})

describe('歷程與操作紀錄', () => {
  const event = (after: Record<string, unknown>) => ({
    id: 'e1', event_type: 'completed', created_at: '2026-10-12T02:00:00Z', source: 'staff', actor_user_id: null,
    before: { status: 'confirmed', slot: futureSlot }, after, reason: null,
  }) as unknown as VisitHistoryOut

  it('提早到的 completed 事件叫「提早標記已到場」；釋出名額時寫「釋出 原場次」', () => {
    const released = event({ status: 'completed', slot: null, early: true })
    expect(visitEventTitle(released)).toBe('提早標記已到場')
    expect(visitEventChanges(released)).toContain(`釋出 ${formatSlotWhen(futureSlot)}`)
    expect(visitEventTitle(event({ status: 'completed' }))).toBe('標記已到場')
  })

  it('操作紀錄有中文名稱', () => {
    expect(AUDIT_ACTION_LABELS['visit_request.complete_early']).toBe('提早標記已到場')
  })
})
