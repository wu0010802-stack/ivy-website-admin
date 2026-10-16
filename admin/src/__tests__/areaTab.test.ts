// 區域分析子分頁（2026-10-08 規格 9；2026-10-16 改成地圖工作台）。地圖元件換成 stub（地圖本身見 areaMap.test.ts）；
// 右欄、表格分頁的內容各有自己的測試（areaSidePane／areaTables／villageTable），這裡驗組裝：各份資料怎麼讀、各自成敗、
// 工具列（看什麼、範圍）、選取的里與焦點、畫面狀態（view，經 StatsTab 接網址）與頁尾。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineComponent, h, isReactive, ref } from 'vue'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import AreaTab from '../components/admissions/area/AreaTab.vue'
import areaTabSource from '../components/admissions/area/AreaTab.vue?raw'
import statsTabSource from '../components/admissions/StatsTab.vue?raw'
import AreaTables from '../components/admissions/area/AreaTables.vue'
import NearbyBabycare from '../components/admissions/area/NearbyBabycare.vue'
import NearbyKindergartens from '../components/admissions/area/NearbyKindergartens.vue'
import NearbyPanel from '../components/admissions/area/NearbyPanel.vue'
import PeerFeesPanel from '../components/admissions/area/PeerFeesPanel.vue'
import { NOT_JUDGED_NOTE } from '../components/admissions/area/areaFormat'
import { DEFAULT_AREA_VIEW, type AreaTableTab, type AreaView } from '../admissions/areaView'
import {
  areaBabycare, areaChanges, areaEnrolled, areaKindergartens, areaOpportunity, areaPeerFees, areaStats, areaTrends, button, cleanup, deferred,
  mockGet, mountWith, pathsTo, queryOf, villageBoundaries,
} from './admissionsTestKit'

const mapStub = vi.hoisted(() => ({ focus: vi.fn(), focusBabycare: vi.fn(), reveal: vi.fn(), focusVillage: vi.fn() }))
vi.mock('../components/admissions/area/AreaMap.vue', async () => {
  const { defineComponent, h } = await import('vue')
  // __esModule：AreaTab 用 defineAsyncComponent 載入，Vue 靠它判斷要取 default（真的模組是 ES module namespace，mock 工廠的回傳值不是）。
  return {
    __esModule: true,
    default: defineComponent({
      name: 'AreaMap',
      props: [
        'boundaries', 'villages', 'campus', 'campusName', 'kindergartens', 'radiusKm', 'narrow', 'mode', 'selectedCode', 'opportunity',
        'babycare', 'trends', 'enrolled', 'gradeFilter',
      ],
      emits: ['select-village'],
      setup(_, { expose }) {
        expose({
          focusKindergarten: mapStub.focus, focusBabycare: mapStub.focusBabycare, revealBabycare: mapStub.reveal, focusVillage: mapStub.focusVillage,
        })
        return () => h('div', { class: 'area-map-stub' })
      },
    }),
  }
})
vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))

afterEach(() => {
  mapStub.focus.mockClear()
  mapStub.focusBabycare.mockClear()
  mapStub.reveal.mockClear()
  mapStub.focusVillage.mockClear()
  cleanup()
})

const EMPTY_TEXT = '義華在 115 學年還沒有招生訪視。新增訪視，或在參觀案件標記家長已到場後，這裡就會有統計。'
const STATUS = '門牌資料 115 年 10 月版・幼兒園名單 10/08 更新・托嬰名單 10/14 更新・各里人口 115 年 9 月・在籍清冊 2026/10/15・收費 114 學年公告（目前是 115 學年）'
const props = (changes: Record<string, unknown> = {}) => ({
  campusKey: 'yihua', schoolYear: 115, semester: null, csvName: (title: string) => `招生統計-${title}.csv`, emptyText: EMPTY_TEXT, ...changes,
})
/** 網址帶進來的畫面狀態（沒有接 update:view：AreaTab 自己保管、照樣往上 emit）。 */
const withView = (changes: Partial<AreaView>) => ({ view: { ...DEFAULT_AREA_VIEW, ...changes } })
const routes = (area: unknown = areaStats(), opportunity: unknown = areaOpportunity(), enrolled: unknown = areaEnrolled()) => ({
  '/admin/admissions/area/boundaries': villageBoundaries(),
  '/admin/admissions/area/kindergartens': areaKindergartens(),
  '/admin/admissions/area/babycare': areaBabycare(),
  '/admin/admissions/area/fees': areaPeerFees(),
  '/admin/admissions/area/changes': areaChanges(),
  '/admin/admissions/area/opportunity': opportunity,
  '/admin/admissions/area/trends': areaTrends(),
  '/admin/admissions/area/enrolled': enrolled,
  '/admin/admissions/area': area,
})
async function mountTab(changes: Record<string, unknown> = {}, area: unknown = areaStats(), opportunity: unknown = areaOpportunity()) {
  const get = mockGet(routes(area, opportunity))
  return { ...(await mountReady(changes)), get }
}
/** 已經 mockGet 過：掛上去，等地圖（或地圖區的錯誤）出現、資料都回來。 */
async function mountReady(changes: Record<string, unknown> = {}) {
  const mounted = await mountWith(AreaTab, { props: props(changes) })
  await vi.waitFor(() => expect(mounted.wrapper.find('.area-map-stub').exists() || mounted.wrapper.find('.area-map-error').exists()).toBe(true))
  await flushPromises()
  return mounted
}
const squash = (text: string) => text.replace(/\s+/g, '')
const totals = (changes: Record<string, unknown>) => ({ ...areaStats().totals, ...changes })
const lastView = (wrapper: VueWrapper) => wrapper.emitted('update:view')?.at(-1)?.[0] as AreaView | undefined
const areaMap = (wrapper: VueWrapper) => wrapper.findComponent({ name: 'AreaMap' })

// ---- 工具列 ----

// 範圍（1／3／6 公里）與看什麼都在 AreaTab 的工具列；真的點選項，不直接發事件。
const RADIUS_CHOICES = [1, 3, 6]
const rangeRadios = (wrapper: VueWrapper) => wrapper.get('.area-toolbar [aria-label="範圍"]').findAll('input.el-radio-button__original-radio')
async function chooseRadius(wrapper: VueWrapper, km: 1 | 3 | 6) {
  await rangeRadios(wrapper)[RADIUS_CHOICES.indexOf(km)]!.setValue()
}
const modeButtons = (wrapper: VueWrapper) => wrapper.get('.area-toolbar [aria-label="看什麼"]').findAll('.el-radio-button')
const modeInput = (wrapper: VueWrapper, label: string) =>
  modeButtons(wrapper).find((item) => item.text() === label)!.get('input').element as HTMLInputElement
const checkedMode = (wrapper: VueWrapper) =>
  modeButtons(wrapper).find((item) => (item.get('input').element as HTMLInputElement).checked)?.text()
const disabledModes = (wrapper: VueWrapper) =>
  modeButtons(wrapper).filter((item) => (item.get('input').element as HTMLInputElement).disabled).map((item) => item.text())
const modeNotes = (wrapper: VueWrapper) => wrapper.findAll('.area-toolbar__note span').map((item) => item.text())
async function chooseMode(wrapper: VueWrapper, label: string) {
  await modeButtons(wrapper).find((item) => item.text() === label)!.get('input').setValue()
  await flushPromises()
}
const radioGroup = (wrapper: VueWrapper, label: string) =>
  wrapper.findAllComponents({ name: 'ElRadioGroup' }).find((group) => group.attributes('aria-label') === label)!

// ---- 右欄、表格、頁尾 ----

const side = (wrapper: VueWrapper) => wrapper.get('.area-workbench__side')
const paneTitle = (wrapper: VueWrapper) => side(wrapper).get('h2').text()
const rankingItems = (wrapper: VueWrapper) => side(wrapper).findAll('.area-ranking__item')
const cardTitle = (wrapper: VueWrapper) => side(wrapper).get('.village-card__title')
async function openTable(wrapper: VueWrapper, tab: AreaTableTab) {
  await wrapper.get(`.area-full-tables #tab-${tab}`).trigger('click')
  await flushPromises()
}
const tableTitles = (wrapper: VueWrapper) => wrapper.findAll('.area-full-tables .stats-block__title').map((title) => title.text())
const block = (wrapper: VueWrapper, title: string) =>
  wrapper.findAll('.stats-block').find((section) => section.get('.stats-block__title').text() === title)!
const bodyRows = (section: ReturnType<typeof block>) => section.findAll('tbody tr').map((row) => row.findAll('th, td').map((cell) => cell.text()))
const PB = { code: '64000050015', district: '三民區', village: '本揚里' }

