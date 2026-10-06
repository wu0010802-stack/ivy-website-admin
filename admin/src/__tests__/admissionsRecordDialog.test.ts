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
const inFormItem = (wrapper: VueWrapper, label: string, name: 'ElSwitch' | 'ElAutocomplete') =>
  wrapper.findAllComponents({ name: 'ElFormItem' }).find((item) => item.props('label') === label)!.findComponent({ name })

const tourGuides = (wrapper: VueWrapper) =>
  wrapper.findAllComponents({ name: 'ElSelect' }).find((component) => component.props('ariaLabel') === '帶參觀老師')!
const optionLabels = (select: VueWrapper) => select.findAllComponents({ name: 'ElOption' }).map((option) => option.props('label'))

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
    expect(bodyText()).toContain('存檔後自動編號')
    expect(bodyText()).not.toContain('序號')
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
      english_name: null, father_occupation: null, mother_occupation: null, tour_guide_name: null, source_category: null,
    })
    for (const key of ['has_deposit', 'enrolled', 'enrolled_on', 'withdrawn_at', 'provisional_grade', 'month', 'seq_no', 'tour_guide_user_id', 'geocoding_consent_at']) {
      expect(body, key).not.toHaveProperty(key)
    }
    expect(success).toHaveBeenCalledWith('已儲存，可繼續新增下一筆')
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(field<HTMLInputElement>('input[aria-label="幼生姓名"]').value).toBe('')
    expect(year.props('modelValue')).toBe(116)
    expect(grade.props('modelValue')).toBeNull()
  })

  it('照紙本補的欄位：英文名字、父母職業、帶參觀老師、來源分類、搭娃娃車', async () => {
    const post = mockPost({ '/admin/admissions/records': (_path: string, body?: unknown) => visit({ ...(body as object), id: 'v-new' }) })
    const { wrapper } = await openDialog({ mode: 'add', record: null })
    expect(bodyText()).toContain('來源備註')
    expect(bodyText()).not.toContain('幼生來源')

    typeInto(field('input[aria-label="幼生姓名"]'), '陳小寶')
    typeInto(field('input[aria-label="英文名字"]'), ' Celeste ')
    byPlaceholder(wrapper, 'ElDatePicker', '選擇生日').vm.$emit('update:modelValue', '2023-03-02')
    typeInto(field('input[aria-label="父親職業"]'), '軍')
    typeInto(field('input[aria-label="母親職業"]'), '教師')
    tourGuides(wrapper).vm.$emit('update:modelValue', ['Marvyna'])
    const category = byPlaceholder(wrapper, 'ElSelect', '請選擇來源分類')
    expect(category.findAllComponents({ name: 'ElOption' }).map((option) => option.props('label'))).toEqual(['在校生弟妹', '畢業生弟妹', '家長介紹／社區招生', '自報生（廣告、鄰居、網路、活動）', '邀約來園', '舊生復學'])
    category.vm.$emit('update:modelValue', 'sibling_current')
    inFormItem(wrapper, '搭娃娃車', 'ElSwitch').vm.$emit('update:modelValue', true)
    await flushPromises()

    bodyButton('儲存')!.click()
    await flushPromises()
    expect(post.mock.calls[0]![1]).toMatchObject({
      english_name: 'Celeste', father_occupation: '軍', mother_occupation: '教師', tour_guide_name: 'Marvyna',
      source_category: 'sibling_current', rides_bus: true,
    })
  })

  it('帶參觀老師可以多位：建議是這校填過的名字，可打新名字；一次打好幾位也拆開、去重複，送出用「、」串起來', async () => {
    const post = mockPost({ '/admin/admissions/records': (_path: string, body?: unknown) => visit({ ...(body as object), id: 'v-new' }) })
    const { wrapper } = await openDialog({ mode: 'add', record: null })
    const select = tourGuides(wrapper)
    expect(select.props('multiple')).toBe(true)
    expect(select.props('allowCreate')).toBe(true)
    expect(optionLabels(select)).toEqual(['Marvyna', '林老師'])

    select.vm.$emit('update:modelValue', ['林老師', ' 王老師，陳老師 ', '林老師'])
    await flushPromises()
    expect(select.props('modelValue')).toEqual(['林老師', '王老師', '陳老師'])
    // 新打的名字也留在選項裡，標籤才有字。
    expect(optionLabels(select)).toEqual(['Marvyna', '林老師', '王老師', '陳老師'])

    typeInto(field('input[aria-label="幼生姓名"]'), '陳小寶')
    byPlaceholder(wrapper, 'ElDatePicker', '選擇生日').vm.$emit('update:modelValue', '2023-03-02')
    await flushPromises()
    bodyButton('儲存')!.click()
    await flushPromises()
    expect(post.mock.calls[0]![1]).toMatchObject({ tour_guide_name: '林老師、王老師、陳老師' })
  })

  it('帶參觀老師串起來超過 50 字不能儲存，頁尾寫原因', async () => {
    const { wrapper } = await openDialog({ mode: 'add', record: null })
    typeInto(field('input[aria-label="幼生姓名"]'), '陳小寶')
    byPlaceholder(wrapper, 'ElDatePicker', '選擇生日').vm.$emit('update:modelValue', '2023-03-02')
    tourGuides(wrapper).vm.$emit('update:modelValue', Array.from({ length: 9 }, (_, index) => `第${index + 1}位帶參觀老師`))
    await flushPromises()
    expect(bodyText()).toContain('還不能儲存：帶參觀老師合計超過 50 字')
    expect(bodyButton('儲存')!.disabled).toBe(true)
    tourGuides(wrapper).vm.$emit('update:modelValue', ['第1位帶參觀老師', '第2位帶參觀老師'])
    await flushPromises()
    expect(bodyText()).not.toContain('還不能儲存')
    expect(bodyButton('儲存')!.disabled).toBe(false)
  })

  it('四區直接展開：基本資料、聯絡與來源、預繳狀態、備註都看得到，沒有摺疊', async () => {
    const { wrapper } = await openDialog({ mode: 'add', record: null })
    const headings = [...document.body.querySelectorAll('.record-dialog h3')].map((element) => element.textContent?.trim())
    expect(headings).toEqual(['基本資料', '聯絡與來源', '預繳狀態', '備註'])
    expect(wrapper.findAllComponents({ name: 'ElCollapse' })).toHaveLength(0)
    expect(bodyText()).not.toMatch(/已填 \d 項|未填/)
    for (const label of ['聯絡人姓名', '電話', '地址', '父親職業', '來源分類', '家長介紹', '來源備註', '未預繳原因', '轉其他學期', '備註', '電訪回應']) {
      expect(document.body.querySelector(`[aria-label="${label}"]`), label).not.toBeNull()
    }
    // 聯絡人與電話歸在「聯絡與來源」；電話範例寫在輸入框裡。
    const contact = [...document.body.querySelectorAll('.record-dialog__group')][1]!
    expect(contact.querySelector('[aria-label="聯絡人姓名"]')).not.toBeNull()
    expect(field<HTMLInputElement>('input[aria-label="電話"]').placeholder).toBe('例：0912-345-678')
    expect(field<HTMLInputElement>('input[aria-label="家長介紹"]').placeholder).toBe('哪位家長介紹來的，例如：王小美媽媽')
    expect(bodyText()).not.toContain('介紹者')
    expect(bodyText()).not.toContain('接待人員')
  })

  it('新增時游標停在幼生姓名；編輯時不搶焦點', async () => {
    const { wrapper } = await openDialog({ mode: 'add', record: null })
    wrapper.findComponent({ name: 'ElDialog' }).vm.$emit('opened')
    await flushPromises()
    expect(document.activeElement).toBe(field('input[aria-label="幼生姓名"]'))
    cleanup()
    const edit = await openDialog({ mode: 'edit', record: visit() })
    edit.wrapper.findComponent({ name: 'ElDialog' }).vm.$emit('opened')
    await flushPromises()
    expect(document.activeElement).not.toBe(field('input[aria-label="幼生姓名"]'))
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

  it('只改來源分類與娃娃車時只送這兩欄', async () => {
    const record = visit({ version: 2, source_category: 'referral', rides_bus: false, english_name: 'Leo', father_occupation: '軍' })
    const patch = mockPatch({ '/admin/admissions/records/v-1': visit({ version: 3 }) })
    const { wrapper } = await openDialog({ mode: 'edit', record })
    expect(field<HTMLInputElement>('input[aria-label="英文名字"]').value).toBe('Leo')
    expect(field<HTMLInputElement>('input[aria-label="父親職業"]').value).toBe('軍')
    byPlaceholder(wrapper, 'ElSelect', '請選擇來源分類').vm.$emit('update:modelValue', 'sibling_graduate')
    inFormItem(wrapper, '搭娃娃車', 'ElSwitch').vm.$emit('update:modelValue', true)
    await flushPromises()
    bodyButton('儲存')!.click()
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/admissions/records/v-1', { source_category: 'sibling_graduate', rides_bus: true, expected_version: 2 })
  })

  it('舊資料用逗號或斜線分隔的帶參觀老師拆成標籤；沒動它就不送', async () => {
    const record = visit({ version: 3, tour_guide_name: '林老師,王老師／陳老師' })
    const patch = mockPatch({ '/admin/admissions/records/v-1': visit({ version: 4 }) })
    const { wrapper } = await openDialog({ mode: 'edit', record })
    expect(tourGuides(wrapper).props('modelValue')).toEqual(['林老師', '王老師', '陳老師'])
    typeInto(field('textarea[aria-label="備註"]'), '補一句')
    await flushPromises()
    bodyButton('儲存')!.click()
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/admissions/records/v-1', { notes: '補一句', expected_version: 3 })
  })

  it('原因說明在選了未預繳原因後才出現；以前填過說明的照常顯示', async () => {
    const { wrapper } = await openDialog({ mode: 'edit', record: visit({ no_deposit_reason: null, no_deposit_reason_detail: null }) })
    expect(document.body.querySelector('textarea[aria-label="原因說明"]')).toBeNull()
    byPlaceholder(wrapper, 'ElSelect', '請選擇原因').vm.$emit('update:modelValue', '費用考量')
    await flushPromises()
    expect(document.body.querySelector('textarea[aria-label="原因說明"]')).not.toBeNull()
    cleanup()
    await openDialog({ mode: 'edit', record: visit({ no_deposit_reason: null, no_deposit_reason_detail: '家長還在比較' }) })
    expect(field<HTMLTextAreaElement>('textarea[aria-label="原因說明"]').value).toBe('家長還在比較')
  })

  it('預繳狀態只顯示、不能在表單改；已預繳才可以填收預繳人員', async () => {
    await openDialog({ mode: 'edit', record: visit({ has_deposit: true, stage: 'deposited' }) })
    expect(bodyText()).toContain('目前階段')
    expect(document.body.querySelector('.record-dialog__stage .el-tag')!.textContent?.trim()).toBe('已預繳')
    expect(bodyText()).toContain('預繳、註冊、退出要用明細列的按鈕或看板拖曳，才會留下紀錄。')
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
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '這筆招生訪視剛被其他人修改，已載入最新的內容；你的修改沒有儲存，請確認後再改' }))
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
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '這筆招生訪視已依保存政策匿名化，不能再變更' }))
    expect(wrapper.emitted('stale')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('F2：編輯儲存收到 404（別人剛刪掉）：提示已重新載入、關閉、通知列表重讀，不顯示錯誤', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    const error = vi.spyOn(ElMessage, 'error')
    mockPatch({
      '/admin/admissions/records/v-1': () => {
        throw new ApiError(404, { detail: 'not found' })
      },
    })
    const { wrapper } = await openDialog({ mode: 'edit', record: visit() })
    typeInto(field('textarea[aria-label="備註"]'), '想補一句')
    await flushPromises()
    bodyButton('儲存')!.click()
    await flushPromises()
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '這筆招生訪視已被刪除，已重新載入' }))
    expect(error).not.toHaveBeenCalled()
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
