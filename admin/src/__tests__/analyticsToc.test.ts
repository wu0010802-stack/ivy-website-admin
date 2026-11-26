import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, type PropType } from 'vue'
import AnalyticsToc from '../components/analytics/AnalyticsToc.vue'
import { ANALYTICS_SECTIONS, ANALYTICS_TABS, type AnalyticsSection } from '../components/analytics/filters'

// 成效統計的類內目次（2026-11-26 第五輪）：條件列第二行列出這一類的表，點了捲到那一張、捲動時標出現在看到哪一張。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const wrappers: VueWrapper[] = []
const LINE = 100

// 一頁：目次＋幾張畫出來的表（shown）＋被 v-show 收起來的分類裡的表（hidden）。
const Host = defineComponent({
  props: {
    sections: { type: Array as PropType<readonly AnalyticsSection[]>, required: true },
    shown: { type: Array as PropType<string[]>, default: () => [] },
    hidden: { type: Array as PropType<string[]>, default: () => [] },
  },
  setup: (props) => () =>
    h('div', { class: 'page' }, [
      h(AnalyticsToc, { sections: props.sections, line: () => LINE }),
      ...props.shown.map((id) => h('section', { key: id, class: 'panel', 'data-panel': id }, [h('h2', { id }, id)])),
      h('div', { style: 'display: none' }, props.hidden.map((id) => h('section', { key: id, class: 'panel' }, [h('h2', { id }, id)]))),
    ]),
})

const SECTIONS: AnalyticsSection[] = [
  { target: 'toc-a', label: '甲表' },
  { target: 'toc-b', label: '乙表' },
  { target: 'toc-c', label: '丙表' },
]

async function mountHost(props: { sections?: readonly AnalyticsSection[]; shown?: string[]; hidden?: string[] } = {}) {
  const wrapper = mount(Host, { attachTo: document.body, props: { sections: SECTIONS, ...props } })
  wrappers.push(wrapper)
  await flushPromises()
  const links = () => wrapper.findAll('.analytics-toc__link')
  const labels = () => links().map((link) => link.text())
  const current = () => links().filter((link) => link.attributes('aria-current') === 'location').map((link) => link.text())
  /** 設定某一張表離視窗頂端多遠。 */
  const place = (id: string, top: number) => {
    const panel = wrapper.get(`[data-panel="${id}"]`).element
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ top } as DOMRect)
  }
  const scroll = async () => {
    window.dispatchEvent(new Event('scroll'))
    await flushPromises()
  }
  return { wrapper, links, labels, current, place, scroll }
}

let scrollTo: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  // 一個畫格最多重算一次：測試裡讓它當下就算。回傳 0，元件才知道這一格已經跑完。
  vi.stubGlobal('requestAnimationFrame', (task: FrameRequestCallback) => {
    task(0)
    return 0
  })
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => {
  while (wrappers.length) wrappers.pop()!.unmount()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
})

