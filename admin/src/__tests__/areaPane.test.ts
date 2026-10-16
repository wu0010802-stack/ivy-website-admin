import { describe, expect, it } from 'vitest'
import {
  addressSummary, dataStatusText, defaultMapMode, enrolledSummary, modeNote, paneHead, rankingFor, resolveMapMode,
  type ModeNotes, type PaneData, type RankingSection,
} from '../components/admissions/area/areaPane'
import type { AdmissionsArea } from '../api/types'
import { areaEnrolled, areaOpportunity, areaPeerFees, areaStats, areaTrends, villageBoundaries } from './admissionsTestKit'

const MINUS = '−'
const EMPTY_TEXT = '這個範圍還沒有招生訪視。'

const stats = (changes: Record<string, unknown> = {}) => areaStats(changes) as AdmissionsArea
const data = (changes: Partial<PaneData> = {}): PaneData => ({
  boundaries: villageBoundaries(),
  area: stats(),
  opportunity: areaOpportunity(),
  trends: areaTrends(),
  enrolled: areaEnrolled(),
  gradeFilter: 'all',
  peerFees: areaPeerFees(),
  emptyText: EMPTY_TEXT,
  radiusKm: 3,
  ...changes,
})
const names = (sections: RankingSection[]) => sections.map((section) => section.items.map((item) => item.name))
const values = (sections: RankingSection[]) => sections.map((section) => section.items.map((item) => item.value))
const totals = (changes: Record<string, unknown>) => ({ ...areaStats().totals, ...changes })
const dataStatus = (changes: Record<string, unknown>) => ({ ...areaStats().data_status, ...changes })

const ok: ModeNotes = { enrolled: '', opportunity: '', trend: '', homes: '', judged: true }

describe('右欄：模式停用、預設與退回（規格 §2.1、D15）', () => {
  it('預設模式與退回（§2.1、D15）', () => {
    expect(defaultMapMode(ok)).toBe('enrolled')
    expect(defaultMapMode({ ...ok, enrolled: '尚未匯入在籍名冊。' })).toBe('children')
    expect(defaultMapMode({ ...ok, enrolled: 'x', opportunity: '各里人口資料尚未匯入；匯入後就能看哪些里孩子多、參觀少。' })).toBe('visits')
    expect(modeNote('opportunity', { ...ok, judged: false })).toBe('附近參觀還不到 10 位，先不判斷哪些里偏少。')
    expect(modeNote('children', { ...ok, judged: false })).toBe('')
    expect(modeNote('opportunity', { ...ok, judged: null })).toBe('') // 讀取中不算停用
    expect(resolveMapMode('trend', { ...ok, trend: '里的變化讀取失敗。' })).toBe('enrolled')
    expect(resolveMapMode(null, ok)).toBe('enrolled')
  })

  it('每個模式的停用原因各看各的 note；參觀與同業不停用', () => {
    const notes: ModeNotes = { enrolled: 'E', opportunity: 'O', trend: 'T', homes: 'H', judged: true }
    expect(
      (['enrolled', 'children', 'trend', 'homes', 'visits', 'opportunity', 'peers'] as const).map((mode) => modeNote(mode, notes)),
    ).toEqual(['E', 'O', 'T', 'H', '', 'O', ''])
  })

  it('招生機會自己的 note 優先於「參觀不到門檻」；判讀為 true 且沒有 note 不停用', () => {
    expect(modeNote('opportunity', { ...ok, opportunity: '招生機會讀取失敗。', judged: false })).toBe('招生機會讀取失敗。')
    expect(modeNote('opportunity', ok)).toBe('')
  })

  it('要的模式可用就用，停用才退回預設；預設也看各 note', () => {
    expect(resolveMapMode('peers', ok)).toBe('peers')
    expect(resolveMapMode('visits', { ...ok, enrolled: 'x' })).toBe('visits')
    expect(resolveMapMode('opportunity', { ...ok, judged: false })).toBe('enrolled')
    expect(resolveMapMode('enrolled', { ...ok, enrolled: 'x' })).toBe('children')
    expect(resolveMapMode('trend', { ...ok, enrolled: 'x', opportunity: 'y', trend: 'z' })).toBe('visits')
  })
})

