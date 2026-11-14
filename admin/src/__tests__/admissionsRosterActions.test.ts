import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ApiError } from '../api/client'
import type { Roster, RosterStudent } from '../api/roster'
import RosterTab from '../components/admissions/roster/RosterTab.vue'
import { cleanup, mockGet, mockPost, mountWith, pathsTo, reception } from './admissionsTestKit'
import { klass, roster, student } from './rosterTestKit'

afterEach(cleanup)

const ROOT = '/admin/admissions/roster'

async function mountRoster(initial: Roster) {
  let current = initial
  const get = mockGet({ [ROOT]: () => current })
  const { wrapper } = await mountWith(RosterTab, { props: { campusKey: 'yihua', schoolYear: 115 }, user: reception() })
  return { wrapper, get, setRoster: (next: Roster) => { current = next } }
}

// ElMessage 的參數型別是 string | VNode | options；這裡的提示一律是 { message } 物件。
const messageOf = (call: unknown[] | undefined) => String((call?.[0] as { message: unknown }).message)
const dataTransfer = () => ({ setData: vi.fn(), effectAllowed: '', dropEffect: '' })
const kid = (wrapper: VueWrapper, id: string) => wrapper.get(`button.roster-kid[data-student-id="${id}"]`)
const cell = (wrapper: VueWrapper, classId: string, index: number) => wrapper.get(`td.roster-name[data-class-id="${classId}"][data-index="${index}"]`)

function twoClasses() {
  const a = student({ child_name: '甲', id: 'a1' })
  const b = student({ child_name: '乙', id: 'a2' })
  const x = student({ child_name: '戊', id: 'b1' })
  const classA = klass({ id: 'cA', students: [a, b] })
  const classB = klass({ id: 'cB', students: [x] })
  return { a, b, x, classA, classB, data: roster({ classes: [classA, classB] }) }
}

describe('格內新增', () => {
  it('Enter 新增一位後輸入框移到下一格', async () => {
    const first = student({ child_name: '甲', id: 'a1' })
    const room = klass({ id: 'cA', students: [first] })
    const { wrapper, setRoster } = await mountRoster(roster({ classes: [room] }))
    const post = mockPost({
      [`${ROOT}/students`]: () => {
        setRoster(roster({ classes: [klass({ id: 'cA', students: [first, student({ child_name: '測試甲' })] })] }))
        return { students: [], duplicates: [] }
      },
    })
    await cell(wrapper, 'cA', 1).trigger('click')
    const input = wrapper.get('input.roster-cell-input')
    await input.setValue('測試甲')
    await input.trigger('keydown.enter')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`${ROOT}/students?campus_key=yihua`, { school_year: 115, names: ['測試甲'], class_id: 'cA' })
    const next = wrapper.get('input.roster-cell-input')
    expect(next.element.closest('td')!.getAttribute('data-index')).toBe('2')
    expect((next.element as HTMLInputElement).value).toBe('')
  })

  it('貼上三行文字呼叫一次 createStudents，names 是三筆', async () => {
    const room = klass({ id: 'cA', students: [] })
    const { wrapper } = await mountRoster(roster({ classes: [room] }))
    const post = mockPost({ [`${ROOT}/students`]: { students: [], duplicates: [] } })
    await cell(wrapper, 'cA', 0).trigger('click')
    await wrapper.get('input.roster-cell-input').trigger('paste', { clipboardData: { getData: () => '測試甲\n測試乙\r\n測試丙\n' } })
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
    expect((post.mock.calls[0]![1] as { names: string[] }).names).toEqual(['測試甲', '測試乙', '測試丙'])
  })

  it('回應有 duplicates 時顯示同名提醒', async () => {
    const { wrapper } = await mountRoster(roster({ classes: [klass({ id: 'cA', students: [] })] }))
    mockPost({ [`${ROOT}/students`]: { students: [], duplicates: ['測試甲', '測試乙'] } })
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue(undefined as never)
    await cell(wrapper, 'cA', 0).trigger('click')
    const input = wrapper.get('input.roster-cell-input')
    await input.setValue('測試甲')
    await input.trigger('keydown.enter')
    await flushPromises()
    expect(messageOf(warning.mock.calls[0])).toBe('已有同名幼生：測試甲、測試乙')
  })

  it('Esc 收起輸入框；空白失焦也收起', async () => {
    const { wrapper } = await mountRoster(roster({ classes: [klass({ id: 'cA', students: [] })] }))
    await cell(wrapper, 'cA', 0).trigger('click')
    await wrapper.get('input.roster-cell-input').trigger('keydown.esc')
    expect(wrapper.find('input.roster-cell-input').exists()).toBe(false)
    await cell(wrapper, 'cA', 0).trigger('click')
    await wrapper.get('input.roster-cell-input').trigger('blur')
    expect(wrapper.find('input.roster-cell-input').exists()).toBe(false)
  })
})