describe('類內目次', () => {
  it('只列畫面上有的表：還沒畫出來的、被收起來的分類裡的不列；讀完才出現的會補上', async () => {
    const { wrapper, labels } = await mountHost({ shown: ['toc-a'], hidden: ['toc-c'] })
    expect(wrapper.get('nav').attributes('aria-label')).toBe('這一類有哪些統計')
    expect(labels()).toEqual(['甲表'])
    // 乙表讀完、標題畫出來了。
    await wrapper.setProps({ shown: ['toc-a', 'toc-b'] })
    await flushPromises()
    expect(labels()).toEqual(['甲表', '乙表'])
  })

  it('順序照設定，不照畫面上出現的先後；每一項是連到那張表標題的連結', async () => {
    const { links, labels } = await mountHost({ shown: ['toc-c', 'toc-a'] })
    expect(labels()).toEqual(['甲表', '丙表'])
    expect(links().map((link) => link.attributes('href'))).toEqual(['#toc-a', '#toc-c'])
  })

  it('點了捲到那一張表、停在條件列下面，焦點移到那張表的標題，並標成目前位置', async () => {
    const { wrapper, links, current, place } = await mountHost({ shown: ['toc-a', 'toc-b'] })
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true })
    place('toc-a', -200)
    place('toc-b', 900)
    await links()[1]!.trigger('click')
    // 表的位置 900＋已捲 500，扣掉條件列底線 100 與 12px 間距。
    expect(scrollTo).toHaveBeenCalledWith({ top: 1288, behavior: 'smooth' })
    expect(current()).toEqual(['乙表'])
    const heading = wrapper.get('#toc-b').element
    expect(document.activeElement).toBe(heading)
    expect(heading.getAttribute('tabindex')).toBe('-1')
  })

  it('捲動時標出現在看到哪一張：最靠近條件列底線、已經捲過去的那一張；還沒捲到第一張時都不標', async () => {
    const { current, place, scroll } = await mountHost({ shown: ['toc-a', 'toc-b', 'toc-c'] })
    place('toc-a', 300)
    place('toc-b', 800)
    place('toc-c', 1400)
    await scroll()
    expect(current()).toEqual([])
    place('toc-a', -700)
    place('toc-b', 110)
    place('toc-c', 600)
    await scroll()
    expect(current()).toEqual(['乙表'])
    // 兩欄並排、一樣高的兩張表：標前面（左欄）那一張。
    place('toc-b', -40)
    place('toc-c', -40)
    await scroll()
    expect(current()).toEqual(['乙表'])
  })

  it('點了靠近頁尾、捲不到線的表：在使用者自己再捲動之前都標那一張', async () => {
    const { links, current, place, scroll } = await mountHost({ shown: ['toc-a', 'toc-b', 'toc-c'] })
    place('toc-a', -900)
    place('toc-b', 90)
    place('toc-c', 500)
    await links()[2]!.trigger('click')
    await scroll()
    expect(current()).toEqual(['丙表'])
    // 使用者自己滾動之後，回到照位置判斷。
    window.dispatchEvent(new Event('wheel'))
    await scroll()
    expect(current()).toEqual(['乙表'])
  })

  it('換分類：改列新的那一類，上一類點過的標記不帶過來', async () => {
    const { wrapper, links, labels, current, place, scroll } = await mountHost({ shown: ['toc-a', 'toc-b'] })
    place('toc-a', 0)
    place('toc-b', 400)
    await links()[1]!.trigger('click')
    expect(current()).toEqual(['乙表'])
    await wrapper.setProps({ sections: [{ target: 'toc-b', label: '乙表' }, { target: 'toc-x', label: '新表' }], shown: ['toc-b', 'toc-x'] })
    await flushPromises()
    expect(labels()).toEqual(['乙表', '新表'])
    // 新的那一類從開頭看起：兩張表都還在條件列底線下面，不該因為上一類點過乙表就標著它。
    place('toc-b', 300)
    place('toc-x', 900)
    await scroll()
    expect(current()).toEqual([])
  })
})

describe('每一類的目次設定', () => {
  const sources = [
    '../components/SiteTrafficPanel.vue', '../components/CruxPanel.vue', '../components/analytics/NotFoundPanel.vue',
    '../components/analytics/CrawlerPanel.vue', '../components/ContentInterestPanel.vue', '../components/SearchInsightsPanel.vue',
    '../components/analytics/BusinessProfilePanel.vue', '../components/LineInsightsPanel.vue',
    '../components/analytics/BookingAttributionPanel.vue', '../components/analytics/ContactHoursPanel.vue', '../components/analytics/MonthlyPanel.vue',
  ].map(read).join('\n')

  it('五類都有目次，每一項都對得到某一張表的標題 id（改了標題 id 要一起改）', () => {
    for (const tab of ANALYTICS_TABS) {
      const sections = ANALYTICS_SECTIONS[tab.key]
      expect(sections.length, tab.label).toBeGreaterThan(1)
      for (const item of sections) expect(sources, `${tab.label}／${item.label}`).toContain(`id="${item.target}"`)
    }
  })

  it('同一個標題不重複列，同一類裡名稱也不重複', () => {
    const targets = ANALYTICS_TABS.flatMap((tab) => ANALYTICS_SECTIONS[tab.key].map((item) => item.target))
    expect(new Set(targets).size).toBe(targets.length)
    for (const tab of ANALYTICS_TABS) {
      const labels = ANALYTICS_SECTIONS[tab.key].map((item) => item.label)
      expect(new Set(labels).size, tab.label).toBe(labels.length)
    }
  })
})
