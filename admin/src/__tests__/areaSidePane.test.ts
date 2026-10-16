// 區域分析工作台右欄的排行、里卡片與容器（2026-10-16 規格 §2.3、§2.4、§2.5）。元件各自獨立掛載，
// 資料用手寫的 RankingSection／VillageFacts（接進 AreaTab 後的組裝見 areaTab.test.ts）。
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import AreaRanking from '../components/admissions/area/AreaRanking.vue'
import AreaSidePane from '../components/admissions/area/AreaSidePane.vue'
import VillageCard from '../components/admissions/area/VillageCard.vue'
import rankingSource from '../components/admissions/area/AreaRanking.vue?raw'
import paneSource from '../components/admissions/area/AreaSidePane.vue?raw'
import cardSource from '../components/admissions/area/VillageCard.vue?raw'
import type { PaneHead, RankingItem, RankingSection } from '../components/admissions/area/areaPane'
import type { VillageFacts } from '../components/admissions/area/villageFacts'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  document.body.innerHTML = ''
})
function mountIt(component: unknown, props: Record<string, unknown>, slots: Record<string, string> = {}): VueWrapper {
  const wrapper = mount(component as never, { props, slots, attachTo: document.body, global: { plugins: [ElementPlus] } } as never)
  wrappers.push(wrapper)
  return wrapper
}

// ---- 資料 ----

const item = (index: number, changes: Partial<RankingItem> = {}): RankingItem => ({
  code: String(64000050000 + index), name: `三民區第${index + 1}里`, distance: `${(index + 1) * 100} m`,
  value: `${100 - index} 位`, detail: `預繳 ${index}`, ...changes,
})
const section = (count: number, title = ''): RankingSection => ({ title, items: Array.from({ length: count }, (_, index) => item(index)) })
const rowButtons = (wrapper: VueWrapper) => wrapper.findAll('.area-ranking__item')

const FACTS: VillageFacts = {
  code: '64000050015',
  title: '三民區本揚里',
  subtitle: '距本校 900 m・陽明國小學區',
  kids: {
    state: 'ok',
    rows: [
      { label: '2–5 歲', value: '120 位' },
      { label: '0–1 歲', value: '40 位' },
      { label: '這一年淨增', value: '+36', detail: '+12.8%・增加多', tone: 'up' },
      { label: '近 12 個月淨遷入', value: '−8 人', tone: 'down' },
    ],
    note: '',
    mergeNote: '',
  },
  ours: {
    state: 'ok',
    rows: [
      { label: '在籍', value: '8 位', detail: '幼幼 1・小 2・中 3・大 2' },
      { label: '參觀', value: '5 位', detail: '預繳 2' },
    ],
    openRecordsArea: '三民區/本揚里',
  },
  nearby: [
    { name: '大樹幼兒園', kind: 'private', kindLabel: '私立', isOwn: false, distance: '320 m' },
    { name: '常春藤幼兒園', kind: 'private', kindLabel: '本機構', isOwn: true, distance: '450 m' },
  ],
}
const facts = (changes: Partial<VillageFacts> = {}): VillageFacts => ({ ...FACTS, ...changes })
const sectionTitles = (wrapper: VueWrapper) => wrapper.findAll('.village-card__section-title').map((title) => title.text())

// 讀樣式原始碼的小工具：取出某個 @media 區塊（依大括號配對），以及拿掉所有 @media 之後剩下的規則。
function mediaBlock(source: string, query: string): string {
  const start = source.indexOf(`@media (${query}) {`)
  if (start === -1) return ''
  let depth = 0
  for (let index = source.indexOf('{', start); index < source.length; index++) {
    if (source[index] === '{') depth++
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1)
  }
  return source.slice(start)
}
function outsideMedia(source: string): string {
  let rest = source
  for (let at = rest.indexOf('@media ('); at !== -1; at = rest.indexOf('@media (')) {
    const query = rest.slice(at + '@media ('.length, rest.indexOf(')', at))
    rest = rest.replace(mediaBlock(rest, query), '')
  }
  return rest
}

