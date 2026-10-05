import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import RecordsTab from '../components/admissions/RecordsTab.vue'
import { ApiError } from '../api/client'
import { bodyOf, cleanup, mockGet, mockPost, mountWith, pathsTo, reception, visit } from './admissionsTestKit'

// 名額規劃分頁 2026-10-05 拿掉；本檔原是 admissionsIntake.test.ts，只留保留座位。
afterEach(cleanup)

const bodyText = () => document.body.textContent ?? ''
const bodyButton = (text: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === text)

describe('保留座位（規格 6.5，明細「更多」）', () => {
  const recordsProps = { campusKey: 'yihua', schoolYear: 115, semester: null, month: '', visitRequestId: '' }

  async function moreLabels(wrapper: VueWrapper, id: string): Promise<string[]> {
    await wrapper.get(`[data-more="${id}"]`).trigger('click')
    await vi.waitFor(() => expect(document.body.querySelector(`.records-more-menu--${id} .el-dropdown-menu__item`)).not.toBeNull())
    return [...document.body.querySelectorAll<HTMLElement>(`.records-more-menu--${id} .el-dropdown-menu__item`)].map((item) => item.textContent?.trim() ?? '')
  }
  async function chooseMore(wrapper: VueWrapper, id: string, label: string) {
    await moreLabels(wrapper, id)
    const item = [...document.body.querySelectorAll<HTMLElement>(`.records-more-menu--${id} .el-dropdown-menu__item`)].find((element) => element.textContent?.trim() === label)
    expect(item, `更多選單裡要有「${label}」`).toBeDefined()
    item!.click()
    await flushPromises()
  }

  it('只有已預繳的列有；已保留過的寫「變更座位」', async () => {
    mockGet({
      '/admin/admissions/records': [
        visit({ id: 'v-a' }),
        visit({ id: 'v-b', has_deposit: true, stage: 'deposited' }),
        visit({ id: 'v-c', has_deposit: true, stage: 'deposited', provisional_grade: '小班' }),
        visit({ id: 'v-d', enrolled: true, enrolled_on: '2026-09-20', stage: 'enrolled', provisional_grade: '小班' }),
      ],
    })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    expect(await moreLabels(wrapper, 'v-a')).not.toContain('保留座位')
    expect(await moreLabels(wrapper, 'v-b')).toContain('保留座位')
    expect(await moreLabels(wrapper, 'v-c')).toContain('變更座位')
    // 已註冊不能清除保留，要改年級請先取消註冊（規格 6.5）。
    const enrolled = await moreLabels(wrapper, 'v-d')
    expect(enrolled).not.toContain('保留座位')
    expect(enrolled).not.toContain('變更座位')
  })

  it('保留：預設適讀班級與入學學期，送出帶版本；成功後重新整理', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    const get = mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited', version: 6 })] })
    const post = mockPost({ '/admin/admissions/records/v-1/seat': { visit: visit({ provisional_grade: '小班' }), capacity_warning: false, warning_code: null } })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    await chooseMore(wrapper, 'v-1', '保留座位')
    expect(bodyText()).toContain('幼生：王小安')
    expect(bodyButton('釋放保留')).toBeUndefined()
    bodyButton('確認保留')!.click()
    await flushPromises()
    expect(bodyOf(post, '/admin/admissions/records/v-1/seat')).toEqual({ grade: '小班', target_school_year: 115, target_semester: 1, expected_version: 6 })
    expect(success).toHaveBeenCalledWith('已保留座位')
    expect(pathsTo(get, '/admin/admissions/records?')).toHaveLength(2)
  })

  it('後端回 capacity_warning 也只顯示已保留：名額規劃已拿掉，不提超過計畫名額', async () => {
    const alert = vi.spyOn(ElMessageBox, 'alert')
    const success = vi.spyOn(ElMessage, 'success')
    mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited' })] })
    mockPost({ '/admin/admissions/records/v-1/seat': { visit: visit({ provisional_grade: '小班' }), capacity_warning: true, warning_code: 'SEAT_CAPACITY_WARNING' } })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    await chooseMore(wrapper, 'v-1', '保留座位')
    expect(document.body.querySelector('.seat-dialog')?.textContent).not.toContain('名額')
    bodyButton('確認保留')!.click()
    await flushPromises()
    expect(alert).not.toHaveBeenCalled()
    expect(success).toHaveBeenCalledWith('已保留座位')
  })

  it('變更座位可以釋放保留（年級送 null，學年學期不動）', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    mockGet({
      '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited', provisional_grade: '中班', target_semester: 2, version: 3 })],
    })
    const post = mockPost({ '/admin/admissions/records/v-1/seat': { visit: visit(), capacity_warning: false, warning_code: null } })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    await chooseMore(wrapper, 'v-1', '變更座位')
    bodyButton('釋放保留')!.click()
    await flushPromises()
    expect(bodyOf(post, '/admin/admissions/records/v-1/seat')).toEqual({ grade: null, target_school_year: 115, target_semester: 2, expected_version: 3 })
    expect(success).toHaveBeenCalledWith('已釋放保留')
  })

  it('後端拒絕（例如未預繳）顯示原因；版本衝突提示並重新整理', async () => {
    const error = vi.spyOn(ElMessage, 'error')
    const info = vi.spyOn(ElMessage, 'info')
    let conflict = false
    const get = mockGet({ '/admin/admissions/records': [visit({ has_deposit: true, stage: 'deposited' })] })
    mockPost({
      '/admin/admissions/records/v-1/seat': () => {
        if (conflict) throw new ApiError(409, { code: 'RECRUITMENT_VISIT_VERSION_CONFLICT', current_version: 2 })
        throw new ApiError(422, { code: 'SEAT_NOT_ALLOWED', message: '未預繳的訪視不可保留座位' })
      },
    })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    await chooseMore(wrapper, 'v-1', '保留座位')
    bodyButton('確認保留')!.click()
    await flushPromises()
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: '未預繳的訪視不可保留座位' }))
    conflict = true
    bodyButton('確認保留')!.click()
    await flushPromises()
    expect(info).toHaveBeenCalledWith('這筆招生訪視剛被其他人修改，已重新載入，請確認後再操作')
    expect(pathsTo(get, '/admin/admissions/records?')).toHaveLength(2)
  })

  it('R3：換掉 moreCommands 後刪除條件仍受 admissions.convert 限制', async () => {
    const routes = {
      '/admin/admissions/records': [
        visit({ id: 'v-e', enrolled: true, stage: 'enrolled', provisional_grade: '小班' }),
        visit({ id: 'v-w', stage: 'withdrawn', withdrawn_from: 'enrolled' }),
      ],
    }
    mockGet(routes)
    const desk = await mountWith(RecordsTab, { props: recordsProps, user: reception() })
    // 櫃台沒有 admissions.convert：已註冊、從已註冊退出的列只剩編輯（10-05 編輯收進「更多」），沒有刪除。
    expect(await moreLabels(desk.wrapper, 'v-e')).toEqual(['編輯'])
    expect(await moreLabels(desk.wrapper, 'v-w')).toEqual(['編輯'])
    cleanup()
    mockGet(routes)
    const boss = await mountWith(RecordsTab, { props: recordsProps })
    expect(await moreLabels(boss.wrapper, 'v-e')).toContain('刪除')
    expect(await moreLabels(boss.wrapper, 'v-e')).not.toContain('保留座位')
  })

  it('R4：已匿名化的已預繳列沒有保留／變更座位；SeatDialog 收到匿名化 409 提示並要求重讀', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    const info = vi.spyOn(ElMessage, 'info')
    const get = mockGet({
      '/admin/admissions/records': [
        visit({ id: 'v-x', has_deposit: true, stage: 'deposited', anonymized_at: '2026-09-25T02:00:00Z' }),
        visit({ id: 'v-1', has_deposit: true, stage: 'deposited' }),
      ],
    })
    mockPost({ '/admin/admissions/records/v-1/seat': () => { throw new ApiError(409, { code: 'RECRUITMENT_VISIT_ANONYMIZED' }) } })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    const labels = await moreLabels(wrapper, 'v-x')
    expect(labels).not.toContain('保留座位')
    expect(labels).not.toContain('變更座位')
    await chooseMore(wrapper, 'v-1', '保留座位')
    bodyButton('確認保留')!.click()
    await flushPromises()
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '這筆招生訪視已依保存政策匿名化，不能再變更' }))
    expect(info).not.toHaveBeenCalled()
    expect(pathsTo(get, '/admin/admissions/records?')).toHaveLength(2)
  })

  it('F2：SeatDialog 收到 404（別人剛刪掉）：提示、關閉並重讀，不顯示錯誤', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    const error = vi.spyOn(ElMessage, 'error')
    const get = mockGet({
      '/admin/admissions/records': [visit({ id: 'v-1', has_deposit: true, stage: 'deposited' })],
    })
    mockPost({ '/admin/admissions/records/v-1/seat': () => { throw new ApiError(404, { detail: 'not found' }) } })
    const { wrapper } = await mountWith(RecordsTab, { props: recordsProps })
    await chooseMore(wrapper, 'v-1', '保留座位')
    bodyButton('確認保留')!.click()
    await flushPromises()
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '這筆招生訪視已被刪除，已重新載入' }))
    expect(error).not.toHaveBeenCalled()
    expect(pathsTo(get, '/admin/admissions/records?')).toHaveLength(2)
  })
})
