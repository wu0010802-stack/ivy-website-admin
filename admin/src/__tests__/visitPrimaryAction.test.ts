import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import { caseStage, type StageInput } from '../composables/visitCaseStage'
import { button, cleanup, mockGet, mockPost, visit as admissionsVisit } from './admissionsTestKit'
import { caseRoutes, mountRoutes, pastSlot, visitCase, VISIT_ID } from './visitCaseKit'
import { testUser } from './fixtures'

afterEach(() => { cleanup(); window.sessionStorage.clear() })

const base: StageInput = {
  status: 'confirmed', canHandle: true, visitStarted: false, hasRescheduleRequest: false, familyPending: false,
  isFamily: false, canReadAdmissions: true, canCreateAdmissions: true, admissionsAvailable: 'yes', lookupFailed: false,
}

describe('caseStage：頁首主動作依階段', () => {
  it.each<[Partial<StageInput>, string]>([
    [{ familyPending: true, status: 'completed' }, 'loading'],
    [{ canHandle: false }, 'readonly'],
    [{ visitStarted: true }, 'attendance'],
    [{ visitStarted: true, hasRescheduleRequest: true }, 'attendance'],
    [{ hasRescheduleRequest: true }, 'reschedule'],
    [{}, 'upcoming'],
    [{ status: 'completed', isFamily: true }, 'family'],
    [{ status: 'completed', lookupFailed: true }, 'admissions-retry'],
    [{ status: 'completed' }, 'admissions-create'],
    [{ status: 'completed', canCreateAdmissions: false }, 'admissions-ask'],
    [{ status: 'completed', admissionsAvailable: 'no' }, 'closed'],
    [{ status: 'cancelled' }, 'closed'],
    [{ status: 'no_show', canHandle: false }, 'readonly'],
  ])('%o → %s', (changes, stage) => {
    expect(caseStage({ ...base, ...changes })).toBe(stage)
  })
})

const request = (available = true) => ({
  id: 'req-1', parent_name: '林小姐', created_at: '2026-10-02T03:00:00Z',
  current_slot: { slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00' },
  requested_slot: { slot_date: '2099-10-08', start_time: '10:00:00', end_time: '11:00:00' },
  requested_slot_available: available, requested_slot_remaining: available ? 2 : 0,
})

async function mountDetail(data: Record<string, unknown>, routes: Record<string, unknown> = {}, user = undefined) {
  mockGet({ ...caseRoutes(data), ...routes })
  return (await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView }, { user })).wrapper
}
const started = () => visitCase({ slot: pastSlot, slot_id: pastSlot.id, display_status: 'past' })

describe('VisitPrimaryAction', () => {
  it('場次開始後：「家長到了」實心、「沒來」次之；提示會接著開招生資料表單', async () => {
    const wrapper = await mountDetail(started())
    const actions = wrapper.get('.case-hero__actions')
    expect(actions.attributes('data-stage')).toBe('attendance')
    const buttons = actions.get('.detail__attendance').findAll('button')
    expect(buttons.map((b) => b.text())).toEqual(['家長到了', '沒來'])
    expect(buttons[0]!.classes()).toContain('el-button--primary')
    expect(buttons[0]!.classes()).not.toContain('is-plain')
    expect(actions.text()).toContain('家長到了嗎？')
    expect(actions.text()).toContain('標記到場會接著開招生資料表單')
  })

  it('按「家長到了」照舊呼叫 /complete', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const post = mockPost()
    const wrapper = await mountDetail(started())
    await button(wrapper.get('.case-hero__actions'), '家長到了')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`/admin/visit-requests/${VISIT_ID}/complete`)
  })

  it('場次開始後又有改期申請：到場仍是主鈕，核准改期是淺色', async () => {
    const wrapper = await mountDetail({ ...started(), pending_reschedule: request() })
    const approve = button(wrapper.get('.reschedule-request'), '核准改期')!
    expect(approve.classes()).toContain('is-plain')
    expect(wrapper.find('.detail__attendance').exists()).toBe(true)
  })

  it('還沒開始、家長申請改期：核准改期是實心主鈕；名額不足時停用', async () => {
    const ok = await mountDetail(visitCase({ pending_reschedule: request() }))
    expect(ok.get('.case-hero__actions').attributes('data-stage')).toBe('reschedule')
    expect(button(ok.get('.reschedule-request'), '核准改期')!.classes()).not.toContain('is-plain')
    cleanup()
    const full = await mountDetail(visitCase({ pending_reschedule: request(false) }))
    expect(button(full.get('.reschedule-request'), '核准改期')!.attributes('disabled')).toBeDefined()
    expect(full.get('.reschedule-request').text()).toContain('無法核准')
  })

  it('還沒開始：沒有主鈕，只寫提示', async () => {
    const wrapper = await mountDetail(visitCase())
    const actions = wrapper.get('.case-hero__actions')
    expect(actions.findAll('button')).toHaveLength(0)
    expect(actions.text()).toContain('參觀場次開始後可以標記已到場或未到場')
  })

  it('已取消：重新預約（另建新案）是主鈕，打開補登對話框', async () => {
    const wrapper = await mountDetail(visitCase({ status: 'cancelled', display_status: 'cancelled', cancelled_at: '2026-10-02T02:00:00Z' }))
    await button(wrapper.get('.case-hero__actions'), '重新預約（另建新案）')!.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(ManualVisitDialog).props('modelValue')).toBe(true)
  })

  it('只能查看的帳號：只有提示', async () => {
    const viewer = testUser('readonly', { campus_keys: ['yihua'], effective_capabilities: ['booking.read'] })
    const wrapper = await mountDetail(started(), {}, viewer as never)
    const actions = wrapper.get('.case-hero__actions')
    expect(actions.findAll('button')).toHaveLength(0)
    expect(actions.text()).toContain('只能查看案件')
  })

  it('已到場、還沒有招生訪視：建立招生訪視＋次要的重新預約', async () => {
    const wrapper = await mountDetail(visitCase({ status: 'completed', slot: pastSlot, slot_id: pastSlot.id, display_status: 'past' }))
    const actions = wrapper.get('.case-hero__actions')
    expect(actions.get('.detail__admissions').text()).toContain('已到場，但還沒有招生訪視。')
    expect(button(actions, '建立招生訪視')).toBeDefined()
    expect(button(actions, '重新預約（另建新案）')!.classes()).not.toContain('el-button--primary')
  })

  it('家庭版面：「填招生資料」打開招生資料表單（不帶已到場說明），記錄聯絡改淺色', async () => {
    const linked = admissionsVisit({ visit_request_id: VISIT_ID, has_visit_request: true })
    const wrapper = await mountDetail(
      visitCase({ status: 'completed', slot: pastSlot, slot_id: pastSlot.id, display_status: 'past' }),
      { '/admin/admissions/records': [linked], '/admin/admissions/records/v-1': [] },
    )
    await button(wrapper.get('.case-hero__actions'), '填招生資料')!.trigger('click')
    await flushPromises()
    const dialog = wrapper.findAllComponents(RecordDialog).find((c) => c.props('modelValue'))!
    expect(dialog.props('lead')).toBe('')
    // 頁首的「填招生資料」是頁上唯一的實心主鈕；記錄聯絡仍是 primary 色系，但改 plain（淺色）。
    expect(button(wrapper.get('.family-actions'), '記錄聯絡')!.classes()).toContain('is-plain')
  })
})
