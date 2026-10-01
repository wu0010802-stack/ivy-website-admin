import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import EventsDrawer from '../components/admissions/EventsDrawer.vue'
import { ApiError } from '../api/client'
import { cleanup, mockGet, mockPatch, mockPost, mountWith, options, visit } from './admissionsTestKit'

afterEach(cleanup)

// 對話框與抽屜都 append-to-body：內容從 document 找，元件用 findAllComponents 找。
const bodyText = () => document.body.textContent ?? ''
const field = <T extends HTMLInputElement | HTMLTextAreaElement>(selector: string) => document.body.querySelector<T>(selector)!
function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  element.value = value
  element.dispatchEvent(new Event('input'))
}
const bodyButton = (text: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === text)
const byPlaceholder = (wrapper: VueWrapper, name: 'ElSelect' | 'ElDatePicker', placeholder: string) =>
  wrapper.findAllComponents({ name }).find((component) => component.props('placeholder') === placeholder)!

async function openDialog(props: Record<string, unknown>) {
  const mounted = await mountWith(RecordDialog, { props: { modelValue: false, campusKey: 'renwu', options: options(), ...props } })
  await mounted.wrapper.setProps({ modelValue: true })
  await flushPromises()
  return mounted
}

describe('新增訪視（規格 6.1 第 3 點）', () => {
  it('四個必填、生日帶出適讀班級、民國日期提示；送出不帶預繳註冊等欄位；儲存並新增下一筆沿用入學學期', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T09:00:00+08:00'))
    const success = vi.spyOn(ElMessage, 'success')
    const post = mockPost({ '/admin/admissions/records': (_path: string, body?: unknown) => visit({ ...(body as object), id: 'v-new' }) })
    const { wrapper } = await openDialog({ mode: 'add', record: null })

    expect(bodyText()).toContain('新增訪視紀錄')
    expect(bodyText()).toContain('自動產生')
    expect(bodyText()).toContain('民國：115.10.01（月份：115.10）')
    expect(bodyButton('儲存')!.disabled).toBe(true)
    expect(bodyText()).toContain('還不能儲存：還沒填幼生姓名、生日')

    typeInto(field('input[aria-label="幼生姓名"]'), '陳小寶')
    byPlaceholder(wrapper, 'ElDatePicker', '選擇生日').vm.$emit('update:modelValue', '2023-03-02')
    await flushPromises()
    const grade = byPlaceholder(wrapper, 'ElSelect', '請選擇班別')
    expect(grade.props('modelValue')).toBe('小班')
    expect(bodyText()).toContain('✓ 已依生日 × 115 學年自動判定，可手動修改')

    // 改成明年入學：上次是自動帶入，跟著改；手動選過就不再覆寫。
    const year = byPlaceholder(wrapper, 'ElSelect', '學年')
    year.vm.$emit('update:modelValue', 116)
    await flushPromises()
    expect(grade.props('modelValue')).toBe('中班')

    bodyButton('儲存並新增下一筆')!.click()
    await flushPromises()
    expect(post.mock.calls[0]![0]).toBe('/admin/admissions/records?campus_key=renwu')
    const body = post.mock.calls[0]![1] as Record<string, unknown>
    expect(body).toMatchObject({
      child_name: '陳小寶', birthday: '2023-03-02', visit_date: '2026-10-01', grade: '中班', target_school_year: 116, target_semester: 1,
      contact_name: null, phone: null, transfer_term: false, rides_bus: false,
    })
    for (const key of ['has_deposit', 'enrolled', 'enrolled_on', 'withdrawn_at', 'provisional_grade', 'month', 'seq_no', 'source_category', 'tour_guide_user_id', 'geocoding_consent_at']) {
      expect(body, key).not.toHaveProperty(key)
    }
    expect(success).toHaveBeenCalledWith('已儲存，可繼續新增下一筆')
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(field<HTMLInputElement>('input[aria-label="幼生姓名"]').value).toBe('')
    expect(year.props('modelValue')).toBe(116)
    expect(grade.props('modelValue')).toBeNull()
  })

  it('手動選過的適讀班級，改生日也不覆寫', async () => {
    const { wrapper } = await openDialog({ mode: 'add', record: null })
    const grade = byPlaceholder(wrapper, 'ElSelect', '請選擇班別')
    grade.vm.$emit('update:modelValue', '大班')
    grade.vm.$emit('change', '大班')
    byPlaceholder(wrapper, 'ElDatePicker', '選擇生日').vm.$emit('update:modelValue', '2023-03-02')
    await flushPromises()
    expect(grade.props('modelValue')).toBe('大班')
    expect(bodyText()).not.toContain('自動判定')
  })

  it('後端拒絕時錯誤寫在對話框裡，不關閉', async () => {
    mockPost({
      '/admin/admissions/records': () => {
        throw new ApiError(422, [{ loc: ['body', 'grade'], msg: 'Value error, 年級只能是幼幼班、小班、中班、大班', type: 'value_error' }])
      },
    })
    const { wrapper } = await openDialog({ mode: 'add', record: null })
    typeInto(field('input[aria-label="幼生姓名"]'), '陳小寶')
    byPlaceholder(wrapper, 'ElDatePicker', '選擇生日').vm.$emit('update:modelValue', '2023-03-02')
    await flushPromises()
    bodyButton('儲存')!.click()
    await flushPromises()
    expect(bodyText()).toContain('年級只能是幼幼班、小班、中班、大班')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('編輯訪視（規格 6.6）', () => {
  it('帶入原值，只送改過的欄位與版本；自動建立、沒有生日的也能存', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    const record = visit({ birthday: null, grade: null, notes: '家長想了解：午睡', version: 4, has_visit_request: true, seq_no: '7' })
    const patch = mockPatch({ '/admin/admissions/records/v-1': visit({ notes: '已電訪，下週回覆', version: 5 }) })
    const { wrapper } = await openDialog({ mode: 'edit', record })
    expect(bodyText()).toContain('編輯訪視紀錄')
    expect(bodyText()).toContain('序號 7')
    expect(field<HTMLInputElement>('input[aria-label="幼生姓名"]').value).toBe('王小安')
    expect(bodyText()).not.toContain('還不能儲存')

    typeInto(field('textarea[aria-label="備註"]'), '已電訪，下週回覆')
    await flushPromises()
    bodyButton('儲存')!.click()
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/admissions/records/v-1', { notes: '已電訪，下週回覆', expected_version: 4 })
    expect(success).toHaveBeenCalledWith('更新成功')
    expect(wrapper.emitted('saved')![0]).toEqual([expect.objectContaining({ version: 5 })])
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('預繳狀態只顯示、不能在表單改；已預繳才可以填收預繳人員', async () => {
    await openDialog({ mode: 'edit', record: visit({ has_deposit: true, stage: 'deposited' }) })
    expect(bodyText()).toContain('目前階段：已預繳')
    expect(bodyText()).toContain('預繳、註冊與退出請在漏斗看板拖曳卡片，或用明細列的按鈕')
    expect(document.body.querySelector('input[aria-label="收預繳人員"]')).not.toBeNull()
    // 已預繳就不問未預繳原因。
    expect(bodyText()).not.toContain('未預繳原因')
  })

  it('別人剛改過：提示、載入最新內容、通知列表重新整理，不關閉', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    mockGet({ '/admin/admissions/records/v-1': visit({ notes: '別人改的', version: 5 }) })
    mockPatch({
      '/admin/admissions/records/v-1': () => {
        throw new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT', current_version: 5 })
      },
    })
    const { wrapper } = await openDialog({ mode: 'edit', record: visit({ version: 4 }) })
    typeInto(field('textarea[aria-label="備註"]'), '我的修改')
    await flushPromises()
    bodyButton('儲存')!.click()
    await flushPromises()
    expect(warning).toHaveBeenCalledWith('這筆招生訪視剛被其他人修改，已載入最新的內容；你的修改沒有儲存，請確認後再改')
    expect(wrapper.emitted('stale')).toHaveLength(1)
    expect(field<HTMLTextAreaElement>('textarea[aria-label="備註"]').value).toBe('別人改的')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('編輯儲存收到已匿名化的 409：提示、通知重新整理並關閉表單', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    mockPatch({
      '/admin/admissions/records/v-1': () => {
        throw new ApiError(409, { code: 'RECRUITMENT_VISIT_ANONYMIZED' })
      },
    })
    const { wrapper } = await openDialog({ mode: 'edit', record: visit() })
    typeInto(field('textarea[aria-label="備註"]'), '想補一句')
    await flushPromises()
    bodyButton('儲存')!.click()
    await flushPromises()
    expect(warning).toHaveBeenCalledWith('這筆招生訪視已依保存政策匿名化，不能再變更')
    expect(wrapper.emitted('stale')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('有改動時關閉要先確認；按先不要就留著', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    const { wrapper } = await openDialog({ mode: 'edit', record: visit() })
    typeInto(field('textarea[aria-label="備註"]'), '還沒存')
    await flushPromises()
    bodyButton('取消')!.click()
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0]![1]).toBe('放棄這次修改？')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('歷程抽屜（規格第 10 節：歷程不露英文代碼）', () => {
  const events = [
    { id: 'e1', event_type: 'created', from_stage: null, to_stage: 'visited', reason: null, metadata_json: { origin: 'visit_request' }, created_at: '2026-09-08T02:00:00Z' },
    { id: 'e2', event_type: 'deposit_added', from_stage: 'visited', to_stage: 'deposited', reason: null, metadata_json: null, created_at: '2026-09-10T02:00:00Z' },
    { id: 'e3', event_type: 'seat_reserved', from_stage: 'deposited', to_stage: 'deposited', reason: null, metadata_json: { grade: '小班', school_year: 115, semester: 1 }, created_at: '2026-09-11T02:00:00Z' },
    { id: 'e4', event_type: 'withdrawn', from_stage: 'deposited', to_stage: 'withdrawn', reason: '家長搬家', metadata_json: null, created_at: '2026-09-12T02:00:00Z' },
  ]

  it('事件中文、階段變化、原因；座位事件寫年級學期，不寫「已預繳 → 已預繳」', async () => {
    const get = mockGet({ '/admin/admissions/records/v-1/events': events })
    const { wrapper } = await mountWith(EventsDrawer, { props: { modelValue: false, visitId: 'v-1', childName: '王小安' } })
    expect(get).not.toHaveBeenCalled()
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    const text = bodyText()
    for (const expected of ['參觀→入學 歷程', '幼生：王小安', '建立訪視（官網預約到場）', '加上預繳', '已訪視 → 已預繳', '保留座位', '小班・115 上學期', '已預繳 → 退預繳／退註冊', '家長搬家']) {
      expect(text).toContain(expected)
    }
    expect(text).not.toContain('已預繳 → 已預繳')
    expect(text).not.toContain('seat_reserved')
    expect(text).not.toContain('— → 已訪視')
  })

  it('沒有事件時說明；讀不到時顯示錯誤，可以重新載入', async () => {
    let fail = true
    mockGet({
      '/admin/admissions/records/v-1/events': () => {
        if (fail) throw new Error('offline')
        return []
      },
    })
    const { wrapper } = await mountWith(EventsDrawer, { props: { modelValue: false, visitId: 'v-1' } })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(bodyText()).toContain('無法讀取歷程')
    fail = false
    bodyButton('重新載入')!.click()
    await flushPromises()
    expect(bodyText()).toContain('尚無歷程事件')
  })
})
