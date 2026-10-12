import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import { auditMetadataDetails } from '../api/labels'
import { visitEventChanges, visitEventTitle } from '../api/visitHistory'
import VisitDetailsDialog from '../components/visit/VisitDetailsDialog.vue'
import VisitDetailView from '../views/VisitDetailView.vue'
import { cleanup, mockGet, mockPatch, reception } from './admissionsTestKit'
import { caseRoutes, mountRoutes, visitCase, VISIT_ID } from './visitCaseKit'

// 預約明細「修改」對話框（2026-10-12 規格 3.3）：後台人員改家長稱呼、手機、Email、孩子姓名與生日。

const dialogs: VueWrapper[] = []
afterEach(() => {
  dialogs.forEach((wrapper) => wrapper.unmount())
  dialogs.length = 0
  cleanup()
})

const PATH = `/admin/visit-requests/${VISIT_ID}/details`
const ANONYMIZED_NAME = '（已依保存政策匿名化）'

const body = () => new DOMWrapper(document.body)
const field = (label: string) => body().findAll('.el-form-item').find((item) => item.find('.el-form-item__label').text() === label)!
const input = (label: string) => field(label).get('input')
const saveButton = () => body().findAll('button').find((b) => b.text() === '儲存')!

/** PATCH 回應：整份案件（新的 details_version）＋這次的結果。 */
function result(extra: Record<string, unknown> = {}) {
  return {
    ...visitCase({ details_version: 4 }),
    changed_fields: ['email'], admissions_synced_fields: [], admissions_skipped_fields: [], email_notified: false,
    ...extra,
  }
}

async function openDialog(props: Record<string, unknown> = {}, detail = visitCase({ details_version: 3 })) {
  const wrapper = mount(VisitDetailsDialog, {
    props: { modelValue: true, detail, ...props } as never,
    attachTo: document.body,
    global: { plugins: [ElementPlus] },
  })
  dialogs.push(wrapper)
  await flushPromises()
  return wrapper
}

async function save() {
  await saveButton().trigger('click')
  await flushPromises()
}

// el-form-item 的錯誤訊息晚 100ms 才出現（refDebounced），讀訊息前先等一下。
const errorShown = () => new Promise((resolve) => setTimeout(resolve, 150)).then(() => flushPromises())

const successTexts = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((call) => {
  const arg = call[0] as string | { message?: string }
  return typeof arg === 'string' ? arg : String(arg.message ?? '')
})

