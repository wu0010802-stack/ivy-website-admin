import { afterEach, describe, expect, it } from 'vitest'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { auditMetadataDetails, AUDIT_ACTION_LABELS } from '../api/labels'
import { visitEventTitle } from '../api/visitHistory'
import VisitDetailView from '../views/VisitDetailView.vue'
import { ApiError } from '../api/client'
import { bodyOf, campusAdmin, cleanup, mockGet, mockPost, reception, visit as admissionsVisit } from './admissionsTestKit'
import { caseRoutes, mountRoutes, pastSlot, visitCase, VISIT_ID } from './visitCaseKit'

// 2026-10-15 預約案件排除：入口在右欄最下方（計畫裁定 P7）、已排除時頁首下方有橫幅。
afterEach(() => cleanup())
const body = () => new DOMWrapper(document.body)
const CASE_PATH = `/admin/visit-requests/${VISIT_ID}`
const EXCLUDE_PATH = `${CASE_PATH}/exclude`
const INCLUDE_PATH = `${CASE_PATH}/include`
const completed = { status: 'completed', slot: pastSlot, slot_id: pastSlot.id, display_status: 'past' }

const excludedCase = (extra: Record<string, unknown> = {}) =>
  visitCase({
    status: 'cancelled', excluded_at: '2026-10-15T02:00:00Z', exclude_reason: 'test', exclude_note: null,
    history: [{ id: 'e1', event_type: 'excluded', source: 'staff', actor_user_id: 'u1', actor_email: 'chen@example.invalid', actor_display_name: '陳老師', before: null, after: { reason: 'test' }, reason: null, created_at: '2026-10-15T02:00:00Z' }],
    ...extra,
  })

async function mountCase(user?: never) {
  const { wrapper } = await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView }, { user })
  await flushPromises()
  return wrapper
}
// 案件本身被讀了幾次（GET /admin/visit-requests/{id}，不含聯絡紀錄等子路徑）。
const caseReads = (get: { mock: { calls: unknown[][] } }) => get.mock.calls.filter((call) => String(call[0]) === CASE_PATH).length
const markButton = (wrapper: Awaited<ReturnType<typeof mountCase>>) => wrapper.findAll('button').find((b) => b.text().includes('標記為排除'))

async function openDialog() {
  const wrapper = await mountCase()
  await markButton(wrapper)!.trigger('click')
  await flushPromises()
  return body().get('.exclusion-dialog')
}
const dialogSubmit = (dialog: Awaited<ReturnType<typeof openDialog>>) => dialog.findAll('button').find((b) => b.text() === '標記為排除')!

