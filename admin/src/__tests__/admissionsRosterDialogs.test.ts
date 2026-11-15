import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import ClassDialog from '../components/admissions/roster/ClassDialog.vue'
import DepositDialog from '../components/admissions/roster/DepositDialog.vue'
import DepositList from '../components/admissions/roster/DepositList.vue'
import RosterTab from '../components/admissions/roster/RosterTab.vue'
import StudentDialog from '../components/admissions/roster/StudentDialog.vue'
import { cleanup, mockGet, mockPatch, mockPost, mountWith, reception } from './admissionsTestKit'
import { klass, roster, student } from './rosterTestKit'

afterEach(cleanup)

const ROOT = '/admin/admissions/roster'
const body = () => document.body
const field = (label: string) => {
  const el = [...body().querySelectorAll('label')].find((l) => l.textContent!.trim().startsWith(label))
  return el?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea') ?? null
}
const checkbox = (label: string) => [...body().querySelectorAll<HTMLElement>('.el-checkbox')].find((c) => c.textContent!.trim() === label)
// 先找對話框裡的按鈕（頁面上也有同名的工具列按鈕，例如「新增班級」）。
const press = (text: string) => {
  const match = (b: HTMLElement) => b.textContent!.trim() === text
  return [...body().querySelectorAll<HTMLElement>('.el-dialog button')].find(match) ?? [...body().querySelectorAll<HTMLElement>('button')].find(match)
}
async function set(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null, value: string) {
  el!.value = value
  el!.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  await flushPromises()
}