describe('排行（AreaRanking）', () => {
  it('列是按鈕、點了 emit select(code)，code 為 null 不可點；名次、里名、距離、數值與小字都在', async () => {
    const items = [item(0), item(1, { code: null, name: '三民區新里', distance: '—' }), item(2)]
    const wrapper = mountIt(AreaRanking, { sections: [{ title: '', items }], limit: 10 })
    const rows = rowButtons(wrapper)
    expect(rows.map((row) => row.element.tagName)).toEqual(['BUTTON', 'DIV', 'BUTTON'])
    expect(rows[0]!.attributes('type')).toBe('button')
    expect(rows[1]!.find('button').exists()).toBe(false)
    expect(rows[0]!.text().replace(/\s+/g, '')).toBe('1三民區第1里100m100位預繳0')
    expect(rows[2]!.get('.area-ranking__rank').text()).toBe('3')
    await rows[0]!.trigger('click')
    await rows[1]!.trigger('click')
    await rows[2]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['64000050000'], ['64000050002']])
  })

  it('桌機 limit 10：十列＋顯示更多，點了展開到全部（最多 20 列）並收掉鈕', async () => {
    const wrapper = mountIt(AreaRanking, { sections: [section(25)], limit: 10 })
    expect(rowButtons(wrapper)).toHaveLength(10)
    const more = wrapper.findAll('button').find((button) => button.text() === '顯示更多')!
    await more.trigger('click')
    expect(rowButtons(wrapper)).toHaveLength(20)
    expect(wrapper.findAll('button').some((button) => button.text() === '顯示更多')).toBe(false)
  })

  it('手機 limit 5：五列＋顯示更多；不超過 limit 就沒有鈕', async () => {
    const wrapper = mountIt(AreaRanking, { sections: [section(12)], limit: 5 })
    expect(rowButtons(wrapper)).toHaveLength(5)
    await wrapper.findAll('button').find((button) => button.text() === '顯示更多')!.trigger('click')
    expect(rowButtons(wrapper)).toHaveLength(12)
    const short = mountIt(AreaRanking, { sections: [section(5)], limit: 5 })
    expect(short.findAll('button').some((button) => button.text() === '顯示更多')).toBe(false)
  })

  it('換一份排行（換模式）收回顯示更多', async () => {
    const wrapper = mountIt(AreaRanking, { sections: [section(12)], limit: 5 })
    await wrapper.findAll('button').find((button) => button.text() === '顯示更多')!.trigger('click')
    expect(rowButtons(wrapper)).toHaveLength(12)
    await wrapper.setProps({ sections: [section(12)] })
    expect(rowButtons(wrapper)).toHaveLength(5)
  })

  it('兩段（孩子增減）：各段有標題、名次各自從 1 起；tone 用在右側數值', () => {
    const sections: RankingSection[] = [
      { title: '增加最多', items: [item(0, { value: '+36', tone: 'up' })] },
      { title: '減少最多', items: [item(1, { value: '−12', tone: 'down' }), item(2, { value: '−3', tone: 'down' })] },
    ]
    const wrapper = mountIt(AreaRanking, { sections, limit: 5 })
    expect(wrapper.findAll('.area-ranking__title').map((title) => title.text())).toEqual(['增加最多', '減少最多'])
    expect(wrapper.findAll('.area-ranking__rank').map((rank) => rank.text())).toEqual(['1', '1', '2'])
    expect(wrapper.findAll('.area-ranking__value').map((value) => value.classes().filter((name) => name.includes('--')))).toEqual([
      ['area-ranking__value--up'], ['area-ranking__value--down'], ['area-ranking__value--down'],
    ])
  })

  it('只有一段（標題是空字串）不畫段標題；detail 是空字串不畫小字；distance 是空字串不畫距離', () => {
    const wrapper = mountIt(AreaRanking, { sections: [{ title: '', items: [item(0, { detail: '', distance: '' })] }], limit: 10 })
    expect(wrapper.find('.area-ranking__title').exists()).toBe(false)
    expect(wrapper.find('.area-ranking__detail').exists()).toBe(false)
    expect(wrapper.find('.area-ranking__distance').exists()).toBe(false)
    expect(mountIt(AreaRanking, { sections: [section(1)], limit: 10 }).find('.area-ranking__distance').exists()).toBe(true)
  })

  it('≤720px 觸控：排行列至少 44px 高（距離與小字都是空的那種單行列也一樣）', () => {
    expect(mediaBlock(rankingSource, 'max-width: 720px')).toMatch(/\.area-ranking__item \{[^}]*min-height: 44px;/)
  })
})