describe('右欄：排行（規格 §2.3）', () => {
  it('排行：2–5 歲孩子、孩子增減兩段、新屋、參觀、招生機會、在籍', () => {
    expect(names(rankingFor('children', data()))).toEqual([['三民區鼎金里', '三民區本揚里', '三民區寶業里']])
    const trend = rankingFor('trend', data())
    expect(trend.map((s) => s.title)).toEqual(['增加最多', '減少最多'])
    expect(trend[0]!.items.map((i) => [i.name, i.value, i.detail, i.code])).toEqual([
      ['三民區本揚里', '+36', '+12.8%', '64000050015'],
      ['三民區寶業里、龍子里（里界調整，合併）', '+12', '+2.0%', '64000050025'],
    ])
    expect(trend[1]!.items.map((i) => i.value)).toEqual([`${MINUS}22`])
    expect(values(rankingFor('homes', data()))).toEqual([['106 筆', '24 筆']])
    expect(rankingFor('visits', data())[0]!.items.map((i) => [i.name, i.value, i.detail, i.code])).toEqual([
      ['三民區本揚里', '3 位', '預繳 1', '64000050015'],
      ['三民區寶業里', '1 位', '預繳 1', '64000050025'],
      ['鼓山區龍子里', '1 位', '預繳 0', '64000020015'], // village_code 是 null，靠里界名稱找代碼
    ])
    expect(values(rankingFor('opportunity', data()))).toEqual([['少約 7 位']])
    expect(names(rankingFor('enrolled', data()))).toEqual([['三民區本揚里', '三民區寶業里', '左營區新上里']])
  })

  it('只有一段的模式 title 是空字串', () => {
    for (const mode of ['children', 'homes', 'visits', 'opportunity', 'enrolled'] as const) {
      expect(rankingFor(mode, data()).map((section) => section.title)).toEqual([''])
    }
  })

  it('2–5 歲孩子：距離與 0–1 歲小字、代碼來自招生機會列', () => {
    const [section] = rankingFor('children', data())
    expect(section!.items.map((i) => [i.name, i.distance, i.value, i.detail, i.code])).toEqual([
      ['三民區鼎金里', '800 m', '500 位', '0–1 歲 150 位', '64000050001'],
      ['三民區本揚里', '300 m', '300 位', '0–1 歲 90 位', '64000050015'],
      ['三民區寶業里', '300 m', '200 位', '0–1 歲 60 位', '64000050025'],
    ])
  })

  it('2–5 歲孩子：沒有孩子的里不列；同數保留後端順序', () => {
    const opportunity = areaOpportunity()
    opportunity.villages[0]!.children = 0
    opportunity.villages[2]!.children = 300
    expect(names(rankingFor('children', data({ opportunity })))).toEqual([['三民區本揚里', '三民區寶業里']])
  })

  it('孩子增減：增加段方向 up、減少段方向 down；孩子少與算不出來的不列；每段最多 5 個', () => {
    const trends = areaTrends()
    const base = trends.villages[0]!
    const more = Array.from({ length: 7 }, (_, index) => ({
      ...base, key: `x${index}`, village: `增${index}里`, codes: [`6400009000${index}`], kids_net: 100 + index, kids_base: 1000,
    }))
    trends.villages = [
      ...trends.villages,
      ...more,
      { ...base, key: 'few', village: '少里', codes: ['64000090010'], kids_net: 80, kids_base: 10, kids_level: 'few' },
      { ...base, key: 'unknown', village: '未知里', codes: ['64000090011'], kids_net: null, kids_base: null, kids_level: 'unknown' },
    ]
    const [up, down] = rankingFor('trend', data({ trends }))
    expect(up!.items).toHaveLength(5)
    expect(up!.items.map((i) => i.value)).toEqual(['+106', '+105', '+104', '+103', '+102'])
    expect(new Set(up!.items.map((i) => i.tone))).toEqual(new Set(['up']))
    expect(down!.items.map((i) => [i.value, i.tone])).toEqual([[`${MINUS}22`, 'down']])
    expect(up!.items.map((i) => i.name)).not.toContain('三民區少里')
  })

  it('孩子增減：減少段最少的在前；只有一段有資料時不出空段', () => {
    const trends = areaTrends()
    trends.villages = trends.villages.map((row) => (row.kids_net !== null && row.kids_net > 0 ? { ...row, kids_net: -5, kids_base: 100 } : row))
    const sections = rankingFor('trend', data({ trends }))
    expect(sections.map((s) => s.title)).toEqual(['減少最多'])
    expect(sections[0]!.items.map((i) => i.value)).toEqual([`${MINUS}22`, `${MINUS}5`, `${MINUS}5`])
  })

  it('孩子增減：一年前是 0 的里只寫人數，沒有百分比', () => {
    const trends = areaTrends()
    trends.villages[0]!.kids_base = 0
    const [up] = rankingFor('trend', data({ trends }))
    expect(up!.items[0]).toMatchObject({ name: '三民區本揚里', value: '+36', detail: '' })
  })

  it('合併組的代碼取 codes 裡第一個里界檔有的；都沒有或里界還沒載到就用 codes[0]', () => {
    const trends = areaTrends()
    trends.villages[1]!.codes = ['64000059999', '64000020015', '64000050025'] // 第一個是已廢止的舊代碼
    const group = (boundaries: PaneData['boundaries']) =>
      rankingFor('trend', data({ trends, boundaries }))[0]!.items.find((i) => i.name.includes('合併'))!.code
    expect(group(villageBoundaries())).toBe('64000020015')
    expect(group(null)).toBe('64000059999')
    trends.villages[1]!.codes = ['64000059999', '64000058888']
    expect(group(villageBoundaries())).toBe('64000059999')
  })

  it('新屋：筆數多到少、0 筆與沒匯入（null）的不列', () => {
    const trends = areaTrends()
    trends.villages[0]!.new_homes = null
    expect(names(rankingFor('homes', data({ trends })))).toEqual([['三民區鼎金里']])
  })

  it('參觀：只列有參觀的里；對不到代碼的是 null', () => {
    const area = stats({
      villages: [
        ...areaStats().villages,
        { district: '左營區', village: '不明里', village_code: null, visit: 2, deposit: 0, visit_to_deposit_rate: 0, visit_to_deposit_range: null },
        { district: '左營區', village: '零里', village_code: '64000030099', visit: 0, deposit: 0, visit_to_deposit_rate: null, visit_to_deposit_range: null },
      ],
    })
    const [section] = rankingFor('visits', data({ area }))
    expect(section!.items.map((i) => [i.name, i.code])).toEqual([
      ['三民區本揚里', '64000050015'],
      ['左營區不明里', null],
      ['三民區寶業里', '64000050025'],
      ['鼓山區龍子里', '64000020015'],
    ])
  })

  it('參觀與在籍的距離：先看招生機會的列，沒有再看里的變化（合併組的 codes 含這個代碼），兩邊都沒有才是空字串', () => {
    const area = stats({
      villages: [
        ...areaStats().villages,
        { district: '左營區', village: '新上里', village_code: '64000030020', visit: 1, deposit: 0, visit_to_deposit_rate: 0, visit_to_deposit_range: null },
      ],
    })
    const trends = areaTrends()
    trends.villages[0]!.distance_m = 999 // 本揚里：招生機會的 300 m 優先於里的變化
    const visits = rankingFor('visits', data({ area, trends }))[0]!.items
    expect(visits.map((i) => [i.name, i.distance])).toEqual([
      ['三民區本揚里', '300 m'], // 招生機會
      ['三民區寶業里', '300 m'], // 招生機會
      ['鼓山區龍子里', '300 m'], // 招生機會沒有，里的變化的合併組（寶業里、龍子里）有
      ['左營區新上里', ''], // 兩份都沒有
    ])
    const enrolled = rankingFor('enrolled', data({ trends }))[0]!.items
    expect(enrolled.map((i) => [i.name, i.distance])).toEqual([
      ['三民區本揚里', '300 m'], ['三民區寶業里', '300 m'], ['左營區新上里', ''],
    ])
    expect(rankingFor('visits', data({ area, opportunity: null, trends: null }))[0]!.items.map((i) => i.distance)).toEqual(['', '', '', ''])
  })

  it('招生機會：只列偏少的里、少最多的在前；沒有判讀（參觀不到門檻）就不列', () => {
    const [section] = rankingFor('opportunity', data())
    expect(section!.items.map((i) => [i.name, i.distance, i.value, i.detail, i.code])).toEqual([
      ['三民區鼎金里', '800 m', '少約 7 位', '參觀 3 位・應有約 10 位', '64000050001'],
    ])
    const notJudged = areaOpportunity()
    notJudged.baseline!.judged = false
    notJudged.villages[0]!.signal = 'not_judged'
    expect(rankingFor('opportunity', data({ opportunity: notJudged }))).toEqual([{ title: '', items: [] }])
  })

  it('在籍：依班別篩選、有代碼用代碼、沒有就用里界名稱找', () => {
    const enrolled = areaEnrolled()
    enrolled.villages[1]!.village_code = null // 寶業里
    const [all] = rankingFor('enrolled', data({ enrolled }))
    expect(all!.items.map((i) => [i.name, i.value, i.code])).toEqual([
      ['三民區本揚里', '3 位', '64000050015'],
      ['三民區寶業里', '1 位', '64000050025'],
      ['左營區新上里', '1 位', '64000030020'],
    ])
    const [middle] = rankingFor('enrolled', data({ enrolled, gradeFilter: '中班' }))
    expect(middle!.items.map((i) => [i.name, i.value])).toEqual([['三民區本揚里', '1 位']])
  })

  it('資料還沒到或沒有可排的：回一段空列（元件用 paneHead 的 empty 或骨架）', () => {
    expect(rankingFor('children', data({ opportunity: null }))).toEqual([{ title: '', items: [] }])
    expect(rankingFor('enrolled', data({ enrolled: null }))).toEqual([{ title: '', items: [] }])
    expect(rankingFor('enrolled', data({ enrolled: areaEnrolled({ status: 'not_imported', villages: [] }) }))).toEqual([{ title: '', items: [] }])
    expect(rankingFor('homes', data({ trends: null }))).toEqual([{ title: '', items: [] }])
    expect(rankingFor('trend', data({ trends: null }))).toEqual([])
  })
})

