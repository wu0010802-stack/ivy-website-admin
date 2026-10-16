// StatsDimensionTable 的 nameAction（名稱欄在所有寬度都是按鈕）與 captionCollapsed（caption 收進「這些數字怎麼算」），
// 2026-10-16 區域分析工作台規格 D12、§2.7。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import StatsDimensionTable from '../components/admissions/StatsDimensionTable.vue'

afterEach(() => vi.unstubAllGlobals())

const rows = [
  { key: 'a', place: '三民區本揚里', n: 3 },
  { key: 'b', place: '三民區鼎金里', n: 5 },
]
const base = {
  title: '各里',
  rows,
  columns: [
    { key: 'place', label: '里', sticky: true },
    { key: 'n', label: '人數', kind: 'count' as const },
  ],
  rowKey: 'key',
  emptyText: '沒有資料',
}
const mountTable = (props: Record<string, unknown> = {}) =>
  mount(StatsDimensionTable, { props: { ...base, ...props }, global: { plugins: [ElementPlus] } })
const narrowScreen = () =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))

describe('nameAction：名稱欄的原生按鈕', () => {
  it('桌機寬度：每列名稱是 button，aria-label 帶名稱，按下 emit name-action', async () => {
    const wrapper = mountTable({ nameAction: '在地圖上選取' })
    const buttons = wrapper.findAll('th.stats-table__sticky button.stats-table__name-link')
    expect(buttons.map((button) => button.text())).toEqual(['三民區本揚里', '三民區鼎金里'])
    expect(buttons[0]!.attributes('aria-label')).toBe('在地圖上選取：三民區本揚里')
    expect(buttons[0]!.attributes('type')).toBe('button')
    await buttons[1]!.trigger('click')
    expect(wrapper.emitted('name-action')).toEqual([[rows[1]]])
    expect(wrapper.emitted('action')).toBeUndefined()
    wrapper.unmount()
  })

  it('手機寬度一樣是 button，不多出按鈕欄', async () => {
    narrowScreen()
    const wrapper = mountTable({ nameAction: '在地圖上選取' })
    expect(wrapper.findAll('button.stats-table__name-link')).toHaveLength(2)
    expect(wrapper.find('th.stats-table__action').exists()).toBe(false)
    await wrapper.get('button.stats-table__name-link').trigger('click')
    expect(wrapper.emitted('name-action')).toEqual([[rows[0]]])
    wrapper.unmount()
  })

  it('沒給 nameAction：名稱是純文字（桌機）', () => {
    const wrapper = mountTable()
    expect(wrapper.find('button.stats-table__name-link').exists()).toBe(false)
    expect(wrapper.findAll('tbody th').map((cell) => cell.text())).toEqual(['三民區本揚里', '三民區鼎金里'])
    wrapper.unmount()
  })

  it('名稱缺值時 aria-label 改寫第幾列', () => {
    const wrapper = mountTable({ nameAction: '在地圖上選取', rows: [{ key: 'x', place: null, n: 1 }] })
    expect(wrapper.get('button.stats-table__name-link').attributes('aria-label')).toBe('在地圖上選取（第 1 列）')
    wrapper.unmount()
  })

  it('和 actionLabel 互不影響：手機版 actionLabel 的名稱連結照舊，兩個都給時名稱走 nameAction、按鈕欄保留', async () => {
    narrowScreen()
    const onlyAction = mountTable({ actionLabel: '查看明細' })
    const link = onlyAction.get('button.stats-table__name-link')
    expect(link.attributes('aria-label')).toBe('查看明細：三民區本揚里')
    await link.trigger('click')
    expect(onlyAction.emitted('action')).toEqual([[rows[0]]])
    expect(onlyAction.emitted('name-action')).toBeUndefined()
    onlyAction.unmount()

    const both = mountTable({ actionLabel: '查看明細', nameAction: '在地圖上選取' })
    expect(both.findAll('button.stats-table__name-link').map((button) => button.attributes('aria-label'))).toEqual([
      '在地圖上選取：三民區本揚里',
      '在地圖上選取：三民區鼎金里',
    ])
    const actions = both.findAll('td.stats-table__action button')
    expect(actions.map((button) => button.attributes('aria-label'))).toEqual(['查看明細：三民區本揚里', '查看明細：三民區鼎金里'])
    await actions[1]!.trigger('click')
    expect(both.emitted('action')).toEqual([[rows[1]]])
    expect(both.emitted('name-action')).toBeUndefined()
    both.unmount()
  })
})

describe('captionCollapsed：caption 收進「這些數字怎麼算」', () => {
  const caption = '參觀率＝參觀人數 ÷ 2–5 歲孩子數。'

  it('預設 caption 直接寫在表格上方', () => {
    const wrapper = mountTable({ caption })
    expect(wrapper.get('p.stats-block__caption').text()).toBe(caption)
    expect(wrapper.find('details').exists()).toBe(false)
    wrapper.unmount()
  })

  it('captionCollapsed：caption 在預設收起的 details 裡', () => {
    const wrapper = mountTable({ caption, captionCollapsed: true })
    const details = wrapper.get('details.stats-block__how')
    expect(details.attributes('open')).toBeUndefined()
    expect(details.get('summary').text()).toBe('這些數字怎麼算')
    expect(details.get('p.hint').text()).toBe(caption)
    expect(wrapper.find('p.stats-block__caption').exists()).toBe(false)
    wrapper.unmount()
  })

  it('沒有 caption 時 captionCollapsed 不畫空的 details', () => {
    const wrapper = mountTable({ captionCollapsed: true })
    expect(wrapper.find('details').exists()).toBe(false)
    wrapper.unmount()
  })
})