describe('拖拉', () => {
  it('拖到別班第 2 列：moveStudent(id, 目的班, 1)', async () => {
    const { a, classB, data } = twoClasses()
    const { wrapper } = await mountRoster(data)
    const post = mockPost({ [`${ROOT}/students/a1/move`]: { ...a, version: 2 } })
    await kid(wrapper, 'a1').trigger('dragstart', { dataTransfer: dataTransfer() })
    await cell(wrapper, classB.id, 1).trigger('drop')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`${ROOT}/students/a1/move`, { class_id: 'cB', position: 1, expected_version: 1 })
  })

  it('拖到班級表頭：position 是該班人數', async () => {
    const { classA, data } = twoClasses()
    const { wrapper } = await mountRoster(data)
    const post = mockPost({ [`${ROOT}/students/b1/move`]: {} })
    await kid(wrapper, 'b1').trigger('dragstart', { dataTransfer: dataTransfer() })
    await wrapper.get(`th[data-class-id="${classA.id}"]`).trigger('drop')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`${ROOT}/students/b1/move`, { class_id: 'cA', position: 2, expected_version: 1 })
  })

  it('預繳未入園的可以拖回還沒編班', async () => {
    const pending = student({ id: 'p1', child_name: '丙', status: 'pending' })
    const { wrapper } = await mountRoster(roster({ classes: [klass({ id: 'cA', students: [pending] })] }))
    const post = mockPost({ [`${ROOT}/students/p1/move`]: {} })
    await kid(wrapper, 'p1').trigger('dragstart', { dataTransfer: dataTransfer() })
    await wrapper.get('[data-roster-tray]').trigger('drop')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`${ROOT}/students/p1/move`, { class_id: null, position: 0, expected_version: 1 })
  })

  it('在籍幼生拖到還沒編班：不呼叫 API，顯示提示', async () => {
    const { wrapper } = await mountRoster(twoClasses().data)
    const post = mockPost()
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue(undefined as never)
    await kid(wrapper, 'a1').trigger('dragstart', { dataTransfer: dataTransfer() })
    await wrapper.get('[data-roster-tray]').trigger('drop')
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
    expect(messageOf(warning.mock.calls[0])).toBe('在籍幼生不能放回還沒編班，要離園請點姓名')
  })

  it('復原：再呼叫 moveStudent 回原班原位置', async () => {
    const { a, classB, data } = twoClasses()
    const { wrapper } = await mountRoster(data)
    const post = mockPost({ [`${ROOT}/students/a1/move`]: { ...a, version: 2 } })
    await kid(wrapper, 'a1').trigger('dragstart', { dataTransfer: dataTransfer() })
    await cell(wrapper, classB.id, 0).trigger('drop')
    await flushPromises()
    const undo = document.body.querySelector<HTMLElement>('.el-message .roster-undo')!
    expect(undo.textContent).toBe('復原')
    undo.click()
    await flushPromises()
    expect(post).toHaveBeenLastCalledWith(`${ROOT}/students/a1/move`, { class_id: 'cA', position: 0, expected_version: 2 })
  })

  it('版本衝突：顯示提示並重新載入', async () => {
    const { classB, data } = twoClasses()
    const { wrapper, get } = await mountRoster(data)
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue(undefined as never)
    vi.spyOn((await import('../api/client')).api, 'post').mockRejectedValue(new ApiError(409, { code: 'ROSTER_VERSION_CONFLICT', current_version: 3 }))
    const before = pathsTo(get, ROOT).length
    await kid(wrapper, 'a1').trigger('dragstart', { dataTransfer: dataTransfer() })
    await cell(wrapper, classB.id, 0).trigger('drop')
    await flushPromises()
    expect(messageOf(warning.mock.calls[0])).toBe('資料剛被其他人更新，已重新載入')
    expect(pathsTo(get, ROOT).length).toBe(before + 1)
  })
})