describe('里卡片（VillageCard）', () => {
  it('標題 h2 可聚焦、副標、三段標題，兩欄 dl 的標籤與數值；查看這個里的訪視帶 三民區/本揚里', async () => {
    const wrapper = mountIt(VillageCard, { facts: facts() })
    const heading = wrapper.get('h2')
    expect(heading.text()).toBe('三民區本揚里')
    expect(heading.attributes('tabindex')).toBe('-1')
    expect(wrapper.get('.village-card__subtitle').text()).toBe('距本校 900 m・陽明國小學區')
    expect(sectionTitles(wrapper)).toEqual(['孩子', '我們', '附近的幼兒園'])
    const rows = wrapper.findAll('.village-card__row').map((row) => [row.get('dt').text(), row.get('dd').text().replace(/\s+/g, '')])
    expect(rows).toEqual([
      ['2–5 歲', '120位'],
      ['0–1 歲', '40位'],
      ['這一年淨增', '+36+12.8%・增加多'],
      ['近 12 個月淨遷入', '−8人'],
      ['在籍', '8位幼幼1・小2・中3・大2'],
      ['參觀', '5位預繳2'],
    ])
    expect(wrapper.findAll('.village-card__value').map((value) => value.classes().filter((name) => name.includes('--')))).toEqual([
      [], [], ['village-card__value--up'], ['village-card__value--down'], [], [],
    ])
    const open = wrapper.findAll('button').find((button) => button.text() === '查看這個里的訪視')!
    expect(open.classes()).toContain('el-button--primary')
    expect(open.classes()).toContain('is-plain')
    await open.trigger('click')
    expect(wrapper.emitted('open-records')).toEqual([['三民區/本揚里']])
  })

  it('openRecordsArea 為 null（沒有參觀）不畫查看鈕，參觀那列照寫', () => {
    const wrapper = mountIt(VillageCard, {
      facts: facts({ ours: { state: 'ok', rows: [{ label: '參觀', value: '0 位' }], openRecordsArea: null } }),
    })
    expect(wrapper.findAll('button').some((button) => button.text() === '查看這個里的訪視')).toBe(false)
    expect(wrapper.get('.village-card__row').text()).toContain('0 位')
  })

  it('附近的幼兒園：本機構色點看 isOwn，不看類型文字', () => {
    const wrapper = mountIt(VillageCard, {
      facts: facts({
        nearby: [
          { name: '甲幼兒園', kind: 'public', kindLabel: '本機構', isOwn: false, distance: '100 m' },
          { name: '乙幼兒園', kind: 'private', kindLabel: '私立', isOwn: true, distance: '200 m' },
        ],
      }),
    })
    const dots = wrapper.findAll('.village-card__dot').map((dot) => dot.classes().find((name) => name.includes('--')))
    expect(dots).toEqual(['village-card__dot--public', 'village-card__dot--own'])
  })

  it('附近的幼兒園：類型色點、短名、類型、距離；本機構用本機構色', () => {
    const wrapper = mountIt(VillageCard, { facts: facts() })
    const rows = wrapper.findAll('.village-card__nearby li')
    expect(rows.map((row) => row.text().replace(/\s+/g, ''))).toEqual(['大樹幼兒園私立320m', '常春藤幼兒園本機構450m'])
    expect(rows[0]!.get('.village-card__dot').classes()).toContain('village-card__dot--private')
    expect(rows[1]!.get('.village-card__dot').classes()).toContain('village-card__dot--own')
  })

  it('× 與 Esc 都 emit close；× 有名稱「關閉里卡片」', async () => {
    const wrapper = mountIt(VillageCard, { facts: facts() })
    const close = wrapper.get('button[aria-label="關閉里卡片"]')
    expect(close.attributes('type')).toBe('button')
    await close.trigger('click')
    await wrapper.get('h2').trigger('keydown', { key: 'Escape' }) // 焦點在標題上（鍵盤事件冒泡到卡片）
    await wrapper.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(3)
  })

  it('≤720px 觸控：× 是 44×44', () => {
    expect(mediaBlock(cardSource, 'max-width: 720px')).toMatch(/\.village-card__close \{[^}]*width: 44px;[^}]*height: 44px;/)
  })

  it('標題區黏頂只在 ≥1200px（1200px 以下沒有內捲，後台頂端列本來就 sticky）', () => {
    for (const source of [cardSource, paneSource]) {
      expect(outsideMedia(source)).not.toContain('position: sticky')
      expect(mediaBlock(source, 'min-width: 1200px')).toContain('position: sticky')
    }
  })

  it('focusHeading 把焦點移到標題', () => {
    const wrapper = mountIt(VillageCard, { facts: facts() })
    ;(wrapper.vm as unknown as { focusHeading: () => void }).focusHeading()
    expect(document.activeElement).toBe(wrapper.get('h2').element)
  })

  it('孩子段讀取中是骨架，其他段照列；失敗寫「讀取失敗」加重試（emit retry kids）', async () => {
    const loading = mountIt(VillageCard, { facts: facts({ kids: { state: 'loading', rows: [], note: '', mergeNote: '' } }) })
    const kids = loading.findAll('.village-card__section')[0]!
    expect(kids.find('.el-skeleton').exists()).toBe(true)
    expect(kids.find('dl').exists()).toBe(false)
    expect(loading.findAll('.village-card__section')[1]!.text()).toContain('參觀')
    const failed = mountIt(VillageCard, { facts: facts({ kids: { state: 'failed', rows: [], note: '', mergeNote: '' } }) })
    const failedKids = failed.findAll('.village-card__section')[0]!
    expect(failedKids.text()).toContain('讀取失敗')
    await failedKids.findAll('button').find((button) => button.text() === '重試')!.trigger('click')
    expect(failed.emitted('retry')).toEqual([['kids']])
  })

  it('孩子段 outside／no-population／unavailable：只寫 note、沒有數值列；合併說明放在段標題旁', () => {
    for (const state of ['outside', 'no-population', 'unavailable'] as const) {
      const wrapper = mountIt(VillageCard, { facts: facts({ kids: { state, rows: [], note: `${state} 的說明`, mergeNote: '' } }) })
      const kids = wrapper.findAll('.village-card__section')[0]!
      expect(kids.get('.village-card__note').text()).toBe(`${state} 的說明`)
      expect(kids.find('dl').exists()).toBe(false)
    }
    const merged = mountIt(VillageCard, { facts: facts({ kids: { ...FACTS.kids, mergeNote: '里界調整，和寶業里合併計算' } }) })
    expect(merged.get('.village-card__merge').text()).toBe('里界調整，和寶業里合併計算')
    expect(merged.findAll('.village-card__section')[0]!.find('dl').exists()).toBe(true)
  })

  it('我們段：在籍讀取中只換掉在籍那列（骨架），參觀那列照寫；失敗寫「讀取失敗」加重試（emit retry ours）', async () => {
    const visit = { label: '參觀', value: '5 位', detail: '預繳 2' }
    const loading = mountIt(VillageCard, { facts: facts({ ours: { state: 'loading', rows: [visit], openRecordsArea: '三民區/本揚里' } }) })
    const ours = loading.findAll('.village-card__section')[1]!
    const loadingRows = ours.findAll('.village-card__row')
    expect(loadingRows.map((row) => row.get('dt').text())).toEqual(['在籍', '參觀'])
    expect(loadingRows[0]!.find('.el-skeleton').exists()).toBe(true)
    expect(loadingRows[1]!.text()).toContain('5 位')
    const failed = mountIt(VillageCard, { facts: facts({ ours: { state: 'failed', rows: [visit], openRecordsArea: null } }) })
    const failedRows = failed.findAll('.village-card__section')[1]!.findAll('.village-card__row')
    expect(failedRows.map((row) => row.get('dt').text())).toEqual(['在籍', '參觀'])
    expect(failedRows[0]!.text()).toContain('讀取失敗')
    // 「讀取失敗」與「重試」包在 dd 裡的一個 flex 容器，不被 dd 自己的 grid 排成兩列。
    expect(failedRows[0]!.find('dd > .village-card__failed').findAll('button, span').length).toBeGreaterThanOrEqual(2)
    expect(failedRows[1]!.text()).toContain('5 位')
    await failedRows[0]!.findAll('button').find((button) => button.text() === '重試')!.trigger('click')
    expect(failed.emitted('retry')).toEqual([['ours']])
  })

  it('nearby 是 null 或 []（500 m 內沒有）都不畫附近的幼兒園', () => {
    for (const nearby of [null, []]) {
      const wrapper = mountIt(VillageCard, { facts: facts({ nearby }) })
      expect(sectionTitles(wrapper)).toEqual(['孩子', '我們'])
    }
  })

  it('副標是空字串（沒有距離）不畫副標', () => {
    expect(mountIt(VillageCard, { facts: facts({ subtitle: '' }) }).find('.village-card__subtitle').exists()).toBe(false)
  })
})

