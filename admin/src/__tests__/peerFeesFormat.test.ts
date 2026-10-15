// 附近同業收費的格式函式（2026-10-15 規格 7.1）。
import { describe, expect, it } from 'vitest'
import {
  FEE_ITEM_KEYS, SCHOOL_COLUMNS, SCHOOL_CSV_COLUMNS, feeLagNote, feeSourceLine, formatYuan, groupRows, itemRows, peerFeesSubtitle, peerSummaryText,
  schoolCsvCell, schoolRows, stripScale,
} from '../components/admissions/area/peerFeesFormat'
import { areaPeerFees, feeItems, peerFeeSchool } from './admissionsTestKit'

const withPrivate = (changes: Record<string, unknown>) => {
  const data = areaPeerFees()
  return { ...data, groups: data.groups.map((group) => (group.kind === 'private' ? { ...group, ...changes } : group)) }
}

describe('附近同業收費格式', () => {
  it('金額與學年', () => {
    expect(formatYuan(89750)).toBe('89,750 元')
    expect(formatYuan(null)).toBe('—')
    expect(peerFeesSubtitle(areaPeerFees())).toBe('114 學年・全日班・一學期公告收費')
    expect(feeLagNote(114, 115)).toBe('目前是 115 學年，最新公開收費是 114 學年。')
    expect(feeLagNote(115, 115)).toBe('')
    expect(feeLagNote(null, 115)).toBe('')
  })

  it('總結句：有中位數、有本校排名', () => {
    expect(peerSummaryText(areaPeerFees())).toBe('3 公里內私立幼兒園（不含準公共）有 3 所公布收費，3 歲班一學期中位數 75,000 元；本校 89,750 元，第 2 高。')
  })

  it('總結句：少於 3 所不算中位數、只寫本校金額', () => {
    expect(peerSummaryText(withPrivate({ with_fee: 2, median: null, own_rank: 2, rank_total: 3 }))).toBe(
      '3 公里內私立幼兒園（不含準公共）只有 2 所公布收費，不算中位數。本校 89,750 元。',
    )
  })

  it('總結句：附近有私立但都沒公布收費、附近沒有其他私立', () => {
    expect(peerSummaryText(withPrivate({ with_fee: 0, median: null, own_rank: 1, rank_total: 1 }))).toBe(
      '3 公里內私立幼兒園（不含準公共）都沒有公布收費。本校 89,750 元。',
    )
    expect(peerSummaryText(withPrivate({ schools: 0, with_fee: 0, median: null }))).toBe('3 公里內沒有其他私立幼兒園（不含準公共）。本校 89,750 元。')
  })

  it('總結句：本校沒公布這個年齡、找不到本校、本校是準公共（不排名）', () => {
    expect(peerSummaryText({ ...areaPeerFees(), own: null, own_missing: 'no_fee', age: 4 })).toBe(
      '3 公里內私立幼兒園（不含準公共）有 3 所公布收費，4 歲班一學期中位數 75,000 元；本校沒有公布 4 歲班收費。',
    )
    expect(peerSummaryText({ ...areaPeerFees(), own: null, own_missing: 'not_found' })).toBe(
      '3 公里內私立幼兒園（不含準公共）有 3 所公布收費，3 歲班一學期中位數 75,000 元；找不到本校在全國教保資訊網的資料。',
    )
    expect(peerSummaryText(withPrivate({ own_rank: null, rank_total: null }))).toBe(
      '3 公里內私立幼兒園（不含準公共）有 3 所公布收費，3 歲班一學期中位數 75,000 元；本校 89,750 元。',
    )
  })

  it('類型背景表', () => {
    expect(groupRows(areaPeerFees())).toEqual([
      { kind: 'private', label: '私立一般', schools: '4', withFee: '3', median: '75,000 元', range: '40,200–93,000 元' },
      { kind: 'quasi_public', label: '準公共', schools: '1', withFee: '1', median: '—', range: '63,190 元' },
      { kind: 'public', label: '公立', schools: '1', withFee: '1', median: '—', range: '17,965 元' },
      { kind: 'nonprofit', label: '非營利', schools: '1', withFee: '0', median: '—', range: '—' },
    ])
  })

  it('項目對照：差額有正負號，任一邊不知道寫「—」', () => {
    const rows = itemRows(areaPeerFees())
    expect(rows[0]).toEqual({ key: 'tuition', label: '學費', own: '19,900 元', peer: '15,000 元', diff: '+4,900 元' })
    expect(rows[1].diff).toBe(`${'−'}15,800 元`)
    expect(rows[5]).toEqual({ key: 'snack', label: '點心費', own: '8,250 元', peer: '—', diff: '—' })
    expect(rows[6]).toEqual({ key: 'after_care_monthly', label: '課後延托（每月）', own: '1,200 元', peer: '1,200 元', diff: '0 元' })
  })

  it('項目全空的園所：寫「—」不寫 0', () => {
    const data = { ...areaPeerFees(), own: { ...areaPeerFees().own!, items: feeItems() } }
    expect(itemRows(data).every((row) => row.own === '—' && row.diff === '—')).toBe(true)
  })

  it('落點條：私立同業加本校，左右是最低與最高；少於 3 所不畫', () => {
    const strip = stripScale(areaPeerFees())!
    expect(strip.points).toEqual([
      { id: 'kg-p1', left: 65.9, own: false },
      { id: 'kg-p2', left: 100, own: false },
      { id: 'kg-p3', left: 0, own: false },
      { id: 'kg-own', left: 93.8, own: true },
    ])
    expect(strip.median).toBe(65.9)
    expect([strip.lowestText, strip.highestText]).toEqual(['40,200 元', '93,000 元'])
    expect(stripScale(withPrivate({ median: null }))).toBeNull()
  })

  it('各所收費表：私立與準公共有收費的，總價高到低', () => {
    const rows = schoolRows(areaPeerFees())
    // shortName 會去掉「高雄市私立」。
    expect(rows.map((row) => [row.name, row.kind, row.semester_total])).toEqual([
      ['乙幼兒園', '私立', 93000],
      ['常春藤幼兒園', '本機構', 89750],
      ['甲幼兒園', '私立', 75000],
      ['小草幼兒園', '準公共', 63190],
      ['丙幼兒園', '私立', 40200],
    ])
    expect(rows[0].tuition).toBe(15000)
    expect(schoolRows({ ...areaPeerFees(), schools: [peerFeeSchool({ semester_total: null })] })).toEqual([])
  })

  it('各所收費表：未公布寫「—」、有值有千分位，原始數字另留給排序與 CSV', () => {
    const rows = schoolRows(areaPeerFees())
    const p2 = rows.find((row) => row.source_id === 'kg-p2')!
    const p3 = rows.find((row) => row.source_id === 'kg-p3')!
    expect([p2.semester_total_text, p2.monthly_average_text]).toEqual(['93,000', '16,909'])
    expect([p3.semester_total_text, p3.monthly_average_text]).toEqual(['40,200', '—'])
    expect([p3.semester_total, p3.monthly_average]).toEqual([40200, null])
  })

  it('各所收費表的欄位：文字欄、不用 count（null 會被顯示成 0）', () => {
    expect(SCHOOL_COLUMNS.map((column) => column.key)).toEqual(['name', 'kind', 'distance', 'semester_total_text', 'monthly_average_text'])
    expect(SCHOOL_CSV_COLUMNS.map((column) => column.key)).toEqual([
      'name', 'kind', 'distance', 'semester_total_text', 'monthly_average_text',
      'tuition', 'misc_fee', 'materials', 'activities', 'lunch', 'snack', 'after_care_monthly',
    ])
    expect(SCHOOL_CSV_COLUMNS.slice(5).map((column) => column.key)).toEqual([...FEE_ITEM_KEYS])
    expect([...SCHOOL_COLUMNS, ...SCHOOL_CSV_COLUMNS].some((column) => column.kind === 'count')).toBe(false)
  })

  it('各所收費表匯出：寫原始數字，沒有就空白，不寫 0 或「—」', () => {
    const rows = schoolRows(areaPeerFees())
    const p3 = rows.find((row) => row.source_id === 'kg-p3')!
    const cell = (row: (typeof rows)[number], key: string) => schoolCsvCell(row, SCHOOL_CSV_COLUMNS.find((column) => column.key === key)!)
    expect(cell(p3, 'semester_total_text')).toBe(40200)
    expect(cell(p3, 'monthly_average_text')).toBe('')
    expect(cell(p3, 'tuition')).toBe(15000)
    expect(cell(p3, 'misc_fee')).toBe('')
    expect(cell(p3, 'name')).toBeUndefined()
    expect(SCHOOL_CSV_COLUMNS.filter((column) => cell(p3, column.key) === undefined).map((column) => column.key)).toEqual(['name', 'kind', 'distance'])
  })

  it('清單來源小字', () => {
    expect(feeSourceLine('資料來源：全國教保資訊網（kiang 整理）', '10/15', areaPeerFees())).toBe(
      '資料來源：全國教保資訊網（kiang 整理）・收費為 114 學年公告・10/15 更新　目前是 115 學年，最新公開收費是 114 學年。',
    )
    expect(feeSourceLine('資料來源：全國教保資訊網（kiang 整理）', '10/15', null)).toBe('資料來源：全國教保資訊網（kiang 整理）・10/15 更新')
  })
})