describe('編輯資料', () => {
  const open = (kid: ReturnType<typeof student>, extra: Record<string, unknown> = {}) =>
    mountWith(StudentDialog, { props: { modelValue: true, student: kid, schoolYear: 115, ...extra } })

  it('在籍幼生：有入園日欄，沒有預定入園日與預繳日期', async () => {
    await open(student({ status: 'enrolled', class_id: 'c-1' }))
    expect(field('入園日')).not.toBeNull()
    expect(field('預定入園日')).toBeNull()
    expect(field('預繳日期')).toBeNull()
  })

  it('預繳幼生：填預定入園日後送出的 body 有 planned_entry_date，沒有 target_semester', async () => {
    const { wrapper } = await open(student({ status: 'pending', deposit_date: '2026-09-01', target_school_year: 115, target_semester: 1, version: 3 }))
    expect(field('入園日')).toBeNull()
    await set(field('預定入園日'), '2027-02-01')
    press('儲存')!.click()
    await flushPromises()
    const saved = wrapper.emitted('save')![0]![0] as Record<string, unknown>
    expect(saved).toEqual({ planned_entry_date: '2027-02-01' })
    expect(saved).not.toHaveProperty('target_semester')
  })

  it('只送有改的欄位；姓名清空不能儲存', async () => {
    const { wrapper } = await open(student({ child_name: '測試甲', status: 'enrolled', class_id: 'c-1' }))
    await set(field('備註'), '12或2')
    await set(field('幼生姓名'), '測試乙')
    press('儲存')!.click()
    await flushPromises()
    expect(wrapper.emitted('save')![0]![0]).toEqual({ child_name: '測試乙', note: '12或2' })
    await set(field('幼生姓名'), '  ')
    press('儲存')!.click()
    await flushPromises()
    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('有生日的幼幼班：不足齡勾選 disabled 且依 is_underage 打勾', async () => {
    await open(student({ grade: '幼幼班', class_id: 'c-1', birthday: '2024-10-01', is_underage: true }))
    const box = checkbox('不足齡')!
    expect(box.classList.contains('is-disabled')).toBe(true)
    expect(box.classList.contains('is-checked')).toBe(true)
  })

  it('沒生日的幼幼班可以手動勾不足齡；非幼幼班沒有這個選項；自動認定的新生不能手動改', async () => {
    const { wrapper } = await open(student({ grade: '幼幼班', class_id: 'c-1', birthday: null, is_underage: false, is_new: true }))
    expect(checkbox('不足齡')!.classList.contains('is-disabled')).toBe(false)
    expect(checkbox('新生')!.classList.contains('is-disabled')).toBe(true)
    checkbox('不足齡')!.querySelector('input')!.click()
    await flushPromises()
    press('儲存')!.click()
    await flushPromises()
    expect(wrapper.emitted('save')![0]![0]).toEqual({ underage_manual: true })
    cleanup()
    await open(student({ grade: '小班', class_id: 'c-1' }))
    expect(checkbox('不足齡')).toBeUndefined()
  })

  it('大班的下學年選項是 畢業／重讀大班，其他是 續讀／不讀', async () => {
    await open(student({ grade: '大班', class_id: 'c-1' }))
    expect([...field('下學年')!.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['畢業', '重讀大班'])
    cleanup()
    await open(student({ grade: '中班', class_id: 'c-1' }))
    expect([...field('下學年')!.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['續讀', '不讀'])
  })

  it('還沒編班的可以改班別與入學學期；入學 116 上的顯示 116 學年的班別', async () => {
    const { wrapper } = await open(student({ status: 'pending', class_id: null, grade: '小班', deposit_date: '2026-09-01', target_school_year: 115, target_semester: 1 }))
    await set(field('班別'), '中班')
    await set(field('入學學期'), '115-2')
    press('儲存')!.click()
    await flushPromises()
    expect(wrapper.emitted('save')![0]![0]).toEqual({ grade: '中班', target_semester: 2 })
    cleanup()
    await open(student({ status: 'pending', class_id: null, grade: '小班', deposit_date: '2026-09-01', target_school_year: 116, target_semester: 1 }))
    expect(field('116 學年的班別')).not.toBeNull()
    expect(field('入學學期')).toBeNull()
  })
})

describe('補登預繳', () => {
  const open = () => mountWith(DepositDialog, { props: { modelValue: true, schoolYear: 115, today: '2026-11-15' } })

  it('三行姓名時生日欄 disabled；送出 names 三筆與 pending 欄位', async () => {
    const { wrapper } = await open()
    await set(field('姓名')!, '測試甲\n測試乙\n測試丙')
    expect(field('生日')!.disabled).toBe(true)
    await set(field('班別'), '小班')
    press('補登')!.click()
    await flushPromises()
    expect(wrapper.emitted('save')![0]![0]).toEqual({
      school_year: 115,
      names: ['測試甲', '測試乙', '測試丙'],
      pending: { grade: '小班', target_school_year: 115, target_semester: 1, deposit_date: '2026-11-15' },
    })
  })

  it('一行姓名可以填生日；預定入園日選填', async () => {
    const { wrapper } = await open()
    await set(field('姓名')!, '測試甲')
    expect(field('生日')!.disabled).toBe(false)
    await set(field('生日'), '2023-05-01')
    await set(field('班別'), '幼幼班')
    await set(field('預定入園日'), '2027-02-01')
    press('補登')!.click()
    await flushPromises()
    expect((wrapper.emitted('save')![0]![0] as { pending: unknown }).pending).toMatchObject({ birthday: '2023-05-01', planned_entry_date: '2027-02-01' })
  })

  it('補登 116 上：入學學年是 schoolYear+1、上學期', async () => {
    const { wrapper } = await open()
    await set(field('姓名')!, '測試甲')
    await set(field('班別'), '小班')
    ;[...body().querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.value === '116-1')!.click()
    await flushPromises()
    press('補登')!.click()
    await flushPromises()
    expect((wrapper.emitted('save')![0]![0] as { pending: unknown }).pending).toMatchObject({ target_school_year: 116, target_semester: 1 })
  })

  it('沒填姓名或班別不送出', async () => {
    const { wrapper } = await open()
    press('補登')!.click()
    await flushPromises()
    expect(wrapper.emitted('save')).toBeUndefined()
  })
})

describe('班級對話框', () => {
  it('新增班級送出的欄位', async () => {
    const { wrapper } = await mountWith(ClassDialog, { props: { modelValue: true, schoolYear: 115, room: null, memberCount: 0 } })
    await set(field('年級'), '中班')
    await set(field('班序'), '中1')
    await set(field('班級名稱'), '中一班')
    await set(field('英文班名'), 'Fox')
    await set(field('班導'), '王老師')
    await set(field('目標人數'), '22')
    press('新增班級')!.click()
    await flushPromises()
    expect(wrapper.emitted('save')![0]![0]).toEqual({
      school_year: 115, grade: '中班', name: '中一班', class_code: '中1', english_name: 'Fox', head_teacher: '王老師', target_seats: 22,
    })
  })

  it('修改時年級 disabled，只送有改的欄位；班上有人不顯示刪除', async () => {
    const room = klass({ id: 'c-1', grade: '大班', class_code: '大1', name: '大一班', target_seats: 20 })
    const { wrapper } = await mountWith(ClassDialog, { props: { modelValue: true, schoolYear: 115, room, memberCount: 3 } })
    expect(field('年級')!.disabled).toBe(true)
    expect(press('刪除班級')).toBeUndefined()
    await set(field('目標人數'), '')
    press('儲存')!.click()
    await flushPromises()
    expect(wrapper.emitted('save')![0]![0]).toEqual({ target_seats: null })
    cleanup()
    const empty = await mountWith(ClassDialog, { props: { modelValue: true, schoolYear: 115, room, memberCount: 0 } })
    press('刪除班級')!.click()
    await flushPromises()
    expect(empty.wrapper.emitted('delete')).toHaveLength(1)
  })
})

describe('預繳名單', () => {
  function pendingData() {
    const placed = student({ id: 'p1', child_name: '甲', status: 'pending', grade: '小班', deposit_date: '2026-09-01', target_school_year: 115, target_semester: 1 })
    const toddler = student({ id: 'p2', child_name: '乙', status: 'pending', grade: '幼幼班', is_underage: true, deposit_date: '2026-10-05', target_school_year: 115, target_semester: 2 })
    const next = student({ id: 'p3', child_name: '丙', status: 'pending', grade: '小班', deposit_date: '2026-10-09', target_school_year: 116, target_semester: 1 })
    const left = student({ id: 'g1', child_name: '丁', status: 'left', grade: '中班', left_date: '2026-10-03' })
    const refunded = student({ id: 'g2', child_name: '戊', status: 'refunded', grade: '小班', refunded_date: '2026-10-12' })
    return roster({
      classes: [klass({ id: 'cA', class_code: '小1', grade: '小班', students: [placed] })],
      unassigned: [toddler],
      next_year: [next],
      gone: [left, refunded],
    })
  }

  it('三組的人數與分欄', async () => {
    const { wrapper } = await mountWith(DepositList, { props: { roster: pendingData(), canWrite: true } })
    const groups = wrapper.findAll('.roster-dep')
    expect(groups.map((g) => g.find('.roster-dep__head').text().replace(/\s+/g, ''))).toEqual([
      expect.stringContaining('115上預繳'),
      expect.stringContaining('115下預繳'),
      expect.stringContaining('116上預繳'),
    ])
    expect(groups[0]!.find('.roster-dep__head').text()).toContain('共 1 人')
    const cols = groups[1]!.findAll('.roster-dep__col')
    expect(cols.map((c) => c.find('h4').text().replace(/\s+/g, ''))).toEqual(['大班0', '中班0', '小班0', '幼幼班1'])
    expect(cols[3]!.text()).toContain('乙')
    expect(cols[3]!.text()).toContain('不足齡')
    expect(cols[3]!.text()).toContain('未編班')
    expect(groups[0]!.text()).toContain('小1')
    expect(groups[2]!.text()).toContain('丙')
    expect(groups[2]!.text()).not.toContain('未編班')
  })

  it('缺入學學期的預繳生也列出來，不會不見', async () => {
    const lost = student({ id: 'p9', child_name: '己', status: 'pending', grade: null, target_school_year: null, target_semester: null })
    const { wrapper } = await mountWith(DepositList, { props: { roster: roster({ unassigned: [lost] }), canWrite: true } })
    expect(wrapper.text()).toContain('缺入學學期')
    expect(wrapper.text()).toContain('己')
  })

  it('已退預繳按恢復；已離園要先選班', async () => {
    const { wrapper } = await mountWith(DepositList, { props: { roster: pendingData(), canWrite: true } })
    const items = wrapper.findAll('.roster-gone li')
    expect(wrapper.get('.roster-gone summary').text()).toBe('已離園、已退預繳（2）')
    const refunded = items.find((li) => li.text().includes('戊'))!
    await refunded.get('button').trigger('click')
    expect(wrapper.emitted('restore')![0]).toEqual([expect.objectContaining({ id: 'g2' }), null])
    const left = items.find((li) => li.text().includes('丁'))!
    expect(left.get('button').attributes('disabled')).toBeDefined()
    await left.get('select').setValue('cA')
    await left.get('button').trigger('click')
    expect(wrapper.emitted('restore')![1]).toEqual([expect.objectContaining({ id: 'g1' }), 'cA'])
  })

  it('點姓名開選單；沒有寫入權限就沒有補登與恢復', async () => {
    const { wrapper } = await mountWith(DepositList, { props: { roster: pendingData(), canWrite: false } })
    await wrapper.get('button[data-student-id="p1"]').trigger('click')
    expect(wrapper.emitted('open-student')![0]![0]).toBe('p1')
    expect(wrapper.text()).not.toContain('補登預繳')
    expect(wrapper.find('.roster-gone button').exists()).toBe(false)
  })
})

describe('分頁整合', () => {
  async function mountTab() {
    let current = roster({
      classes: [klass({ id: 'cA', students: [student({ id: 'a1', child_name: '甲', status: 'pending', deposit_date: '2026-09-01', target_school_year: 115, target_semester: 1 })] })],
      unassigned: [student({ id: 'u1', child_name: '乙', status: 'pending', target_school_year: 115, target_semester: 2 })],
    })
    const get = mockGet({ [ROOT]: () => current })
    const mounted = await mountWith(RosterTab, { props: { campusKey: 'yihua', schoolYear: 115 }, user: reception() })
    return { ...mounted, get, setRoster: (next: typeof current) => { current = next } }
  }

  it('兩個切換鈕：編班表、預繳名單 n（所有預繳未入園）', async () => {
    const { wrapper } = await mountTab()
    const switches = wrapper.findAll('.roster-switch button').map((b) => b.text().replace(/\s+/g, ''))
    expect(switches).toEqual(['編班表', '預繳名單2'])
    expect(wrapper.find('table.roster-table').exists()).toBe(true)
    await wrapper.findAll('.roster-switch button')[1]!.trigger('click')
    expect(wrapper.find('table.roster-table').exists()).toBe(false)
    expect(wrapper.find('.roster-dep').exists()).toBe(true)
  })

  it('點備註欄開編輯資料，儲存時帶版本號、只送有改的欄位，之後重讀', async () => {
    const { wrapper, get } = await mountTab()
    const patch = mockPatch({ [`${ROOT}/students/a1`]: {} })
    await wrapper.get('td.roster-note[data-index="0"]').trigger('click')
    await flushPromises()
    await set(field('備註'), '12或2')
    const before = get.mock.calls.length
    press('儲存')!.click()
    await flushPromises()
    expect(patch).toHaveBeenCalledWith(`${ROOT}/students/a1`, { note: '12或2', expected_version: 1 })
    expect(get.mock.calls.length).toBeGreaterThan(before)
  })

  it('補登預繳送出後重讀，同名提醒', async () => {
    const { wrapper } = await mountTab()
    const post = mockPost({ [`${ROOT}/students`]: { students: [], duplicates: [] } })
    await wrapper.findAll('.roster-switch button')[1]!.trigger('click')
    ;[...wrapper.findAll('button')].find((b) => b.text() === '補登預繳')!.trigger('click')
    await flushPromises()
    await set(field('姓名')!, '測試甲')
    await set(field('班別'), '小班')
    press('補登')!.click()
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`${ROOT}/students?campus_key=yihua`, expect.objectContaining({ names: ['測試甲'], school_year: 115 }))
  })

  it('新增班級與修改班級', async () => {
    const { wrapper } = await mountTab()
    const post = mockPost({ [`${ROOT}/classes`]: {} })
    const patch = mockPatch({ [`${ROOT}/classes/cA`]: {} })
    ;[...wrapper.findAll('button')].find((b) => b.text() === '新增班級')!.trigger('click')
    await flushPromises()
    await set(field('班序'), '大9')
    await set(field('班級名稱'), '大九班')
    press('新增班級')!.click()
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`${ROOT}/classes?campus_key=yihua`, expect.objectContaining({ class_code: '大9', school_year: 115 }))
    await wrapper.get('th[data-class-id="cA"]').trigger('click')
    await flushPromises()
    await set(field('班導'), '王老師')
    press('儲存')!.click()
    await flushPromises()
    expect(patch).toHaveBeenCalledWith(`${ROOT}/classes/cA`, { head_teacher: '王老師', expected_version: 1 })
  })

  it('刪除班級要先確認', async () => {
    const { wrapper } = await mountTab()
    // 班上沒人的班才能刪：換成空班
    cleanup()
    const get = mockGet({ [ROOT]: roster({ classes: [klass({ id: 'cE', students: [] })] }) })
    void get
    const del = vi.spyOn((await import('../api/client')).api, 'delete').mockResolvedValue(undefined as never)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const again = await mountWith(RosterTab, { props: { campusKey: 'yihua', schoolYear: 115 }, user: reception() })
    await again.wrapper.get('th[data-class-id="cE"]').trigger('click')
    await flushPromises()
    press('刪除班級')!.click()
    await flushPromises()
    expect(confirm).toHaveBeenCalled()
    expect(del).toHaveBeenCalledWith(`${ROOT}/classes/cE?expected_version=1`)
    void wrapper
  })
})
