import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, type DOMWrapper } from '@vue/test-utils'
import { ElPagination, ElSelect, ElSwitch } from 'element-plus'
import NoDepositList from '../components/admissions/NoDepositList.vue'
import type { NoDepositRecord, NoDepositRecords } from '../api/types'
import { GRADES, NO_DEPOSIT_REASONS } from '../admissions/constants'
import { button, cleanup, deferred, mockGet, mountWith, pathsTo, queryOf, reception } from './admissionsTestKit'

afterEach(cleanup)

const PATH = '/admin/admissions/no-deposit-records'

// 欄位與 C2b test_no_deposit_records_population_order_and_fields 的 N1（林小安）、N4（王小樹）、N5（周小宇）相同。
const record = (changes: Partial<NoDepositRecord> = {}): NoDepositRecord => ({
  id: '11111111-0000-4000-8000-000000000001', month: '115.09', seq_no: '2', child_name: '林小安', grade: '小班',
  no_deposit_reason: '時程未到／仍在觀望', no_deposit_reason_detail: '想等明年再決定', source: 'Facebook', referrer: '林老師',
  parent_response: '下週再電訪', created_at: '2026-09-11T04:00:00Z', priority: 'high', cold: false, ...changes,
})
const LIN = record()
const WANG = record({
  id: '11111111-0000-4000-8000-000000000004', month: '115.08', seq_no: '5', child_name: '王小樹', grade: null,
  no_deposit_reason: null, no_deposit_reason_detail: null, source: null, referrer: null, parent_response: null,
  created_at: '2026-09-28T04:00:00Z', priority: null, cold: false,
})
const ZHOU = record({
  id: '11111111-0000-4000-8000-000000000005', month: '115.07', seq_no: '3', child_name: '周小宇',
  no_deposit_reason: '已有其他就學選項／比較他校', no_deposit_reason_detail: null, source: null, referrer: null,
  parent_response: null, created_at: '2026-07-03T04:00:00Z', priority: 'low', cold: true,
})

function result(records: NoDepositRecord[], total = records.length): NoDepositRecords {
  return {
    total, page: 1, page_size: 50,
    summary: { high_potential_count: 1, overdue_followup_count: 2, cold_count: 1 },
    records,
  }
}

const props = (changes: Record<string, unknown> = {}) => ({ campusKey: 'yihua', schoolYear: 115, semester: 1, ...changes })
const lastQuery = (get: Parameters<typeof pathsTo>[0]) => queryOf(pathsTo(get, PATH).at(-1)!)
const cells = (row: DOMWrapper<Element>) => row.findAll('th, td').map((cell) => cell.text())

describe('未預繳明細：表格（園務 RecruitmentNoDepositTab 的「未預繳明細」）', () => {
  it('表頭照園務順序，潛力與冷名單用 tag；沒填寫「—」、原因沒填寫「未分類」', async () => {
    mockGet({ [PATH]: result([LIN, WANG, ZHOU]) })
    const { wrapper } = await mountWith(NoDepositList, { props: props() })

    expect(wrapper.get('.stats-block__title').text()).toBe('未預繳明細')
    expect(wrapper.findAll('thead th').map((th) => th.text())).toEqual([
      '月份', '姓名', '班別', '原因分類', '轉換潛力', '冷名單', '說明', '來源', '介紹者', '電訪回應', '明細',
    ])
    const rows = wrapper.findAll('tbody tr')
    expect(cells(rows[0]!)).toEqual([
      '115.09', '林小安', '小班', '時程未到／仍在觀望', '高', '', '想等明年再決定', 'Facebook', '林老師', '下週再電訪', '查看',
    ])
    expect(cells(rows[1]!)).toEqual(['115.08', '王小樹', '—', '未分類', '—', '', '—', '—', '—', '—', '查看'])
    expect(cells(rows[2]!).slice(4, 6)).toEqual(['低', '冷'])
    expect(rows[0]!.get('.el-tag').classes()).toContain('el-tag--danger')
    expect(rows[2]!.findAll('.el-tag').map((tag) => tag.classes().includes('el-tag--info'))).toEqual([true, true])
    expect(wrapper.get('.nd-count').text()).toBe('顯示 3 / 3 筆未預繳')
    expect(wrapper.find('.el-pagination').exists()).toBe(false)
  })

  it('「查看」切到訪視明細並帶這筆的月份（B 的明細只吃 month，帶不到單筆）', async () => {
    mockGet({ [PATH]: result([LIN, ZHOU]) })
    const { wrapper } = await mountWith(NoDepositList, { props: props() })

    const view = button(wrapper.findAll('tbody tr')[1]!, '查看')!
    expect(view.attributes('aria-label')).toBe('查看 115.07 的訪視明細（周小宇）')
    await view.trigger('click')
    expect(wrapper.emitted('open-records')).toEqual([[{ month: '115.07' }]])
  })
})