describe('右欄：摘要與頁尾文字', () => {
  it('摘要：在籍、參觀有地址、資料版本', () => {
    expect(enrolledSummary(areaEnrolled())).toBe('5 位，2 位（40%）住 1 公里內、3 位（60%）住 3 公里內。')
    expect(addressSummary(stats()).text).toBe('參觀有地址 7 筆：到里 5 筆、未定位到里 2 筆（只到區 1、查無門牌 1）')
    expect(dataStatusText(stats(), areaEnrolled(), areaPeerFees())).toContain('門牌資料 115 年 10 月版・幼兒園名單 10/08 更新')
  })

  it('在籍摘要：百分比四捨五入成整數、3 公里內含 1 公里內；沒有人不除以零', () => {
    const base = areaEnrolled()
    const zero = { 幼幼班: 0, 小班: 0, 中班: 0, 大班: 0, 其他: 0 }
    const three = areaEnrolled({
      total: 3,
      distance_bands: [
        { band: '0-1', counts: { ...zero, 小班: 1 } },
        { band: '1-3', counts: { ...zero, 小班: 1 } },
        { band: '3-6', counts: { ...zero } },
        { band: '6+', counts: { ...zero } },
        { band: 'none', counts: { ...zero, 大班: 1 } },
      ],
    })
    expect(enrolledSummary(three)).toBe('3 位，1 位（33%）住 1 公里內、2 位（67%）住 3 公里內。')
    expect(enrolledSummary({ ...base, total: 0, distance_bands: base.distance_bands.map((band) => ({ ...band, counts: { ...zero } })) }))
      .toBe('0 位，0 位（0%）住 1 公里內、0 位（0%）住 3 公里內。')
  })

  it('在籍摘要：人數加千分位', () => {
    const zero = { 幼幼班: 0, 小班: 0, 中班: 0, 大班: 0, 其他: 0 }
    const big = areaEnrolled({
      total: 1200,
      distance_bands: [
        { band: '0-1', counts: { ...zero, 小班: 1000 } },
        { band: '1-3', counts: { ...zero, 小班: 100 } },
      ],
    })
    expect(enrolledSummary(big)).toBe('1,200 位，1,000 位（83%）住 1 公里內、1,100 位（92%）住 3 公里內。')
  })

  it('參觀有地址：完整句、「查看」、另有沒填地址', () => {
    expect(addressSummary(stats())).toEqual({
      text: '參觀有地址 7 筆：到里 5 筆、未定位到里 2 筆（只到區 1、查無門牌 1）',
      showLink: true,
      tail: '；另有 2 筆沒填地址',
      noAddress: '',
    })
  })

  it('參觀有地址：括號只列非零項；全部到里不寫未定位也沒有「查看」', () => {
    const mixed = stats({
      totals: totals({
        visit: 9, with_address: 9, village_level: 4, district_level: 2, unlocated: 2, pending: 1, no_address: 0, anonymized: 0,
        unlocated_reasons: [{ reason: 'outside_kaohsiung', count: 2 }],
      }),
    })
    expect(addressSummary(mixed)).toMatchObject({
      text: '參觀有地址 9 筆：到里 4 筆、未定位到里 5 筆（只到區 2、非高雄市 2、待比對 1）', showLink: true, tail: '',
    })
    const allVillage = stats({
      totals: totals({
        visit: 7, with_address: 5, village_level: 5, district_level: 0, unlocated: 0, pending: 0, no_address: 0, anonymized: 2, unlocated_reasons: [],
      }),
    })
    expect(addressSummary(allVillage)).toEqual({ text: '參觀有地址 5 筆：到里 5 筆', showLink: false, tail: '', noAddress: '' })
  })

  it('參觀有地址：未定位卻沒有任何原因時不寫空括號', () => {
    const bare = stats({
      totals: totals({ with_address: 3, village_level: 1, district_level: 0, unlocated: 2, pending: 0, unlocated_reasons: [], no_address: 0 }),
    })
    expect(addressSummary(bare).text).toBe('參觀有地址 3 筆：到里 1 筆、未定位到里 2 筆')
  })

  it('有訪視但沒有任何可比對的地址：三種原因句，沒有 text 也沒有「查看」', () => {
    const none = (changes: Record<string, unknown>) =>
      addressSummary(stats({ totals: totals({ visit: 3, with_address: 0, village_level: 0, district_level: 0, unlocated: 0, pending: 0, unlocated_reasons: [], ...changes }) }))
    expect(none({ no_address: 3, anonymized: 0 })).toEqual({ text: '', showLink: false, tail: '', noAddress: '這個範圍的訪視都還沒填地址。' })
    expect(none({ no_address: 0, anonymized: 3 }).noAddress).toBe('這個範圍的訪視地址都已依保存期限清除，無法比對。')
    expect(none({ no_address: 3, anonymized: 2 }).noAddress).toBe('這個範圍的訪視沒有可比對的地址：3 筆沒填地址、2 筆已依保存期限清除。')
  })

  it('完全沒有訪視：什麼都不寫', () => {
    const empty = stats({ totals: totals({ visit: 0, with_address: 0, village_level: 0, district_level: 0, unlocated: 0, pending: 0, no_address: 0, anonymized: 0, unlocated_reasons: [] }) })
    expect(addressSummary(empty)).toEqual({ text: '', showLink: false, tail: '', noAddress: '' })
  })

  it('資料版本：四段、在籍清冊日期、收費學年（落後接目前學年）', () => {
    expect(dataStatusText(stats(), null, null)).toBe('門牌資料 115 年 10 月版・幼兒園名單 10/08 更新・托嬰名單 10/14 更新・各里人口 115 年 9 月')
    expect(dataStatusText(stats(), areaEnrolled(), areaPeerFees())).toBe(
      '門牌資料 115 年 10 月版・幼兒園名單 10/08 更新・托嬰名單 10/14 更新・各里人口 115 年 9 月・在籍清冊 2026/10/15・收費 114 學年公告（目前是 115 學年）',
    )
    expect(dataStatusText(stats(), null, areaPeerFees({ school_year: 115 }))).toBe(
      '門牌資料 115 年 10 月版・幼兒園名單 10/08 更新・托嬰名單 10/14 更新・各里人口 115 年 9 月・收費 115 學年公告',
    )
  })

  it('資料版本：清冊未匯入或沒有收費學年就省略那一段', () => {
    const text = dataStatusText(stats(), areaEnrolled({ status: 'not_imported', roster_date: null }), areaPeerFees({ school_year: null }))
    expect(text).toBe('門牌資料 115 年 10 月版・幼兒園名單 10/08 更新・托嬰名單 10/14 更新・各里人口 115 年 9 月')
  })

  it('資料版本：各項還沒匯入的寫法；門牌未匯入那句是句號結尾，後面直接接下一段、不接「。・」', () => {
    const area = stats({ data_status: dataStatus({ doorplate_version: null, doorplates_synced_at: null, kindergartens_synced_at: null, babycare_synced_at: null, population_version: null }) })
    const text = dataStatusText(area, areaEnrolled(), null)
    expect(text).toBe(
      '門牌資料尚未匯入，家長地址暫時對不到里、算不出距離；匯入後自動補上。幼兒園名單尚未匯入・托嬰名單尚未匯入・各里人口尚未匯入・在籍清冊 2026/10/15',
    )
    expect(text).not.toContain('。・')
  })
})