describe('幼生選單', () => {
  const menuButtons = () => [...document.body.querySelectorAll('[role="menu"] button')].map((b) => b.textContent!.trim())

  async function openMenu(wrapper: VueWrapper, id: string) {
    await kid(wrapper, id).trigger('click')
    await flushPromises()
  }

  it('預繳且已編班才有「已入園」；預繳顯示「退預繳」、在籍顯示「離園」', async () => {
    const placed: RosterStudent = student({ id: 'p1', child_name: '丙', status: 'pending', deposit_date: '2026-09-01' })
    const enrolled = student({ id: 'e1', child_name: '甲' })
    const loose = student({ id: 'u1', child_name: '丁', status: 'pending' })
    const { wrapper } = await mountRoster(roster({ classes: [klass({ id: 'cA', students: [enrolled, placed] })], unassigned: [loose] }))
    await openMenu(wrapper, 'p1')
    expect(menuButtons()).toEqual(['已入園', '編輯資料', '退預繳'])
    expect(document.body.textContent).toContain('預繳日期：115.09.01')
    await openMenu(wrapper, 'e1')
    expect(menuButtons()).toEqual(['編輯資料', '離園'])
    await wrapper.get('button.roster-chip[data-student-id="u1"]').trigger('click')
    await flushPromises()
    expect(menuButtons()).toEqual(['編輯資料', '退預繳'])
  })

  it('移到其他班級：選單的下拉選一個班，排在那班最後', async () => {
    const { b, classB, data } = twoClasses()
    const { wrapper } = await mountRoster(data)
    const post = mockPost({ [`${ROOT}/students/a2/move`]: {} })
    await openMenu(wrapper, 'a2')
    const select = document.body.querySelector<HTMLSelectElement>('[role="menu"] select')!
    select.value = classB.id
    select.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`${ROOT}/students/a2/move`, { class_id: 'cB', position: 1, expected_version: b.version })
  })

  it('已入園：不用確認，直接送出', async () => {
    const placed = student({ id: 'p1', status: 'pending', deposit_date: '2026-09-01' })
    const { wrapper } = await mountRoster(roster({ classes: [klass({ id: 'cA', students: [placed] })] }))
    const post = mockPost({ [`${ROOT}/students/p1/enter`]: {} })
    await openMenu(wrapper, 'p1')
    ;[...document.body.querySelectorAll<HTMLElement>('[role="menu"] button')].find((b) => b.textContent!.trim() === '已入園')!.click()
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`${ROOT}/students/p1/enter`, { expected_version: 1, enrollment_date: null })
  })

  it('離園要先確認，取消就不呼叫 API', async () => {
    const { wrapper } = await mountRoster(twoClasses().data)
    const post = mockPost({ [`${ROOT}/students/a1/leave`]: {} })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel' as never).mockResolvedValueOnce('confirm' as never)
    const leave = () => [...document.body.querySelectorAll<HTMLElement>('[role="menu"] button')].find((b) => b.textContent!.trim() === '離園')!
    await openMenu(wrapper, 'a1')
    leave().click()
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(post).not.toHaveBeenCalled()
    await openMenu(wrapper, 'a1')
    leave().click()
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`${ROOT}/students/a1/leave`, { expected_version: 1, left_date: null })
  })

  it('退預繳要先確認', async () => {
    const placed = student({ id: 'p1', status: 'pending', deposit_date: '2026-09-01' })
    const { wrapper } = await mountRoster(roster({ classes: [klass({ id: 'cA', students: [placed] })] }))
    const post = mockPost({ [`${ROOT}/students/p1/refund`]: {} })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    await openMenu(wrapper, 'p1')
    ;[...document.body.querySelectorAll<HTMLElement>('[role="menu"] button')].find((b) => b.textContent!.trim() === '退預繳')!.click()
    await flushPromises()
    expect(String(confirm.mock.calls[0]![1])).toContain('退預繳')
    expect(post).toHaveBeenCalledWith(`${ROOT}/students/p1/refund`, { expected_version: 1, refunded_date: null })
  })
})
