import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ClassDistributionPanel from '../components/analytics/ClassDistributionPanel.vue'
import { api } from '../api/client'
import { currentTerm } from '../admissions/academic'
import type { ClassDistributionOut } from '../api/types'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach((wrapper) => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const dist = (over: Partial<ClassDistributionOut> = {}): ClassDistributionOut => ({
  as_of: '2026-10-03T06:05:00Z', campus_key: 'yihua', date_from: null, date_to: null, school_year: 115, unit: 'visit_request',
  total: 9, grades: [{ grade: '幼幼班', count: 2 }, { grade: '小班', count: 3 }, { grade: '中班', count: 1 }, { grade: '大班', count: 0 }],
  out_of_range: 1, unrecorded: 2, ...over,
})

const mountOnly = (props: Record<string, unknown> = {}) => {
  const wrapper = mount(ClassDistributionPanel, { props: { campusKey: 'yihua', range: null, periodLabel: '開站至今', ...props }, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  return wrapper
}

async function mountPanel(data: ClassDistributionOut = dist()) {
  const get = vi.spyOn(api, 'get').mockResolvedValue(data as never)
  const wrapper = mountOnly()
  await flushPromises()
  return { wrapper, get }
}

describe('預約孩子的班別', () => {
  it('預設用目前學年換算；四個班加範圍外與沒有生日，各自一列', async () => {
    const { wrapper, get } = await mountPanel()
    expect(get).toHaveBeenCalledWith(`/admin/analytics/class-distribution?campus_key=yihua&school_year=${currentTerm().schoolYear}`)
    const rows = wrapper.findAll('.stats-table tbody tr').map((tr) => tr.text())
    expect(rows).toHaveLength(6)
    expect(rows[1]).toContain('小班')
    expect(rows[1]).toContain('3')
    expect(rows[4]).toContain('不在幼幼班～大班')
    expect(rows[5]).toContain('沒有生日資料')
    expect(wrapper.text()).toContain('不代表已報名或入學')
    expect(wrapper.text()).toContain('單位：預約案件數（含已取消）')
  })

  it('換學年重抓', async () => {
    const { wrapper, get } = await mountPanel()
    const next = currentTerm().schoolYear + 1
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', next)
    await flushPromises()
    expect(get).toHaveBeenLastCalledWith(`/admin/analytics/class-distribution?campus_key=yihua&school_year=${next}`)
  })

  it('沒有預約案件時寫出來，不列一排 0', async () => {
    const { wrapper } = await mountPanel(dist({ total: 0, grades: dist().grades.map((row) => ({ ...row, count: 0 })), out_of_range: 0, unrecorded: 0 }))
    expect(wrapper.text()).toContain('這段期間沒有預約案件。')
    expect(wrapper.find('.stats-table').exists()).toBe(false)
  })

  it('讀取失敗顯示錯誤，不顯示 0 或班別列', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('network'))
    const wrapper = mountOnly()
    await flushPromises()
    expect(wrapper.text()).toContain('無法讀取班別分布')
    expect(wrapper.find('.stats-table').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('小班')
  })

  it('重抓失敗時不留舊資料，只顯示錯誤', async () => {
    const { wrapper } = await mountPanel()
    expect(wrapper.find('.stats-table').exists()).toBe(true)
    vi.spyOn(api, 'get').mockRejectedValue(new Error('network'))
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    expect(wrapper.text()).toContain('無法讀取班別分布')
    expect(wrapper.find('.stats-table').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('單位：預約案件數')
  })

  it('重抓中保留舊資料與舊校區、期間標籤，標示更新中', async () => {
    const { wrapper } = await mountPanel()
    let release: (value: ClassDistributionOut) => void = () => {}
    vi.spyOn(api, 'get').mockImplementation(() => new Promise((resolve) => { release = resolve as (value: ClassDistributionOut) => void }))
    await wrapper.setProps({ campusKey: 'minghua', periodLabel: '2026/09/01–2026/09/30' })
    expect(wrapper.find('.classes').classes()).toContain('is-updating')
    expect(wrapper.find('.classes').attributes('aria-busy')).toBe('true')
    expect(wrapper.findAll('.stats-table tbody tr')).toHaveLength(6)
    expect(wrapper.find('#class-dist-title').text()).toContain('義華')
    expect(wrapper.text()).toContain('開站至今')
    release(dist({ campus_key: 'minghua' }))
    await flushPromises()
    expect(wrapper.find('.classes').classes()).not.toContain('is-updating')
    expect(wrapper.find('#class-dist-title').text()).toContain('明華')
    expect(wrapper.text()).toContain('2026/09/01–2026/09/30')
  })

  it('回應順序顛倒時只顯示最後一次換學年的資料', async () => {
    const pending: Array<(value: ClassDistributionOut) => void> = []
    vi.spyOn(api, 'get').mockImplementation(() => new Promise((resolve) => { pending.push(resolve as (value: ClassDistributionOut) => void) }))
    const wrapper = mountOnly()
    const base = currentTerm().schoolYear
    const select = wrapper.findComponent({ name: 'ElSelect' })
    select.vm.$emit('update:modelValue', base + 1)
    await flushPromises()
    select.vm.$emit('update:modelValue', base + 2)
    await flushPromises()
    expect(pending).toHaveLength(3)
    pending[2](dist({ school_year: base + 2, grades: [{ grade: '幼幼班', count: 7 }, { grade: '小班', count: 0 }, { grade: '中班', count: 0 }, { grade: '大班', count: 0 }], total: 7 }))
    await flushPromises()
    pending[1](dist({ school_year: base + 1 }))
    await flushPromises()
    expect(wrapper.text()).toContain(`${base + 2} 學年度的班別`)
    expect(wrapper.text()).not.toContain(`${base + 1} 學年度的班別`)
    expect(wrapper.findAll('.stats-table tbody tr')[0].text()).toContain('7')
  })
})
