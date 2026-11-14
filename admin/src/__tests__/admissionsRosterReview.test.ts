import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api/client'
import { sideParts } from '../admissions/roster'
import DepositDialog from '../components/admissions/roster/DepositDialog.vue'
import GapTable from '../components/admissions/roster/GapTable.vue'
import RosterTab from '../components/admissions/roster/RosterTab.vue'
import StudentDialog from '../components/admissions/roster/StudentDialog.vue'
import { cleanup, mockGet, mockPost, mountWith, pathsTo, reception } from './admissionsTestKit'
import { klass, roster, student } from './rosterTestKit'

afterEach(cleanup)

const ROOT = '/admin/admissions/roster'
const body = () => document.body
const field = (label: string) =>
  [...body().querySelectorAll('label')].find((l) => l.textContent!.trim().startsWith(label))?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea') ?? null
const press = (text: string) => {
  const match = (b: HTMLElement) => b.textContent!.trim() === text
  return [...body().querySelectorAll<HTMLElement>('.el-dialog button')].find(match) ?? [...body().querySelectorAll<HTMLElement>('button')].find(match)
}
async function set(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null, value: string) {
  el!.value = value
  el!.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  await flushPromises()
}

describe('審查修正', () => {
  it('I2：統計日期被後端擋下後，統計日期還原，之後的重讀不再帶那個日期', async () => {
    const get = mockGet({ [ROOT]: () => roster({ classes: [klass({ students: [student()] })] }) })
    const { wrapper } = await mountWith(RosterTab, { props: { campusKey: 'yihua', schoolYear: 115 }, user: reception() })
    vi.spyOn(ElMessage, 'error').mockReturnValue(undefined as never)
    get.mockRejectedValueOnce(new ApiError(422, { code: 'ROSTER_AS_OF_OUT_OF_RANGE', message: '統計日期不合規定' }))
    await wrapper.get('input[type="date"]').setValue('2025-03-15')
    await flushPromises()
    expect(pathsTo(get, ROOT).at(-1)).toContain('as_of=2025-03-15')
    await (wrapper.vm as unknown as { reload: () => Promise<void> }).reload()
    expect(pathsTo(get, ROOT).at(-1)).not.toContain('as_of')
  })

  it('I4：缺入學學期的預繳生標「缺入學學期」，已排進班級也能補學期', async () => {
    const lost = student({ status: 'pending', class_id: 'c-1', grade: '小班', target_school_year: null, target_semester: null, deposit_date: '2026-09-01' })
    expect(sideParts(lost, '小班', '2026-11-15', 115).labels).toContain('缺入學學期')
    const complete = student({ status: 'pending', target_school_year: 115, target_semester: 1 })
    expect(sideParts(complete, '小班', '2026-11-15', 115).labels).not.toContain('缺入學學期')
    await mountWith(StudentDialog, { props: { modelValue: true, student: lost, schoolYear: 115 } })
    expect(field('入學學期')).not.toBeNull()
  })

  it('I6：補登預繳送出原始行（含空白行）讓後端的行號對得上；超過 60 行先擋', async () => {
    const { wrapper } = await mountWith(DepositDialog, { props: { modelValue: true, schoolYear: 115, today: '2026-11-15' } })
    await set(field('姓名'), '測試甲\n\n測試乙')
    await set(field('班別'), '小班')
    press('補登')!.click()
    await flushPromises()
    expect((wrapper.emitted('save')![0]![0] as { names: string[] }).names).toEqual(['測試甲', '', '測試乙'])
    await set(field('姓名'), Array.from({ length: 61 }, (_, i) => `測試${i}`).join('\n'))
    press('補登')!.click()
    await flushPromises()
    expect(wrapper.emitted('save')).toHaveLength(1)
    expect(body().textContent).toContain('一次最多 60 行')
  })

  it('I6：補登預繳失敗時對話框留著、貼上的內容還在', async () => {
    mockGet({ [ROOT]: () => roster({ classes: [klass({ students: [student()] })] }) })
    const { wrapper } = await mountWith(RosterTab, { props: { campusKey: 'yihua', schoolYear: 115 }, user: reception() })
    vi.spyOn(ElMessage, 'error').mockReturnValue(undefined as never)
    mockPost({})
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, { code: 'ROSTER_NAME_TOO_LONG', message: '第 12 行的姓名超過 50 個字', line: 12 }))
    await wrapper.findAll('.roster-switch button')[1]!.trigger('click')
    ;[...wrapper.findAll('button')].find((b) => b.text() === '補登預繳')!.trigger('click')
    await flushPromises()
    await set(field('姓名'), '測試甲\n測試乙')
    await set(field('班別'), '小班')
    press('補登')!.click()
    await flushPromises()
    expect(field('姓名')!.value).toBe('測試甲\n測試乙')
    const overlay = [...body().querySelectorAll<HTMLElement>('.el-overlay')].find((o) => o.textContent!.includes('補登預繳'))!
    expect(overlay.style.display).not.toBe('none')
  })

  it('學年已結束：最晚日期是學年最後一天，按鈕寫學年最後一天；還沒開學：只能選開學日', async () => {
    const past = await mountWith(GapTable, { props: { roster: roster({ today: '2027-09-01', as_of: '2027-07-31' }), canWrite: true } })
    expect(past.wrapper.get('input[type="date"]').attributes('max')).toBe('2027-07-31')
    const reset = past.wrapper.findAll('button').find((b) => b.text() === '學年最後一天')!
    await reset.trigger('click')
    expect(past.wrapper.emitted('change-as-of')![0]).toEqual(['2027-07-31'])
    cleanup()
    const future = await mountWith(GapTable, { props: { roster: roster({ school_year: 118, today: '2026-11-15', as_of: '2029-08-01' }), canWrite: true } })
    expect(future.wrapper.get('input[type="date"]').attributes('max')).toBe('2029-08-01')
    expect(future.wrapper.findAll('button').map((b) => b.text())).toContain('開學日')
  })
})