describe('VisitDetailsDialog', () => {
  it('開啟時帶入現值；沒改任何欄位按儲存：不呼叫 API、直接關', async () => {
    const patch = mockPatch({ [PATH]: result() })
    const wrapper = await openDialog()
    expect(input('家長稱呼').element.value).toBe('林小姐')
    expect(input('手機').element.value).toBe('0912000001')
    expect(input('孩子姓名').element.value).toBe('小安')
    expect(input('孩子生日').element.value).toBe('2022-05-01')
    expect(input('Email').element.value).toBe('p1@example.com')
    await save()
    expect(patch).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('孩子生日不能選未來的日子', async () => {
    const wrapper = await openDialog()
    const disabled = wrapper.findComponent({ name: 'ElDatePicker' }).props('disabledDate') as (date: Date) => boolean
    expect(disabled(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000))).toBe(true)
    expect(disabled(new Date(2022, 4, 1))).toBe(false)
  })

  it('電話改成 0912：即時顯示「手機號碼要是 09 開頭的 10 碼」，儲存不送出', async () => {
    const patch = mockPatch({ [PATH]: result() })
    await openDialog()
    await input('手機').setValue('0912')
    await errorShown()
    expect(field('手機').text()).toContain('手機號碼要是 09 開頭的 10 碼')
    await save()
    expect(patch).not.toHaveBeenCalled()
  })

  it('電話有空白或連字號：先去掉再檢查，送出的是 10 碼數字', async () => {
    const patch = mockPatch({ [PATH]: result({ changed_fields: ['phone'] }) })
    await openDialog()
    await input('手機').setValue('0933-444 555')
    await flushPromises()
    expect(field('手機').text()).not.toContain('09 開頭')
    await save()
    expect(patch).toHaveBeenCalledWith(PATH, { expected_version: 3, phone: '0933444555' })
  })

  it('家長稱呼清空、Email 格式不對：各自顯示原因，不送出', async () => {
    const patch = mockPatch({ [PATH]: result() })
    await openDialog()
    await input('家長稱呼').setValue('  ')
    await input('Email').setValue('not-an-email')
    await errorShown()
    expect(field('家長稱呼').text()).toContain('請填家長稱呼')
    expect(field('Email').text()).toContain('請輸入正確的 Email')
    await save()
    expect(patch).not.toHaveBeenCalled()
  })

  it('改 Email 後送出：body 只含 email 與 expected_version', async () => {
    const patch = mockPatch({ [PATH]: result() })
    const wrapper = await openDialog()
    await input('Email').setValue(' new@example.com ')
    await save()
    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch).toHaveBeenCalledWith(PATH, { expected_version: 3, email: 'new@example.com' })
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('Email、孩子姓名清空：送 null（後台可以清掉這三欄）；稱呼與手機不能清', async () => {
    const patch = mockPatch({ [PATH]: result({ changed_fields: ['email', 'child_name'] }) })
    await openDialog()
    await input('Email').setValue('')
    await input('孩子姓名').setValue('')
    await save()
    expect(patch).toHaveBeenCalledWith(PATH, { expected_version: 3, email: null, child_name: null })
  })

  it('招生資料一起改了：成功訊息列出欄位；招生端另外改過的沒有跟著改，另外提示', async () => {
    mockPatch({ [PATH]: result({ changed_fields: ['phone', 'child_birthdate'], admissions_synced_fields: ['phone', 'birthday'], admissions_skipped_fields: ['child_name', 'grade'] }) })
    const success = vi.spyOn(ElMessage, 'success').mockReturnValue(undefined as never)
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue(undefined as never)
    await openDialog()
    await input('手機').setValue('0933444555')
    await save()
    expect(successTexts(success).join('|')).toContain('已更新家長資料')
    expect(successTexts(success).join('|')).toContain('招生資料已一起更新：電話、生日')
    expect(successTexts(warning).join('|')).toContain('招生資料的孩子姓名、年級另外改過，沒有跟著改')
  })

  it('只有電話沒同步：「招生資料的電話另外改過，沒有跟著改」', async () => {
    mockPatch({ [PATH]: result({ changed_fields: ['phone'], admissions_skipped_fields: ['phone'] }) })
    vi.spyOn(ElMessage, 'success').mockReturnValue(undefined as never)
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue(undefined as never)
    await openDialog()
    await input('手機').setValue('0933444555')
    await save()
    expect(successTexts(warning)).toEqual(['招生資料的電話另外改過，沒有跟著改'])
  })

  it('變更通知已排給新信箱：另提示「已寄變更通知到新信箱」；沒排就不提', async () => {
    const success = vi.spyOn(ElMessage, 'success').mockReturnValue(undefined as never)
    mockPatch({ [PATH]: result({ email_notified: true }) })
    await openDialog()
    await input('Email').setValue('new@example.com')
    await save()
    expect(successTexts(success).join('|')).toContain('已寄變更通知到新信箱')

    success.mockClear()
    document.body.innerHTML = ''
    mockPatch({ [PATH]: result({ email_notified: false }) })
    await openDialog()
    await input('Email').setValue('other@example.com')
    await save()
    expect(successTexts(success).join('|')).toContain('已更新家長資料')
    expect(successTexts(success).join('|')).not.toContain('已寄變更通知')
  })

  it('該校還沒設定寄信：不說已寄出，改提醒電話通知家長', async () => {
    const success = vi.spyOn(ElMessage, 'success').mockReturnValue(undefined as never)
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue(undefined as never)
    mockPatch({ [PATH]: result({ email_notified: true }) })
    await openDialog({ emailEnabled: false })
    await input('Email').setValue('new@example.com')
    await save()
    expect(successTexts(success).join('|')).not.toContain('已寄變更通知')
    expect(successTexts(warning).join('|')).toContain('尚未設定寄信')
  })

  it('版本衝突 409：提示「家長或同事剛改過資料，已重新載入」並通知案件頁重新載入', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(409, { code: 'VISIT_REQUEST_VERSION_CONFLICT', message: '這筆案件剛被其他人修改' }),
    )
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue(undefined as never)
    const wrapper = await openDialog()
    await input('Email').setValue('new@example.com')
    await save()
    expect(successTexts(warning)).toEqual(['家長或同事剛改過資料，已重新載入'])
    expect(wrapper.emitted('reload')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('後端 422 指到欄位：寫在那一欄下面，對話框不關', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(422, [{ loc: ['body', 'email'], msg: 'value is not a valid email address', type: 'value_error' }]),
    )
    const wrapper = await openDialog()
    await input('Email').setValue('a@b.co')
    await save()
    await errorShown()
    expect(field('Email').text()).toContain('value is not a valid email address')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('案件頁的「修改」', () => {
  it('能處理案件的人在資料表標題列看得到「修改」，按下去打開對話框；存好後案件頁重新載入', async () => {
    const get = mockGet(caseRoutes(visitCase({ details_version: 3 })))
    const patch = mockPatch({ [PATH]: result() })
    vi.spyOn(ElMessage, 'success').mockReturnValue(undefined as never)
    const { wrapper } = await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView })
    const open = wrapper.get('.case-facts .panel__head').findAll('button').find((b) => b.text() === '修改')
    expect(open).toBeDefined()
    expect(document.body.textContent).not.toContain('修改家長資料')
    await open!.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('修改家長資料')
    await input('Email').setValue('new@example.com')
    const loadsBefore = get.mock.calls.filter((call) => call[0] === `/admin/visit-requests/${VISIT_ID}`).length
    await save()
    expect(patch).toHaveBeenCalledWith(PATH, { expected_version: 3, email: 'new@example.com' })
    expect(get.mock.calls.filter((call) => call[0] === `/admin/visit-requests/${VISIT_ID}`).length).toBe(loadsBefore + 1)
  })

  it('已匿名化的案件、或沒有處理案件權限的帳號：不顯示「修改」', async () => {
    mockGet(caseRoutes(visitCase({ anonymized: true, parent_name: ANONYMIZED_NAME, phone: '0000000000', child_name: null, child_birthdate: null, email: null })))
    const anonymized = await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView })
    expect(anonymized.wrapper.find('.case-facts').exists()).toBe(true)
    expect(anonymized.wrapper.get('.case-facts .panel__head').findAll('button').some((b) => b.text() === '修改')).toBe(false)
    cleanup()

    // 看旗標、不看稱呼：家長剛好填了同一句話，沒有匿名化就照常能修改。
    mockGet(caseRoutes(visitCase({ parent_name: ANONYMIZED_NAME })))
    const lookalike = await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView })
    expect(lookalike.wrapper.get('.case-facts .panel__head').findAll('button').some((b) => b.text() === '修改')).toBe(true)
    cleanup()

    mockGet(caseRoutes(visitCase()))
    const viewer = await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView }, {
      user: { ...reception(), effective_capabilities: ['booking.read'] } as never,
    })
    expect(viewer.wrapper.find('.case-facts').exists()).toBe(true)
    expect(viewer.wrapper.get('.case-facts .panel__head').findAll('button').some((b) => b.text() === '修改')).toBe(false)
  })
})