describe('未預繳明細：篩選（園務 ndFilter）', () => {
  it('預設「高潛力優先」；原因、班別、換頁都帶進 query，改篩選回第 1 頁', async () => {
    const get = mockGet({ [PATH]: result([LIN], 120) })
    const { wrapper } = await mountWith(NoDepositList, { props: props() })

    expect(pathsTo(get, PATH)[0]).toBe(`${PATH}?campus_key=yihua&school_year=115&semester=1&priority=high&page=1&page_size=50`)
    const items = wrapper.findAll('.el-select-dropdown__item').map((item) => item.text())
    expect(items.slice(0, 4)).toEqual(['高潛力優先', '全部潛力', '中潛力', '低潛力'])
    expect(items.slice(4, 12)).toEqual([...NO_DEPOSIT_REASONS])
    expect(items.slice(12)).toEqual([...GRADES])

    // total 120 > 每頁 50 才有分頁；換頁帶 page。
    wrapper.findComponent(ElPagination).vm.$emit('current-change', 3)
    await flushPromises()
    expect(lastQuery(get).get('page')).toBe('3')

    const [, reasonSelect, gradeSelect] = wrapper.findAllComponents(ElSelect)
    reasonSelect!.vm.$emit('update:modelValue', '費用考量')
    await flushPromises()
    expect(Object.fromEntries(lastQuery(get))).toEqual({
      campus_key: 'yihua', school_year: '115', semester: '1', reason: '費用考量', priority: 'high', page: '1', page_size: '50',
    })
    gradeSelect!.vm.$emit('update:modelValue', '小班')
    await flushPromises()
    expect(lastQuery(get).get('grade')).toBe('小班')
    // 清除（clearable 送 undefined）就不帶。
    reasonSelect!.vm.$emit('update:modelValue', undefined)
    await flushPromises()
    expect(lastQuery(get).has('reason')).toBe(false)
  })

  it('「全部潛力」不帶 priority；「逾 14 天」帶 overdue_days=14、「冷名單」帶 cold_only=true，關掉就不帶', async () => {
    const get = mockGet({ [PATH]: result([LIN]) })
    const { wrapper } = await mountWith(NoDepositList, { props: props() })
    const [prioritySelect] = wrapper.findAllComponents(ElSelect)
    const [overdueSwitch, coldSwitch] = wrapper.findAllComponents(ElSwitch)

    expect([overdueSwitch!.props('activeText'), overdueSwitch!.props('inactiveText')]).toEqual(['逾 14 天', '不限'])
    expect([coldSwitch!.props('activeText'), coldSwitch!.props('inactiveText')]).toEqual(['冷名單', '不限'])

    prioritySelect!.vm.$emit('update:modelValue', 'all')
    await flushPromises()
    expect(lastQuery(get).has('priority')).toBe(false)

    overdueSwitch!.vm.$emit('update:modelValue', true)
    await flushPromises()
    expect(lastQuery(get).get('overdue_days')).toBe('14')
    coldSwitch!.vm.$emit('update:modelValue', true)
    await flushPromises()
    expect(lastQuery(get).get('cold_only')).toBe('true')
    expect(wrapper.findAllComponents(ElSwitch).map((item) => item.props('modelValue'))).toEqual([true, true])

    overdueSwitch!.vm.$emit('update:modelValue', false)
    coldSwitch!.vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(lastQuery(get).has('overdue_days')).toBe(false)
    expect(lastQuery(get).has('cold_only')).toBe(false)
  })

  it('警示或行動入口帶的篩選（preset）：套上 priority 與 overdue_days，其餘回預設、回第 1 頁', async () => {
    const get = mockGet({ [PATH]: result([LIN], 120) })
    const { wrapper } = await mountWith(NoDepositList, { props: props({ preset: { priority: 'high', overdue_days: 14 } }) })

    expect(pathsTo(get, PATH)).toHaveLength(1)
    expect(Object.fromEntries(lastQuery(get))).toEqual({
      campus_key: 'yihua', school_year: '115', semester: '1', priority: 'high', overdue_days: '14', page: '1', page_size: '50',
    })
    expect(wrapper.findAllComponents(ElSwitch)[0]!.props('modelValue')).toBe(true)

    wrapper.findAllComponents(ElSwitch)[1]!.vm.$emit('update:modelValue', true)
    wrapper.findComponent(ElPagination).vm.$emit('current-change', 2)
    await flushPromises()
    await wrapper.setProps({ preset: { priority: 'low' } })
    await flushPromises()
    expect(Object.fromEntries(lastQuery(get))).toEqual({
      campus_key: 'yihua', school_year: '115', semester: '1', priority: 'low', page: '1', page_size: '50',
    })
  })
})