describe('右欄容器（AreaSidePane）', () => {
  const HEAD: PaneHead = { title: '參觀', lines: ['有地址 5 筆：到里 4 筆。'], note: '清冊 2026/10/01', empty: '' }
  const paneProps = (changes: Record<string, unknown> = {}) => ({
    head: HEAD, sections: [section(12)], loading: false, failed: '', facts: null, peers: false, narrow: false, ...changes,
  })

  it('標題區：模式名 h2、摘要各一行、小字；排行桌機 10 列、手機 5 列，選里往外送', async () => {
    const wrapper = mountIt(AreaSidePane, paneProps())
    expect(wrapper.get('h2').text()).toBe('參觀')
    expect(wrapper.findAll('.area-pane__line').map((line) => line.text())).toEqual(['有地址 5 筆：到里 4 筆。'])
    expect(wrapper.get('.area-pane__note').text()).toBe('清冊 2026/10/01')
    expect(rowButtons(wrapper)).toHaveLength(10)
    await rowButtons(wrapper)[0]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['64000050000']])
    await wrapper.setProps({ narrow: true })
    expect(rowButtons(wrapper)).toHaveLength(5)
  })

  it('head-extra slot 放在摘要之後、小字之前（在籍模式的班別篩選）', () => {
    const wrapper = mountIt(AreaSidePane, paneProps(), { 'head-extra': '<div class="extra-slot">班別</div>' })
    const html = wrapper.get('.area-pane__head').html()
    expect(html.indexOf('area-pane__line')).toBeLessThan(html.indexOf('extra-slot'))
    expect(html.indexOf('extra-slot')).toBeLessThan(html.indexOf('area-pane__note'))
  })

  it('讀取中畫骨架、沒有排行；讀取失敗寫原因加重試；沒東西可排寫 head.empty', async () => {
    const loading = mountIt(AreaSidePane, paneProps({ loading: true }))
    expect(loading.find('.el-skeleton').exists()).toBe(true)
    expect(loading.find('.area-ranking').exists()).toBe(false)
    const failed = mountIt(AreaSidePane, paneProps({ failed: '無法讀取招生機會。' }))
    expect(failed.text()).toContain('無法讀取招生機會。')
    expect(failed.find('.area-ranking').exists()).toBe(false)
    await failed.findAll('button').find((button) => button.text() === '重試')!.trigger('click')
    expect(failed.emitted('retry')).toHaveLength(1)
    const empty = mountIt(AreaSidePane, paneProps({ head: { ...HEAD, empty: '半徑內近 4 季沒有新屋交屋。' }, sections: [{ title: '', items: [] }] }))
    expect(empty.get('.area-pane__empty').text()).toBe('半徑內近 4 季沒有新屋交屋。')
    expect(empty.find('.area-ranking').exists()).toBe(false)
  })

  it('同業模式畫 slot（標題區照畫），不畫排行', () => {
    const wrapper = mountIt(AreaSidePane, paneProps({ peers: true, head: { ...HEAD, title: '附近的同業' } }), {
      default: '<div class="peers-slot">附近幼兒園</div>',
    })
    expect(wrapper.get('h2').text()).toBe('附近的同業')
    expect(wrapper.find('.peers-slot').exists()).toBe(true)
    expect(wrapper.find('.area-ranking').exists()).toBe(false)
  })

  it('選了里時卡片優先：只畫卡片（連同業 slot 也不畫）；事件往外送；關掉回到原本的內容', async () => {
    const wrapper = mountIt(AreaSidePane, paneProps({ peers: true, facts: facts() }), { default: '<div class="peers-slot">附近幼兒園</div>' })
    expect(wrapper.find('.village-card').exists()).toBe(true)
    expect(wrapper.find('.peers-slot').exists()).toBe(false)
    expect(wrapper.find('.area-ranking').exists()).toBe(false)
    expect(wrapper.find('.area-pane__head').exists()).toBe(false)
    await wrapper.get('button[aria-label="關閉里卡片"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '查看這個里的訪視')!.trigger('click')
    wrapper.findComponent(VillageCard).vm.$emit('retry', 'ours')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('open-records')).toEqual([['三民區/本揚里']])
    expect(wrapper.emitted('retry-facts')).toEqual([['ours']])
    await wrapper.setProps({ facts: null })
    expect(wrapper.find('.village-card').exists()).toBe(false)
    expect(wrapper.find('.peers-slot').exists()).toBe(true)
  })

  it('focusCard 等卡片畫出來後把焦點移到卡片標題', async () => {
    const wrapper = mountIt(AreaSidePane, paneProps())
    await wrapper.setProps({ facts: facts() })
    await (wrapper.vm as unknown as { focusCard: () => Promise<void> }).focusCard()
    expect(document.activeElement).toBe(wrapper.get('h2').element)
  })

  it('aria-live polite 的區域一直在；announce（地圖點選）時才報「已選取三民區本揚里」，排行／表格選里不報（焦點會移到標題）', async () => {
    const wrapper = mountIt(AreaSidePane, paneProps())
    const live = wrapper.get('[aria-live="polite"]')
    expect(live.classes()).toContain('visually-hidden')
    expect(live.text()).toBe('')
    await wrapper.setProps({ facts: facts() })
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('')
    await wrapper.setProps({ announce: true })
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('已選取三民區本揚里')
    await wrapper.setProps({ facts: null })
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('')
    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(true)
  })
})