describe('歷程：資料已更新', () => {
  const event = (extra: Record<string, unknown> = {}) => ({
    id: 'h1', event_type: 'details_updated', source: 'staff', actor_user_id: 'u1', actor_email: 'amy@ivy.example',
    actor_display_name: '怡君', before: null, after: { fields: ['phone', 'email'] }, reason: null,
    created_at: '2026-10-12T02:00:00Z', ...extra,
  })

  it('員工改的寫「怡君改了 手機、Email」，家長改的寫「家長改了 …」；只寫欄位名', () => {
    expect(visitEventChanges(event() as never)).toEqual(['怡君改了 手機、Email'])
    expect(visitEventChanges(event({ actor_display_name: null }) as never)).toEqual(['amy改了 手機、Email'])
    expect(visitEventChanges(event({ source: 'parent', actor_user_id: null, actor_email: null, actor_display_name: null, after: { fields: ['phone'] } }) as never)).toEqual(['家長改了 手機'])
  })

  it('標題：員工改的是「修改家長資料」，家長改的是「家長修改資料」', () => {
    expect(visitEventTitle(event() as never)).toBe('修改家長資料')
    expect(visitEventTitle(event({ source: 'parent', actor_user_id: null }) as never)).toBe('家長修改資料')
  })

  it('操作紀錄的細節把欄位名翻成中文（預約的與招生同步的各用自己的欄位名）', () => {
    expect(auditMetadataDetails({ fields: ['parent_name', 'phone', 'child_birthdate'] }, 'visit_request.update_details').lines).toEqual(['修改：家長稱呼、手機、孩子出生年月日'])
    expect(auditMetadataDetails({ fields: ['contact_name', 'birthday'] }, 'recruitment_visit.synced_from_visit_request').lines).toEqual(['修改：聯絡人、生日'])
  })

  it('案件頁時間線列出誰改了哪些欄位', async () => {
    mockGet(caseRoutes(visitCase({ history: [event()] })))
    const { wrapper } = await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView })
    const item = wrapper.get('.timeline__item[data-kind="event"]')
    expect(item.text()).toContain('修改家長資料')
    expect(item.get('.timeline__change').text()).toBe('怡君改了 手機、Email')
  })
})
