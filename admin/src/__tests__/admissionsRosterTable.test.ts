import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import AdmissionsView from '../views/AdmissionsView.vue'
import RosterTab from '../components/admissions/roster/RosterTab.vue'
import RosterTable from '../components/admissions/roster/RosterTable.vue'
import { cleanup, mockGet, mountWith, options, reception, admissionsViewer } from './admissionsTestKit'
import { klass, roster, student } from './rosterTestKit'

afterEach(cleanup)

function mountTable(data = roster(), canWrite = true) {
  return mountWith(RosterTable, { props: { roster: data, canWrite } })
}

// 靜態匯入讓 lazyComponent 的動態 import 直接命中快取（同 admissionsView.test.ts 的 RecordsTab）。
void RosterTab

describe('編班與缺額分頁', () => {
  it('網址 tab=roster 顯示編班與缺額分頁，學期選單隱藏', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T09:00:00+08:00'))
    mockGet({ '/admin/admissions/options': options(), '/admin/admissions/roster': roster({ classes: [klass()] }) })
    const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?tab=roster' })
    await flushPromises()
    expect(wrapper.find('.el-tabs__item.is-active').text()).toBe('編班與缺額')
    expect(wrapper.text()).toContain('入學學年')
    expect(wrapper.text()).not.toContain('入學學期')
    expect(wrapper.find('table.roster-table').exists()).toBe(true)
  })

  it('不限學年時請先選一個學年', async () => {
    mockGet({ '/admin/admissions/options': options() })
    const { wrapper } = await mountWith(AdmissionsView, { path: '/admissions?tab=roster&sy=all' })
    await flushPromises()
    expect(wrapper.text()).toContain('請先選一個學年')
    expect(wrapper.find('table.roster-table').exists()).toBe(false)
  })
})