describe('未預繳明細：空狀態與讀取', () => {
  it('有潛力篩選時寫明上方表格是全部原因，按「改看全部潛力」；沒有潛力篩選時是一般空狀態', async () => {
    const get = mockGet({ [PATH]: result([]) })
    const { wrapper } = await mountWith(NoDepositList, { props: props() })

    expect(wrapper.get('.nd-empty').text()).toContain('目前「高潛力優先」篩選下沒有名單，上方表格統計的是全部原因分布')
    expect(wrapper.find('table').exists()).toBe(false)
    await button(wrapper, '改看全部潛力')!.trigger('click')
    await flushPromises()
    expect(lastQuery(get).has('priority')).toBe(false)
    expect(wrapper.get('.nd-empty').text()).toBe('目前篩選條件下沒有未預繳名單')
    expect(button(wrapper, '改看全部潛力')).toBeUndefined()
  })

  it('讀取失敗：顯示錯誤、不留上一校名單，重新載入可恢復', async () => {
    let denied = true
    mockGet({
      [PATH]: (path: string) => {
        if (queryOf(path).get('campus_key') === 'minghua' && denied) throw new Error('403')
        return result([LIN])
      },
    })
    const { wrapper } = await mountWith(NoDepositList, { props: props(), user: reception() })

    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(button(wrapper, '查看')).toBeDefined()

    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    expect(wrapper.get('.el-alert').text()).toContain('無法讀取未預繳名單，請重新載入。')
    expect(wrapper.find('tbody tr').exists()).toBe(false)

    denied = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.el-alert').exists()).toBe(false)
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
  })

  it('快速切換校區只顯示最後一次（義華晚回也不會蓋掉明華）', async () => {
    const yihua = deferred<NoDepositRecords>()
    const minghua = deferred<NoDepositRecords>()
    mockGet({ [PATH]: (path: string) => (queryOf(path).get('campus_key') === 'yihua' ? yihua.promise : minghua.promise) })
    const { wrapper } = await mountWith(NoDepositList, { props: props() })

    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    minghua.resolve(result([record({ child_name: '楊小禾' })]))
    await flushPromises()
    yihua.resolve(result([LIN, ZHOU]))
    await flushPromises()

    expect(wrapper.findAll('tbody tr').map((row) => row.findAll('td')[1]!.text())).toEqual(['楊小禾'])
  })
})
