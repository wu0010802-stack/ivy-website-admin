import { describe, expect, it } from 'vitest'
import { STATS_GROUPS, STATS_SUB_LABELS, conditionsOf, groupOfSub } from '../admissions/statsNav'
import { STATS_SUBS } from '../admissions/useAdmissionsFilters'

describe('統計導覽（statsNav）', () => {
  it('四類依序是招生轉換、參觀預約、區域與市場、五校與廣告', () => {
    expect(STATS_GROUPS.map((group) => [group.key, group.label])).toEqual([
      ['funnel', '招生轉換'], ['booking', '參觀預約'], ['market', '區域與市場'], ['cross', '五校與廣告'],
    ])
    expect(STATS_GROUPS.map((group) => group.subs)).toEqual([
      ['overview', 'class', 'source', 'staff', 'nodeposit'], ['booking', 'journey'], ['area', 'potential'], ['compare', 'ads'],
    ])
  })

  it('四類涵蓋 STATS_SUBS 除 imports 以外的每一個，而且不重複', () => {
    const grouped = STATS_GROUPS.flatMap((group) => [...group.subs])
    expect(new Set(grouped).size).toBe(grouped.length)
    expect([...grouped].sort()).toEqual(STATS_SUBS.filter((sub) => sub !== 'imports').sort())
    expect(grouped).not.toContain('imports')
  })

  it('groupOfSub：每個分頁回所屬的類，資料匯入不屬於任何一類', () => {
    for (const group of STATS_GROUPS) for (const sub of group.subs) expect(groupOfSub(sub)?.key).toBe(group.key)
    expect(groupOfSub('imports')).toBeNull()
  })

  it('每個分頁都有名稱；參觀預約底下的第一頁叫「預約成效」（sub 仍是 booking），不和分類同名', () => {
    expect(Object.keys(STATS_SUB_LABELS).sort()).toEqual([...STATS_SUBS].sort())
    expect(STATS_SUB_LABELS.booking).toBe('預約成效')
    expect(STATS_GROUPS.map((group) => group.label)).not.toContain(STATS_SUB_LABELS.booking)
    expect(STATS_SUB_LABELS.imports).toBe('資料匯入')
  })

  it('conditionsOf：每個分頁用得到的頁首條件（校區、入學學年學期）', () => {
    const expected: Record<string, { campus: boolean; term: boolean }> = {
      overview: { campus: true, term: true },
      class: { campus: true, term: true },
      source: { campus: true, term: true },
      staff: { campus: true, term: true },
      nodeposit: { campus: true, term: true },
      area: { campus: true, term: true },
      compare: { campus: false, term: true },
      booking: { campus: true, term: false },
      journey: { campus: true, term: false },
      potential: { campus: true, term: false },
      imports: { campus: true, term: false },
      ads: { campus: false, term: false },
    }
    expect(Object.keys(expected).sort()).toEqual([...STATS_SUBS].sort())
    for (const sub of STATS_SUBS) expect(conditionsOf(sub), sub).toEqual(expected[sub])
  })
})