describe('排除的入口與橫幅', () => {
  it('總管理者看得到入口；選「其他」沒寫說明不能送；送出帶原因與說明', async () => {
    mockGet(caseRoutes(visitCase()))
    const post = mockPost({ [EXCLUDE_PATH]: visitCase({ excluded_at: '2026-10-15T02:00:00Z', exclude_reason: 'other', exclude_note: '櫃台測試' }) })
    const dialog = await openDialog()
    expect(dialog.text()).toContain('排除不會釋出名額')  // 預約正常、還沒到（E6）
    await dialog.findAll('input[type="radio"]').find((r) => (r.element as HTMLInputElement).value === 'other')!.setValue(true)
    const submit = dialogSubmit(dialog)
    expect(submit.attributes('disabled')).toBeDefined()
    await dialog.find('textarea').setValue('櫃台測試')
    await submit.trigger('click')
    await flushPromises()
    expect(bodyOf(post, EXCLUDE_PATH)).toEqual({ reason: 'other', note: '櫃台測試' })
  })

  it('預設選「測試」：說明選填，直接送出只帶原因', async () => {
    mockGet(caseRoutes(visitCase()))
    const post = mockPost({ [EXCLUDE_PATH]: excludedCase() })
    const dialog = await openDialog()
    const submit = dialogSubmit(dialog)
    expect(submit.attributes('disabled')).toBeUndefined()
    await submit.trigger('click')
    await flushPromises()
    expect(bodyOf(post, EXCLUDE_PATH)).toEqual({ reason: 'test', note: null })
  })

  it('送出失敗：錯誤寫在對話框裡，對話框不關', async () => {
    mockGet(caseRoutes(visitCase()))
    mockPost({ [EXCLUDE_PATH]: () => { throw new Error('boom') } })
    const dialog = await openDialog()
    await dialogSubmit(dialog).trigger('click')
    await flushPromises()
    expect(body().find('.exclusion-dialog').exists()).toBe(true)
    expect(body().find('.exclusion-dialog .el-alert').exists()).toBe(true)
  })

  it('已到場（不佔名額）的案件也有入口，對話框不提醒名額', async () => {
    mockGet(caseRoutes(visitCase(completed)))
    const dialog = await openDialog()
    expect(dialog.text()).not.toContain('排除不會釋出名額')
  })

  it('已取消的案件也有入口', async () => {
    mockGet(caseRoutes(visitCase({ status: 'cancelled', display_status: 'cancelled', cancelled_at: '2026-10-02T02:00:00Z' })))
    expect(markButton(await mountCase())).toBeDefined()
  })

  it('入口在右欄最底、設定列之後；橫幅不在兩欄裡，緊接在頁首下面', async () => {
    mockGet(caseRoutes(visitCase()))
    const plain = await mountCase()
    expect(plain.get('.detail__side').element.lastElementChild!.classList.contains('exclusion-action')).toBe(true)
    cleanup()
    mockGet(caseRoutes(excludedCase()))
    const excluded = await mountCase()
    const banner = excluded.get('.exclusion-banner').element
    expect(banner.previousElementSibling!.classList.contains('case-hero')).toBe(true)
    expect(banner.closest('.detail__grid')).toBeNull()
  })

  // 入口的權限閘（E2）要用「未排除」的案件測：已排除時入口本來就因 excluded_at 不顯示，分不出 canManage 有沒有擋。
  it('櫃台（沒有 booking.manage）看不到排除入口；校區管理者看得到', async () => {
    mockGet(caseRoutes(visitCase()))
    const desk = await mountCase(reception() as never)
    expect(desk.find('.case-facts').exists()).toBe(true)
    expect(desk.find('.exclusion-action').exists()).toBe(false)
    expect(markButton(desk)).toBeUndefined()
    cleanup()
    mockGet(caseRoutes(visitCase()))
    const manager = await mountCase(campusAdmin() as never)
    expect(markButton(manager)).toBeDefined()
  })

  // 這一條驗的是橫幅的「取消排除」按鈕只給 booking.manage（入口本來就不會在已排除案件出現）。
  it('已排除：橫幅寫原因與誰標的，有「取消排除」；櫃台看得到橫幅但沒有按鈕', async () => {
    mockGet(caseRoutes(excludedCase()))
    const wrapper = await mountCase(reception() as never)
    const banner = wrapper.get('.exclusion-banner')
    expect(banner.text()).toContain('已排除：測試')
    expect(banner.text()).toContain('陳老師')
    expect(banner.findAll('button').some((b) => b.text() === '取消排除')).toBe(false)
    expect(markButton(wrapper)).toBeUndefined()
  })

  it('已排除：入口收起來；橫幅帶說明；總管理者點「取消排除」送出並重讀', async () => {
    const get = mockGet(caseRoutes(excludedCase({ exclude_reason: 'other', exclude_note: '櫃台練習' })))
    const post = mockPost({ [INCLUDE_PATH]: visitCase() })
    const wrapper = await mountCase()
    const banner = wrapper.get('.exclusion-banner')
    expect(banner.text()).toContain('已排除：其他')
    expect(banner.text()).toContain('櫃台練習')
    expect(markButton(wrapper)).toBeUndefined()
    const before = caseReads(get)
    await banner.findAll('button').find((b) => b.text() === '取消排除')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(INCLUDE_PATH)
    expect(caseReads(get)).toBe(before + 1)
  })

  // 另一個人先動手（兩人同時開著同一筆）：後端回 409，顯示後端訊息，並重讀一次讓頁面跟上。
  it('排除時另一個人已經先排除（409）：對話框留著顯示後端訊息，頁面重讀後出現橫幅、入口收起', async () => {
    let current = visitCase()
    const get = mockGet({ ...caseRoutes(current), [CASE_PATH]: () => current })
    mockPost({ [EXCLUDE_PATH]: () => { current = excludedCase(); throw new ApiError(409, { code: 'ALREADY_EXCLUDED', message: '這筆案件已經被排除了' }) } })
    const wrapper = await mountCase()
    await markButton(wrapper)!.trigger('click')
    await flushPromises()
    const before = caseReads(get)
    await dialogSubmit(body().get('.exclusion-dialog')).trigger('click')
    await flushPromises()
    expect(body().get('.exclusion-dialog .el-alert').text()).toContain('這筆案件已經被排除了')
    expect(caseReads(get)).toBe(before + 1)
    expect(wrapper.find('.exclusion-banner').exists()).toBe(true)
    expect(wrapper.get('.exclusion-action').isVisible()).toBe(false)
  })

  it('取消排除時另一個人已經先取消（409）：顯示後端訊息，頁面重讀後橫幅收起、入口回來', async () => {
    let current = excludedCase()
    const get = mockGet({ ...caseRoutes(current), [CASE_PATH]: () => current })
    mockPost({ [INCLUDE_PATH]: () => { current = visitCase(); throw new ApiError(409, { code: 'NOT_EXCLUDED', message: '這筆案件沒有被排除' }) } })
    const wrapper = await mountCase()
    const before = caseReads(get)
    await wrapper.get('.exclusion-banner').findAll('button').find((b) => b.text() === '取消排除')!.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('這筆案件沒有被排除')
    expect(caseReads(get)).toBe(before + 1)
    expect(wrapper.find('.exclusion-banner').exists()).toBe(false)
    expect(markButton(wrapper)).toBeDefined()
  })

  it('排除失敗不是 409（例如系統錯誤）：只顯示錯誤，不重讀明細', async () => {
    const get = mockGet(caseRoutes(visitCase()))
    mockPost({ [EXCLUDE_PATH]: () => { throw new ApiError(500, { code: 'INTERNAL_ERROR', message: '系統錯誤' }) } })
    const wrapper = await mountCase()
    await markButton(wrapper)!.trigger('click')
    await flushPromises()
    const before = caseReads(get)
    await dialogSubmit(body().get('.exclusion-dialog')).trigger('click')
    await flushPromises()
    expect(body().get('.exclusion-dialog .el-alert').text()).toContain('系統錯誤')
    expect(caseReads(get)).toBe(before)
  })

  it('有關聯的招生訪視：橫幅多一句招生訪視仍會算進統計（E10）；沒有就不寫', async () => {
    mockGet(caseRoutes(excludedCase(completed)))
    const plain = await mountCase()
    expect(plain.get('.exclusion-banner').text()).not.toContain('招生訪視仍會算進招生統計')
    cleanup()
    mockGet({
      ...caseRoutes(excludedCase(completed)),
      '/admin/admissions/records': [admissionsVisit({ visit_request_id: VISIT_ID, has_visit_request: true })], '/admin/admissions/records/v-1': [],
    })
    const family = await mountCase()
    expect(family.get('.exclusion-banner').text()).toContain('這筆預約已排除，但招生訪視仍會算進招生統計；如果是測試資料，請到招生入學刪除訪視')
  })

  it('沒排除的案件沒有橫幅', async () => {
    mockGet(caseRoutes(visitCase()))
    expect((await mountCase()).find('.exclusion-banner').exists()).toBe(false)
  })
})

