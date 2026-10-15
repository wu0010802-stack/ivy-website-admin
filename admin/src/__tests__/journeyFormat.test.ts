// 預約全程（2026-10-15 規格 §3.3）：篩選的網址編解碼、各表的列、摘要句。
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_JOURNEY_FILTER, cancelNote, cancelRows, exitRows, funnelRows, journeyQuery, journeyRange, journeySummary, parseJourneyQuery,
  rateText, timingRows,
} from '../admissions/journeyFormat'
import { journeyData } from './admissionsTestKit'

describe('篩選 ↔ 網址', () => {
  it('預設（最近 3 個月、全部來源）不寫進網址；讀不到就是預設', () => {
    expect(journeyQuery(DEFAULT_JOURNEY_FILTER)).toEqual({})
    expect(parseJourneyQuery({})).toEqual(DEFAULT_JOURNEY_FILTER)
  })

  it('期間與來源寫出來、讀回來；自訂區間才帶起訖', () => {
    const filter = { period: '180', from: '', to: '', source: 'web' } as const
    expect(journeyQuery(filter)).toEqual({ jp: '180', js: 'web' })
    expect(parseJourneyQuery({ jp: '180', js: 'web' })).toEqual(filter)
    const custom = { period: 'custom', from: '2026-07-01', to: '2026-09-30', source: 'assisted' } as const
    expect(journeyQuery(custom)).toEqual({ jp: 'custom', jf: '2026-07-01', jt: '2026-09-30', js: 'assisted' })
    expect(parseJourneyQuery({ jp: 'custom', jf: '2026-07-01', jt: '2026-09-30', js: 'assisted' })).toEqual(custom)
  })

  it('認不得的值、日期格式不對、自訂區間缺一端都退回預設', () => {
    expect(parseJourneyQuery({ jp: 'hack', js: 'x' })).toEqual(DEFAULT_JOURNEY_FILTER)
    expect(parseJourneyQuery({ jp: 'custom', jf: '2026-07-01' })).toEqual(DEFAULT_JOURNEY_FILTER)
    expect(parseJourneyQuery({ jp: 'custom', jf: 'abc', jt: '2026-09-30' })).toEqual(DEFAULT_JOURNEY_FILTER)
    // 非自訂時多出來的 jf／jt 被忽略。
    expect(parseJourneyQuery({ jp: '90', jf: '2026-07-01', jt: '2026-09-30' })).toEqual(DEFAULT_JOURNEY_FILTER)
  })

  it('期間換成起訖日：往回推的天數含今天；自訂照給的', () => {
    expect(journeyRange(DEFAULT_JOURNEY_FILTER, '2026-10-15')).toEqual({ from: '2026-07-18', to: '2026-10-15' })
    expect(journeyRange({ ...DEFAULT_JOURNEY_FILTER, period: '365' }, '2026-10-15')).toEqual({ from: '2025-10-16', to: '2026-10-15' })
    expect(journeyRange({ period: 'custom', from: '2026-07-01', to: '2026-09-30', source: 'all' }, '2026-10-15')).toEqual({ from: '2026-07-01', to: '2026-09-30' })
    expect(journeyRange({ period: 'custom', from: '', to: '', source: 'all' }, '2026-10-15')).toBeNull()
  })
})

describe('比率文字', () => {
  it('分子分母一起寫；分母不足 20 加「樣本較少」；分母 0 寫「—」', () => {
    expect(rateText('到場率', { key: 'attendance', numerator: 80, denominator: 96, pct: 83.3 })).toBe('到場率 83.3%（80／96）')
    expect(rateText('到場率', { key: 'attendance', numerator: 8, denominator: 9, pct: 88.9 })).toBe('到場率 88.9%（8／9）・樣本較少')
    expect(rateText('預繳率', { key: 'deposit', numerator: 0, denominator: 0, pct: null })).toBe('預繳率 —')
  })
})