describe('區域分析：讀取、工具列與頁尾', () => {
  it('依頁首校區與學期讀區域、里界、附近幼兒園（半徑預設 3 公里）；頁尾一行寫資料版本（含在籍清冊與收費學年）', async () => {
    const { wrapper, get } = await mountTab()
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area?')[0]!))).toEqual({ campus_key: 'yihua', school_year: '115' })
    expect(pathsTo(get, '/admin/admissions/area/boundaries')).toHaveLength(1)
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/kindergartens')[0]!))).toEqual({ campus_key: 'yihua', radius_km: '3' })
    expect(wrapper.get('.area-footer__status').text()).toBe(STATUS)
  })

  it('工具列：左「看什麼」七個模式、右「範圍」1／3／6 公里（預設 3），在工作台上方；幼兒園與托嬰清單沒有自己的半徑鈕', async () => {
    const { wrapper } = await mountTab()
    const toolbar = wrapper.get('.area-toolbar')
    expect(toolbar.get('[aria-label="看什麼"]').attributes('role')).toBe('radiogroup')
    expect(modeButtons(wrapper).map((item) => item.text())).toEqual(['在籍學生', '2–5 歲孩子', '孩子增減', '新屋交屋', '參觀', '招生機會', '同業'])
    const range = toolbar.get('[aria-label="範圍"]')
    expect(range.attributes('role')).toBe('radiogroup')
    expect(range.findAll('.el-radio-button').map((item) => item.text())).toEqual(['1 公里', '3 公里', '6 公里'])
    expect(rangeRadios(wrapper).map((radio) => (radio.element as HTMLInputElement).checked)).toEqual([false, true, false])
    // 看什麼在左、範圍在右（原始碼順序），整列在工作台之前。
    const html = toolbar.html()
    expect(html.indexOf('看什麼')).toBeLessThan(html.indexOf('範圍'))
    expect(toolbar.element.compareDocumentPosition(wrapper.get('.area-workbench').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wrapper.find('[aria-label="搜尋半徑"]').exists()).toBe(false)
    await chooseRadius(wrapper, 1)
    expect(rangeRadios(wrapper).map((radio) => (radio.element as HTMLInputElement).checked)).toEqual([true, false, false])
  })

  // 畫面上點不出這幾個值（選項只有 1／3／6、模式只有七個），這條直接呼叫元件的 handler 保底。
  it('範圍只接受 1／3／6、看什麼只接受認得且沒停用的模式；其他值不改也不重讀（handler 的保底）', async () => {
    const enrolled = areaEnrolled({ status: 'not_imported' })
    const get = mockGet(routes(areaStats(), areaOpportunity(), enrolled))
    const { wrapper } = await mountReady()
    const before = pathsTo(get, '/admin/admissions/area/kindergartens').length
    const range = radioGroup(wrapper, '範圍')
    range.vm.$emit('update:modelValue', 2)
    range.vm.$emit('update:modelValue', 'abc')
    const modes = radioGroup(wrapper, '看什麼')
    modes.vm.$emit('update:modelValue', 'heatmap')
    modes.vm.$emit('update:modelValue', 'enrolled') // 停用中
    await flushPromises()
    expect(pathsTo(get, '/admin/admissions/area/kindergartens')).toHaveLength(before)
    expect(areaMap(wrapper).props('radiusKm')).toBe(3)
    expect(wrapper.emitted('update:view')).toBeUndefined()
    expect(checkedMode(wrapper)).toBe('2–5 歲孩子')
  })

  it('預設模式：清冊已匯入 → 在籍學生；未匯入 → 2–5 歲孩子；judged false 時招生機會停用並寫原因', async () => {
    const first = await mountTab()
    expect(checkedMode(first.wrapper)).toBe('在籍學生')
    expect(disabledModes(first.wrapper)).toEqual([])
    expect(modeNotes(first.wrapper)).toEqual([])
    expect(paneTitle(first.wrapper)).toBe('在籍學生')
    expect(areaMap(first.wrapper).props('mode')).toBe('enrolled')
    expect(first.wrapper.emitted('update:view')).toBeUndefined() // 預設模式不寫進網址
    cleanup()

    mockGet(routes(areaStats(), areaOpportunity(), areaEnrolled({ status: 'not_imported' })))
    const second = await mountReady()
    expect(checkedMode(second.wrapper)).toBe('2–5 歲孩子')
    expect(disabledModes(second.wrapper)).toEqual(['在籍學生'])
    expect(modeNotes(second.wrapper)).toEqual(['尚未匯入在籍名冊。'])
    expect(paneTitle(second.wrapper)).toBe('2–5 歲孩子')
    expect(side(second.wrapper).text()).toContain('本校 3 公里內 3 個里，2–5 歲孩子 1,000 位')
    expect(areaMap(second.wrapper).props('mode')).toBe('children')
    cleanup()

    const quiet = areaOpportunity({
      baseline: { ...areaOpportunity().baseline!, visit: 6, judged: false },
      villages: areaOpportunity().villages.map((row) => ({ ...row, signal: 'not_judged' as const })),
    })
    const third = await mountTab({}, areaStats(), quiet)
    expect(disabledModes(third.wrapper)).toEqual(['招生機會'])
    expect(modeNotes(third.wrapper)).toEqual([NOT_JUDGED_NOTE])
    expect(checkedMode(third.wrapper)).toBe('在籍學生')
  })

  it('點看什麼：右欄與地圖跟著換；和預設不同才寫進 view，選回預設是 null', async () => {
    const { wrapper } = await mountTab()
    await chooseMode(wrapper, '參觀')
    expect(lastView(wrapper)).toEqual({ map: 'visits', village: '', table: 'village' })
    expect(checkedMode(wrapper)).toBe('參觀')
    expect(paneTitle(wrapper)).toBe('參觀')
    expect(areaMap(wrapper).props('mode')).toBe('visits')
    expect(rankingItems(wrapper).map((item) => item.get('.area-ranking__name').text())).toEqual(['三民區本揚里', '三民區寶業里', '鼓山區龍子里'])
    await chooseMode(wrapper, '在籍學生')
    expect(lastView(wrapper)).toEqual({ map: null, village: '', table: 'village' })
    expect(areaMap(wrapper).props('mode')).toBe('enrolled')
  })

  it('停用原因寫在工具列下一行：去重、招生機會的原因排第一；全部停用時退回參觀', async () => {
    mockGet({
      ...routes(areaStats(), () => { throw new Error('boom') }, areaEnrolled({ status: 'not_imported' })),
      '/admin/admissions/area/trends': () => { throw new Error('boom') },
    })
    const { wrapper } = await mountReady()
    expect(disabledModes(wrapper)).toEqual(['在籍學生', '2–5 歲孩子', '孩子增減', '新屋交屋', '招生機會'])
    expect(modeNotes(wrapper)).toEqual(['招生機會讀取失敗。', '里的變化讀取失敗。', '尚未匯入在籍名冊。'])
    expect(checkedMode(wrapper)).toBe('參觀')
    expect(areaMap(wrapper).props('mode')).toBe('visits')
  })

  it('停用原因那一行有 id，「看什麼」radiogroup 用 aria-describedby 指過去；沒有原因就不帶', async () => {
    const quiet = await mountTab()
    expect(modeNotes(quiet.wrapper)).toEqual([])
    expect(quiet.wrapper.find('.area-toolbar__note').exists()).toBe(false)
    expect(radioGroup(quiet.wrapper, '看什麼').attributes('aria-describedby')).toBeUndefined()
    cleanup()

    mockGet(routes(areaStats(), areaOpportunity(), areaEnrolled({ status: 'not_imported' })))
    const { wrapper } = await mountReady()
    expect(modeNotes(wrapper)).toEqual(['尚未匯入在籍名冊。'])
    const note = wrapper.get('.area-toolbar__note')
    expect(note.attributes('id')).toBeTruthy()
    expect(radioGroup(wrapper, '看什麼').attributes('aria-describedby')).toBe(note.attributes('id'))
    expect(radioGroup(wrapper, '範圍').attributes('aria-describedby')).toBeUndefined()
  })

  it('falls back when map is disabled：網址 map=enrolled、清冊未匯入 → 工具列選 2–5 歲孩子、emit update:view 的 map 是 null', async () => {
    const slow = deferred<unknown>()
    mockGet(routes(areaStats(), areaOpportunity(), () => slow.promise))
    const { wrapper } = await mountReady(withView({ map: 'enrolled', table: 'school' }))
    // 讀取中不算停用：先照網址看在籍學生。
    expect(checkedMode(wrapper)).toBe('在籍學生')
    expect(wrapper.emitted('update:view')).toBeUndefined()
    slow.resolve(areaEnrolled({ status: 'not_imported' }))
    await flushPromises()
    expect(checkedMode(wrapper)).toBe('2–5 歲孩子')
    expect(modeInput(wrapper, '在籍學生').disabled).toBe(true)
    expect(modeInput(wrapper, '在籍學生').checked).toBe(false)
    expect(lastView(wrapper)).toEqual({ map: null, village: '', table: 'school' })
    expect(areaMap(wrapper).props('mode')).toBe('children')
  })

  it('v-model 由上層持有（StatsTab 接網址）：模式退回預設、清掉里界沒有的里，兩個改動都寫回上層', async () => {
    const slowBoundaries = deferred<unknown>()
    const slowEnrolled = deferred<unknown>()
    mockGet({ ...routes(areaStats(), areaOpportunity(), () => slowEnrolled.promise), '/admin/admissions/area/boundaries': () => slowBoundaries.promise })
    const view = ref<AreaView>({ map: 'enrolled', village: '64000099999', table: 'school' })
    const Host = defineComponent({
      setup: () => () => h(AreaTab, { ...props(), view: view.value, 'onUpdate:view': (next: AreaView) => { view.value = next } }),
    })
    const { wrapper } = await mountWith(Host)
    await vi.waitFor(() => expect(wrapper.find('.area-toolbar').exists()).toBe(true))
    slowBoundaries.resolve(villageBoundaries())
    slowEnrolled.resolve(areaEnrolled({ status: 'not_imported' }))
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await flushPromises()
    expect(view.value).toEqual({ map: null, village: '', table: 'school' })
  })

  it('同一個畫面裡網址換到停用的模式（上一頁／下一頁）：也退回預設、map 寫回 null，不來回觸發', async () => {
    mockGet(routes(areaStats(), areaOpportunity(), areaEnrolled({ status: 'not_imported' })))
    const { wrapper } = await mountReady()
    expect(checkedMode(wrapper)).toBe('2–5 歲孩子')
    expect(wrapper.emitted('update:view')).toBeUndefined()
    await wrapper.setProps({ view: { ...DEFAULT_AREA_VIEW, map: 'enrolled' } })
    await flushPromises()
    expect(wrapper.emitted('update:view')).toEqual([[{ map: null, village: '', table: 'village' }]])
    expect(checkedMode(wrapper)).toBe('2–5 歲孩子')
  })
})

describe('區域分析：選取的里', () => {
  it('點地圖的里：view.village 寫入、右欄出現里卡片、aria-live 報已選取三民區本揚里', async () => {
    const { wrapper } = await mountTab()
    areaMap(wrapper).vm.$emit('select-village', PB)
    await flushPromises()
    expect(lastView(wrapper)).toEqual({ map: null, village: '64000050015', table: 'village' })
    expect(cardTitle(wrapper).text()).toBe('三民區本揚里')
    expect(side(wrapper).get('[aria-live="polite"]').text()).toBe('已選取三民區本揚里')
    expect(areaMap(wrapper).props('selectedCode')).toBe('64000050015')
    // 從地圖點選不搶焦點、不移地圖。
    expect(document.activeElement).not.toBe(cardTitle(wrapper).element)
    expect(mapStub.focusVillage).not.toHaveBeenCalled()
    expect(wrapper.findAll('[aria-live="polite"]')).toHaveLength(1)
  })

  it('已選取的里在地圖上再點一次：不取消、不再 emit update:view；從排行選的再從地圖點，報讀改成已選取', async () => {
    const { wrapper } = await mountTab()
    await rankingItems(wrapper)[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('update:view')).toHaveLength(1)
    expect(side(wrapper).get('[aria-live="polite"]').text()).toBe('')
    areaMap(wrapper).vm.$emit('select-village', PB)
    await flushPromises()
    expect(wrapper.emitted('update:view')).toHaveLength(1)
    expect(cardTitle(wrapper).text()).toBe('三民區本揚里')
    expect(side(wrapper).get('[aria-live="polite"]').text()).toBe('已選取三民區本揚里')
  })

  it('從排行選里：focusVillage 被呼叫、焦點到卡片標題；Esc 關卡片、village 清空', async () => {
    const { wrapper } = await mountTab()
    expect(rankingItems(wrapper)[0]!.text()).toContain('三民區本揚里')
    await rankingItems(wrapper)[0]!.trigger('click')
    await flushPromises()
    expect(lastView(wrapper)!.village).toBe('64000050015')
    expect(mapStub.focusVillage).toHaveBeenCalledWith('64000050015')
    expect(document.activeElement).toBe(cardTitle(wrapper).element)
    expect(side(wrapper).get('[aria-live="polite"]').text()).toBe('') // 焦點已到標題，不重複報讀
    await side(wrapper).get('.village-card').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(lastView(wrapper)!.village).toBe('')
    expect(side(wrapper).find('.village-card').exists()).toBe(false)
    expect(rankingItems(wrapper).length).toBeGreaterThan(0)
    // 卡片卸載後焦點不掉到 body：留在右欄。
    expect(document.activeElement).toBe(side(wrapper).element)
  })

  it('各里表點里名：同排行選里（地圖移過去、焦點到卡片標題）；按 × 關閉', async () => {
    const { wrapper } = await mountTab()
    await wrapper.get('.area-full-tables .stats-table__name-link').trigger('click')
    await flushPromises()
    expect(mapStub.focusVillage).toHaveBeenCalledWith('64000050001')
    expect(cardTitle(wrapper).text()).toBe('三民區鼎金里')
    expect(document.activeElement).toBe(cardTitle(wrapper).element)
    await side(wrapper).get('button[aria-label="關閉里卡片"]').trigger('click')
    await flushPromises()
    expect(lastView(wrapper)!.village).toBe('')
    expect(document.activeElement).toBe(side(wrapper).element)
  })

  it('手機：從排行選里後把卡片捲到畫面上（scrollIntoView block start）', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      const { wrapper } = await mountTab()
      expect(areaMap(wrapper).props('narrow')).toBe(true)
      await rankingItems(wrapper)[0]!.trigger('click')
      await flushPromises()
      expect(scroll).toHaveBeenCalledWith({ block: 'start' })
      expect(scroll.mock.contexts.at(-1)).toBe(side(wrapper).element)
    } finally {
      vi.unstubAllGlobals()
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  it('手機：點地圖的里也捲到卡片、焦點不動', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      const { wrapper } = await mountTab()
      const before = document.activeElement
      areaMap(wrapper).vm.$emit('select-village', PB)
      await flushPromises()
      expect(cardTitle(wrapper).text()).toBe('三民區本揚里')
      expect(scroll).toHaveBeenCalledTimes(1)
      expect(scroll).toHaveBeenCalledWith({ block: 'start' })
      expect(scroll.mock.contexts[0]).toBe(side(wrapper).element)
      expect(document.activeElement).toBe(before)
      expect(mapStub.focusVillage).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  it('桌機（沒有 matchMedia）：點地圖的里不捲動頁面', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      const { wrapper } = await mountTab()
      areaMap(wrapper).vm.$emit('select-village', PB)
      await flushPromises()
      expect(cardTitle(wrapper).text()).toBe('三民區本揚里')
      expect(scroll).not.toHaveBeenCalled()
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  // 視窗寬度：只回答 max-width 查詢（AreaTab 用 720px 判斷手機、1199px 判斷工作台是否單欄）。
  function stubViewport(width: number) {
    vi.stubGlobal('matchMedia', (query: string) => {
      const max = /max-width:\s*(\d+)px/.exec(query)?.[1]
      return { matches: max ? width <= Number(max) : false, media: query, addEventListener: () => {}, removeEventListener: () => {} }
    })
  }
  async function withViewport(width: number, run: (scroll: ReturnType<typeof vi.fn>) => Promise<void>) {
    stubViewport(width)
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      await run(scroll)
    } finally {
      vi.unstubAllGlobals()
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  }

  it('721–1199px（單欄、地圖在上）：點地圖的里把卡片捲進視野，block nearest（地圖留在視野裡），焦點不動', async () => {
    await withViewport(1024, async (scroll) => {
      const { wrapper } = await mountTab()
      expect(areaMap(wrapper).props('narrow')).toBe(false)
      const before = document.activeElement
      areaMap(wrapper).vm.$emit('select-village', PB)
      await flushPromises()
      expect(cardTitle(wrapper).text()).toBe('三民區本揚里')
      expect(scroll).toHaveBeenCalledTimes(1)
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
      expect(scroll.mock.contexts[0]).toBe(side(wrapper).element)
      expect(document.activeElement).toBe(before)
      expect(mapStub.focusVillage).not.toHaveBeenCalled()
    })
  })

  it('剛好 720px 是手機（block start）、1199px 仍是單欄（nearest）、1200px 並排不捲', async () => {
    await withViewport(720, async (scroll) => {
      const { wrapper } = await mountTab()
      areaMap(wrapper).vm.$emit('select-village', PB)
      await flushPromises()
      expect(scroll).toHaveBeenCalledWith({ block: 'start' })
    })
    cleanup()
    await withViewport(1199, async (scroll) => {
      const { wrapper } = await mountTab()
      areaMap(wrapper).vm.$emit('select-village', PB)
      await flushPromises()
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    })
    cleanup()
    await withViewport(1200, async (scroll) => {
      const { wrapper } = await mountTab()
      areaMap(wrapper).vm.$emit('select-village', PB)
      await flushPromises()
      expect(cardTitle(wrapper).text()).toBe('三民區本揚里')
      expect(scroll).not.toHaveBeenCalled()
    })
  })

  it.each([[390, 'start'], [1024, 'nearest']] as const)(
    '%ipx：已選取的里在地圖上再點一次：照樣捲到卡片（%s），但不重寫網址、不搶焦點',
    async (width, block) => {
      await withViewport(width, async (scroll) => {
        const { wrapper } = await mountTab()
        areaMap(wrapper).vm.$emit('select-village', PB)
        await flushPromises()
        expect(scroll).toHaveBeenCalledTimes(1)
        const updates = wrapper.emitted('update:view')!.length
        const before = document.activeElement
        areaMap(wrapper).vm.$emit('select-village', PB)
        await flushPromises()
        expect(scroll).toHaveBeenCalledTimes(2)
        expect(scroll).toHaveBeenLastCalledWith({ block })
        expect(wrapper.emitted('update:view')).toHaveLength(updates)
        expect(document.activeElement).toBe(before)
        expect(mapStub.focusVillage).not.toHaveBeenCalled()
      })
    },
  )

  it('桌機（1200px 以上）：已選取的里再點一次也不捲', async () => {
    await withViewport(1440, async (scroll) => {
      const { wrapper } = await mountTab()
      areaMap(wrapper).vm.$emit('select-village', PB)
      areaMap(wrapper).vm.$emit('select-village', PB)
      await flushPromises()
      expect(scroll).not.toHaveBeenCalled()
    })
  })

  it('keeps village until boundaries arrive：里界讀取中不清 village；里界到了沒有這個代碼才清', async () => {
    const slow = deferred<unknown>()
    mockGet({ ...routes(), '/admin/admissions/area/boundaries': () => slow.promise })
    const missing = await mountWith(AreaTab, { props: props(withView({ village: '64000099999' })) })
    await vi.waitFor(() => expect(missing.wrapper.find('.area-toolbar').exists()).toBe(true))
    await flushPromises()
    expect(missing.wrapper.emitted('update:view')).toBeUndefined()
    slow.resolve(villageBoundaries())
    await vi.waitFor(() => expect(missing.wrapper.find('.area-map-stub').exists()).toBe(true))
    await flushPromises()
    expect(lastView(missing.wrapper)).toEqual({ map: null, village: '', table: 'village' })
    cleanup()

    // 里界裡有的代碼：讀到後照開卡片，不清。
    const slowAgain = deferred<unknown>()
    mockGet({ ...routes(), '/admin/admissions/area/boundaries': () => slowAgain.promise })
    const kept = await mountWith(AreaTab, { props: props(withView({ village: '64000050015' })) })
    await vi.waitFor(() => expect(kept.wrapper.find('.area-toolbar').exists()).toBe(true))
    slowAgain.resolve(villageBoundaries())
    await vi.waitFor(() => expect(kept.wrapper.find('.village-card').exists()).toBe(true))
    expect(kept.wrapper.emitted('update:view')).toBeUndefined()
    expect(cardTitle(kept.wrapper).text()).toBe('三民區本揚里')
    cleanup()

    // 里界讀取失敗：永遠沒載到，不清。
    mockGet({ ...routes(), '/admin/admissions/area/boundaries': () => { throw new Error('boom') } })
    const failed = await mountReady(withView({ village: '64000099999' }))
    expect(failed.wrapper.find('.area-map-error').exists()).toBe(true)
    expect(failed.wrapper.emitted('update:view')).toBeUndefined()
  })

  it('換半徑：保留選取的里，半徑外改限縮卡片', async () => {
    const near = (rows: { codes?: string[]; village_code?: string }[]) =>
      rows.filter((row) => !(row.codes ?? [row.village_code]).includes('64000050015'))
    mockGet({
      ...routes(),
      '/admin/admissions/area/opportunity': (path: string) =>
        queryOf(path).get('radius_km') === '1' ? areaOpportunity({ radius_km: 1, villages: near(areaOpportunity().villages) as never }) : areaOpportunity(),
      '/admin/admissions/area/trends': (path: string) =>
        queryOf(path).get('radius_km') === '1' ? areaTrends({ radius_km: 1, villages: near(areaTrends().villages) as never }) : areaTrends(),
    })
    const { wrapper } = await mountReady(withView({ village: '64000050015' }))
    expect(side(wrapper).find('.village-card__rows').exists()).toBe(true)
    expect(side(wrapper).text()).toContain('2–5 歲')
    await chooseRadius(wrapper, 1)
    await flushPromises()
    expect(wrapper.emitted('update:view')).toBeUndefined()
    expect(cardTitle(wrapper).text()).toBe('三民區本揚里')
    expect(side(wrapper).get('.village-card__note').text()).toBe('在本校 1 公里外，孩子數只算範圍內的里；把範圍改成 3 公里就看得到。')
    expect(side(wrapper).get('.village-card__subtitle').text()).toBe('在本校 1 公里外')
  })

  it('卡片重試：孩子段只重讀讀取失敗的那份；我們段只重讀在籍（區域分析已經在畫面上，不整頁重讀）', async () => {
    let failOpportunity = true
    let failEnrolled = true
    const get = mockGet(routes(
      areaStats(),
      () => { if (failOpportunity) throw new Error('boom'); return areaOpportunity() },
      () => { if (failEnrolled) throw new Error('boom'); return areaEnrolled() },
    ))
    const { wrapper } = await mountReady(withView({ village: '64000050015' }))
    const sections = () => side(wrapper).findAll('.village-card__section')
    expect(sections()[0]!.text()).toContain('讀取失敗')
    expect(sections()[1]!.text()).toContain('讀取失敗')
    const count = (path: string) => pathsTo(get, path).length
    const before = { area: count('/admin/admissions/area?'), trends: count('/admin/admissions/area/trends'), opportunity: count('/admin/admissions/area/opportunity'), enrolled: count('/admin/admissions/area/enrolled') }
    failOpportunity = false
    failEnrolled = false
    await button(sections()[0]!, '重試')!.trigger('click')
    await flushPromises()
    expect(count('/admin/admissions/area/opportunity')).toBe(before.opportunity + 1)
    expect(count('/admin/admissions/area/trends')).toBe(before.trends)
    expect(sections()[0]!.find('.village-card__rows').exists()).toBe(true)
    await button(sections()[1]!, '重試')!.trigger('click')
    await flushPromises()
    expect(count('/admin/admissions/area/enrolled')).toBe(before.enrolled + 1)
    expect(count('/admin/admissions/area?')).toBe(before.area)
    expect(sections()[1]!.text()).toContain('在籍')
    expect(sections()[1]!.text()).not.toContain('讀取失敗')
  })

  it('卡片的「查看這個里的訪視」、參觀來源的「查看明細」、頁尾的「查看」都交給頁面帶區域', async () => {
    const { wrapper } = await mountTab(withView({ village: '64000050015' }))
    await button(side(wrapper), '查看這個里的訪視')!.trigger('click')
    await openTable(wrapper, 'visits')
    await block(wrapper, '行政區排行').findAll('tbody button')[0]!.trigger('click')
    await button(wrapper.get('.area-footer'), '查看')!.trigger('click')
    expect(wrapper.emitted('open-records')).toEqual([[{ area: '三民區/本揚里' }], [{ area: '三民區' }], [{ area: 'no_village' }]])
  })

  it('同業模式：右欄是附近清單與園所變化；清單沒有半徑鈕', async () => {
    const { wrapper } = await mountTab()
    expect(wrapper.findComponent(NearbyPanel).exists()).toBe(false)
    await chooseMode(wrapper, '同業')
    expect(lastView(wrapper)!.map).toBe('peers')
    expect(areaMap(wrapper).props('mode')).toBe('peers')
    expect(paneTitle(wrapper)).toBe('附近的同業')
    const peers = side(wrapper).get('.area-peers')
    expect(peers.element.children[0]!.classList.contains('nearby-panel')).toBe(true)
    expect(peers.element.children[1]!.classList.contains('changes')).toBe(true)
    expect(wrapper.findComponent(NearbyPanel).props('radiusKm')).toBe(3)
    expect(wrapper.findAll('[aria-label="範圍"]')).toHaveLength(1)
    expect(wrapper.find('[aria-label="搜尋半徑"]').exists()).toBe(false)
    expect(wrapper.findAll('.changes__item').map((row) => row.get('.changes__name').text())).toEqual(['頂尖小子托嬰中心', '保羅幼兒園', '三多哈波特幼兒園'])
    // 同業模式選了里照樣顯示卡片，關掉回到清單。
    areaMap(wrapper).vm.$emit('select-village', PB)
    await flushPromises()
    expect(side(wrapper).get('.nearby-panel').isVisible()).toBe(false)
    await side(wrapper).get('button[aria-label="關閉里卡片"]').trigger('click')
    await flushPromises()
    expect(side(wrapper).get('.nearby-panel').isVisible()).toBe(true)
  })

  it('同業模式：搜尋字、選了里再關掉卡片之後還在（附近清單沒有被卸載重掛）', async () => {
    const { wrapper } = await mountTab()
    await chooseMode(wrapper, '同業')
    const search = () => side(wrapper).get('input[aria-label="搜尋幼兒園"]')
    await search().setValue('保羅')
    expect((search().element as HTMLInputElement).value).toBe('保羅')
    areaMap(wrapper).vm.$emit('select-village', PB)
    await flushPromises()
    expect(cardTitle(wrapper).text()).toBe('三民區本揚里')
    await side(wrapper).get('button[aria-label="關閉里卡片"]').trigger('click')
    await flushPromises()
    expect(search().isVisible()).toBe(true)
    expect((search().element as HTMLInputElement).value).toBe('保羅')
  })

  it('頁尾：參觀有地址那句＋查看、資料版本一行；頁首不再有狀態列', async () => {
    const { wrapper } = await mountTab()
    const footer = wrapper.get('.area-footer')
    expect(squash(footer.get('.area-footer__summary').text())).toBe('參觀有地址7筆：到里5筆、未定位到里2筆（只到區1、查無門牌1）查看；另有2筆沒填地址')
    expect(button(footer, '查看')!.attributes('aria-label')).toBe('查看未定位到里的訪視明細')
    expect(footer.get('.area-footer__status').text()).toBe(STATUS)
    for (const gone of ['.area-head', '.area-status', '.area-summary', '.area-top', '.area-tables']) expect(wrapper.find(gone).exists(), gone).toBe(false)
    // 順序：工具列 → 工作台 → 完整表格 → 頁尾。
    const order = ['.area-toolbar', '.area-workbench', '.area-full-tables', '.area-footer'].map((selector) => wrapper.get(selector).element)
    for (let index = 1; index < order.length; index++) {
      expect(order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('原始碼掃描：沒有 OpportunityPanel／VillageTrendsPanel、沒有 .area-tables 規則', () => {
    expect(areaTabSource).not.toMatch(/OpportunityPanel|VillageTrendsPanel/)
    expect(areaTabSource).not.toMatch(/\.area-(tables|head|top|status|summary)\b/)
    const panels = Object.keys(import.meta.glob('../components/admissions/area/*.vue'))
    expect(panels.some((path) => path.endsWith('/AreaTab.vue'))).toBe(true)
    expect(panels.filter((path) => /OpportunityPanel|VillageTrendsPanel/.test(path))).toEqual([])
  })

  it('版面：工作台 ≥1200px 兩欄（地圖＋380px 右欄）、右欄高度跟著地圖畫布的自訂屬性；圓角兩邊一致；≤720px 看什麼橫捲不換行、留細捲軸', () => {
    const style = /<style scoped>([\s\S]*)<\/style>/.exec(areaTabSource)![1]!
    const wide = /@media \(min-width: 1200px\) \{([\s\S]*?)\n\}/.exec(style)![1]!
    const outside = style.replace(/\n@media \([^)]*\) \{[\s\S]*?\n\}/g, '')
    // 畫布高度只寫一次（工作台的 --area-map-canvas），AreaMap 的畫布與右欄都讀它；不再覆寫 AreaMap 的內部樣式。
    expect(outside).toMatch(/\.area-workbench \{[^}]*--area-map-canvas: 620px;[^}]*--area-map-radius: var\(--radius-lg\);/)
    expect(wide).toMatch(/\.area-workbench \{[^}]*--area-map-radius: var\(--radius-lg\) 0 0 var\(--radius-lg\);[^}]*grid-template-columns: minmax\(0, 1fr\) 380px/)
    expect(wide).toMatch(/\.area-workbench__side \{[^}]*height: calc\(var\(--area-map-canvas\) \+ 2px\);[^}]*border-inline-start: 0;/)
    expect(wide).toMatch(/\.area-workbench__placeholder \{[^}]*min-height: calc\(var\(--area-map-canvas\) \+ 2px\)/)
    expect(style).not.toMatch(/:deep\(|622px/)
    // 1200px 以下地圖框、佔位框與右欄同一個圓角。
    expect(outside).toMatch(/\.area-workbench__side \{[^}]*border: 1px solid var\(--line\);[^}]*border-radius: var\(--radius-lg\);/)
    expect(outside).toMatch(/\.area-workbench__placeholder \{[^}]*border: 1px solid var\(--line\);[^}]*border-radius: var\(--area-map-radius\);/)
    const mapSource = readFileSync(join(__dirname, '..', 'components', 'admissions', 'area', 'AreaMap.vue'), 'utf8')
    expect(mapSource).toMatch(/\.area-map__frame \{[^}]*border-radius: var\(--area-map-radius, var\(--radius\)\);/)
    expect(mapSource).toMatch(/\.area-map__canvas \{[^}]*height: var\(--area-map-canvas, 620px\);/)
    expect(mapSource).toMatch(/@media \(max-width: 720px\) \{\s*\.area-map__canvas \{\s*height: 50vh;\s*min-height: 280px;/)
    const narrow = /@media \(max-width: 720px\) \{([\s\S]*?)\n\}/.exec(style)![1]!
    expect(narrow).toMatch(/\.area-toolbar__modes \{[^}]*overflow-x: auto;[^}]*scrollbar-width: thin;/)
    expect(narrow).not.toContain('scrollbar-width: none')
    expect(narrow).toMatch(/\.area-toolbar__mode-group \{[^}]*flex-wrap: nowrap/)
    expect(style).not.toMatch(/rgba?\(|oklch\(|hsla?\(|#[0-9a-fA-F]{3,8}\b/)
  })
})

describe('區域分析：空狀態與版面守門', () => {
  // 區域分析的空狀態（.empty-note）由各面板自己畫（參觀來源、右欄），AreaTab 不再有自己的 .area-empty；統計總覽照舊。
  it('空狀態外觀共用 .empty-note：沒有自己的 .area-empty／.stats-empty 樣式，全域樣式只用 token', () => {
    expect(areaTabSource).not.toMatch(/\.area-empty\s*\{/)
    expect(statsTabSource).not.toMatch(/\.stats-empty\s*\{/)
    expect(statsTabSource).toContain('class="empty-note stats-empty"')
    const globalStyle = readFileSync(join(__dirname, '..', 'style.css'), 'utf8')
    const rule = /\n\.empty-note \{([^}]*)\}/.exec(globalStyle)?.[1]
    expect(rule, 'style.css 要有 .empty-note').toBeDefined()
    expect(rule).toContain('border: 1px dashed var(--line-strong)')
    expect(rule).toContain('color: var(--ink-2)')
    expect(rule).toContain('text-align: center')
    expect(rule).not.toMatch(/rgba?\(|oklch\(|hsla?\(|#[0-9a-fA-F]{3,8}\b/)
  })

  it('不用 as 轉型', () => {
    expect(areaTabSource).not.toMatch(/\bas Area(District|Village)Row\b/)
    expect(areaTabSource).not.toContain('as unknown as')
  })

  it('門牌資料還沒匯入：頁尾那句以句號結尾，後面直接接幼兒園名單，不接「。・」', async () => {
    const area = areaStats({ data_status: { ...areaStats().data_status, doorplate_version: null, doorplates_synced_at: null } })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.get('.area-footer__status').text()).toBe(
      '門牌資料尚未匯入，家長地址暫時對不到里、算不出距離；匯入後自動補上。幼兒園名單 10/08 更新・托嬰名單 10/14 更新・各里人口 115 年 9 月・在籍清冊 2026/10/15・收費 114 學年公告（目前是 115 學年）',
    )
  })

  it.each([
    [{ no_address: 3, anonymized: 0 }, '這個範圍的訪視都還沒填地址。'],
    [{ no_address: 0, anonymized: 4 }, '這個範圍的訪視地址都已依保存期限清除，無法比對。'],
    [{ no_address: 3, anonymized: 2 }, '這個範圍的訪視沒有可比對的地址：3 筆沒填地址、2 筆已依保存期限清除。'],
  ])('有訪視但沒有可比對的地址（%o）：頁尾寫原因、參觀來源不列三張表（不顯示假的 0）；地圖照常', async (counts, text) => {
    const area = areaStats({
      totals: totals({ visit: counts.no_address + counts.anonymized, with_address: 0, village_level: 0, district_level: 0, unlocated: 0, pending: 0, unlocated_reasons: [], ...counts }),
      districts: [], villages: [],
    })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.get('.area-footer__summary').text()).toBe(text)
    expect(button(wrapper.get('.area-footer'), '查看')).toBeUndefined()
    await openTable(wrapper, 'visits')
    expect(wrapper.findAll('.area-full-tables .stats-block')).toHaveLength(0)
    expect(wrapper.get('.area-full-tables .empty-note').text()).toBe(text)
    expect(wrapper.find('.area-map-stub').exists()).toBe(true)
  })

  it('範圍內沒有訪視（D14）：只有參觀、招生機會模式的右欄與參觀來源分頁寫 emptyText；頁尾、工具列不寫', async () => {
    const area = areaStats({
      totals: totals({ visit: 0, with_address: 0, village_level: 0, district_level: 0, unlocated: 0, pending: 0, no_address: 0, anonymized: 0, unlocated_reasons: [] }),
      districts: [], villages: [], distance_bands: areaStats().distance_bands.map((band) => ({ ...band, visit: 0, deposit: 0, visit_to_deposit_rate: null })),
    })
    const { wrapper } = await mountTab({}, area)
    expect(side(wrapper).text()).not.toContain(EMPTY_TEXT)
    expect(wrapper.get('.area-toolbar').text()).not.toContain(EMPTY_TEXT)
    expect(wrapper.get('.area-footer').text()).not.toContain(EMPTY_TEXT)
    await chooseMode(wrapper, '參觀')
    expect(side(wrapper).get('.area-pane__empty').text()).toBe(EMPTY_TEXT)
    await chooseMode(wrapper, '招生機會')
    expect(side(wrapper).get('.area-pane__empty').text()).toBe(EMPTY_TEXT)
    await openTable(wrapper, 'visits')
    expect(wrapper.get('.area-full-tables .empty-note').text()).toBe(EMPTY_TEXT)
  })

  it('門牌資料還沒匯入（家長地址全是「待比對」）：頁尾寫原因，參觀來源三張表照常出現、空的寫各自的空狀態，不整頁壞掉', async () => {
    const empty = areaStats().distance_bands.map((band) => ({
      ...band, visit: band.band === 'none' ? 7 : 0, deposit: 0, visit_to_deposit_rate: band.band === 'none' ? 0 : null,
      visit_to_deposit_range: band.band === 'none' ? { low: 8, high: 35 } : null,
    }))
    const area = areaStats({
      data_status: { ...areaStats().data_status, doorplate_version: null, doorplates_synced_at: null },
      totals: totals({ visit: 9, with_address: 7, village_level: 0, district_level: 0, unlocated: 0, pending: 7, no_address: 2, anonymized: 0, unlocated_reasons: [] }),
      districts: [], villages: [], distance_bands: empty,
    })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.get('.area-footer__status').text()).toContain('門牌資料尚未匯入')
    expect(squash(wrapper.get('.area-footer__summary').text())).toBe('參觀有地址7筆：到里0筆、未定位到里7筆（待比對7）查看；另有2筆沒填地址')
    await openTable(wrapper, 'visits')
    expect(tableTitles(wrapper)).toEqual(['行政區排行', '里排行', '距離分布'])
    expect(block(wrapper, '行政區排行').text()).toContain('這個範圍還沒有比對到行政區的地址')
    expect(block(wrapper, '里排行').text()).toContain('這個範圍還沒有定位到里的地址')
    expect(bodyRows(block(wrapper, '距離分布')).find((row) => row[0] === '無距離')).toEqual(['無距離', '7', '0', '0.0%', '8–35%'])
    expect(wrapper.findComponent({ name: 'AreaMap' }).exists()).toBe(true)
  })
})

describe('區域分析：各份資料各自成敗', () => {
  it('區域讀取失敗：錯誤與重新載入，重試成功恢復', async () => {
    let fail = true
    mockGet({ ...routes(), '/admin/admissions/area': () => { if (fail) throw new Error('boom'); return areaStats() } })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    expect(wrapper.text()).toContain('無法讀取區域分析，請重新載入。')
    expect(wrapper.find('.area-toolbar').exists()).toBe(false)
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.area-footer').exists()).toBe(true)
  })

  it('區域讀取中：整塊是骨架', async () => {
    const slow = deferred<unknown>()
    mockGet({ ...routes(), '/admin/admissions/area': () => slow.promise })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await flushPromises()
    expect(wrapper.find('.area > .el-skeleton').exists()).toBe(true)
    expect(wrapper.find('.area-toolbar').exists()).toBe(false)
    slow.resolve(areaStats())
    await vi.waitFor(() => expect(wrapper.find('.area-toolbar').exists()).toBe(true))
  })

  it('里界讀取失敗：地圖區寫錯誤與重試，工具列、右欄、表格照常；重試成功出現地圖', async () => {
    let fail = true
    mockGet({ ...routes(), '/admin/admissions/area/boundaries': () => { if (fail) throw new Error('boom'); return villageBoundaries() } })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-error').exists()).toBe(true))
    await flushPromises()
    expect(wrapper.get('.area-map-error').text()).toContain('里界載入失敗，地圖無法顯示。')
    expect(wrapper.find('.area-workbench__placeholder .area-map-error').exists()).toBe(true)
    expect(modeButtons(wrapper)).toHaveLength(7)
    expect(paneTitle(wrapper)).toBe('在籍學生')
    expect(wrapper.find('.area-full-tables').exists()).toBe(true)
    fail = false
    await button(wrapper.get('.area-map-error'), '重試')!.trigger('click')
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
  })

  it('里界讀取中：地圖區是骨架，右欄與表格照常', async () => {
    const slow = deferred<unknown>()
    mockGet({ ...routes(), '/admin/admissions/area/boundaries': () => slow.promise })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-toolbar').exists()).toBe(true))
    await flushPromises()
    expect(wrapper.find('.area-workbench__map .area-workbench__placeholder .el-skeleton').exists()).toBe(true)
    expect(rankingItems(wrapper).length).toBeGreaterThan(0)
    slow.resolve(villageBoundaries())
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
  })

  it('快速切換校區只顯示最後一次（明華先回、義華晚回也不會蓋掉）', async () => {
    const slow = deferred<unknown>()
    mockGet({
      ...routes(),
      '/admin/admissions/area': (path: string) => (queryOf(path).get('campus_key') === 'yihua' ? slow.promise : areaStats({ campus: { key: 'minghua', name: '明華', lat: 22.663189, lng: 120.306301, locate_error: null } })),
    })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    slow.resolve(areaStats())
    await flushPromises()
    await vi.waitFor(() => expect(areaMap(wrapper).exists()).toBe(true))
    expect(areaMap(wrapper).props('campus')).toMatchObject({ key: 'minghua' })
  })

  it('地圖拿到里界、各里數字、本校、幼兒園與半徑；同業清單點一列地圖跟著移過去', async () => {
    const { wrapper } = await mountTab()
    expect(areaMap(wrapper).props()).toMatchObject({ campusName: '義華', radiusKm: 3, narrow: false, boundaries: villageBoundaries(), villages: areaStats().villages })
    expect(areaMap(wrapper).props('kindergartens')).toHaveLength(4)
    await chooseMode(wrapper, '同業')
    wrapper.findComponent(NearbyKindergartens).vm.$emit('select', 'kg-public')
    expect(mapStub.focus).toHaveBeenCalledWith('kg-public')
  })

  it('里界 GeoJSON 不被包成響應式（893 個 feature 逐層包 Proxy 會拖慢地圖）', async () => {
    const { wrapper } = await mountTab()
    const boundaries = areaMap(wrapper).props('boundaries') as ReturnType<typeof villageBoundaries>
    expect(isReactive(boundaries)).toBe(false)
    expect(isReactive(boundaries.features)).toBe(false)
    expect(isReactive(boundaries.features[0])).toBe(false)
  })

  it('換半徑：先清空清單（骨架）再重讀帶 radius_km，地圖半徑跟著變；回來後才有資料', async () => {
    const slow = deferred<unknown>()
    let first = true
    mockGet({
      ...routes(),
      '/admin/admissions/area/kindergartens': () => {
        if (first) { first = false; return areaKindergartens() }
        return slow.promise
      },
    })
    const { wrapper } = await mountReady(withView({ map: 'peers' }))
    expect(wrapper.findComponent(NearbyKindergartens).props('data')).not.toBeNull()
    await chooseRadius(wrapper, 6)
    await flushPromises()
    expect(wrapper.findComponent(NearbyKindergartens).props('data')).toBeNull()
    expect(areaMap(wrapper).props('kindergartens')).toEqual([])
    expect(areaMap(wrapper).props('radiusKm')).toBe(6)
    slow.resolve(areaKindergartens(undefined, { radius_km: 6 }))
    await flushPromises()
    expect(wrapper.findComponent(NearbyKindergartens).props('data')).toMatchObject({ radius_km: 6 })
    expect(areaMap(wrapper).props('kindergartens')).toHaveLength(4)
  })

  it('附近幼兒園讀取失敗：只有清單那一塊寫錯誤與重試，各里表、地圖照常；重試成功清單回來', async () => {
    let fail = true
    mockGet({ ...routes(), '/admin/admissions/area/kindergartens': () => { if (fail) throw new Error('boom'); return areaKindergartens() } })
    const { wrapper } = await mountReady(withView({ map: 'peers' }))
    expect(side(wrapper).text()).toContain('無法讀取附近幼兒園。')
    expect(wrapper.text()).not.toContain('無法讀取區域分析')
    expect(wrapper.find('.area-footer__summary').exists()).toBe(true)
    expect(bodyRows(block(wrapper, '各里（本校 3 公里內）'))).toHaveLength(3)
    expect(areaMap(wrapper).props('kindergartens')).toEqual([])
    fail = false
    await button(side(wrapper), '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('無法讀取附近幼兒園。')
    expect(wrapper.findAll('.nearby__name')).toHaveLength(4)
    expect(areaMap(wrapper).props('kindergartens')).toHaveLength(4)
  })

  it('連續換半徑：先送出的 3 公里晚回，不蓋掉後來選的 6 公里（清單與地圖都是 6 公里的）', async () => {
    const slow3 = deferred<unknown>()
    mockGet({
      ...routes(),
      '/admin/admissions/area/kindergartens': (path: string) => {
        const radius = queryOf(path).get('radius_km')
        if (radius === '3') return slow3.promise
        return areaKindergartens(areaKindergartens().items.slice(0, 2), { radius_km: Number(radius) })
      },
    })
    const { wrapper } = await mountWith(AreaTab, { props: props(withView({ map: 'peers' })) })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await chooseRadius(wrapper, 6)
    await flushPromises()
    expect(wrapper.findComponent(NearbyKindergartens).props('data')).toMatchObject({ radius_km: 6 })
    slow3.resolve(areaKindergartens(undefined, { radius_km: 3 }))
    await flushPromises()
    expect(wrapper.findComponent(NearbyKindergartens).props('data')).toMatchObject({ radius_km: 6 })
    expect(wrapper.findAll('.nearby__name')).toHaveLength(2)
    expect(areaMap(wrapper).props('kindergartens')).toHaveLength(2)
    expect(areaMap(wrapper).props('radiusKm')).toBe(6)
  })

  it('連續換半徑：舊的請求晚到的失敗，也不會蓋掉新的成功（不出現錯誤提示）', async () => {
    const slow3 = deferred<unknown>()
    mockGet({
      ...routes(),
      '/admin/admissions/area/kindergartens': (path: string) => (queryOf(path).get('radius_km') === '3' ? slow3.promise : areaKindergartens(undefined, { radius_km: 6 })),
    })
    const { wrapper } = await mountWith(AreaTab, { props: props(withView({ map: 'peers' })) })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await chooseRadius(wrapper, 6)
    await flushPromises()
    slow3.reject(new Error('timeout'))
    await flushPromises()
    expect(wrapper.text()).not.toContain('無法讀取附近幼兒園。')
    expect(wrapper.findAll('.nearby__name')).toHaveLength(4)
  })
})

describe('招生機會（2026-10-13 規格 7）', () => {
  it('依頁首校區、學期與半徑讀招生機會；換半徑重讀並帶 radius_km', async () => {
    const { wrapper, get } = await mountTab()
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/opportunity')[0]!)))
      .toEqual({ campus_key: 'yihua', school_year: '115', radius_km: '3' })
    await chooseRadius(wrapper, 1)
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/area/opportunity').at(-1)!).get('radius_km')).toBe('1')
  })

  it('人口沒匯入：工具列的 2–5 歲孩子與招生機會停用，原因寫一次', async () => {
    const missing = areaOpportunity({ population: { ...areaOpportunity().population, version: null, synced_at: null }, baseline: null, villages: [] })
    const { wrapper } = await mountTab({}, areaStats(), missing)
    expect(disabledModes(wrapper)).toEqual(['2–5 歲孩子', '招生機會'])
    expect(modeNotes(wrapper)).toEqual(['各里人口資料尚未匯入；匯入後就能看哪些里孩子多、參觀少。'])
  })

  it('本校沒座標：停用原因寫本校位置未標示', async () => {
    const unlocated = areaOpportunity({
      campus: { ...areaOpportunity().campus, lat: null, lng: null, locate_error: 'no_doorplate' }, baseline: null, villages: [],
    })
    const { wrapper } = await mountTab({}, areaStats(), unlocated)
    expect(modeNotes(wrapper)).toEqual(['本校位置未標示（本校地址比對不到門牌），算不出附近有哪些里。'])
  })

  it('讀取失敗：各里表寫錯誤與重試、地圖照常；工具列 2–5 歲孩子與招生機會停用；重試成功恢復', async () => {
    let fail = true
    mockGet(routes(areaStats(), () => {
      if (fail) throw new Error('boom')
      return areaOpportunity()
    }))
    const { wrapper } = await mountReady()
    expect(wrapper.find('.opportunity-error').exists()).toBe(true)
    expect(wrapper.find('.area-map-stub').exists()).toBe(true)
    expect(disabledModes(wrapper)).toEqual(['2–5 歲孩子', '招生機會'])
    expect(modeNotes(wrapper)).toEqual(['招生機會讀取失敗。'])
    fail = false
    await button(wrapper.get('.opportunity-error'), '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.opportunity-error').exists()).toBe(false)
    expect(disabledModes(wrapper)).toEqual([])
    expect(modeNotes(wrapper)).toEqual([])
  })

  it('讀取中不算用不了：2–5 歲孩子與招生機會照常可選（換半徑時不跳回預設）', async () => {
    const slow = deferred<unknown>()
    mockGet(routes(areaStats(), () => slow.promise))
    const { wrapper } = await mountWith(AreaTab, { props: props(withView({ map: 'opportunity' })) })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await flushPromises()
    expect(areaMap(wrapper).props('opportunity')).toBeNull()
    expect(disabledModes(wrapper)).toEqual([])
    expect(checkedMode(wrapper)).toBe('招生機會')
    expect(side(wrapper).find('.el-skeleton').exists()).toBe(true) // 右欄排行等資料
    slow.resolve(areaOpportunity())
    await flushPromises()
    expect(areaMap(wrapper).props('opportunity')).toMatchObject({ radius_km: 3 })
    expect(checkedMode(wrapper)).toBe('招生機會')
    expect(wrapper.emitted('update:view')).toBeUndefined()
  })

  it('連續換半徑：先送出的晚回，不蓋掉後來選的', async () => {
    const slow3 = deferred<unknown>()
    mockGet(routes(areaStats(), (path: string) =>
      queryOf(path).get('radius_km') === '3' ? slow3.promise : areaOpportunity({ radius_km: 6 }),
    ))
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await chooseRadius(wrapper, 6)
    await flushPromises()
    slow3.resolve(areaOpportunity())
    await flushPromises()
    expect(areaMap(wrapper).props('opportunity')).toMatchObject({ radius_km: 6 })
    expect(wrapper.findComponent(AreaTables).props('opportunity')).toMatchObject({ radius_km: 6 })
  })
})

describe('托嬰與園所變化（2026-10-14 規格 7）', () => {
  it('依頁首校區與半徑讀托嬰與變化', async () => {
    const { get } = await mountTab()
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/babycare')[0]!))).toEqual({ campus_key: 'yihua', radius_km: '3' })
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/changes')[0]!))).toEqual({ campus_key: 'yihua', radius_km: '3' })
  })

  it('同業模式預設是幼兒園清單；切到托嬰中心才顯示托嬰清單，並請地圖打開托嬰圖層；地圖一直拿得到托嬰點', async () => {
    const { wrapper } = await mountTab(withView({ map: 'peers' }))
    expect(wrapper.find('.nearby--babycare').exists()).toBe(false)
    expect(areaMap(wrapper).props('babycare')).toHaveLength(3)
    wrapper.findComponent(NearbyPanel).vm.$emit('update:kind', 'babycare')
    await flushPromises()
    expect(wrapper.find('.nearby--babycare').exists()).toBe(true)
    expect(wrapper.find('.nearby__title').text()).toBe('附近托嬰中心')
    expect(wrapper.get('.nearby__summary').text()).toBe('3 公里內托嬰中心 3 所，核定 92 位，實際收托 84 位。')
    expect(mapStub.reveal).toHaveBeenCalledTimes(1)
  })

  it('托嬰清單點一列：地圖移到該點', async () => {
    const { wrapper } = await mountTab(withView({ map: 'peers' }))
    wrapper.findComponent(NearbyPanel).vm.$emit('update:kind', 'babycare')
    await flushPromises()
    wrapper.findComponent(NearbyBabycare).vm.$emit('select', 'bc-public')
    expect(mapStub.focusBabycare).toHaveBeenCalledWith('bc-public')
    expect(mapStub.focus).not.toHaveBeenCalled()
  })

  it('換半徑：幼兒園、托嬰、變化、收費一起重讀並帶 radius_km，地圖半徑跟著變', async () => {
    const { wrapper, get } = await mountTab()
    await chooseRadius(wrapper, 6)
    await flushPromises()
    for (const path of ['/admin/admissions/area/kindergartens', '/admin/admissions/area/babycare', '/admin/admissions/area/changes', '/admin/admissions/area/fees']) {
      expect(queryOf(pathsTo(get, path).at(-1)!).get('radius_km')).toBe('6')
    }
    expect(areaMap(wrapper).props('radiusKm')).toBe(6)
  })

  it('切到托嬰清單時換範圍也一樣（兩份清單共用工具列的同一個範圍）', async () => {
    const { wrapper, get } = await mountTab(withView({ map: 'peers' }))
    wrapper.findComponent(NearbyPanel).vm.$emit('update:kind', 'babycare')
    await flushPromises()
    await chooseRadius(wrapper, 1)
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/area/babycare').at(-1)!).get('radius_km')).toBe('1')
    expect(queryOf(pathsTo(get, '/admin/admissions/area/kindergartens').at(-1)!).get('radius_km')).toBe('1')
  })

  it('托嬰讀取失敗：切到托嬰才看得到錯誤；幼兒園清單、變化、地圖照常；重試成功恢復', async () => {
    let fail = true
    mockGet({ ...routes(), '/admin/admissions/area/babycare': () => { if (fail) throw new Error('boom'); return areaBabycare() } })
    const { wrapper } = await mountReady(withView({ map: 'peers' }))
    expect(wrapper.text()).not.toContain('無法讀取附近托嬰中心。')
    expect(wrapper.findAll('.nearby__name')).toHaveLength(4)
    expect(wrapper.findAll('.changes__item')).toHaveLength(3)
    wrapper.findComponent(NearbyPanel).vm.$emit('update:kind', 'babycare')
    await flushPromises()
    expect(wrapper.text()).toContain('無法讀取附近托嬰中心。')
    expect(areaMap(wrapper).props('babycare')).toEqual([])
    fail = false
    await button(side(wrapper), '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('無法讀取附近托嬰中心。')
    expect(wrapper.findAll('.nearby__name')).toHaveLength(3)
  })

  it('變化讀取失敗：只有這一塊寫錯誤與重試，清單、各里表、地圖照常；重試成功恢復', async () => {
    let fail = true
    mockGet({ ...routes(), '/admin/admissions/area/changes': () => { if (fail) throw new Error('boom'); return areaChanges() } })
    const { wrapper } = await mountReady(withView({ map: 'peers' }))
    expect(wrapper.text()).toContain('無法讀取附近園所的變化。')
    expect(wrapper.text()).not.toContain('無法讀取區域分析')
    expect(wrapper.findAll('.nearby__name')).toHaveLength(4)
    expect(bodyRows(block(wrapper, '各里（本校 3 公里內）'))).toHaveLength(3)
    fail = false
    await button(wrapper.get('.changes'), '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.changes__item')).toHaveLength(3)
  })

  it('連續換半徑：變化只採用最後一次（先送出的晚回不蓋掉）', async () => {
    const slow = deferred<unknown>()
    let first = true
    mockGet({
      ...routes(),
      '/admin/admissions/area/changes': () => {
        if (first) { first = false; return areaChanges() }
        return slow.promise
      },
    })
    const { wrapper } = await mountReady(withView({ map: 'peers' }))
    expect(wrapper.findAll('.changes__item')).toHaveLength(3)
    await chooseRadius(wrapper, 6)
    await flushPromises()
    expect(wrapper.find('.changes .el-skeleton').exists()).toBe(true) // 換半徑先清空再讀
    slow.resolve(areaChanges([], { radius_km: 6 }))
    await flushPromises()
    expect(wrapper.findAll('.changes__item')).toHaveLength(0)
    expect(wrapper.get('.changes__empty').text()).toBe('近 12 個月，6 公里內沒有新設、停辦或類型變動的園所。')
  })

  // 規格 7.2「卡片切到托嬰中心，自動打開地圖的托嬰圖層」：圖層開關存在 AreaMap 實例裡，實例換了就要重新打開。
  it('清單停在托嬰時換學年：地圖卸載重掛，新的地圖實例再被請求打開托嬰圖層', async () => {
    const { wrapper } = await mountTab(withView({ map: 'peers' }))
    wrapper.findComponent(NearbyPanel).vm.$emit('update:kind', 'babycare')
    await flushPromises()
    expect(mapStub.reveal).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ schoolYear: 114 })
    expect(wrapper.find('.area-map-stub').exists()).toBe(false) // 讀取期間整塊換成骨架，地圖已卸載
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await flushPromises()
    expect(wrapper.find('.nearby--babycare').exists()).toBe(true)
    expect(mapStub.reveal).toHaveBeenCalledTimes(2)
  })

  it('地圖還沒掛上（里界慢回）就切到托嬰：地圖出現後補打開一次', async () => {
    const slow = deferred<unknown>()
    mockGet({ ...routes(), '/admin/admissions/area/boundaries': () => slow.promise })
    const { wrapper } = await mountWith(AreaTab, { props: props(withView({ map: 'peers' })) })
    await vi.waitFor(() => expect(wrapper.findComponent(NearbyPanel).exists()).toBe(true))
    expect(wrapper.find('.area-map-stub').exists()).toBe(false)
    wrapper.findComponent(NearbyPanel).vm.$emit('update:kind', 'babycare')
    await flushPromises()
    expect(mapStub.reveal).not.toHaveBeenCalled()
    slow.resolve(villageBoundaries())
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await flushPromises()
    expect(mapStub.reveal).toHaveBeenCalledTimes(1)
  })

  it('清單停在幼兒園：地圖掛上與重掛都不請地圖打開托嬰圖層', async () => {
    const { wrapper } = await mountTab(withView({ map: 'peers' }))
    await wrapper.setProps({ schoolYear: 114 })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await flushPromises()
    expect(mapStub.reveal).not.toHaveBeenCalled()
  })
})

describe('里的變化（2026-10-14 規格 7.2）', () => {
  async function mountTrends(trends: unknown) {
    mockGet({ ...routes(), '/admin/admissions/area/trends': trends })
    return mountReady()
  }

  it('依頁首校區、學期與半徑讀里的變化；換半徑重讀；資料交給地圖與表格；孩子增減、新屋交屋可選', async () => {
    const { wrapper, get } = await mountTab()
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/trends')[0]!)))
      .toEqual({ campus_key: 'yihua', school_year: '115', radius_km: '3' })
    expect(areaMap(wrapper).props('trends')).toMatchObject({ radius_km: 3 })
    expect(wrapper.findComponent(AreaTables).props('trends')).toMatchObject({ radius_km: 3 })
    expect(modeInput(wrapper, '孩子增減').disabled).toBe(false)
    expect(modeInput(wrapper, '新屋交屋').disabled).toBe(false)
    await chooseRadius(wrapper, 6)
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/area/trends').at(-1)!).get('radius_km')).toBe('6')
  })

  it('一年前的人口還沒匯入：孩子增減停用並寫原因，新屋交屋照用', async () => {
    const base = areaTrends()
    const trends = areaTrends({
      kids_unavailable: 'no_year_ago',
      sources: { ...base.sources, population: { month: '115-09', year_ago_month: null } },
      baseline: { ...base.baseline!, kids_net: null, kids_base: null },
      villages: base.villages.map((row) => ({ ...row, kids_net: null, kids_base: null, kids_level: 'unknown' as const })),
    })
    const { wrapper } = await mountTrends(trends)
    expect(disabledModes(wrapper)).toEqual(['孩子增減'])
    expect(modeNotes(wrapper)).toEqual(['一年前的各里人口還沒匯入，這一年淨增先不算。'])
  })

  it('新成屋還沒匯入：只有新屋交屋停用，孩子增減照用', async () => {
    const base = areaTrends()
    const trends = areaTrends({
      sources: { ...base.sources, new_homes: { latest: null, seasons: [], unplaced: 0, note: '' } },
      baseline: { ...base.baseline!, new_homes: null, new_homes_latest: null, new_homes_seasons: 0 },
      villages: base.villages.map((row) => ({ ...row, new_homes: null, new_homes_latest: null })),
    })
    const { wrapper } = await mountTrends(trends)
    expect(disabledModes(wrapper)).toEqual(['新屋交屋'])
    expect(modeNotes(wrapper)).toEqual(['新成屋資料尚未匯入。'])
  })

  it('本校沒座標：孩子增減與新屋交屋停用，原因只寫一次；什麼都沒匯入：孩子增減停用', async () => {
    const base = areaTrends()
    const unlocated = areaTrends({ campus: { ...base.campus, lat: null, lng: null, locate_error: 'pending' }, baseline: null, villages: [] })
    const first = await mountTrends(unlocated)
    expect(disabledModes(first.wrapper)).toEqual(['孩子增減', '新屋交屋'])
    expect(modeNotes(first.wrapper)).toEqual(['本校位置未標示（門牌資料尚未匯入），算不出附近有哪些里。'])
    cleanup()
    const empty = areaTrends({
      kids_unavailable: 'no_population', baseline: null, villages: [],
      sources: { ...base.sources, population: { month: null, year_ago_month: null }, births: { latest: null, months: [], missing: [] }, migration: { latest: null, months: [], missing: [] } },
    })
    const second = await mountTrends(empty)
    expect(modeInput(second.wrapper, '孩子增減').disabled).toBe(true)
    expect(modeNotes(second.wrapper)[0]).toBe('各里出生、遷入遷出資料尚未匯入；匯入後就能看哪些里孩子變多。')
  })

  it('讀取失敗：各里表寫錯誤與重試，孩子增減與新屋交屋停用；重試成功恢復', async () => {
    let fail = true
    const { wrapper } = await mountTrends(() => {
      if (fail) throw new Error('boom')
      return areaTrends()
    })
    expect(wrapper.find('.trends-error').exists()).toBe(true)
    expect(disabledModes(wrapper)).toEqual(['孩子增減', '新屋交屋'])
    expect(modeNotes(wrapper)).toEqual(['里的變化讀取失敗。'])
    fail = false
    await button(wrapper.get('.trends-error'), '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.trends-error').exists()).toBe(false)
    expect(disabledModes(wrapper)).toEqual([])
  })
})

describe('在籍學生（2026-10-15 規格 §6）', () => {
  const gradeLabels = (wrapper: VueWrapper) => side(wrapper).get('[aria-label="在籍學生班別"]').findAll('.el-radio-button').map((item) => item.text())
  const checkedGrade = (wrapper: VueWrapper) =>
    side(wrapper).get('[aria-label="在籍學生班別"]').findAll('.el-radio-button').find((item) => (item.get('input').element as HTMLInputElement).checked)?.text()
  async function chooseGrade(wrapper: VueWrapper, label: string) {
    await side(wrapper).get('[aria-label="在籍學生班別"]').findAll('.el-radio-button').find((item) => item.text() === label)!.get('input').setValue()
    await flushPromises()
  }

  it('依校區讀在籍學生（不帶學年學期）；資料交給地圖與表格；右欄是在籍排行、班別篩選在標題區', async () => {
    const { wrapper, get } = await mountTab()
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/enrolled')[0]!))).toEqual({ campus_key: 'yihua' })
    expect(areaMap(wrapper).props('enrolled')).toMatchObject({ status: 'ready', total: 5 })
    expect(areaMap(wrapper).props('gradeFilter')).toBe('all')
    expect(modeInput(wrapper, '在籍學生').disabled).toBe(false)
    expect(rankingItems(wrapper).map((item) => [item.get('.area-ranking__name').text(), item.get('.area-ranking__value').text()])).toEqual([
      ['三民區本揚里', '3 位'], ['三民區寶業里', '1 位'], ['左營區新上里', '1 位'],
    ])
    expect(gradeLabels(wrapper)).toEqual(['全部 5', '幼幼班 1', '小班 2', '中班 1', '大班 1'])
    expect(checkedGrade(wrapper)).toBe('全部 5')
    // 班別只在在籍模式的右欄出現。
    await chooseMode(wrapper, '參觀')
    expect(side(wrapper).find('[aria-label="在籍學生班別"]').exists()).toBe(false)
  })

  it('班別篩選：地圖、右欄排行、在籍學生分頁一起換；換校區後在籍以新 campus_key 重讀、班別回全部', async () => {
    const { wrapper, get } = await mountTab()
    await chooseGrade(wrapper, '小班 2')
    expect(areaMap(wrapper).props('gradeFilter')).toBe('小班')
    expect(wrapper.findComponent(AreaTables).props('gradeFilter')).toBe('小班')
    expect(rankingItems(wrapper).map((item) => item.get('.area-ranking__value').text())).toEqual(['2 位'])
    await wrapper.setProps({ campusKey: 'minghua' })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/area/enrolled').at(-1)!).get('campus_key')).toBe('minghua')
    expect(areaMap(wrapper).props('gradeFilter')).toBe('all')
    expect(wrapper.findComponent(AreaTables).props('gradeFilter')).toBe('all')
    expect(checkedGrade(wrapper)).toBe('全部 5')
  })

  it('班別只接受選項裡的值（handler 的保底）', async () => {
    const { wrapper } = await mountTab()
    radioGroup(wrapper, '在籍學生班別').vm.$emit('update:modelValue', '其他')
    await flushPromises()
    expect(areaMap(wrapper).props('gradeFilter')).toBe('all')
  })

  it('沒匯入：工具列的在籍學生停用、寫尚未匯入；在籍學生分頁寫同一句', async () => {
    mockGet(routes(areaStats(), areaOpportunity(), areaEnrolled({ status: 'not_imported' })))
    const { wrapper } = await mountReady()
    expect(modeNotes(wrapper)).toEqual(['尚未匯入在籍名冊。'])
    await openTable(wrapper, 'enrolled')
    expect(wrapper.get('.area-full-tables .empty-note').text()).toBe('尚未匯入在籍名冊。')
  })

  it('讀取失敗：工具列的在籍學生停用；在籍學生分頁寫錯誤與重試；重試成功恢復', async () => {
    let fail = true
    mockGet(routes(areaStats(), areaOpportunity(), () => {
      if (fail) throw new Error('boom')
      return areaEnrolled()
    }))
    const { wrapper } = await mountReady()
    expect(modeNotes(wrapper)).toEqual(['在籍學生讀取失敗。'])
    expect(checkedMode(wrapper)).toBe('2–5 歲孩子')
    await openTable(wrapper, 'enrolled')
    fail = false
    await button(wrapper.get('.enrolled-error'), '重新載入')!.trigger('click')
    await flushPromises()
    expect(block(wrapper, '在籍學生距離分布')).toBeDefined()
    expect(modeNotes(wrapper)).toEqual([])
  })
})

describe('附近同業收費（2026-10-15 規格 7.1）', () => {
  it('同業收費分頁用目前的半徑與預設 3 歲', async () => {
    const { wrapper, get } = await mountTab()
    await openTable(wrapper, 'fees')
    expect(wrapper.find('.area-full-tables .peer-fees').exists()).toBe(true)
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/fees').at(-1)!))).toEqual({ campus_key: 'yihua', radius_km: '3', age: '3' })
  })

  it('換年齡只重讀收費', async () => {
    const { wrapper, get } = await mountTab(withView({ table: 'fees' }))
    const before = pathsTo(get, '/admin/admissions/area/kindergartens').length
    wrapper.findComponent(PeerFeesPanel).vm.$emit('update:age', 5)
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/area/fees').at(-1)!).get('age')).toBe('5')
    expect(pathsTo(get, '/admin/admissions/area/kindergartens')).toHaveLength(before)
  })

  it('同業清單用同一份收費與年齡：列尾寫該年齡的學期收費，換年齡跟著換', async () => {
    mockGet({
      ...routes(),
      '/admin/admissions/area/fees': (path: string) => areaPeerFees({ age: Number(queryOf(path).get('age')) as 2 | 3 | 4 | 5 }),
    })
    const { wrapper } = await mountReady(withView({ map: 'peers', table: 'fees' }))
    const meta = () => wrapper.findAll('.nearby__meta').map((item) => item.text())
    expect(meta()[0]).toBe('0 m・核定 210 人・3 歲學期 89,750')
    wrapper.findComponent(PeerFeesPanel).vm.$emit('update:age', 5)
    await vi.waitFor(() => expect(meta()[0]).toBe('0 m・核定 210 人・5 歲學期 89,750'))
  })

  it('舊年齡的回應晚到不會蓋掉新的', async () => {
    const slow = deferred<unknown>()
    mockGet({
      ...routes(),
      '/admin/admissions/area/fees': (path: string) => (queryOf(path).get('age') === '4' ? slow.promise : areaPeerFees({ age: 5 })),
    })
    const { wrapper } = await mountReady(withView({ table: 'fees' }))
    const panel = wrapper.findComponent(PeerFeesPanel)
    panel.vm.$emit('update:age', 4)
    await flushPromises()
    panel.vm.$emit('update:age', 5)
    await flushPromises()
    slow.resolve(areaPeerFees({ age: 4 }))
    await flushPromises()
    expect(wrapper.get('.peer-fees__summary').text()).toContain('5 歲班')
  })

  it('收費讀取失敗只影響這一塊，重試成功恢復', async () => {
    let fail = true
    mockGet({ ...routes(), '/admin/admissions/area/fees': () => { if (fail) throw new Error('boom'); return areaPeerFees() } })
    const { wrapper } = await mountReady(withView({ map: 'peers', table: 'fees' }))
    expect(wrapper.text()).toContain('無法讀取附近同業收費。')
    expect(wrapper.findAll('.nearby__name')).toHaveLength(4)
    expect(wrapper.findAll('.nearby__meta')[0]!.text()).toBe('0 m・核定 210 人・—')
    fail = false
    await wrapper.get('.peer-fees .el-alert .el-button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.peer-fees__summary').exists()).toBe(true)
  })
})