describe('右欄：標題區（規格 §2.3）', () => {
  it('在籍學生：摘要一句、清冊日期；未匯入寫停用原因；還在讀什麼都不寫', () => {
    expect(paneHead('enrolled', data())).toEqual({
      title: '在籍學生', lines: ['5 位，2 位（40%）住 1 公里內、3 位（60%）住 3 公里內。'], note: '清冊 2026/10/15', empty: '',
    })
    expect(paneHead('enrolled', data({ enrolled: areaEnrolled({ status: 'not_imported' }) }))).toEqual({
      title: '在籍學生', lines: [], note: '', empty: '尚未匯入在籍名冊。',
    })
    expect(paneHead('enrolled', data({ enrolled: null }))).toEqual({ title: '在籍學生', lines: [], note: '', empty: '' })
  })

  it('2–5 歲孩子：招生機會總結的第一句；人口沒匯入寫原因；沒有孩子寫無資料句', () => {
    expect(paneHead('children', data())).toEqual({
      title: '2–5 歲孩子',
      lines: ['本校 3 公里內 3 個里，2–5 歲孩子 1,000 位，參觀 20 位（參觀率 2.0%）。'],
      note: '',
      empty: '',
    })
    const noPopulation = areaOpportunity()
    noPopulation.population.version = null
    expect(paneHead('children', data({ opportunity: noPopulation }))).toMatchObject({
      lines: [], empty: '各里人口資料尚未匯入；匯入後就能看哪些里孩子多、參觀少。',
    })
    const noKids = areaOpportunity()
    noKids.villages = noKids.villages.map((row) => ({ ...row, children: 0 }))
    expect(paneHead('children', data({ opportunity: noKids })).empty).toBe('半徑內的里沒有 2–5 歲孩子的資料。')
    expect(paneHead('children', data({ opportunity: null }))).toMatchObject({ lines: [], empty: '' })
  })

  it('孩子增減：淨增句＋出生句；note 是里界調整合併的說明（新屋只到區那句留給新屋模式）', () => {
    expect(paneHead('trend', data())).toEqual({
      title: '孩子增減',
      lines: [
        '本校 3 公里內 4 個里，2–5 歲孩子 1,400 位；和一年前同一批孩子比，淨增 26 位（+1.9%）。',
        '近 12 個月出生 180 位，比前一年同期少 20.7%（比 9 個月）。',
      ],
      note: '三民區寶業里、龍子里的里界調整過，合併成一列計算。',
      empty: '',
    })
  })

  it('孩子增減：淨增算不出來的原因只寫在 empty，不再重複放進 note（只留里界調整合併那句）', () => {
    const trends = areaTrends({ kids_unavailable: 'no_year_ago' })
    const head = paneHead('trend', data({ trends }))
    expect(head.empty).toBe('一年前的各里人口還沒匯入，這一年淨增先不算。')
    expect(head.note).toBe('三民區寶業里、龍子里的里界調整過，合併成一列計算。')
    expect(head.note).not.toContain(head.empty)
    expect(head.lines).toHaveLength(2)
  })

  it('孩子增減：資料正常但沒有任何一個里算得出增減，empty 寫一句（排行是空的）', () => {
    const trends = areaTrends()
    trends.villages = trends.villages.map((row) => ({ ...row, kids_level: 'few' as const }))
    expect(rankingFor('trend', data({ trends }))).toEqual([])
    expect(paneHead('trend', data({ trends })).empty).toBe('半徑內沒有算得出增減的里。')
    expect(paneHead('trend', data()).empty).toBe('')
  })

  it('孩子增減：算不出來的原因寫在 empty', () => {
    const unlocated = areaTrends()
    unlocated.campus.lat = null
    unlocated.campus.lng = null
    unlocated.baseline = null
    expect(paneHead('trend', data({ trends: unlocated }))).toMatchObject({
      lines: [], empty: '本校位置未標示，算不出附近有哪些里。',
    })
    expect(paneHead('trend', data({ trends: null }))).toMatchObject({ lines: [], empty: '' })
  })

  it('新屋交屋：新屋句、只到區沒算進去的說明；半徑內沒有新屋寫無資料句', () => {
    expect(paneHead('homes', data())).toEqual({
      title: '新屋交屋',
      lines: ['近 4 季新屋交屋 130 筆，最多的是三民區鼎金里（106 筆）、三民區本揚里（24 筆）。'],
      note: '範圍內的區另有 7 筆新屋交屋只到區、沒對到里，沒算進去。',
      empty: '',
    })
    const none = areaTrends()
    none.villages = none.villages.map((row) => ({ ...row, new_homes: 0 }))
    none.baseline!.new_homes = 0
    expect(paneHead('homes', data({ trends: none })).empty).toBe('半徑內近 4 季沒有新屋交屋。')
    const notImported = areaTrends()
    notImported.sources.new_homes.latest = null
    expect(paneHead('homes', data({ trends: notImported })).empty).toBe('新成屋資料尚未匯入。')
  })

  it('參觀：參觀有地址那句；沒有訪視寫 emptyText（D14）；有訪視沒地址寫原因', () => {
    expect(paneHead('visits', data())).toEqual({
      title: '參觀',
      lines: ['參觀有地址 7 筆：到里 5 筆、未定位到里 2 筆（只到區 1、查無門牌 1）；另有 2 筆沒填地址'],
      note: '',
      empty: '',
    })
    const noVisit = stats({ totals: totals({ visit: 0, with_address: 0, village_level: 0, district_level: 0, unlocated: 0, pending: 0, no_address: 0, anonymized: 0, unlocated_reasons: [] }), villages: [] })
    expect(paneHead('visits', data({ area: noVisit }))).toEqual({ title: '參觀', lines: [], note: '', empty: EMPTY_TEXT })
    const noAddress = stats({ totals: totals({ visit: 3, with_address: 0, village_level: 0, district_level: 0, unlocated: 0, pending: 0, no_address: 3, anonymized: 0, unlocated_reasons: [] }), villages: [] })
    expect(paneHead('visits', data({ area: noAddress })).empty).toBe('這個範圍的訪視都還沒填地址。')
    const unlocatedOnly = stats({ villages: [] })
    expect(paneHead('visits', data({ area: unlocatedOnly })).empty).toBe('這個範圍還沒有定位到里的參觀。')
  })

  it('招生機會：判讀句與不算在內的說明；沒有訪視寫 emptyText；不可用寫原因', () => {
    expect(paneHead('opportunity', data())).toEqual({
      title: '招生機會',
      lines: ['明顯偏少的里 1 個，照附近的參觀率合計少了約 7 位。'],
      note: '另有 2 位來自 3 公里外、1 位沒填地址、2 位沒對到里，不算在內。',
      empty: '',
    })
    const noVisit = stats({ totals: totals({ visit: 0, with_address: 0, village_level: 0, district_level: 0, unlocated: 0, pending: 0, no_address: 0, anonymized: 0, unlocated_reasons: [] }) })
    expect(paneHead('opportunity', data({ area: noVisit })).empty).toBe(EMPTY_TEXT)
    const unlocated = areaOpportunity()
    unlocated.baseline = null
    unlocated.campus.lat = null
    unlocated.campus.lng = null
    expect(paneHead('opportunity', data({ opportunity: unlocated }))).toMatchObject({
      lines: [], empty: '本校位置未標示，算不出附近有哪些里。',
    })
    const notJudged = areaOpportunity()
    notJudged.baseline!.judged = false
    expect(paneHead('opportunity', data({ opportunity: notJudged })).lines).toEqual(['附近參觀還不到 10 位，先不判斷哪些里偏少。'])
  })

  it('同業：標題「附近的同業」＋收費摘要句；資料還沒到只有標題', () => {
    expect(paneHead('peers', data())).toEqual({
      title: '附近的同業',
      lines: ['3 公里內私立幼兒園（不含準公共）有 3 所公布收費，3 歲班一學期中位數 75,000 元；本校 89,750 元，第 2 高。'],
      note: '',
      empty: '',
    })
    expect(paneHead('peers', data({ peerFees: null }))).toEqual({ title: '附近的同業', lines: [], note: '', empty: '' })
  })
})