describe('各表的列', () => {
  const data = journeyData()

  it('全程漏斗：預約案件 → 已到場 → 有招生訪視 → 預繳過 → 註冊過，再接預繳後退出', () => {
    expect(funnelRows(data).map((row) => [row.stage, row.count, row.rate])).toEqual([
      ['預約案件', 13, '取消率 23.1%（3／13）・樣本較少'],
      ['已到場', 8, '到場率 88.9%（8／9）・樣本較少'],
      ['有招生訪視', 7, '有訪視比例 87.5%（7／8）・樣本較少'],
      ['預繳過', 4, '預繳率 57.1%（4／7）・樣本較少'],
      ['註冊過', 2, '註冊率 50.0%（2／4）・樣本較少'],
      ['預繳後退出', 2, '退出比例 50.0%（2／4）・樣本較少'],
    ])
  })

  it('家庭在哪裡離開：沒走到預繳過的各類；預繳後退出另列', () => {
    expect(exitRows(data).map((row) => [row.kind, row.count, row.timing])).toEqual([
      ['已取消・家長', 1, '距參觀日見下表'],
      ['已取消・園方', 1, '距參觀日見下表'],
      ['已取消・其他或沒記', 1, '距參觀日見下表'],
      ['沒來', 1, '參觀當天，人工標記'],
      ['時間已過未標記', 1, '場次已過、還沒標記到場或沒來'],
      ['已到場但沒有招生訪視', 1, '沒有連到招生紀錄'],
      ['參觀後未預繳・觀察中', 1, '參觀後 0–13 天'],
      ['參觀後未預繳・逾期', 1, '參觀後 14–89 天'],
      ['參觀後未預繳・冷名單', 1, '參觀後 90 天以上'],
      ['預繳後退出・退預繳', 1, '天數見「各段要花多久」'],
      ['預繳後退出・退註冊', 1, '天數見「各段要花多久」'],
    ])
  })

  it('家庭在哪裡離開：取消時點整張表沒有資料（n=0）時，三個取消列不再指向那張表', () => {
    const noTiming = journeyData({ timing: { ...data.timing, cancel_before_visit: { ...data.timing.cancel_before_visit, n: 0, excluded: 1 } } })
    const rows = exitRows(noTiming)
    expect(rows.filter((row) => row.key.startsWith('cancel_')).map((row) => [row.kind, row.timing])).toEqual([
      ['已取消・家長', '沒有取消時間可比對'],
      ['已取消・園方', '沒有取消時間可比對'],
      ['已取消・其他或沒記', '沒有取消時間可比對'],
    ])
    // 其他列的說明和有取消時點的資料一樣。
    const others = (list: typeof rows) => list.filter((row) => !row.key.startsWith('cancel_')).map((row) => [row.key, row.timing])
    expect(others(rows)).toEqual(others(exitRows(data)))
  })

  it('家庭在哪裡離開：完全沒有取消時間（n=0 且 excluded=0）時，三個取消列寫「—」，不說「沒有取消時間可比對」', () => {
    const none = journeyData({ timing: { ...data.timing, cancel_before_visit: { ...data.timing.cancel_before_visit, n: 0, excluded: 0 } } })
    expect(exitRows(none).filter((row) => row.key.startsWith('cancel_')).map((row) => [row.kind, row.timing])).toEqual([
      ['已取消・家長', '—'],
      ['已取消・園方', '—'],
      ['已取消・其他或沒記', '—'],
    ])
  })

  it('取消時點：缺取消時間而不納入的筆數另寫；沒有就是空字串', () => {
    const withExcluded = (excluded: number) =>
      journeyData({ timing: { ...data.timing, cancel_before_visit: { ...data.timing.cancel_before_visit, excluded } } })
    expect(cancelNote(data)).toBe('')
    expect(cancelNote(withExcluded(0))).toBe('')
    expect(cancelNote(withExcluded(1))).toBe('另有 1 筆沒有取消時間，不納入')
    expect(cancelNote(withExcluded(3))).toBe('另有 3 筆沒有取消時間，不納入')
  })

  it('取消時點：六個區間，家長、園方、其他各一欄；沒有取消回空陣列', () => {
    expect(cancelRows(data)).toEqual([
      { key: 'after_visit', bucket: '參觀日之後才取消', parent: 0, staff: 0, other: 1 },
      { key: 'same_day', bucket: '當天', parent: 1, staff: 0, other: 0 },
      { key: 'day_1', bucket: '1 天前', parent: 0, staff: 0, other: 0 },
      { key: 'days_2_3', bucket: '2–3 天前', parent: 0, staff: 0, other: 0 },
      { key: 'days_4_7', bucket: '4–7 天前', parent: 0, staff: 1, other: 0 },
      { key: 'days_8_plus', bucket: '8 天以上', parent: 0, staff: 0, other: 0 },
    ])
    const none = journeyData({ timing: { ...data.timing, cancel_before_visit: { ...data.timing.cancel_before_visit, n: 0 } } })
    expect(cancelRows(none)).toEqual([])
  })

  it('各段要花多久：中位數（整數不寫小數）、筆數；筆數不足 20 標「樣本較少」、不納入的筆數另寫', () => {
    expect(timingRows(data).map((row) => [row.metric, row.median, row.n, row.note])).toEqual([
      ['預約提前量（預約送出到預定參觀日）', '7 天', 13, '樣本較少'],
      ['參觀到預繳', '5 天', 3, '樣本較少；另有 1 筆沒有預繳日或日期倒置，不納入'],
      ['預繳到註冊', '6.5 天', 2, '樣本較少'],
      ['預繳到退出', '11 天', 2, '樣本較少'],
    ])
    // 筆數夠了就不標；沒有值（n=0）寫「—」也不標樣本較少，只留不納入的筆數。
    const enough = journeyData({ timing: { ...data.timing, lead_days: { median: 7, n: 20, excluded: 0 } } })
    expect(timingRows(enough)[0]).toMatchObject({ median: '7 天', n: 20, note: '' })
    const empty = journeyData({ timing: { ...data.timing, visit_to_deposit: { median: null, n: 0, excluded: 2 } } })
    expect(timingRows(empty)[1]).toMatchObject({ median: '—', n: 0, note: '另有 2 筆沒有預繳日或日期倒置，不納入' })
  })
})