describe('時間線與操作紀錄的中文', () => {
  it('excluded／exclusion_removed 有標題；操作紀錄動作與原因有中文', () => {
    const base = { id: 'e', source: 'staff', actor_user_id: null, actor_email: null, before: null, reason: null, created_at: '2026-10-15T02:00:00Z' }
    expect(visitEventTitle({ ...base, event_type: 'excluded', after: { reason: 'duplicate' } } as never)).toBe('標記為排除：重複')
    expect(visitEventTitle({ ...base, event_type: 'exclusion_removed', after: null } as never)).toBe('取消排除')
    expect(AUDIT_ACTION_LABELS['visit_request.exclude']).toBe('標記為排除')
    expect(AUDIT_ACTION_LABELS['visit_request.include']).toBe('取消排除')
    expect(auditMetadataDetails({ exclude_reason: 'test' }, 'visit_request.exclude').lines).toContain('排除原因：測試')
  })

  it('案件匯出的「排除」篩選有中文；不認得的值不顯示', () => {
    expect(auditMetadataDetails({ excluded: 'hide', row_count: 3 }, 'visit_request.export').lines).toContain('隱藏已排除')
    expect(auditMetadataDetails({ excluded: 'only' }, 'visit_request.export').lines).toContain('只看已排除')
    expect(auditMetadataDetails({ excluded: 'nope' }, 'visit_request.export').lines.join()).not.toContain('nope')
  })
})
