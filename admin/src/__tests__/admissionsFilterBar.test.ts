// AdmissionsFilterBar 的 2026-11-20 新 props：hideCampus／hideTerm（用不到的條件整個不出現）與 compact（欄名不佔一行）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdmissionsFilterBar from '../components/admissions/AdmissionsFilterBar.vue'
import { cleanup, mountWith } from './admissionsTestKit'

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

const ALL = ['yihua', 'minghua', 'chongde', 'international', 'renwu']
const bar = (changes: Record<string, unknown> = {}) => ({
  campus: 'yihua', schoolYear: 115, semester: 1, campusKeys: ALL, defaultYear: 115, ...changes,
})
const selectLabels = (wrapper: Awaited<ReturnType<typeof mountWith>>['wrapper']) =>
  wrapper.findAllComponents({ name: 'ElSelect' }).map((item) => item.props('ariaLabel'))
const stubNarrow = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))

describe('AdmissionsFilterBar：hideCampus／hideTerm', () => {
  it('預設三個條件都在（校區、入學學年、入學學期）', async () => {
    const { wrapper } = await mountWith(AdmissionsFilterBar, { props: bar() })
    expect(wrapper.findComponent({ name: 'CampusSelect' }).exists()).toBe(true)
    expect(selectLabels(wrapper)).toEqual(expect.arrayContaining(['入學學年', '入學學期']))
    expect(wrapper.find('#admissions-filters').exists()).toBe(true)
  })

  it('hideTerm：學年學期兩個下拉整個不出現（不是停用），校區還在；也沒有「不分入學學年學期」那句', async () => {
    const { wrapper } = await mountWith(AdmissionsFilterBar, { props: bar({ hideTerm: true }) })
    expect(wrapper.findComponent({ name: 'CampusSelect' }).exists()).toBe(true)
    expect(selectLabels(wrapper)).not.toContain('入學學年')
    expect(selectLabels(wrapper)).not.toContain('入學學期')
    expect(wrapper.find('.admissions__scope-note').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('入學學年')
  })

  it('hideCampus：校區下拉不出現，學年學期還在', async () => {
    const { wrapper } = await mountWith(AdmissionsFilterBar, { props: bar({ hideCampus: true }) })
    expect(wrapper.findComponent({ name: 'CampusSelect' }).exists()).toBe(false)
    expect(selectLabels(wrapper)).toEqual(expect.arrayContaining(['入學學年', '入學學期']))
  })

  it('hideCampus 且 hideTerm：沒有任何條件可選，整列（含手機摘要）都不出現', async () => {
    const { wrapper } = await mountWith(AdmissionsFilterBar, { props: bar({ hideCampus: true, hideTerm: true }) })
    expect(wrapper.find('#admissions-filters').exists()).toBe(false)
    expect(wrapper.find('.admissions__filters').exists()).toBe(false)
    cleanup()
    stubNarrow()
    const narrow = await mountWith(AdmissionsFilterBar, { props: bar({ hideCampus: true, hideTerm: true }) })
    expect(narrow.wrapper.find('.admissions__summary').exists()).toBe(false)
  })

  it('只有一個可見校區又 hideTerm：沒有任何條件可選，整列不出現', async () => {
    const { wrapper } = await mountWith(AdmissionsFilterBar, { props: bar({ campusKeys: ['renwu'], campus: 'renwu', hideTerm: true }) })
    expect(wrapper.find('#admissions-filters').exists()).toBe(false)
  })

  it('手機摘要只列看得到的條件：hideTerm 只寫校區、hideCampus 只寫學年學期；展開後只有看得到的下拉', async () => {
    stubNarrow()
    const hideTerm = await mountWith(AdmissionsFilterBar, { props: bar({ hideTerm: true }) })
    expect(hideTerm.wrapper.get('.admissions__summary-text').text()).toBe('義華')
    expect(hideTerm.wrapper.find('#admissions-filters').exists()).toBe(false)
    await hideTerm.wrapper.get('.admissions__summary').trigger('click')
    expect(hideTerm.wrapper.get('#admissions-filters').findAllComponents({ name: 'ElSelect' }).map((item: { props: (key: string) => unknown }) => item.props('ariaLabel'))).not.toContain('入學學年')
    cleanup()

    const hideCampus = await mountWith(AdmissionsFilterBar, { props: bar({ hideCampus: true }) })
    const text = hideCampus.wrapper.get('.admissions__summary-text').text()
    expect(text).toContain('115 學年')
    expect(text).not.toContain('義華')
  })
})

describe('AdmissionsFilterBar：compact', () => {
  it('compact：欄名（校區、入學學年、入學學期）仍在 DOM 但 visually-hidden，整列加 admissions__filters--compact', async () => {
    const { wrapper } = await mountWith(AdmissionsFilterBar, { props: bar({ compact: true }) })
    const filters = wrapper.get('#admissions-filters')
    expect(filters.classes()).toContain('admissions__filters--compact')
    const labels = filters.findAll('.filter-field > span')
    expect(labels.map((item) => item.text())).toEqual(['校區', '入學學年', '入學學期'])
    expect(labels.every((item) => item.classes().includes('visually-hidden'))).toBe(true)
  })

  it('沒給 compact：欄名是看得到的字、沒有 compact 的 class', async () => {
    const { wrapper } = await mountWith(AdmissionsFilterBar, { props: bar() })
    const filters = wrapper.get('#admissions-filters')
    expect(filters.classes()).not.toContain('admissions__filters--compact')
    expect(filters.findAll('.filter-field > span').some((item) => item.classes().includes('visually-hidden'))).toBe(false)
  })
})