describe('編班表', () => {
  it('表頭四列：班級、班導、副班導、美師；年級順序大中小幼', async () => {
    const data = roster({
      classes: [
        klass({ grade: '幼幼班', class_code: '幼1', name: '幼幼一班', head_teacher: '王老師' }),
        klass({ grade: '大班', class_code: '大1', name: '大一班', english_name: 'Lion', assistant_teacher: '李老師', english_teacher: 'Amy' }),
      ].reverse(),
    })
    const { wrapper } = await mountTable(data)
    const heads = wrapper.findAll('thead tr').map((row) => row.find('th').text())
    expect(heads).toEqual(['班級', '班導', '副班導', '美師'])
    const classRow = wrapper.findAll('thead tr')[0]!
    expect(classRow.findAll('th[data-class-id]').map((th) => th.text())).toEqual(['大一班(大1)Lion', '幼幼一班(幼1)'])
    expect(wrapper.findAll('thead tr')[1]!.text()).toContain('王老師')
    expect(wrapper.findAll('thead tr')[3]!.text()).toContain('Amy')
    expect(classRow.text()).toContain('116/8月')
  })

  it('列數至少 31，某班 35 人時是 36 列', async () => {
    const few = await mountTable(roster({ classes: [klass({ students: [student()] })] }))
    expect(few.wrapper.findAll('tbody tr')).toHaveLength(31)
    const many = await mountTable(roster({ classes: [klass({ students: Array.from({ length: 35 }, () => student()) })] }))
    expect(many.wrapper.findAll('tbody tr')).toHaveLength(36)
  })

  it('姓名字色 class 依 markOf；預繳未入園的兩格有 is-pending', async () => {
    const data = roster({
      classes: [klass({ students: [
        student({ child_name: '甲', is_underage: true, is_special_education: true }),
        student({ child_name: '乙', is_special_education: true }),
        student({ child_name: '丙', is_indigenous: true }),
        student({ child_name: '丁', is_new: true }),
        student({ child_name: '戊' }),
        student({ child_name: '己', status: 'pending', planned_entry_date: '2026-12-01' }),
      ] })],
    })
    const { wrapper } = await mountTable(data)
    const kid = (name: string) => wrapper.findAll('button.roster-kid').find((b) => b.text() === name)!
    expect(kid('甲').classes()).toContain('is-mark-underage')
    expect(kid('乙').classes()).toContain('is-mark-sped')
    expect(kid('丙').classes()).toContain('is-mark-indigenous')
    expect(kid('丁').classes()).toContain('is-mark-new')
    expect(kid('戊').classes().some((c) => c.startsWith('is-mark-'))).toBe(false)
    const cell = kid('己').element.closest('td')!
    expect(cell.classList.contains('is-pending')).toBe(true)
    expect(cell.nextElementSibling!.classList.contains('is-pending')).toBe(true)
    expect(kid('戊').element.closest('td')!.classList.contains('is-pending')).toBe(false)
  })

  it('備註欄顯示 sideParts 的文字與小標記', async () => {
    const data = roster({
      classes: [klass({ grade: '幼幼班', students: [
        student({ child_name: '甲', status: 'pending', planned_entry_date: '2026-12-01', target_school_year: 115, target_semester: 1, is_underage: true, is_special_education: true }),
        student({ child_name: '乙', birthday: null, is_underage: false }),
      ] })],
    })
    const { wrapper } = await mountTable(data)
    const note = (index: number) => wrapper.find(`td.roster-note[data-index="${index}"]`)
    expect(note(0).text()).toBe('12/1不足齡特教')
    expect(note(1).text()).toBe('缺生日')
  })

  it('表尾：各班合計、目標輸入框、缺額文字、年級總計含舊生新生、全園總計含還沒編班人數', async () => {
    const data = roster({
      classes: [
        klass({ grade: '大班', target_seats: 2, gap: 0, students: [student({ is_new: false }), student({ is_new: true })] }),
        klass({ grade: '中班', target_seats: 5, gap: -4, students: [student({ status: 'pending', is_new: true })] }),
        klass({ grade: '小班', students: [] }),
      ],
      unassigned: [student({ status: 'pending' }), student({ status: 'pending' })],
    })
    const { wrapper } = await mountTable(data)
    const foot = wrapper.find('tfoot')
    const rows = foot.findAll('tr').map((row) => row.text().replace(/\s+/g, ''))
    expect(rows[0]).toBe('合計2100')
    expect(rows[2]).toBe('缺額額滿−4—')
    expect(rows[3]).toContain('舊生1、新生1')
    expect(rows[3]).toContain('舊生0、新生1（其中還沒入園1）')
    expect(rows[4]).toContain('3')
    expect(rows[4]).toContain('另有2位預繳生還沒編班')
    const inputs = foot.findAll('input')
    expect(inputs.map((i) => (i.element as HTMLInputElement).value)).toEqual(['2', '5', ''])
  })

  it('最右欄寫成 姓名(幼)，不可拖拉', async () => {
    const data = roster({ next_year: [student({ child_name: '丙', status: 'pending', grade: '幼幼班' }), student({ child_name: '丁', status: 'pending', grade: '小班' })] })
    const { wrapper } = await mountTable(data)
    const next = wrapper.findAll('.roster-next [data-student-id]')
    expect(next.map((n) => n.text())).toEqual(['丙(幼)', '丁(小)'])
    expect(next.every((n) => n.attributes('draggable') !== 'true')).toBe(true)
  })

  it('還沒編班的預繳生列出姓名、班別、入園時段；缺年級的標缺班別、缺入學學期的標缺入學學期', async () => {
    const data = roster({
      unassigned: [
        student({ child_name: '甲', status: 'pending', grade: '小班', target_school_year: 115, target_semester: 1 }),
        student({ child_name: '乙', status: 'pending', grade: '中班', planned_entry_date: '2027-02-01', target_school_year: 115, target_semester: 2 }),
        student({ child_name: '丙', status: 'pending', grade: null, target_school_year: 115, target_semester: 2 }),
        student({ child_name: '丁', status: 'pending', grade: '小班', target_school_year: null, target_semester: null }),
      ],
    })
    const { wrapper } = await mountTable(data)
    const chips = wrapper.findAll('[data-roster-tray] .roster-chip').map((c) => c.text())
    expect(chips).toEqual(['甲小班・12–1月入園', '乙中班・116/2/1 入園', '丙缺班別・2–7月入園', '丁小班・缺入學學期'])
  })

  it('沒有 admissions.write 時沒有輸入框、沒有 draggable', async () => {
    const data = roster({ classes: [klass({ target_seats: 4, students: [student()] })], unassigned: [student({ status: 'pending' })] })
    const { wrapper } = await mountTable(data, false)
    expect(wrapper.findAll('input')).toHaveLength(0)
    expect(wrapper.findAll('[draggable="true"]')).toHaveLength(0)
    expect(wrapper.find('tfoot').text()).toContain('4')
  })

  it('接待帳號可以改，唯讀的接待帳號（admissions.read）不行', async () => {
    mockGet({ '/admin/admissions/options': options(), '/admin/admissions/roster': roster({ classes: [klass({ students: [student()] })] }) })
    const writer = await mountWith(AdmissionsView, { path: '/admissions?tab=roster', user: reception() })
    expect(writer.wrapper.findAll('tfoot input').length).toBeGreaterThan(0)
    cleanup()
    mockGet({ '/admin/admissions/options': options(), '/admin/admissions/roster': roster({ classes: [klass({ students: [student()] })] }) })
    const viewer = await mountWith(AdmissionsView, { path: '/admissions?tab=roster', user: admissionsViewer() })
    await flushPromises()
    expect(viewer.wrapper.findAll('tfoot input')).toHaveLength(0)
  })
})