describe('摘要句', () => {
  it('寫期間、預約案件、各結局，到場的往下接招生紀錄、預繳、註冊、預繳後退出', () => {
    expect(journeySummary(journeyData(), '義華')).toBe(
      '2026/07/17–2026/10/15，義華預定參觀的預約 13 筆：到場 8（到場率 88.9%）、取消 3、沒來 1、時間已過未標記 1。' +
        '到場的 8 筆中 7 筆有招生紀錄，預繳 4、註冊 2、預繳後退出 2。',
    )
  })

  it('沒有案件、沒有到場時句子跟著縮短', () => {
    const none = journeyData({ cases: { total: 0, by_source: {} } })
    expect(journeySummary(none, '義華')).toBe('2026/07/17–2026/10/15，義華這段期間沒有預約案件。')
    const noShow = journeyData({
      cases: { total: 2, by_source: { web: 2 } },
      visit_outcomes: { completed: 0, no_show: 1, cancelled: { total: 1, parent: 1, staff: 0, other: 0 }, unmarked: 0 },
      rates: journeyData().rates.map((rate) => (rate.key === 'attendance' ? { ...rate, numerator: 0, denominator: 1, pct: 0 } : rate)),
    })
    expect(journeySummary(noShow, '義華')).toBe(
      '2026/07/17–2026/10/15，義華預定參觀的預約 2 筆：到場 0（到場率 0.0%）、取消 1、沒來 1、時間已過未標記 0。',
    )
  })
})
